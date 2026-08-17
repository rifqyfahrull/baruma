/**
 * Direct OpenAI-compatible LLM facade (branch `emergent`) — replaces the
 * Agent Lab HTTP client. Baruma now owns model/provider selection (see
 * ./openai-client.ts's OPENAI_* env vars) and every system prompt; nothing
 * is resolved remotely anymore.
 *
 * Two model "profiles", selectable per call:
 *  - PROSE_SLUG: narrative prose (brief/knowledge advisory, alternatives
 *    enrichment, `askAssistant`'s Q&A) — higher temperature, and can point
 *    at a stronger/reasoning-capable model via OPENAI_MODEL_PROSE.
 *  - ACTIONS_SLUG (chatJSON's default): structured JSON action generation
 *    (floorplan/interior edits) — low temperature; a "thinking" model's
 *    hidden reasoning tokens only compete with the JSON output budget here
 *    without helping a task that's really "follow the rules, emit valid
 *    actions".
 *
 * Every helper returns null on service/upstream/parse failure so the
 * existing deterministic product fallbacks remain intact.
 */
import { completeChat, llmProviderEnabled, type OpenAIChatMessage } from "./openai-client"
import { repairAndExtractJson } from "./json-repair"

/** Exported so callers whose payload is narrative prose (not floorplan/
 *  interior action JSON) can opt `chatJSON` back into this profile via
 *  `{ slug: PROSE_SLUG }` instead of silently inheriting ACTIONS_SLUG. */
export const PROSE_SLUG = "baruma-assistant"
const ACTIONS_SLUG = "baruma-floorplan-actions"
const SYSTEM_USER_ID = "baruma-server"
const DEFAULT_MODEL = "gpt-4o-mini"

function modelForSlug(slug: string): string {
  if (slug === PROSE_SLUG) {
    return process.env.OPENAI_MODEL_PROSE || process.env.OPENAI_MODEL || DEFAULT_MODEL
  }
  return process.env.OPENAI_MODEL || DEFAULT_MODEL
}

export interface ChatMsg {
  role: "system" | "user" | "assistant"
  content: string
}

export function llmEnabled(): boolean {
  return llmProviderEnabled()
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

export async function chatJSON<T = unknown>(
  messages: ChatMsg[],
  opts: { slug?: string } = {},
): Promise<T | null> {
  const slug = opts.slug ?? ACTIONS_SLUG
  const result = await completeChat({
    messages: messages as OpenAIChatMessage[],
    model: modelForSlug(slug),
    responseFormat: "json",
    temperature: slug === PROSE_SLUG ? 0.7 : 0.2,
    user: SYSTEM_USER_ID,
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
    console.error("[llm] JSON completion parse error:", e instanceof Error ? e.message : String(e), "Raw:", raw)
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
  const result = await completeChat({
    messages: messages as OpenAIChatMessage[],
    model: modelForSlug(PROSE_SLUG),
    responseFormat: "text",
    temperature: 0.7,
    user: SYSTEM_USER_ID,
  })
  return result?.content?.trim() || null
}

/** Context blocks (title + grounding content) fed to `askAssistant` — brief
 *  summary, chat history, computed standards audit, curated design
 *  knowledge, real asset suggestions, existing-layout note. Pure data, no
 *  formatting decisions, so brief-assistant-context.ts stays testable
 *  without an LLM. */
export interface AssistantContextBlock {
  title: string
  content: string
}

const MAX_BLOCKS = 8
const MAX_TOTAL_CHARS = 24000

/** Defensive trim so an oversized context never blows the model's input
 *  budget: cap block count, then cap cumulative title+content chars
 *  (dropping whole trailing blocks). */
function trimBlocks(blocks: AssistantContextBlock[]): AssistantContextBlock[] {
  const capped = blocks.slice(0, MAX_BLOCKS)
  const out: AssistantContextBlock[] = []
  let total = 0
  for (const b of capped) {
    const size = b.title.length + b.content.length
    if (total + size > MAX_TOTAL_CHARS) break
    out.push(b)
    total += size
  }
  return out
}

export function stripThinkingTags(text: string): string {
  if (!text) return ""
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim()
}

/** A model occasionally answers with a raw JSON object instead of prose
 *  (usually when the prompt itself contains JSON-shaped context) — render
 *  it as readable markdown instead of dumping `{...}` at the user. */
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

const ASSISTANT_SYSTEM_PROMPT = [
  "Kamu adalah asisten AI Baruma, aplikasi desain rumah untuk pengguna",
  "menengah non-arsitek. Jawab pertanyaan seputar brief desain (gaya, lahan,",
  "program ruang, prioritas, risiko/standar bangunan) secara ringkas, praktis,",
  "dan dalam Bahasa Indonesia.",
  "",
  "Dasarkan jawabanmu pada blok konteks yang diberikan (ringkasan brief,",
  "riwayat obrolan, catatan standar/audit, saran aset, catatan denah) — jangan",
  "mengarang angka (KDB/KLB, luas, biaya) di luar yang diberikan.",
  "Jika pengguna meminta tindakan mengubah denah/interior, jawab hanya dengan",
  "saran naratif; jangan mengeluarkan JSON tindakan (jalur lain yang menangani",
  "itu).",
].join("\n")

/**
 * Single-shot Q&A: system prompt + context blocks + the user's question.
 * Replaces `askAgentLab` — the "mode: answer/clarify/refuse" routing Agent
 * Lab used to do server-side is gone; the model answers directly and the
 * only remaining post-processing is unwrapping an accidental raw-JSON reply
 * into markdown (see `formatJsonToMarkdown`).
 */
export async function askAssistant(args: {
  userId: string
  text: string
  contextBlocks?: AssistantContextBlock[]
}): Promise<string | null> {
  const blocks = trimBlocks(args.contextBlocks ?? [])
  const contextText = blocks.map((b) => `### ${b.title}\n${b.content}`).join("\n\n")

  const messages: ChatMsg[] = [
    { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
    ...(contextText ? [{ role: "system" as const, content: contextText }] : []),
    { role: "user", content: args.text },
  ]

  const result = await completeChat({
    messages: messages as OpenAIChatMessage[],
    model: modelForSlug(PROSE_SLUG),
    responseFormat: "text",
    temperature: 0.7,
    user: args.userId,
  })
  if (!result?.content?.trim()) return null

  let answerText = stripThinkingTags(result.content.trim())
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
  return answerText.trim() || null
}
