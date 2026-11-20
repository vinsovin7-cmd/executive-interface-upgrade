"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Crown, ExternalLink, Gem, Loader2,
  Lock, ShieldCheck, Sparkles, Unlock, Wallet, Zap,
} from "lucide-react"
import {
  ASSET_DECIMALS, ASSET_MINIMUMS, MINIMUM_ACCUMULATION_SECONDS, formatAtomic, percentLabel, tonviewerAddressUrl, tonviewerTransactionUrl,
} from "@/lib/mining/config"

type Balance = {
  asset_code: string
  available_atomic: string
  earned_today_atomic: string
  daily_cap_atomic: string
  minimum_withdrawal_atomic: string
}

type Withdrawal = {
  id: string
  asset_code: string
  asset_decimals: number
  amount_atomic: string
  status: string
  transaction_hash: string | null
  failure_reason: string | null
  created_at: string
}

type Mining = {
  status: string
  walletAddress: string | null
  startedAt: string | null
  unlockAt: string | null
  secondsRemaining: number
  withdrawalLocked: boolean
  minimumAccumulationSeconds: number
}

type ValueTracking = {
  balances: Balance[]
  mining: Mining
  split: { userShareBps: number; treasuryShareBps: number }
  withdrawals: Withdrawal[]
}

type MiningStateResponse = {
  treasury: {
    configured: boolean
    treasuryAddress: string
    signerAddress: string | null
    addressMatchesTreasury: boolean
    tonBalance: string | null
    gramBalance: string | null
    liquidityReady: boolean
    diagnostics: string[]
  } | null
  split: { userShareBps: number; treasuryShareBps: number }
}

