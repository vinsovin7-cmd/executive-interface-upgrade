import { Address } from "@ton/core"
import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { MINIMUM_ACCUMULATION_SECONDS } from "@/lib/mining/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: "Sign in before binding a wallet." }, { status: 401 })

  let address: string
  try {
    const body = (await request.json()) as { address?: unknown }
    address = parseTonAddress(body.address)
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Wallet address is invalid." }, { status: 400 })
  }

  const { data, error: bindError } = await supabase.rpc("activate_wallet_mining", { p_address: address })
  if (bindError) {
    return NextResponse.json({ error: "The wallet could not be bound to your mining session." }, { status: 503 })
  }
  const state = data?.[0]
  if (!state) return NextResponse.json({ error: "The mining session could not be activated." }, { status: 503 })

  return NextResponse.json({
    ok: true,
    mining: {
      status: state.status,
      walletAddress: state.wallet_address,
      startedAt: state.started_at,
      unlockAt: state.unlock_at,
      secondsRemaining: state.seconds_remaining,
      withdrawalLocked: state.withdrawal_locked,
      minimumAccumulationSeconds: state.minimum_accumulation_seconds ?? MINIMUM_ACCUMULATION_SECONDS,
    },
    message: "Wallet bound to your account. Real-time mining session is active; withdrawals unlock after 600 seconds of accumulation.",
  }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
}
