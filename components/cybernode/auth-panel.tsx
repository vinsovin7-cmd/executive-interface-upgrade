"use client"

import { useEffect, useState, type FormEvent } from "react"
import { createClient } from "@/lib/supabase/client"

export function AuthPanel({ open, onClose, initialMessage = "", googleEnabled = true }: { open: boolean; onClose: () => void; initialMessage?: string; googleEnabled?: boolean }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState(initialMessage)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && initialMessage) setMessage(initialMessage)
  }, [initialMessage, open])

  if (!open) return null

  async function handleGoogleSignIn() {
    setBusy(true)
    setMessage("")

    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: true,
        },
      })

      if (error || !data.url) {
        const detail = error?.message.toLowerCase() ?? ""
        setMessage(detail.includes("provider") && detail.includes("not enabled")
          ? "Google sign-in is not enabled for this Supabase project. Enable the Google provider in Supabase Auth settings."
          : "Google sign-in could not be started. Please try again later.")
        setBusy(false)
        return
      }

      window.location.assign(data.url)
    } catch {
      setMessage("Google sign-in is temporarily unavailable. Please try again.")
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.")
      return
    }
    setBusy(true)
    setMessage("")

    try {
      const supabase = createClient()
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          setMessage(error.status === 429
            ? "Too many attempts. Wait a moment and try again."
            : error.code === "email_not_confirmed"
              ? "Confirm your email using the link we sent before signing in."
              : "Unable to sign in. Check your email and password or try again later.")
          return
        }
        onClose()
        window.location.reload()
        return
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
          data: { display_name: email.split("@")[0] },
        },
      })
      if (error) {
        setMessage(error.status === 429 ? "Too many attempts. Wait a moment and try again." : error.message.toLowerCase().includes("password") ? "Use a stronger password and try again." : "Unable to create the account. Review your details and try again.")
        return
      }
      if (data.session) {
        onClose()
        window.location.reload()
      } else {
        setMessage("Check your inbox for the confirmation link before signing in.")
      }
    } catch {
      setMessage("Authentication is temporarily unavailable. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title" onKeyDown={(event) => { if (event.key === "Escape") onClose() }}>
      <button className="auth-close" type="button" onClick={onClose} aria-label="Close sign in">×</button>
      <span className="auth-kicker">CYBERNODE ACCESS · SUPABASE AUTH</span>
      <h2 id="auth-title" className="rainbow-title-glow">{mode === "sign-in" ? "Welcome back." : "Create your operator account."}</h2>
      <p className="auth-description">{mode === "sign-in" ? "Sign in securely to access your scoped workspace data." : "Create an account with your email and password. Email confirmation may be required."}</p>
      <div className="auth-mode-tabs" role="group" aria-label="Account access mode">
        <button type="button" aria-pressed={mode === "sign-in"} className={mode === "sign-in" ? "auth-mode-tab auth-mode-tab-active" : "auth-mode-tab"} disabled={busy} onClick={() => { setMode("sign-in"); setMessage("") }}>Sign in</button>
        <button type="button" aria-pressed={mode === "sign-up"} className={mode === "sign-up" ? "auth-mode-tab auth-mode-tab-active" : "auth-mode-tab"} disabled={busy} onClick={() => { setMode("sign-up"); setMessage("") }}>Create account</button>
      </div>
      {googleEnabled && <>
      <button className="auth-google" type="button" onClick={handleGoogleSignIn} disabled={busy}>
        <svg aria-hidden="true" viewBox="0 0 48 48" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94a11.1 11.1 0 0 1-4.8 7.28l7.73 6C44.38 38.1 46.98 31.94 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.7l-7.73-6c-2.14 1.43-4.88 2.27-8.17 2.27-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
        {busy ? "Connecting to Google…" : "Sign in with Google / Gmail"}
      </button>
      <div className="auth-divider"><span>or continue with email</span></div>
      </>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="cybernode-email">Email</label>
        <input id="cybernode-email" type="email" autoFocus autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="cybernode-password">Password</label>
        <input id="cybernode-password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => { setPassword(event.target.value); if (message) setMessage("") }} aria-describedby="password-requirement" />
        <p id="password-requirement" className={password.length > 0 && password.length < 8 ? "auth-password-hint auth-password-hint-invalid" : "auth-password-hint"} aria-live="polite">{password.length}/8 minimum characters</p>
        {message && <p className="auth-message" role="alert" aria-live="assertive">{message}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}</button>
      </form>
      <div className="auth-security">Sessions use Supabase Auth cookies. No six-digit PIN or client-side password storage.</div>
    </section>
  </div>
}
