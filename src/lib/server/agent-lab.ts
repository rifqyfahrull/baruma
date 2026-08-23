/**
 * Server-only client for the central agent-lab service (Pattern B).
 * Mirrors llm.ts's resilience contract: returns null on ANY failure so callers
 * fall back to deterministic logic + credit refund exactly as before. Never throws.
 */
const DEFAULT_URL = "https://agentlab.tampil.dev"
const MAX_BLOCKS = 8
const MAX_TOTAL_CHARS = 24000
const TIMEOUT_MS = 115_000

export interface AgentLabContext {
  title: string
  content: string
}

export interface AgentLabToolCall {
  id: string
  type: "function"
  function: { name: string; arguments?: string }
}

export interface AgentLabCompletionMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | null
  tool_calls?: AgentLabToolCall[]
  tool_call_id?: string
}

export interface AgentLabCompletion {
  content: string | null
  toolCalls: AgentLabToolCall[]
  finishReason?: string
}

function baseUrl(): string {
  return process.env.AGENT_LAB_URL || DEFAULT_URL
}

/**
 * Agent Lab issues ONE API key PER AGENT (not one product-wide key for every
 * slug) — so each slug this codebase talks to needs its own env var. Map new
 * slugs here as they're added; `AGENT_LAB_KEY` (the original, prose-agent key)
 * stays the fallback for any slug without a dedicated entry, so existing
 * single-slug deployments keep working unchanged.
 */
const SLUG_KEY_ENV: Record<string, string> = {
  "baruma-floorplan-actions": "AGENT_LAB_KEY_FLOORPLAN_ACTIONS",
}

function apiKey(slug: string): string | undefined {
  const dedicatedEnvVar = SLUG_KEY_ENV[slug]
  const dedicated = dedicatedEnvVar ? process.env[dedicatedEnvVar] : undefined
  return dedicated || process.env.AGENT_LAB_KEY
}

/** True when the default (prose) agent's key is configured — the baseline
 *  "is Agent Lab usable at all" check used by callers before reserving
 *  credits, independent of any per-slug dedicated key. */
export function agentLabEnabled(): boolean {
  return !!process.env.AGENT_LAB_KEY
}

/** Defensive trim so an oversized context never 422s: cap block count, then
 *  cap cumulative title+content chars (dropping whole trailing blocks). */
function trimBlocks(blocks: AgentLabContext[]): AgentLabContext[] {
  const capped = blocks.slice(0, MAX_BLOCKS)
  const out: AgentLabContext[] = []
  let total = 0
  for (const b of capped) {
    const size = b.title.length + b.content.length
    if (total + size > MAX_TOTAL_CHARS) break
    out.push(b)
    total += size
  }
  return out
}

export function formatJsonToMarkdown(obj: Record<string, unknown>): string {
  const primaryVal = obj.response ?? obj.reply ?? obj.answer ?? obj.text ?? obj.message
  if (typeof primaryVal === "string" && primaryVal.trim()) {
    return primaryVal.trim()
  }

  const parts: string[] = []

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue

    const formattedTitle = key
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase())

    if (typeof val === "string") {
      parts.push(`**${formattedTitle}**:\n${val}`)
    } else if (Array.isArray(val)) {
      const listItems = val
        .map((item) => typeof item === "string" ? `- ${item}` : `- ${JSON.stringify(item)}`)
        .join("\n")
      parts.push(`**${formattedTitle}**:\n${listItems}`)
    } else if (typeof val === "object") {
      parts.push(`**${formattedTitle}**:\n${JSON.stringify(val, null, 2)}`)
    } else {
      parts.push(`**${formattedTitle}**: ${String(val)}`)
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : JSON.stringify(obj, null, 2)
}

/**
 * POST /v1/agents/{slug}/ask. Returns the answer string only on mode==="answer";
 * null on clarify/refuse/any failure. Never throws (mirrors llm.ts).
 */
export async function askAgentLab(
  slug: string,
  args: { userId: string; text: string; contextBlocks?: AgentLabContext[] },
): Promise<string | null> {
  const key = apiKey(slug)
  if (!key) return null

  const body: Record<string, unknown> = { user_id: args.userId, text: args.text }
  if (args.contextBlocks && args.contextBlocks.length > 0) {
    body.context_blocks = trimBlocks(args.contextBlocks)
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(slug)}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    console.error("[agent-lab] request error:", e instanceof Error ? e.message : String(e))
    return null
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    console.error(`[agent-lab] HTTP ${res.status} (slug=${slug}):`, errBody)
    return null
  }

  let data: { mode?: string; answer?: string }
  try {
    data = await res.json()
  } catch (e) {
    console.error("[agent-lab] parse error:", e instanceof Error ? e.message : String(e))
    return null
  }

  if (typeof data.answer !== "string" || data.answer.trim() === "") {
    // Empty answer → treat as no direct answer so caller uses graceful fallback.
    return null
  }
  let answerText = data.answer.trim()
  if (answerText.startsWith("{") && answerText.endsWith("}")) {
    try {
      const parsed = JSON.parse(answerText)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!parsed.needs_clarify && !parsed.options && !parsed.actions) {
          answerText = formatJsonToMarkdown(parsed as Record<string, unknown>)
        }
      }
    } catch {
      /* fallback to raw text */
    }
  }
  return answerText
}

