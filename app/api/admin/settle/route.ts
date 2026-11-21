import { NextResponse } from "next/server"

import { adminErrorResponse, requireAdminSession } from "@/lib/admin/session"
import { settlePendingClaims } from "@/lib/rewards/settle"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Operator/cron sweep that settles pending claim payouts. Claim settlement
 * itself is autonomous (it runs inline on every claim request); this endpoint
 * exists so stuck or retried payouts can be re-attempted without a browser
 * session. Callers authenticate either with the admin session cookie or, for a
 * scheduler, with the server-only REWARDS_SETTLE_SECRET bearer token.
 */
async function authorize(request: Request) {
  const secret = process.env.REWARDS_SETTLE_SECRET
  if (secret) {
    const header = request.headers.get("authorization") ?? ""
    if (header === `Bearer ${secret}`) return true
  }
  await requireAdminSession()
  return true
}

export async function POST(request: Request) {
  try {
    await authorize(request)
  } catch (error) {
    return adminErrorResponse(error)
  }

  const result = await settlePendingClaims(10)
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } })
}
