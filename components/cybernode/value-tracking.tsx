"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { AlertTriangle, ArrowDownLeft, CheckCircle2, Copy, ExternalLink, Link2, ShieldCheck, Sparkles, Wallet } from "lucide-react"
import {
  ASSET_DECIMALS, ASSET_MINIMUMS, MINIMUM_ACCUMULATION_SECONDS, formatAtomic, percentLabel, tonviewerTransactionUrl,
} from "@/lib/mining/config"

type Mining = {
  status: string
  walletAddress: string | null
  startedAt: string | null
  unlockAt: string | null
  secondsRemaining: number
  withdrawalLocked: boolean
  minimumAccumulationSeconds: number
}

type ValueData = {
  wallet: { address: string; status: string; created_at: string } | null
  airdrops: { id: string; campaign_key: string; status: string; created_at: string }[]
  quests: { id: string; quest_key: string; status: string; created_at: string }[]
  withdrawals: { id: string; asset_code: string; amount_atomic: string; asset_decimals: number; destination: string; status: string; transaction_hash: string | null; failure_reason: string | null; created_at: string }[]
  balances: { asset_code: string; available_atomic: string; earned_today_atomic: string; daily_cap_atomic: string; minimum_withdrawal_atomic: string }[]
  referral: { referral_code: string; tier1_count: number; tier2_count: number; tier1_commission_atomic: string; tier2_commission_atomic: string } | null
  mining: Mining
  split: { userShareBps: number; treasuryShareBps: number }
}

type PayoutReceipt = { transactionHash: string; tonviewerUrl: string; assetCode: string; amountAtomic: string; confirmed: boolean }

const questOptions = [
  { key: "verify-email", title: "Verify your email", detail: "Confirm the email on your CyberNode account." },
  { key: "link-telegram", title: "Link Telegram", detail: "Verify your Telegram identity in account settings." },
  { key: "connect-wallet", title: "Connect a TON wallet", detail: "Connect a TON Mainnet wallet using TonConnect." },
]

