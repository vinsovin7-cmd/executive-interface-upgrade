"use client"

import { useMemo } from "react"
import useSWR from "swr"
import { Wallet, ArrowDownLeft, ExternalLink, ShieldCheck } from "lucide-react"
import { formatAtomic, tonscanTransactionUrl, tonviewerTransactionUrl } from "@/lib/mining/config"

type PayoutEntry = {
  id: string
  asset_code: string
  amount_atomic: string
  destination: string | null
  status: string
  transaction_hash: string | null
  created_at: string
}

type PayoutResponse = {
  entries?: PayoutEntry[]
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body as T
}

function shortWallet(address: string) {
  if (address.length <= 11) return address
  return `${address.slice(0, 6)}…${address.slice(-5)}`
}

function formatAmount(assetCode: string, amountAtomic: string) {
  const decimals = assetCode === "USDT" ? 6 : 9
  const value = formatAtomic(amountAtomic, decimals)
  return value
}

const PAYOUT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  confirmed: "Confirmed",
  completed: "Completed",
  failed: "Failed",
}

function StatusPill({ status }: { status: string }) {
  const label = PAYOUT_STATUS_LABELS[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown")
  const isSuccess = status === "confirmed" || status === "completed"
  return <span className={`value-status ${isSuccess ? "is-pending" : ""}`}>{label}</span>
}

export function PayoutConfirmations({ userId, walletAddress }: { userId: string | null; walletAddress: string | null }) {
  const apiKey = useMemo(() => (userId ? "/api/withdrawals/list" : null), [userId])

  const { data, error, isLoading } = useSWR<PayoutResponse>(apiKey, getJson, {
    refreshInterval: 30_000,
    dedupingInterval: 20_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })

  const confirmedEntries = (data?.entries ?? []).filter((entry) => Boolean(entry.transaction_hash))

  return (
    <section className="panel payout-confirmations" id="payout-confirmations" style={{ scrollMarginTop: 84 }}>
      <div className="panel-header">
        <div>
          <span className="eyebrow">PAYOUT CONFIRMATIONS</span>
          <h3>Verified settlement feed</h3>
        </div>
        <span className="sample-tag">{confirmedEntries.length} ENTRIES</span>
      </div>
      <p className="muted-copy">
        Every broadcast payout settles from the treasury signer to your bound wallet and is recorded with a real on-chain
        transaction hash. Explorer links verify the final TON transaction on Tonviewer and Tonscan.
      </p>
      {error && !isLoading ? (
        <p className="muted-copy" role="status">{error}</p>
      ) : isLoading && !confirmedEntries.length ? (
        <p className="muted-copy" role="status">Loading verified payout confirmations…</p>
      ) : !confirmedEntries.length ? (
        <div className="empty-ledger">
          <div className="empty-ledger-icon"><ArrowDownLeft size={18} /></div>
          <strong>No confirmed payouts yet</strong>
          <span>Your first treasury settlement will appear here with its transaction hash and explorer links once it is confirmed.</span>
        </div>
      ) : (
        <ul className="payout-confirmations-list">
          {confirmedEntries.map((entry) => (
            <li key={entry.id} className="payout-confirmation-row">
              <div className="payout-confirmation-main">
                <div className="payout-confirmation-top">
                  <strong>{entry.asset_code}</strong>
                  <span>{formatAmount(entry.asset_code, entry.amount_atomic)}</span>
                </div>
                <small className="payout-confirmation-meta">
                  <Wallet size={11} /> To <b>{shortWallet(entry.destination ?? "")}</b> · <StatusPill status={entry.status} />
                </small>
                <small className="payout-confirmation-meta">TX <span className="mono">{entry.transaction_hash}</span></small>
              </div>
              <div className="payout-confirmation-actions">
                <a href={tonviewerTransactionUrl(entry.transaction_hash!)} target="_blank" rel="noopener" className="payout-explorer-link">
                  <ExternalLink size={11} /> TONVIEWER
                </a>
                <a href={tonscanTransactionUrl(entry.transaction_hash!)} target="_blank" rel="noopener" className="payout-explorer-link">
                  <ExternalLink size={11} /> TONSCAN
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}