"use client"

import { useEffect, useState } from "react"
import { Check, Copy, ShieldCheck } from "lucide-react"

function formatTimestamp(value: string | null) {
  if (!value) return "Not available"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString()
}

export function AccountTelemetry({
  userId,
  email,
  profileName,
  provider,
  createdAt,
  lastSignInAt,
  emailVerified,
  walletAddress,
  networkStatus,
  ledgerCount,
  latestActivityAt,
}: {
  userId: string | null
  email: string | null
  profileName: string | null
  provider: string | null
  createdAt: string | null
  lastSignInAt: string | null
  emailVerified: boolean
  walletAddress: string | null
  networkStatus: string
  ledgerCount: number
  latestActivityAt: string | null
}) {
  const [copied, setCopied] = useState("")
  const [platform, setPlatform] = useState("Browser")

  useEffect(() => {
    if (window.Telegram?.WebApp?.initData) setPlatform("Telegram Mini App")
  }, [])

  async function copyValue(label: string, value: string | null) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      window.setTimeout(() => setCopied(""), 1600)
    } catch {
      setCopied("")
    }
  }

  const providerLabel = provider === "google" ? "GOOGLE OAUTH" : provider ? "EMAIL / PASSWORD" : "UNKNOWN"
  const values = [
    { label: "EMAIL / GMAIL", value: email ?? "Not signed in", copy: email },
    { label: "PROFILE", value: profileName ?? "No display name", copy: null },
    { label: "AUTH PROVIDER", value: providerLabel, copy: null },
    { label: "CLIENT", value: platform, copy: null },
    { label: "USER UUID", value: userId ?? "Not signed in", copy: userId },
    { label: "ACCOUNT CREATED", value: formatTimestamp(createdAt), copy: null },
    { label: "LAST SIGN-IN", value: formatTimestamp(lastSignInAt), copy: null },
    { label: "CONNECTED WALLET", value: walletAddress ?? "No wallet connected", copy: walletAddress },
    { label: "NETWORK", value: networkStatus, copy: null },
    { label: "SESSION", value: userId ? `ACTIVE · ${emailVerified ? "VERIFIED" : "EMAIL UNVERIFIED"}` : "SIGNED OUT", copy: null },
    { label: "VERIFIED ACTIVITY", value: `${ledgerCount} ledger entries${latestActivityAt ? ` · ${formatTimestamp(latestActivityAt)}` : " · none recorded"}`, copy: null },
  ]

  return <section className="panel account-telemetry" aria-labelledby="account-telemetry-title">
    <div className="panel-header account-telemetry-header">
      <div><span className="eyebrow">LIVE OPERATOR TELEMETRY</span><h3 id="account-telemetry-title">Account & session ledger</h3></div>
      <span className={`account-session-badge ${userId ? "account-session-active" : ""}`}><ShieldCheck size={12}/>{userId ? "SESSION ACTIVE" : "SIGNED OUT"}</span>
    </div>
    <p className="account-telemetry-intro">Authenticated account metadata and verified records for this session. Sensitive account details are visible only in the signed-in account view.</p>
    <dl className="account-telemetry-grid">{values.map(({ label, value, copy }) => <div className="account-telemetry-item" key={label}>
      <dt>{label}</dt><dd title={value}>{value}</dd>
      {copy && <button type="button" className="account-copy-button" onClick={() => void copyValue(label, copy)} aria-label={`Copy ${label.toLowerCase()}`}>
        {copied === label ? <Check size={13}/> : <Copy size={13}/>}<span>{copied === label ? "COPIED" : "COPY"}</span>
      </button>}
    </div>)}</dl>
    <div className="account-telemetry-footnote">Earnings are reported only when backed by verified ledger events; no unverified or simulated rewards are included.</div>
  </section>
}
