"use client"

import { useState, type FormEvent } from "react"
import { KeyRound, Loader2, ShieldCheck } from "lucide-react"

export function AdminLogin() {
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ pin }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? "Admin access was denied.")
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin access was denied.")
      setBusy(false)
    }
  }

  return (
    <form className="admin-login" onSubmit={submit}>
      <span className="admin-login-mark"><ShieldCheck size={20} /></span>
      <div className="admin-login-copy">
        <span className="eyebrow">SERVER-GATED CONTROL PLANE</span>
        <h2>Operator access</h2>
        <p>Enter the server access PIN. Verification, rate limiting and the signed session cookie are all handled server-side — the PIN is never exposed to the browser bundle.</p>
      </div>
      <label className="admin-login-field">
        <span className="micro-label"><KeyRound size={12} /> ACCESS PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="••••••"
          disabled={busy}
        />
      </label>
      {error && <p className="admin-login-error" role="alert">{error}</p>}
      <button type="submit" className="admin-login-submit" disabled={busy || pin.length < 4}>
        {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
        {busy ? "Verifying…" : "Unlock control plane"}
      </button>
    </form>
  )
}
