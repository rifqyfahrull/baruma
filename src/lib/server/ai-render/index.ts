/**
 * Registry provider AI render — struktur meniru
 * `src/lib/billing/providers/index.ts`. Route handler memanggil
 * `getRenderProvider(mode)` tanpa perlu tahu provider konkret mana yang
 * aktif; `AI_RENDER_PROVIDER=mock` men-override semua mode ke provider mock
 * (dev/E2E), sesuai idiom env repo: baca `process.env` langsung + helper
 * boolean, tanpa lib validasi.
 */
import { falProviderEnabled, falRenderProvider } from "./fal"
import { geminiProviderEnabled, geminiRenderProvider } from "./gemini"
import { mockRenderProvider } from "./mock"
import type { RenderProvider } from "./types"

export type { RenderProvider, RenderProviderInput, SubmitResult } from "./types"
export { RENDER_PRESETS, compilePrompt, projectSeed } from "./prompt"
export type { RenderPreset, RenderSceneMeta } from "./prompt"
export { RENDER_CREDIT_COST, renderCreditCost } from "./pricing"
export type { RenderCreditMode } from "./pricing"

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * True bila `AI_RENDER_PROVIDER=mock` override aktif. Diekspor (bukan
 * private) karena route POST .../renders butuh sinyal ini untuk memilih
 * jalur eksekusi: mock resolve instan → proses inline (test/E2E butuh
 * determinisme, respons langsung membawa hasil akhir); gemini asli (mode
 * cepat) 2–5 detik → wajib `after()` (pola alternatives/generate) supaya
 * request HTTP tak menggantung.
 */
export function usesMockOverride(): boolean {
  return getEnv("AI_RENDER_PROVIDER") === "mock"
}

/**
 * True bila fitur AI render bisa dipakai sama sekali — baik lewat provider
 * mock (dev/E2E) maupun karena minimal satu API key provider asli sudah
 * dikonfigurasi. Route pembuatan job memakai ini untuk balas 503 dini bila
 * belum dikonfigurasi (pola `upload-url/route.ts`).
 */
export function aiRenderEnabled(): boolean {
  if (usesMockOverride()) return true
  return geminiProviderEnabled() || falProviderEnabled()
}

/**
 * Resolve provider untuk satu mode render. `AI_RENDER_PROVIDER=mock`
 * meng-override kedua mode (dev/E2E). Mengembalikan null bila provider yang
 * dibutuhkan mode tersebut belum dikonfigurasi (bukan throw) — caller wajib
 * menangani null sebagai "fitur belum siap" (503/refund).
 */
export function getRenderProvider(mode: "cepat" | "presisi"): RenderProvider | null {
  if (usesMockOverride()) return mockRenderProvider

  if (mode === "cepat") {
    return geminiProviderEnabled() ? geminiRenderProvider : null
  }
  return falProviderEnabled() ? falRenderProvider : null
}
