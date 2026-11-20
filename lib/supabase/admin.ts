import "server-only"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/types"
import { assertActiveSupabaseProjectUrl } from "@/lib/supabase/project"

export function createAdminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  if (!url || !key) throw new Error("Supabase server credentials are not configured")
  assertActiveSupabaseProjectUrl(url)

  return createSupabaseClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
