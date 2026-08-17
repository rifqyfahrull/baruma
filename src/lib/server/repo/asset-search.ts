/**
 * Pencarian aset UNTUK AGENT: saat pemilik rumah minta model/aset konkret di
 * percakapan ("carikan gerbang minimalis besi hitam", "ada model sofa L?"),
 * kita cari aset publik yang relevan — memanfaatkan enrichment describe
 * (asset_knowledge.keywords/description_id) supaya kueri Bahasa Indonesia
 * menemukan aset bernama Inggris — lalu suntikkan ke prompt agar agent
 * MEREKOMENDASIKAN model NYATA dari library (bukan mengarang nama).
 */
import { query } from "@/lib/server/db"
import { significantWords } from "@/lib/server/repo/design-knowledge"

export interface AgentAssetRow {
  id: string
  name: string
  category: string
  description: string | null
}

/** Sinyal bahwa pengguna sedang MINTA model/aset (bukan tanya desain umum).
 *  Gate ini menjaga agar Q&A desain biasa tak dibanjiri daftar aset — kita
 *  hanya mencari aset saat memang diminta. */
const ASSET_INTENT =
  /\b(carikan|cariin|cari|mencari|pilih(kan)?|rekomendasi(kan)?|saran(kan|in)?|model|aset|furnitur(e)?|produk|pilihan|contoh|pasang|pakai(kan)?|butuh|tambah(kan)?|beli|ada(kah)?|cocok|selaras|gaya|tipe)\b/i

export function wantsAssetSuggestions(question: string): boolean {
  return ASSET_INTENT.test(question)
}

/** Cari aset publik paling relevan dgn kueri. Skor = jumlah kata bermakna
 *  (termasuk sinonim ID↔EN) yang cocok di nama/kategori/keywords/deskripsi. */
export async function searchAssetsForAgent(
  question: string,
  limit = 5,
): Promise<AgentAssetRow[]> {
  const terms = significantWords(question)
  if (terms.length === 0) return []
  const patterns = terms.map((t) => `%${t}%`)
  const res = await query<AgentAssetRow & { score: number }>(
    `SELECT ua.id, ua.name, ua.category, ak.description_id AS description,
       (SELECT count(*) FROM unnest($1::text[]) t
          WHERE ua.name ILIKE '%'||t||'%' OR ua.category ILIKE '%'||t||'%'
             OR ak.keywords ILIKE '%'||t||'%' OR ak.description_id ILIKE '%'||t||'%') AS score
     FROM user_assets ua
     LEFT JOIN asset_knowledge ak ON ak.asset_id = ua.id
     WHERE ua.is_public = true
       AND (ua.name ILIKE ANY($2) OR ua.category ILIKE ANY($2)
            OR ak.keywords ILIKE ANY($2) OR ak.description_id ILIKE ANY($2))
     ORDER BY score DESC, length(ua.name) ASC
     LIMIT $3`,
    [terms, patterns, limit],
  )
  return res.rows.filter((r) => Number(r.score) > 0)
}

/** Ringkas aset jadi daftar kompak untuk system prompt. */
export function formatAssetSuggestionsNote(rows: AgentAssetRow[]): string {
  if (rows.length === 0) return ""
  return rows
    .map((r) => {
      const desc = r.description ? ` — ${r.description.slice(0, 110)}` : ""
      return `• ${r.name} [${r.category}]${desc}`
    })
    .join("\n")
}
