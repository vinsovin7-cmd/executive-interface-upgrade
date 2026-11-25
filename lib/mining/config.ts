// Executive mining + treasury settlement constants shared by server routes and UI.
// These mirror the defaults seeded in
// supabase/migrations/20261121000000_executive_mining_treasury_split.sql.

export const USER_SHARE_BPS = 3000
export const TREASURY_SHARE_BPS = 7000
export const MINIMUM_ACCUMULATION_SECONDS = 600
export const UNLOCK_THRESHOLD_SECONDS = 1500
export const AUTO_PAYOUT_INTERVAL_SECONDS = 1200 // 20-minute automatic GRAM settlement

export const DEFAULT_TREASURY_ADDRESS = "UQBLz9rXlNtlzVUMuUHosRBTpUWqfoXQ8WTkyAgtbSVlbnBJ"

// Treasury collection/refill anchor. This is the collection wallet rewards and
// gas are refilled from; it is referenced by the claim guardrails and surfaced
// in the protected admin telemetry. It is never used to sign a payout — payout
// signing stays with the configured treasury signer in lib/ton/treasury.ts.
export const TREASURY_ANCHOR_ADDRESS = "UQDrrGsThCAJrPj6QbUueKJyh8QOQrBZwHSm1C6E_UahK5Ok"

// Assets a connected Tonkeeper wallet can claim directly.
export const CLAIMABLE_ASSETS = ["GRAM", "USDT"] as const

export const CLAIM_STATES = ["pending", "confirmed", "insufficient_balance", "wallet_required", "pool_paused"] as const
export type ClaimState = (typeof CLAIM_STATES)[number]

export const CLAIM_STATE_LABELS: Record<ClaimState, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  insufficient_balance: "Insufficient balance",
  wallet_required: "Wallet required",
  pool_paused: "Pool paused",
}

export const POOL_STATES = ["active", "paused", "maintenance"] as const
export type PoolState = (typeof POOL_STATES)[number]

export const ASSET_DECIMALS: Record<string, number> = { TON: 9, GRAM: 9, USDT: 6 }
export const ASSET_MINIMUMS: Record<string, string> = { TON: "1", GRAM: "10", USDT: "5" }

export function percentLabel(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`
}

export function tonviewerTransactionUrl(hash: string) {
  return `https://tonviewer.com/transaction/${encodeURIComponent(hash)}`
}

export function tonscanTransactionUrl(hash: string) {
  return `https://tonscan.org/tx/${encodeURIComponent(hash)}`
}

export function tonviewerAddressUrl(address: string) {
  return `https://tonviewer.com/${encodeURIComponent(address)}`
}

export function formatAtomic(value: string | number | null | undefined, decimals: number) {
  const str = String(value ?? "")
  const negative = str.startsWith("-")
  const digits = (negative ? str.slice(1) : str).replace(/^\+/, "").padStart(decimals + 1, "0")
  const whole = digits.slice(0, -decimals) || "0"
  const fraction = digits.slice(-decimals).replace(/0+$/, "")
  return `${negative ? "-" : ""}${fraction ? `${whole}.${fraction}` : whole}`
}

export const GAS_ASSET_CODE = "TON"
export const JETTON_POOL_ASSETS = ["GRAM", "USDT"] as const

export type TreasuryLiquidity = {
  gasAssetCode: string
  gasBalance: string | null
  gasReady: boolean
  pools: Array<{ assetCode: string; balance: string | null; ready: boolean }>
}

export function classifyTreasuryLiquidity(status: {
  tonBalance: string | null
  gramBalance: string | null
  usdtBalance: string | null
}): TreasuryLiquidity {
  const positive = (value: string | null) => value !== null && Number(value) > 0
  return {
    gasAssetCode: GAS_ASSET_CODE,
    gasBalance: status.tonBalance,
    gasReady: positive(status.tonBalance),
    pools: JETTON_POOL_ASSETS.map((assetCode) => ({
      assetCode,
      balance: assetCode === "GRAM" ? status.gramBalance : status.usdtBalance,
      ready: positive(assetCode === "GRAM" ? status.gramBalance : status.usdtBalance),
    })),
  }
}

export function describeLiquidity(liq: TreasuryLiquidity): string {
  if (!liq.gasReady) return "Treasury gas empty"
  const readyPools = liq.pools.filter((p) => p.ready).length
  if (readyPools === liq.pools.length) return "All pools liquid"
  return `${readyPools}/${liq.pools.length} jetton pools funded`
}
