"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Bot, Send, Volume2, VolumeX } from "lucide-react"

type AssistantMessage = { role: "user" | "assistant"; content: string }
type Provider = "openrouter" | "gemini"

export function OwnerAIAssistant({ hasOpenRouterKey, hasGeminiKey }: { hasOpenRouterKey: boolean; hasGeminiKey: boolean }) {
  const [provider, setProvider] = useState<Provider>(hasOpenRouterKey ? "openrouter" : "gemini")
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const [error, setError] = useState("")
  const transcriptRef = useRef<HTMLDivElement>(null)
  const requestController = useRef<AbortController | null>(null)

  useEffect(() => () => {
    requestController.current?.abort()
    if ("speechSynthesis" in window) window.speechSynthesis.cancel()
  }, [])

  const providerAvailable = provider === "openrouter" ? hasOpenRouterKey : hasGeminiKey

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy || !providerAvailable) return

    const history = [...messages.slice(-10), { role: "user" as const, content: text }]
    const nextMessages = [...history, { role: "assistant" as const, content: "" }]
    setMessages(nextMessages)
    setDraft("")
    setError("")
    setBusy(true)
    const controller = new AbortController()
    requestController.current = controller

    try {
      const response = await fetch("/api/owner-vault/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, messages: history }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(typeof body.error === "string" ? body.error : "The assistant could not complete this request.")
      }
      if (!response.body) throw new Error("The assistant response stream is unavailable.")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let content = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        content += decoder.decode(value, { stream: true })
        setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content } : message))
        transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" })
      }
      content += decoder.decode()
      setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content } : message))
      if (!content.trim()) setError("No text was returned. Check the selected provider key and try again.")
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The assistant could not complete this request.")
        setMessages((current) => current.filter((message, index) => index !== current.length - 1 || message.content.trim()))
      }
    } finally {
      requestController.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function toggleVoice(index: number, text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setError("Voice reading is not supported by this browser.")
      return
    }
    if (speaking === index) {
      window.speechSynthesis.cancel()
      setSpeaking(null)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => setSpeaking(null)
    utterance.onerror = () => setSpeaking(null)
    setSpeaking(index)
    window.speechSynthesis.speak(utterance)
  }

  return <section className="owner-assistant panel" aria-labelledby="owner-assistant-title">
    <div className="owner-assistant-header">
      <div className="owner-assistant-mark" aria-hidden="true"><Bot size={17}/></div>
      <div className="owner-assistant-heading">
        <span className="eyebrow">PRIVATE OWNER TOOL</span>
        <h3 id="owner-assistant-title">CyberNode command assistant</h3>
        <p>Ask for explanations, calculations, or code help. This assistant does not have live chain or telemetry access.</p>
      </div>
      <label className="owner-assistant-provider">
        <span>MODEL PROVIDER</span>
        <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)} aria-label="AI model provider">
          <option value="openrouter" disabled={!hasOpenRouterKey}>OpenRouter · Auto</option>
          <option value="gemini" disabled={!hasGeminiKey}>Google Gemini · Flash</option>
        </select>
      </label>
    </div>

    {!providerAvailable && <p className="owner-assistant-key-note" role="status">Save an encrypted {provider === "openrouter" ? "OpenRouter" : "Gemini"} key above to enable requests.</p>}

    <div className="owner-assistant-transcript" ref={transcriptRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Assistant conversation">
      {messages.length === 0 ? <div className="owner-assistant-empty"><span className="owner-assistant-empty-mark" aria-hidden="true"><Bot size={20}/></span><strong>Ready when you are</strong><span>Choose a provider, then ask a question. Replies can be read aloud using your browser&apos;s voice engine.</span></div> : messages.map((message, index) => <article className={`owner-assistant-message ${message.role}`} key={`${index}-${message.role}`}>
        <div className="owner-assistant-message-meta"><span>{message.role === "user" ? "YOU" : "ASSISTANT"}</span>{message.role === "assistant" && message.content && <button className="owner-assistant-voice" type="button" onClick={() => toggleVoice(index, message.content)} aria-label={speaking === index ? "Stop reading response aloud" : "Read response aloud"} title={speaking === index ? "Stop reading" : "Read aloud"}>{speaking === index ? <VolumeX size={14}/> : <Volume2 size={14}/>}<span>{speaking === index ? "Stop" : "Read aloud"}</span></button>}</div>
        <p>{message.content || (busy && index === messages.length - 1 ? "Thinking…" : "")}</p>
      </article>)}
    </div>

    <form className="owner-assistant-composer" onSubmit={sendMessage}>
      <label className="sr-only" htmlFor="owner-assistant-prompt">Ask the assistant</label>
      <textarea id="owner-assistant-prompt" value={draft} maxLength={4000} rows={3} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a question or describe a problem…" disabled={!providerAvailable || busy} />
      <div className="owner-assistant-composer-footer"><span>{draft.length}/4000 · Owner-only · Provider billing applies</span><button className="settings-action" type="submit" disabled={!providerAvailable || busy || !draft.trim()}><Send size={14}/>{busy ? "Thinking…" : "Ask assistant"}</button></div>
    </form>
    {error && <p className="vault-feedback vault-error" role="alert">{error}</p>}
    <p className="owner-assistant-disclaimer">Requests are limited to 12,000 input characters and 768 generated tokens. Messages are held in this page only and are not stored by the app.</p>
  </section>
}
