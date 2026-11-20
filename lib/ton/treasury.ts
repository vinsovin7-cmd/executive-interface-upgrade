import "server-only"

import { Address, beginCell, internal, SendMode, toNano, type MessageRelaxed } from "@ton/core"
import { JettonMaster, JettonWallet, TonClient, WalletContractV4 } from "@ton/ton"
import { deriveEd25519Path, keyPairFromSeed, mnemonicToPrivateKey, mnemonicValidate, pbkdf2_sha512, type KeyPair } from "@ton/crypto"

import { DEFAULT_TREASURY_ADDRESS, formatAtomic, tonviewerTransactionUrl } from "@/lib/mining/config"

const TONCENTER_JSON_RPC = "https://toncenter.com/api/v2/jsonRPC"
const TONCENTER_API_V3 = "https://toncenter.com/api/v3"
const JETTON_TRANSFER_OP = 0xf8a7ea5

// Strict gas ceiling. Jetton (GRAM/USDT) transfers and TON payout gas may only
// ever be attached at one of these three values — never higher — so a single
// payout can never drain the treasury. Anything else falls back to the cap.
export const ALLOWED_GAS_TON = ["0.001", "0.002", "0.003"] as const
const DEFAULT_GAS_TON: (typeof ALLOWED_GAS_TON)[number] = "0.003"

// Standard BIP-39 seed derivation (PBKDF2-HMAC-SHA512, 2048 iterations, empty
// passphrase) and the SLIP-0010 ed25519 account path multichain HD wallets use
// for TON (SLIP-0044 coin type 607). TON's own mnemonic routines reject these
// phrases, so this path lets a 12-word multichain phrase sign for the treasury.
const BIP39_PBKDF2_ITERATIONS = 2048
const MULTICHAIN_ACCOUNT_PATH = [44, 607, 0]

/** Resolves the attached gas fee, clamped to the 0.001/0.002/0.003 TON ceiling. */
export function readGasFeeNano() {
  const raw = (process.env.TON_JETTON_GAS_TON ?? process.env.TON_PAYOUT_GAS_TON ?? "").trim()
  return toNano((ALLOWED_GAS_TON as readonly string[]).includes(raw) ? raw : DEFAULT_GAS_TON)
}

export type TreasuryConfig = {
  signerMnemonic: string[]
  apiKey: string | null
  treasuryAddress: string
  gramMasterAddress: string | null
  usdtMasterAddress: string | null
  configured: boolean
  diagnostics: string[]
}

function firstEnvValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return null
}

export function readTreasuryConfig(): TreasuryConfig {
  const diagnostics: string[] = []
  const mnemonicRaw = firstEnvValue("TON_TREASURY_SIGNER_MNEMONIC", "TON_TREASURY_MNEMONIC", "MASTER_TREASURY_MNEMONIC")
  const signerMnemonic = mnemonicRaw ? mnemonicRaw.split(/\s+/).filter(Boolean) : []
  const mnemonicValid = signerMnemonic.length === 24 || signerMnemonic.length === 12
  if (signerMnemonic.length > 0 && !mnemonicValid)
    diagnostics.push("TON_TREASURY_SIGNER_MNEMONIC must be a 24-word TON mnemonic or a 12-word BIP-39 multichain phrase.")

  const apiKey = firstEnvValue("TONCENTER_API_KEY")
  if (!apiKey) diagnostics.push("TONCENTER_API_KEY is required to broadcast and verify payouts on Mainnet.")

  const treasuryAddress = firstEnvValue("MASTER_TREASURY_ADDRESS", "TON_TREASURY_ADDRESS") ?? DEFAULT_TREASURY_ADDRESS

  const gramMasterAddress = firstEnvValue("GRAM_TOKEN_MASTER_ADDRESS")
  if (!gramMasterAddress) diagnostics.push("GRAM_TOKEN_MASTER_ADDRESS is required for GRAM jetton payouts.")

  const usdtMasterAddress = firstEnvValue("USDT_TOKEN_MASTER_ADDRESS")

  return {
    signerMnemonic,
    apiKey,
    treasuryAddress,
    gramMasterAddress,
    usdtMasterAddress,
    configured: mnemonicValid && Boolean(apiKey),
    diagnostics,
  }
}

