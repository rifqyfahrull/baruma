/**
 * Compatibility facade for Baruma's LLM call sites.
 *
 * All inference is executed by the central Agent Lab service. Baruma owns only
 * task prompts and pure tool dispatch; provider, endpoint, model, temperature,
 * max tokens, thinking mode, and provider API key are exclusively resolved
 * from Agent Lab per-slug: `baruma-assistant` for prose (chatText), or
 * `baruma-floorplan-actions` for structured actions (chatJSON).
 *
 * Agent Lab issues one API key PER AGENT (not one product-wide key), so each
 * slug needs its own env var — see `agent-lab.ts`'s `SLUG_KEY_ENV` map
 * (`AGENT_LAB_KEY_FLOORPLAN_ACTIONS` for this slug; `AGENT_LAB_KEY` remains
 * the prose agent's key and the fallback for any slug without a dedicated
 * entry).
 *
 * Every helper returns null on service/upstream/parse failure so the existing
 * deterministic product fallbacks remain intact. There is deliberately no
 * direct-provider or environment-key fallback in this module.
 */
import {
  agentLabEnabled,
  completeAgentLab,
} from "./agent-lab"

/** Prose Q&A (brief/knowledge advisory) — thinking ENABLED in Agent Lab for
 *  reasoning-quality answers. Exported so callers whose payload is narrative
 *  prose (not floorplan/interior action JSON) can opt `chatJSON` back into
 *  this slug via `{ slug: PROSE_SLUG }` instead of silently inheriting
 *  `ACTIONS_SLUG`. */
export const PROSE_SLUG = "baruma-assistant"
/** Structured JSON action generation (floorplan/interior edits) — thinking
 *  DISABLED in Agent Lab; the hidden reasoning tokens a "thinking" model
 *  spends only compete with the JSON output budget and add latency, without
 *  helping a task that's really "follow the rules and emit valid actions". */
const ACTIONS_SLUG = "baruma-floorplan-actions"
const SYSTEM_USER_ID = "baruma-server"

export interface ChatMsg {
  role: "system" | "user" | "assistant"
  content: string
}

export function llmEnabled(): boolean {
  return agentLabEnabled()
}

/**
 * Replaces unescaped control characters (like literal newlines) inside JSON string values.
 * LLMs often generate valid-looking JSON that contains literal newlines inside string values
 * (e.g. "reply": "Line 1\nLine2"), which causes JSON.parse to throw a SyntaxError.
 */
export function sanitizeJsonString(str: string): string {
  let isString = false
  let isEscaped = false
  let res = ""
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if (isString) {
      if (char === "\\" && !isEscaped) {
        isEscaped = true
        res += char
      } else if (char === '"' && !isEscaped) {
        isString = false
        res += char
      } else if (char === "\n") {
        res += "\\n"
        isEscaped = false
      } else if (char === "\r") {
        res += "\\r"
        isEscaped = false
      } else if (char === "\t") {
        res += "\\t"
        isEscaped = false
      } else {
        res += char
        isEscaped = false
      }
    } else {
      if (char === '"') {
        isString = true
      }
      res += char
    }
  }
  return res
}

import { repairAndExtractJson } from "./json-repair"

export async function chatJSON<T = unknown>(
  messages: ChatMsg[],
  opts: { slug?: string } = {},
): Promise<T | null> {
  const result = await completeAgentLab(opts.slug ?? ACTIONS_SLUG, {
    userId: SYSTEM_USER_ID,
    messages,
    responseFormat: "json",
  })
  if (!result?.content?.trim()) return null
  let raw = result.content.trim()
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  }
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start >= 0 && end > start) {
    raw = raw.slice(start, end + 1)
  }
  raw = sanitizeJsonString(raw)
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    console.error("[agent-lab] JSON completion parse error:", e instanceof Error ? e.message : String(e), "Raw:", raw)
    const repaired = repairAndExtractJson(raw)
    if (repaired) return repaired as T
    if (result.content.trim()) {
      return { reply: result.content.trim(), actions: [] } as T
    }
    return null
  }
}

export async function chatText(
  messages: ChatMsg[],
): Promise<string | null> {
  const result = await completeAgentLab(PROSE_SLUG, {
    userId: SYSTEM_USER_ID,
    messages,
    responseFormat: "text",
  })
  return result?.content?.trim() || null
}
