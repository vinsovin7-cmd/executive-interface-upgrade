"use client"

import { useState } from "react"
import useSWR from "swr"
import { ArrowDownLeft, CheckCircle2, Copy, Link2, ShieldCheck, Sparkles, Wallet } from "lucide-react"

type ValueData = {
  wallet: { address: string; status: string; created_at: string } | null
  airdrops: { id: string; campaign_key: string; status: string; created_at: string }[]
  quests: { id: string; quest_key: string; status: string; created_at: string }[]
  withdrawals: { id: string; asset_code: string; amount_atomic: string; asset_decimals: number; destination: string; status: string; created_at: string }[]
  balances: { asset_code: string; available_atomic: string; earned_today_atomic: string; daily_cap_atomic: string; minimum_withdrawal_atomic: string }[]
  referral: { referral_code: string; tier1_count: number; tier2_count: number; tier1_commission_atomic: string; tier2_commission_atomic: string } | null
}

const questOptions = [
  { key: "verify-email", title: "Verify your email", detail: "Confirm the email on your CyberNode account." },
  { key: "link-telegram", title: "Link Telegram", detail: "Verify your Telegram identity in account settings." },
  { key: "connect-wallet", title: "Connect a TON wallet", detail: "Connect a TON Mainnet wallet using TonConnect." },
]
const assetDecimals: Record<string, number> = { TON: 9, GRAM: 9, USDT: 6 }
const minimumWithdrawals: Record<string, string> = { TON: "1", GRAM: "10", USDT: "5" }

async function fetchValueData(url: string): Promise<ValueData> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Value activity is unavailable.")
  return result as ValueData
}

function amountFromAtomic(value: string, decimals: number) {
  const padded = value.padStart(decimals + 1, "0")
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole
}

