import { requireAdmin } from "@/lib/server/auth-server"
import { handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"

const DEFAULT_BASE_URL = "https://freetokenfaucet.com/v1"

// SSRF guard (audit CSO 2026-08-09 #3): host baseUrl yang boleh dihubungi
// diagnostik ini. Hanya provider faucet resmi + domain resmi DeepSeek.
// Mencegah endpoint dipakai sebagai proxy SSRF ke host internal/arbitrer.
const ALLOWED_HOST_SUFFIXES = [
  "freetokenfaucet.com",
  "deepseek.com",
]

function isAllowedBaseUrl(value: string): boolean {
  try {
    const u = new URL(value)
    if (u.protocol !== "https:") return false
    const host = u.hostname.toLowerCase()
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}
const DEFAULT_MODEL = "deepseek-v4-pro"
const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 8_000

type ChatRole = "system" | "user" | "assistant"

interface IncomingMessage {
  role?: unknown
  content?: unknown
}

interface ProviderChoice {
  finish_reason?: string
  message?: {
    content?: string
  }
}

interface ProviderResponse {
  id?: string
  model?: string
  choices?: ProviderChoice[]
  usage?: unknown
  error?: unknown
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith("/chat/completions")) return normalized
  return `${normalized}/chat/completions`
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return "invalid-url"
  }
}

function redactSecrets(value: string, apiKey?: string) {
  let redacted = value
  if (apiKey) redacted = redacted.split(apiKey).join("[redacted-api-key]")
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key["':\s=]+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
}

function preview(value: unknown, apiKey?: string) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? ""
  return redactSecrets(text, apiKey).slice(0, 1_200)
}

function cleanMessages(messages: IncomingMessage[]) {
  return messages
    .slice(-MAX_MESSAGES)
    .map((message) => {
      const role = message.role === "system" || message.role === "assistant" ? message.role : "user"
      const content =
        typeof message.content === "string"
          ? message.content.slice(0, MAX_CONTENT_LENGTH)
          : ""
      return { role: role as ChatRole, content }
    })
    .filter((message) => message.content.trim().length > 0)
}

function riskSignals(baseUrl: string, httpStatus?: number, hasChoices?: boolean, hasUsage?: boolean) {
  const host = safeUrlHost(baseUrl).toLowerCase()
  const signals: string[] = []

  if (!host.includes("deepseek.com")) {
    signals.push("Domain bukan domain resmi DeepSeek; perlakukan sebagai pihak ketiga.")
  }
  if (httpStatus && httpStatus >= 400) {
    signals.push(`Provider membalas HTTP ${httpStatus}, jadi kredensial, model, atau endpoint perlu dicurigai.`)
  }
  if (httpStatus && httpStatus < 400 && !hasChoices) {
    signals.push("Respons sukses tetapi formatnya tidak mirip OpenAI chat completions.")
  }
  if (httpStatus && httpStatus < 400 && !hasUsage) {
    signals.push("Respons tidak menyertakan usage; ini bukan bukti scam, tetapi menyulitkan audit biaya/token.")
  }
  if (signals.length === 0) {
    signals.push("Respons terlihat kompatibel, tetapi satu panggilan API tidak bisa membuktikan platform aman.")
  }

  return signals
}

export async function POST(request: Request) {
  // Endpoint diagnostik ini melakukan fetch ke URL dari input + memakai key
  // dari env → wajib admin (audit #3) + rate-limit.
  try {
    const limited = rateLimitGuard(request, {
      scope: "faucet-chat",
      limit: 20,
      windowMs: 60_000,
    })
    if (limited) return limited
    await requireAdmin(request)
  } catch (e) {
    return handleError(e)
  }

  let body: {
    apiKey?: unknown
    baseUrl?: unknown
    model?: unknown
    messages?: unknown
  }

  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: "Body harus berupa JSON." }, 400)
  }

  const requestApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""
  const callerSuppliedBaseUrl =
    typeof body.baseUrl === "string" && body.baseUrl.trim().length > 0
  const baseUrl = callerSuppliedBaseUrl
    ? (body.baseUrl as string).trim()
    : process.env.FAUCET_TEST_BASE_URL || DEFAULT_BASE_URL

  // SSRF: hanya host allowlist yang boleh dihubungi.
  if (!isAllowedBaseUrl(baseUrl)) {
    return json(
      {
        ok: false,
        error:
          "baseUrl tidak diizinkan. Hanya provider faucet resmi / domain DeepSeek.",
      },
      400,
    )
  }

  // This diagnostic intentionally tests a caller-supplied faucet credential.
  // It must never inherit Baruma's application LLM configuration — DAN key env
  // TIDAK PERNAH dikirim ke baseUrl yang dipasok pemanggil (audit #3:
  // eksfiltrasi key). Key env hanya dipakai untuk baseUrl default server.
  const envApiKey = callerSuppliedBaseUrl ? "" : process.env.FAUCET_TEST_API_KEY || ""
  const apiKey = requestApiKey || envApiKey
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : process.env.FAUCET_TEST_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    return json(
      {
        ok: false,
        error:
          "API key belum tersedia. Isi field key sementara atau set FAUCET_TEST_API_KEY di .env.local.",
      },
      400
    )
  }

  const messages = Array.isArray(body.messages) ? cleanMessages(body.messages as IncomingMessage[]) : []
  if (messages.length === 0) {
    return json({ ok: false, error: "Kirim minimal satu pesan." }, 400)
  }

  const startedAt = Date.now()
  const url = chatCompletionsUrl(baseUrl)
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Jawab singkat, jelas, dan jangan mengarang klaim keamanan. Jika diminta menilai platform, jelaskan bahwa bukti API hanya sebagian dari audit.",
      },
      ...messages,
    ],
    temperature: 0.2,
    max_tokens: 700,
    stream: false,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Gagal menghubungi provider.",
        diagnostics: {
          baseUrl: normalizeBaseUrl(baseUrl),
          host: safeUrlHost(baseUrl),
          model,
          latencyMs,
          apiKeySource: requestApiKey ? "temporary-form" : "server-env",
          riskSignals: riskSignals(baseUrl),
        },
      },
      502
    )
  }

  const latencyMs = Date.now() - startedAt
  const contentType = response.headers.get("content-type") ?? ""
  const rawText = await response.text()
  let data: ProviderResponse | null = null

  try {
    data = JSON.parse(rawText) as ProviderResponse
  } catch {
    data = null
  }

  const choice = data?.choices?.[0]
  const content = choice?.message?.content?.trim() ?? ""
  const hasChoices = Array.isArray(data?.choices)
  const hasUsage = data?.usage !== undefined
  const diagnostics = {
    baseUrl: normalizeBaseUrl(baseUrl),
    host: safeUrlHost(baseUrl),
    model,
    providerModel: data?.model,
    responseId: data?.id,
    httpStatus: response.status,
    latencyMs,
    contentType,
    finishReason: choice?.finish_reason,
    usage: data?.usage,
    apiKeySource: requestApiKey ? "temporary-form" : "server-env",
    riskSignals: riskSignals(baseUrl, response.status, hasChoices, hasUsage),
    rawPreview: response.ok && content ? undefined : preview(data ?? rawText, apiKey),
  }

  if (!response.ok) {
    return json(
      {
        ok: false,
        error: "Provider mengembalikan error.",
        diagnostics,
      },
      502
    )
  }

  if (!content) {
    return json(
      {
        ok: false,
        error: "Provider sukses HTTP, tetapi tidak ada isi jawaban pada choices[0].message.content.",
        diagnostics,
      },
      502
    )
  }

  return json({
    ok: true,
    message: content,
    diagnostics,
  })
}
