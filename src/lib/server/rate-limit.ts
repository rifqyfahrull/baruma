/**
 * Rate limiter fixed-window IN-MEMORY (audit CSO 2026-08-09, finding #6).
 *
 * Best-effort & PER-INSTANCE: cukup untuk memperlambat brute-force login/
 * register dan penyalahgunaan endpoint publik pada deployment single-node
 * (droplet Baruma). BUKAN pengganti WAF/Redis pada skala multi-instance —
 * di-dokumentasikan agar jujur. Tanpa dependensi eksternal.
 *
 * PM2 CLUSTER CAVEAT (2026-08-15): produksi menjalankan `pm2 start -i 2`
 * (2 proses Node), dan tiap proses punya `store` Map miliknya sendiri — tidak
 * ada koordinasi antar-instance. Efeknya, limit efektif yang dilihat seorang
 * penyerang adalah kira-kira N× angka yang dikonfigurasi di route (N = jumlah
 * instance pm2, saat ini 2), tergantung load balancer mendistribusikan
 * request ke worker mana. Ini keputusan sadar, bukan bug: semua angka limit
 * di route (login, register, editor-assistant, agent, mcp/tools) dipilih
 * dengan asumsi N=2 sudah termasuk dalam perhitungan "cukup longgar untuk
 * pengguna sah, cukup ketat untuk brute-force". Bila N bertambah tanpa
 * meninjau ulang angka-angka ini, atau bila dibutuhkan pembatasan yang benar
 * lintas-instance, pindah ke store bersama (Redis) atau tegakkan di layer
 * depan (nginx `limit_req`, Cloudflare rate rules).
 */

type Bucket = { count: number; resetAt: number }

const store = new Map<string, Bucket>()
let lastSweep = 0

/**
 * TEST-ONLY: kosongkan store & reset sweep timer. Modul ini singleton per
 * proses; tanpa ini, state bocor antar `it()` yang memakai scope/key sama
 * dan hasil tes jadi bergantung urutan eksekusi.
 */
export function __resetRateLimitStore(): void {
  store.clear()
  lastSweep = 0
}

/** Bersihkan bucket kedaluwarsa sesekali agar Map tidak tumbuh tanpa batas. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, b] of store) {
    if (b.resetAt <= now) store.delete(key)
  }
}

export type RateLimitResult = {
  ok: boolean
  /** Sisa jatah dalam window ini. */
  remaining: number
  /** Detik sampai window reset (untuk header Retry-After). */
  retryAfterSec: number
}

/**
 * Konsumsi satu unit kuota untuk `key`. `limit` percobaan per `windowMs`.
 * Dipanggil sekali per request; `ok:false` → tolak dengan 429.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweep(now)
  const existing = store.get(key)
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) }
  }
  existing.count += 1
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSec }
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSec }
}

/**
 * IP klien dari header proxy Nginx di depan Baruma.
 *
 * `x-real-ip` diutamakan: Nginx men-set header ini sendiri dari
 * `$remote_addr` (soket TCP koneksi masuk), yang TIDAK BISA dipalsukan
 * klien — jadi ini sinyal paling tepercaya kalau ada.
 *
 * Fallback ke `x-forwarded-for` mengambil entri PALING TERAKHIR, bukan
 * pertama. Nginx kita memakai `$proxy_add_x_forwarded_for`, yang cuma
 * MENAMBAHKAN alamat koneksi masuk ke daftar apa pun yang sudah dikirim
 * klien — artinya entri pertama (indeks 0) sepenuhnya dikendalikan oleh
 * klien (kirim header `X-Forwarded-For: 1.2.3.4` apa saja, itu yang jadi
 * elemen pertama) dan sama sekali tidak bisa dipercaya untuk rate-limiting.
 * Entri terakhir adalah hop tepercaya terdekat (yang ditambahkan Nginx
 * sendiri), sehingga itulah satu-satunya elemen XFF yang aman dipakai bila
 * `x-real-ip` absen. JANGAN diubah balik ke elemen pertama — itu justru
 * membuka jalan bypass rate limit lewat header XFF palsu.
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const xff = request.headers.get("x-forwarded-for")
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]!
  }
  return "unknown"
}

/**
 * Guard rate-limit siap-pakai untuk route handler. Mengembalikan Response 429
 * (dengan Retry-After) bila kuota habis, atau null bila boleh lanjut.
 */
export function rateLimitGuard(
  request: Request,
  opts: { scope: string; limit: number; windowMs: number; keyExtra?: string },
): Response | null {
  const key = `${opts.scope}:${clientIp(request)}${opts.keyExtra ? `:${opts.keyExtra}` : ""}`
  const res = rateLimit(key, opts.limit, opts.windowMs)
  if (res.ok) return null
  return Response.json(
    { error: "Terlalu banyak permintaan. Coba lagi nanti." },
    { status: 429, headers: { "Retry-After": String(res.retryAfterSec) } },
  )
}
