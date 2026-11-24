import { Address } from "@ton/core"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { MINIMUM_ACCUMULATION_SECONDS, TREASURY_SHARE_BPS, USER_SHARE_BPS } from "@/lib/mining/config"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CAMPAIGNS = new Set(["cybernode-mainnet"])
const QUESTS = new Set(["verify-email", "link-telegram", "connect-wallet"])
const ASSETS = { TON: 9, GRAM: 9, USDT: 6 } as const

type AssetCode = keyof typeof ASSETS

type ActionBody =
  | { action: "bind-wallet"; address: string }
  | { action: "airdrop"; campaignKey: string }
  | { action: "quest"; questKey: string }
  | { action: "withdrawal"; assetCode: AssetCode; amount: string; destination: string; idempotencyKey: string }

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

function parseTonAddress(value: unknown) {
  if (typeof value !== "string" || value.length < 20 || value.length > 128) throw new Error("Enter a valid TON wallet address.")
  try {
    return Address.parse(value).toString({ bounceable: false, testOnly: false })
  } catch {
    throw new Error("Enter a valid TON wallet address.")
  }
}

function toAtomicAmount(value: unknown, decimals: number) {
  if (typeof value !== "string" || value.length > 80 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a positive amount using digits and an optional decimal point.")
  const [whole, fraction = ""] = value.split(".")
  if (fraction.length > decimals) throw new Error(`This asset supports up to ${decimals} decimal places.`)
  const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "")
  if (!/[1-9]/.test(atomic) || atomic.length > 78) throw new Error("Enter a positive amount within the supported limit.")
  return atomic
}

async function getUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { user: null, supabase }
  return { user, supabase }
}

