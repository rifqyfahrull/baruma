/**
 * Thin wrapper around the official `openai` SDK (branch `emergent`),
 * configured against any OpenAI-compatible chat completions endpoint —
 * OpenAI itself, DeepSeek, z.ai, or any other provider that speaks the same
 * wire format — via `OPENAI_BASE_URL`. Replaces the old Agent Lab HTTP
 * client: Baruma now owns model selection directly instead of delegating it
 * to a remote per-slug agent config.
 *
 * Mirrors the previous resilience contract: never throws, resolves to null
 * on any failure so callers fall back to their deterministic logic.
 */
import OpenAI from "openai"

const TIMEOUT_MS = 115_000

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface OpenAIChatResult {
  content: string | null
}

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

let cachedClient: OpenAI | null = null
let cachedKey: string | undefined

function getClient(apiKey: string): OpenAI {
  if (cachedClient && cachedKey === apiKey) return cachedClient
  cachedClient = new OpenAI({
    apiKey,
    baseURL: getEnv("OPENAI_BASE_URL"),
    timeout: TIMEOUT_MS,
  })
  cachedKey = apiKey
  return cachedClient
}

export function llmProviderEnabled(): boolean {
  return !!getEnv("OPENAI_API_KEY")
}

export async function completeChat(args: {
  messages: OpenAIChatMessage[]
  model: string
  responseFormat?: "text" | "json"
  temperature?: number
  user?: string
}): Promise<OpenAIChatResult | null> {
  const apiKey = getEnv("OPENAI_API_KEY")
  if (!apiKey) return null

  const client = getClient(apiKey)
  const wantsJson = args.responseFormat === "json"
  const baseRequest = {
    model: args.model,
    messages: args.messages,
    temperature: args.temperature,
    ...(args.user ? { user: args.user } : {}),
  }

  try {
    const completion = await client.chat.completions.create({
      ...baseRequest,
      ...(wantsJson ? { response_format: { type: "json_object" as const } } : {}),
    })
    return { content: completion.choices[0]?.message?.content ?? null }
  } catch (e) {
    // Some OpenAI-compatible providers (DeepSeek, z.ai, ...) reject
    // `response_format: json_object` on certain models — retry once in
    // plain text mode for compatibility, same fallback the old Agent Lab
    // client used for its own 400/422 responses.
    if (wantsJson) {
      console.warn("[openai-client] retrying without response_format for compatibility...")
      try {
        const completion = await client.chat.completions.create(baseRequest)
        return { content: completion.choices[0]?.message?.content ?? null }
      } catch (retryErr) {
        console.error(
          "[openai-client] retry failed:",
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        )
        return null
      }
    }
    console.error("[openai-client] completion error:", e instanceof Error ? e.message : String(e))
    return null
  }
}