type PayoutReceipt = { transactionHash: string; tonviewerUrl: string; assetCode: string; amountAtomic: string; confirmed: boolean }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body as T
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function MiningConsole({
  userId,
  walletAddress,
  onSignIn,
}: {
  userId: string | null
  walletAddress: string | null
  onSignIn: () => void
}) {
  const trackingKey = userId ? "/api/value-tracking" : null
  const { data, error, isLoading, mutate } = useSWR<ValueTracking>(trackingKey, getJson, {
    refreshInterval: 12_000,
    dedupingInterval: 8_000,
    revalidateOnFocus: true,
  })
  const { data: state, mutate: mutateState } = useSWR<MiningStateResponse>(userId ? "/api/mining/state" : null, getJson, {
    refreshInterval: 30_000,
    dedupingInterval: 20_000,
  })

  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [receipt, setReceipt] = useState<PayoutReceipt | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const mining = data?.mining
  const minimumSeconds = mining?.minimumAccumulationSeconds ?? MINIMUM_ACCUMULATION_SECONDS

  const secondsRemaining = useMemo(() => {
    if (!mining) return minimumSeconds
    if (!mining.unlockAt) return Math.max(0, mining.secondsRemaining)
    const unlockAt = new Date(mining.unlockAt).getTime()
    if (Number.isNaN(unlockAt)) return Math.max(0, mining.secondsRemaining)
    return Math.max(0, Math.ceil((unlockAt - now) / 1000))
  }, [mining, now, minimumSeconds])

  const elapsedSeconds = useMemo(() => {
    if (!mining?.startedAt) return 0
    const startedAt = new Date(mining.startedAt).getTime()
    if (Number.isNaN(startedAt)) return 0
    return Math.max(0, Math.floor((now - startedAt) / 1000))
  }, [mining, now])

  const unlocked = Boolean(mining && mining.walletAddress && secondsRemaining <= 0)
  const progress = Math.min(100, Math.round((elapsedSeconds / minimumSeconds) * 100))

  const bindWallet = async () => {
    if (!walletAddress) return
    setBusy("bind")
    setMessage("")
    try {
      const response = await fetch("/api/value-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "bind-wallet", address: walletAddress }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "Wallet could not be bound.")
      setMessage(body.message ?? "Wallet bound. Mining session activated.")
      await Promise.all([mutate(), mutateState()])
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Wallet could not be bound.")
    } finally {
      setBusy(null)
    }
  }

  const withdrawAll = async (balance: Balance) => {
    if (!mining?.walletAddress) return
    const decimals = ASSET_DECIMALS[balance.asset_code] ?? 9
    const amount = formatAtomic(balance.available_atomic, decimals)
    setBusy(balance.asset_code)
    setMessage("")
    setReceipt(null)
    try {
      const queueResponse = await fetch("/api/value-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "withdrawal",
          assetCode: balance.asset_code,
          amount,
          destination: mining.walletAddress,
          idempotencyKey: crypto.randomUUID(),
        }),
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
        amountAtomic: payout.amountAtomic,
        confirmed: Boolean(payout.confirmed),
      })
      setMessage(payout.message ?? "On-chain payout broadcast.")
      await mutate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Withdrawal could not be completed.")
    } finally {
      setBusy(null)
    }
  }

  const treasury = state?.treasury ?? null

  return (
    <section className="mining-console panel" aria-labelledby="mining-console-title">
      <div className="mining-console-glow" aria-hidden="true" />
      <div className="panel-header mining-console-header">
        <div>
          <span className="eyebrow"><Crown size={13} /> EXECUTIVE PARADISE · CORE MINER</span>
          <h3 id="mining-console-title">Private mining suite</h3>
        </div>
        <span className="sample-tag" aria-live="polite">
          {isLoading ? "SYNCING" : mining?.walletAddress ? (unlocked ? "MINING · UNLOCKED" : "MINING · ACCRUING") : "WALLET NOT BOUND"}
        </span>
      </div>

      {!userId ? (
        <div className="mining-gate">
          <ShieldCheck size={18} />
          <div>
            <strong>Sign in to open your private suite</strong>
            <p>Your mining session, balances, and payouts are scoped to your authenticated account.</p>
          </div>
          <button type="button" className="mining-primary" onClick={onSignIn}>Sign in</button>
        </div>
      ) : (
        <>
          <div className="mining-bind-row">
            <div className="mining-bind-copy">
              <span className="micro-label">BOUND TONKEEPER / TON WALLET</span>
              <strong className="mono">
                {mining?.walletAddress
                  ? `${mining.walletAddress.slice(0, 8)}…${mining.walletAddress.slice(-6)}`
                  : walletAddress
                    ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)} · ready to bind`
                    : "No mainnet wallet connected"}
              </strong>
              {mining?.walletAddress && (
                <a className="mining-address-link" href={tonviewerAddressUrl(mining.walletAddress)} target="_blank" rel="noreferrer">
                  View on Tonviewer <ExternalLink size={12} />
                </a>
              )}
            </div>
            {mining?.walletAddress ? (
              <span className="mining-badge"><CheckCircle2 size={14} /> Mining session active</span>
            ) : (
              <button
                type="button"
                className="mining-primary"
                disabled={!walletAddress || busy === "bind"}
                onClick={bindWallet}
                title={walletAddress ? undefined : "Connect Tonkeeper or another TON wallet first"}
              >
                {busy === "bind" ? <Loader2 size={15} className="spin" /> : <Wallet size={15} />}
                {walletAddress ? "Bind wallet & activate mining" : "Connect a TON wallet first"}
              </button>
            )}
          </div>

          <div className="mining-metrics">
            <article className="mining-metric">
              <span className="micro-label">SESSION UPTIME</span>
              <strong className="mono">{mining?.walletAddress ? formatCountdown(elapsedSeconds) : "--:--"}</strong>
              <small>Real-time session-tracked accrual</small>
            </article>
            <article className={`mining-metric ${unlocked ? "is-unlocked" : "is-locked"}`}>
              <span className="micro-label">WITHDRAWAL GATE · {minimumSeconds}s</span>
              <strong className="mono">{mining?.walletAddress ? (unlocked ? "UNLOCKED" : formatCountdown(secondsRemaining)) : "--:--"}</strong>
              {unlocked ? <small><Unlock size={12} /> Payout available</small> : <small><Lock size={12} /> Locks until accumulation completes</small>}
            </article>
            <article className="mining-metric">
              <span className="micro-label">REWARD SPLIT</span>
              <strong className="mono">{percentLabel(data?.split.userShareBps ?? 3000)} / {percentLabel(data?.split.treasuryShareBps ?? 7000)}</strong>
              <small>User share / platform treasury</small>
            </article>
          </div>

          {mining?.walletAddress && (
            <div className="mining-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Accumulation progress">
              <span style={{ width: `${progress}%` }} />
              <i className="mining-progress-label">{unlocked ? "Accumulation complete" : `${minimumSeconds - secondsRemaining}s of ${minimumSeconds}s accrued`}</i>
            </div>
          )}

          <div className="mining-balances">
            {(data?.balances ?? []).map((balance) => {
              const decimals = ASSET_DECIMALS[balance.asset_code] ?? 9
              const available = Number(balance.available_atomic)
              const minimum = Number(balance.minimum_withdrawal_atomic || (ASSET_MINIMUMS[balance.asset_code] ?? "0"))
              const eligible = available > 0 && available >= minimum
              const canWithdraw = eligible && unlocked && Boolean(mining?.walletAddress)
              return (
                <article className="mining-balance" key={balance.asset_code}>
                  <div className="mining-balance-head">
                    <span className="mining-asset"><Gem size={13} /> {balance.asset_code}</span>
                    <span className="mining-balance-amount mono">{formatAtomic(balance.available_atomic, decimals)}</span>
                  </div>
                  <small className="mining-balance-meta">
                    Today {formatAtomic(balance.earned_today_atomic, decimals)} · min {formatAtomic(balance.minimum_withdrawal_atomic, decimals)}
                  </small>
                  <button
                    type="button"
                    className="mining-primary mining-withdraw"
                    disabled={!canWithdraw || busy === balance.asset_code}
                    onClick={() => withdrawAll(balance)}
                    title={!mining?.walletAddress ? "Bind a wallet first" : !unlocked ? "Unlocks after the 600s accumulation" : !eligible ? "Below the minimum withdrawal" : `Withdraw ${balance.asset_code} to your bound wallet`}
                  >
                    {busy === balance.asset_code ? <Loader2 size={14} className="spin" /> : unlocked ? <ArrowUpRight size={14} /> : <Lock size={14} />}
                    {unlocked ? "Withdraw to Tonkeeper" : "Locked"}
                  </button>
                </article>
              )
            })}
            {!data?.balances?.length && <p className="muted-copy">No reward balances yet. Verified task, session, and AdsGram rewards credit here against your 30% share.</p>}
          </div>

          <div className="mining-treasury">
            <div className="mining-treasury-head">
              <span className="eyebrow"><Sparkles size={12} /> ON-CHAIN PAYOUT ENGINE</span>
              {treasury ? (
                <span className={`mining-badge ${treasury.configured && treasury.addressMatchesTreasury && treasury.liquidityReady ? "is-ready" : "is-warn"}`}>
                  {treasury.configured && treasury.addressMatchesTreasury && treasury.liquidityReady ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  {treasury.configured ? (treasury.liquidityReady ? "TREASURY LIQUID · READY" : "TREASURY UNFUNDED") : "SIGNER NOT CONFIGURED"}
                </span>
              ) : (
                <span className="mining-badge is-warn"><AlertTriangle size={13} /> STATUS UNAVAILABLE</span>
              )}
            </div>
            <p className="muted-copy">
              Payouts execute as real TON Mainnet transfers — TON natively and GRAM/USDT as jettons — signed by the treasury signer that controls the configured treasury address.
              {treasury ? ` Treasury ${treasury.treasuryAddress.slice(0, 8)}…${treasury.treasuryAddress.slice(-6)} · TON ${treasury.tonBalance ?? "—"} · GRAM ${treasury.gramBalance ?? "—"}.` : ""}
            </p>
            {treasury?.diagnostics?.length ? (
              <ul className="mining-diagnostics">
                {treasury.diagnostics.slice(0, 3).map((diagnostic) => <li key={diagnostic}><AlertTriangle size={12} /> {diagnostic}</li>)}
              </ul>
            ) : null}
          </div>

          {receipt && (
            <div className="mining-receipt" role="status">
              <CheckCircle2 size={16} />
              <div>
                <strong>On-chain {receipt.assetCode} payout broadcast</strong>
                <code className="mono">{receipt.transactionHash}</code>
                <a href={receipt.tonviewerUrl} target="_blank" rel="noreferrer">Inspect on Tonviewer <ExternalLink size={12} /></a>
              </div>
            </div>
          )}
          {message && <p className="mining-message" role="status"><Zap size={13} /> {message}</p>}
          {error && <p className="mining-message is-error" role="alert"><AlertTriangle size={13} /> {error instanceof Error ? error.message : "Mining data is temporarily unavailable."}</p>}

          {Boolean(data?.withdrawals?.length) && (
            <div className="mining-history">
              <span className="eyebrow">PAYOUT HISTORY</span>
              {data!.withdrawals.slice(0, 6).map((withdrawal) => (
                <div className="mining-history-row" key={withdrawal.id}>
                  <span className="mono">{formatAtomic(withdrawal.amount_atomic, withdrawal.asset_decimals ?? 9)} {withdrawal.asset_code}</span>
                  <span className="ledger-status">{withdrawal.status}</span>
                  {withdrawal.transaction_hash ? (
                    <a href={tonviewerTransactionUrl(withdrawal.transaction_hash)} target="_blank" rel="noreferrer">
                      {withdrawal.transaction_hash.slice(0, 10)}… <ExternalLink size={11} />
                    </a>
                  ) : (
                    <small>{withdrawal.failure_reason ? withdrawal.failure_reason.slice(0, 60) : "Awaiting on-chain broadcast"}</small>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
