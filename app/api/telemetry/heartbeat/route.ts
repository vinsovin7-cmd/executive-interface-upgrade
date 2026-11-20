import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!origin || !host) return false

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user: error ? null : user }
}

export async function GET() {
  const { supabase, user } = await getAuthenticatedClient()
  if (!user) return NextResponse.json({ error: "Sign in to view your activity heartbeat." }, { status: 401 })

  const { data, error } = await supabase
    .from("device_heartbeats")
    .select("last_seen_at")
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Activity heartbeat is temporarily unavailable." }, { status: 503 })
  return NextResponse.json({ lastSeenAt: data?.last_seen_at ?? null }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  }

  const { supabase, user } = await getAuthenticatedClient()
  if (!user) return NextResponse.json({ error: "Sign in to record an activity heartbeat." }, { status: 401 })

  const { data, error } = await supabase.rpc("record_device_heartbeat", { p_channel: "browser" })
  if (error || !data) {
    return NextResponse.json({ error: "Activity heartbeat could not be recorded." }, { status: 503 })
  }

  return NextResponse.json({ lastSeenAt: data }, { headers: { "Cache-Control": "no-store" } })
}
