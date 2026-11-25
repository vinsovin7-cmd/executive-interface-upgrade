import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view withdrawal requests." }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("id, asset_code, amount_atomic, destination, status, transaction_hash, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: "Withdrawal requests could not be loaded." }, { status: 503 })
  }

  return NextResponse.json({ entries: data ?? [] }, { headers: { "Cache-Control": "no-store" } })
}