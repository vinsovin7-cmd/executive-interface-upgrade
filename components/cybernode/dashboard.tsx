"use client"

import { useEffect, useState } from "react"
import {
  Activity, ArrowDownLeft, ArrowUpRight, Blocks, CheckCircle2, CircleHelp,
  Cpu, Gauge, HardDrive, LayoutDashboard, LogOut, Menu, Network, Radio, Settings, ShieldCheck, Sparkles,
  Wallet, X, Zap,
} from "lucide-react"
import { TonConnectButton, useTonAddress, useTonWallet } from "@tonconnect/ui-react"
import { AuthPanel } from "@/components/cybernode/auth-panel"
import { AccountTelemetry } from "@/components/cybernode/account-telemetry"
import { TelegramAccountLink } from "@/components/cybernode/telegram-account-link"
import { SolarEnergyModule } from "@/components/cybernode/solar-energy-module"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/lib/supabase/types"
import { LiveTonTelemetry } from "@/components/cybernode/live-ton-telemetry"
import { SessionMiningTelemetry } from "@/components/cybernode/session-mining-telemetry"
import { ActivityConsent } from "@/components/cybernode/activity-consent"
import { AdsgramRewards } from "@/components/cybernode/adsgram-rewards"
import { OwnerVaultSettings } from "@/components/cybernode/owner-vault"
import { DexSwap } from "@/components/cybernode/dex-swap"
import { ValueTracking } from "@/components/cybernode/value-tracking"
import { MiningConsole } from "@/components/cybernode/mining-console"
import { DEFAULT_TREASURY_ADDRESS } from "@/lib/mining/config"

type Tab = "hub" | "wallet" | "rewards" | "analytics" | "settings"
const navigation: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "hub", label: "CyberNode Hub", icon: LayoutDashboard },
  { id: "wallet", label: "Wallet & payouts", icon: Wallet },
  { id: "rewards", label: "Ad rewards", icon: Sparkles },
  { id: "analytics", label: "Analytics & ledger", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
]
const edgeNavigation = [
  { id: "edge-overview", label: "Edge overview", icon: Network },
  { id: "edge-readiness", label: "Worker readiness", icon: Cpu },
  { id: "edge-telemetry", label: "Mainnet telemetry", icon: Radio },
  { id: "edge-diagnostics", label: "Hardware diagnostics", icon: HardDrive },
]

function ReadinessCard({ icon: Icon, title, detail, status }: { icon: typeof Cpu; title: string; detail: string; status: string }) {
  return <article className="readiness-card"><span className="readiness-icon"><Icon size={17}/></span><div className="readiness-copy"><strong>{title}</strong><p>{detail}</p></div><span className="readiness-status"><i/>{status}</span></article>
}

function UnavailablePanel({ icon: Icon, title, detail }: { icon: typeof Blocks; title: string; detail: string }) {
  return <section className="panel unavailable-panel"><div className="unavailable-icon"><Icon size={18}/></div><span className="eyebrow">NOT CONFIGURED</span><h3>{title}</h3><p>{detail}</p><span className="unavailable-note"><CircleHelp size={13}/> No sample values are shown</span></section>
}

function RadarVisual({ networkLabel }: { networkLabel: string }) {
  return <div className="radar-visual" aria-hidden="true">
    <div className="radar-disc">
      <span className="radar-axis radar-axis-x"/><span className="radar-axis radar-axis-y"/>
      <span className="matrix-orbit matrix-orbit-alpha"/><span className="matrix-orbit matrix-orbit-beta"/><span className="matrix-orbit matrix-orbit-gamma"/>
      <span className="radar-sweep"/><span className="radar-target target-one"/><span className="radar-target target-two"/>
      <span className="radar-target target-three"/><span className="radar-target target-four"/>
      <span className="radar-core matrix-core-drift"><Cpu size={22}/><i className="radar-hidden-diamond"/></span>
      <span className="radar-label radar-label-top">CHAIN <b>{networkLabel}</b></span>
      <span className="radar-label radar-label-bottom">SOURCE <b>UNVERIFIED</b></span>
    </div>
  </div>
}

