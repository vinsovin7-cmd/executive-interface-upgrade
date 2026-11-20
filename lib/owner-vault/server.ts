import "server-only"

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"

const SESSION_COOKIE = "owner_vault_session"
const SESSION_TTL_SECONDS = 10 * 60

export class VaultError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function vaultEncryptionKey() {
  const encoded = process.env.OWNER_VAULT_ENCRYPTION_KEY
  if (!encoded) throw new VaultError("Owner vault encryption is not configured.", 503)

  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new VaultError("Owner vault encryption configuration is invalid.", 503)
  }
  return key
}

export function encryptVaultValue(value: string) {
  const key = vaultEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".")
}

export function decryptVaultValue(value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".")
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new VaultError("Stored vault data could not be read.", 500)
  }

  const decipher = createDecipheriv("aes-256-gcm", vaultEncryptionKey(), Buffer.from(encodedIv, "base64url"))
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8")
}

function sessionSigningKey() {
  return createHmac("sha256", vaultEncryptionKey()).update("cybernode-owner-vault-session-v1").digest()
}

function signSession(payload: string) {
  return createHmac("sha256", sessionSigningKey()).update(payload).digest("base64url")
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export async function setVaultSession(ownerId: string) {
  const payload = Buffer.from(`${ownerId}|${Date.now() + SESSION_TTL_SECONDS * 1000}`).toString("base64url")
  const signature = signSession(payload)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/owner-vault",
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function clearVaultSession() {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/owner-vault",
    maxAge: 0,
  })
}

export async function requireVaultOwner() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || user.app_metadata?.role !== "admin") {
    throw new VaultError("Owner access is required.", 403)
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? ""
  const separator = token.lastIndexOf(".")
  if (separator < 1) throw new VaultError("Unlock the owner vault to continue.", 401)

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!safeEqual(signature, signSession(payload))) throw new VaultError("Unlock the owner vault to continue.", 401)

  let sessionOwnerId = ""
  let expiresAt = 0
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8").split("|")
    sessionOwnerId = decoded[0] ?? ""
    expiresAt = Number(decoded[1])
  } catch {
    throw new VaultError("Unlock the owner vault to continue.", 401)
  }

  if (sessionOwnerId !== user.id || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new VaultError("Unlock the owner vault to continue.", 401)
  }

  return user
}

export function ownerVaultErrorResponse(error: unknown) {
  if (error instanceof VaultError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  return Response.json({ error: "Owner vault request could not be completed." }, { status: 500, headers: { "Cache-Control": "no-store" } })
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function verifyVaultPin(received: string, expected: string) {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}
