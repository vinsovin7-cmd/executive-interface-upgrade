import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getCachedTreasuryStatus } from "@/lib/ton/treasury"
import { MINIMUM_ACCUMULATION_SECONDS, TREASURY_SHARE_BPS, USER_SHARE_BPS } from "@/lib/mining/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: "Sign in to view your mining session." }, { status: 401 })

  const { data, error: stateError } = await supabase.rpc("get_mining_state")
  if (stateError) return NextResponse.json({ error: "Mining state could not be read." }, { status: 503 })
  const state = data?.[0]

  let treasury = null
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
      liquidityReady: status.liquidityReady,
      diagnostics: status.diagnostics,
    }
  } catch {
    treasury = null
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
