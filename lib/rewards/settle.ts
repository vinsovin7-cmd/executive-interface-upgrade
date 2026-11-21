import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { executePayout } from "@/lib/ton/treasury"

export type ClaimSettlement = {
  claimId: string
  state: string
  transactionHash: string | null
  tonviewerUrl: string | null
  message: string
}

/** Normalizes a PostgREST numeric value into an atomic-unit bigint without precision loss. */
export function toAtomicBigInt(value: number | string) {
  return BigInt(String(value).split(".")[0])
}

/**
 * Executes one reserved claim payout through the real treasury signer. Settlement
 * is driven entirely by server-side validation (begin → broadcast → complete) and
 * never requires an authenticated admin browser session.
 */
export async function settleClaim(claimId: string): Promise<ClaimSettlement | null> {
  const admin = createAdminClient()

  const { data, error } = await admin.rpc("begin_claim_payout", { p_claim_id: claimId })
  if (error || !data?.[0]) return null

  const claim = data[0]
  const destination = claim.destination ?? ""
  const outcome = await executePayout({
    assetCode: claim.asset_code,
    destination,
    amountAtomic: toAtomicBigInt(claim.amount_atomic),
  })

  if (!outcome.ok) {
    // Transient/liquidity failures stay claimable so a later sweep retries them.
    await admin.rpc("fail_claim_payout", {
      p_claim_id: claimId,
      p_reason: outcome.reason,
      p_state: "pending",
    })
    return {
      claimId,
      state: "pending",
      transactionHash: null,
      tonviewerUrl: null,
      message: outcome.reason,
    }
  }

  const { error: completeError } = await admin.rpc("complete_claim_payout", {
    p_claim_id: claimId,
    p_transaction_hash: outcome.transactionHash,
  })
  if (completeError) {
    // The hash is real and already broadcast, so it is surfaced even if the
    // confirmation write failed; a retry confirms it without re-sending funds.
    return {
      claimId,
      state: "pending",
      transactionHash: outcome.transactionHash,
      tonviewerUrl: outcome.tonviewerUrl,
      message: "Payout was broadcast on-chain; confirmation record could not be written.",
    }
  }

  return {
    claimId,
    state: "confirmed",
    transactionHash: outcome.transactionHash,
    tonviewerUrl: outcome.tonviewerUrl,
    message: "Claim confirmed on-chain.",
  }
}

/** Settles the oldest pending claims. Used by the operator sweep and cron callers. */
export async function settlePendingClaims(limit = 10) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("claim_requests")
    .select("id")
    .eq("state", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error || !data) return { attempted: 0, confirmed: 0, results: [] as ClaimSettlement[] }

  const results: ClaimSettlement[] = []
  for (const row of data) {
    const settlement = await settleClaim(row.id)
    if (settlement) results.push(settlement)
  }
  return {
    attempted: data.length,
    confirmed: results.filter((result) => result.state === "confirmed").length,
    results,
  }
}