async function fetchValueData(url: string): Promise<ValueData> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Value activity is unavailable.")
  return result as ValueData
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds)
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function ValueTracking({ userId, walletAddress, onSignIn }: { userId: string | null; walletAddress: string | null; onSignIn: () => void }) {
  const { data, error, mutate } = useSWR<ValueData>(userId ? "/api/value-tracking" : null, fetchValueData, { revalidateOnFocus: true, revalidateOnReconnect: true, refreshInterval: 6_000, refreshWhenHidden: false })
  const [address, setAddress] = useState("")
  const [asset, setAsset] = useState("TON")
  const [amount, setAmount] = useState("")
  const [destination, setDestination] = useState("")
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState("")
  const [receipt, setReceipt] = useState<PayoutReceipt | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const mining = data?.mining
  const minimumSeconds = mining?.minimumAccumulationSeconds ?? MINIMUM_ACCUMULATION_SECONDS
  const userShareBps = data?.split.userShareBps ?? 3000
  const treasuryShareBps = data?.split.treasuryShareBps ?? 7000
  const boundWallet = mining?.walletAddress ?? data?.wallet?.address ?? null

  const secondsRemaining = (() => {
    if (!mining) return minimumSeconds
    if (!mining.unlockAt) return Math.max(0, mining.secondsRemaining)
    const unlockAt = new Date(mining.unlockAt).getTime()
    if (Number.isNaN(unlockAt)) return Math.max(0, mining.secondsRemaining)
    return Math.max(0, Math.ceil((unlockAt - now) / 1000))
  })()
  const unlocked = Boolean(mining?.walletAddress && secondsRemaining <= 0)

  const submit = async (body: Record<string, unknown>, key: string) => {
    if (!userId) { onSignIn(); return false }
    setBusy(key)
    setMessage("")
    try {
      const response = await fetch("/api/value-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Request could not be completed.")
      setMessage(result.message ?? "Request submitted.")
      await mutate()
      return true
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Request could not be completed.")
      return false
    } finally {
      setBusy("")
    }
  }

  const requestWithdrawal = async () => {
    if (!userId) { onSignIn(); return }
    const decimals = ASSET_DECIMALS[asset]
    if (!decimals || !amount || !destination.trim()) return
    setBusy("withdrawal")
    setMessage("")
    setReceipt(null)
    try {
      const queueResponse = await fetch("/api/value-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "withdrawal", assetCode: asset, amount, destination: destination.trim(), idempotencyKey: crypto.randomUUID() }),
      })
      const queued = await queueResponse.json()
      if (!queueResponse.ok) throw new Error(queued.error ?? "Withdrawal could not be queued.")
      const requestId = queued.request?.request_id ?? queued.request?.id
      if (!requestId) throw new Error("Withdrawal was queued without an id.")

      const payoutResponse = await fetch("/api/withdrawals/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ requestId }),
      })
      const payout = await payoutResponse.json()
      if (!payoutResponse.ok) throw new Error(payout.error ?? "On-chain payout could not be completed.")
      setReceipt({
        transactionHash: payout.transactionHash,
        tonviewerUrl: payout.tonviewerUrl,
        assetCode: payout.assetCode,
        amountAtomic: String(payout.amountAtomic),
        confirmed: Boolean(payout.confirmed),
      })
      setMessage(payout.message ?? "On-chain payout broadcast.")
      setAmount("")
      setDestination("")
      await mutate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Withdrawal could not be completed.")
    } finally {
      setBusy("")
    }
  }

  const copyReferral = async () => {
    if (!data?.referral) return
    const referralLink = `${window.location.origin}/?ref=${encodeURIComponent(data.referral.referral_code)}`
    try {
      await navigator.clipboard.writeText(referralLink)
      setInviteCopied(true)
      window.setTimeout(() => setInviteCopied(false), 1800)
    } catch {
      setMessage("Copy is unavailable in this browser. Select and copy the invite URL from your address bar after opening it.")
    }
  }

  return <section className="value-tracking page-stack" aria-labelledby="value-tracking-title">
    <header className="value-tracking-heading">
      <div><span className="eyebrow">ACCOUNT VALUE · LIVE LEDGER</span><h3 id="value-tracking-title">Balances, quests & payouts</h3></div>
      <span className="sample-tag">{percentLabel(userShareBps)} / {percentLabel(treasuryShareBps)} SPLIT</span>
    </header>
    {!userId ? <div className="value-signin"><ShieldCheck size={18}/><span>Sign in to submit and review account activity.</span><button type="button" onClick={onSignIn}>Sign in</button></div> : error ? <p className="value-message" role="status">{error.message} <button type="button" onClick={() => void mutate()}>Retry</button></p> : !data ? <p className="value-loading" role="status">Loading account activity…</p> : <>
      <div className="value-tracking-grid">
        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><Sparkles size={16}/></span><div><span className="eyebrow">LIVE LEDGER · DAILY CAPS</span><h4>Reward balances</h4></div><span className="value-status">VERIFIED CREDITS</span></div>
          <div className="referral-metrics reward-balance-metrics">{data.balances.map((balance) => {
            const decimals = ASSET_DECIMALS[balance.asset_code] ?? 9
            return <div key={balance.asset_code}><strong>{formatAtomic(balance.available_atomic, decimals)} {balance.asset_code}</strong><span>AVAILABLE</span><small>{formatAtomic(balance.earned_today_atomic, decimals)} / {formatAtomic(balance.daily_cap_atomic, decimals)} earned today</small></div>
          })}</div>
          <p className="value-footnote">Verified task completions and qualified active-session intervals credit {percentLabel(userShareBps)} of the gross reward to this balance; the {percentLabel(treasuryShareBps)} treasury share is retained by the platform. Daily caps are 50 GRAM and 5 TON. Pending withdrawals are reserved from available balance. Ads credit this ledger only after an independently verified AdsGram provider settlement.</p>
        </article>
        <article className="panel value-panel">
          <div className="value-panel-title"><span className="value-icon"><Wallet size={16}/></span><div><span className="eyebrow">TON MAINNET</span><h4>Wallet binding</h4></div><span className={`value-status ${data.wallet ? "" : "is-pending"}`}>{data.wallet?.status ?? "NOT LINKED"}</span></div>
          {data.wallet ? <p className="value-description">{data.wallet.address.slice(0, 9)}…{data.wallet.address.slice(-7)} · bound to your account · mining {mining?.status ?? "active"}.</p> : <>
            <p className="value-description">Bind your connected Tonkeeper / TON Mainnet wallet to activate real-time mining. The session starts immediately and withdrawals unlock after {minimumSeconds} seconds of accumulation.</p>
            <label className="value-label" htmlFor="binding-address">TON wallet address</label>
            <input id="binding-address" className="value-input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="UQ… or EQ…" autoComplete="off" maxLength={128}/>
            <button type="button" className="value-action" disabled={Boolean(busy) || !address.trim()} onClick={() => void submit({ action: "bind-wallet", address: address.trim() }, "wallet")}>{busy === "wallet" ? "Activating…" : "Bind wallet & activate mining"}</button>
          </>}
        </article>

        <article className="panel value-panel">
          <div className="value-panel-title"><span className="value-icon"><Sparkles size={16}/></span><div><span className="eyebrow">CAMPAIGN</span><h4>Airdrop eligibility</h4></div><span className="value-status is-pending">MANUAL REVIEW</span></div>
          <p className="value-description">Submit one eligibility request for the CyberNode Mainnet campaign. No token amount or eligibility is guaranteed.</p>
          {data.airdrops.length ? <ul className="value-history">{data.airdrops.map((claim) => <li key={claim.id}><span>CyberNode Mainnet · {new Date(claim.created_at).toLocaleDateString()}</span><strong>{claim.status}</strong></li>)}</ul> : <button type="button" className="value-action" disabled={Boolean(busy)} onClick={() => void submit({ action: "airdrop", campaignKey: "cybernode-mainnet" }, "airdrop")}>{busy === "airdrop" ? "Submitting…" : "Submit eligibility"}</button>}
        </article>

        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><CheckCircle2 size={16}/></span><div><span className="eyebrow">RETENTION</span><h4>Account quests</h4></div><span className="value-status is-pending">PENDING REVIEW</span></div>
          <div className="value-quest-list">{questOptions.map((quest) => {
            const completion = data.quests.find((item) => item.quest_key === quest.key)
            const done = completion?.status === "claimed"
            return <div className="value-quest" key={quest.key}><span className={`quest-check ${done ? "quest-done" : ""}`} aria-hidden="true">{done ? <CheckCircle2 size={15}/> : <span/>}</span><div><strong>{quest.title}</strong><small>{completion ? `Submitted · ${completion.status}` : quest.detail}</small></div><button type="button" className="value-quiet-action" disabled={Boolean(busy) || Boolean(completion)} onClick={() => void submit({ action: "quest", questKey: quest.key }, `quest:${quest.key}`)}>{completion ? completion.status : busy === `quest:${quest.key}` ? "Submitting…" : "Submit"}</button></div>
          })}</div>
          <p className="value-footnote">Quest submissions are review requests. Account signals are not proof of eligibility and do not credit a balance. Verified quest rewards credit through the {percentLabel(userShareBps)} / {percentLabel(treasuryShareBps)} split engine.</p>
        </article>

        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><Link2 size={16}/></span><div><span className="eyebrow">INVITE PROGRAM</span><h4>Referral link</h4></div><span className="value-status">CODE AVAILABLE</span></div>
          {data.referral ? <><p className="value-description">Share your unique invite link. Referral attribution and commissions are not counted until a trusted signup verifier is connected.</p><div className="referral-metrics"><div><strong>{data.referral.tier1_count}</strong><span>DIRECT</span></div><div><strong>{data.referral.tier2_count}</strong><span>INDIRECT</span></div><div><strong>{formatAtomic(data.referral.tier1_commission_atomic, 9)} TON</strong><span>DIRECT COMMISSION</span></div><div><strong>{formatAtomic(data.referral.tier2_commission_atomic, 9)} TON</strong><span>INDIRECT COMMISSION</span></div></div><button type="button" className="value-action" onClick={() => void copyReferral()}><Copy size={14}/>{inviteCopied ? "Copied" : "Copy invite link"}</button></> : <p className="value-description">Your invite code is being initialized.</p>}
        </article>

        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><ArrowDownLeft size={16}/></span><div><span className="eyebrow">ON-CHAIN SETTLEMENT · {percentLabel(userShareBps)} / {percentLabel(treasuryShareBps)}</span><h4>Withdraw to your bound wallet</h4></div><span className={`value-status ${data.wallet && unlocked ? "" : "is-pending"}`}>{mining?.walletAddress ? (unlocked ? "UNLOCKED" : `LOCKED · ${formatCountdown(secondsRemaining)}`) : "WALLET NOT BOUND"}</span></div>
          <p className="value-description">Every verified reward credits {percentLabel(userShareBps)} to your available balance and settles {percentLabel(treasuryShareBps)} to the platform treasury. Withdrawals pay out to your bound Tonkeeper / TON wallet as real Mainnet transfers — TON natively, GRAM and USDT as jettons — and unlock {minimumSeconds} seconds after your mining session activates. Minimums: 1 TON, 10 GRAM, 5 USDT.</p>
          {mining?.walletAddress && <p className="value-footnote">{unlocked ? "Accumulation complete — payouts are available now." : `Accumulating · ${formatCountdown(secondsRemaining)} remaining of the ${minimumSeconds}s gate.`}</p>}
          {boundWallet && <button type="button" className="value-quiet-action value-use-connected" onClick={() => setDestination(boundWallet)}>Use bound wallet</button>}
          <form className="withdrawal-form" onSubmit={async (event) => { event.preventDefault(); await requestWithdrawal() }}>
            <div className="withdrawal-fields"><label className="value-label">Asset<select className="value-input" value={asset} onChange={(event) => setAsset(event.target.value)}><option value="TON">TON</option><option value="GRAM">GRAM</option><option value="USDT">USDT</option></select></label><label className="value-label">Amount · min {ASSET_MINIMUMS[asset]} {asset}<input className="value-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`0.${"0".repeat(ASSET_DECIMALS[asset] ?? 9)}`} maxLength={80}/></label></div>
            <label className="value-label" htmlFor="withdrawal-destination">TON destination address<input id="withdrawal-destination" className="value-input" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="UQ… or EQ…" autoComplete="off" maxLength={128}/></label>
            <button type="submit" className="value-action" disabled={Boolean(busy) || !amount || !destination.trim() || !unlocked}>{busy === "withdrawal" ? "Broadcasting…" : unlocked ? "Withdraw to bound wallet" : `Locked · ${formatCountdown(secondsRemaining)}`}</button>
          </form>
          {receipt && <div className="value-receipt" role="status"><CheckCircle2 size={15}/><div><strong>On-chain {receipt.assetCode} payout broadcast{receipt.confirmed ? " · confirmed" : ""}</strong><code className="mono">{receipt.transactionHash}</code><a href={receipt.tonviewerUrl} target="_blank" rel="noreferrer">Inspect on Tonviewer <ExternalLink size={11}/></a></div></div>}
          {data.withdrawals.length > 0 && <ul className="value-history">{data.withdrawals.slice(0, 5).map((item) => <li key={item.id}><span>{formatAtomic(item.amount_atomic, item.asset_decimals)} {item.asset_code} · {new Date(item.created_at).toLocaleDateString()}{item.transaction_hash && <> · <a className="value-tx-link" href={tonviewerTransactionUrl(item.transaction_hash)} target="_blank" rel="noreferrer">Tonviewer</a></>}</span><strong>{item.status}</strong></li>)}</ul>}
          {data.withdrawals.some((item) => item.failure_reason) && <p className="value-footnote"><AlertTriangle size={12}/> A recent payout failed. Reason: {data.withdrawals.find((item) => item.failure_reason)?.failure_reason}</p>}
        </article>
      </div>
      {message && <p className="value-message" role="status">{message}</p>}
    </>}
  </section>
}
