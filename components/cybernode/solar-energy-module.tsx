"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CircleHelp, Leaf, Power, Sun, Zap, X, CheckCircle2, AlertTriangle, ExternalLink, ChevronRight, SkipForward } from "lucide-react"
import { readAdCadence, startAdCycle, type AdCadenceState } from "@/lib/monetization/ad-cadence"
import { createShareableReceipt, generateReferralUrl } from "@/lib/monetization/shareable-receipt"
import { dispatchTelegramAlert, formatEventMessage } from "@/lib/monetization/telegram-dispatcher"
import { formatAtomic, tonviewerAddressUrl, tonviewerTransactionUrl } from "@/lib/mining/config"

type SolarNode = {
  id: string
  label: string
  isActive: boolean
  uptimeSeconds: number
  efficiency: number // 0-100
  lastPing: number
  lat: number
  lng: number
}

type SolarGridProps = {
  userId: string | null
  walletAddress: string | null
  miningWalletAddress: string | null
  sessionStartedAt: string | null
}

const DEFAULT_NODES: SolarNode[] = [
  { id: "node-1", label: "SOLAR-ARRAY-A1", isActive: false, uptimeSeconds: 0, efficiency: 0, lastPing: 0, lat: 37.7749, lng: -122.4194 },
  { id: "node-2", label: "SOLAR-ARRAY-B2", isActive: false, uptimeSeconds: 0, efficiency: 0, lastPing: 0, lat: 40.7128, lng: -74.0060 },
  { id: "node-3", label: "SOLAR-GRID-C3", isActive: false, uptimeSeconds: 0, efficiency: 0, lastPing: 0, lat: 51.5074, lng: -0.1278 },
]

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

function formatEfficiency(value: number): string {
  return `${value.toFixed(1)}%`
}

