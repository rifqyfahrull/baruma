/**
 * Sanitasi "catatan gaya" (style notes) — teks bebas pendek yang user tulis
 * di dialog Render AI (manual atau via chat Asisten, spec 2026-08-29 §4
 * Server). Teks ini TIDAK PERNAH jadi prompt bebas — hanya SATU klausa yang
 * dikomposisikan oleh server di antara fakta scene deterministik dan geometry
 * guard (lihat `prompt.ts`). Fungsi ini murni & deterministik: input sama →
 * output sama, tanpa efek samping.
 *
 * Aturan (urutan tetap, tiap langkah independen dari yang lain):
 * 1. Buang karakter kontrol (U+0000-U+001F, U+007F) — cegah injeksi
 *    ANSI/escape aneh ke prompt teks provider gambar.
 * 2. Buang URL (`https?://…` atau `www.…`) — cegah exfiltration/link asing
 *    ikut terkirim ke provider eksternal via teks prompt.
 * 3. Kutip ganda (`"`) → kutip tunggal (`'`) — klausa hasil dibungkus kutip
 *    ganda di prompt.ts; kutip ganda dari user bisa memecah kutipan itu.
 * 4. Collapse runtun whitespace jadi satu spasi, lalu trim.
 * 5. Potong ke maksimum 240 karakter (batas field, sama dgn validasi Zod di
 *    route — slice biasa, TIDAK perlu multibyte-safe per brief).
 *
 * Hasil kosong (termasuk whitespace-only, atau isi yang seluruhnya URL/
 * kontrol char) → `undefined`, supaya caller (prompt.ts) bisa treat sebagai
 * "tidak ada catatan gaya" tanpa cek string kosong terpisah.
 */
export function sanitizeStyleNotes(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined

  let s = raw
  // 1. Karakter kontrol.
  s = s.replace(/[\x00-\x1F\x7F]/g, "")
  // 2. URL — skema eksplisit, lalu bentuk www. tanpa skema.
  s = s.replace(/https?:\/\/\S+/gi, "")
  // Tanpa \b: "contactwww.evil.com" harus ikut terbuang (word-boundary gagal
  // bila www. menempel huruf sebelumnya). False positive teks polos yang
  // kebetulan memuat "www." tidak berbahaya — dibuang saja.
  s = s.replace(/www\.\S+/gi, "")
  // 3. Kutip ganda -> kutip tunggal.
  s = s.replace(/"/g, "'")
  // 4. Collapse whitespace + trim.
  s = s.replace(/\s+/g, " ").trim()
  // 5. Cap 240 — trim lagi jaga-jaga kalau potongan jatuh tepat setelah spasi.
  s = s.slice(0, 240).trim()

  return s.length > 0 ? s : undefined
}
