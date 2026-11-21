import { NextResponse } from "next/server"

import {
  adminErrorResponse,
  adminGuardKey,
  clearAdminSession,
  clearLoginFailures,
  hasSameOrigin,
  isAdminSessionValid,
  readAdminPin,
  readLoginLock,
  recordLoginFailure,
  setAdminSession,
  verifyAdminPin,
} from "@/lib/admin/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const authenticated = await isAdminSessionValid()
  return NextResponse.json({ authenticated }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(request: Request) {
  try {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin admin requests are not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } })
    }
    const expected = readAdminPin()

    const guardKey = adminGuardKey(request)
    const lockedUntil = await readLoginLock(guardKey)
    if (lockedUntil) {
      const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000))
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${retryAfterSeconds}s.`, retryAfterSeconds },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { pin?: unknown } | null
    const received = typeof body?.pin === "string" ? body.pin : ""
    if (!received || !verifyAdminPin(received, expected)) {
      const lockUntil = await recordLoginFailure(guardKey)
      if (lockUntil) {
        return NextResponse.json(
          { error: "Too many failed attempts. Admin login is temporarily locked.", retryAfterSeconds: Math.max(1, Math.ceil((lockUntil.getTime() - Date.now()) / 1000)) },
          { status: 429, headers: { "Cache-Control": "no-store" } },
        )
      }
      return NextResponse.json({ error: "Incorrect access PIN." }, { status: 401, headers: { "Cache-Control": "no-store" } })
    }

    await clearLoginFailures(guardKey)
    await setAdminSession()
    return NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin admin requests are not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } })
    }
    await clearAdminSession()
    return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return adminErrorResponse(error)
  }
}
