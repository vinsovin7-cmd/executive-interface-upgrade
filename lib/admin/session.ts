import "server-only"

import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"

// The operator control plane is gated by a server-only PIN and a signed,
// HttpOnly, Secure, SameSite=Lax session cookie. ADMIN_ACCESS_PIN is read
// exclusively through process.env on the server and is never prefixed with
// NEXT_PUBLIC_, so it can never reach a client bundle.
const SESSION_COOKIE = "admin_session"
const SESSION_TTL_SECONDS = 8 * 60 * 60

export class AdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Reads the server-only admin PIN, or fails closed when it is not configured. */
export function readAdminPin() {
  const pin = process.env.ADMIN_ACCESS_PIN
  if (!pin || pin.length < 6) throw new AdminError("Admin access is not configured on the server.", 503)
  return pin
}

export function isAdminConfigured() {
  return Boolean(process.env.ADMIN_ACCESS_PIN && process.env.ADMIN_ACCESS_PIN.length >= 6)
}

/** Session tokens are signed with a key derived from the server-only PIN. */
function sessionSigningKey() {
  return createHmac("sha256", readAdminPin()).update("cybernode-admin-session-v1").digest()
}

function signSession(payload: string) {
  return createHmac("sha256", sessionSigningKey()).update(payload).digest("base64url")
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function verifyAdminPin(received: string, expected: string) {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

/**
 * Stable, non-reversible guard key for login rate limiting. Keyed by the
 * hashed client address so failed attempts are counted per origin without
 * storing raw identifiers.
 */
export function adminGuardKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown"
  return createHash("sha256").update(`cybernode-admin:${ip}`).digest("hex").slice(0, 48)
}

/** Returns the epoch millisecond time a guard key is locked until, or null. */
export async function readLoginLock(guardKey: string) {
  const admin = createAdminClient()
  const { data } = await admin.from("admin_login_guard").select("lock_until").eq("guard_key", guardKey).maybeSingle()
  if (!data?.lock_until) return null
  const lockUntil = new Date(data.lock_until).getTime()
  return Number.isFinite(lockUntil) && lockUntil > Date.now() ? lockUntil : null
}

/** Records a failed attempt; returns the lock expiry when the account is locked. */
export async function recordLoginFailure(guardKey: string) {
  const admin = createAdminClient()
  const { data } = await admin.rpc("record_admin_login_failure", { p_guard_key: guardKey })
  return typeof data === "string" ? new Date(data) : null
}

export async function clearLoginFailures(guardKey: string) {
  const admin = createAdminClient()
  await admin.rpc("clear_admin_login_failures", { p_guard_key: guardKey })
}

export async function setAdminSession() {
  const payload = Buffer.from(`admin|${Date.now() + SESSION_TTL_SECONDS * 1000}`).toString("base64url")
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, `${payload}.${signSession(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

/** Server-side verification of the signed admin cookie (signature + expiry). */
export async function isAdminSessionValid() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? ""
    const separator = token.lastIndexOf(".")
    if (separator < 1) return false

    const payload = token.slice(0, separator)
    const signature = token.slice(separator + 1)
    if (!safeEqual(signature, signSession(payload))) return false

    const decoded = Buffer.from(payload, "base64url").toString("utf8").split("|")
    const scope = decoded[0] ?? ""
    const expiresAt = Number(decoded[1])
    return scope === "admin" && Number.isFinite(expiresAt) && expiresAt > Date.now()
  } catch {
    return false
  }
}

/** Mandatory guard for every /admin API mutation. Throws when unauthenticated. */
export async function requireAdminSession() {
  if (!(await isAdminSessionValid())) throw new AdminError("Admin authentication required.", 401)
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof AdminError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  return Response.json({ error: "Admin request could not be completed." }, { status: 500, headers: { "Cache-Control": "no-store" } })
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
