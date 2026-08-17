/**
 * Retrieval "Design Reasoning" (design_knowledge) untuk grounding jawaban AI
 * agent. Saat pemilik rumah bertanya soal desain ("kenapa pakai kitchen
 * island?", "material apa untuk dapur?", "gaya japandi seperti apa?"), kita
 * cari topik yang relevan dan suntikkan penalaran KURASI ini ke prompt —
 * supaya agent menjelaskan seperti konsultan, bukan mengarang.
 */
import { query } from "@/lib/server/db"
import { expandSearchTerms } from "@/lib/assets/search-synonyms"

export interface DesignKnowledgeRow {
  id: string
  topic_type: string
  topic: string
  knowledge: Record<string, unknown>
}

// Kata umum yang tak membantu pencocokan topik. Termasuk kata-tanya &
// pengisi yang dulu ikut jadi pola pencarian ("mana" pernah menarik topik
// "Batu paliMANan" lewat pencocokan substring).
const STOP = new Set([
  "yang", "untuk", "apa", "itu", "dan", "atau", "dengan", "pakai", "pake", "gimana",
  "bagaimana", "kenapa", "mengapa", "kalau", "jika", "saya", "aku", "mau", "ingin",
  "bisa", "boleh", "harus", "adalah", "di", "ke", "dari", "pada", "ini", "the", "a",
  "an", "is", "of", "for", "how", "why", "what", "cocok", "bagus", "baik", "buat",
  "mana", "dimana", "kemana", "sebaiknya", "perlu", "solusinya", "solusi", "terus",
  "seperti", "enaknya", "banget", "pengen", "gak", "nggak", "tidak", "juga", "biar",
  "rumah", "agar", "supaya", "lebih", "sudah", "masih", "ada", "saja", "aja", "sih",
  "dong", "nya", "punya", "kita", "bikin", "ditaruh", "worth", "mending", "pilih",
])

/** Kata bermakna dari pertanyaan (>=3 huruf, bukan stopword), + ekspansi
 *  sinonim ID↔EN tiap kata. Dipakai bersama oleh retrieval design_knowledge
 *  DAN pencarian aset untuk agent (asset-search). */
export function significantWords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
  // + ekspansi sinonim tiap kata (pagar→fence/gate, wastafel→sink…) supaya
  //   pertanyaan ID menemukan topik yang mungkin bernama beda.
  const expanded = new Set(words)
  for (const w of words) for (const t of expandSearchTerms(w)) expanded.add(t)
  return [...expanded].filter((w) => w.length >= 3)
}

/**
 * Ambil topik design_knowledge paling relevan dgn pertanyaan.
 *
 * Pencocokan KATA UTUH (regex `\m…\M`), bukan substring — dulu `ILIKE '%mana%'`
 * menarik "Batu paliMANan" untuk pertanyaan "ditaruh di mana". Skor memakai
 * IDF (ln N/df): kata langka spt "island" bernilai jauh lebih tinggi daripada
 * kata umum spt "ruang" yang muncul di banyak topik.
 *
 * Dua gerbang relevansi menahan grounding sampah:
 *  - Cocok >= 2 kata, ATAU 1 kata yang MENDOMINASI nama topik (>= 0,6 panjang
 *    nama). Jadi "japandi" → topik "Japandi" tetap lolos, tapi "terpisah" tak
 *    lagi menyeret "Pintu pedestrian terpisah", "dinding" tak menyeret "Rak
 *    dinding terbuka", dan "ruang" (0,5 dari "Ruang tamu") tak lolos sendirian.
 *  - `score >= 0.7 × skor terbaik` — topik yang jauh lebih lemah dari juara
 *    dibuang, jadi "Kabinet atas dapur" tak ikut saat "Kitchen island" menang.
 */
export async function retrieveDesignKnowledge(
  question: string,
  limit = 3,
): Promise<DesignKnowledgeRow[]> {
  const words = significantWords(question)
  if (words.length === 0) return []
  const res = await query<DesignKnowledgeRow>(
    `WITH q AS (SELECT DISTINCT unnest($1::text[]) AS word),
     m AS (
       SELECT dk.id, q.word,
              (dk.topic ~* ('\\m' || q.word || '\\M')) AS in_topic
       FROM design_knowledge dk
       JOIN q ON dk.topic ~* ('\\m' || q.word || '\\M')
              OR coalesce(dk.keywords, '') ~* ('\\m' || q.word || '\\M')
     ),
     df AS (SELECT word, count(*)::float AS df FROM m GROUP BY word),
     total AS (SELECT count(*)::float AS n FROM design_knowledge),
     scored AS (
       SELECT m.id,
              -- cocok di NAMA topik bernilai lebih tinggi daripada cocok di
              -- keywords, supaya frasa awam menambah jangkauan tanpa
              -- menggeser topik yang namanya memang persis diminta.
              sum(ln((SELECT n FROM total) / df.df)
                  * (CASE WHEN m.in_topic THEN 1.5 ELSE 1.0 END)) AS score,
              count(*) AS hits,
              -- porsi nama topik yang ditutupi satu kata cocok, diukur atas
              -- nama PENUH (termasuk kurung — kata bisa cocok di dalamnya,
              -- mis. "dapur" pada "Quartz (meja dapur)" hanya 0,26).
              -- "Japandi"=1.0; "beton" pd "Roster beton"=0,42;
              -- "ruang" pd "Ruang tamu"=0,5 → di bawah ambang 0,6.
              -- Hanya kecocokan NAMA yang dihitung (keywords tak memberi
              -- dominasi nama).
              max(CASE WHEN m.in_topic
                       THEN length(m.word)::float / greatest(length(dk0.topic), 1)
                       ELSE 0 END) AS cover
       FROM m
       JOIN df ON df.word = m.word
       JOIN design_knowledge dk0 ON dk0.id = m.id
       GROUP BY m.id
     )
     SELECT dk.id, dk.topic_type, dk.topic, dk.knowledge
     FROM scored s
     JOIN design_knowledge dk ON dk.id = s.id
     WHERE (s.hits >= 2 OR s.cover >= 0.6)
       AND s.score >= 0.7 * (SELECT max(score) FROM scored)
     ORDER BY s.score DESC, length(dk.topic) ASC
     LIMIT $2`,
    [words, limit],
  )
  return res.rows
}

