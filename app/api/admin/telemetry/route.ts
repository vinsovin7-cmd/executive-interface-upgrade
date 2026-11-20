import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  if (user.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 })
  }

  const { data, error } = await supabase.rpc("get_admin_global_telemetry")
  if (error || !data) {
    return NextResponse.json({ error: "Global telemetry is temporarily unavailable." }, { status: 503 })
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } })
}