function createClient(config: TreasuryConfig) {
  return new TonClient({ endpoint: TONCENTER_JSON_RPC, apiKey: config.apiKey ?? undefined })
}

function createTonNativeSigner(mnemonic: string[]) {
  return mnemonicToPrivateKey(mnemonic).then((keyPair) => ({
    keyPair,
    wallet: WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey }),
  }))
}

/**
 * Multichain signer derivation for a standard 12-word BIP-39 phrase: the BIP-39
 * seed followed by SLIP-0010 ed25519 derivation at m/44'/607'/0'. TON's own
 * mnemonic routines reject these phrases, so this is what lets a 12-word
 * multichain phrase control the treasury wallet.
 */
async function createMultichainSigner(mnemonic: string[]) {
  const seed = await pbkdf2_sha512(mnemonic.join(" ").normalize("NFKD"), "mnemonic", BIP39_PBKDF2_ITERATIONS, 64)
  const keyPair = keyPairFromSeed(await deriveEd25519Path(seed, MULTICHAIN_ACCOUNT_PATH))
  return { keyPair, wallet: WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey }) }
}

type SignerCandidate = { label: string; keyPair: KeyPair; wallet: WalletContractV4 }

/**
 * Every derivation a treasury phrase may legitimately use — TON-native and the
 * BIP-39/SLIP-0010 multichain path. The candidate whose derived address controls
 * the treasury is the one used to sign; if none match, all derived addresses are
 * reported so the mismatch is diagnosable.
 */
async function createSignerCandidates(config: TreasuryConfig): Promise<SignerCandidate[]> {
  const mnemonic = config.signerMnemonic
  if (mnemonic.length === 0) return []
  const candidates: SignerCandidate[] = []
  try {
    if (await mnemonicValidate(mnemonic)) {
      candidates.push({ label: "TON mnemonic", ...(await createTonNativeSigner(mnemonic)) })
    }
  } catch {
    // fall through to the multichain derivation
  }
  try {
    candidates.push({ label: "BIP-39/SLIP-0010 m/44'/607'/0'", ...(await createMultichainSigner(mnemonic)) })
  } catch {
    // surfaced via diagnostics when nothing controls the treasury
  }
  return candidates
}

function describeCandidates(candidates: SignerCandidate[]) {
  if (candidates.length === 0) return "no signer could be derived from TON_TREASURY_SIGNER_MNEMONIC"
  return candidates.map((candidate) => `${candidate.wallet.address.toString({ bounceable: false })} (${candidate.label})`).join(", ")
}

async function getJettonBalance(client: TonClient, masterAddress: Address, owner: Address) {
  const walletAddress = await JettonMaster.create(masterAddress).getWalletAddress(client.provider(masterAddress), owner)
  return JettonWallet.create(walletAddress).getBalance(client.provider(walletAddress))
}

export type TreasuryStatus = {
  configured: boolean
  signerAddress: string | null
  treasuryAddress: string
  addressMatchesTreasury: boolean
  tonBalance: string | null
  gramBalance: string | null
  gramMasterAddress: string | null
  usdtBalance: string | null
  usdtMasterAddress: string | null
  liquidityReady: boolean
  diagnostics: string[]
}

