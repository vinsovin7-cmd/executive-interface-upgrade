import { createHmac, timingSafeEqual } from "node:crypto"

type TelegramUser = {
  id: number | string
  username?: unknown
  first_name?: unknown
  last_name?: unknown
  photo_url?: unknown
}

export type VerifiedTelegramIdentity = {
  telegramUserId: string
  username: string | null
  firstName: string | null
  lastName: string | null
  photoUrl: string | null
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function cleanPhotoUrl(value: unknown): string | null {
  const candidate = cleanText(value, 512)
  if (!candidate) return null
  try {
    return new URL(candidate).protocol === "https:" ? candidate : null
  } catch {
    return null
  }
}

// Validates Telegram Mini App initData using the documented HMAC-SHA-256 flow:
// secretKey = HMAC_SHA256(key = "WebAppData", msg = botToken)
// expectedHash = HMAC_SHA256(key = secretKey, msg = dataCheckString)
export function verifyTelegramInitData(initData: string, botToken: string): VerifiedTelegramIdentity | null {
  if (!initData || initData.length > 4096 || !botToken) return null

  const params = new URLSearchParams(initData)
  const suppliedHash = params.get("hash")
  const authDate = Number(params.get("auth_date"))
  const now = Math.floor(Date.now() / 1000)

  if (!suppliedHash || !/^[a-f0-9]{64}$/i.test(suppliedHash)) return null
  if (!Number.isInteger(authDate) || authDate > now + 60 || now - authDate > 86_400) return null

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest()
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest()
  const receivedHash = Buffer.from(suppliedHash, "hex")

  if (receivedHash.length !== expectedHash.length || !timingSafeEqual(receivedHash, expectedHash)) return null

  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramUser | null
    const telegramUserId = user?.id == null ? "" : String(user.id)
    if (!/^\d{1,20}$/.test(telegramUserId)) return null

    return {
      telegramUserId,
      username: cleanText(user?.username, 64),
      firstName: cleanText(user?.first_name, 64),
      lastName: cleanText(user?.last_name, 64),
      photoUrl: cleanPhotoUrl(user?.photo_url),
    }
  } catch {
    return null
  }
}
