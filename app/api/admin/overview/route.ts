import { NextResponse } from "next/server"

import { adminErrorResponse, requireAdminSession } from "@/lib/admin/session"
import { TREASURY_ANCHOR_ADDRESS } from "@/lib/mining/config"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCachedTreasuryStatus } from "@/lib/ton/treasury"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Operator telemetry: live treasury balances, the collection/refill anchor,
 * pool controls, real claim + payout logs, user wallet bindings and the
 * aggregated global telemetry. Gated by the signed admin session cookie.
 */
export async function GET() {
  try {
    await requireAdminSession()
    const admin = createAdminClient()

    const [config, claims, wallets, pending, confirmed, blocked, telemetry, profiles] = await Promise.all([
      admin.from("claim_pool_config").select("*").eq("id", true).maybeSingle(),
      admin
        .from("claim_requests")
        .select("id, user_id, asset_code, asset_decimals, amount_atomic, destination, state, transaction_hash, failure_reason, created_at, confirmed_at")
        .order("created_at", { ascending: false })
        .limit(40),
      admin
        .from("wallet_bindings")
        .select("user_id, address, status, verified_at, created_at")
        .order("created_at", { ascending: false })
        .limit(40),
      admin.from("claim_requests").select("id", { count: "exact", head: true }).eq("state", "pending"),
      admin.from("claim_requests").select("id", { count: "exact", head: true }).eq("state", "confirmed"),
      admin.from("claim_requests").select("id", { count: "exact", head: true }).in("state", ["insufficient_balance", "wallet_required", "pool_paused"]),
      admin.rpc("get_admin_global_telemetry"),
      admin.from("profiles").select("id, display_name, email"),
    ])

    if (config.error) {
      return NextResponse.json({ error: "Reward pool configuration could not be read." }, { status: 503, headers: { "Cache-Control": "no-store" } })
    }

    let treasury = null
    try {
      const status = await getCachedTreasuryStatus()
      treasury = { ...status, anchorAddress: config.data?.treasury_anchor_address ?? TREASURY_ANCHOR_ADDRESS }
    } catch {
      treasury = null
    }

    const profileMap = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]))
    const claimRows = (claims.data ?? []).map((claim) => ({
      ...claim,
      owner: profileMap.get(claim.user_id)?.display_name ?? profileMap.get(claim.user_id)?.email ?? claim.user_id.slice(0, 8),
    }))
    const walletRows = (wallets.data ?? []).map((wallet) => ({
      ...wallet,
      owner: profileMap.get(wallet.user_id)?.display_name ?? profileMap.get(wallet.user_id)?.email ?? wallet.user_id.slice(0, 8),
    }))

    return NextResponse.json(
      {
        asOf: new Date().toISOString(),
        pool: {
          poolState: config.data?.pool_state ?? "active",
          cooldownSeconds: config.data?.per_user_cooldown_seconds ?? 300,
          perUserDailyCapGramAtomic: String(config.data?.per_user_daily_cap_gram_atomic ?? "0"),
          perUserDailyCapUsdtAtomic: String(config.data?.per_user_daily_cap_usdt_atomic ?? "0"),
          globalDailyCapGramAtomic: String(config.data?.global_daily_cap_gram_atomic ?? "0"),
          globalDailyCapUsdtAtomic: String(config.data?.global_daily_cap_usdt_atomic ?? "0"),
          treasuryAnchorAddress: config.data?.treasury_anchor_address ?? TREASURY_ANCHOR_ADDRESS,
          updatedAt: config.data?.updated_at ?? null,
        },
        treasury,
        claims: claimRows,
        wallets: walletRows,
        summary: {
          pendingClaims: pending.count ?? 0,
          confirmedClaims: confirmed.count ?? 0,
          blockedClaims: blocked.count ?? 0,
        },
        telemetry: telemetry.data ?? null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return adminErrorResponse(error)
  }
}
