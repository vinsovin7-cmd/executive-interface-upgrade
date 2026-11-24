"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, Clock, Copy, Crown, ExternalLink, Gem, Loader2,
  Lock, Megaphone, Share2, ShieldCheck, SkipForward, Sparkles, Unlock, Wallet, X, Zap,
} from "lucide-react"
import {
  ASSET_DECIMALS, ASSET_MINIMUMS, MINIMUM_ACCUMULATION_SECONDS, UNLOCK_THRESHOLD_SECONDS, formatAtomic, percentLabel, tonviewerAddressUrl, tonviewerTransactionUrl, tonscanTransactionUrl,
} from "@/lib/mining/config"
import { readAdCadence, startAdCycle, type AdCadenceState } from "@/lib/monetization/ad-cadence"
import { createShareableReceipt, generateReferralUrl } from "@/lib/monetization/shareable-receipt"
import { dispatchTelegramAlert, formatEventMessage } from "@/lib/monetization/telegram-dispatcher"

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

function formatBalance(b: Balance) {
  const decimals = ASSET_DECIMALS[b.asset_code] ?? 9
  return `${formatAtomic(b.available_atomic, decimals)} ${b.asset_code}`
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
    refreshInterval: 8_000,
    dedupingInterval: 8_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
  const { data: state, mutate: mutateState } = useSWR<MiningStateResponse>(userId ? "/api/mining/state" : null, getJson, {
    refreshInterval: 30_000,
    dedupingInterval: 20_000,
  })
  
  // Monetization state
  const [adCadence, setAdCadence] = useState<AdCadenceState | null>(null)
  const [adSlotStartedAt, setAdSlotStartedAt] = useState<number | null>(null)
  const [shareReceipt, setShareReceipt] = useState<ReturnType<typeof createShareableReceipt> | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [receipt, setReceipt] = useState<PayoutReceipt | null>(null)
  const [lastWithdrawAt, setLastWithdrawAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null
    const stored = window.localStorage.getItem("cybernode_last_withdraw_at")
    return stored ? Number.parseInt(stored, 10) : null
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  // Read the server-tracked 30-minute ad/engagement cadence on mount + every
  // clock tick so the cooldown countdown and ad-slot state stay in sync.
  useEffect(() => {
    setAdCadence(readAdCadence())
  }, [now])

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

  // 7-rainbow accrual measures from the later of session start or the last
  // withdrawal, so the rainbow unlock resets after each payout while accrual
  // continues if the user chooses not to withdraw immediately.
  const rainbowElapsedSeconds = useMemo(() => {
    if (!mining?.startedAt) return 0
    const startedAt = new Date(mining.startedAt).getTime()
    if (Number.isNaN(startedAt)) return 0
    const baseline = lastWithdrawAt && lastWithdrawAt > startedAt ? lastWithdrawAt : startedAt
    return Math.max(0, Math.floor((now - baseline) / 1000))
  }, [mining, lastWithdrawAt, now])

  const unlocked = Boolean(mining && mining.walletAddress && secondsRemaining <= 0)
  const is7RainbowUnlocked = Boolean(mining && mining.walletAddress && rainbowElapsedSeconds >= UNLOCK_THRESHOLD_SECONDS)
  const progress = Math.min(100, Math.round((elapsedSeconds / minimumSeconds) * 100))

  // Live withdrawable balance: the first asset whose available amount clears
  // the minimum withdrawal floor. Re-evaluated every tick so the prominent
  // WITHDRAW TO KEEPER action always shows a real, current amount.
  const withdrawable = useMemo(() => {
    if (!mining?.walletAddress || !unlocked) return null
    for (const b of data?.balances ?? []) {
      const available = Number(b.available_atomic)
      const minimum = Number(b.minimum_withdrawal_atomic || (ASSET_MINIMUMS[b.asset_code] ?? "0"))
      if (available > 0 && available >= minimum) return b
    }
    return null
  }, [data?.balances, mining?.walletAddress, unlocked])

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
      setAutoBinding(false)
    }
  }

  // Earning engines engage immediately: once an authenticated user has a
  // connected Mainnet wallet, the mining session self-activates without an
  // extra click. The 600-second accumulation clock starts on this bind, so the
  // session/AdsGram/multi-asset accrual begins the moment the user is online.
  const autoBoundRef = useRef<string | null>(null)
  const [autoBinding, setAutoBinding] = useState(false)
  useEffect(() => {
    if (!userId || !walletAddress) return
    if (data?.mining?.walletAddress === walletAddress) return
    if (busy === "bind" || autoBoundRef.current === walletAddress) return
    autoBoundRef.current = walletAddress
    setAutoBinding(true)
    void bindWallet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, walletAddress, data, busy])
  
  useEffect(() => {
    if (autoBinding && walletAddress && data?.mining?.walletAddress === walletAddress) {
      // Auto-binding completed successfully — walletAddress is now bound on-chain
      setAutoBinding(false)
    }
  }, [autoBinding, walletAddress, data?.mining?.walletAddress])

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
      setLastWithdrawAt(Date.now())
      try { window.localStorage.setItem("cybernode_last_withdraw_at", String(Date.now())) } catch { /* private mode */ }
      setMessage(payout.message ?? "On-chain payout broadcast.")
      
      // Generate shareable receipt + broadcast via Telegram for proof loop
      try {
        const referralUrl = generateReferralUrl(
          userId ?? "guest",
          payout.assetCode,
          payout.amountAtomic,
        )
        const share = createShareableReceipt(
          userId ?? "guest",
          mining.walletAddress,
          payout.assetCode,
          payout.amountAtomic,
          payout.transactionHash,
          payout.tonviewerUrl,
          referralUrl,
          new Date().toISOString(),
        )
        setShareReceipt(share)
        void dispatchTelegramAlert({
          chatId: "self",
          text: formatEventMessage("withdrawal_broadcast", {
            userId: userId ?? "anonymous",
            asset: payout.assetCode,
            amountAtomic: payout.amountAtomic,
            transactionHash: payout.transactionHash,
          }),
          parseMode: "HTML",
        })
      } catch {
        // Share/telemetry is best-effort; never block payout UX.
      }

      await mutate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Withdrawal could not be completed.")
    } finally {
      setBusy(null)
    }
  }

  const treasury = state?.treasury ?? null

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

  return (
    <section className="mining-console panel" aria-labelledby="mining-console-title">
      <div className="mining-console-glow" aria-hidden="true" />
      <div className="panel-header mining-console-header">
        <div>
          <span className="eyebrow"><Crown size={13} /> EXECUTIVE PARADISE · CORE MINER</span>
          <h3 id="mining-console-title">Private mining suite</h3>
        </div>
        <span className="sample-tag" aria-live="polite">
          {!walletAddress ? "WALLET NOT BOUND" : isLoading ? "SYNCING" : autoBinding ? "BINDING…" : is7RainbowUnlocked ? "7-RAINBOW UNLOCKED" : unlocked ? "MINING · ACTIVE" : mining?.walletAddress ? "MINING · ACCRUING" : "CONNECTED · AWAITING UNLOCK"}
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
            {walletAddress ? (
              <span className="mining-badge">
                {autoBinding ? (
                  <>
                    <Clock size={14} /> Auto-activating mining…
                  </>
                ) : is7RainbowUnlocked ? (
                  <>
                    <Sparkles size={14} /> 7-Rainbow unlocked · ready to withdraw
                  </>
                ) : unlocked ? (
                  <>
                    <CheckCircle2 size={14} /> Mining session active
                  </>
                ) : (
                  <>
                    <AlertTriangle size={14} /> Connected · awaiting unlock
                  </>
                )}
              </span>
            ) : (
              <span className="mining-badge"><AlertTriangle size={14} /> No mainnet wallet connected</span>
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
              <i className="mining-progress-label">{is7RainbowUnlocked ? "7-rainbow unlocked · ready to withdraw to Keeper" : unlocked ? "Accumulation complete" : `${minimumSeconds - secondsRemaining}s of ${minimumSeconds}s accrued`}</i>
            </div>
          )}

          {is7RainbowUnlocked && withdrawable && (
            <div className="mining-unlock-banner">
              <div className="mining-unlock-copy">
                <span className="mining-unlock-kicker"><Sparkles size={12} /> UNLOCKED · READY</span>
                <strong>Withdraw to Keeper</strong>
                <span className="mining-unlock-amount mono">{formatBalance(withdrawable)}</span>
                <small>Real treasury-signed {withdrawable.asset_code} settlement to your bound wallet</small>
              </div>
              <button
                type="button"
                className="mining-primary mining-withdraw-banner"
                disabled={busy === withdrawable.asset_code}
                onClick={() => withdrawAll(withdrawable)}
                title={`Withdraw ${formatBalance(withdrawable)} to Keeper`}
              >
                {busy === withdrawable.asset_code ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {busy === withdrawable.asset_code ? "Sending…" : "WITHDRAW TO KEEPER"}
              </button>
            </div>
          )}

          <div className="mining-treasury">
            <div className="mining-treasury-head">
              <span className="eyebrow"><Megaphone size={12} /> 30-MINUTE ENGAGEMENT CYCLE</span>
              {adCadence?.isCooldownActive ? (
                <span className="mining-badge is-warn"><Clock size={13} /> COOLDOWN · {adCadence ? formatCountdown(adCadence.secondsRemaining) : "--:--"}</span>
              ) : (
                <span className="mining-badge is-ready"><CheckCircle2 size={13} /> SLOT AVAILABLE</span>
              )}
            </div>
            <p className="muted-copy">
              Server-tracked cadence: every 30 minutes one 30-second sponsored slot unlocks. Next / Skip / Close interactions are logged as engagement events — no synthetic payouts are credited.
            </p>
            {adSlotStartedAt ? (
              <div className="mining-ad-slot" role="timer">
                <span className="micro-label">SPONSORED SLOT · 30s</span>
                <strong className="mono">{formatCountdown(adSlotRemaining)}</strong>
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
                  <Megaphone size={14} /> {adCadence?.isCooldownActive ? `Next slot in ${adCadence ? formatCountdown(adCadence.secondsRemaining) : "--:--"}` : "Start engagement cycle"}
                </button>
              </div>
            )}
          </div>

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
                    title={!mining?.walletAddress ? "Bind a wallet first" : is7RainbowUnlocked ? "7-rainbow unlocked · Withdraw to Keeper" : !unlocked ? "Unlocks after the 600s accumulation" : !eligible ? "Below the minimum withdrawal" : `Withdraw ${balance.asset_code} to your bound wallet`}
                  >
                    {busy === balance.asset_code ? <Loader2 size={14} className="spin" /> : is7RainbowUnlocked ? <Sparkles size={14} /> : unlocked ? <ArrowUpRight size={14} /> : <Lock size={14} />}
                    {is7RainbowUnlocked ? "Withdraw to Keeper" : unlocked ? "Withdraw to Tonkeeper" : "Locked"}
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
                <span className="mining-badge"><Clock size={13} /> LOADING TREASURY STATE</span>
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
                <div className="mining-receipt-actions">
                  <a href={receipt.tonviewerUrl} target="_blank" rel="noreferrer">Inspect on Tonviewer <ExternalLink size={12} /></a>
                  <a href={tonscanTransactionUrl(receipt.transactionHash)} target="_blank" rel="noreferrer">Inspect on Tonscan <ExternalLink size={12} /></a>
                </div>
              </div>
              {shareReceipt && (
                <div className="mining-share-receipt" role="status">
                  <div className="mining-treasury-head">
                    <span className="eyebrow"><Share2 size={12} /> SHAREABLE PROOF</span>
                    <button type="button" className="mining-primary" onClick={copyShareReceipt}>
                      <Copy size={13} /> {shareCopied ? "Copied" : "Copy receipt"}
                    </button>
                  </div>
                  <pre className="mining-share-text mono">{shareReceipt.message}</pre>
                  <div className="mining-receipt-actions">
                    <a href={shareReceipt.tonviewerUrl} target="_blank" rel="noreferrer">Verify on Tonviewer <ExternalLink size={11} /></a>
                    <a href={tonscanTransactionUrl(shareReceipt.transactionHash)} target="_blank" rel="noreferrer">Verify on Tonscan <ExternalLink size={11} /></a>
                  </div>
                </div>
              )}
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
