import { createHmac } from "node:crypto"
import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { verifyTelegramInitData, type VerifiedTelegramIdentity } from "@/lib/telegram/verify-init-data"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Telegram users never own a real mailbox, so their auth account is keyed by a
// deterministic, non-routable address derived from their immutable Telegram id.
const TELEGRAM_EMAIL_DOMAIN = "telegram.cybernode.local"

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

function telegramEmail(telegramUserId: string) {
  return `tg${telegramUserId}@${TELEGRAM_EMAIL_DOMAIN}`
}

// Deterministic credential derived from a server-only secret (the bot token) and
// the verified Telegram id. It never leaves the server and is only ever used
// after the initData HMAC signature has already been validated.
function telegramPassword(telegramUserId: string, botToken: string) {
  return createHmac("sha256", botToken).update(`cybernode:telegram:${telegramUserId}`).digest("hex")
}

function displayHandle(identity: VerifiedTelegramIdentity) {
  if (identity.username) return identity.username
  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim()
  if (fullName) return fullName
  return `operator_${identity.telegramUserId}`
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ error: "Telegram sign-in is not configured." }, { status: 503 })
  }

  let initData = ""
  try {
    const body = await request.json() as { initData?: unknown }
    initData = typeof body.initData === "string" ? body.initData : ""
  } catch {
    return NextResponse.json({ error: "Invalid Telegram data." }, { status: 400 })
  }

  const identity = verifyTelegramInitData(initData, botToken)
  if (!identity) {
    return NextResponse.json({ error: "Telegram identity could not be verified. Open the Mini App from Telegram and try again." }, { status: 401 })
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json({ error: "Telegram sign-in is unavailable." }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user: existingUser } } = await supabase.auth.getUser()

  const handle = displayHandle(identity)
  const metadata = {
    telegram_id: identity.telegramUserId,
    telegram_username: identity.username,
    telegram_first_name: identity.firstName,
    telegram_last_name: identity.lastName,
    telegram_photo_url: identity.photoUrl,
  }

  let userId: string
  let mode: "linked" | "signed-in"

  if (existingUser) {
    // A web (Google / email) session already exists: attach the verified
    // Telegram identity to that profile instead of creating a second account.
    userId = existingUser.id
    mode = "linked"

    const { error: metadataError } = await admin.auth.admin.updateUserById(userId, { user_metadata: metadata })
    if (metadataError) {
      return NextResponse.json({ error: "Telegram identity could not be attached." }, { status: 503 })
    }
  } else {
    const email = telegramEmail(identity.telegramUserId)
    const password = telegramPassword(identity.telegramUserId, botToken)

    // Create the account on first contact. A duplicate email simply means the
    // Telegram user already has an account, so the sign-in below still applies.
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { ...metadata, display_name: handle },
    }).catch(() => null)

    const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError || !signIn.user) {
      return NextResponse.json({ error: "Telegram sign-in could not be completed." }, { status: 503 })
    }

    userId = signIn.user.id
    mode = "signed-in"

    const { data: profile } = await admin.from("profiles").select("display_name").eq("id", userId).maybeSingle()
    if (!profile?.display_name) {
      await admin.from("profiles").upsert({ id: userId, display_name: handle, email }, { onConflict: "id" })
    }
  }

  const { error: linkError } = await admin.from("telegram_accounts").upsert({
    user_id: userId,
    telegram_user_id: identity.telegramUserId,
    verified_at: new Date().toISOString(),
  }, { onConflict: "user_id" })

  if (linkError) {
    if (linkError.code === "23505") {
      return NextResponse.json({ error: "This Telegram account is already linked to another CyberNode account." }, { status: 409 })
    }
    return NextResponse.json({ error: "Telegram identity could not be linked." }, { status: 503 })
  }

  return NextResponse.json({
    ok: true,
    mode,
    userId,
    displayName: handle,
    telegramUsername: identity.username,
    telegramLinked: true,
  }, { headers: { "Cache-Control": "private, no-store" } })
}