function EdgeComputeSection({ networkLabel, walletAddress, userId, onSignIn }: { networkLabel: string; walletAddress: string | null; userId: string | null; onSignIn: () => void }) {
  return <div className="page-stack">
    <section id="edge-overview" className="hero-card edge-hero"><div className="hero-copy"><div className="section-kicker"><span className="pulse-dot"/> DEPIN / EDGE COMPUTE <span className="kicker-line"/></div><h2>Compute at the edge.<br/><span>Evidence before earnings.</span></h2><p>Read-only Mainnet balances are live. Compute, worker health, routing, and rewards stay gated until their operators and contracts are independently verified.</p><div className="hero-actions"><span className="hero-note"><ShieldCheck size={14}/> User-controlled wallet</span><span className="network-pill"><span className="status-light muted"/> {networkLabel}</span></div></div><RadarVisual networkLabel={networkLabel}/><div className="hero-bottom"><div><span className="micro-label">WORKER POOL</span><strong><span className="status-light muted"/> NOT CONNECTED</strong></div><div><span className="micro-label">TELEMETRY</span><strong>TONCENTER · READ ONLY</strong></div><div><span className="micro-label">SETTLEMENT</span><strong><span className="status-light muted"/> NOT CONFIGURED</strong></div><span className="hero-id mono">EDGE COMPUTE</span></div></section>
    <div id="edge-telemetry" style={{ scrollMarginTop: 84 }}><LiveTonTelemetry walletAddress={walletAddress} userId={userId} onSignIn={onSignIn}/></div>
    <div id="edge-readiness" className="readiness-list" style={{ scrollMarginTop: 84 }}><ReadinessCard icon={Cpu} title="Compute operator" detail="An independently verified worker daemon and uptime source are still required." status="REQUIRED"/><ReadinessCard icon={Activity} title="Account activity" detail="An authenticated browser heartbeat is available; it does not prove compute or earnings." status="OPT-IN READY"/><ReadinessCard icon={Blocks} title="Multi-chain routing" detail="Only verified chain providers and documented contract calls can be enabled." status="REQUIRED"/><ReadinessCard icon={ShieldCheck} title="Non-custodial settlement" detail="Payouts must remain user-signed and bound to an audited contract." status="REQUIRED"/></div>
    <div id="edge-diagnostics" className="analytics-grid depin-metrics" style={{ scrollMarginTop: 84 }}><UnavailablePanel icon={Activity} title="Compute worker health" detail="No independently verified compute worker is connected. Browser activity pings are not compute proof."/><UnavailablePanel icon={Gauge} title="Node health & latency" detail="No verified health endpoint is configured."/><UnavailablePanel icon={Zap} title="Yield & rewards" detail="No verified pool or contract events are available; no estimates are fabricated."/><UnavailablePanel icon={Blocks} title="Staking & compute engines" detail="No audited TON/GRAM staking contract or verified worker protocol is configured. No HP balance, yield, or multiplier is generated."/></div>
    <section className="readiness-footer"><CircleHelp size={14}/><span>Before enabling live compute or settlement, provide the worker telemetry endpoint and authentication model, verified contract addresses and audit/source links, and the chain-indexing source. Rewards and transactions remain disabled until those inputs can be independently verified.</span></section>
  </div>
}

type WalletConnection = Database["public"]["Tables"]["wallet_connections"]["Row"]
type LedgerEntry = Database["public"]["Tables"]["ledger_entries"]["Row"]

type DashboardProps = {
  userId: string | null
  userEmail: string | null
  profileEmail: string | null
  authProvider: string | null
  profileName: string | null
  accountCreatedAt: string | null
  lastSignInAt: string | null
  emailVerified: boolean
  walletConnections: WalletConnection[]
  ledgerEntries: LedgerEntry[]
  databaseError: boolean
  isAdmin: boolean
}

