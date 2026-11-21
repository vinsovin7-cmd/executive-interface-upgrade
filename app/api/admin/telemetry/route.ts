import { NextResponse } from "next/server"

import { adminErrorResponse, requireAdminSession } from "@/lib/admin/session"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireAdminSession()
  } catch (error) {
    return adminErrorResponse(error)
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("get_admin_global_telemetry")
  if (error || !data) {
    return NextResponse.json({ error: "Global telemetry is temporarily unavailable." }, { status: 503 })
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } })
}