/**
 * Execute a structured/text completion through Agent Lab. The request can
 * describe the task and tools, but it cannot select provider, endpoint, model,
 * generation limits, thinking mode, or provider credential; those always come
 * from the selected Agent Lab agent config.
 */
export function stripThinkingTags(text: string): string {
  if (!text) return ""
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim()
}

export async function completeAgentLab(
  slug: string,
  args: {
    userId: string
    messages: AgentLabCompletionMessage[]
    responseFormat?: "text" | "json"
    tools?: readonly unknown[]
    toolChoice?: "auto" | "none"
  },
): Promise<AgentLabCompletion | null> {
  const key = apiKey(slug)
  if (!key) return null

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(slug)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": key },
      body: JSON.stringify({
        user_id: args.userId,
        messages: args.messages,
        response_format: args.responseFormat ?? "text",
        ...(args.tools?.length ? { tools: args.tools, tool_choice: args.toolChoice ?? "auto" } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    console.error("[agent-lab] completion request error:", e instanceof Error ? e.message : String(e))
    return null
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    console.error(`[agent-lab] completion HTTP ${res.status} (slug=${slug}):`, errBody)

    // Fallback: models like DeepSeek V4 Flash may not support 'tools' or 'response_format: json'
    // and return HTTP 400/422. Retry as plain text without tools/response_format.
    if (args.responseFormat === "json" || args.tools?.length) {
      console.warn(`[agent-lab] Retrying completeAgentLab without tools/responseFormat for compatibility...`)
      try {
        const fallbackRes = await fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(slug)}/complete`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-API-Key": key },
          body: JSON.stringify({
            user_id: args.userId,
            messages: args.messages,
            response_format: "text",
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (fallbackRes.ok) {
          res = fallbackRes
        }
      } catch (retryErr) {
        console.error("[agent-lab] fallback request failed:", retryErr instanceof Error ? retryErr.message : String(retryErr))
      }
    }

    if (!res.ok) return null
  }

  let data: { content?: unknown; tool_calls?: unknown; finish_reason?: unknown }
  try {
    data = await res.json()
  } catch (e) {
    console.error("[agent-lab] completion parse error:", e instanceof Error ? e.message : String(e))
    return null
  }

  let content = typeof data.content === "string" ? data.content : null
  if (content) {
    content = stripThinkingTags(content)
  }
  const toolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls.filter((call): call is AgentLabToolCall => {
        if (!call || typeof call !== "object") return false
        const candidate = call as Partial<AgentLabToolCall>
        return typeof candidate.id === "string"
          && candidate.type === "function"
          && !!candidate.function
          && typeof candidate.function.name === "string"
      })
    : []
  if (!content?.trim() && toolCalls.length === 0) return null
  return {
    content,
    toolCalls,
    finishReason: typeof data.finish_reason === "string" ? data.finish_reason : undefined,
  }
}

/**
 * Run a full multi-turn agent execution via Agent-Lab's Agent SDK endpoint.
 * Agent-Lab handles the agent loop, subagents, and tool calls to Baruma's MCP Tool Server.
 */
export async function runAgentLab(
  slug: string,
  args: {
    userId: string
    instruction: string
    mcpServerUrl?: string
    scene?: Record<string, unknown>
  },
): Promise<{ reply: string; actions?: unknown[]; needsClarify?: unknown[] } | null> {
  const key = apiKey(slug)
  if (!key) return null

  try {
    const res = await fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(slug)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": key },
      body: JSON.stringify({
        user_id: args.userId,
        instruction: args.instruction,
        mcp_server_url: args.mcpServerUrl,
        scene: args.scene,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      console.warn(`[agent-lab] runAgent HTTP ${res.status} (slug=${slug})`)
      return null
    }

    const data = await res.json()
    if (!data || typeof data !== "object") return null

    const reply = typeof data.reply === "string" ? stripThinkingTags(data.reply) : ""
    return {
      reply: reply || "Proses agen selesai.",
      actions: Array.isArray(data.actions) ? data.actions : [],
      needsClarify: Array.isArray(data.needs_clarify) ? data.needs_clarify : [],
    }
  } catch (e) {
    console.error("[agent-lab] runAgent request error:", e instanceof Error ? e.message : String(e))
    return null
  }
}
