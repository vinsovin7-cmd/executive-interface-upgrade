"use client"

import { useEffect, useState } from "react"
import Script from "next/script"
import useSWR from "swr"
import { CheckCircle2, CircleHelp, ExternalLink, LockKeyhole, Megaphone, ShieldCheck, Smartphone, Sparkles } from "lucide-react"

declare global {
  interface Window {
    Adsgram?: {
      init: (options: { blockId: string }) => { show: () => Promise<unknown> }
    }
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand: () => void
      }
    }
  }
}

type LinkState = { linked: boolean }

async function fetchLinkState(url: string): Promise<LinkState> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Telegram link status is unavailable")
  return body as LinkState
}

async function readResponse(response: Response) {
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Request could not be completed")
  return body
}

export function AdsgramRewards({ userId, onSignIn }: { userId: string | null; onSignIn: () => void }) {
  const blockId = process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID ?? ""
  const configured = /^\d+$/.test(blockId)
  const { data: linkState, error: linkError, mutate: refreshLink } = useSWR<LinkState>(
    userId ? "/api/telegram/link" : null,
    fetchLinkState,
    { revalidateOnFocus: true, dedupingInterval: 30_000 },
  )
  const [telegramAvailable, setTelegramAvailable] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    if (webApp) {
      webApp.ready()
      webApp.expand()
      setTelegramAvailable(true)
    }
  }, [])

  const linkTelegram = async () => {
    const initData = window.Telegram?.WebApp?.initData
    if (!initData) {
      setStatus("Open CyberNode from its Telegram Mini App to verify your Telegram account.")
      return
    }
    setBusy(true)
    setStatus("")
    try {
      await readResponse(await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ initData }),
      }))
      await refreshLink()
      setStatus("Telegram identity verified and linked to this account.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Telegram could not be linked.")
    } finally {
      setBusy(false)
    }
  }

  const startAd = async () => {
    if (!userId) {
      onSignIn()
      return
    }
    if (!configured) {
      setStatus("AdsGram is unavailable until a publisher Block ID is configured.")
      return
    }
    if (!linkState?.linked) {
      setStatus("Verify and link Telegram before starting a rewarded ad.")
      return
    }
    if (!sdkReady || !window.Adsgram) {
      setStatus("AdsGram is still loading. Please try again in a moment.")
      return
    }

    setBusy(true)
    setStatus("")
    try {
      await readResponse(await fetch("/api/adsgram/start", { method: "POST", headers: { Accept: "application/json" } }))
      await window.Adsgram.init({ blockId }).show()
      setStatus("Ad session ended. No reward or balance is credited until a trusted server-side source verifies it.")
    } catch {
      setStatus("The ad did not complete or could not be verified. No reward or balance was changed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel adsgram-panel" aria-labelledby="adsgram-title">
      {configured && <Script src="https://sad.adsgram.ai/js/sad.min.js" strategy="lazyOnload" onLoad={() => setSdkReady(true)} onError={() => setStatus("AdsGram could not be loaded right now.")} />}
      <div className="panel-header">
        <div><span className="eyebrow">OPT-IN PLACEMENT · SERVER-VERIFIED ONLY</span><h3 id="adsgram-title">AdsGram rewarded video</h3></div>
        <span className={`sample-tag ${configured ? "adsgram-configured" : ""}`}>{configured ? `UNIT ${blockId} · CONFIGURED` : "BLOCK ID REQUIRED"}</span>
      </div>
      <div className="adsgram-placement">
        <div className="adsgram-art" aria-hidden="true"><span /><span /><span /><Megaphone size={22} /></div>
        <div className="adsgram-placement-copy">
          <span className="eyebrow">SPONSORED VIDEO</span>
          <strong>Choose when to watch</strong>
          <p>Ads never start automatically. Viewing an ad does not create a token, ledger entry, or payout.</p>
        </div>
        <button type="button" className="adsgram-watch-button" disabled={busy || !userId || !configured || !linkState?.linked} onClick={startAd}>
          <Sparkles size={15} />{busy ? "Opening…" : "Watch ad"}
        </button>
      </div>
      {!userId ? (
        <div className="telegram-link-row"><LockKeyhole size={15} /><span>Sign in and link a verified Telegram account to enable reward callback attribution.</span><button type="button" onClick={onSignIn}>Sign in</button></div>
      ) : linkError ? (
        <div className="telegram-link-row" role="status"><CircleHelp size={15} /><span>Telegram link status is temporarily unavailable.</span><button type="button" onClick={() => void refreshLink()}>Retry</button></div>
      ) : linkState?.linked ? (
        <div className="telegram-link-row is-linked"><CheckCircle2 size={15} /><span>Telegram identity is verified for this signed-in account.</span><span className="linked-pill">LINKED</span></div>
      ) : (
        <div className="telegram-link-row">
          <Smartphone size={15} />
          <span>{telegramAvailable ? "Verify your Telegram identity to enable account-linked ad callbacks." : "Open this app in Telegram to verify and link your identity."}</span>
          <button type="button" disabled={busy || !telegramAvailable} onClick={linkTelegram}>{busy ? "Verifying…" : "Link Telegram"}</button>
        </div>
      )}
      <div className="adsgram-disclosure"><ShieldCheck size={14} /><span>Only secret-checked server callback receipts are counted. A receipt is not a ledger reward or proof of revenue.</span><a href="https://adsgram.ai" target="_blank" rel="noreferrer">AdsGram <ExternalLink size={11} /></a></div>
      {status && <p className="adsgram-status" role="status">{status}</p>}
    </section>
  )
}
