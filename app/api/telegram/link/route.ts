import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyTelegramInitData } from "@/lib/telegram/verify-init-data"
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

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Sign in to check your Telegram link." }, { status: 401 })

  const { data, error } = await supabase
    .from("telegram_accounts")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Telegram link status is unavailable." }, { status: 503 })
  return NextResponse.json({ linked: Boolean(data) }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Sign in before linking Telegram." }, { status: 401 })

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return NextResponse.json({ error: "Telegram linking is not configured." }, { status: 503 })

  let initData = ""
  try {
    const body = await request.json() as { initData?: unknown }
    initData = typeof body.initData === "string" ? body.initData : ""
  } catch {
    return NextResponse.json({ error: "Invalid Telegram data." }, { status: 400 })
  }

  const verified = verifyTelegramInitData(initData, botToken)
  if (!verified) return NextResponse.json({ error: "Telegram identity could not be verified. Open the Mini App from Telegram and try again." }, { status: 401 })

  try {
    const admin = createAdminClient()
    const { error } = await admin.from("telegram_accounts").upsert({
      user_id: user.id,
      telegram_user_id: verified.telegramUserId,
      verified_at: new Date().toISOString(),
    }, { onConflict: "user_id" })

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "This Telegram account is already linked to another CyberNode account." }, { status: 409 })
      }
      throw error
    }
  } catch {
    return NextResponse.json({ error: "Telegram account could not be linked." }, { status: 503 })
  }

  return NextResponse.json({ linked: true }, { headers: { "Cache-Control": "private, no-store" } })
}
