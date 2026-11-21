/**
 * Server-to-Server Telegram Alert & Digest Dispatcher.
 * Rate-limited queuing with 429 retry_after exponential backoff to avoid Telegram throttling/bans.
 * Never sends unsolicited spam blasts — only user-initiated or server-triggered event notifications.
 */

interface TelegramMessage {
  chatId: string
  text: string
  parseMode?: "HTML" | "Markdown"
  disableWebPagePreview?: boolean
}

interface DispatchResult {
  ok: boolean
  messageId?: number
  retryAfter?: number
  error?: string
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1000

async function sendWithBackoff(
  url: string,
  body: TelegramMessage,
  attempt = 0
): Promise<DispatchResult> {
  if (!BOT_TOKEN) {
    return { ok: false, error: "Telegram bot not configured" }
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (response.ok && data.ok) {
      return { ok: true, messageId: data.result?.message_id }
    }

    if (response.status === 429) {
      const retryAfter = data.parameters?.retry_after ?? Math.pow(2, attempt) * BASE_BACKOFF_MS
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, retryAfter))
        return sendWithBackoff(url, body, attempt + 1)
      }
      return { ok: false, error: "Rate limited after max retries", retryAfter }
    }

    return { ok: false, error: data.description ?? "Telegram API error" }
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      const backoff = Math.pow(2, attempt) * BASE_BACKOFF_MS
      await new Promise((r) => setTimeout(r, backoff))
      return sendWithBackoff(url, body, attempt + 1)
    }
    return { ok: false, error: error instanceof Error ? error.message : "Network error" }
  }
}

export async function dispatchTelegramAlert(message: TelegramMessage): Promise<DispatchResult> {
  if (!BOT_TOKEN) {
    return { ok: false, error: "Telegram bot not configured" }
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  return sendWithBackoff(url, message)
}

export async function dispatchTelegramDigest(messages: TelegramMessage[]): Promise<DispatchResult[]> {
  if (!BOT_TOKEN) {
    return messages.map(() => ({ ok: false, error: "Telegram bot not configured" }))
  }
  // Process sequentially to respect rate limits
  const results: DispatchResult[] = []
  for (const message of messages) {
    const result = await dispatchTelegramAlert(message)
    results.push(result)
    // Small delay between messages to stay under rate limits
    if (messages.length > 1) await new Promise((r) => setTimeout(r, 100))
  }
  return results
}

// Event types for server-tracked logging
export type TelegramEventType =
  | "ad_cycle_started"
  | "ad_cycle_completed"
  | "ad_skipped"
  | "ad_closed"
  | "withdrawal_broadcast"
  | "withdrawal_confirmed"
  | "reward_claimed"
  | "referral_shared"
  | "mining_session_started"
  | "wallet_bound"

export function formatEventMessage(
  type: TelegramEventType,
  payload: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString()
  const lines = [`📊 <b>CyberNode Event: ${type}</b>`, `<code>${timestamp}</code>`]
  for (const [key, value] of Object.entries(payload)) {
    lines.push(`<b>${key}:</b> <code>${String(value)}</code>`)
  }
  return lines.join("\n")
}