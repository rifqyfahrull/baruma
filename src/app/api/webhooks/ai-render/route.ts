import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

import { getRenderJobById } from "@/lib/server/repo/renders"
import { finalizeRenderJob, failRenderJob } from "@/lib/server/ai-render/finalize"

/**
 * Webhook fal.ai (Fase 5c) — dipanggil provider saat job async mode presisi
 * (FLUX Depth) selesai. Struktur handler SENGAJA meniru
 * `webhooks/payment/route.ts` apa adanya: satu-satunya 401 adalah gagal
 * otentikasi; sisanya ditelan ke 200 (hindari retry storm dari provider).
 *
 * OTENTIKASI: token rahasia di query string (`?token=...`), dibandingkan
 * `timingSafeEqual` dgn `AI_RENDER_WEBHOOK_SECRET`. Env kosong -> tolak
 * SEMUA request (fail-closed, bukan fail-open).
 *
 * CATATAN SIGNATURE NATIF FAL (riset Agustus 2026): fal.ai juga mendukung
 * webhook bertanda tangan ED25519 (header `X-Fal-Webhook-*` + kunci publik
 * dari JWKS `https://rest.alpha.fal.ai/.well-known/jwks.json`, di-cache).
 * TIDAK diimplementasikan di sini — verifikasinya butuh fetch JWKS + decode
 * ED25519 raw-key dari format JWK yang belum dikonfirmasi lewat dokumentasi
 * resmi dalam sesi ini (bukan sekadar HMAC seperti Stripe/provider lain di
 * repo). Diputuskan cukup mengandalkan token rahasia di atas utk v1 — deteksi
 * job yang salah/hilang tetap ditutup oleh verifikasi `request_id` di bawah
 * DAN rekonsiliasi lazy di GET detail (jaring pengaman kedua bila webhook tak
 * pernah sampai/ditolak). Follow-up: tambahkan verifikasi JWKS ED25519 sesuai
 * dok resmi fal.ai sbg lapis kedua (defense-in-depth), bukan pengganti token.
 *
 * PAYLOAD (bentuk fal queue webhook, dikonfirmasi via dok publik + asumsi
 * yang sama dipakai fal.ts's checkStatus): `{ request_id, status: "OK"|
 * "ERROR", payload: { images: [{ url }] } }`.
 *
 * IDEMPOTENSI: `finalizeRenderJob`/`failRenderJob` memakai
 * `updateRenderJob(..., { fromStatuses: [...] })` — replay webhook (atau
 * balapan dgn rekonsiliasi lazy GET yang menang duluan) dapat 0 baris ->
 * no-op, bukan overwrite ganda / refund dobel.
 */

interface FalWebhookPayload {
  request_id?: string
  status?: string // "OK" | "ERROR" (fal queue webhook)
  payload?: { images?: Array<{ url?: string }> }
  error?: string
}

function tokenValid(request: Request): boolean {
  const secret = process.env.AI_RENDER_WEBHOOK_SECRET
  if (!secret) return false // env belum diset -> tolak semua (fail-closed)

  const url = new URL(request.url)
  const token = url.searchParams.get("token") ?? ""
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  // Panjang beda -> tak bisa timingSafeEqual (butuh panjang sama) & sudah
  // pasti tak cocok.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<Response> {
  let jobId: string | undefined
  try {
    if (!tokenValid(request)) {
      console.error("[webhook/ai-render] token tidak valid/hilang")
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const url = new URL(request.url)
    jobId = url.searchParams.get("jobId") ?? undefined
    if (!jobId) {
      // Token benar tapi tak ada referensi job -> tak ada yang bisa
      // dikerjakan; telan ke 200 (bukan error otentikasi).
      return NextResponse.json({ ok: true })
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ ok: true })
    }
    const payload = raw as FalWebhookPayload

    // getRenderJobById: unscoped (webhook tak punya sesi user) — otorisasi
    // SUDAH ditegakkan token di atas; lihat komentar di renders.ts.
    const job = await getRenderJobById(jobId)
    if (!job) {
      // jobId asing/sudah dihapus -> no-op, tak ada yang direfund/difinalize.
      return NextResponse.json({ ok: true })
    }

    // Verifikasi payload.request_id cocok dgn provider_request_id job ini —
    // mencegah webhook utk job A "menyelesaikan" job B seandainya token bocor
    // atau jobId ditebak (defense-in-depth di atas gate token).
    if (!job.providerRequestId || payload.request_id !== job.providerRequestId) {
      console.warn(
        `[webhook/ai-render] request_id tak cocok utk job ${jobId} (payload=${payload.request_id ?? "?"}, job=${job.providerRequestId ?? "?"})`
      )
      return NextResponse.json({ ok: true })
    }

    if (payload.status === "OK") {
      const imageUrl = payload.payload?.images?.[0]?.url
      if (!imageUrl) {
        console.warn(`[webhook/ai-render] status OK tanpa images[0].url utk job ${jobId}`)
        await failRenderJob(job, "Provider melaporkan sukses tanpa hasil gambar")
        return NextResponse.json({ ok: true })
      }
      await finalizeRenderJob(job, { imageUrl })
    } else {
      await failRenderJob(job, payload.error ?? "Render gagal di provider")
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`[webhook/ai-render] handler error (jobId=${jobId ?? "?"}):`, e)
    return NextResponse.json({ ok: true }) // Cegah retry storm dari fal.
  }
}
