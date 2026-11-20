import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view account ledger entries." }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("ledger_entries")
    .select("id, asset_master, amount, entry_type, status, created_at, verified_at, transaction_hash")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: "Account ledger is temporarily unavailable." }, { status: 503 })
  }

  return NextResponse.json({ entries: data ?? [] }, { headers: { "Cache-Control": "no-store" } })
}