/**
 * Ambil penalaran desain untuk mode berbasis-scene (denah/interior).
 *
 * Instruksi editor sering sangat pendek ("rapikan", "tata ulang") sehingga
 * pencocokan kata dari instruksi saja tak menemukan apa pun. Nama & tipe ruang
 * yang sedang digarap ikut disertakan sebagai konteks, jadi prinsip ruang
 * ("posisi tempat tidur tidak langsung menghadap pintu") tetap terambil.
 */
export async function retrieveDesignKnowledgeForScene(
  instruction: string,
  roomLabels: string[],
  limit = 3,
): Promise<DesignKnowledgeRow[]> {
  const context = [instruction, ...roomLabels.slice(0, 4)].join(" ")
  return retrieveDesignKnowledge(context, limit)
}

/** Scene editor secukupnya — sengaja duck-typed agar modul repo ini tak
 *  bergantung pada tipe assistant (denah pakai `id`, interior pakai `roomId`). */
interface SceneLike {
  rooms?: { id?: string; roomId?: string; name?: string; type?: string }[]
  selectedRoomId?: string | null
}

/**
 * Catatan PENGETAHUAN DESAIN untuk prompt editor (mode denah & interior).
 *
 * Instruksi editor sering sangat pendek ("rapikan", "tata ulang"), jadi konteks
 * ruang yang sedang digarap ikut disertakan — tanpa itu tak ada kata yang bisa
 * dicocokkan. Ruang terpilih diprioritaskan; bila belum ada, beberapa ruang
 * pertama dipakai.
 *
 * Best-effort: apa pun yang gagal → undefined, dan prompt kembali persis
 * seperti sebelum fitur ini ada.
 */
export async function sceneKnowledgeNote(
  scene: SceneLike,
  instruction: string,
  limit = 3,
): Promise<string | undefined> {
  try {
    const rooms = scene.rooms ?? []
    const selected = rooms.find((r) => (r.roomId ?? r.id) === scene.selectedRoomId)
    const focus = selected ? [selected] : rooms.slice(0, 3)
    const labels = focus.flatMap((r) => [r.name, r.type]).filter((x): x is string => !!x)

    // Topik ruang yang digarap diambil LANGSUNG by-nama, tidak lewat skor
    // fuzzy. Kata instruksi generik ("tata ulang", "perbaiki letak") gampang
    // mencocoki keywords topik lain dan mengalahkan topik ruangnya sendiri —
    // terukur: "tata ulang" pada Dapur sempat mengembalikan Melamine/PVC sheet.
    const names = focus.map((r) => r.name).filter((x): x is string => !!x)
    const exact = names.length
      ? (await query<DesignKnowledgeRow>(
          `SELECT id, topic_type, topic, knowledge FROM design_knowledge
           WHERE lower(topic) = ANY($1::text[]) LIMIT $2`,
          [names.map((n) => n.toLowerCase()), limit],
        )).rows
      : []

    const fuzzy = await retrieveDesignKnowledgeForScene(instruction, labels, limit)
    const seen = new Set(exact.map((r) => r.id))
    const merged = [...exact, ...fuzzy.filter((r) => !seen.has(r.id))].slice(0, limit)
    return merged.length ? formatDesignKnowledgeNote(merged) : undefined
  } catch {
    return undefined
  }
}

/** Ringkas beberapa baris knowledge jadi teks kompak untuk system prompt. */
export function formatDesignKnowledgeNote(rows: DesignKnowledgeRow[]): string {
  if (rows.length === 0) return ""
  const blocks = rows.map((r) => {
    const k = r.knowledge
    const lines: string[] = [`• ${r.topic} (${r.topic_type})`]
    for (const [key, val] of Object.entries(k)) {
      if (Array.isArray(val) && val.length) lines.push(`  - ${key}: ${val.slice(0, 5).join("; ")}`)
      else if (typeof val === "string" && val.trim()) lines.push(`  - ${key}: ${val}`)
    }
    return lines.join("\n")
  })
  return blocks.join("\n")
}
