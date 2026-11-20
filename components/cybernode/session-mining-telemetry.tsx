"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"

type LedgerEntry = {
  id: string
  asset_master: string
  amount: string
  entry_type: string
  status: string
  created_at: string
  verified_at: string | null
  transaction_hash: string | null
}

type LedgerResponse = { entries: LedgerEntry[] }

const tiers = ["01", "02", "03", "04", "05", "06", "07"]

async function getLedger(url: string): Promise<LedgerResponse> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Ledger is temporarily unavailable")
  return body as LedgerResponse
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return [days, hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":")
}

export function SessionMiningTelemetry({ userId, walletAddress }: { userId: string | null; walletAddress: string | null }) {
  const sessionActive = Boolean(userId && walletAddress)
  const [uptime, setUptime] = useState(0)
  const { data, error, isLoading } = useSWR<LedgerResponse>(
    userId ? "/api/ledger/entries" : null,
    getLedger,
    { refreshInterval: 15_000, revalidateOnFocus: true, dedupingInterval: 10_000 },
  )

  useEffect(() => {
    if (!sessionActive) {
      setUptime(0)
      return
    }

    const connectedAt = Date.now()
    const updateUptime = () => setUptime(Math.floor((Date.now() - connectedAt) / 1_000))
    updateUptime()
    const interval = window.setInterval(updateUptime, 1_000)
    return () => window.clearInterval(interval)
  }, [sessionActive, userId, walletAddress])

  return (
    <section className="panel heat-miner-panel" aria-labelledby="heat-miner-title">
      <div className="panel-header">
        <div>
          <span className="eyebrow">SESSION VISUALIZATION · NO REWARD ENGINE</span>
          <h3 id="heat-miner-title">Seven-color heat array</h3>
        </div>
        <span className="sample-tag" aria-live="polite">{sessionActive ? "WALLET SESSION ACTIVE" : "AWAITING SIGN-IN + MAINNET WALLET"}</span>
      </div>
      <p className="heat-miner-description">Rotating rings are a visual status display only. They do not represent proof-of-work or generate tokens.</p>

      <div className="heat-tier-grid" role="list" aria-label="Seven visual color tiers">
        {tiers.map((tier, index) => (
          <div className={`heat-tier heat-tier-${index + 1}`} role="listitem" key={tier}>
            <span className="heat-tier-spinner" aria-hidden="true"><i /></span>
            <span className="heat-tier-label">COLOR TIER {tier}</span>
            <span className="heat-tier-state">{sessionActive ? "SESSION LINKED" : "VISUAL ONLY"}</span>
          </div>
        ))}
      </div>

      <div className="heat-telemetry-bottom">
        <div className="heat-uptime">
          <span className="eyebrow">CONNECTED BROWSER SESSION</span>
          <strong aria-live="off">{sessionActive ? formatDuration(uptime) : "—"}</strong>
          <small>{sessionActive ? "HH:MM:SS since this wallet session connected" : "Connect an authenticated account and TON Mainnet wallet to start the session timer."}</small>
        </div>
        <div className="heat-ledger">
          <div className="heat-ledger-heading">
            <div><span className="eyebrow">ACCOUNT-SCOPED LEDGER</span><h4>Recent entries</h4></div>
            <span className="sample-tag">15S REFRESH</span>
          </div>
          {!userId ? (
            <p className="heat-ledger-message">Sign in to load ledger entries for your account.</p>
          ) : error ? (
            <p className="heat-ledger-message" role="status">Live ledger is temporarily unavailable. No estimated values are shown.</p>
          ) : isLoading ? (
            <p className="heat-ledger-message" role="status">Loading verified account entries…</p>
          ) : data?.entries.length ? (
            <div className="heat-ledger-rows">
              {data.entries.slice(0, 3).map((entry) => (
                <div className="heat-ledger-row" key={entry.id}>
                  <div><strong>{entry.entry_type.replaceAll("_", " ")}</strong><small>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(entry.created_at))}</small></div>
                  <span>{entry.amount} {entry.asset_master}</span>
                  <span className={`heat-ledger-status heat-ledger-status-${entry.status}`}>{entry.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="heat-ledger-message">No ledger entries are recorded for this account.</p>
          )}
          <p className="heat-ledger-note">Amounts change only when a trusted service writes an actual ledger entry; animation never changes balances.</p>
        </div>
      </div>
    </section>
  )
}
