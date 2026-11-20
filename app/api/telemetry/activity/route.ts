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

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Sign in to record account activity." }, { status: 401 })

  let body: { sessionId?: unknown; interacted?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid activity payload." }, { status: 400 })
  }

  if (typeof body.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) {
    return NextResponse.json({ error: "Invalid activity session." }, { status: 400 })
  }
  if (body.interacted !== undefined && typeof body.interacted !== "boolean") {
    return NextResponse.json({ error: "Invalid activity signal." }, { status: 400 })
  }

  const { data, error } = await supabase.rpc("record_activity_heartbeat", {
    p_session_id: body.sessionId,
    p_channel: "browser",
    p_interacted: body.interacted === true,
  })

  if (error || !data?.[0]) {
    return NextResponse.json({ error: "Activity heartbeat could not be recorded." }, { status: 503 })
  }

  return NextResponse.json({ activeSeconds: data[0].active_seconds }, {
    headers: { "Cache-Control": "no-store" },
  })
}
