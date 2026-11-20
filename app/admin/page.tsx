import { notFound } from "next/navigation"
import { AdminTelemetry } from "@/components/cybernode/admin-telemetry"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.app_metadata?.role !== "admin") notFound()

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-brand" href="/" aria-label="CyberNode dashboard"><span className="admin-brand-mark"><span /></span><span>CYBER<b>NODE</b><small>OPERATOR TELEMETRY</small></span></a>
        <span className="admin-access"><span /> RESTRICTED ACCESS</span>
      </header>
      <section className="admin-page-heading"><div><span className="section-kicker"><span className="pulse-dot" /> SYSTEM OVERSIGHT</span><h1>Global telemetry</h1><p>Authenticated activity, verified ledger totals, and ad callback receipts in one protected view.</p></div><span className="admin-admin-badge">ADMIN</span></section>
      <AdminTelemetry />
      <footer className="admin-footer">CYBERNODE <b>·</b> GLOBAL METRICS <span>Only server-verified ledger entries count as rewards.</span></footer>
    </main>
  )
}
