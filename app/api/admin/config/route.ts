import { NextResponse } from "next/server"

import { AdminError, adminErrorResponse, hasSameOrigin, requireAdminSession } from "@/lib/admin/session"
import { ASSET_DECIMALS, POOL_STATES } from "@/lib/mining/config"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store" } as const

/** Converts a positive decimal string into atomic units for the given decimals. */
function toAtomicAmount(value: unknown, decimals: number, label: string) {
  if (typeof value !== "string" || value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new AdminError(`${label} must be a non-negative number.`, 400)
  }
  const [whole, fraction = ""] = value.split(".")
  if (fraction.length > decimals) throw new AdminError(`${label} supports up to ${decimals} decimal places.`, 400)
  const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "")
  if (atomic.length > 78) throw new AdminError(`${label} is above the supported limit.`, 400)
  return atomic
}

/** Live operator controls for the reward pool state, cooldown and payout caps. */
export async function PUT(request: Request) {
  try {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin admin requests are not allowed." }, { status: 403, headers: NO_STORE })
    }
    await requireAdminSession()

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) throw new AdminError("A request body is required.", 400)

    const poolState = typeof body.poolState === "string" ? body.poolState : ""
    if (!(POOL_STATES as readonly string[]).includes(poolState)) {
      throw new AdminError("Select a valid pool state (active, paused or maintenance).", 400)
    }

    const cooldownSeconds = Number(body.cooldownSeconds)
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86400) {
      throw new AdminError("Cooldown must be a whole number of seconds between 0 and 86400.", 400)
    }

    const update = {
      pool_state: poolState,
      per_user_cooldown_seconds: cooldownSeconds,
      per_user_daily_cap_gram_atomic: toAtomicAmount(body.perUserDailyCapGram, ASSET_DECIMALS.GRAM, "Per-user GRAM daily cap"),
      per_user_daily_cap_usdt_atomic: toAtomicAmount(body.perUserDailyCapUsdt, ASSET_DECIMALS.USDT, "Per-user USDT daily cap"),
      global_daily_cap_gram_atomic: toAtomicAmount(body.globalDailyCapGram, ASSET_DECIMALS.GRAM, "Global GRAM daily cap"),
      global_daily_cap_usdt_atomic: toAtomicAmount(body.globalDailyCapUsdt, ASSET_DECIMALS.USDT, "Global USDT daily cap"),
      updated_at: new Date().toISOString(),
    }

    const admin = createAdminClient()
    const { data, error } = await admin.from("claim_pool_config").update(update).eq("id", true).select("*").maybeSingle()
    if (error || !data) {
      return NextResponse.json({ error: "The reward pool configuration could not be saved." }, { status: 503, headers: NO_STORE })
    }

    return NextResponse.json(
      {
        pool: {
          poolState: data.pool_state,
          cooldownSeconds: data.per_user_cooldown_seconds,
          perUserDailyCapGramAtomic: String(data.per_user_daily_cap_gram_atomic),
          perUserDailyCapUsdtAtomic: String(data.per_user_daily_cap_usdt_atomic),
          globalDailyCapGramAtomic: String(data.global_daily_cap_gram_atomic),
          globalDailyCapUsdtAtomic: String(data.global_daily_cap_usdt_atomic),
          treasuryAnchorAddress: data.treasury_anchor_address,
          updatedAt: data.updated_at,
        },
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    return adminErrorResponse(error)
  }
}
