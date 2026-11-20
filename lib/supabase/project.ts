export const ACTIVE_SUPABASE_PROJECT_ID = "tporrxnxwulannugtglq"
export const ACTIVE_SUPABASE_URL = `https://${ACTIVE_SUPABASE_PROJECT_ID}.supabase.co`

export function isActiveSupabaseProjectUrl(value: string | undefined): boolean {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === `${ACTIVE_SUPABASE_PROJECT_ID}.supabase.co`
  } catch {
    return false
  }
}

export function assertActiveSupabaseProjectUrl(value: string | undefined): asserts value is string {
  if (!isActiveSupabaseProjectUrl(value)) {
    throw new Error(`Supabase must target ${ACTIVE_SUPABASE_URL}. Check the project URL environment variables.`)
  }
}
