"use client"

import { TonConnectUIProvider } from "@tonconnect/ui-react"
import type { ReactNode } from "react"

export function TonConnectProvider({ children }: { children: ReactNode }) {
  return <TonConnectUIProvider manifestUrl={`${typeof window === "undefined" ? "https://cybernode-gram-miner.v0.build" : window.location.origin}/tonconnect-manifest.json`}>{children}</TonConnectUIProvider>
}
