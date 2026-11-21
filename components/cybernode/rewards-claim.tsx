"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, Coins, ExternalLink, Gem, Loader2, Lock, ShieldCheck, Sparkles, Wallet, Zap } from "lucide-react"
import {
  ASSET_DECIMALS,
  CLAIM_STATE_LABELS,
  CLAIMABLE_ASSETS,
  TREASURY_ANCHOR_ADDRESS,
  formatAtomic,
  tonviewerAddressUrl,
  tonviewerTransactionUrl,
} from "@/lib/mining/config"

type ClaimAssetRule = { assetCode: string; decimals: number; minimumAtomic: string }

type ClaimRules = {
  assets: ClaimAssetRule[]
  poolState: string
  cooldownSeconds: number
  perUserDailyCapGramAtomic: string
  perUserDailyCapUsdtAtomic: string
  globalDailyCapGramAtomic: string
  globalDailyCapUsdtAtomic: string
  treasuryAnchorAddress: string
}

type ClaimBalance = {
  asset_code: string
  available_atomic: string | number
  earned_today_atomic: string | number
  daily_cap_atomic: string | number
  minimum_withdrawal_atomic: string | number
}

type ClaimRow = {
  id: string
  asset_code: string
  asset_decimals: number
  amount_atomic: string
  destination: string | null
  state: string
  transaction_hash: string | null
  failure_reason: string | null
  created_at: string
  confirmed_at: string | null
}

type ClaimResponse = {
  authenticated: boolean
  rules: ClaimRules
  balances?: ClaimBalance[]
  claims?: ClaimRow[]
  wallet?: { address: string; status: string; verified_at: string | null } | null
}

type ClaimReceipt = { assetCode: string; amountAtomic: string; state: string; transactionHash: string | null; tonviewerUrl: string | null; message: string }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body as T
}

