import { streamText, type ModelMessage } from "ai"
import { createGoogle } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptVaultValue, hasSameOrigin, ownerVaultErrorResponse, requireVaultOwner, VaultError } from "@/lib/owner-vault/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_MESSAGES = 12
const MAX_MESSAGE_LENGTH = 4000
const MAX_TOTAL_LENGTH = 12000

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ error: "Request origin was rejected." }, { status: 403 })
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) {
    return Response.json({ error: "Request content is too large." }, { status: 413 })
  }

  try {
    const owner = await requireVaultOwner()
    const body = await request.json().catch(() => null)
    const provider = body?.provider
    if (provider !== "openrouter" && provider !== "gemini") throw new VaultError("Select a supported provider.", 400)
    if (!Array.isArray(body?.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
      throw new VaultError("Send between one and twelve messages.", 400)
    }

    let totalLength = 0
    const messages: ModelMessage[] = body.messages.map((message: unknown) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new VaultError("A message is invalid.", 400)
      const candidate = message as { role?: unknown; content?: unknown }
      if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") {
        throw new VaultError("Messages must contain plain user or assistant text.", 400)
      }
      const content = candidate.content.trim()
      if (!content || content.length > MAX_MESSAGE_LENGTH) throw new VaultError("Each message must contain 1 to 4,000 characters.", 400)
      totalLength += content.length
      return { role: candidate.role, content } as ModelMessage
    })
    if (totalLength > MAX_TOTAL_LENGTH) throw new VaultError("Keep the conversation under 12,000 characters.", 400)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("owner_vault_settings")
      .select("openrouter_key_ciphertext, gemini_key_ciphertext")
      .eq("owner_user_id", owner.id)
      .maybeSingle()
    if (error) throw new VaultError("Saved provider credentials could not be loaded.", 503)

    const encrypted = provider === "openrouter" ? data?.openrouter_key_ciphertext : data?.gemini_key_ciphertext
    if (!encrypted) throw new VaultError(`Save a ${provider === "gemini" ? "Gemini" : "OpenRouter"} key before using the assistant.`, 400)
    const apiKey = decryptVaultValue(encrypted)
    const model = provider === "openrouter"
      ? createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey }).chatModel("openrouter/auto")
      : createGoogle({ apiKey })("gemini-3.5-flash")

    const result = streamText({
      model,
      messages,
      system: "You are the private CyberNode owner assistant. Be accurate, direct, and explicit about uncertainty. You do not have tools, live web access, on-chain data, telemetry, or account access; never claim to have verified live data, transactions, balances, or operational changes. Explain that limitation and ask for source data when a question depends on it. Treat requests as informational; never claim to submit transactions, manage wallets, or change account settings.",
      maxOutputTokens: 768,
      abortSignal: request.signal,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) controller.enqueue(encoder.encode(chunk))
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store, no-transform",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return ownerVaultErrorResponse(error)
  }
}
