import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptVaultValue, hasSameOrigin, ownerVaultErrorResponse, requireVaultOwner, VaultError } from "@/lib/owner-vault/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 })

  try {
    const owner = await requireVaultOwner()
    const body = await request.json().catch(() => null)
    const provider = body?.provider
    if (provider !== "openrouter" && provider !== "gemini") throw new VaultError("Select a supported provider.", 400)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("owner_vault_settings")
      .select("openrouter_key_ciphertext, gemini_key_ciphertext")
      .eq("owner_user_id", owner.id)
      .maybeSingle()
    if (error) throw new VaultError("Saved provider credentials could not be loaded.", 503)

    const encrypted = provider === "openrouter" ? data?.openrouter_key_ciphertext : data?.gemini_key_ciphertext
    if (!encrypted) throw new VaultError(`Save a ${provider === "gemini" ? "Gemini" : "OpenRouter"} key before testing it.`, 400)
    const key = decryptVaultValue(encrypted)
    const url = provider === "openrouter"
      ? "https://openrouter.ai/api/v1/models"
      : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"
    const response = await fetch(url, {
      method: "GET",
      headers: provider === "openrouter" ? { Authorization: `Bearer ${key}` } : { "x-goog-api-key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    })

    return NextResponse.json({
      provider,
      ok: response.ok,
      message: response.ok ? "Credential accepted by provider." : "Provider rejected the credential or access is unavailable.",
    }, { status: response.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Provider test timed out. No key details were logged." }, { status: 504, headers: { "Cache-Control": "no-store" } })
    }
    return ownerVaultErrorResponse(error)
  }
}
