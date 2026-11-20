"use client"

import { useEffect, useRef } from "react"
import useSWR from "swr"

type VersionResponse = { version: string }

async function fetchVersion(url: string): Promise<VersionResponse> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error("App version is unavailable")
  return response.json() as Promise<VersionResponse>
}

export function PwaRegistration() {
  const reloadStarted = useRef(false)
  const { data } = useSWR<VersionResponse>("/api/version", fetchVersion, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
  })

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const currentVersion = process.env.NEXT_PUBLIC_APP_BUILD_ID
    if (!data?.version || !currentVersion || data.version === currentVersion || !("serviceWorker" in navigator)) return

    const reloadOnce = () => {
      if (reloadStarted.current) return
      reloadStarted.current = true
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, { once: true })
    void navigator.serviceWorker.ready.then(async (registration) => {
      await registration.update()
      const waitingWorker = registration.waiting
      if (waitingWorker) {
        waitingWorker.postMessage({ type: "SKIP_WAITING" })
        return
      }
      reloadOnce()
    }).catch(() => undefined)

    return () => navigator.serviceWorker.removeEventListener("controllerchange", reloadOnce)
  }, [data?.version])

  return null
}
