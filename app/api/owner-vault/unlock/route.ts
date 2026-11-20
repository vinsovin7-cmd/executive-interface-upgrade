import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clearVaultSession, hasSameOrigin, ownerVaultErrorResponse, setVaultSession, VaultError, verifyVaultPin } from "@/lib/owner-vault/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 })

  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user || user.app_metadata?.role !== "admin") throw new VaultError("Owner access is required.", 403)

    const body = await request.json().catch(() => null)
    const pin = typeof body?.pin === "string" ? body.pin : ""
    if (!pin || pin.length > 128) throw new VaultError("Enter the owner PIN.", 400)

    const admin = createAdminClient()
    const { data: existing, error: readError } = await admin
      .from("owner_vault_settings")
      .select("lock_until")
      .eq("owner_user_id", user.id)
      .maybeSingle()
    if (readError) throw new VaultError("Owner vault could not be checked.", 503)
    if (existing?.lock_until && new Date(existing.lock_until).getTime() > Date.now()) {
      throw new VaultError("Owner vault is temporarily locked. Try again after the lockout period.", 429)
    }

    const expectedPin = process.env.OWNER_VAULT_PIN
    if (!expectedPin) throw new VaultError("Owner vault PIN is not configured.", 503)
    if (!verifyVaultPin(pin, expectedPin)) {
      const { data: lockUntil, error: lockError } = await admin.rpc("record_owner_vault_failure", { p_owner_user_id: user.id })
      if (lockError) throw new VaultError("Owner vault protection could not be updated.", 503)
      if (lockUntil && new Date(lockUntil).getTime() > Date.now()) {
        throw new VaultError("Too many incorrect attempts. Owner vault is locked for fifteen minutes.", 429)
      }
      throw new VaultError("Owner PIN is incorrect.", 401)
    }

    const { error: resetError } = await admin
      .from("owner_vault_settings")
      .update({ failed_attempts: 0, lock_until: null })
      .eq("owner_user_id", user.id)
    if (resetError) throw new VaultError("Owner vault protection could not be reset.", 503)

    await setVaultSession(user.id)
    return NextResponse.json({ unlocked: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return ownerVaultErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 })
  try {
    await clearVaultSession()
    return NextResponse.json({ locked: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return ownerVaultErrorResponse(error)
  }
}
