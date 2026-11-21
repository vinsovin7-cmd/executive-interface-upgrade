import { NextResponse } from "next/server"

import { CLAIMABLE_ASSETS, TREASURY_ANCHOR_ADDRESS } from "@/lib/mining/config"
import { settleClaim } from "@/lib/rewards/settle"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const IDEMPOTENCY_PATTERN = /^[0-9a-f-]{36}$/i
const NO_STORE = { "Cache-Control": "private, no-store" } as const

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

/**
 * Public earning rules plus, when authenticated, the caller's real balances and
 * verifiable claim history. Rules are always returned so standard browser
 * visitors can read the earning rules and caps without being blocked.
 */
export async function GET() {
  const admin = createAdminClient()
  const [config, assets] = await Promise.all([
    admin.from("claim_pool_config").select("*").eq("id", true).maybeSingle(),
    admin.from("ledger_asset_config").select("asset_code, decimals, minimum_withdrawal_atomic").in("asset_code", [...CLAIMABLE_ASSETS]),
  ])
  if (config.error || assets.error) {
    return NextResponse.json({ error: "Claim rules are temporarily unavailable." }, { status: 503, headers: NO_STORE })
  }

  const rules = {
    assets: (assets.data ?? []).map((asset) => ({
      assetCode: asset.asset_code,
      decimals: asset.decimals,
      minimumAtomic: String(asset.minimum_withdrawal_atomic),
    })),
    poolState: config.data?.pool_state ?? "active",
    cooldownSeconds: config.data?.per_user_cooldown_seconds ?? 300,
    perUserDailyCapGramAtomic: String(config.data?.per_user_daily_cap_gram_atomic ?? "0"),
    perUserDailyCapUsdtAtomic: String(config.data?.per_user_daily_cap_usdt_atomic ?? "0"),
    globalDailyCapGramAtomic: String(config.data?.global_daily_cap_gram_atomic ?? "0"),
    globalDailyCapUsdtAtomic: String(config.data?.global_daily_cap_usdt_atomic ?? "0"),
    treasuryAnchorAddress: config.data?.treasury_anchor_address ?? TREASURY_ANCHOR_ADDRESS,
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ authenticated: false, rules }, { headers: NO_STORE })

  const [balances, claims, wallet] = await Promise.all([
    admin.rpc("get_user_reward_balances", { p_user_id: user.id }),
    supabase
      .from("claim_requests")
      .select("id, asset_code, asset_decimals, amount_atomic, destination, state, transaction_hash, failure_reason, created_at, confirmed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("wallet_bindings").select("address, status, verified_at").eq("user_id", user.id).eq("network", "ton-mainnet").maybeSingle(),
  ])

  if (balances.error) {
    return NextResponse.json({ error: "Reward balances could not be read." }, { status: 503, headers: NO_STORE })
  }

  return NextResponse.json(
    {
      authenticated: true,
      rules,
      balances: balances.data ?? [],
      claims: claims.data ?? [],
      wallet: wallet.data ?? null,
    },
    { headers: NO_STORE },
  )
}

/**
 * Creates a claim against the user's verified ledger balance and immediately
 * attempts autonomous on-chain settlement. Every guardrail (minimum threshold,
 * cooldown, per-user and global daily caps, treasury/gas liquidity) is enforced
 * server-side by the database and the treasury signer.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin claim requests are not allowed." }, { status: 403, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to claim rewards." }, { status: 401, headers: NO_STORE })
  }

  const body = (await request.json().catch(() => null)) as { assetCode?: unknown; idempotencyKey?: unknown } | null
  const assetCode = typeof body?.assetCode === "string" ? body.assetCode : ""
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : ""
  if (!(CLAIMABLE_ASSETS as readonly string[]).includes(assetCode)) {
    return NextResponse.json({ error: "Only GRAM and USDT rewards can be claimed." }, { status: 400, headers: NO_STORE })
  }
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    return NextResponse.json({ error: "A valid idempotency key is required." }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: wallet } = await supabase
    .from("wallet_bindings")
    .select("address")
    .eq("user_id", user.id)
    .eq("network", "ton-mainnet")
    .eq("status", "verified")
    .maybeSingle()
  const destination = wallet?.address ?? null

  const { data, error } = await admin.rpc("create_claim_request", {
    p_user_id: user.id,
    p_asset_code: assetCode,
    p_destination: destination,
    p_idempotency_key: idempotencyKey,
  })
  if (error) {
    // Guardrail violations (cooldown, daily caps, unsupported asset) are raised
    // as SQLSTATE 22023 with an explicit, user-facing message.
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE })
    }
    return NextResponse.json({ error: "The claim could not be created." }, { status: 503, headers: NO_STORE })
  }

  const claim = data?.[0]
  if (!claim) {
    return NextResponse.json({ error: "The claim could not be created." }, { status: 503, headers: NO_STORE })
  }

  if (claim.state !== "pending") {
    return NextResponse.json(
      { claim, settled: null, message: claim.failure_reason ?? "This claim is not payable right now." },
      { headers: NO_STORE },
    )
  }

  const settlement = await settleClaim(claim.claim_id)
  return NextResponse.json(
    {
      claim: {
        ...claim,
        state: settlement?.state ?? claim.state,
        transaction_hash: settlement?.transactionHash ?? null,
      },
      settled: settlement,
      message: settlement?.message ?? "Claim submitted.",
    },
    { headers: NO_STORE },
  )
}
