"use client"

import { useEffect } from "react"

// Telegram Instant Auth. When the app is opened inside a Telegram Mini App the
// runtime hands the raw initData to the server, which validates the HMAC-SHA-256
// signature before creating or attaching the account. In a normal browser there
// is no initData, so nothing happens and the app stays fully usable.
export function TelegramRuntime() {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    webApp?.ready()

    const initData = webApp?.initData ?? ""
    if (!initData) return

    let cancelled = false

    void (async () => {
      try {
        const response = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ initData }),
        })
        if (cancelled || !response.ok) return

        const body = await response.json() as { mode?: string }
        // A fresh Telegram session was created; reload so the server renders the
        // authenticated profile (username, telemetry status, wallet binding).
        // A "linked" result means a session already existed, so no reload.
        if (body.mode === "signed-in") window.location.reload()
      } catch {
        // Non-blocking: a failed Telegram handshake never blocks the interface.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
