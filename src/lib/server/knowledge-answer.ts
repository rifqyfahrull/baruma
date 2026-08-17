/**
 * Jalur Q&A untuk PERTANYAAN PENGETAHUAN yang diketik di panel editor
 * (mode denah/interior).
 *
 * Insiden produksi: "Kenapa sebaiknya pakai kitchen island?" diketik di tab
 * Denah → masuk pipeline edit-JSON → LLM gagal → pengguna menerima fallback
 * "pecah jadi satu langkah sederhana — mis. 'pindahkan kamar mandi…'" yang
 * sama sekali tak nyambung. Padahal jawabannya SUDAH ADA di design_knowledge
 * (dipakai brief mode, teruji eval 6/6).
 *
 * Prinsip: pertanyaan pengetahuan dijawab lewat jalur teks ter-grounding —
 * dan bila LLM gagal, jawaban DETERMINISTIK disusun langsung dari knowledge
 * yang ter-retrieve. Tidak pernah lagi jatuh ke fallback edit yang salah
 * konteks.
 */
import { chatText, llmEnabled } from "@/lib/server/llm"
import {
  retrieveDesignKnowledge,
  formatDesignKnowledgeNote,
  type DesignKnowledgeRow,
} from "@/lib/server/repo/design-knowledge"
import { retrieveAppKnowledge, formatAppKnowledgeNote } from "@/lib/server/repo/app-knowledge"

/** Kata tanya di awal, atau kalimat berakhir "?". */
const QUESTION_RE =
  /^(kenapa|mengapa|apa(kah| itu)?|bagaimana|gimana|kapan|berapa|sebaiknya|lebih (baik|bagus)|perlu(kah)?|boleh(kah)?)\b|\?\s*$/i

/** Verba penyuntingan — bila ada, ini perintah edit, bukan pertanyaan.
 *  Prefiks di- ikut ditangkap ("kenapa tidak dihapus saja?" = usul edit,
 *  bukan pertanyaan pengetahuan). "tata" sendirian TIDAK masuk — "bagaimana
 *  tata letak yang baik?" adalah pertanyaan pengetahuan; hanya "tata ulang"
 *  yang dihitung perintah. */
const EDIT_VERB_RE =
  /\b(di)?(tambah|pindah|geser|hapus|buang|hilangkan|batalkan|ubah|ganti|pasang|buat|bikin|perbesar|perkecil|perbaiki|rapikan|putar|terapkan|reset)(kan|in)?\b|\btata ulang\b/i

export function isKnowledgeQuestion(instruction: string): boolean {
  const t = instruction.trim()
  return QUESTION_RE.test(t) && !EDIT_VERB_RE.test(t.toLowerCase())
}

/** Jawaban deterministik dari baris knowledge — dipakai saat LLM gagal, agar
 *  pengguna tetap mendapat isi, bukan pesan fallback yang salah konteks. */
function deterministicAnswer(rows: DesignKnowledgeRow[]): string {
  const r = rows[0]
  const k = r.knowledge as Record<string, unknown>
  const list = (key: string) => (Array.isArray(k[key]) ? (k[key] as string[]) : [])
  const parts: string[] = [`Tentang ${r.topic}:`]
  const sections: [string, string][] = [
    ["why_used", "Alasan dipakai"],
    ["pros", "Kelebihan"],
    ["recommended_for", "Cocok untuk"],
    ["when_not_to_use", "Sebaiknya dihindari bila"],
    ["cons", "Kekurangan"],
    ["layout_principles", "Prinsip tata letak"],
    ["solusi_pasif", "Solusi pasif"],
    ["kapan_panggil_ahli", "Kapan perlu ahli"],
  ]
  for (const [key, label] of sections) {
    const items = list(key)
    if (items.length) parts.push(`${label}: ${items.slice(0, 3).join("; ")}.`)
  }
  const tropis = k.tropical_note ?? k.tropical_tips
  if (typeof tropis === "string" && tropis) parts.push(`Catatan iklim tropis: ${tropis}`)
  return parts.join("\n")
}

/**
 * Jawab pertanyaan pengetahuan; null bila instruksi BUKAN pertanyaan
 * pengetahuan (biarkan pipeline edit berjalan normal). Gagal-diam terhadap
 * error retrieval — hanya bentuk pertanyaannya yang menentukan pemilihan
 * jalur, bukan keberhasilan DB.
 */
export async function answerKnowledgeQuestion(instruction: string): Promise<string | null> {
  if (!isKnowledgeQuestion(instruction)) return null

  const designRows = await retrieveDesignKnowledge(instruction).catch(
    () => [] as DesignKnowledgeRow[],
  )
  const appRows = await retrieveAppKnowledge(instruction).catch(() => [])
  const notes = [
    formatDesignKnowledgeNote(designRows),
    formatAppKnowledgeNote(appRows),
  ].filter(Boolean)

  if (llmEnabled()) {
    const system =
      "Kamu asisten arsitek di aplikasi Baruma. Jawab pertanyaan pemilik rumah dalam Bahasa " +
      "Indonesia yang ringkas, praktis, dan jujur. Jangan mengarang angka biaya pasti atau klaim " +
      "teknis tanpa dasar; sarankan tinjauan profesional untuk hal struktur/keselamatan." +
      (notes.length
        ? "\n\nPENGETAHUAN (kurasi — jadikan dasar bila relevan; jangan mengarang di luar ini):\n" +
          notes.join("\n")
        : "")
    const answer = await chatText([
      { role: "system", content: system },
      { role: "user", content: instruction },
    ])
    if (answer) return answer
  }

  // LLM mati/gagal — susun jawaban langsung dari knowledge bila ada.
  if (designRows.length) return deterministicAnswer(designRows)
  return null
}
