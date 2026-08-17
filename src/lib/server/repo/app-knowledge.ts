/**
 * Retrieval `app_knowledge` — pemahaman agent tentang MEKANIKA Baruma sendiri.
 *
 * Beda peran dengan design-knowledge.ts: itu pengetahuan ARSITEKTUR (kenapa
 * pakai kitchen island), ini pengetahuan APLIKASI (apa efek `addRoom`, tipe
 * ruang mana yang dirender tanpa dinding, `positionM` diukur dari mana).
 *
 * Tanpa ini agent tahu APA yang bagus secara desain tapi tidak tahu APA yang
 * BISA & AKAN TERJADI di aplikasi — sehingga tak pernah sampai ke langkah
 * presisi seperti "ruang terkurung bisa diberi akses lewat void, karena void
 * termasuk tipe yang dirender tanpa dinding".
 *
 * Isinya digenerate dari BUKTI KODE (scripts/asset-harvest/40 & 41), jadi
 * aman disuntikkan sebagai rujukan aksi yang benar-benar ada.
 */
import { query } from "@/lib/server/db"
import { significantWords } from "@/lib/server/repo/design-knowledge"

export interface AppKnowledgeRow {
  id: string
  kind: string
  name: string
  knowledge: Record<string, unknown>
}

/**
 * Verba aksi ("hapus", "tambah", "pindah") — bila instruksi memuat salah
 * satunya, niat pengguna hampir selalu MELAKUKAN sesuatu, bukan bertanya
 * mekanisme. Terukur: tanpa bobot ini, fakta `mechanic` yang cakupan kata
 * kuncinya luas (mis. tabel default listrik per-ruang) mengalahkan aksi
 * spesifik seperti `removeElectricalPoint` di skor kumulatif — instruksi
 * "hapus stopkontak di ruang keluarga" mengambil mechanic:listrik-default,
 * bukan aksi hapusnya sendiri.
 */
const ACTION_VERB_RE =
  /\b(hapus|menghapus|buang|membuang|hilangkan|batalkan|tambah|menambah|tambahkan|pindah|memindah|pindahkan|geser|menggeser|ubah|mengubah|ganti|mengganti|gantikan|pasang|memasang|putar|memutar|atur ulang|reset)\w*\b/i

/**
 * Ambil konsep mekanika yang relevan dgn instruksi.
 *
 * Mencocokkan nama konsep DAN keywords (frasa awam), memakai kata utuh + IDF
 * seperti retrieval design_knowledge — pelajaran yang sama berlaku di sini:
 * pencocokan substring membuat "mana" menarik topik yang mengandung "man".
 */
export async function retrieveAppKnowledge(
  instruction: string,
  limit = 4,
): Promise<AppKnowledgeRow[]> {
  const words = significantWords(instruction)
  if (words.length === 0) return []
  const actionIntent = ACTION_VERB_RE.test(instruction)
  const res = await query<AppKnowledgeRow>(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (
       SELECT ak.id, q.word, (ak.name ILIKE '%' || q.word || '%') AS in_name
       FROM app_knowledge ak
       JOIN q ON ak.name ILIKE '%' || q.word || '%'
              OR coalesce(ak.keywords, '') ~* ('\\m' || q.word || '\\M')
     ),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM app_knowledge),
     -- Boost diterapkan DI DALAM skor, bukan cuma ORDER BY — kalau hanya di
     -- ORDER BY, aksi spesifik yang skor mentahnya di bawah ambang 0.5×max
     -- sudah keburu terbuang sebelum boost sempat menyelamatkannya.
     scored AS (
       SELECT m.id,
              sum(ln((SELECT n FROM total) / df.df)
                  * (CASE WHEN m.in_name THEN 2.0 ELSE 1.0 END))
              * (CASE WHEN $3 AND ak0.kind = 'action' THEN 1.6 ELSE 1.0 END) AS score
       FROM m
       JOIN df ON df.word = m.word
       JOIN app_knowledge ak0 ON ak0.id = m.id
       GROUP BY m.id, ak0.kind
     )
     SELECT ak.id, ak.kind, ak.name, ak.knowledge
     FROM scored s
     JOIN app_knowledge ak ON ak.id = s.id
     WHERE s.score >= 0.5 * (SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(ak.name) ASC
     LIMIT $2`,
    [words, limit, actionIntent],
  )
  return res.rows
}

/** Ringkas jadi catatan kompak untuk system prompt. */
export function formatAppKnowledgeNote(rows: AppKnowledgeRow[]): string {
  if (rows.length === 0) return ""
  return rows
    .map((r) => {
      const k = r.knowledge
      const lines: string[] = [`• ${r.name} (${r.kind})`]
      if (typeof k.what === "string") lines.push(`  ${k.what}`)
      for (const key of ["effects", "constraints", "pitfalls"] as const) {
        const v = k[key]
        if (Array.isArray(v) && v.length) lines.push(`  - ${key}: ${v.slice(0, 3).join("; ")}`)
      }
      return lines.join("\n")
    })
    .join("\n")
}

/** Catatan mekanika untuk sebuah instruksi editor. Gagal-diam: apa pun yang
 *  bermasalah → undefined, dan prompt kembali seperti sebelum fitur ini ada. */
export async function appMechanicsNote(instruction: string): Promise<string | undefined> {
  try {
    const rows = await retrieveAppKnowledge(instruction)
    return rows.length ? formatAppKnowledgeNote(rows) : undefined
  } catch {
    return undefined
  }
}
