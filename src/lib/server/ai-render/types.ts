/**
 * Kontrak abstraksi provider AI render (Fase 4). Struktur meniru
 * `src/lib/billing/providers/types.ts` — satu interface provider-agnostic
 * yang dipakai route handler, implementasi konkret (gemini/fal/mock) tidak
 * perlu diketahui pemanggil.
 *
 * Dua bentuk hasil submit karena karakter provider beda: fal masuk antrean
 * (async, butuh polling/webhook), gemini sinkron (2–5 detik). `null` berarti
 * gagal — mengikuti kontrak "tidak pernah throw" dari `openai-client.ts` agar
 * caller (route) selalu bisa fallback ke refund kredit deterministik.
 */

export type SubmitResult =
  | { kind: "async"; providerRequestId: string }
  | { kind: "done"; imageBytes: Uint8Array }
  | null

export interface RenderProviderInput {
  /** Prompt hasil compilePrompt() — deterministik, bukan input bebas user. */
  prompt: string
  /** Seed stabil per proyek (projectSeed()) agar hasil konsisten antar-render. */
  seed: number
  /** Signed GET URL atas beauty pass (PNG) di storage privat. */
  beautyUrl: string
  /** Signed GET URL atas depth pass — dipakai mode presisi (FLUX Depth). */
  depthUrl?: string
  /** URL webhook fal untuk notifikasi selesai — hanya relevan provider async. */
  webhookUrl?: string
}

export interface RenderProvider {
  submit(input: RenderProviderInput): Promise<SubmitResult>
  /** Hanya diimplementasikan provider async (fal) — untuk rekonsiliasi lazy. */
  checkStatus?(
    providerRequestId: string
  ): Promise<"processing" | { imageUrl: string } | "failed" | null>
}
