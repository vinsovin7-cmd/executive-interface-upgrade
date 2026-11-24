import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const next = request.nextUrl.searchParams.get("next")
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/"

  if (code) {
    const supabase = await createClient()
    const { error, data: sessionData } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && sessionData?.session) {
      // On successful sign-in, clear any prior authError in the URL to prevent
      // bad_oauth_state from persisting across sessions, especially for new Gmail accounts.
      const url = new URL(request.url)
      url.searchParams.delete("authError")
      url.searchParams.delete("error")
      url.searchParams.delete("error_code")
      url.searchParams.delete("error_description")
      return NextResponse.redirect(new URL(url.pathname + url.search, request.url))
    }
  }

  // On error or missing code, redirect back with a generic message (will be cleared on next successful sign-in)
  return NextResponse.redirect(new URL("/?authError=callback", request.url))
}
