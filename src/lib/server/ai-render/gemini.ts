/**
 * Provider Mode Cepat — Google Gemini image generation ("Nano Banana 2").
 * Sinkron (2–5 detik khas), jadi `submit()` mengembalikan `{kind:"done", ...}`
 * langsung, bukan async job seperti fal.
 *
 * Kontrak mengikuti `openai-client.ts`: TIDAK PERNAH throw — semua kegagalan
 * (network, non-200, tidak ada part gambar di respons) di-log via
 * console.warn lalu kembalikan null, supaya caller selalu bisa fallback ke
 * refund kredit deterministik.
 *
 * Request/response shape REST generateContent dikonfirmasi via dokumentasi
 * publik Google (Agustus 2026) — lihat laporan investigasi di deskripsi PR/
 * commit terkait fase ini. Ringkas:
 * - Endpoint: POST /v1beta/models/{model}:generateContent, header
 *   `x-goog-api-key`.
 * - Body `contents[].parts[]` berisi bagian teks + `inline_data`
 *   ({mime_type, data}) untuk gambar referensi (snake_case di request body).
 * - `generationConfig.responseModalities: ["TEXT","IMAGE"]` supaya model
 *   mengembalikan gambar, bukan hanya deskripsi teks.
 * - Respons: `candidates[0].content.parts[]`, gambar ada di properti
 *   `inlineData.data` (camelCase pada respons JSON) — kode di bawah membaca
 *   kedua varian casing secara defensif.
 */
import dns from "node:dns"
import type { RenderProvider, RenderProviderInput, SubmitResult } from "./types"

if (typeof dns?.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first")
}

/** Model id di satu tempat — gampang diganti begitu Google merilis versi baru. */
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image"

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const TIMEOUT_MS = 110_000

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function geminiProviderEnabled(): boolean {
  return !!getEnv("GEMINI_API_KEY")
}

/** Bentuk minimal respons generateContent yang relevan buat kita saja. */
interface GenerateContentPart {
  text?: string
  inlineData?: { mimeType?: string; data?: string }
  inline_data?: { mime_type?: string; data?: string }
}
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: GenerateContentPart[] }
  }>
}

function normalizeImageMimeType(rawContentType: string | null): string {
  if (!rawContentType) return "image/png"
  const clean = rawContentType.split(";")[0].trim().toLowerCase()
  if (clean === "image/jpeg" || clean === "image/jpg") return "image/jpeg"
  if (clean === "image/webp") return "image/webp"
  if (clean === "image/heic") return "image/heic"
  if (clean === "image/heif") return "image/heif"
  if (clean === "image/png") return "image/png"
  return "image/png"
}

/** Unduh beautyUrl (signed GET URL) server-side, kembalikan base64 + mime. */
async function fetchImageAsBase64(
  url: string,
  signal: AbortSignal
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) {
      console.warn(`[ai-render/gemini] gagal unduh beauty image: HTTP ${res.status}`)
      return null
    }
    const contentType = normalizeImageMimeType(res.headers.get("content-type"))
    const buf = await res.arrayBuffer()
    return { data: Buffer.from(buf).toString("base64"), mimeType: contentType }
  } catch (e) {
    console.warn(
      "[ai-render/gemini] gagal unduh beauty image:",
      e instanceof Error ? e.message : String(e)
    )
    return null
  }
}

/** Ambil part gambar pertama dari respons, toleran terhadap casing snake/camel. */
function extractImagePart(
  json: GenerateContentResponse
): { data: string; mimeType: string } | null {
  const parts = json.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data
    if (!inline) continue
    const data = "data" in inline ? inline.data : undefined
    const mimeType =
      "mimeType" in inline ? inline.mimeType : (inline as { mime_type?: string }).mime_type
    if (data) return { data, mimeType: mimeType ?? "image/png" }
  }
  return null
}

async function submit(input: RenderProviderInput): Promise<SubmitResult> {
  const apiKey = getEnv("GEMINI_API_KEY")
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const beauty = await fetchImageAsBase64(input.beautyUrl, controller.signal)
    if (!beauty) return null

    const res = await fetch(
      `${GEMINI_ENDPOINT_BASE}/${GEMINI_IMAGE_MODEL}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: input.prompt },
                {
                  inline_data: {
                    mime_type: beauty.mimeType,
                    data: beauty.data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      }
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.warn(`[ai-render/gemini] generateContent HTTP ${res.status}: ${errText}`)
      return null
    }

    const json = (await res.json()) as GenerateContentResponse
    const image = extractImagePart(json)
    if (!image) {
      console.warn("[ai-render/gemini] respons tidak mengandung bagian gambar")
      return null
    }

    return { kind: "done", imageBytes: Buffer.from(image.data, "base64") }
  } catch (e) {
    console.warn(
      "[ai-render/gemini] submit gagal:",
      e instanceof Error ? e.message : String(e)
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const geminiRenderProvider: RenderProvider = { submit }
