/**
 * Harga kredit AI Render (Fase 7 — docs/plan-integrasi-ai-renderer-2026-08.md).
 * Nilai statis murni — TIDAK ada import server-only di sini — sehingga
 * modul ini aman diimpor dari komponen client (tombol render perlu
 * menampilkan biaya kredit sebelum request dikirim).
 */

/** Biaya kredit per mode render. Paket Foto = 4 sudut sekaligus (mode presisi). */
export const RENDER_CREDIT_COST = {
  cepat: 1,
  presisi: 2,
  paketFoto: 6,
} as const

export type RenderCreditMode = keyof typeof RENDER_CREDIT_COST

/** Ambil biaya kredit untuk satu mode render. */
export function renderCreditCost(mode: RenderCreditMode): number {
  return RENDER_CREDIT_COST[mode]
}
