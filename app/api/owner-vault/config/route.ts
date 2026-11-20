import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { encryptVaultValue, hasSameOrigin, ownerVaultErrorResponse, requireVaultOwner, VaultError } from "@/lib/owner-vault/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const owner = await requireVaultOwner()
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("owner_vault_settings")
      .select("openrouter_key_ciphertext, gemini_key_ciphertext, staking_target")
      .eq("owner_user_id", owner.id)
      .maybeSingle()
    if (error) throw new VaultError("Owner vault settings could not be loaded.", 503)

    return NextResponse.json({
      hasOpenRouterKey: Boolean(data?.openrouter_key_ciphertext),
      hasGeminiKey: Boolean(data?.gemini_key_ciphertext),
      stakingTarget: data?.staking_target ?? "",
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return ownerVaultErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 })
  try {
    const owner = await requireVaultOwner()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new VaultError("Invalid vault settings.", 400)

    const admin = createAdminClient()
    const { data: current, error: readError } = await admin
      .from("owner_vault_settings")
      .select("openrouter_key_ciphertext, gemini_key_ciphertext, staking_target")
      .eq("owner_user_id", owner.id)
      .maybeSingle()
    if (readError) throw new VaultError("Owner vault settings could not be loaded.", 503)

    const update: {
      owner_user_id: string
      openrouter_key_ciphertext: string | null
      gemini_key_ciphertext: string | null
      staking_target: string | null
      updated_at: string
    } = {
      owner_user_id: owner.id,
      openrouter_key_ciphertext: current?.openrouter_key_ciphertext ?? null,
      gemini_key_ciphertext: current?.gemini_key_ciphertext ?? null,
      staking_target: current?.staking_target ?? null,
      updated_at: new Date().toISOString(),
    }

    for (const [field, column] of [["openrouterKey", "openrouter_key_ciphertext"], ["geminiKey", "gemini_key_ciphertext"]] as const) {
      if (!(field in body)) continue
      const value = body[field]
      if (typeof value !== "string" || value.length > 512 || (value && /\s/.test(value))) {
        throw new VaultError("API keys must be non-empty tokens with at most 512 characters, or empty to clear.", 400)
      }
      update[column] = value ? encryptVaultValue(value) : null
    }

    if ("stakingTarget" in body) {
      const value = body.stakingTarget
      if (typeof value !== "string" || value.length > 128) throw new VaultError("Invalid TON address.", 400)
      const target = value.trim()
      if (target && !/^[A-Za-z0-9_-]{48}$/.test(target)) throw new VaultError("Enter a 48-character TON user-friendly address.", 400)
      update.staking_target = target || null
    }

    const { error } = await admin.from("owner_vault_settings").upsert(update, { onConflict: "owner_user_id" })
    if (error) throw new VaultError("Owner vault settings could not be saved.", 503)

    return NextResponse.json({
      saved: true,
      hasOpenRouterKey: Boolean(update.openrouter_key_ciphertext),
      hasGeminiKey: Boolean(update.gemini_key_ciphertext),
      stakingTarget: update.staking_target ?? "",
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return ownerVaultErrorResponse(error)
  }
}