export async function getTreasuryStatus(): Promise<TreasuryStatus> {
  const config = readTreasuryConfig()
  const status: TreasuryStatus = {
    configured: config.configured,
    signerAddress: null,
    treasuryAddress: config.treasuryAddress,
    addressMatchesTreasury: false,
    tonBalance: null,
    gramBalance: null,
    gramMasterAddress: config.gramMasterAddress,
    usdtBalance: null,
    usdtMasterAddress: config.usdtMasterAddress,
    liquidityReady: false,
    diagnostics: [...config.diagnostics],
  }
  if (!config.apiKey) return status

  const client = createClient(config)
  const treasury = Address.parse(config.treasuryAddress)

  try {
    const candidates = await createSignerCandidates(config)
    if (candidates.length > 0) {
      const match = candidates.find((candidate) => candidate.wallet.address.equals(treasury)) ?? null
      const chosen = match ?? candidates[0]
      status.signerAddress = chosen.wallet.address.toString({ bounceable: false })
      status.addressMatchesTreasury = match !== null
      if (!match) {
        status.diagnostics.push(
          `The configured TON_TREASURY_SIGNER_MNEMONIC derives ${describeCandidates(candidates)}, not the treasury address ${config.treasuryAddress}. Provide the mnemonic that controls ${config.treasuryAddress}, or run a funded signer wallet that settles to it.`,
        )
      }
    }

    const tonBalance = await client.getBalance(treasury)
    status.tonBalance = formatAtomic(tonBalance.toString(), 9)

    if (config.gramMasterAddress) {
      const gramBalance = await getJettonBalance(client, Address.parse(config.gramMasterAddress), treasury)
      status.gramBalance = formatAtomic(gramBalance.toString(), 9)
    }
    if (config.usdtMasterAddress) {
      const usdtBalance = await getJettonBalance(client, Address.parse(config.usdtMasterAddress), treasury)
      status.usdtBalance = formatAtomic(usdtBalance.toString(), 6)
    }

    status.liquidityReady = tonBalance >= readGasFeeNano() && status.gramBalance !== null && status.gramBalance !== "0"
  } catch (cause) {
    status.diagnostics.push(cause instanceof Error ? cause.message : "Treasury status could not be read from Toncenter.")
  }

  return status
}

let treasuryStatusCache: { at: number; value: TreasuryStatus } | null = null

/**
 * Toncenter-backed treasury readiness, memoized briefly so frequently polled
 * routes do not fan out a masterchain + jetton read on every request.
 */
export async function getCachedTreasuryStatus(ttlMs = 30_000): Promise<TreasuryStatus> {
  const now = Date.now()
  if (treasuryStatusCache && now - treasuryStatusCache.at < ttlMs) return treasuryStatusCache.value
  const value = await getTreasuryStatus()
  treasuryStatusCache = { at: now, value }
  return value
}

export type PayoutOutcome =
  | { ok: true; transactionHash: string; tonviewerUrl: string; confirmed: boolean; seqno: number }
  | { ok: false; reason: string }

