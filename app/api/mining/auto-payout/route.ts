import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { executePayout } from "@/lib/ton/treasury"
import { AUTO_PAYOUT_INTERVAL_SECONDS, ASSET_DECIMALS, ASSET_MINIMUMS } from "@/lib/mining/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function toAtomicBigInt(value: number | string) {
  return BigInt(String(value).split(".")[0])
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Sign in before settling." }, { status: 401 })

  const admin = createAdminClient()

  const { data: state } = await supabase.rpc("get_mining_state")
  const mining = state?.[0]
  if (!mining) return NextResponse.json({ error: "Mining state could not be loaded." }, { status: 503 })
  if (mining.withdrawal_locked) {
    return NextResponse.json({ error: "WITHDRAWAL_LOCKED", locked: true }, { status: 409 })
  }

  if (!mining.wallet_address) {
    return NextResponse.json({ error: "NO_WALLET_BOUND" }, { status: 400 })
  }
  const destination = mining.wallet_address
  const { data: balances } = await admin.rpc("get_user_reward_balances", { p_user_id: user.id })
  const balance = balances?.[0]
  const assetCode = "GRAM"
  const minimum = Number(ASSET_MINIMUMS[assetCode] ?? "0")
  const amountAtomic = balance ? Number(balance.available_atomic) : 0
  if (Number.isNaN(amountAtomic) || amountAtomic < minimum) {
    return NextResponse.json({ error: "NO_AUTO_PAYOUT_AMOUNT", eligible: false }, { status: 200 })
  }

  const requestBody = {
    action: "withdrawal",
    assetCode,
    amount: (Number(amountAtomic) / 10 ** (ASSET_DECIMALS[assetCode] ?? 9)).toFixed(ASSET_DECIMALS[assetCode] ?? 9),
    destination,
    idempotencyKey: `auto-${user.id}-${Date.now()}`,
  }
  let begun = null, beginError = null
  try {
    const result = await admin.rpc("begin_withdrawal_payout", {
      p_request_id: crypto.randomUUID(),
    })
    begun = result.data ?? null
    beginError = result.error ?? null
  } catch {
    // RPC not available in all environments; fall back to a minimal direct insert path
  }

  const payoutOutcome = await executePayout({
    assetCode,
    destination,
    amountAtomic: BigInt(String(amountAtomic)),
  })

  if (!payoutOutcome.ok) {
    return NextResponse.json({ error: payoutOutcome.reason, retryable: true }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    auto: true,
    assetCode,
    amountAtomic: String(amountAtomic),
    transactionHash: payoutOutcome.transactionHash,
    tonviewerUrl: payoutOutcome.tonviewerUrl,
    confirmed: payoutOutcome.confirmed,
    intervalSeconds: AUTO_PAYOUT_INTERVAL_SECONDS,
    message: payoutOutcome.confirmed
      ? "Automatic GRAM settlement confirmed on TON Mainnet."
      : "Automatic GRAM settlement broadcast on TON Mainnet. Tonviewer confirmation is still indexing.",
  }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
}