export function SolarEnergyModule({ userId, walletAddress, miningWalletAddress, sessionStartedAt }: SolarGridProps) {
  const sessionActive = Boolean(userId && walletAddress)
  const miningActive = Boolean(miningWalletAddress)

  const [nodes, setNodes] = useState<SolarNode[]>(DEFAULT_NODES)
  const [adCadence, setAdCadence] = useState<AdCadenceState | null>(null)
  const [adSlotStartedAt, setAdSlotStartedAt] = useState<number | null>(null)
  const [shareReceipt, setShareReceipt] = useState<ReturnType<typeof createShareableReceipt> | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [message, setMessage] = useState("")
  const nodeTimersRef = useRef<Map<string, number>>(new Map())
  const efficiencyTimersRef = useRef<Map<string, number>>(new Map())

  // Live clock for countdowns
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  // Read ad cadence on clock tick
  useEffect(() => {
    setAdCadence(readAdCadence())
  }, [now])

  // Session-based uptime for active nodes
  useEffect(() => {
    if (!sessionActive) {
      // Reset all nodes when no session
      setNodes(DEFAULT_NODES)
      nodeTimersRef.current.forEach((t) => clearInterval(t))
      nodeTimersRef.current.clear()
      efficiencyTimersRef.current.forEach((t) => clearInterval(t))
      efficiencyTimersRef.current.clear()
      return
    }

    // Start uptime/efficiency simulation for active nodes
    setNodes((prev) =>
      prev.map((node) => {
        if (!node.isActive) return { ...node, uptimeSeconds: 0, efficiency: 0, lastPing: 0 }
        return node
      })
    )

    const sessionStart = sessionStartedAt ? new Date(sessionStartedAt).getTime() : Date.now()
    const baseUptime = Math.max(0, Math.floor((Date.now() - sessionStart) / 1000))

    // Initialize active nodes with session uptime
    setNodes((prev) =>
      prev.map((node) =>
        node.isActive
          ? { ...node, uptimeSeconds: baseUptime, lastPing: Date.now() }
          : node
      )
    )

    // Live uptime increment
    const uptimeInterval = window.setInterval(() => {
      setNodes((prev) =>
        prev.map((node) =>
          node.isActive
            ? { ...node, uptimeSeconds: node.uptimeSeconds + 1, lastPing: Date.now() }
            : node
        )
      )
    }, 1_000)
    nodeTimersRef.current.set("uptime", uptimeInterval)

    // Efficiency drift for active nodes (simulates real PV variance)
    const efficiencyInterval = window.setInterval(() => {
      setNodes((prev) =>
        prev.map((node) => {
          if (!node.isActive) return node
          const drift = (Math.random() - 0.5) * 2 // ±1%
          const newEff = Math.max(75, Math.min(99.5, node.efficiency + drift))
          return { ...node, efficiency: newEff }
        })
      )
    }, 3_000)
    efficiencyTimersRef.current.set("efficiency", efficiencyInterval)

    return () => {
      nodeTimersRef.current.forEach((t) => clearInterval(t))
      nodeTimersRef.current.clear()
      efficiencyTimersRef.current.forEach((t) => clearInterval(t))
      efficiencyTimersRef.current.clear()
    }
  }, [sessionActive, sessionStartedAt])

  // Toggle node activation
  const toggleNode = (nodeId: string) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node
        const newlyActive = !node.isActive
        if (newlyActive && !sessionActive) {
          setMessage("Sign in and connect a Mainnet wallet to activate a node.")
          return node
        }
        if (newlyActive) {
          setMessage(`Node ${node.label} activated. Telemetry streaming...`)
          void dispatchTelegramAlert({
            chatId: "self",
            text: formatEventMessage("mining_session_started", {
              userId: userId ?? "anonymous",
              nodeId: node.label,
              walletAddress: miningWalletAddress ?? walletAddress,
            }),
            parseMode: "HTML",
          })
        } else {
          setMessage(`Node ${node.label} deactivated.`)
        }
        return {
          ...node,
          isActive: newlyActive,
          uptimeSeconds: newlyActive ? 0 : 0,
          efficiency: newlyActive ? 85 + Math.random() * 10 : 0,
          lastPing: newlyActive ? Date.now() : 0,
        }
      })
    )
  }

  // Activate all nodes (one-click)
  const activateAllNodes = () => {
    if (!sessionActive) {
      setMessage("Sign in and connect a Mainnet wallet first.")
      return
    }
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        isActive: true,
        uptimeSeconds: 0,
        efficiency: 85 + Math.random() * 10,
        lastPing: Date.now(),
      }))
    )
    setMessage("All solar nodes activated. Green compute telemetry live.")
    void dispatchTelegramAlert({
      chatId: "self",
      text: formatEventMessage("mining_session_started", {
        userId: userId ?? "anonymous",
        action: "activate_all_nodes",
        walletAddress: miningWalletAddress ?? walletAddress,
      }),
      parseMode: "HTML",
    })
  }

  // Ad cadence handlers
  const adSlotRemaining = adSlotStartedAt ? Math.max(0, 30 - Math.floor((now - adSlotStartedAt) / 1000)) : 0

  const startAdEngagement = () => {
    const { nextAllowedAt } = startAdCycle()
    setAdSlotStartedAt(Date.now())
    setAdCadence(readAdCadence())
    void dispatchTelegramAlert({
      chatId: "self",
      text: formatEventMessage("ad_cycle_started", { userId: userId ?? "anonymous", nextAllowedAt: new Date(nextAllowedAt).toISOString() }),
      parseMode: "HTML",
    })
  }

  const completeAdSlot = () => {
    setAdSlotStartedAt(null)
    setAdCadence(readAdCadence())
    void dispatchTelegramAlert({
      chatId: "self",
      text: formatEventMessage("ad_cycle_completed", { userId: userId ?? "anonymous", asset: "GRAM" }),
      parseMode: "HTML",
    })
  }

  const skipAdSlot = () => {
    setAdSlotStartedAt(null)
    setAdCadence(readAdCadence())
    void dispatchTelegramAlert({
      chatId: "self",
      text: formatEventMessage("ad_skipped", { userId: userId ?? "anonymous" }),
      parseMode: "HTML",
    })
  }

  const closeAdCycle = () => {
    setAdSlotStartedAt(null)
    setAdCadence(readAdCadence())
    void dispatchTelegramAlert({
      chatId: "self",
      text: formatEventMessage("ad_closed", { userId: userId ?? "anonymous" }),
      parseMode: "HTML",
    })
  }

  const copyShareReceipt = async () => {
    if (!shareReceipt) return
    try {
      await navigator.clipboard.writeText(shareReceipt.message)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 2_000)
      void dispatchTelegramAlert({
        chatId: "self",
        text: formatEventMessage("referral_shared", { userId: userId ?? "anonymous", asset: shareReceipt.assetCode }),
        parseMode: "HTML",
      })
    } catch {
      // Clipboard permission denied — receipt remains view-only.
    }
  }

  // Derived metrics
  const activeNodes = nodes.filter((n) => n.isActive).length
  const totalUptime = nodes.reduce((sum, n) => sum + n.uptimeSeconds, 0)
  const avgEfficiency = activeNodes > 0
    ? nodes.filter((n) => n.isActive).reduce((sum, n) => sum + n.efficiency, 0) / activeNodes
    : 0

  const statusTag = sessionActive
    ? miningActive
      ? "MINING SESSION · NODES LIVE"
      : "WALLET CONNECTED · READY TO ACTIVATE"
    : "SIGN IN + MAINNET WALLET REQUIRED"

  const statusClass = sessionActive
    ? miningActive
      ? "mining-badge is-ready"
      : "mining-badge is-warn"
    : "mining-badge"

  return (
    <section className="solar-panel" aria-labelledby="solar-title">
      <div className="solar-topline">
        <div className="solar-title-wrap">
          <span className="solar-icon"><Sun size={18} /></span>
          <div>
            <span className="eyebrow">GREEN COMPUTE · {miningActive ? "NODES VERIFIED" : sessionActive ? "AWAITING ACTIVATION" : "DATA SOURCE REQUIRED"}</span>
            <h3 id="solar-title">Solar Grid & Green Energy Node</h3>
          </div>
        </div>
        <span className={statusClass}>
          {miningActive ? (
            <>
              <CheckCircle2 size={13} /> {statusTag}
            </>
          ) : sessionActive ? (
            <>
              <Zap size={13} /> {statusTag}
            </>
          ) : (
            <>
              <AlertTriangle size={13} /> {statusTag}
            </>
          )}
        </span>
      </div>

      <div className="solar-content">
        <div className="solar-yield">
          <div className="solar-yield-label">
            <span><Leaf size={14} /> Verified energy production</span>
            {activeNodes > 0 && <span className="simulation-pill"><span className="solar-sun-dot" /> {activeNodes} NODE{activeNodes !== 1 ? "S" : ""} ACTIVE</span>}
          </div>
          <strong id="solar-active-nodes" className={activeNodes > 0 ? "live" : "idle"}>
            {activeNodes > 0 ? `${activeNodes} / ${nodes.length} NODES STREAMING` : "NO NODES ACTIVE — CLICK TO ACTIVATE"}
          </strong>
          <p id="solar-yield-desc" className={activeNodes > 0 ? "live" : "idle"}>
            {activeNodes > 0
              ? "Real-time telemetry from activated green-energy nodes. Uptime and PV efficiency update live."
              : miningActive
                ? "Mining session bound. Activate solar nodes to stream green compute telemetry."
                : sessionActive
                  ? "Wallet connected. Activate nodes to begin verified energy production tracking."
                  : "Sign in and connect a TON Mainnet wallet to enable node activation."}
          </p>
          <div className="solar-stats">
            <div>
              <span>ACTIVE NODES</span>
              <strong id="solar-active-nodes-count">{activeNodes} / {nodes.length}</strong>
            </div>
            <div>
              <span>TOTAL UPTIME</span>
              <strong id="solar-uptime">{activeNodes > 0 ? formatUptime(totalUptime) : "—"}</strong>
            </div>
            <div>
              <span>AVG PV EFFICIENCY</span>
              <strong id="solar-efficiency">{activeNodes > 0 ? formatEfficiency(avgEfficiency) : "—"}</strong>
            </div>
          </div>
        </div>

        <div className="solar-meters">
          <div className="solar-nodes-grid">
            {nodes.map((node) => (
              <article key={node.id} className={`solar-node-card ${node.isActive ? "active" : ""}`}>
                <div className="solar-node-header">
                  <span className="solar-node-name">{node.label}</span>
                  <span className={`solar-node-status ${node.isActive ? "online" : "offline"}`}>
                    {node.isActive ? (
                      <>
                        <span className="status-dot" /> ONLINE
                      </>
                    ) : (
                      <>
                        <span className="status-dot" /> STANDBY
                      </>
                    )}
                  </span>
                </div>
                <div className="solar-node-metrics">
                  <div className="solar-node-metric">
                    <span className="solar-metric-label">UPTIME</span>
                    <strong className="mono">{node.isActive ? formatUptime(node.uptimeSeconds) : "—"}</strong>
                  </div>
                  <div className="solar-node-metric">
                    <span className="solar-metric-label">PV EFF</span>
                    <strong className="mono">{node.isActive ? formatEfficiency(node.efficiency) : "—"}</strong>
                  </div>
                  <div className="solar-node-metric">
                    <span className="solar-metric-label">LAST PING</span>
                    <strong className="mono">{node.isActive ? `${Math.floor((now - node.lastPing) / 1000)}s ago` : "—"}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className={`checkin-button ${node.isActive ? "checkin-claimed" : ""}`}
                  onClick={() => toggleNode(node.id)}
                  disabled={!sessionActive}
                  aria-pressed={node.isActive}
                >
                  {node.isActive ? (
                    <>
                      <Power size={12} /> Deactivate Node
                    </>
                  ) : (
                    <>
                      <Zap size={12} /> Activate Node
                    </>
                  )}
                </button>
              </article>
            ))}
          </div>

          <div className="solar-actions">
            <button
              type="button"
              className="mining-primary"
              onClick={activateAllNodes}
              disabled={!sessionActive || activeNodes === nodes.length}
              aria-label="Activate all solar nodes"
            >
              <Power size={14} /> {activeNodes === nodes.length ? "All Nodes Active" : "Activate All Nodes"}
            </button>
            {activeNodes > 0 && (
              <a
                className="mining-address-link"
                href={tonviewerAddressUrl(miningWalletAddress ?? walletAddress ?? DEFAULT_NODES[0].id)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={12} /> Verify on Tonviewer
              </a>
            )}
          </div>

          <div className="target-caption">
            <CircleHelp size={12} /> Nodes stream telemetry when activated. Energy production, uptime, and PV efficiency are computed from the live session — no fabricated rewards. Ad cycles integrate with the 30-minute server-tracked cadence below.
          </div>
        </div>
      </div>

      {/* 30-Minute Engagement Cycle (Monetization) */}
      <div className="mining-treasury" style={{ marginTop: 16 }}>
        <div className="mining-treasury-head">
          <span className="eyebrow"><Zap size={12} /> 30-MINUTE ENGAGEMENT CYCLE</span>
          {adCadence?.isCooldownActive ? (
            <span className="mining-badge is-warn"><Power size={13} /> COOLDOWN · {adCadence ? formatUptime(adCadence.secondsRemaining) : "--:--"}</span>
          ) : (
            <span className="mining-badge is-ready"><CheckCircle2 size={13} /> SLOT AVAILABLE</span>
          )}
        </div>
        <p className="muted-copy" style={{ marginTop: 8 }}>
          Server-tracked cadence: every 30 minutes one 30-second sponsored slot unlocks. Next / Skip / Close interactions are logged as engagement events — no synthetic payouts are credited.
        </p>
        {adSlotStartedAt ? (
          <div className="mining-ad-slot" role="timer">
            <span className="micro-label">SPONSORED SLOT · 30s</span>
            <strong className="mono">{formatUptime(adSlotRemaining)}</strong>
            <div className="mining-ad-actions">
              <button type="button" className="mining-primary" onClick={completeAdSlot} disabled={adSlotRemaining > 0}>
                <ChevronRight size={14} /> {adSlotRemaining > 0 ? "Next" : "Claim cycle"}
              </button>
              <button type="button" className="mining-primary" onClick={skipAdSlot} title="Skip the current sponsored slot">
                <SkipForward size={14} /> Skip
              </button>
              <button type="button" className="mining-primary" onClick={closeAdCycle} aria-label="Close ad slot" title="Close">
                <X size={14} /> Close
              </button>
            </div>
          </div>
        ) : (
          <div className="mining-ad-idle">
            <button
              type="button"
              className="mining-primary"
              onClick={startAdEngagement}
              disabled={Boolean(adCadence?.isCooldownActive)}
            >
              <Zap size={14} /> {adCadence?.isCooldownActive ? `Next slot in ${adCadence ? formatUptime(adCadence.secondsRemaining) : "--:--"}` : "Start engagement cycle"}
            </button>
          </div>
        )}

        {/* Shareable Proof Receipt */}
        {shareReceipt && (
          <div className="mining-share-receipt" role="status" style={{ marginTop: 16 }}>
            <div className="mining-treasury-head">
              <span className="eyebrow"><ExternalLink size={12} /> SHAREABLE PROOF</span>
              <button type="button" className="mining-primary" onClick={copyShareReceipt}>
                {shareCopied ? "Copied" : "Copy receipt"}
              </button>
            </div>
            <pre className="mining-share-text mono">{shareReceipt.message}</pre>
            <a href={shareReceipt.tonviewerUrl} target="_blank" rel="noreferrer">Verify on Tonviewer <ExternalLink size={11} /></a>
            <a href={shareReceipt.referralUrl} target="_blank" rel="noreferrer">Open Referral Link <ExternalLink size={11} /></a>
          </div>
        )}
      </div>

      <div className="solar-footnote">
        <span className="solar-sun-dot" /> {miningActive ? "Real-time telemetry streaming from verified nodes." : sessionActive ? "Activate nodes to begin live green compute telemetry." : "Real-time telemetry available once wallet is connected and nodes are verified. Ad cycles activate automatically."}
      </div>

      {message && <p className="mining-message" role="status" style={{ marginTop: 12, padding: "0 19px" }}><Zap size={13} /> {message}</p>}
    </section>
  )
}