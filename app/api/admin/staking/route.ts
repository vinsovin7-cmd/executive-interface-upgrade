import { NextResponse } from "next/server"

import { adminErrorResponse, requireAdminSession } from "@/lib/admin/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { GAS_ASSET_CODE, JETTON_POOL_ASSETS, classifyTreasuryLiquidity, describeLiquidity, tonviewerTransactionUrl, tonviewerAddressUrl } from "@/lib/mining/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdminSession()
    const admin = createAdminClient()

    // List staking engines (only id=1 row, but we allow up to 5 named rows; here we just read all)
    const { data, error } = await admin.from("staking_engines").select("*").order("id", { ascending: true })

    if (error) throw error

    // Also compute liquidity summary using classifyTreasuryLiquidity from treasury status
    // We'll just return the engines with a note that liquidity status is derived from treasury
    return NextResponse.json({
      asOf: new Date().toISOString(),
      engines: data,
      liquidity: describeLiquidity(
        classifyTreasuryLiquidity({
          tonBalance: "6.890425928", // placeholder; in real code fetch from treasury
          gramBalance: null, // placeholder
          usdtBalance: null,
        })
      ),
      // Tonviewer helpers format
      tonviewerTransactionUrl,
      tonviewerAddressUrl,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminSession()
    const admin = createAdminClient()
    const body = await request.json()

    const { name, asset_code, pool_status, funded_liquidity_atomic, active_staked_principal_atomic, base_apr_bps, max_boost_multiplier_bps, lockup_seconds, deposit_wallet_address } = body

    // Basic validation
    if (!name || !asset_code || !["GRAM", "USDT"].includes(asset_code)) {
      return NextResponse.json({ error: "Invalid engine data" }, { status: 400 })
    }

    const { error } = await admin.from("staking_engines").insert({
      name,
      asset_code,
      pool_status: pool_status ?? "active",
      funded_liquidity_atomic: funded_liquidity_atomic ?? 0,
      active_staked_principal_atomic: active_staked_principal_atomic ?? 0,
      base_apr_bps: base_apr_bps ?? 500,
      max_boost_multiplier_bps: max_boost_multiplier_bps ?? 120000,
      lockup_seconds: lockup_seconds ?? 0,
      deposit_wallet_address: deposit_wallet_address ?? "UQDrrGsThCAJrPj6QbUueKJyh8QOQrBZwHSm1C6E_UahK5Ok",
    }).select()

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    await requireAdminSession()
    const admin = createAdminClient()
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "Engine id required" }, { status: 400 })
    }

    const { error } = await admin.from("staking_engines").update(updates).eq("id", id).select()

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return adminErrorResponse(error)
  }
}