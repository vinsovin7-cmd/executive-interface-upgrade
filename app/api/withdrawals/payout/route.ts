import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { executePayout } from "@/lib/ton/treasury"

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
  if (authError || !user) return NextResponse.json({ error: "Sign in before withdrawing." }, { status: 401 })

  let requestId: string
  try {
    const body = (await request.json()) as { requestId?: unknown }
    if (typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new Error()
    requestId = body.requestId
  } catch {
    return NextResponse.json({ error: "A valid withdrawal request id is required." }, { status: 400 })
  }

  // RLS scopes this read to the signed-in owner, so no service role is needed here.
  const { data: owned, error: ownedError } = await supabase
    .from("withdrawal_requests")
    .select("id, asset_code, amount_atomic, destination, status, transaction_hash")
    .eq("id", requestId)
    .maybeSingle()
  if (ownedError) return NextResponse.json({ error: "The withdrawal request could not be read." }, { status: 503 })
  if (!owned) return NextResponse.json({ error: "Withdrawal request not found for this account." }, { status: 404 })
  if (owned.transaction_hash) {
    return NextResponse.json({ error: "This withdrawal already has an on-chain transaction.", transactionHash: owned.transaction_hash }, { status: 409 })
  }

  const admin = createAdminClient()

  const { data: begun, error: beginError } = await admin.rpc("begin_withdrawal_payout", { p_request_id: requestId })
  if (beginError) {
    const message = beginError.code === "22023" ? beginError.message : "The withdrawal is not in a payable state."
    return NextResponse.json({ error: message }, { status: 409 })
  }
  const payout = begun?.[0]
  if (!payout) return NextResponse.json({ error: "The withdrawal could not be marked for payout." }, { status: 503 })

  const outcome = await executePayout({
    assetCode: payout.asset_code,
    destination: payout.destination,
    amountAtomic: toAtomicBigInt(payout.amount_atomic),
  })

  if (!outcome.ok) {
    await admin.rpc("fail_withdrawal_payout", { p_request_id: requestId, p_reason: outcome.reason })
    return NextResponse.json({ error: outcome.reason, retryable: true }, { status: 502 })
  }

  const { error: completeError } = await admin.rpc("complete_withdrawal_payout", {
    p_request_id: requestId,
    p_transaction_hash: outcome.transactionHash,
  })
  if (completeError) {
    // The transaction is already broadcast; surface the hash so it is never lost.
    return NextResponse.json({
      error: "The transfer was broadcast but the ledger could not be finalized. Contact support with this hash.",
      transactionHash: outcome.transactionHash,
      tonviewerUrl: outcome.tonviewerUrl,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    requestId,
    assetCode: payout.asset_code,
    amountAtomic: String(payout.amount_atomic),
    transactionHash: outcome.transactionHash,
    tonviewerUrl: outcome.tonviewerUrl,
    confirmed: outcome.confirmed,
    message: outcome.confirmed
      ? "On-chain payout confirmed on TON Mainnet."
      : "On-chain payout broadcast on TON Mainnet. Tonviewer confirmation is still indexing; open the link to verify.",
  }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
}
