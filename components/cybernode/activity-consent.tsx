"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, CheckCircle2, ShieldCheck } from "lucide-react"

export function ActivityConsent({ userId, onSignIn }: { userId: string | null; onSignIn: () => void }) {
  const [enabled, setEnabled] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "active" | "error">("idle")
  const lastInteractionAt = useRef(0)
  const interactionPending = useRef(false)

  useEffect(() => {
    setSessionId(crypto.randomUUID())
  }, [])

  useEffect(() => {
    if (!enabled || !userId || !sessionId) return

    let inFlight = false
    let lastSentAt = 0

    const sendHeartbeat = async (force = false) => {
      const now = Date.now()
      if (document.visibilityState !== "visible" || now - lastInteractionAt.current > 60_000) return
      if (inFlight || (!force && now - lastSentAt < 20_000)) return

      inFlight = true
      lastSentAt = now
      const interacted = interactionPending.current
      interactionPending.current = false

      try {
        const response = await fetch("/api/telemetry/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ sessionId, interacted }),
        })
        if (!response.ok) throw new Error("Activity update failed")
        setStatus("active")
      } catch {
        interactionPending.current ||= interacted
        setStatus("error")
      } finally {
        inFlight = false
      }
    }

    const onInteraction = () => {
      lastInteractionAt.current = Date.now()
      interactionPending.current = true
      void sendHeartbeat()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void sendHeartbeat()
    }

    lastInteractionAt.current = Date.now()
    interactionPending.current = true
    void sendHeartbeat(true)
    const interval = window.setInterval(() => void sendHeartbeat(), 30_000)
    window.addEventListener("pointerdown", onInteraction, { passive: true })
    window.addEventListener("keydown", onInteraction)
    window.addEventListener("touchstart", onInteraction, { passive: true })
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("pointerdown", onInteraction)
      window.removeEventListener("keydown", onInteraction)
      window.removeEventListener("touchstart", onInteraction)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [enabled, sessionId, userId])

  return (
    <section className="activity-consent panel" aria-labelledby="activity-consent-title">
      <div className="activity-consent-icon"><Activity size={17} /></div>
      <div className="activity-consent-copy">
        <span className="eyebrow">ACCOUNT ACTIVITY · OPT-IN</span>
        <h2 id="activity-consent-title">Active-session telemetry</h2>
        <p>When enabled, authenticated, visible browser sessions record rate-limited heartbeats and coarse active time. No keystroke content, page content, or ad revenue are collected.</p>
        <span className="activity-consent-status" role="status">
          {status === "active" ? <><CheckCircle2 size={13} /> Recording active time for this account</> : status === "error" ? "Telemetry is temporarily unavailable; no reward or balance changes." : <><ShieldCheck size={13} /> Off until you opt in</>}
        </span>
      </div>
      {userId ? (
        <button type="button" className={`activity-consent-toggle ${enabled ? "is-enabled" : ""}`} role="switch" aria-checked={enabled} onClick={() => { setEnabled((current) => !current); if (enabled) setStatus("idle") }}>
          <span aria-hidden="true" />{enabled ? "On" : "Enable"}
        </button>
      ) : (
        <button type="button" className="activity-consent-toggle" onClick={onSignIn}>Sign in</button>
      )}
    </section>
  )
}
