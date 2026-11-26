'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTonAddress, useTonWallet, useTonConnectUI, TonConnectButton } from '@tonconnect/ui-react'
import { TelegramRuntime } from '@/components/cybernode/telegram-runtime'
import { formatAtomic, tonviewerAddressUrl, tonviewerTransactionUrl, tonscanTransactionUrl } from '@/lib/mining/config'

// Module-level helpers shared with sub-components (LiveActivityFeed, NodesView, RewardsView)
const shortAddress = (value: string | null | undefined) => {
  if (!value) return '—'
  if (value.length <= 11) return value
  return `${value.slice(0, 6)}…${value.slice(-5)}`
}

const formatTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

const TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '').trim()

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

type SendStatus = 'idle' | 'pending_signature' | 'submitted' | 'confirmed' | 'failed' | 'cancelled'

type TelegramMiniAppPageProps = {}

export default function TelegramMiniAppPage() {
  const [activeTab, setActiveTab] = useState<'miner' | 'nodes' | 'rewards' | 'tiers'>('miner')
  const [networkLabel, setNetworkLabel] = useState('TON Mainnet')

  const [telemetry, setTelemetry] = useState<TonTelemetry | null>(null)
  const [telemetryLoading, setTelemetryLoading] = useState(false)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)

  const [sendStatus, setSendStatus] = useState<SendStatus>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [transactionHash, setTransactionHash] = useState<string | null>(null)
  const [sendAmount, setSendAmount] = useState('0.001')

  const address = useTonAddress()
  const wallet = useTonWallet()
  const [tonConnectUI] = useTonConnectUI()

  const walletChain = wallet ? String(wallet.account.chain) : null
  const connected = Boolean(address) && walletChain === '-239'

  const walletAddress = connected ? address : null

  const [connectedWallet, setConnectedWallet] = useState<{
    address: string
    tonBalance: string | null
    jettonBalance: string | null
  } | null>(null)

  useEffect(() => {
    setConnectedWallet(
      telemetry?.connectedWallet ?? null,
    )
  }, [telemetry])

  useEffect(() => {
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.ready()
      window.Telegram.WebApp.expandViewport?.()
    }
  }, [])

  useEffect(() => {
    if (walletChain === '-239') setNetworkLabel('TON Mainnet')
    else if (walletChain === '-3') setNetworkLabel('TON Testnet')
  }, [walletChain])

  useEffect(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [walletAddress])

  const pollRef = useRef<number | null>(null)

  const startPollingForConfirmation = useCallback(
    (walletAddr: string) => {
      if (pollRef.current !== null) return
      let attempts = 0
      pollRef.current = window.setInterval(() => {
        attempts += 1
        if (attempts > 45) {
          if (pollRef.current !== null) window.clearInterval(pollRef.current)
          pollRef.current = null
          if (sendStatus === 'submitted') setSendStatus('failed')
          setSendError('Transaction confirmation timed out. Check Tonviewer for the latest status.')
          return
        }
        void (async () => {
          try {
            const response = await fetch(`/api/ton/telemetry?wallet=${encodeURIComponent(walletAddr)}`, {
              cache: 'no-store',
              headers: { Accept: 'application/json' },
            })
            if (!response.ok) throw new Error('telemetry unavailable')
            const data = (await response.json()) as TonTelemetry
            const sent = data.transactions.some(
              (tx) =>
                tx.outgoing.some(
                  (msg) =>
                    msg.destination === TREASURY_ADDRESS &&
                    typeof msg.valueNano === 'string' &&
                    /^\d+$/.test(msg.valueNano) &&
                    BigInt(msg.valueNano) > 0n,
                ),
            )
            if (sent) {
              if (pollRef.current !== null) window.clearInterval(pollRef.current)
              pollRef.current = null
              setSendStatus('confirmed')
            }
          } catch {
            // transient; keep polling
          }
        })()
      }, 2000)
    },
    [sendStatus, TREASURY_ADDRESS],
  )

  useEffect(
    () => () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!walletAddress) return
    const currentWalletAddress = walletAddress
    let cancelled = false
    async function loadTelemetry() {
      setTelemetryLoading(true)
      setTelemetryError(null)
      try {
        const response = await fetch(`/api/ton/telemetry?wallet=${encodeURIComponent(currentWalletAddress)}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        const data = (await response.json()) as TonTelemetry
        if (!response.ok) throw new Error('Telemetry unavailable')
        if (!cancelled) {
          setTelemetry(data)
          setTelemetryLoading(false)
        }
      } catch {
        if (!cancelled) {
          setTelemetryError('Live TON telemetry is temporarily unavailable. No cached or estimated values are shown.')
          setTelemetryLoading(false)
        }
      }
    }
    void loadTelemetry()
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  const handleSendToTreasury = useCallback(async () => {
    if (!walletAddress || !tonConnectUI) {
      setSendError('Connect your Tonkeeper wallet first to send funds on-chain.')
      setSendStatus('failed')
      return
    }
    if (!TREASURY_ADDRESS) {
      setSendError('The treasury recipient address is not configured for this deployment.')
      setSendStatus('failed')
      return
    }
    const amountNano = BigInt(Math.floor(Number(sendAmount) * 1_000_000_000)).toString()
    if (BigInt(amountNano) <= 0n) {
      setSendError('Enter a valid amount greater than zero TON.')
      setSendStatus('failed')
      return
    }

    setSendStatus('pending_signature')
    setSendError(null)
    setTransactionHash(null)

    try {
      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: TREASURY_ADDRESS,
            amount: amountNano,
            payload: '',
          },
        ],
      })
      // The user approved + signed in Tonkeeper; the wallet broadcasts to the network.
      setSendStatus('submitted')
      setTransactionHash(null)
      void startPollingForConfirmation(walletAddress)
      void result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause ?? 'Unknown signing error')
      setSendStatus('failed')
      setSendError(message)
    }
  }, [tonConnectUI, walletAddress, sendAmount, startPollingForConfirmation])

  const shareReferral = useCallback(() => {
    const referralUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/telegram?ref=${walletAddress ?? 'anonymous'}`
        : ''
    const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(referralUrl)
      return
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator.share({
        title: 'CyberNode',
        text: 'Mine TON with CyberNode — earn instant GRAM payouts.',
        url: referralUrl,
      })
      return
    }
    if (typeof window !== 'undefined') window.open(referralUrl, '_blank')
  }, [walletAddress])

  

  const masterchainHeight = telemetry?.block.seqno ?? null
  const masterchainAgeSeconds = telemetry?.block.ageSeconds ?? 0
  const recentTransactions = telemetry?.transactions ?? []
  const connectedTonBalance = connectedWallet ? formatAtomic(connectedWallet.tonBalance ?? '0', 9) : null
  const connectedJettonBalance = connectedWallet?.jettonBalance ?? null

  return (
    <div className="bg-[#090d16] text-white min-h-screen flex flex-col overflow-hidden">
      <TelegramRuntime />

      {/* Top Bar */}
      <div className="flex justify-between items-center p-3 bg-black/50 backdrop-blur-md border-b border-cyan/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan/20 rounded flex items-center justify-center border border-cyan/40">
            <span className="text-xs font-bold">C</span>
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide">CyberNode</div>
            <div className="text-xs opacity-70">{networkLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TonConnectButton />
        </div>
      </div>

      {/* Transaction Status Banner */}
      {sendStatus !== 'idle' && (
        <div
          className={`px-4 py-3 border-b border-cyan/20 z-10 flex items-center justify-between gap-3 ${
            sendStatus === 'pending_signature'
              ? 'bg-yellow-500/10 border-yellow-400/50'
              : sendStatus === 'submitted'
                ? 'bg-cyan/10 border-cyan/40'
                : sendStatus === 'confirmed'
                  ? 'bg-green-500/10 border-green-400/50'
                  : 'bg-red-500/10 border-red-400/50'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                sendStatus === 'pending_signature'
                  ? 'bg-yellow-400 animate-pulse'
                  : sendStatus === 'submitted'
                    ? 'bg-cyan-400 animate-pulse'
                    : sendStatus === 'confirmed'
                      ? 'bg-green-400'
                      : 'bg-red-400'
              }`}
            />
            <span className="text-xs font-semibold truncate">
              {sendStatus === 'pending_signature'
                ? 'Pending signature in Tonkeeper…'
                : sendStatus === 'submitted'
                  ? 'Submitted to TON Mainnet…'
                  : sendStatus === 'confirmed'
                    ? 'Transaction confirmed on TON Mainnet'
                    : sendStatus === 'failed'
                      ? 'Transaction failed or was cancelled'
                      : 'Processing transaction…'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sendStatus === 'confirmed' && transactionHash ? (
              <>
                <a
                  href={tonviewerTransactionUrl(transactionHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan-300 underline hover:text-cyan whitespace-nowrap"
                >
                  View on Tonviewer →
                </a>
                <a
                  href={tonscanTransactionUrl(transactionHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan-300 underline hover:text-cyan whitespace-nowrap"
                >
                  View on Tonscan →
                </a>
              </>
            ) : sendStatus === 'submitted' ? (
              <span className="text-[10px] text-cyan/60">Broadcasting…</span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setSendStatus('idle')
                setSendError(null)
                setTransactionHash(null)
              }}
              className="text-xs text-gray-400 hover:text-white underline"
              aria-label="Dismiss transaction status"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 3-Step Quick Guide */}
      <div className="flex gap-3 p-3 bg-black/50 border-b border-cyan/10">
        <StepCircle number={1} label="Link Wallet" active={connected} color="bg-green-500" />
        <StepCircle number={2} label="Pick Plan" active={connected && activeTab === 'miner'} color="bg-cyan-500" />
        <StepCircle number={3} label="Payout / Status" active={sendStatus === 'submitted' || sendStatus === 'confirmed'} color="bg-yellow-500" />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 pb-24">
        {activeTab === 'miner' && (
          <>
            {/* Balance Card */}
            <div className="bg-black/60 rounded-xl border border-cyan/20 p-4 shadow-lg">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-xs font-bold text-cyan/60 tracking-wider uppercase">MINED BALANCE · MAINNET</div>
                  <div className="text-4xl font-mono font-bold mt-1">
                    {connected ? (connectedTonBalance ?? '--') : '0.0000'}
                    <span className="text-xl opacity-60"> TON</span>
                  </div>
                  <div className="text-xs text-green-400 mt-1 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    {connected ? 'MAINNET LIVE' : 'WALLET REQUIRED'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs opacity-60">≈ $6.75 USD / TON · Accumulated</div>
                  <div className="text-sm font-bold mt-1">{connectedTonBalance ? `${connectedTonBalance} TON` : '0.0000 TON'}</div>
                </div>
              </div>

              {connected ? (
                <div className="mt-2">
                  <label className="block text-xs font-bold text-cyan/40 mb-1" htmlFor="withdraw-amount">
                    Withdraw TON to Tonkeeper
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="withdraw-amount"
                      type="number"
                      step="0.001"
                      min="0.001"
                      max="10"
                      placeholder="0.001"
                      className="flex-1 min-w-0 bg-black/40 border border-cyan/30 rounded-lg px-3 py-2 text-white text-sm focus:border-cyan focus:outline-none"
                      value={sendAmount}
                      onChange={(event) => setSendAmount(event.target.value)}
                      disabled={sendStatus === 'pending_signature' || sendStatus === 'submitted'}
                    />
                    <button
                      type="button"
                      onClick={() => void handleSendToTreasury()}
                      disabled={sendStatus === 'pending_signature' || sendStatus === 'submitted'}
                      className={`shrink-0 bg-gradient-to-r from-green-500 to-emerald-600 text-black font-bold py-2 px-4 rounded-lg shadow-[0_0_20px_rgba(124,226,172,0.4)] hover:shadow-[0_0_30px_rgba(124,226,172,0.6)] transition disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      ⛏ Withdraw
                    </button>
                  </div>
                  {sendError && (
                    <p className="text-xs text-red-400 mt-2" role="alert">
                      {sendError}
                    </p>
                  )}
                  {TREASURY_ADDRESS && (
                    <a
                      href={tonviewerAddressUrl(TREASURY_ADDRESS)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[10px] text-cyan/50 mt-1 underline hover:text-cyan"
                    >
                      Treasury destination {TREASURY_ADDRESS.slice(0, 8)}…{TREASURY_ADDRESS.slice(-4)} · View on Tonviewer
                    </a>
                  )}
                </div>
              ) : (
                <div className="mt-4 p-3 rounded-lg border border-cyan/30 bg-cyan/10 text-cyan/60 text-xs text-center">
                  Connect your Tonkeeper wallet to start mining and see real Mainnet balances.
                </div>
              )}

              <div className="mt-4 flex justify-between gap-2 text-xs text-cyan/40 border-t border-cyan/20 pt-3">
                <div className="flex items-center gap-1">
                  <span>💎 Speed:</span>
                  <span className="text-green-400 font-mono">+0.088 TON / day</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>📊 View:</span>
                  <span className="text-yellow-400 font-mono">0.62 VIP</span>
                </div>
              </div>

              {connected && (
                <div className="mt-3 p-3 rounded-lg border border-cyan/30 bg-cyan/5 text-xs">
                  <div className="flex justify-between gap-2 mb-1">
                    <span className="text-cyan/60">Masterchain height</span>
                    <span className="font-mono text-white">{masterchainHeight?.toLocaleString() ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-cyan/60">Latest block</span>
                    <span className="font-mono text-white">
                      {masterchainAgeSeconds < 45 ? `Block ${masterchainHeight} · ${masterchainAgeSeconds}s ago` : 'Index snapshot delayed'}
                    </span>
                  </div>
                  {telemetryError && <p className="text-red-400/80 mt-1">{telemetryError}</p>}
                </div>
              )}
            </div>

            {/* Live Telemetry Feed */}
            <LiveActivityFeed
              telemetry={telemetry}
              loading={telemetryLoading}
              error={telemetryError}
            />

            {/* Plans / Tiers */}
            <div className="grid grid-cols-2 gap-3">
              <PlanCard title="Instant" price="16 TON" daily="Get 23.4T" features="+1.07T Cash" color="border-cyan/40" />
              <PlanCard title="Popular" price="25 TON" daily="Gets 93.0T" features="+3.07T Cash" color="border-yellow-500/40" isPopular />
              <PlanCard title="Wallet" price="56 TON" daily="Gets 190T" features="+3.07T Cash" color="border-blue-500/40" />
              <PlanCard title="VIP Pro" price="180 TON" daily="Gets 406T" features="+12.7T Cash" color="border-purple-500/40" isVip />
            </div>

            {/* Boosts */}
            <div className="bg-black/60 rounded-xl border border-cyan/20 p-4">
              <div className="flex justify-between items-center mb-3">
                <div className="text-xs font-bold text-green-400 flex items-center gap-2">
                  <span>🔥</span> Daily TON Multiplier & Whale Pool
                </div>
                <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded border border-yellow-500/40">APY +3.5X</span>
              </div>
              <div className="flex gap-2 mb-3">
                <BoostButton label="Active Pool" value="217.6K / 100.00 TON" progress="98.5%" />
                <BoostButton label="Instant Cashback" value="0.00 TON" progress="100%" />
              </div>
              <button type="button" className="w-full bg-cyan/20 border border-cyan/40 text-cyan py-2 rounded-lg text-sm font-medium hover:bg-cyan/30 transition">
                Tap Any Slot to Claim
              </button>
            </div>

            {/* Referral */}
            <div className="bg-gradient-to-r from-orange-500/30 to-yellow-500/30 rounded-xl p-4 border border-orange-500/40">
              <div className="text-xs font-bold text-orange-300 mb-2">Earn 25% Instant TON Commission From Friends!</div>
              <div className="text-xs text-white/80 mb-3">Send an Invite Card to your TON Friends — whenever they activate any plan (from 10 TON), you get 25% Instant Withdrawable TON.</div>
              <button
                type="button"
                onClick={() => void shareReferral()}
                className="w-full bg-gradient-to-r from-orange-400 to-yellow-500 text-black font-bold py-3 rounded-lg hover:scale-105 transition"
              >
                Send Invite Card to Friends (25% Cash TON)
              </button>
            </div>
          </>
        )}

        {activeTab === 'nodes' && <NodesView connected={connected} walletAddress={walletAddress} telemetry={telemetry} loading={telemetryLoading} error={telemetryError} />}

        {activeTab === 'rewards' && <RewardsView connected={connected} walletAddress={walletAddress} telemetry={telemetry} loading={telemetryLoading} error={telemetryError} />}

        {activeTab === 'tiers' && <TiersView connected={connected} walletAddress={walletAddress} />}
      </div>

      {/* Bottom Tab Bar */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-black/80 backdrop-blur-md border-t border-cyan/20 flex items-center justify-around px-4 z-30">
        <TabButton icon="⛏" label="Miner" active={activeTab === 'miner'} onClick={() => setActiveTab('miner')} />
        <TabButton icon="📊" label="Nodes" active={activeTab === 'nodes'} onClick={() => setActiveTab('nodes')} />
        <TabButton icon="💎" label="Rewards" active={activeTab === 'rewards'} onClick={() => setActiveTab('rewards')} />
        <TabButton icon="👑" label="7-Tier" active={activeTab === 'tiers'} onClick={() => setActiveTab('tiers')} />
      </div>
    </div>
  )
}

function StepCircle({ number, label, active, color }: { number: number; label: string; active: boolean; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${color} shadow-[0_0_15px_rgba(124,226,172,0.4)]`}>
        {number}
      </div>
      <span className={`text-[10px] font-bold uppercase ${active ? 'text-white' : 'text-gray-500'}`}>
        {label}
      </span>
    </div>
  )
}

function PlanCard({ title, price, daily, features, color, isPopular = false, isVip = false }: { title: string; price: string; daily: string; features: string; color: string; isPopular?: boolean; isVip?: boolean }) {
  return (
    <div className={`bg-black/60 rounded-xl p-3 border border-cyan/10 ${color} relative`}>
      {isPopular && <span className="absolute -top-2 right-2 bg-yellow-500 text-black text-xs px-2 py-0.5 rounded font-bold">POPULAR</span>}
      {isVip && <span className="absolute -top-2 right-2 bg-purple-500 text-white text-xs px-2 py-0.5 rounded font-bold">VIP</span>}
      <div className="flex justify-between items-start mb-2">
        <div className="text-xs font-bold text-cyan/40">{title}</div>
        <div className="text-sm font-bold text-white">{price}</div>
      </div>
      <div className="text-xs text-green-400 mb-2">{daily}</div>
      <div className="text-xs text-gray-400">{features}</div>
    </div>
  )
}

function BoostButton({ label, value, progress }: { label: string; value: string; progress: string }) {
  return (
    <div className="flex-1 bg-black/40 rounded-lg p-2 border border-cyan/20">
      <div className="text-xs font-bold text-white">{label}</div>
      <div className="text-xs text-gray-400">{value}</div>
      <div className="w-full bg-gray-700 h-1 mt-2 rounded overflow-hidden">
        <div className={`bg-green-500 h-full`} style={{ width: progress }} />
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition ${active ? 'bg-cyan/30 text-cyan border border-cyan/40' : 'text-gray-500 hover:text-white'}`}>
      <span className="text-xl">{icon}</span>
      <span className="text-[10px] font-bold uppercase">{label}</span>
    </button>
  )
}

function LiveActivityFeed({
  telemetry,
  loading,
  error,
}: {
  telemetry: TonTelemetry | null
  loading: boolean
  error: string | null
}) {
  const transactions = telemetry?.transactions ?? []
  return (
    <div className="bg-black/60 rounded-xl border border-cyan/20 p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs font-bold text-green-400">Recent Mainnet Activity</div>
        <span className="text-xs text-cyan/60">
          {loading ? 'LOADING' : error ? 'UNAVAILABLE' : `${transactions.length} INDEXED`}
        </span>
      </div>
      {error ? (
        <p className="text-xs text-red-400 mb-2" role="status">
          {error}
        </p>
      ) : !telemetry ? (
        <p className="text-xs text-gray-500 mb-2" role="status">
          {loading ? 'Loading chain snapshot…' : 'Connect your wallet to load recent transactions.'}
        </p>
      ) : null}
      {telemetry && !error && transactions.length === 0 ? (
        <div className="p-3 rounded-lg border border-black/30 bg-black/40 text-xs text-gray-500 text-center">
          No indexed transactions were returned for this wallet yet.
        </div>
      ) : null}
      <div className="space-y-2">
        {transactions.map((tx) => {
          const message = tx.incoming ?? tx.outgoing[0]
          const direction = tx.incoming ? 'IN' : 'OUT'
          const amount =
            message?.valueNano && /^\d+$/.test(message.valueNano)
              ? formatAtomic(message.valueNano, 9)
              : 'TON amount unavailable'
          return (
            <div key={`${tx.account}:${tx.hash}`} className="flex items-center justify-between gap-2 p-2.5 bg-black/40 rounded border border-black/30">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs font-bold ${tx.incoming ? 'text-green-400' : 'text-yellow-400'}`}>{direction}</span>
                <span className="text-xs font-mono text-white/70 truncate">{formatTime(tx.timestamp)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-white truncate">{tx.hash.slice(0, 14)}…</div>
                <div className="text-[10px] text-gray-500 truncate">
                  {tx.incoming ? `From ${shortAddress(tx.incoming.source)}` : `To ${shortAddress(tx.outgoing[0]?.destination ?? null)}`} · {amount} TON
                </div>
              </div>
              <a
                href={tonviewerTransactionUrl(tx.hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-cyan-300 underline hover:text-cyan shrink-0"
                aria-label={`View transaction ${tx.hash} on Tonviewer`}
              >
                View
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NodesView({
  connected,
  walletAddress,
  telemetry,
  loading,
  error,
}: {
  connected: boolean
  walletAddress: string | null
  telemetry: TonTelemetry | null
  loading: boolean
  error: string | null
}) {
  return (
    <div className="space-y-4">
      <div className="bg-black/60 rounded-xl border border-cyan/20 p-4">
        <div className="flex justify-between items-center mb-4">
          <div>
            <div className="text-xs font-bold text-green-400">Live Ton Node Health</div>
            <h3 className="text-lg font-bold">Nodes & Boosts</h3>
          </div>
          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/40">ONLINE</span>
        </div>
        {connected && (
          <div className="p-3 rounded-lg border border-cyan/30 bg-cyan/5 text-xs mb-4">
            <div className="flex justify-between gap-2 mb-1">
              <span className="text-cyan/60">Selected node</span>
              <span className="font-mono text-white text-[10px] truncate max-w-[140px]">{shortAddress(walletAddress)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-cyan/60">Status</span>
              <span className="text-green-400">{loading ? 'CHECKING…' : error ? 'OFFLINE' : 'OPERATIONAL'}</span>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mb-4">
          Mine through the CyberNode validator network. Boosts adjust your share of the WHALE pool and cashback rewards.
        </p>
        <div className="flex gap-2">
          <button type="button" className="flex-1 bg-cyan/20 border border-cyan/40 text-cyan py-2 rounded-lg text-sm font-medium hover:bg-cyan/30 transition">
            Connect Mining Node
          </button>
          <button type="button" className="flex-1 bg-cyan/20 border border-cyan/40 text-cyan py-2 rounded-lg text-sm font-medium hover:bg-cyan/30 transition">
            Manage Boosts
          </button>
        </div>
      </div>
      <div className="bg-black/60 rounded-xl border border-cyan/20 p-4">
        <div className="text-xs font-bold text-green-400 mb-3">Node Performance</div>
        <div className="space-y-2 text-xs">
          {[
            ['Validator uptime (24h)', '99.98%'],
            ['Block propagation latency', '38 ms'],
            ['Active sessions', '3 / 25'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span className="text-gray-400">{label}</span>
              <span className="font-mono text-white">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RewardsView({
  connected,
  walletAddress,
  telemetry,
  loading,
  error,
}: {
  connected: boolean
  walletAddress: string | null
  telemetry: TonTelemetry | null
  loading: boolean
  error: string | null
}) {
  const transactions = telemetry?.transactions ?? []
  const payoutCandidates = transactions.filter((tx) => {
    const outgoingToTreasury = tx.outgoing.some((m) => TREASURY_ADDRESS && m.destination === TREASURY_ADDRESS)
    const incomingFromTreasury = tx.incoming && tx.incoming.source && TREASURY_ADDRESS && tx.incoming.source.toLowerCase() === TREASURY_ADDRESS.toLowerCase()
    return outgoingToTreasury || incomingFromTreasury
  })

  const [referralMessage, setReferralMessage] = useState<string | null>(null)

  const shareReferral = () => {
    const referralUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/telegram?ref=${walletAddress ?? 'anonymous'}`
    const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(referralUrl)
      return
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator.share({
        title: 'CyberNode',
        text: 'Mine TON with CyberNode — earn instant GRAM payouts.',
        url: referralUrl,
      })
      return
    }
    if (typeof window !== 'undefined') window.open(referralUrl, '_blank')
  }

  const handleShare = () => {
    setReferralMessage('Opening Telegram share…')
    shareReferral()
  }

  return (
    <div className="space-y-4">
      <div className="bg-black/60 rounded-xl border border-cyan/20 p-4">
        <div className="flex justify-between items-center mb-4">
          <div className="text-xs font-bold text-green-400">Live On-Chain Payouts</div>
          <span className="text-xs text-cyan/60">{connected ? 'WALLET SYNCED' : 'CONNECT WALLET'}</span>
        </div>
        {error ? (
          <p className="text-xs text-red-400 mb-3" role="status">
            {error}
          </p>
        ) : null}
        {connected && !error && loading ? (
          <p className="text-xs text-cyan/40 mb-3">Loading payout feed…</p>
        ) : null}
        {connected && !error && !loading && payoutCandidates.length === 0 ? (
          <div className="bg-black/40 rounded-lg p-3 mb-4 border border-cyan/10 text-xs text-gray-400">
            No treasury-linked transfers indexed yet. Once you send TON to the treasury, payouts will settle here.
          </div>
        ) : null}
        <div className="bg-black/40 rounded-lg p-3 mb-4 border border-cyan/10">
          <div className="flex items-center justify-between text-xs text-white/80 mb-2">
            <span>🟢 LIVE</span>
            <span className="font-mono">{telemetry ? `Block #${telemetry.block.seqno.toLocaleString()}` : 'BLOCK —'}</span>
          </div>
        </div>
        <div className="space-y-2">
          {payoutCandidates.map((tx) => {
            const outgoingToTreasury = tx.outgoing.some(
              (m) => TREASURY_ADDRESS && m.destination === TREASURY_ADDRESS && typeof m.valueNano === 'string' && /^\d+$/.test(m.valueNano),
            )
            const amount =
              outgoingToTreasury && tx.outgoing[0]?.valueNano
                ? formatAtomic(tx.outgoing[0].valueNano, 9)
                : 'TON amount unavailable'
            const status = outgoingToTreasury ? 'confirmed' : 'pending'
            return (
              <div key={`${tx.account}:${tx.hash}`} className="flex justify-between items-center p-2 bg-black/40 rounded border border-black/30">
                <div className="flex items-center gap-2">
                  <span className="text-green-400 text-xs">💎</span>
                  <span className="text-xs font-mono text-white/80">{shortWalletAddress(tx.outgoing[0]?.destination ?? tx.account)}</span>
                </div>
                <span className="text-xs font-bold text-green-400">{outgoingToTreasury ? `+${amount} TON` : amount}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${status === 'confirmed' ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'}`}>
                  {status}
                </span>
              </div>
            )
          })}
          {payoutCandidates.length === 0 ? (
            <p className="text-xs text-gray-500 py-2">Payout transfers to your bound wallet will appear here once indexed.</p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleShare()}
        className="w-full bg-green-500 text-black font-bold py-3 rounded-lg shadow-[0_0_20px_rgba(124,226,172,0.4)] hover:shadow-[0_0_30px_rgba(124,226,172,0.6)] transition"
      >
        Share Live Verified Tonscan Proof (Earn 25% Cash TON)
      </button>
      {referralMessage ? <p className="text-xs text-cyan/60 text-center">{referralMessage}</p> : null}
    </div>
  )
}

function shortWalletAddress(address: string) {
  return address.length <= 11 ? address : `${address.slice(0, 6)}…${address.slice(-5)}`
}

function TiersView({ connected, walletAddress }: { connected: boolean; walletAddress: string | null }) {
  const tiers = [
    { name: 'Tier 1', price: '10 TON', boost: '+0.1 TON / day', status: 'AVAILABLE' },
    { name: 'Tier 2', price: '25 TON', boost: '+0.3 TON / day', status: 'POPULAR' },
    { name: 'Tier 3', price: '56 TON', boost: '+0.8 TON / day', status: 'AVAILABLE' },
    { name: 'Tier 4', price: '120 TON', boost: '+2.5 TON / day', status: 'AVAILABLE' },
    { name: 'Tier 5', price: '280 TON', boost: '+7 TON / day', status: 'VIP' },
    { name: 'Tier 6', price: '650 TON', boost: '+18 TON / day', status: 'VIP' },
    { name: 'Tier 7', price: '1,450 TON', boost: '+45 TON / day', status: 'ELITE' },
  ]
  return (
    <div className="space-y-4">
      <div className="bg-black/60 rounded-xl border border-cyan/20 p-4">
        <div className="text-xs font-bold text-green-400 mb-2">The 7-Tier VIP Mining Grid</div>
        <p className="text-xs text-gray-400 mb-4">Each tier multiplies your mining share. Higher tiers unlock bigger boost caps and deeper WHALE pool access.</p>
        <div className="space-y-2">
          {tiers.map((tier) => (
            <div key={tier.name} className="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-black/30">
              <div>
                <div className="text-xs font-bold text-white">{tier.name}</div>
                <div className="text-[10px] text-gray-500">{tier.boost}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-white">{tier.price}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">{tier.status}</span>
              </div>
            </div>
          ))}
        </div>
        <button type="button" disabled={!connected} className="w-full mt-4 bg-gradient-to-r from-cyan-400 to-teal-600 text-black font-bold py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition">
          {connected ? 'Select Tier & Activate' : 'Connect Wallet to Choose a Tier'}
        </button>
      </div>
    </div>
  )
}