async function confirmOnChain(config: TreasuryConfig, messageHash: string) {
  if (!config.apiKey) return false
  const params = new URLSearchParams({ account: config.treasuryAddress, limit: "20" })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${TONCENTER_API_V3}/transactions?${params}`, {
        headers: { Accept: "application/json", "X-API-Key": config.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      })
      if (response.ok) {
        const body = (await response.json()) as { transactions?: Array<{ hash?: string }> }
        const target = messageHash.toLowerCase()
        const found = (body.transactions ?? []).some((transaction) => {
          if (typeof transaction.hash !== "string") return false
          const raw = transaction.hash.toLowerCase()
          if (raw === target) return true
          try {
            return Buffer.from(transaction.hash, "base64").toString("hex").toLowerCase() === target
          } catch {
            return false
          }
        })
        if (found) return true
      }
    } catch {
      // transient; retry until the attempt budget is exhausted
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return false
}

/**
 * Broadcasts a real Mainnet payout from the configured treasury wallet. Returns
 * the versioned external-message hash (the identifier Tonviewer indexes for the
 * transaction). No hash is returned unless a signed message was actually sent —
 * failures return diagnostics instead of a fabricated reference.
 */
export async function executePayout(params: { assetCode: string; destination: string; amountAtomic: bigint }): Promise<PayoutOutcome> {
  const config = readTreasuryConfig()
  if (!config.configured) {
    return { ok: false, reason: `On-chain payout signer is not configured. ${config.diagnostics.join(" ")}`.trim() }
  }
  if (params.amountAtomic <= BigInt(0)) return { ok: false, reason: "Payout amount must be greater than zero." }

  let client: TonClient
  let treasury: Address
  let destination: Address
  try {
    client = createClient(config)
    treasury = Address.parse(config.treasuryAddress)
    destination = Address.parse(params.destination)
  } catch {
    return { ok: false, reason: "Treasury or destination address could not be parsed as a TON address." }
  }

  const candidates = await createSignerCandidates(config)
  const signer = candidates.find((candidate) => candidate.wallet.address.equals(treasury)) ?? null
  if (!signer) {
    return {
      ok: false,
      reason: `Payout signer does not control the treasury address. Derived ${describeCandidates(candidates)}; treasury=${config.treasuryAddress}. Fund and use the mnemonic for ${config.treasuryAddress}, or run a funded signer wallet that settles to it.`,
    }
  }
  const { keyPair, wallet } = signer

  const opened = client.open(wallet)
  let messages: MessageRelaxed[]
  const gasFee = readGasFeeNano()

  try {
    const tonBalance = await client.getBalance(treasury)

    if (params.assetCode === "TON") {
      const required = params.amountAtomic + gasFee
      if (tonBalance < required) {
        return {
          ok: false,
          reason: `Aborted: treasury TON liquidity/gas is insufficient. Available ${formatAtomic(tonBalance.toString(), 9)} TON; required ${formatAtomic(required.toString(), 9)} TON (amount + ${formatAtomic(gasFee.toString(), 9)} TON capped gas).`,
        }
      }
      messages = [internal({ to: destination, value: params.amountAtomic, bounce: false })]
    } else {
      const master = params.assetCode === "USDT" ? config.usdtMasterAddress : config.gramMasterAddress
      const decimals = params.assetCode === "USDT" ? 6 : 9
      if (!master) return { ok: false, reason: `${params.assetCode} jetton master address is not configured.` }
      if (tonBalance < gasFee) {
        return {
          ok: false,
          reason: `Aborted: treasury TON gas is insufficient to broadcast the ${params.assetCode} jetton transfer. Available ${formatAtomic(tonBalance.toString(), 9)} TON; the gas cap is ${formatAtomic(gasFee.toString(), 9)} TON. Fund ${config.treasuryAddress} with TON before retrying.`,
        }
      }
      const masterAddress = Address.parse(master)
      const jettonBalance = await getJettonBalance(client, masterAddress, treasury)
      if (jettonBalance < params.amountAtomic) {
        return {
          ok: false,
          reason: `Treasury ${params.assetCode} jetton liquidity is insufficient. Available ${formatAtomic(jettonBalance.toString(), decimals)} ${params.assetCode}; requested ${formatAtomic(params.amountAtomic.toString(), decimals)} ${params.assetCode}.`,
        }
      }
      const jettonWalletAddress = await JettonMaster.create(masterAddress).getWalletAddress(client.provider(masterAddress), treasury)
      const body = beginCell()
        .storeUint(JETTON_TRANSFER_OP, 32)
        .storeUint(0, 64)
        .storeCoins(params.amountAtomic)
        .storeAddress(destination)
        .storeAddress(treasury)
        .storeBit(0)
        .storeCoins(BigInt(1))
        .storeBit(0)
        .endCell()
      messages = [internal({ to: jettonWalletAddress, value: gasFee, bounce: true, body })]
    }

    const seqno = await opened.getSeqno()
    const transfer = opened.createTransfer({ seqno, secretKey: keyPair.secretKey, messages, sendMode: SendMode.PAY_GAS_SEPARATELY })
    await opened.send(transfer)

    const transactionHash = transfer.hash().toString("hex")
    const confirmed = await confirmOnChain(config, transactionHash)
    return { ok: true, transactionHash, tonviewerUrl: tonviewerTransactionUrl(transactionHash), confirmed, seqno }
  } catch (cause) {
    return { ok: false, reason: `Broadcast failed: ${cause instanceof Error ? cause.message : "unknown TON error"}` }
  }
}