function stateLabel(state: string) {
  return (CLAIM_STATE_LABELS as Record<string, string>)[state] ?? state
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function RewardsClaim({ userId, walletAddress, onSignIn }: { userId: string | null; walletAddress: string | null; onSignIn: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<ClaimResponse>("/api/rewards/claim", getJson, {
    refreshInterval: 20_000,
    dedupingInterval: 10_000,
    revalidateOnFocus: true,
  })

  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const rules = data?.rules
  const boundWallet = data?.wallet && data.wallet.status === "verified" ? data.wallet.address : null
  const poolActive = (rules?.poolState ?? "active") === "active"

  const assets = useMemo(() => {
    return CLAIMABLE_ASSETS.map((assetCode) => {
      const decimals = ASSET_DECIMALS[assetCode] ?? 9
      const balance = data?.balances?.find((item) => item.asset_code === assetCode)
      const minimum = balance?.minimum_withdrawal_atomic ?? rules?.assets.find((asset) => asset.assetCode === assetCode)?.minimumAtomic ?? "0"
      const dailyCap = assetCode === "GRAM" ? rules?.perUserDailyCapGramAtomic ?? "0" : rules?.perUserDailyCapUsdtAtomic ?? "0"
      const pending = (data?.claims ?? [])
        .filter((claim) => claim.asset_code === assetCode && claim.state === "pending")
        .reduce((total, claim) => total + Number(claim.amount_atomic), 0)
      const lastSettled = (data?.claims ?? [])
        .filter((claim) => claim.asset_code === assetCode && (claim.state === "pending" || claim.state === "confirmed"))
        .map((claim) => new Date(claim.created_at).getTime())
        .reduce((latest, value) => (Number.isFinite(value) && value > latest ? value : latest), 0)
      const cooldownRemaining = lastSettled && rules ? Math.max(0, Math.ceil((lastSettled + rules.cooldownSeconds * 1000 - now) / 1000)) : 0
      return {
        assetCode,
        decimals,
        claimableAtomic: String(balance?.available_atomic ?? 0),
        earnedTodayAtomic: String(balance?.earned_today_atomic ?? 0),
        dailyCapAtomic: String(dailyCap),
        minimumAtomic: String(minimum),
        pendingAtomic: String(pending),
        cooldownRemaining,
      }
    })
  }, [data, rules, now])

  const claim = async (assetCode: string) => {
    setBusy(assetCode)
    setMessage("")
    setReceipt(null)
    try {
      const response = await fetch("/api/rewards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ assetCode, idempotencyKey: crypto.randomUUID() }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "The claim could not be completed.")
      const amountAtomic = body.claim?.amount_atomic ?? "0"
      setReceipt({
        assetCode: body.claim?.asset_code ?? assetCode,
        amountAtomic,
        state: body.claim?.state ?? "pending",
        transactionHash: body.settled?.transactionHash ?? body.claim?.transaction_hash ?? null,
        tonviewerUrl: body.settled?.tonviewerUrl ?? null,
        message: body.message ?? "Claim submitted.",
      })
      setMessage(body.message ?? "Claim submitted.")
      await mutate()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The claim could not be completed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="claim-console panel" aria-labelledby="rewards-claim-title">
      <div className="panel-header mining-console-header">
        <div>
          <span className="eyebrow"><Coins size={13} /> REWARDS &amp; ON-CHAIN CLAIM</span>
          <h3 id="rewards-claim-title">Claim your real earned balance</h3>
        </div>
        <span className="sample-tag" aria-live="polite">
          {isLoading ? "SYNCING" : poolActive ? "POOL ACTIVE" : `POOL ${(rules?.poolState ?? "").toUpperCase()}`}
        </span>
      </div>

      <div className="claim-rules">
        <div className="claim-rule">
          <span className="micro-label">POOL STATE</span>
          <strong className={`claim-pool ${poolActive ? "is-active" : "is-paused"}`}>{poolActive ? "ACTIVE" : (rules?.poolState ?? "—").toUpperCase()}</strong>
        </div>
        <div className="claim-rule">
          <span className="micro-label">PER-USER COOLDOWN</span>
          <strong>{rules ? `${formatCountdown(rules.cooldownSeconds)}` : "—"}</strong>
        </div>
        {(rules?.assets ?? CLAIMABLE_ASSETS.map((assetCode) => ({ assetCode, decimals: ASSET_DECIMALS[assetCode] ?? 9, minimumAtomic: "0" }))).map((asset) => (
          <div className="claim-rule" key={asset.assetCode}>
            <span className="micro-label">MIN CLAIM · {asset.assetCode}</span>
            <strong>{formatAtomic(asset.minimumAtomic, asset.decimals)} {asset.assetCode}</strong>
          </div>
        ))}
        <div className="claim-rule">
          <span className="micro-label">DAILY CAP · GRAM / USDT</span>
          <strong>
            {formatAtomic(rules?.perUserDailyCapGramAtomic ?? "0", ASSET_DECIMALS.GRAM)} / {formatAtomic(rules?.perUserDailyCapUsdtAtomic ?? "0", ASSET_DECIMALS.USDT)}
          </strong>
        </div>
      </div>

      {!data?.authenticated ? (
        <div className="mining-gate">
          <ShieldCheck size={18} />
          <div>
            <strong>Sign in to see and claim your balance</strong>
            <p>Earning rules and caps are public. Your real earned balance, pending amounts and on-chain claim history are scoped to your authenticated account.</p>
          </div>
          <button type="button" className="mining-primary" onClick={onSignIn}>Sign in</button>
        </div>
      ) : (
        <>
          <div className="claim-wallet-row">
            <div className="mining-bind-copy">
              <span className="micro-label">CLAIM DESTINATION WALLET</span>
              <strong className="mono">
                {boundWallet ? `${boundWallet.slice(0, 8)}…${boundWallet.slice(-6)}` : walletAddress ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)} · bind in Wallet &amp; payouts` : "No verified TON wallet bound"}
              </strong>
              {boundWallet && (
                <a className="mining-address-link" href={tonviewerAddressUrl(boundWallet)} target="_blank" rel="noreferrer">View on Tonviewer <ExternalLink size={12} /></a>
              )}
            </div>
            <span className={`mining-badge ${boundWallet ? "is-ready" : "is-warn"}`}>
              {boundWallet ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {boundWallet ? "WALLET VERIFIED" : "WALLET REQUIRED"}
            </span>
          </div>

          <div className="claim-assets">
            {assets.map((asset) => {
              const claimable = Number(asset.claimableAtomic)
              const minimum = Number(asset.minimumAtomic)
              const eligible = claimable > 0 && claimable >= minimum
              const cooling = asset.cooldownRemaining > 0
              const canClaim = poolActive && Boolean(boundWallet) && eligible && !cooling
              const reason = !poolActive
                ? "The reward pool is paused by the operator."
                : !boundWallet
                  ? "Bind a verified TON wallet to claim."
                  : !eligible
                    ? `Below the minimum claim of ${formatAtomic(asset.minimumAtomic, asset.decimals)} ${asset.assetCode}.`
                    : cooling
                      ? `Cooldown active — ${formatCountdown(asset.cooldownRemaining)} remaining.`
                      : `Claim ${asset.assetCode} to your bound wallet`
              return (
                <article className="claim-asset" key={asset.assetCode}>
                  <div className="mining-balance-head">
                    <span className="mining-asset"><Gem size={13} /> {asset.assetCode}</span>
                    <span className="mining-balance-amount mono">{formatAtomic(asset.claimableAtomic, asset.decimals)}</span>
                  </div>
                  <div className="claim-asset-meta">
                    <span><span className="micro-label">PENDING</span><strong className="mono">{formatAtomic(asset.pendingAtomic, asset.decimals)}</strong></span>
                    <span><span className="micro-label">EARNED TODAY</span><strong className="mono">{formatAtomic(asset.earnedTodayAtomic, asset.decimals)}</strong></span>
                    <span><span className="micro-label">DAILY CAP</span><strong className="mono">{formatAtomic(asset.dailyCapAtomic, asset.decimals)}</strong></span>
                  </div>
                  <button
                    type="button"
                    className="mining-primary mining-withdraw"
                    disabled={!canClaim || busy === asset.assetCode}
                    onClick={() => claim(asset.assetCode)}
                    title={reason}
                  >
                    {busy === asset.assetCode ? <Loader2 size={14} className="spin" /> : canClaim ? <ArrowUpRight size={14} /> : <Lock size={14} />}
                    {busy === asset.assetCode ? "Claiming…" : canClaim ? `Claim ${asset.assetCode}` : cooling ? formatCountdown(asset.cooldownRemaining) : "Not claimable"}
                  </button>
                  <small className="claim-asset-note">{reason}</small>
                </article>
              )
            })}
          </div>

          {receipt && (
            <div className={`mining-receipt ${receipt.transactionHash ? "" : "is-blocked"}`} role="status">
              {receipt.transactionHash ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <div>
                <strong>
                  {receipt.state === "confirmed"
                    ? `On-chain ${receipt.assetCode} claim confirmed`
                    : `${receipt.assetCode} claim ${stateLabel(receipt.state).toLowerCase()}`}
                </strong>
                <code className="mono">{formatAtomic(receipt.amountAtomic, ASSET_DECIMALS[receipt.assetCode] ?? 9)} {receipt.assetCode}</code>
                {receipt.transactionHash && (
                  <a href={receipt.tonviewerUrl ?? tonviewerTransactionUrl(receipt.transactionHash)} target="_blank" rel="noreferrer">Inspect on Tonviewer <ExternalLink size={12} /></a>
                )}
                <small>{receipt.message}</small>
              </div>
            </div>
          )}

          {message && !receipt && <p className="mining-message" role="status"><Zap size={13} /> {message}</p>}
          {error && <p className="mining-message is-error" role="alert"><AlertTriangle size={13} /> {error instanceof Error ? error.message : "Claim data is temporarily unavailable."}</p>}

          {Boolean(data?.claims?.length) && (
            <div className="mining-history">
              <span className="eyebrow"><Clock3 size={12} /> CLAIM HISTORY</span>
              {data!.claims!.slice(0, 8).map((row) => (
                <div className="mining-history-row" key={row.id}>
                  <span className="mono">{formatAtomic(row.amount_atomic, row.asset_decimals ?? 9)} {row.asset_code}</span>
                  <span className={`ledger-status admin-state admin-state-${row.state}`}>{stateLabel(row.state)}</span>
                  {row.transaction_hash ? (
                    <a href={tonviewerTransactionUrl(row.transaction_hash)} target="_blank" rel="noreferrer">{row.transaction_hash.slice(0, 10)}… <ExternalLink size={11} /></a>
                  ) : (
                    <small>{row.failure_reason ? row.failure_reason.slice(0, 60) : new Date(row.created_at).toLocaleString()}</small>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="claim-treasury-note">
            <span className="eyebrow"><Sparkles size={12} /> TREASURY COLLECTION / REFILL ANCHOR</span>
            <a className="mono" href={tonviewerAddressUrl(rules?.treasuryAnchorAddress ?? TREASURY_ANCHOR_ADDRESS)} target="_blank" rel="noreferrer">
              {rules?.treasuryAnchorAddress ?? TREASURY_ANCHOR_ADDRESS} <ExternalLink size={11} />
            </a>
            <p className="muted-copy">Claims are validated server-side against minimum thresholds, cooldowns, per-user and global daily caps, and live treasury/gas liquidity. Every confirmed claim stores its real TON transaction hash and settles from the configured treasury — no simulated activity and no synthetic withdrawal notifications.</p>
          </div>
        </>
      )}
    </section>
  )
}
