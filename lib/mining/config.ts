// Executive mining + treasury settlement constants shared by server routes and UI.
// These mirror the defaults seeded in
// supabase/migrations/20261121000000_executive_mining_treasury_split.sql.

export const USER_SHARE_BPS = 3000
export const TREASURY_SHARE_BPS = 7000
export const MINIMUM_ACCUMULATION_SECONDS = 600

export const DEFAULT_TREASURY_ADDRESS = "UQBLz9rXlNtlzVUMuUHosRBTpUWqfoXQ8WTkyAgtbSVlbnBJ"

export const ASSET_DECIMALS: Record<string, number> = { TON: 9, GRAM: 9, USDT: 6 }
export const ASSET_MINIMUMS: Record<string, string> = { TON: "1", GRAM: "10", USDT: "5" }

export function percentLabel(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`
}

export function tonviewerTransactionUrl(hash: string) {
  return `https://tonviewer.com/transaction/${encodeURIComponent(hash)}`
}

export function tonviewerAddressUrl(address: string) {
  return `https://tonviewer.com/${encodeURIComponent(address)}`
}

export function formatAtomic(value: string, decimals: number) {
  const negative = value.startsWith("-")
  const digits = (negative ? value.slice(1) : value).replace(/^\+/, "").padStart(decimals + 1, "0")
  const whole = digits.slice(0, -decimals) || "0"
  const fraction = digits.slice(-decimals).replace(/0+$/, "")
  return `${negative ? "-" : ""}${fraction ? `${whole}.${fraction}` : whole}`
}
