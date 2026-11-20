"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Cell } from "@ton/core"
import { isSwapQuote, Omniston, type Quote as OmnistonQuote, type QuoteRequest } from "@ston-fi/omniston-sdk"
import { useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react"
import { ArrowDownUp, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react"

type TonSnapshot = {
  token: { masterAddress: string; symbol: string; decimals: number }
  connectedWallet: { jettonBalance: string | null; tonBalance: string | null } | null
}

const USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"
const omniston = new Omniston({ apiUrl: "wss://omni-ws.ston.fi" })
const fetchJson = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("Live TON token data is unavailable.")
  return response.json() as Promise<TonSnapshot>
}

type Asset = "GRAM" | "TON" | "USDT"

function tokenAddress(asset: Asset, gramMaster: string) {
  if (asset === "TON") return undefined
  return asset === "GRAM" ? gramMaster : USDT_MASTER
}

function assetId(asset: Asset, gramMaster: string) {
  const master = tokenAddress(asset, gramMaster)
  return {
    chain: {
      $case: "ton" as const,
      value: master
        ? { kind: { $case: "jetton" as const, value: master } }
        : { kind: { $case: "native" as const, value: {} } },
    },
  }
}

function toUnits(value: string, decimals: number) {
  if (!/^\d*(?:\.\d*)?$/.test(value) || !value || value === ".") return null
  const [whole, fraction = ""] = value.split(".")
  if (fraction.length > decimals) return null
  let scale = BigInt(1)
  for (let index = 0; index < decimals; index += 1) scale *= BigInt(10)
  return (BigInt(whole || "0") * scale + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")).toString()
}

function formatUnits(raw: string, decimals: number) {
  if (!/^\d+$/.test(raw)) return "Unavailable"
  const digits = raw.padStart(decimals + 1, "0")
  const fraction = digits.slice(-decimals).replace(/0+$/, "")
  return fraction ? `${digits.slice(0, -decimals)}.${fraction}` : digits.slice(0, -decimals)
}

export function DexSwap({ walletChain }: { walletChain: string | null }) {
  const [tonConnectUI] = useTonConnectUI()
  const walletAddress = useTonAddress()
  const wallet = useTonWallet()
  const { data: snapshot, error: snapshotError } = useSWR<TonSnapshot>(
    walletAddress && walletChain === "-239" ? `/api/ton/telemetry?wallet=${encodeURIComponent(walletAddress)}` : null,
    fetchJson,
    { revalidateOnFocus: true, dedupingInterval: 15_000 },
  )
  const [from, setFrom] = useState<Asset>("GRAM")
  const [to, setTo] = useState<Asset>("USDT")
  const [amount, setAmount] = useState("")
  const [quote, setQuote] = useState<OmnistonQuote | null>(null)
  const [quoteError, setQuoteError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const gramDecimals = snapshot?.token.decimals ?? null
  const fromDecimals = from === "TON" ? 9 : from === "USDT" ? 6 : gramDecimals
  const toDecimals = to === "TON" ? 9 : to === "USDT" ? 6 : gramDecimals
  const fromUnits = fromDecimals === null ? null : toUnits(amount, fromDecimals)
  const gramMaster = snapshot?.token.masterAddress
  const quoteRequest = useMemo(() => {
    if (!fromUnits || fromUnits === "0" || !gramMaster || from === to || fromDecimals === null) return null
    return {
      inputAsset: assetId(from, gramMaster),
      outputAsset: assetId(to, gramMaster),
      amount: { $case: "inputUnits" as const, value: fromUnits },
      settlementParams: [{ params: { $case: "swap" as const, value: { maxPriceSlippagePips: 5_000, flexibleIntegratorFee: true } } }],
    } satisfies QuoteRequest
  }, [from, to, fromUnits, fromDecimals, gramMaster])

  useEffect(() => {
    setQuote(null)
    setQuoteError("")
    if (!quoteRequest || walletChain !== "-239") return
    const stream = omniston.requestForQuote(quoteRequest)
    const subscription = stream.subscribe({
      next(event) {
        if (event.$case === "quoteUpdated") {
          const nextQuote = event.value
          setQuote(isSwapQuote(nextQuote) ? nextQuote : null)
        } else if (event.$case === "ack" || event.$case === "noQuote" || event.$case === "unsubscribed") {
          setQuote(null)
          if (event.$case === "noQuote") setQuoteError("No live route is currently available for this pair and amount.")
        }
      },
      error() {
        setQuote(null)
        setQuoteError("Live quote service is unavailable. No estimate is shown.")
      },
    })
    return () => subscription.unsubscribe()
  }, [quoteRequest, walletChain])

  const executeSwap = async () => {
    if (!quote || !walletAddress || !wallet || !isSwapQuote(quote)) return
    setIsSubmitting(true)
    setMessage("")
    try {
      const swapTx = await omniston.tonBuildSwap({
        quoteId: quote.quoteId,
        transferSrcAddress: { chain: { $case: "ton", value: walletAddress } },
      })
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: "-239",
        messages: swapTx.messages.map((item) => ({
          address: item.targetAddress,
          amount: item.sendAmount,
          payload: item.payload ? Cell.fromHex(item.payload).toBoc().toString("base64") : undefined,
          stateInit: item.jettonWalletStateInit ? Cell.fromHex(item.jettonWalletStateInit).toBoc().toString("base64") : undefined,
        })),
      })
      setQuote(null)
      setMessage("Wallet returned the signed transaction request. Broadcast and settlement are not confirmed here; verify wallet activity on-chain.")
    } catch {
      setMessage("Swap was not confirmed by the wallet. No successful trade is recorded here.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const receive = quote && toDecimals !== null ? formatUnits(quote.outputUnits, toDecimals) : null
  const ready = walletChain === "-239" && Boolean(gramMaster) && !snapshotError

  return (
    <section className="panel dex-panel" aria-labelledby="dex-swap-title">
      <div className="panel-header">
        <div><span className="eyebrow">STON.FI OMNISTON · TON MAINNET</span><h3 id="dex-swap-title">Swap tokens</h3></div>
        <span className="sample-tag">LIVE QUOTE ONLY</span>
      </div>
      <p className="dex-intro">Request a current route from STON.fi. Nothing is sent until you review and approve the transaction in your TON wallet.</p>
      <div className="dex-fields">
        <label className="dex-field"><span>You pay</span><input inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount to swap" placeholder="0.00"/><select aria-label="Pay token" value={from} onChange={(event) => setFrom(event.target.value as Asset)}><option value="GRAM">GRAM</option><option value="TON">TON</option><option value="USDT">USDT</option></select></label>
        <button className="dex-reverse" type="button" aria-label="Reverse swap tokens" onClick={() => { setFrom(to); setTo(from) }}><ArrowDownUp size={15}/></button>
        <label className="dex-field"><span>You receive · live quote</span><output aria-live="polite">{receive ?? "—"}</output><select aria-label="Receive token" value={to} onChange={(event) => setTo(event.target.value as Asset)}><option value="USDT">USDT</option><option value="TON">TON</option><option value="GRAM">GRAM</option></select></label>
      </div>
      <div className="dex-meta"><span>Maximum price slippage: 0.5%</span><span>Quotes are indicative until wallet approval and on-chain settlement.</span></div>
      {snapshotError && <p className="dex-status" role="status">Live token metadata is unavailable. Swap quotes are disabled.</p>}
      {walletChain !== "-239" && <p className="dex-status" role="status">Connect a TON Mainnet wallet to request a quote.</p>}
      {ready && quoteError && <p className="dex-status" role="status">{quoteError}</p>}
      {ready && quoteRequest && !quote && !quoteError && <p className="dex-status" role="status"><RefreshCw size={13}/> Requesting a live route…</p>}
      {quote && <p className="dex-quote" role="status"><ShieldCheck size={14}/> Live route available · {amount} {from} → {receive} {to}</p>}
      <button className="dex-submit" type="button" onClick={executeSwap} disabled={!quote || isSubmitting || !wallet || !isSwapQuote(quote)}>{isSubmitting ? "Waiting for wallet…" : quote ? "Review transaction in wallet" : "Waiting for live quote"}</button>
      {message && <p className="dex-status" role="status">{message} {message.startsWith("Wallet returned") && <a href={`https://tonviewer.com/${encodeURIComponent(walletAddress)}`} target="_blank" rel="noreferrer">Open wallet activity <ExternalLink size={12}/></a>}</p>}
      <p className="dex-disclaimer">GRAM master address comes from this app&apos;s configured indexer and is not independently audited. Confirm the token and transaction details in your wallet; never treat a wallet response as proof of settlement.</p>
    </section>
  )
}
