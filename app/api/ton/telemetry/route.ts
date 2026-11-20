import { NextResponse } from "next/server"

const TONCENTER_BASE_URL = "https://toncenter.com/api/v3"
const FRIENDLY_MAINNET_ADDRESS = /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/

export const dynamic = "force-dynamic"

type AddressBookEntry = { user_friendly?: string }
type AddressBook = Record<string, AddressBookEntry>

type MasterchainInfo = {
  last?: { seqno?: number; gen_utime?: number }
}

type WalletState = { address: string; balance: string; status?: string }
type WalletStatesResponse = { wallets?: WalletState[]; address_book?: AddressBook }

type JettonMaster = { address: string; jetton_content?: { name?: string; symbol?: string } }
type JettonMetadata = {
  token_info?: Array<{
    name?: string
    symbol?: string
    extra?: Record<string, string>
  }>
}
type JettonMasterResponse = {
  jetton_masters?: JettonMaster[]
  address_book?: AddressBook
  metadata?: Record<string, JettonMetadata>
}
type JettonWalletsResponse = { jetton_wallets?: Array<{ balance?: string }> }
type IndexedMessage = { source?: string; destination?: string; value?: string }
type IndexedTransaction = { hash: string; now?: number; in_msg?: IndexedMessage; out_msgs?: IndexedMessage[] }
type TransactionsResponse = { transactions?: IndexedTransaction[] }

