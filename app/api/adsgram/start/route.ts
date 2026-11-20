import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
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

  const blockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID
  if (!blockId || !/^\d+$/.test(blockId)) {
    return NextResponse.json({ error: "AdsGram is not configured." }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Sign in before starting an ad." }, { status: 401 })

  try {
    const admin = createAdminClient()
    const recentCutoff = new Date(Date.now() - 60_000).toISOString()
    const { data: recentStarts, error: queryError } = await admin
      .from("adsgram_ad_starts")
      .select("id")
      .eq("user_id", user.id)
      .gte("started_at", recentCutoff)
      .limit(5)

    if (queryError) throw queryError
    if (recentStarts.length >= 5) {
      return NextResponse.json({ error: "Please wait before starting another ad." }, { status: 429 })
    }

    const { error: insertError } = await admin.from("adsgram_ad_starts").insert({
      user_id: user.id,
      block_id: blockId,
    })
    if (insertError) throw insertError
  } catch {
    return NextResponse.json({ error: "Ad start could not be recorded." }, { status: 503 })
  }

  return NextResponse.json({ started: true }, { headers: { "Cache-Control": "no-store" } })
}
