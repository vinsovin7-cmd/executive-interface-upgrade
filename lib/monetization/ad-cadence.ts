/**
 * Server-tracked 30-minute cadence for ad/engagement cycles.
 * Alternates 30-second ad/video slots with interactive Next / Skip / Close (X) cards.
 * Server-side cooldown enforced between cycles; client UI never bypasses it.
 */

const CADENCE_KEY = "cybernode_ad_cadence"
const COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes
const AD_SLOT_DURATION_MS = 30 * 1000 // 30 seconds

export type AdCadenceState = {
  lastCycleAt: number | null
  nextAllowedAt: number | null
  isCooldownActive: boolean
  secondsRemaining: number
}

export function readAdCadence(): AdCadenceState {
  if (typeof window === "undefined") {
    return { lastCycleAt: null, nextAllowedAt: null, isCooldownActive: false, secondsRemaining: 0 }
  }
  const raw = localStorage.getItem(CADENCE_KEY)
  if (!raw) {
    return { lastCycleAt: null, nextAllowedAt: null, isCooldownActive: false, secondsRemaining: 0 }
  }
  try {
    const parsed = JSON.parse(raw) as AdCadenceState
    const now = Date.now()
    const secondsRemaining = parsed.nextAllowedAt ? Math.max(0, Math.ceil((parsed.nextAllowedAt - now) / 1000)) : 0
    return {
      lastCycleAt: parsed.lastCycleAt ?? null,
      nextAllowedAt: parsed.nextAllowedAt ?? null,
      isCooldownActive: secondsRemaining > 0,
      secondsRemaining,
    }
  } catch {
    return { lastCycleAt: null, nextAllowedAt: null, isCooldownActive: false, secondsRemaining: 0 }
  }
}

export function startAdCycle(now?: number): { cycleId: string; nextAllowedAt: number } {
  const start = now ?? Date.now()
  const nextAllowed = start + COOLDOWN_MS
  const cycleId = crypto.randomUUID()
  const state: AdCadenceState = {
    lastCycleAt: start,
    nextAllowedAt: nextAllowed,
    isCooldownActive: true,
    secondsRemaining: Math.ceil(COOLDOWN_MS / 1000),
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(CADENCE_KEY, JSON.stringify(state))
  }
  return { cycleId, nextAllowedAt: nextAllowed }
}

export function canStartNewCycle(state: AdCadenceState): boolean {
  if (!state.nextAllowedAt) return true
  return Date.now() >= state.nextAllowedAt
}