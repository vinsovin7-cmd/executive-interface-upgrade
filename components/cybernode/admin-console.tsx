"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Wallet,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { AdminTelemetry } from "@/components/cybernode/admin-telemetry"
import {
  ASSET_DECIMALS,
  CLAIM_STATE_LABELS,
  POOL_STATES,
  formatAtomic,
  tonviewerAddressUrl,
  tonviewerTransactionUrl,
} from "@/lib/mining/config"

type Treasury = {
  configured: boolean
  treasuryAddress: string
  anchorAddress: string
  signerAddress: string | null
  addressMatchesTreasury: boolean
  tonBalance: string | null
  gramBalance: string | null
  usdtBalance: string | null
  liquidityReady: boolean
  diagnostics: string[]
}

type PoolConfig = {
  poolState: string
  cooldownSeconds: number
  perUserDailyCapGramAtomic: string
  perUserDailyCapUsdtAtomic: string
  globalDailyCapGramAtomic: string
  globalDailyCapUsdtAtomic: string
  treasuryAnchorAddress: string
  updatedAt: string | null
}

type ClaimLog = {
  id: string
  owner: string
  asset_code: string
  asset_decimals: number
  amount_atomic: string
  state: string
  transaction_hash: string | null
  failure_reason: string | null
  created_at: string
  confirmed_at: string | null
}

type WalletLog = { user_id: string; owner: string; address: string; status: string; verified_at: string | null; created_at: string }

type Overview = {
  asOf: string
  pool: PoolConfig
  treasury: Treasury | null
  claims: ClaimLog[]
  wallets: WalletLog[]
  summary: { pendingClaims: number; confirmedClaims: number; blockedClaims: number }
  telemetry: unknown | null
}

type PoolForm = {
  poolState: string
  cooldownSeconds: string
  perUserDailyCapGram: string
  perUserDailyCapUsdt: string
  globalDailyCapGram: string
  globalDailyCapUsdt: string
}

type StakingEngine = {
  id: number
  name: string
  asset_code: string
  pool_status: string
  funded_liquidity_atomic: string
  active_staked_principal_atomic: string
  base_apr_bps: number
  max_boost_multiplier_bps: number
  lockup_seconds: number
  deposit_wallet_address: string
  updated_at: string
}

type EarnIncreaser = {
  key: string
  name: string
  description: string | null
  category: string
  enabled: boolean
  multiplier_bps: number
  cap_atomic: string
  sort_order: number
  updated_at: string
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body as T
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error ?? "Request failed")
  return json
}

function shortAddress(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function stateLabel(state: string) {
  return (CLAIM_STATE_LABELS as Record<string, string>)[state] ?? state
}

function statusBadge(status: string) {
  const lower = status.toLowerCase()
  return lower === "active" ? "is-ready" : lower === "paused" ? "is-warn" : "is-off"
}

function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text)
}

