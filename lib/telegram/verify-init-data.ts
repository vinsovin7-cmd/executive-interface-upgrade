import { createHmac, timingSafeEqual } from "node:crypto"

type TelegramUser = { id: number | string }

type VerifiedTelegramInitData = {
  telegramUserId: string
}

export function verifyTelegramInitData(initData: string, botToken: string): VerifiedTelegramInitData | null {
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
    return { telegramUserId }
  } catch {
    return null
  }
}
