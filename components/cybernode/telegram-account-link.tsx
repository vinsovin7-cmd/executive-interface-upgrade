"use client"

import { useState } from "react"
import useSWR from "swr"
import { Link2, RefreshCw, ShieldCheck } from "lucide-react"

type TelegramLinkStatus = { linked: boolean }

async function fetchLinkStatus(url: string): Promise<TelegramLinkStatus> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Telegram link status is unavailable.")
  return body as TelegramLinkStatus
}

export function TelegramAccountLink({ userId }: { userId: string | null }) {
  const { data, error, isLoading, mutate } = useSWR<TelegramLinkStatus>(userId ? "/api/telegram/link" : null, fetchLinkStatus, {
    revalidateOnFocus: true,
    dedupingInterval: 15_000,
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [telegramAvailable, setTelegramAvailable] = useState(() => typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData))

  function readTelegramInitData() {
    const initData = window.Telegram?.WebApp?.initData ?? ""
    setTelegramAvailable(Boolean(initData))
    return initData
  }

  async function linkTelegram() {
    const initData = readTelegramInitData()
    if (!initData) {
      setMessage("Open CyberNode from its Telegram Mini App to verify your Telegram identity.")
      return
    }

    setBusy(true)
    setMessage("")
    try {
      const response = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ initData }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Telegram account could not be linked.")
      await mutate({ linked: true }, { revalidate: false })
      setMessage("Telegram identity verified and linked to this account.")
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Telegram account could not be linked.")
    } finally {
      setBusy(false)
    }
  }

  if (!userId) return null

  return (
    <section className="panel telegram-link-panel" aria-labelledby="telegram-link-title">
      <div className="panel-header">
        <div><span className="eyebrow">IDENTITY SYNC</span><h3 id="telegram-link-title">Telegram account</h3></div>
        <span className={`account-session-badge ${data?.linked ? "account-session-active" : ""}`}><ShieldCheck size={12}/>{data?.linked ? "VERIFIED LINK" : "NOT LINKED"}</span>
      </div>
      <p className="telegram-link-copy">Link a verified Telegram Mini App identity to your signed-in CyberNode account. Telegram identity data is verified server-side and is never accepted from editable profile fields.</p>
      {isLoading ? <p className="telegram-link-status" role="status">Checking Telegram link…</p> : error ? <p className="telegram-link-status" role="status">Link status is temporarily unavailable. Refresh to try again.</p> : data?.linked ? <p className="telegram-link-status" role="status"><ShieldCheck size={14}/> Telegram identity is linked to this account.</p> : <p className="telegram-link-status">{telegramAvailable ? "Telegram Mini App identity detected." : "Open CyberNode inside Telegram to link your verified identity."}</p>}
      <div className="telegram-link-actions">
        {!data?.linked && <button type="button" className="telegram-link-button" onClick={() => void linkTelegram()} disabled={busy || isLoading}>{busy ? "Verifying…" : <><Link2 size={14}/> Link Telegram account</>}</button>}
        <button type="button" className="telegram-refresh-button" onClick={() => { setMessage(""); void mutate() }} aria-label="Refresh Telegram link status"><RefreshCw size={13}/> Refresh</button>
      </div>
      {message && <p className="telegram-link-message" role="status" aria-live="polite">{message}</p>}
    </section>
  )
}
