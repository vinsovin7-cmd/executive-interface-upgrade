import { NextResponse } from "next/server"

import { adminErrorResponse, requireAdminSession } from "@/lib/admin/session"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdminSession()
    const admin = createAdminClient()

    // Use RPC to list earn increasers (returns JSONB array)
    const { data, error } = await admin.rpc("list_earn_increasers")

    if (error) throw error

    return NextResponse.json({
      asOf: new Date().toISOString(),
      increasers: data ?? [],
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

    const { key, name, description, category, enabled, multiplier_bps, cap_atomic, sort_order } = body

    if (!key || !name || !category) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { error } = await admin.from("earn_increasers").insert({
      key,
      name,
      description,
      category,
      enabled: enabled ?? true,
      multiplier_bps: multiplier_bps ?? 0,
      cap_atomic: cap_atomic ?? 0,
      sort_order: sort_order ?? 0,
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
    const { key, ...updates } = body

    if (!key) {
      return NextResponse.json({ error: "Increaser key required" }, { status: 400 })
    }

    const { error } = await admin.from("earn_increasers").update(updates).eq("key", key).select()

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return adminErrorResponse(error)
  }
}