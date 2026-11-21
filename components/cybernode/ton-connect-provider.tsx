"use client"

import { TonConnectUIProvider } from "@tonconnect/ui-react"
import type { ReactNode } from "react"

// TonConnect fetches the manifest from the app origin and requires the manifest
// `url` field to match that origin. Production is pinned to the live deployment
// so the value is identical during SSR and hydration — no stale placeholder and
// no hydration mismatch. Override with NEXT_PUBLIC_SITE_URL if the domain moves.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://executive-interface-upgrade.vercel.app").replace(/\/$/, "")

export function TonConnectProvider({ children }: { children: ReactNode }) {
  return <TonConnectUIProvider manifestUrl={`${SITE_URL}/tonconnect-manifest.json`}>{children}</TonConnectUIProvider>
}
