import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function matchesSecret(received: string, expected: string) {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = process.env.ADSGRAM_CALLBACK_SECRET
  const expectedBlockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID
  const receivedSecret = url.searchParams.get("token") ?? ""
  const telegramUserId = url.searchParams.get("user_id") ?? url.searchParams.get("userid") ?? ""
  const blockId = url.searchParams.get("block_id") ?? ""

  if (!secret || !expectedBlockId) {
    return NextResponse.json({ error: "AdsGram callback is not configured." }, { status: 503 })
  }
  if (!matchesSecret(receivedSecret, secret)) {
    return NextResponse.json({ error: "Invalid callback credential." }, { status: 401 })
  }
  if (!/^\d{1,20}$/.test(telegramUserId) || blockId !== expectedBlockId) {
    return NextResponse.json({ error: "Invalid callback payload." }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { data: account, error: accountError } = await admin
      .from("telegram_accounts")
      .select("user_id")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle()

    if (accountError) throw accountError
    if (!account) {
      return NextResponse.json({ accepted: true, linked: false }, { status: 202, headers: { "Cache-Control": "no-store" } })
    }

    const { error: insertError } = await admin.from("adsgram_reward_callbacks").insert({
      telegram_user_id: telegramUserId,
      linked_user_id: account.user_id,
      block_id: blockId,
    })
    if (insertError) throw insertError
  } catch {
    return NextResponse.json({ error: "Reward callback could not be recorded." }, { status: 503 })
  }

  return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } })
}
