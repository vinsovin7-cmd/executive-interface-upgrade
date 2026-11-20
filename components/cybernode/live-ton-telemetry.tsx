"use client"

import { useState } from "react"
import useSWR from "swr"
import { Address } from "@ton/core"

type TonTelemetry = {
  source: string
  asOf: string
  block: { seqno: number; generatedAt: string; ageSeconds: number }
  token: {
    masterAddress: string
    name: string
    symbol: string
    legacySymbol: string | null
    decimals: number
    indexed: boolean
  }
  treasury: { address: string; tonBalance: string | null; jettonBalance: string | null }
  connectedWallet: { address: string; tonBalance: string | null; jettonBalance: string | null } | null
  transactions: Array<{
    hash: string
    timestamp: string | null
    account: string
    incoming: { source: string | null; destination: string | null; valueNano: string | null } | null
    outgoing: Array<{ source: string | null; destination: string | null; valueNano: string | null }>
  }>
}

type Heartbeat = { lastSeenAt: string | null }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body as T
}

function shortAddress(address: string) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`
}

function isSameAddress(left: string | null, right: string) {
  if (!left) return false
  try {
    return Address.parse(left).toRawString() === Address.parse(right).toRawString()
  } catch {
    return left.toLowerCase() === right.toLowerCase()
  }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value))
}

export function LiveTonTelemetry({
  walletAddress,
  userId,
  onSignIn,
}: {
  walletAddress: string | null
  userId: string | null
  onSignIn: () => void
}) {
  const telemetryKey = `/api/ton/telemetry${walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : ""}`
  const { data, error, isLoading } = useSWR<TonTelemetry>(telemetryKey, getJson, {
    refreshInterval: 20_000,
    dedupingInterval: 15_000,
    revalidateOnFocus: true,
    errorRetryCount: 2,
  })
  const { data: heartbeat, mutate: refreshHeartbeat } = useSWR<Heartbeat>(
    userId ? "/api/telemetry/heartbeat" : null,
    getJson,
    { refreshInterval: 30_000, revalidateOnFocus: true },
  )
  const [isRecording, setIsRecording] = useState(false)
  const [heartbeatMessage, setHeartbeatMessage] = useState("")

  const recordHeartbeat = async () => {
    if (!userId) {
      onSignIn()
      return
    }

    setIsRecording(true)
    setHeartbeatMessage("")
    try {
      const response = await fetch("/api/telemetry/heartbeat", {
        method: "POST",
        headers: { Accept: "application/json" },
      })
      const body = await response.json()
      if (response.status === 401) {
        onSignIn()
        setHeartbeatMessage("Sign in to record an activity heartbeat.")
        return
      }
      if (!response.ok) throw new Error(body.error ?? "Heartbeat could not be recorded")
      await refreshHeartbeat()
      setHeartbeatMessage("Activity heartbeat recorded. This is not compute proof or an earning event.")
    } catch {
      setHeartbeatMessage("Activity heartbeat could not be recorded. Try again later.")
    } finally {
      setIsRecording(false)
    }
  }

  const mainnetLive = Boolean(data && data.block.ageSeconds < 45)

  return (
    <section className="panel ton-telemetry-panel" aria-labelledby="ton-telemetry-title">
      <div className="panel-header">
        <div>
          <span className="eyebrow">TONCENTER API V3 · MAINNET</span>
          <h3 id="ton-telemetry-title">Live on-chain telemetry</h3>
        </div>
        <span className="sample-tag" aria-live="polite">
          {error ? "SOURCE UNAVAILABLE" : isLoading ? "SYNCING" : mainnetLive ? "LIVE · READ ONLY" : "INDEXER DELAYED"}
        </span>
      </div>

      {error ? (
        <p className="telemetry-error" role="status">Live chain data is temporarily unavailable. No cached or estimated values are shown.</p>
      ) : !data ? (
        <p className="muted-copy" role="status">Loading the current Mainnet indexer snapshot…</p>
      ) : (
        <>
          <div className="ton-telemetry-grid">
            <div className="ton-telemetry-stat">
              <span>MASTERCHAIN HEIGHT</span>
              <strong>{data.block.seqno.toLocaleString("en-US")}</strong>
              <small>Block generated {data.block.ageSeconds}s ago</small>
            </div>
            <div className="ton-telemetry-stat">
              <span>TREASURY · TON</span>
              <strong>{data.treasury.tonBalance ?? "Unavailable"} TON</strong>
              <small>{shortAddress(data.treasury.address)}</small>
            </div>
            <div className="ton-telemetry-stat">
              <span>TREASURY · {data.token.symbol}</span>
              <strong>{data.treasury.jettonBalance ?? "Unavailable"} {data.token.symbol}</strong>
              <small>Jetton balance from indexer</small>
            </div>
            <div className="ton-telemetry-stat">
              <span>CONNECTED WALLET</span>
              {data.connectedWallet ? (
                <>
                  <strong>{data.connectedWallet.tonBalance ?? "Unavailable"} TON</strong>
                  <small>{data.connectedWallet.jettonBalance ?? "Unavailable"} {data.token.symbol} · {shortAddress(data.connectedWallet.address)}</small>
                </>
              ) : (
                <>
                  <strong>Not connected</strong>
                  <small>Connect a Mainnet wallet to load its balances.</small>
                </>
              )}
            </div>
          </div>
          <div className="ton-telemetry-meta">
            <span>{data.source} · updated {formatTime(data.asOf)}</span>
            <span>Master {data.token.symbol} indexed · {data.token.decimals} decimals</span>
            <a href={`https://tonviewer.com/${encodeURIComponent(data.token.masterAddress)}`} target="_blank" rel="noreferrer">View token master</a>
          </div>
          <section className="explorer-feed" aria-labelledby="explorer-feed-title">
            <div className="explorer-feed-heading"><div><span className="eyebrow">INDEXED MAINNET ACTIVITY</span><h4 id="explorer-feed-title">Wallet &amp; treasury transactions</h4></div><span className="sample-tag">READ ONLY</span></div>
            {data.transactions.length ? <div className="explorer-rows">{data.transactions.map((transaction) => {
              const message = transaction.incoming ?? transaction.outgoing[0]
              const direction = isSameAddress(transaction.incoming?.destination ?? null, transaction.account) ? "IN" : "OUT"
              const rawAmount = message?.valueNano
              const amount = rawAmount && /^\d+$/.test(rawAmount) ? `${(Number(rawAmount) / 1_000_000_000).toFixed(4)} TON` : "TON amount unavailable"
              return <div className="explorer-row" key={`${transaction.account}:${transaction.hash}`}><div><span className={`explorer-direction explorer-${direction.toLowerCase()}`}>{direction}</span><small>{transaction.timestamp ? formatTime(transaction.timestamp) : "Time unavailable"}</small></div><strong>{amount}</strong><a href={`https://tonviewer.com/transaction/${encodeURIComponent(transaction.hash)}`} target="_blank" rel="noreferrer" aria-label={`View transaction ${transaction.hash} on Tonviewer`}>{transaction.hash.slice(0, 10)}…<span>Open explorer</span></a></div>
            })}</div> : <p className="muted-copy">No indexed transactions were returned for the treasury or connected wallet.</p>}
            <p className="telemetry-disclaimer">Explorer data is read-only and does not prove mining, yield, or eligibility for payout. No transaction is sent and no balance is credited by this feed.</p>
          </section>
        </>
      )}

      <div className="heartbeat-row">
        <div>
          <span className="eyebrow">OPT-IN ACCOUNT ACTIVITY</span>
          <p>{heartbeat?.lastSeenAt ? `Last browser heartbeat: ${formatTime(heartbeat.lastSeenAt)}` : "No browser activity heartbeat recorded."}</p>
        </div>
        <button type="button" className="heartbeat-button" onClick={recordHeartbeat} disabled={isRecording}>
          {isRecording ? "Recording…" : userId ? "Record heartbeat" : "Sign in to record"}
        </button>
      </div>
      {heartbeatMessage && <p className="heartbeat-message" role="status">{heartbeatMessage}</p>}
      <p className="telemetry-disclaimer">Toncenter indexer metadata is not an independent contract audit. This activity ping records no compute, yield, reward, or payout, and this panel never initiates a transaction.</p>
    </section>
  )
}
