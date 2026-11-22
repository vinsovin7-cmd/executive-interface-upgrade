import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getCachedTreasuryStatus } from "@/lib/ton/treasury"
import { MINIMUM_ACCUMULATION_SECONDS, TREASURY_SHARE_BPS, USER_SHARE_BPS } from "@/lib/mining/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TreasuryStatusPayload = {
  configured: boolean
  treasuryAddress: string | null
  signerAddress: string | null
  addressMatchesTreasury: boolean
  tonBalance: string | null
  gramBalance: string | null
  gramMasterAddress: string | null
  usdtBalance: string | null
  usdtMasterAddress: string | null
  liquidityReady: boolean
  diagnostics: string[]
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: "Sign in to view your mining session." }, { status: 401 })

  const { data, error: stateError } = await supabase.rpc("get_mining_state")
  if (stateError) return NextResponse.json({ error: "Mining state could not be read." }, { status: 503 })
  const state = data?.[0]

  let treasury: TreasuryStatusPayload | null = null
  try {
    const status = await getCachedTreasuryStatus()
    treasury = {
      configured: status.configured,
      treasuryAddress: status.treasuryAddress,
      signerAddress: status.signerAddress,
      addressMatchesTreasury: status.addressMatchesTreasury,
      tonBalance: status.tonBalance,
      gramBalance: status.gramBalance,
      gramMasterAddress: status.gramMasterAddress,
      usdtBalance: status.usdtBalance,
      usdtMasterAddress: status.usdtMasterAddress,
      liquidityReady: status.liquidityReady,
      diagnostics: status.diagnostics,
    }
  } catch (cause) {
    treasury = {
      configured: false,
      treasuryAddress: null,
      signerAddress: null,
      addressMatchesTreasury: false,
      tonBalance: null,
      gramBalance: null,
      gramMasterAddress: null,
      usdtBalance: null,
      usdtMasterAddress: null,
      liquidityReady: false,
      diagnostics: [
        cause instanceof Error
          ? `Treasury status could not be read: ${cause.message}`
          : "Treasury status could not be read. Check the server-side treasury configuration.",
      ],
    }
  }

  return NextResponse.json({
    mining: {
      status: state?.status ?? "inactive",
      walletAddress: state?.wallet_address ?? null,
      startedAt: state?.started_at ?? null,
      unlockAt: state?.unlock_at ?? null,
      secondsRemaining: state?.seconds_remaining ?? MINIMUM_ACCUMULATION_SECONDS,
      withdrawalLocked: state?.withdrawal_locked ?? true,
      minimumAccumulationSeconds: state?.minimum_accumulation_seconds ?? MINIMUM_ACCUMULATION_SECONDS,
    },
    split: {
      userShareBps: USER_SHARE_BPS,
      treasuryShareBps: TREASURY_SHARE_BPS,
      minimumAccumulationSeconds: MINIMUM_ACCUMULATION_SECONDS,
    },
    treasury,
    asOf: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } })
}
