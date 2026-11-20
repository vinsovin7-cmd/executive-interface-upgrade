"use client"

import { useState, type FormEvent } from "react"
import { ExternalLink, KeyRound, LockKeyhole, ShieldCheck, UnlockKeyhole } from "lucide-react"
import { OwnerAIAssistant } from "@/components/cybernode/owner-ai-assistant"

type VaultConfiguration = {
  hasOpenRouterKey: boolean
  hasGeminiKey: boolean
  stakingTarget: string
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "Request could not be completed.")
  return body as T
}

export function OwnerVaultSettings({ isAdmin }: { isAdmin: boolean }) {
  const [opened, setOpened] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState("")
  const [openRouterKey, setOpenRouterKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [stakingTarget, setStakingTarget] = useState("")
  const [configuration, setConfiguration] = useState<VaultConfiguration | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  if (!isAdmin) {
    return <section className="panel settings-ordinary"><div className="settings-heading"><span className="settings-icon"><ShieldCheck size={17}/></span><div><span className="eyebrow">ACCOUNT SETTINGS</span><h3>Privacy and security</h3></div></div><p>Owner-only controls are restricted to the verified account owner.</p></section>
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await readResponse(await fetch("/api/owner-vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      }))
      const config = await readResponse<VaultConfiguration>(await fetch("/api/owner-vault/config", { cache: "no-store" }))
      setConfiguration(config)
      setStakingTarget(config.stakingTarget)
      setPin("")
      setUnlocked(true)
      setMessage("Owner vault unlocked for ten minutes.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Owner vault could not be unlocked.")
    } finally {
      setBusy(false)
    }
  }

  async function saveVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const config = await readResponse<VaultConfiguration>(await fetch("/api/owner-vault/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterKey: openRouterKey, geminiKey, stakingTarget }),
      }))
      setConfiguration(config)
      setOpenRouterKey("")
      setGeminiKey("")
      setStakingTarget(config.stakingTarget)
      setMessage("Encrypted settings saved. Submitted keys were cleared from the form.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Owner vault settings could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  async function testProvider(provider: "openrouter" | "gemini") {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await readResponse<{ message: string }>(await fetch("/api/owner-vault/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      }))
      setMessage(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider test could not be completed.")
    } finally {
      setBusy(false)
    }
  }

  async function lockVault() {
    setBusy(true)
    try {
      await fetch("/api/owner-vault/unlock", { method: "DELETE" })
    } finally {
      setUnlocked(false)
      setConfiguration(null)
      setOpenRouterKey("")
      setGeminiKey("")
      setStakingTarget("")
      setMessage("Owner vault locked.")
      setError("")
      setBusy(false)
    }
  }

  return <div className="page-stack settings-stack">
    <section className="panel settings-overview">
      <div className="settings-heading"><span className="settings-icon"><ShieldCheck size={17}/></span><div><span className="eyebrow">OWNER CONTROLS</span><h3>Private settings vault</h3></div><span className="sample-tag">SERVER ONLY</span></div>
      <p>Provider keys are encrypted before storage and never returned to the browser. PIN access is tied to the signed-in owner account, expires after ten minutes, and locks after five incorrect attempts.</p>
      {!opened ? <button className="settings-action" type="button" onClick={() => { setOpened(true); setError(""); setMessage("") }}><LockKeyhole size={15}/> Unlock private vault</button> : !unlocked ? <form className="vault-form vault-unlock-form" onSubmit={unlockVault}>
        <label className="vault-field"><span>Owner PIN</span><input type="password" inputMode="numeric" autoComplete="current-password" maxLength={128} value={pin} onChange={(event) => setPin(event.target.value)} required aria-label="Owner PIN"/></label>
        <div className="vault-actions"><button className="settings-action" type="submit" disabled={busy}><UnlockKeyhole size={15}/>{busy ? "Checking…" : "Unlock vault"}</button><button className="settings-quiet" type="button" onClick={() => { setOpened(false); setPin("") }}>Cancel</button></div>
      </form> : <form className="vault-form" onSubmit={saveVault}>
        <div className="vault-fields-grid">
          <label className="vault-field"><span>OpenRouter API key</span><input type="password" autoComplete="new-password" maxLength={512} value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder={configuration?.hasOpenRouterKey ? "Saved key is encrypted · enter to replace" : "Paste key to store encrypted"}/><small>{configuration?.hasOpenRouterKey ? "A key is stored. Leave blank to keep it, or enter a replacement." : "No key stored."}</small></label>
          <label className="vault-field"><span>Gemini API key</span><input type="password" autoComplete="new-password" maxLength={512} value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} placeholder={configuration?.hasGeminiKey ? "Saved key is encrypted · enter to replace" : "Paste key to store encrypted"}/><small>{configuration?.hasGeminiKey ? "A key is stored. Leave blank to keep it, or enter a replacement." : "No key stored."}</small></label>
        </div>
        <div className="vault-provider-tests"><span className="vault-section-label"><KeyRound size={13}/> CREDENTIAL CHECKS</span><button type="button" className="settings-quiet" disabled={busy || !configuration?.hasOpenRouterKey} onClick={() => void testProvider("openrouter")}>Test saved OpenRouter key</button><button type="button" className="settings-quiet" disabled={busy || !configuration?.hasGeminiKey} onClick={() => void testProvider("gemini")}>Test saved Gemini key</button></div>
        <div className="vault-divider"/>
        <label className="vault-field"><span>TON staking target</span><input type="text" autoComplete="off" spellCheck={false} maxLength={128} value={stakingTarget} onChange={(event) => setStakingTarget(event.target.value)} placeholder="EQ… / UQ… address"/><small>Saved as a read-only target only. It is not audited or enabled for staking or yield.</small></label>
        {stakingTarget && /^[A-Za-z0-9_-]{48}$/.test(stakingTarget) && <a className="vault-explorer-link" href={`https://tonviewer.com/${encodeURIComponent(stakingTarget)}`} target="_blank" rel="noreferrer">Inspect address on TONViewer <ExternalLink size={12}/></a>}
        <p className="vault-warning">Owner-only assistant requests can incur charges on the selected provider account. Per-request input and output limits apply; provider billing and account limits remain in effect.</p>
        <div className="vault-actions"><button className="settings-action" type="submit" disabled={busy}><KeyRound size={15}/>{busy ? "Saving…" : "Save encrypted settings"}</button><button className="settings-quiet" type="button" disabled={busy} onClick={() => void lockVault()}>Lock vault</button></div>
      </form>}
      {message && <p className="vault-feedback" role="status">{message}</p>}{error && <p className="vault-feedback vault-error" role="alert">{error}</p>}
    </section>
    {unlocked && <OwnerAIAssistant hasOpenRouterKey={Boolean(configuration?.hasOpenRouterKey)} hasGeminiKey={Boolean(configuration?.hasGeminiKey)}/>}
    <section className="readiness-footer"><ShieldCheck size={14}/><span>Credentials are encrypted with AES-256-GCM using the server-only OWNER_VAULT_ENCRYPTION_KEY. API routes require the admin role and a short-lived HttpOnly session cookie. Standard accounts cannot access the owner endpoints.</span></section>
  </div>
}
