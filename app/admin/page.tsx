import { AdminConsole } from "@/components/cybernode/admin-console"
import { AdminLogin } from "@/components/cybernode/admin-login"
import { isAdminSessionValid } from "@/lib/admin/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default async function AdminPage() {
  // Mandatory server-side session verification on every /admin page load.
  const authenticated = await isAdminSessionValid()

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-brand" href="/" aria-label="CyberNode dashboard"><span className="admin-brand-mark"><span /></span><span>CYBER<b>NODE</b><small>OPERATOR CONTROL PLANE</small></span></a>
        <span className="admin-access"><span /> {authenticated ? "SESSION VERIFIED" : "RESTRICTED ACCESS"}</span>
      </header>
      <section className="admin-page-heading">
        <div>
          <span className="section-kicker"><span className="pulse-dot" /> SYSTEM OVERSIGHT</span>
          <h1>{authenticated ? "Rewards & payout control plane" : "Operator sign-in"}</h1>
          <p>{authenticated ? "Live treasury liquidity, reward pool controls, real claim and payout logs, and wallet bindings — all server-verified." : "This control plane is gated by a server-side access PIN. Sessions are signed, HttpOnly, Secure and SameSite=Lax."}</p>
        </div>
        <span className="admin-admin-badge">ADMIN</span>
      </section>
      {authenticated ? <AdminConsole /> : <AdminLogin />}
      <footer className="admin-footer">CYBERNODE <b>·</b> PROTECTED CONTROL PLANE <span>Payouts settle autonomously through server-side validation and treasury checks.</span></footer>
    </main>
  )
}