async function toncenterFetch<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${TONCENTER_BASE_URL}${path}`, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
    next: { revalidate: 15 },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) throw new Error(`Toncenter returned ${response.status}`)
  return (await response.json()) as T
}

function formatUnits(raw: string | undefined, decimals: number): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  if (decimals === 0) return BigInt(raw).toString()
  const value = BigInt(raw).toString().padStart(decimals + 1, "0")
  const whole = value.slice(0, -decimals) || "0"
  const fraction = value.slice(-decimals).replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole
}

function findBalanceAddress(
  response: WalletStatesResponse,
  requestedAddress: string,
): WalletState | undefined {
  return response.wallets?.find((wallet) => {
    if (wallet.address.toLowerCase() === requestedAddress.toLowerCase()) return true
    const friendlyAddress = Object.entries(response.address_book ?? {}).find(
      ([rawAddress]) => rawAddress.toLowerCase() === wallet.address.toLowerCase(),
    )?.[1]?.user_friendly
    return friendlyAddress === requestedAddress
  })
}

async function getJettonBalance(ownerAddress: string, apiKey: string, decimals: number, masterAddress: string) {
  const params = new URLSearchParams({
    owner_address: ownerAddress,
    jetton_address: masterAddress,
    limit: "1",
  })
  const result = await toncenterFetch<JettonWalletsResponse>(`/jetton/wallets?${params}`, apiKey)
  const rawBalance = result.jetton_wallets?.[0]?.balance ?? "0"
  return formatUnits(rawBalance, decimals)
}

export async function GET(request: Request) {
  const apiKey = process.env.TONCENTER_API_KEY
  const treasuryAddress = process.env.MASTER_TREASURY_ADDRESS
  const gramMasterAddress = process.env.GRAM_TOKEN_MASTER_ADDRESS
  const walletAddress = new URL(request.url).searchParams.get("wallet")

  if (!apiKey || !treasuryAddress || !FRIENDLY_MAINNET_ADDRESS.test(treasuryAddress) || !gramMasterAddress || !FRIENDLY_MAINNET_ADDRESS.test(gramMasterAddress)) {
    return NextResponse.json({ error: "Mainnet telemetry is not configured." }, { status: 503 })
  }

  if (walletAddress && !FRIENDLY_MAINNET_ADDRESS.test(walletAddress)) {
    return NextResponse.json({ error: "Connect a TON Mainnet wallet to query its balance." }, { status: 400 })
  }

  try {
    const addresses = [...new Set([treasuryAddress, ...(walletAddress ? [walletAddress] : [])])]
    const walletParams = new URLSearchParams()
    for (const address of addresses) walletParams.append("address", address)

    const transactionAddresses = [...new Set([treasuryAddress, ...(walletAddress ? [walletAddress] : [])])]
    const transactionRequests = transactionAddresses.map(async (address) => {
      try {
        const params = new URLSearchParams({ account: address, limit: "8", sort: "desc" })
        const response = await toncenterFetch<TransactionsResponse>(`/transactions?${params}`, apiKey)
        return { address, transactions: (response.transactions ?? []).map((transaction) => ({
          hash: transaction.hash,
          timestamp: transaction.now ? new Date(transaction.now * 1000).toISOString() : null,
          incoming: transaction.in_msg ? {
            source: transaction.in_msg.source ?? null,
            destination: transaction.in_msg.destination ?? null,
            valueNano: transaction.in_msg.value ?? null,
          } : null,
          outgoing: (transaction.out_msgs ?? []).map((message) => ({
            source: message.source ?? null,
            destination: message.destination ?? null,
            valueNano: message.value ?? null,
          })),
        })) }
      } catch {
        return { address, transactions: [] }
      }
    })

    const [masterchain, walletStates, masterResponse, transactionFeeds] = await Promise.all([
      toncenterFetch<MasterchainInfo>("/masterchainInfo", apiKey),
      toncenterFetch<WalletStatesResponse>(`/walletStates?${walletParams}`, apiKey),
      toncenterFetch<JettonMasterResponse>(
        `/jetton/masters?${new URLSearchParams({ address: gramMasterAddress, limit: "1" })}`,
        apiKey,
      ),
      Promise.all(transactionRequests),
    ])

    const indexedMaster = masterResponse.jetton_masters?.[0]
    const indexedMasterAddress = indexedMaster
      ? Object.entries(masterResponse.address_book ?? {}).find(
          ([rawAddress]) => rawAddress.toLowerCase() === indexedMaster.address.toLowerCase(),
        )?.[1]?.user_friendly
      : null
    if (!indexedMaster || indexedMasterAddress !== gramMasterAddress) {
      throw new Error("The supplied jetton master is not indexed at the expected address.")
    }

    const metadata = Object.entries(masterResponse.metadata ?? {}).find(
      ([rawAddress]) => rawAddress.toLowerCase() === indexedMaster.address.toLowerCase(),
    )?.[1]?.token_info?.[0]
    const decimals = Number.parseInt(metadata?.extra?.decimals ?? "", 10)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error("The indexed jetton decimals are unavailable.")
    }

    const [treasuryJettonBalance, connectedWalletJettonBalance] = await Promise.all([
      getJettonBalance(treasuryAddress, apiKey, decimals, gramMasterAddress),
      walletAddress ? getJettonBalance(walletAddress, apiKey, decimals, gramMasterAddress) : Promise.resolve(null),
    ])

    const lastBlock = masterchain.last
    if (!lastBlock?.seqno || !lastBlock.gen_utime) throw new Error("Masterchain data is unavailable.")

    const generatedAt = new Date(lastBlock.gen_utime * 1000).toISOString()
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000 - lastBlock.gen_utime))
    const treasuryWallet = findBalanceAddress(walletStates, treasuryAddress)
    const connectedWallet = walletAddress ? findBalanceAddress(walletStates, walletAddress) : null

    return NextResponse.json({
      source: "Toncenter API v3 · Mainnet",
      asOf: new Date().toISOString(),
      block: { seqno: lastBlock.seqno, generatedAt, ageSeconds },
      token: {
        masterAddress: gramMasterAddress,
        name: metadata?.name ?? indexedMaster.jetton_content?.name ?? "GRAM jetton",
        symbol: metadata?.symbol ?? indexedMaster.jetton_content?.symbol ?? "GRAM",
        legacySymbol: indexedMaster.jetton_content?.symbol ?? null,
        decimals,
        indexed: true,
      },
      treasury: {
        address: treasuryAddress,
        tonBalance: formatUnits(treasuryWallet?.balance ?? "0", 9),
        jettonBalance: treasuryJettonBalance,
      },
      connectedWallet: walletAddress
        ? {
            address: walletAddress,
            tonBalance: formatUnits(connectedWallet?.balance ?? "0", 9),
            jettonBalance: connectedWalletJettonBalance,
          }
        : null,
      transactions: transactionFeeds.flatMap((feed) => feed.transactions.map((transaction) => ({
        ...transaction,
        account: feed.address,
      }))).sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? "")).slice(0, 12),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Live TON telemetry is temporarily unavailable." }, { status: 502 })
  }
}
