import { Dashboard } from "@/components/cybernode/dashboard"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/types"

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let walletConnections: Database["public"]["Tables"]["wallet_connections"]["Row"][] = []
  let ledgerEntries: Database["public"]["Tables"]["ledger_entries"]["Row"][] = []
  let databaseError = false

  let profile: Database["public"]["Tables"]["profiles"]["Row"] | null = null
  let telegramLinked = false

  if (user) {
    const [walletResult, ledgerResult, profileResult, telegramResult] = await Promise.all([
      supabase.from("wallet_connections").select("id, user_id, network, address, created_at").order("created_at", { ascending: false }),
      supabase.from("ledger_entries").select("id, user_id, network, asset_master, amount, transaction_hash, entry_type, status, created_at, verified_at, withdrawal_request_id, reward_event_id, claim_request_id").order("created_at", { ascending: false }).limit(20),
      supabase.from("profiles").select("id, display_name, email, created_at, updated_at").eq("id", user.id).maybeSingle(),
      supabase.from("telegram_accounts").select("telegram_user_id, verified_at").eq("user_id", user.id).maybeSingle(),
    ])

    walletConnections = walletResult.data ?? []
    ledgerEntries = ledgerResult.data ?? []
    profile = profileResult.data ?? null
    telegramLinked = Boolean(telegramResult.data)
    databaseError = Boolean(walletResult.error || ledgerResult.error || profileResult.error)
  }

  const authProvider = user?.app_metadata?.provider ?? user?.identities?.find((identity) => identity.provider === "google")?.provider ?? (user ? "email" : null)
  const profileEmail = profile?.email ?? user?.email ?? null
  const metadataName = typeof user?.user_metadata?.display_name === "string"
    ? user.user_metadata.display_name
    : typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null
  const profileName = profile?.display_name ?? metadataName
  const telegramUsername = typeof user?.user_metadata?.telegram_username === "string" && user.user_metadata.telegram_username.trim()
    ? user.user_metadata.telegram_username.trim()
    : null

  return <Dashboard userId={user?.id ?? null} userEmail={user?.email ?? null} profileEmail={profileEmail} authProvider={authProvider} profileName={profileName} accountCreatedAt={user?.created_at ?? null} lastSignInAt={user?.last_sign_in_at ?? null} emailVerified={Boolean(user?.email_confirmed_at)} walletConnections={walletConnections} ledgerEntries={ledgerEntries} databaseError={databaseError} isAdmin={user?.app_metadata?.role === "admin"} telegramUsername={telegramUsername} telegramLinked={telegramLinked} />
}