export async function GET() {
  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: "Sign in to view your value activity." }, { status: 401 })

  const admin = createAdminClient()
  const { error: referralInitError } = await admin.from("referral_stats").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true })
  if (referralInitError) return NextResponse.json({ error: "Referral status could not be initialized." }, { status: 503 })

  const [wallet, airdrops, quests, withdrawals, referral, rewardBalances, miningState] = await Promise.all([
    supabase.from("wallet_bindings").select("id, network, address, status, created_at, verified_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("airdrop_claims").select("id, campaign_key, status, created_at, verified_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("quest_completions").select("id, quest_key, status, created_at, verified_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("withdrawal_requests").select("id, network, asset_code, asset_decimals, amount_atomic, destination, status, created_at, updated_at, transaction_hash, failure_reason").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("referral_stats").select("referral_code, tier1_count, tier2_count, tier1_commission_atomic, tier2_commission_atomic").eq("user_id", user.id).maybeSingle(),
    admin.rpc("get_user_reward_balances", { p_user_id: user.id }),
    supabase.rpc("get_mining_state"),
  ])
  if (wallet.error || airdrops.error || quests.error || withdrawals.error || referral.error || rewardBalances.error) {
    return NextResponse.json({ error: "Your value activity could not be loaded." }, { status: 503 })
  }
  const state = miningState.data?.[0]

  return NextResponse.json({
    wallet: wallet.data,
    airdrops: airdrops.data,
    quests: quests.data,
    withdrawals: withdrawals.data,
    balances: rewardBalances.data.map((balance) => ({
      asset_code: balance.asset_code,
      available_atomic: String(balance.available_atomic),
      earned_today_atomic: String(balance.earned_today_atomic),
      daily_cap_atomic: String(balance.daily_cap_atomic),
      minimum_withdrawal_atomic: String(balance.minimum_withdrawal_atomic),
    })),
    referral: referral.data,
    mining: {
      status: state?.status ?? "inactive",
      walletAddress: state?.wallet_address ?? null,
      startedAt: state?.started_at ?? null,
      unlockAt: state?.unlock_at ?? null,
      secondsRemaining: state?.seconds_remaining ?? MINIMUM_ACCUMULATION_SECONDS,
      withdrawalLocked: state?.withdrawal_locked ?? true,
      minimumAccumulationSeconds: state?.minimum_accumulation_seconds ?? MINIMUM_ACCUMULATION_SECONDS,
    },
    split: { userShareBps: USER_SHARE_BPS, treasuryShareBps: TREASURY_SHARE_BPS },
  }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 10_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 })

  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: "Sign in before submitting this request." }, { status: 401 })
  if (!user.email_confirmed_at) return NextResponse.json({ error: "Verify your email before submitting a value-related request." }, { status: 403 })

  let body: ActionBody
  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > 10_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 })
    const parsed: unknown = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
    body = parsed as ActionBody
  } catch {
    return NextResponse.json({ error: "Request body is invalid." }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const recentCutoff = new Date(Date.now() - 60_000).toISOString()
    const [recentAirdrops, recentQuests, recentWithdrawals] = await Promise.all([
      admin.from("airdrop_claims").select("id").eq("user_id", user.id).gte("created_at", recentCutoff).limit(10),
      admin.from("quest_completions").select("id").eq("user_id", user.id).gte("created_at", recentCutoff).limit(10),
      admin.from("withdrawal_requests").select("id").eq("user_id", user.id).gte("created_at", recentCutoff).limit(5),
    ])
    if (recentAirdrops.error || recentQuests.error || recentWithdrawals.error) throw new Error("Request could not be checked.")
    if ((recentAirdrops.data?.length ?? 0) >= 10 || (recentQuests.data?.length ?? 0) >= 10 || (recentWithdrawals.data?.length ?? 0) >= 5) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 })
    }

    if (body.action === "bind-wallet") {
      const address = parseTonAddress(body.address)
      const { data: mining, error: bindError } = await supabase.rpc("activate_wallet_mining", { p_address: address })
      if (bindError) throw bindError
      const state = mining?.[0]
      if (!state) throw new Error("Mining session could not be activated.")
      return NextResponse.json({
        ok: true,
        status: "verified",
        mining: {
          status: state.status,
          walletAddress: state.wallet_address,
          startedAt: state.started_at,
          unlockAt: state.unlock_at,
          secondsRemaining: state.seconds_remaining,
          withdrawalLocked: state.withdrawal_locked,
          minimumAccumulationSeconds: state.minimum_accumulation_seconds,
        },
        message: "Wallet bound to your account. Mining is active; withdrawals unlock after 600 seconds of accumulation.",
      }, { status: 201 })
    }

    if (body.action === "airdrop") {
      if (typeof body.campaignKey !== "string" || !CAMPAIGNS.has(body.campaignKey)) return NextResponse.json({ error: "This campaign is not available." }, { status: 400 })
      const { error } = await admin.from("airdrop_claims").insert({ user_id: user.id, campaign_key: body.campaignKey, status: "pending" })
      if (error?.code === "23505") return NextResponse.json({ error: "A claim for this campaign has already been submitted." }, { status: 409 })
      if (error) throw error
      return NextResponse.json({ ok: true, status: "pending", message: "Eligibility submitted for review. No token amount is promised." }, { status: 201 })
    }

    if (body.action === "quest") {
      if (typeof body.questKey !== "string" || !QUESTS.has(body.questKey)) return NextResponse.json({ error: "This quest is not available." }, { status: 400 })
      const { error } = await admin.from("quest_completions").insert({ user_id: user.id, quest_key: body.questKey, status: "pending" })
      if (error?.code === "23505") return NextResponse.json({ error: "This quest has already been submitted." }, { status: 409 })
      if (error) throw error
      return NextResponse.json({ ok: true, status: "pending", message: "Quest submitted for review." }, { status: 201 })
    }

    if (body.action === "withdrawal") {
      if (!Object.hasOwn(ASSETS, body.assetCode) || typeof body.destination !== "string" || typeof body.idempotencyKey !== "string" || !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)) {
        return NextResponse.json({ error: "Withdrawal details are invalid." }, { status: 400 })
      }
      const decimals = ASSETS[body.assetCode]
      const amountAtomic = toAtomicAmount(body.amount, decimals)
      const destination = parseTonAddress(body.destination)
      const { data, error } = await admin.rpc("queue_withdrawal_request", {
        p_user_id: user.id,
        p_asset_code: body.assetCode,
        p_amount_atomic: amountAtomic,
        p_destination: destination,
        p_idempotency_key: body.idempotencyKey,
      })
      if (error) {
        if (error.code === "22023") {
          const conflict = error.message.includes("Insufficient verified available balance") || error.message.includes("unlocks after")
          return NextResponse.json({ error: error.message }, { status: conflict ? 409 : 400 })
        }
        throw error
      }
      const queued = data?.[0]
      if (!queued) throw new Error("Withdrawal request was not queued.")
      return NextResponse.json({ ok: true, request: queued, message: "Withdrawal queued against your verified 30% share. Confirm the on-chain payout to broadcast the real TON / GRAM transfer to your bound wallet." }, { status: 201 })
    }

    return NextResponse.json({ error: "This request type is not supported." }, { status: 400 })
  } catch (error) {
    const invalidInput = error instanceof Error && (
      error.message === "Enter a valid TON wallet address."
      || (typeof error.message === "string" && error.message.startsWith("Enter a positive amount"))
      || (typeof error.message === "string" && error.message.startsWith("This asset supports"))
    )
    // Surface the real cause (insufficient balance, unlock not reached, missing
    // treasury/signer configuration, RPC error) instead of a dead-end generic
    // message, while falling back to a safe default when no detail is available.
    const detail =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : null
    const message = detail && detail.trim() ? detail : "Your request could not be saved. Please try again."
    return NextResponse.json({ error: message }, { status: invalidInput ? 400 : 503 })
  }
}