export function ValueTracking({ userId, walletAddress, onSignIn }: { userId: string | null; walletAddress: string | null; onSignIn: () => void }) {
  const { data, error, mutate } = useSWR<ValueData>(userId ? "/api/value-tracking" : null, fetchValueData, { revalidateOnFocus: true, revalidateOnReconnect: true, refreshInterval: 3_000, refreshWhenHidden: false })
  const [address, setAddress] = useState("")
  const [asset, setAsset] = useState("TON")
  const [amount, setAmount] = useState("")
  const [destination, setDestination] = useState("")
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState("")
  const [inviteCopied, setInviteCopied] = useState(false)

  const submit = async (body: Record<string, unknown>, key: string) => {
    if (!userId) { onSignIn(); return }
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
      <div><span className="eyebrow">ACCOUNT VALUE · REVIEW FIRST</span><h3 id="value-tracking-title">Claims, quests & referrals</h3></div>
      <span className="sample-tag">NO AUTO-CREDIT</span>
    </header>
    {!userId ? <div className="value-signin"><ShieldCheck size={18}/><span>Sign in to submit and review account activity.</span><button type="button" onClick={onSignIn}>Sign in</button></div> : error ? <p className="value-message" role="status">{error.message} <button type="button" onClick={() => void mutate()}>Retry</button></p> : !data ? <p className="value-loading" role="status">Loading account activity…</p> : <>
      <div className="value-tracking-grid">
        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><Sparkles size={16}/></span><div><span className="eyebrow">LIVE LEDGER · DAILY CAPS</span><h4>Reward balances</h4></div><span className="value-status">VERIFIED CREDITS</span></div>
          <div className="referral-metrics reward-balance-metrics">{data.balances.map((balance) => {
            const decimals = assetDecimals[balance.asset_code] ?? 9
            return <div key={balance.asset_code}><strong>{amountFromAtomic(balance.available_atomic, decimals)} {balance.asset_code}</strong><span>AVAILABLE</span><small>{amountFromAtomic(balance.earned_today_atomic, decimals)} / {amountFromAtomic(balance.daily_cap_atomic, decimals)} earned today</small></div>
          })}</div>
          <p className="value-footnote">Credits vest immediately after verified task completion or qualified active-session intervals: 0.01 GRAM per task and 0.005 TON per 25-second interval. Daily caps are 50 GRAM and 5 TON. Pending withdrawals are reserved from available balance. Ads do not credit this ledger without independently verified provider settlement.</p>
        </article>
        <article className="panel value-panel">
          <div className="value-panel-title"><span className="value-icon"><Wallet size={16}/></span><div><span className="eyebrow">TON MAINNET</span><h4>Wallet binding</h4></div><span className={`value-status ${data.wallet ? "" : "is-pending"}`}>{data.wallet?.status ?? "NOT LINKED"}</span></div>
          {data.wallet ? <p className="value-description">{data.wallet.address.slice(0, 9)}…{data.wallet.address.slice(-7)} · submitted for ownership review.</p> : <>
            <p className="value-description">Record a wallet for later review. This does not prove ownership or authorize a transaction.</p>
            <label className="value-label" htmlFor="binding-address">TON wallet address</label>
            <input id="binding-address" className="value-input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="UQ… or EQ…" autoComplete="off" maxLength={128}/>
            <button type="button" className="value-action" disabled={Boolean(busy) || !address.trim()} onClick={() => void submit({ action: "bind-wallet", address: address.trim() }, "wallet")}>{busy === "wallet" ? "Submitting…" : "Submit wallet"}</button>
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
          <p className="value-footnote">Quest submissions are review requests. Account signals are not proof of eligibility and do not credit a balance.</p>
        </article>

        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><Link2 size={16}/></span><div><span className="eyebrow">INVITE PROGRAM</span><h4>Referral link</h4></div><span className="value-status">CODE AVAILABLE</span></div>
          {data.referral ? <><p className="value-description">Share your unique invite link. Referral attribution and commissions are not counted until a trusted signup verifier is connected.</p><div className="referral-metrics"><div><strong>{data.referral.tier1_count}</strong><span>DIRECT</span></div><div><strong>{data.referral.tier2_count}</strong><span>INDIRECT</span></div><div><strong>{amountFromAtomic(data.referral.tier1_commission_atomic, 9)} TON</strong><span>DIRECT COMMISSION</span></div><div><strong>{amountFromAtomic(data.referral.tier2_commission_atomic, 9)} TON</strong><span>INDIRECT COMMISSION</span></div></div><button type="button" className="value-action" onClick={() => void copyReferral()}><Copy size={14}/>{inviteCopied ? "Copied" : "Copy invite link"}</button></> : <p className="value-description">Your invite code is being initialized.</p>}
        </article>

        <article className="panel value-panel value-panel-wide">
          <div className="value-panel-title"><span className="value-icon"><ArrowDownLeft size={16}/></span><div><span className="eyebrow">MANUAL REVIEW QUEUE</span><h4>Withdrawal request</h4></div><span className="value-status is-pending">NO AUTO-PAYOUT</span></div>
          <p className="value-description">Requests are checked against your verified ledger balance and reserve the queued amount. Minimums: 1 TON, 10 GRAM, 5 USDT. Queueing does not initiate payout; transfers remain under manual review.</p>
          {walletAddress && <button type="button" className="value-quiet-action value-use-connected" onClick={() => setDestination(walletAddress)}>Use connected wallet</button>}
          <form className="withdrawal-form" onSubmit={async (event) => {
            event.preventDefault()
            const decimals = assetDecimals[asset]
            if (!decimals || !amount || !destination.trim()) return
            const idempotencyKey = crypto.randomUUID()
            const ok = await submit({ action: "withdrawal", assetCode: asset, amount, destination: destination.trim(), idempotencyKey }, "withdrawal")
            if (ok) { setAmount(""); setDestination("") }
          }}>
            <div className="withdrawal-fields"><label className="value-label">Asset<select className="value-input" value={asset} onChange={(event) => setAsset(event.target.value)}><option value="TON">TON</option><option value="GRAM">GRAM</option><option value="USDT">USDT</option></select></label><label className="value-label">Amount · min {minimumWithdrawals[asset]} {asset}<input className="value-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`0.${"0".repeat(assetDecimals[asset])}`} maxLength={80}/></label></div>
            <label className="value-label" htmlFor="withdrawal-destination">TON destination address<input id="withdrawal-destination" className="value-input" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="UQ… or EQ…" autoComplete="off" maxLength={128}/></label>
            <button type="submit" className="value-action" disabled={Boolean(busy) || !amount || !destination.trim()}>{busy === "withdrawal" ? "Submitting…" : "Request review"}</button>
          </form>
          {data.withdrawals.length > 0 && <ul className="value-history">{data.withdrawals.slice(0, 5).map((item) => <li key={item.id}><span>{amountFromAtomic(item.amount_atomic, item.asset_decimals)} {item.asset_code} · {new Date(item.created_at).toLocaleDateString()}</span><strong>{item.status}</strong></li>)}</ul>}
        </article>
      </div>
      {message && <p className="value-message" role="status">{message}</p>}
    </>}
  </section>
}
