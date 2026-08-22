/**
 * Provider mock — dipakai dev lokal & E2E (`AI_RENDER_PROVIDER=mock`) supaya
 * alur render bisa diuji ujung-ke-ujung tanpa memanggil API eksternal
 * berbayar. Selalu sukses secara sinkron dengan PNG placeholder 1×1 valid
 * (tidak ada dependensi native untuk generate gambar — cukup byte statis).
 */
import type { RenderProvider, SubmitResult } from "./types"

/** PNG 1×1 transparan valid (delapan byte signature \x89PNG\r\n\x1a\n + chunk minimal). */
const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

async function submit(): Promise<SubmitResult> {
  return { kind: "done", imageBytes: Buffer.from(MOCK_PNG_BASE64, "base64") }
}

export const mockRenderProvider: RenderProvider = { submit }