export function AdminConsole() {
  const { data, error, isLoading, mutate } = useSWR<Overview>("/api/admin/overview", getJson, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
    dedupingInterval: 8_000,
  })
  const [form, setForm] = useState<PoolForm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [activeTab, setActiveTab] = useState("overview")
  const [stakingEngines, setStakingEngines] = useState<StakingEngine[]>([])
  const [earnIncreasers, setEarnIncreasers] = useState<EarnIncreaser[]>([])
  const [engineBusy, setEngineBusy] = useState<number | null>(null)
  const [increaserBusy, setIncreaserBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!data || form) return
    setForm({
      poolState: data.pool.poolState,
      cooldownSeconds: String(data.pool.cooldownSeconds),
      perUserDailyCapGram: formatAtomic(data.pool.perUserDailyCapGramAtomic, ASSET_DECIMALS.GRAM),
      perUserDailyCapUsdt: formatAtomic(data.pool.perUserDailyCapUsdtAtomic, ASSET_DECIMALS.USDT),
      globalDailyCapGram: formatAtomic(data.pool.globalDailyCapGramAtomic, ASSET_DECIMALS.GRAM),
      globalDailyCapUsdt: formatAtomic(data.pool.globalDailyCapUsdtAtomic, ASSET_DECIMALS.USDT),
    })
  }, [data, form])

  const update = (patch: Partial<PoolForm>) => setForm((current) => (current ? { ...current, ...patch } : current))

  const saveConfig = async () => {
    if (!form) return
    setBusy("save")
    setMessage("")
    try {
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          poolState: form.poolState,
          cooldownSeconds: Number(form.cooldownSeconds),
          perUserDailyCapGram: form.perUserDailyCapGram,
          perUserDailyCapUsdt: form.perUserDailyCapUsdt,
          globalDailyCapGram: form.globalDailyCapGram,
          globalDailyCapUsdt: form.globalDailyCapUsdt,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? "Pool configuration could not be saved.")
      setMessage("Pool configuration saved. Every new claim enforces these limits immediately.")
      await mutate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Pool configuration could not be saved.")
    } finally {
      setBusy(null)
    }
  }

  const sweep = async () => {
    setBusy("sweep")
    setMessage("")
    try {
      const response = await fetch("/api/admin/settle", { method: "POST", headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? "Payout sweep could not be run.")
      setMessage(`Sweep complete — ${body.confirmed ?? 0} of ${body.attempted ?? 0} pending payouts confirmed on-chain.`)
      await mutate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Payout sweep could not be run.")
    } finally {
      setBusy(null)
    }
  }

  const signOut = async () => {
    await fetch("/api/admin/session", { method: "DELETE" })
    window.location.reload()
  }

  const loadStakingEngines = useCallback(async () => {
    try {
      const json = await getJson<{ engines: StakingEngine[] }>("/api/admin/staking")
      setStakingEngines(json.engines ?? [])
    } catch {
      setStakingEngines([])
    }
  }, [])

  const loadEarnIncreasers = useCallback(async () => {
    try {
      const json = await getJson<{ increasers: EarnIncreaser[] }>("/api/admin/earn-increasers")
      setEarnIncreasers(json.increasers ?? [])
    } catch {
      setEarnIncreasers([])
    }
  }, [])

  useEffect(() => {
    void loadStakingEngines()
    void loadEarnIncreasers()
  }, [loadStakingEngines, loadEarnIncreasers])

  const toggleEngineStatus = async (engine: StakingEngine) => {
    setEngineBusy(engine.id)
    try {
      await postJson("/api/admin/staking", {
        id: engine.id,
        pool_status: engine.pool_status === "active" ? "paused" : "active",
      })
      await mutate()
      setStakingEngines((prev) => prev.map((e) => (e.id === engine.id ? { ...e, pool_status: engine.pool_status === "active" ? "paused" : "active" } : e)))
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not update staking engine.")
    } finally {
      setEngineBusy(null)
    }
  }

  const toggleIncreaser = async (increaser: EarnIncreaser) => {
    setIncreaserBusy(increaser.key)
    try {
      await postJson("/api/admin/earn-increasers", {
        key: increaser.key,
        enabled: !increaser.enabled,
      })
      setEarnIncreasers((prev) => prev.map((e) => (e.key === increaser.key ? { ...e, enabled: !e.enabled } : e)))
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not update earn increaser.")
    } finally {
      setIncreaserBusy(null)
    }
  }

  const treasury = data?.treasury ?? null
  const claimByHash = useMemo(() => {
    return new Map((data?.claims ?? []).filter((c) => c.transaction_hash).map((c) => [c.transaction_hash, c]))
  }, [data?.claims])

  return (
    <div className="page-stack admin-console-page">
      <div className="admin-console-header">
        <div className="admin-brand-row">
          <span className="eyebrow">CYBERNODE · EXECUTIVE CONTROL PLANE</span>
          <span className="admin-access-chip">{authenticatedLabel(data)}</span>
        </div>
        <div className="admin-console-actions">
          <button type="button" onClick={() => void mutate()} disabled={isLoading}>
            <RefreshCw size={13} className={isLoading ? "spin" : undefined} /> Refresh telemetry
          </button>
          <button type="button" onClick={sweep} disabled={busy === "sweep"}>
            {busy === "sweep" ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} Settle pending payouts
          </button>
          <button type="button" className="is-danger" onClick={signOut}><LogOut size={13} /> Sign out</button>
        </div>
      </div>

      {message && <p className="admin-console-message" role="status">{message}</p>}

      <nav className="admin-tabs" aria-label="Control plane sections">
        <button
          type="button"
          className={`admin-tab ${activeTab === "overview" ? "is-active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview & Gas vs Jetton Liquidity
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "staking" ? "is-active" : ""}`}
          onClick={() => setActiveTab("staking")}
        >
          Staking Engines
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "earn" ? "is-active" : ""}`}
          onClick={() => setActiveTab("earn")}
        >
          Earn Increasers
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "feed" ? "is-active" : ""}`}
          onClick={() => setActiveTab("feed")}
        >
          Live Tonviewer & Hash Feed
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "bindings" ? "is-active" : ""}`}
          onClick={() => setActiveTab("bindings")}
        >
          Claims / Bindings
        </button>
      </nav>

      {error ? (
        <section className="panel admin-error" role="alert">
          <ShieldCheck size={18} />
          <div>
            <strong>Operator telemetry could not be loaded</strong>
            <p>{error instanceof Error && error.message.toLowerCase().includes("authentication") ? "Your admin session expired. Reload the page and enter the access PIN again." : "The protected telemetry service is temporarily unavailable."}</p>
          </div>
          <button type="button" onClick={() => void mutate()}><RefreshCw size={14} /> Retry</button>
        </section>
      ) : isLoading || !data ? (
        <section className="panel admin-loading" role="status">Loading protected operator telemetry…</section>
      ) : (
        <>
          {activeTab === "overview" && (
            <section className="panel admin-data-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">TREASURY · MAINNET</span>
                  <h3>Live payout liquidity</h3>
                </div>
                {treasury ? (
                  <span className={`mining-badge ${treasury.configured && treasury.addressMatchesTreasury && treasury.liquidityReady ? "is-ready" : "is-warn"}`}>
                    {treasury.configured ? (treasury.liquidityReady ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />) : <AlertTriangle size={13} />}
                    {treasury.configured ? (treasury.liquidityReady ? "TREASURY LIQUID · READY" : "TREASURY UNFUNDED") : "SIGNER NOT CONFIGURED"}
                  </span>
                ) : (
                  <span className="mining-badge is-warn"><AlertTriangle size={13} /> STATUS UNAVAILABLE</span>
                )}
              </div>
              <div className="admin-total-list">
                <div>
                  <span><Zap size={14} /> TON gas / payout balance</span>
                  <strong>{treasury?.tonBalance ?? "—"}</strong>
                </div>
                <div>
                  <span><Wallet size={14} /> GRAM jetton balance</span>
                  <strong>{treasury?.gramBalance ?? "—"}</strong>
                </div>
                <div>
                  <span><Wallet size={14} /> USDT jetton balance</span>
                  <strong>{treasury?.usdtBalance ?? "—"}</strong>
                </div>
                <div>
                  <span><ShieldCheck size={14} /> Signer controls treasury</span>
                  <strong>{treasury?.addressMatchesTreasury ? "YES" : "NO"}</strong>
                </div>
              </div>
              <div className="admin-anchor">
                <span className="micro-label">COLLECTION / REFILL ANCHOR</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <a className="mono" href={tonviewerAddressUrl(data.pool.treasuryAnchorAddress)} target="_blank" rel="noreferrer">
                    {data.pool.treasuryAnchorAddress} <ExternalLink size={11} />
                  </a>
                  <button
                    type="button"
                    className="copy-btn"
                    title="Copy anchor address"
                    onClick={() => {
                      void copyToClipboard(data.pool.treasuryAnchorAddress)
                      setMessage("Refill anchor address copied to clipboard.")
                    }}
                  >
                    <Copy size={13} />
                  </button>
                  <span className="muted-copy">Payout liquidity and gas are refilled from the anchor. It is never used to sign a payout — signing stays with the configured treasury signer {treasury?.treasuryAddress ? shortAddress(treasury.treasuryAddress) : "—"}.</span>
                </div>
              </div>
              {treasury?.diagnostics?.length ? (
                <ul className="mining-diagnostics">
                  {treasury.diagnostics.slice(0, 4).map((diagnostic) => <li key={diagnostic}><AlertTriangle size={12} /> {diagnostic}</li>)}
                </ul>
              ) : null}
            </section>
          )}

          {activeTab === "overview" && (
            <section className="panel admin-data-panel">
              <div className="panel-header">
                <div><span className="eyebrow">REWARD POOL CONTROLS</span><h3>Pool state &amp; payout caps</h3></div>
                <span className="sample-tag">ENFORCED SERVER-SIDE</span>
              </div>
              {form ? (
                <div className="admin-controls">
                  <label className="admin-control">
                    <span className="micro-label">POOL STATE</span>
                    <select value={form.poolState} onChange={(event) => update({ poolState: event.target.value })}>
                      {POOL_STATES.map((state) => <option key={state} value={state}>{state.toUpperCase()}</option>)}
                    </select>
                  </label>
                  <label className="admin-control">
                    <span className="micro-label">PER-USER COOLDOWN (s)</span>
                    <input type="number" min={0} max={86400} value={form.cooldownSeconds} onChange={(event) => update({ cooldownSeconds: event.target.value })} />
                  </label>
                  <label className="admin-control">
                    <span className="micro-label">PER-USER GRAM / DAY</span>
                    <input type="text" value={form.perUserDailyCapGram} onChange={(event) => update({ perUserDailyCapGram: event.target.value })} />
                  </label>
                  <label className="admin-control">
                    <span className="micro-label">PER-USER USDT / DAY</span>
                    <input type="text" value={form.perUserDailyCapUsdt} onChange={(event) => update({ perUserDailyCapUsdt: event.target.value })} />
                  </label>
                  <label className="admin-control">
                    <span className="micro-label">GLOBAL GRAM / DAY</span>
                    <input type="text" value={form.globalDailyCapGram} onChange={(event) => update({ globalDailyCapGram: event.target.value })} />
                  </label>
                  <label className="admin-control">
                    <span className="micro-label">GLOBAL USDT / DAY</span>
                    <input type="text" value={form.globalDailyCapUsdt} onChange={(event) => update({ globalDailyCapUsdt: event.target.value })} />
                  </label>
                </div>
              ) : (
                <p className="muted-copy">Loading pool controls…</p>
              )}
              <button type="button" className="mining-primary" onClick={saveConfig} disabled={busy === "save" || !form}>
                {busy === "save" ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save pool controls
              </button>
            </section>
          )}

          {activeTab === "staking" && (
            <section className="panel admin-data-panel">
              <div className="panel-header">
                <div><span className="eyebrow">STAKING ENGINES · UP TO 5</span><h3>GRAM & USDT pools</h3></div>
                <span className="sample-tag">SERVER-ROLLED RPC</span>
              </div>
              {stakingEngines.length ? (
                <div className="engine-grid">
                  {stakingEngines.map((engine) => (
                    <div key={engine.id} className="engine-card">
                      <div className="engine-header">
                        <span className="engine-name">{engine.name}</span>
                        <span className={`engine-badge ${statusBadge(engine.pool_status)}`}>{engine.pool_status.toUpperCase()}</span>
                      </div>
                      <div className="engine-detail">
                        <div><span className="micro-label">ASSET</span><span className="mono">{engine.asset_code}</span></div>
                        <div><span className="micro-label">FUNDED LIQUIDITY</span><span className="mono">{formatAtomic(engine.funded_liquidity_atomic, engine.asset_code === "USDT" ? ASSET_DECIMALS.USDT : ASSET_DECIMALS.GRAM)}</span></div>
                        <div><span className="micro-label">STAKED PRINCIPAL</span><span className="mono">{formatAtomic(engine.active_staked_principal_atomic, engine.asset_code === "USDT" ? ASSET_DECIMALS.USDT : ASSET_DECIMALS.GRAM)}</span></div>
                        <div><span className="micro-label">BASE APR</span><span className="mono">{engine.base_apr_bps / 100}%</span></div>
                        <div><span className="micro-label">MAX BOOST</span><span className="mono">{engine.max_boost_multiplier_bps / 10000}x</span></div>
                        <div><span className="micro-label">LOCKUP</span><span className="mono">{engine.lockup_seconds}s</span></div>
                      </div>
                      <div className="engine-actions">
                        <button type="button" className={`toggle-btn ${engine.pool_status === "active" ? "is-active" : ""}`} disabled={engineBusy === engine.id} onClick={() => toggleEngineStatus(engine)}>
                          {engineBusy === engine.id ? <Loader2 size={12} className="spin" /> : engine.pool_status === "active" ? "Pause" : "Activate"}
                        </button>
                        <a className="mono" href={tonviewerAddressUrl(engine.deposit_wallet_address)} target="_blank" rel="noreferrer">
                          {shortAddress(engine.deposit_wallet_address)} <ExternalLink size={11} />
                        </a>
                        <button type="button" className="copy-btn" title="Copy deposit address" onClick={() => {
                          void copyToClipboard(engine.deposit_wallet_address)
                          setMessage(`${engine.name} deposit address copied.`)
                        }}>
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No staking engines found.</p>
              )}
            </section>
          )}

          {activeTab === "earn" && (
            <section className="panel admin-data-panel">
              <div className="panel-header">
                <div><span className="eyebrow">EARN INCREASERS · UP TO 10</span><h3>Configurable multiplier rules</h3></div>
                <span className="sample-tag">EDITABLE / TOGGLEABLE FROM ADMIN</span>
              </div>
              {earnIncreasers.length ? (
                <div className="increaser-list">
                  {earnIncreasers.map((inc) => (
                    <div key={inc.key} className="increaser-row">
                      <div className="increaser-main">
                        <span className={`toggle-badge ${inc.enabled ? "is-on" : "is-off"}`}>{inc.enabled ? "ON" : "OFF"}</span>
                        <span className="increaser-name">{inc.name}</span>
                        <span className="increaser-cat">{inc.category}</span>
                        <span className="micro-label muted-copy">{inc.description ?? ""}</span>
                        <div className="increaser-meta">
                          <span className="mono">{inc.multiplier_bps / 100}%</span>
                          <span className="mono">cap {formatAtomic(inc.cap_atomic, 9)}</span>
                          <span className="mono">order {inc.sort_order}</span>
                        </div>
                      </div>
                      <div className="increaser-actions">
                        <button
                          type="button"
                          className={`toggle-btn ${inc.enabled ? "is-active" : ""}`}
                          disabled={increaserBusy === inc.key}
                          onClick={() => toggleIncreaser(inc)}
                        >
                          {increaserBusy === inc.key ? <Loader2 size={12} className="spin" /> : inc.enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No earn increasers found.</p>
              )}
            </section>
          )}

          {activeTab === "feed" && (
            <section className="panel admin-data-panel">
              <div className="panel-header"><div><span className="eyebrow">LIVE FEED</span><h3>Tonviewer links for real transaction hashes</h3></div><span className="sample-tag">{claimByHash.size} CONFIRMED HASHES</span></div>
              <div className="admin-log">
                {data.claims.filter((c) => Boolean(c.transaction_hash)).length ? (
                  data.claims.filter((c) => Boolean(c.transaction_hash)).map((claim) => (
                    <div className="admin-log-row" key={claim.id}>
                      <span className="admin-log-owner">{claim.owner}</span>
                      <span className="mono">{formatAtomic(claim.amount_atomic, claim.asset_decimals ?? 9)} {claim.asset_code}</span>
                      <span className={`ledger-status admin-state admin-state-${claim.state}`}>{stateLabel(claim.state)}</span>
                      <a href={tonviewerTransactionUrl(claim.transaction_hash ?? "")} target="_blank" rel="noreferrer">{claim.transaction_hash} <ExternalLink size={11} /></a>
                    </div>
                  ))
                ) : (
                  <p className="muted-copy">No confirmed payout hashes yet. Real transaction hashes appear here once a claim settles on-chain.</p>
                )}
              </div>
            </section>
          )}

          {activeTab === "bindings" && (
            <>
              <section className="panel admin-data-panel">
                <div className="panel-header"><div><span className="eyebrow">CLAIM LOG</span><h3>Real claim requests</h3></div><span className="sample-tag">{data.claims.length} RECORDS</span></div>
                {data.claims.length ? (
                  <div className="admin-log">
                    {data.claims.map((claim) => (
                      <div className="admin-log-row" key={claim.id}>
                        <span className="admin-log-owner">{claim.owner}</span>
                        <span className="mono">{formatAtomic(claim.amount_atomic, claim.asset_decimals ?? 9)} {claim.asset_code}</span>
                        <span className={`ledger-status admin-state admin-state-${claim.state}`}>{stateLabel(claim.state)}</span>
                        {claim.transaction_hash ? (
                          <a href={tonviewerTransactionUrl(claim.transaction_hash)} target="_blank" rel="noreferrer">{claim.transaction_hash.slice(0, 10)}… <ExternalLink size={11} /></a>
                        ) : (
                          <small>{claim.failure_reason ? claim.failure_reason.slice(0, 58) : new Date(claim.created_at).toLocaleString()}</small>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">No claim requests yet. Claims appear here the moment a user requests a GRAM or USDT payout.</p>
                )}
              </section>
              <section className="panel admin-data-panel">
                <div className="panel-header"><div><span className="eyebrow">WALLET BINDINGS</span><h3>User profile wallet bindings</h3></div><span className="sample-tag">{data.wallets.length} RECORDS</span></div>
                {data.wallets.length ? (
                  <div className="admin-log">
                    {data.wallets.map((wallet) => (
                      <div className="admin-log-row" key={`${wallet.user_id}-${wallet.address}`}>
                        <span className="admin-log-owner">{wallet.owner}</span>
                        <a className="mono" href={tonviewerAddressUrl(wallet.address)} target="_blank" rel="noreferrer">{shortAddress(wallet.address)} <ExternalLink size={11} /></a>
                        <span className="ledger-status">{wallet.status}</span>
                        <small>{wallet.verified_at ? new Date(wallet.verified_at).toLocaleDateString() : "unverified"}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">No wallet bindings are stored yet.</p>
                )}
              </section>
            </>
          )}

          {activeTab !== "overview" && <AdminTelemetry />}

          <p className="admin-refresh-note">Operator snapshot {new Date(data.asOf).toLocaleTimeString()} · auto-refreshes every 15 seconds. <a href="/" aria-label="Return to CyberNode dashboard">Dashboard <ExternalLink size={11} /></a></p>
        </>
      )}
    </div>
  )
}

function authenticatedLabel(data: Overview | undefined): string {
  return data ? "SESSION VERIFIED" : "LOADING…"
}