export function Dashboard({ userId, userEmail, profileEmail, authProvider, profileName, accountCreatedAt, lastSignInAt, emailVerified, walletConnections, ledgerEntries, databaseError, isAdmin }: DashboardProps) {
  const [tab, setTab] = useState<Tab>("hub")
  const [authCallbackMessage, setAuthCallbackMessage] = useState("")
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedTab = params.get("tab")
    if (requestedTab === "hub" || requestedTab === "wallet" || requestedTab === "rewards" || requestedTab === "analytics" || requestedTab === "settings") setTab(requestedTab)
    if (params.get("authError") === "callback") {
      setAuthCallbackMessage("Google sign-in could not be completed. Please try again or use email sign-in.")
      setAuthOpen(true)
      params.delete("authError")
      window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.hash}`)
      const query = params.toString()
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
    }
  }, [])
  const [section, setSection] = useState<1 | 2>(1)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [edgeTarget, setEdgeTarget] = useState("edge-overview")
  const [savedWalletAddress, setSavedWalletAddress] = useState<string | null>(null)
  const [walletSaveMessage, setWalletSaveMessage] = useState("")
  const address = useTonAddress()
  const wallet = useTonWallet()
  const walletChain = wallet ? String(wallet.account.chain) : null
  const networkLabel = walletChain === "-239" ? "MAINNET" : walletChain === "-3" ? "TESTNET" : wallet ? "NETWORK UNKNOWN" : "MAINNET TARGET"
  const networkStatus = walletChain === "-239" ? "CONNECTED · MAINNET" : walletChain === "-3" ? "CONNECTED · TESTNET" : wallet ? "CONNECTED · UNKNOWN NETWORK" : "MAINNET TARGET · NOT CONNECTED"
  const currentTitle = navigation.find((item) => item.id === tab)?.label ?? "CyberNode Hub"
  const accountTelemetry = <AccountTelemetry userId={userId} email={profileEmail ?? userEmail} profileName={profileName} provider={authProvider} createdAt={accountCreatedAt} lastSignInAt={lastSignInAt} emailVerified={emailVerified} walletAddress={address || null} networkStatus={networkStatus} ledgerCount={ledgerEntries.length} latestActivityAt={ledgerEntries[0]?.created_at ?? null}/>
  const changeTab = (next: Tab) => {
    setTab(next)
    setMobileOpen(false)
    window.history.replaceState(null, "", next === "hub" ? "/" : `/?tab=${next}`)
  }
  const changeSection = (next: 1 | 2) => {
    setSection(next)
    setMobileOpen(false)
    if (next === 2) setEdgeTarget("edge-overview")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const goToEdgeTarget = (target: string) => {
    setEdgeTarget(target)
    setMobileOpen(false)
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const walletAlreadySaved = Boolean(address && (savedWalletAddress === address || walletConnections.some((item) => item.address === address)))

  const saveWallet = async () => {
    if (!userId || !address || walletChain !== "-239") return
    const { error } = await createClient().from("wallet_connections").insert(
      { user_id: userId, network: "ton-mainnet", address },
    )
    const alreadySaved = error?.code === "23505"
    setWalletSaveMessage(error && !alreadySaved ? "Wallet could not be saved. Try again." : "Mainnet wallet saved to your account.")
    if (!error || alreadySaved) setSavedWalletAddress(address)
  }

  useEffect(() => {
    if (!userId || !address || walletChain !== "-239") return
    if (savedWalletAddress === address || walletConnections.some((item) => item.address === address)) return
    let cancelled = false
    void (async () => {
      const { error } = await createClient().from("wallet_connections").insert({ user_id: userId, network: "ton-mainnet", address })
      if (cancelled) return
      if (!error || error.code === "23505") {
        setSavedWalletAddress(address)
        setWalletSaveMessage("Connected Mainnet wallet synced to your account.")
      } else {
        setWalletSaveMessage("Wallet is connected but could not be synced to your account.")
      }
    })()
    return () => { cancelled = true }
  }, [userId, address, walletChain, savedWalletAddress, walletConnections])

  const signOut = async () => {
    const { error } = await createClient().auth.signOut()
    if (!error) window.location.reload()
  }

  const content = () => {
    if (section === 2) return <EdgeComputeSection networkLabel={networkLabel} walletAddress={walletChain === "-239" ? address : null} userId={userId} onSignIn={() => setAuthOpen(true)}/>
    if (tab === "wallet") return <div className="page-stack">
      <MiningConsole userId={userId} walletAddress={walletChain === "-239" ? address : null} onSignIn={() => setAuthOpen(true)}/>
      <LiveTonTelemetry walletAddress={walletChain === "-239" ? address : null} userId={userId} onSignIn={() => setAuthOpen(true)}/>
      <section className="notice-card"><ShieldCheck size={18}/><div><strong>Real on-chain settlement</strong><p>Your bound wallet receives real TON Mainnet payouts — TON natively, GRAM and USDT as jettons — signed by the treasury signer that controls the configured treasury address. The 600-second accumulation gate and the 30% user / 70% treasury split apply to every credited reward.</p></div></section>
      <DexSwap walletChain={walletChain}/>
      <div className="wallet-grid"><section className="panel balance-panel"><span className="eyebrow">ON-CHAIN BALANCE</span><div className="balance-amount">Live <small>DATA</small></div><p>Read-only TON and GRAM / GRM balances are shown in the Mainnet telemetry panel.</p><div className="balance-divider"/><div className="wallet-detail"><span>Connected wallet</span><strong>{address ? `${address.slice(0, 6)}…${address.slice(-5)}` : "Not connected"}</strong></div><div className="wallet-detail"><span>Network</span><strong>{networkStatus}</strong></div><div className="saved-wallets"><strong>Saved TON wallets</strong>{walletConnections.length ? walletConnections.map((item) => <span key={item.id}>{item.address.slice(0, 8)}…{item.address.slice(-6)} <small>{item.network}</small></span>) : <span>No wallets saved to this account.</span>}{userId && address && walletChain === "-239" && !walletAlreadySaved && <button type="button" className="save-wallet-action" onClick={saveWallet}><Wallet size={14}/> Save connected mainnet wallet</button>}{walletAlreadySaved && <span className="saved-confirmation"><CheckCircle2 size={13}/> Wallet saved</span>}{walletSaveMessage && <span className="wallet-save-message" role="status">{walletSaveMessage}</span>}</div><button className="disabled-action" disabled><ArrowUpRight size={16}/> Claim & withdraw <span>Use the suite above</span></button><p className="button-help">One-click withdrawal runs from the private mining suite above, using your bound Tonkeeper wallet and the configured treasury signer.</p></section>
      <section className="panel gas-panel"><div className="panel-header"><div><span className="eyebrow">NETWORK FEES</span><h3>TON transaction fees</h3></div><span className="sample-tag">NO ESTIMATE</span></div><p className="muted-copy">TON has no universal gas-price quote. Fees depend on the exact transfer message and execution, so no estimate is shown until a transaction is prepared. Network fees are paid to the TON network by the signed transfer.</p><div className="fee-principle"><CheckCircle2 size={16}/><span>Payouts are signed by the treasury signer that controls the configured treasury wallet below.</span></div><div className="ad-slot"><span>TREASURY SETTLEMENT WALLET</span><small className="mono">{DEFAULT_TREASURY_ADDRESS}</small></div></section></div>
      <section className="panel"><div className="panel-header"><div><span className="eyebrow">PAYOUT HISTORY</span><h3>On-chain transaction ledger</h3></div><span className="sample-tag">TONVIEWER VERIFIABLE</span></div><div className="empty-ledger"><div className="empty-ledger-icon"><ArrowDownLeft size={18}/></div><strong>Payouts appear here after broadcast</strong><span>Every broadcast payout stores its real TON transaction hash and a direct Tonviewer link, also shown in the private mining suite above.</span></div></section>
    </div>

    if (tab === "rewards") return <div className="page-stack"><section className="notice-card"><Sparkles size={18}/><div><strong>Verified ad rewards</strong><p>AdsGram callbacks are verified with the shared secret, then credited through the split engine (30% user / 70% treasury) with a per-minute event key so provider retries cannot replay a claim.</p></div></section><MiningConsole userId={userId} walletAddress={walletChain === "-239" ? address : null} onSignIn={() => setAuthOpen(true)}/><AdsgramRewards userId={userId} onSignIn={() => setAuthOpen(true)}/><ValueTracking userId={userId} walletAddress={walletChain === "-239" ? address : null} onSignIn={() => setAuthOpen(true)}/></div>

    if (tab === "settings") return <div className="page-stack">{accountTelemetry}<TelegramAccountLink userId={userId}/><OwnerVaultSettings isAdmin={isAdmin}/></div>

    if (tab === "analytics") return <div className="page-stack">{accountTelemetry}<section className="notice-card"><Activity size={18}/><div><strong>Analytics are awaiting a data source</strong><p>No sample charts or ledger rows are shown. Connect a verified mainnet contract and chain indexer to display on-chain events.</p></div></section><div className="analytics-grid"><UnavailablePanel icon={Gauge} title="Node yield" detail="No mining contract or pool endpoint is configured."/><UnavailablePanel icon={Zap} title="Gas fees" detail="No verified transactions are available to calculate network fees."/><UnavailablePanel icon={Sparkles} title="Ad revenue share" detail="No ad provider or settlement feed is connected."/></div><section className="panel"><div className="panel-header"><div><span className="eyebrow">SUPABASE LEDGER</span><h3>Verified operator entries</h3></div><span className="sample-tag">{databaseError ? "SYNC ERROR" : `${ledgerEntries.length} RECORDS`}</span></div>{databaseError ? <p className="muted-copy">The account-scoped database could not be read. No fallback or sample ledger is displayed.</p> : ledgerEntries.length ? <div className="ledger-rows">{ledgerEntries.map((entry) => <div className="ledger-row" key={entry.id}><div><strong>{entry.entry_type.replaceAll("_", " ")}</strong><small>{entry.transaction_hash ? `${entry.transaction_hash.slice(0, 8)}…${entry.transaction_hash.slice(-6)}` : "No transaction hash"}</small></div><span>{Number(entry.amount).toLocaleString("en-US")} {entry.asset_master}</span><span className="ledger-status">{entry.status}</span></div>)}</div> : <p className="muted-copy">No verified entries are stored for this account. Ledger records are readable only by their owner and are written by trusted verification services.</p>}</section></div>

    return <>
      <section className="hero-card"><div className="hero-copy"><div className="section-kicker"><span className="pulse-dot"/> MAINNET SETUP <span className="kicker-line"/></div><h2>Real network.<br/><span>Verified values only.</span></h2><p>Bind your Tonkeeper wallet to activate a real-time mining session. Rewards accrue against your 30% share, withdrawals unlock after a 600-second accumulation gate, and payouts settle on-chain to your bound wallet.</p><div className="hero-actions"><span className="hero-note"><ShieldCheck size={14}/> No fabricated activity</span><span className="network-pill"><span className={`status-light ${walletChain === "-239" ? "active" : "muted"}`}/> TON {networkLabel}</span></div></div><RadarVisual networkLabel={networkLabel}/><div className="hero-bottom"><div><span className="micro-label">MINING SESSION</span><strong><span className={`status-light ${walletChain === "-239" ? "active" : "muted"}`}/>ACTIVATION ON BIND</strong></div><div><span className="micro-label">CONNECTED WALLET</span><strong>{address ? `${address.slice(0, 6)}…${address.slice(-5)}` : "NONE"}</strong></div><div><span className="micro-label">PAYOUT ENGINE</span><strong><span className="status-light active"/>TREASURY-SIGNED</strong></div><span className="hero-id mono">MAINNET</span></div></section>
      <MiningConsole userId={userId} walletAddress={walletChain === "-239" ? address : null} onSignIn={() => setAuthOpen(true)}/>
      <SolarEnergyModule />
      <LiveTonTelemetry walletAddress={walletChain === "-239" ? address : null} userId={userId} onSignIn={() => setAuthOpen(true)}/>
      <SessionMiningTelemetry userId={userId} walletAddress={walletChain === "-239" ? address : null}/>
      <div className="readiness-list"><ReadinessCard icon={Wallet} title="Tonkeeper / TON wallet" detail={address ? "Wallet session connected" : "Connect with the real TonConnect wallet picker"} status={address ? "CONNECTED" : "READY"}/><ReadinessCard icon={Blocks} title="GRAM / GRM token master" detail="Toncenter indexes the supplied Mainnet master; this is not an independent audit." status="INDEXED"/><ReadinessCard icon={ShieldCheck} title="Treasury settlement" detail="Payouts are signed by the treasury signer that controls the configured treasury wallet." status="TREASURY-SIGNED"/><ReadinessCard icon={Activity} title="On-chain indexer" detail="Toncenter API v3 returns current Mainnet masterchain data." status="LIVE · READ ONLY"/></div>
      <div className="readiness-list"><ReadinessCard icon={Gauge} title="Session mining" detail="Real-time accrual starts the moment a wallet is bound to your account." status="LIVE ON BIND"/><ReadinessCard icon={Blocks} title="Verified rewards" detail="Task, session, and AdsGram rewards credit your 30% share; the 70% treasury share is retained." status="30 / 70 SPLIT"/></div>
      <div className="readiness-footer"><CircleHelp size={14}/><span>Real payouts require GRAM jetton liquidity plus TON gas at the treasury address, and the server-side treasury signer mnemonic (TON_TREASURY_SIGNER_MNEMONIC) that controls it. Without those, mining and accrual still run and the payout engine reports exactly what is missing.</span></div>
    </>
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}><div className="brand"><div className="brand-mark">{section === 2 ? <Network size={19}/> : <Cpu size={19}/>}<i/></div><div className="brand-name">CYBER<span>NODE</span><small>{section === 2 ? "DEPIN / EDGE · MAINNET" : "GRAM MINER · MAINNET"}</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19}/></button></div><div className="sidebar-label">{section === 2 ? "EDGE MODULES" : "WORKSPACE"}</div><nav aria-label={section === 2 ? "Edge compute modules" : "Main navigation"}>{section === 2 ? edgeNavigation.map(({id,label,icon:Icon}) => <button key={id} className={`nav-item ${edgeTarget === id ? "nav-active" : ""}`} onClick={() => goToEdgeTarget(id)} aria-current={edgeTarget === id ? "location" : undefined}><Icon size={17}/><span>{label}</span></button>) : navigation.map(({id,label,icon:Icon}) => <button key={id} className={`nav-item ${tab === id ? "nav-active" : ""}`} onClick={() => changeTab(id)} aria-current={tab === id ? "page" : undefined}><Icon size={17}/><span>{label}</span>{id === "hub" && <span className="nav-live"/>}</button>)}</nav><div className="sidebar-spacer"/>{section === 2 ? <div className="sidebar-node-card"><div className="sidebar-node-heading"><span className="status-light muted"/> EDGE STATUS <span className="sidebar-node-sim">{networkLabel}</span></div><strong>WORKERS OFFLINE</strong><div className="sidebar-node-meta"><span>Hardware diagnostics</span><span>—</span></div><div className="sidebar-node-meta"><span>Edge telemetry</span><span>READ ONLY</span></div><small>Verified worker source required</small></div> : <div className="sidebar-node-card"><div className="sidebar-node-heading"><span className="status-light muted"/> NETWORK STATUS <span className="sidebar-node-sim">{networkLabel}</span></div><strong>MINING SESSION</strong><div className="sidebar-node-meta"><span>Treasury split</span><span>30% / 70%</span></div><small>Wallet-bound real-time accrual</small></div>}<div className="sidebar-ad"><span className="ad-label">AD PLACEMENT</span><div className="ad-placeholder"><Zap size={14}/><span>Provider not connected</span></div><small>AdsGram rewards credit to GRAM</small></div><div className="sidebar-footer"><span className="build-indicator"/><span>{networkStatus}</span><span className="version-tag">v0.1</span></div></aside>
    {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation"/>}
    <main className="main-area"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumbs"><span>CyberNode</span><span className="crumb-slash">/</span><strong>{section === 2 ? "DePIN / Edge" : currentTitle}</strong></div><div className="topbar-right"><div className="section-switch" role="group" aria-label="Platform section"><button type="button" className={section === 1 ? "section-option section-option-active" : "section-option"} onClick={() => changeSection(1)} aria-pressed={section === 1} aria-label="Section 1: CyberNode Core Miner"><span className="section-index">01</span><span className="section-label-full">Core Miner</span><span className="section-label-short">Core</span></button><button type="button" className={section === 2 ? "section-option section-option-active" : "section-option"} onClick={() => changeSection(2)} aria-pressed={section === 2} aria-label="Section 2: DePIN & Multi-Chain Edge Compute Stack"><span className="section-index">02</span><span className="section-label-full">DePIN / Edge</span><span className="section-label-short">Edge</span></button></div><div className="market-ticker"><span className="ticker-live"/><span>TON</span><strong>—</strong><span className="ticker-divider"/><span>GRAM</span><strong>—</strong><span className="ticker-source">PRICE SOURCE REQUIRED</span></div><div className="top-status"><span className={`status-light ${walletChain === "-239" ? "active" : "muted"}`}/>{networkStatus}</div><div className="tonconnect-wrap"><TonConnectButton/></div>{profileEmail ?? userEmail ? <div className="account-control"><span className="account-email" title={profileEmail ?? userEmail ?? undefined}>{profileEmail ?? userEmail}</span><button type="button" onClick={signOut} aria-label="Sign out"><LogOut size={14}/></button></div> : <button type="button" className="auth-open-button" onClick={() => setAuthOpen(true)}>Sign in</button>}<span className="address-chip" title={address || "Connect a TON wallet"}><span className="wallet-avatar"><Wallet size={13}/></span>{address ? `${address.slice(0,6)}…${address.slice(-5)}` : "Wallet"}</span></div></header>
      <div className="content-area"><div className="page-heading"><div><div className="breadcrumb-mobile">CYBERNODE <span>/</span> MAINNET</div><h1>{section === 2 ? "DePIN & Multi-Chain Edge Compute Stack" : currentTitle}</h1><p>{section === 2 ? "Live Mainnet data is read-only; compute and settlement stay gated until independently verified." : tab === "hub" ? "Bind a wallet to mine in real time; withdrawals unlock after 600 seconds." : tab === "wallet" ? "Bind a wallet and withdraw real TON Mainnet payouts." : tab === "rewards" ? "Ads are opt-in; only verified ledger entries count as rewards." : tab === "settings" ? "Private owner controls stay server-gated and never expose saved credentials." : "Real chain and ledger data will appear after verification."}</p></div><div className="heading-date"><span className="status-light muted"/> MAINNET ONLY <span className="date-separator">·</span> 600s GATE · 30/70 SPLIT</div></div>
        {isAdmin && <a className="admin-shortcut" href="/admin"><ShieldCheck size={14}/> Global telemetry <span>ADMIN</span></a>}
        <ActivityConsent userId={userId} autoEngage={walletChain === "-239"} onSignIn={() => setAuthOpen(true)} />
        {content()}
        <footer className="content-footer"><span>{section === 2 ? "CYBERNODE EDGE COMPUTE" : "CYBERNODE GRAM MINER"} <b>·</b> MAINNET</span><span><ShieldCheck size={12}/> Real Mainnet reads and treasury-signed payouts; no mock balances or simulated mining.</span></footer>
      </div></main>
    <AuthPanel open={authOpen} onClose={() => setAuthOpen(false)} initialMessage={authCallbackMessage}/>
  </div>
}
