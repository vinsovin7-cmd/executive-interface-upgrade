"use client"

import useSWR from "swr"
import { Activity, Clock3, Coins, ExternalLink, Radio, RefreshCw, ShieldCheck, Users, Wallet } from "lucide-react"

type AssetTotal = { asset_master: string; amount: number | string; count?: number }
type AdminTelemetry = {
  active_users: number | string
  active_sessions: number | string
  total_active_seconds: number | string
  interaction_ticks: number | string
  verified_rewards_by_asset: AssetTotal[]
  pending_payouts_by_asset: AssetTotal[]
  pending_payout_count: number | string
  adsgram_ad_starts: number | string
  adsgram_callback_receipts: number | string
  last_adsgram_callback_at: string | null
  network_impressions_available: boolean
}

async function fetchTelemetry(url: string): Promise<AdminTelemetry> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Global telemetry is unavailable")
  return body as AdminTelemetry
}

function number(value: number | string | undefined) {
  return Number(value ?? 0).toLocaleString("en-US")
}

function duration(value: number | string) {
  const seconds = Number(value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${number(hours)}h ${String(minutes).padStart(2, "0")}m`
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Users; label: string; value: string; detail: string }) {
  return <article className="admin-metric-card"><span className="admin-metric-icon"><Icon size={17} /></span><span className="eyebrow">{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

export function AdminTelemetry() {
  const { data, error, isLoading, mutate } = useSWR<AdminTelemetry>("/api/admin/telemetry", fetchTelemetry, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    dedupingInterval: 15_000,
  })

  return (
    <div className="page-stack admin-telemetry-page">
      <section className="notice-card"><ShieldCheck size={18} /><div><strong>Restricted operator view</strong><p>Aggregated metrics only. Account-level activity and callback identifiers are not exposed here.</p></div></section>
      {error ? (
        <section className="panel admin-error" role="alert"><ShieldCheck size={18} /><div><strong>Telemetry could not be loaded</strong><p>{error.message === "Administrator access required." ? "This page requires the server-assigned app_metadata role 'admin'." : "The protected telemetry service is temporarily unavailable."}</p></div><button type="button" onClick={() => void mutate()}><RefreshCw size={14} />Retry</button></section>
      ) : isLoading || !data ? (
        <section className="panel admin-loading" role="status">Loading protected global telemetry…</section>
      ) : (
        <>
          <div className="admin-metrics-grid">
            <MetricCard icon={Users} label="ACTIVE ACCOUNTS" value={number(data.active_users)} detail="Seen within 90 seconds" />
            <MetricCard icon={Activity} label="ACTIVE SESSIONS" value={number(data.active_sessions)} detail="Authenticated browser sessions" />
            <MetricCard icon={Clock3} label="RECORDED ACTIVE TIME" value={duration(data.total_active_seconds)} detail="Rate-limited, consented sessions" />
            <MetricCard icon={Radio} label="INTERACTION TICKS" value={number(data.interaction_ticks)} detail="Coarse interaction counts only" />
          </div>
          <section className="panel admin-data-panel">
            <div className="panel-header"><div><span className="eyebrow">VERIFIED LEDGER ENTRIES</span><h3>Reward totals by asset</h3></div><span className="sample-tag">LEDGER ONLY</span></div>
            {data.verified_rewards_by_asset.length ? <div className="admin-total-list">{data.verified_rewards_by_asset.map((item) => <div key={item.asset_master}><span><Coins size={14} />{item.asset_master}</span><strong>{number(item.amount)}</strong></div>)}</div> : <p className="muted-copy">No verified reward entries are present in the ledger.</p>}
          </section>
          <section className="panel admin-data-panel">
            <div className="panel-header"><div><span className="eyebrow">PAYOUT QUEUE</span><h3>Pending payouts by asset</h3></div><span className="sample-tag">{number(data.pending_payout_count)} PENDING</span></div>
            {data.pending_payouts_by_asset.length ? <div className="admin-total-list">{data.pending_payouts_by_asset.map((item) => <div key={item.asset_master}><span><Wallet size={14} />{item.asset_master} <small>{number(item.count)} entries</small></span><strong>{number(item.amount)}</strong></div>)}</div> : <p className="muted-copy">There are no pending payout entries in the ledger.</p>}
          </section>
          <section className="panel admin-data-panel">
            <div className="panel-header"><div><span className="eyebrow">AD NETWORK RECEIPTS</span><h3>AdsGram activity</h3></div><span className="sample-tag">CALLBACKS ARE NOT REWARDS</span></div>
            <div className="admin-metrics-grid admin-ad-metrics"><MetricCard icon={Radio} label="AD STARTS" value={number(data.adsgram_ad_starts)} detail="Opt-in sessions launched" /><MetricCard icon={ShieldCheck} label="CALLBACK RECEIPTS" value={number(data.adsgram_callback_receipts)} detail="Linked server callback records" /></div>
            <p className="muted-copy admin-network-note">{data.network_impressions_available ? "Network impression totals are available." : "AdsGram does not provide impression or revenue totals through this callback feed."}{data.last_adsgram_callback_at ? ` Last callback: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.last_adsgram_callback_at))}.` : " No callback has been received."}</p>
          </section>
          <p className="admin-refresh-note">Refreshes every 30 seconds. <button type="button" onClick={() => void mutate()}><RefreshCw size={12} /> Refresh now</button> <a href="/" aria-label="Return to CyberNode dashboard">Dashboard <ExternalLink size={11} /></a></p>
        </>
      )}
    </div>
  )
}
