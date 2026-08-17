/**
 * Builds the chat messages for the brief AI assistant: a system prompt that
 * grounds the model on the project's brief, the (trimmed) conversation history,
 * and the new question. Kept pure for testing.
 */
import type { Brief } from "@/types"
import type { ChatMsg } from "./llm"

export interface AssistantTurn {
  role: "user" | "assistant"
  content: string
}

const MAX_HISTORY = 8

export function buildAssistantMessages(
  brief: Brief,
  question: string,
  history: AssistantTurn[] = [],
  /** Compact, deterministic standards-audit summary of the current design
   *  (see summarizeAuditForPrompt). Present only when a layout exists — grounds
   *  answers about whether the design meets SNI/construction standards in real
   *  computed facts instead of the model's guesses. */
  standardsNote?: string,
  /** Penalaran desain terkurasi (design_knowledge) yang relevan dgn pertanyaan
   *  — why/when-not/alternatives/material dsb. Grounds jawaban "kenapa/kapan/
   *  alternatif" pada pengetahuan kurasi, bukan karangan model. */
  designKnowledgeNote?: string,
  /** Daftar aset NYATA dari library (hasil pencarian, memanfaatkan enrichment
   *  describe) yang relevan bila pengguna minta model/produk. Agar agent
   *  merekomendasikan model yang benar-benar ada, bukan mengarang nama. */
  assetSuggestionsNote?: string,
): ChatMsg[] {
  const context = JSON.stringify({
    summary: brief.summary,
    site: brief.site,
    building: brief.building,
    priorities: brief.priorities,
    spaceProgram: brief.spaceProgram.map((s) => ({
      roomType: s.roomType,
      name: s.name,
      quantity: s.quantity,
    })),
    constraints: brief.constraints,
    risks: brief.risks.map((r) => r.title),
  })

  const system: ChatMsg = {
    role: "system",
    content:
      "Kamu asisten arsitek di aplikasi Baruma. Jawab pertanyaan pemilik rumah tentang brief desain di bawah, " +
      "dalam Bahasa Indonesia yang ringkas, praktis, dan membantu. Jujur soal keterbatasan: jangan mengarang " +
      "angka biaya pasti atau klaim teknis tanpa dasar, dan sarankan tinjauan profesional bila menyangkut " +
      "struktur atau keselamatan. Jika pertanyaan di luar konteks desain rumah/brief ini, arahkan kembali dengan " +
      "sopan. Jawab maksimal beberapa paragraf pendek." +
      // Standards grounding: when the design has been evaluated, answer any
      // "apakah sudah sesuai standar / sudah bagus?" question from THESE facts
      // (they are computed, not guessed), and point the user to the one-tap fix.
      (standardsNote
        ? "\n\nGunakan HASIL AUDIT STANDAR berikut sebagai dasar bila pemilik bertanya apakah desainnya sudah baik/sesuai standar — kutip temuannya, jangan mengarang penilaian sendiri:\n" +
          standardsNote
        : "") +
      // Design-reasoning grounding: penalaran desain terkurasi (kenapa dipakai,
      // kapan tidak, alternatif, material) untuk topik yang relevan dgn
      // pertanyaan. Pakai ini sbg dasar bila relevan — jangan mengarang di luar.
      (designKnowledgeNote
        ? "\n\nPENGETAHUAN DESAIN (kurasi, pakai bila relevan dgn pertanyaan; jangan mengarang di luar ini):\n" +
          designKnowledgeNote
        : "") +
      // Asset grounding: bila pengguna minta model/produk, rekomendasikan HANYA
      // dari daftar ini (aset nyata di library) — sebut nama persis, jangan
      // mengarang model yang tak ada. Kosongkan bila tak ada yang cocok.
      (assetSuggestionsNote
        ? "\n\nMODEL TERSEDIA DI LIBRARY (bila pengguna minta model/aset, rekomendasikan HANYA dari daftar ini, sebut nama persis; JANGAN mengarang model lain):\n" +
          assetSuggestionsNote
        : "") +
      "\n\nBRIEF:\n" +
      context,
  }

  const trimmed = history
    .slice(-MAX_HISTORY)
    .map<ChatMsg>((t) => ({ role: t.role, content: t.content }))

  return [system, ...trimmed, { role: "user", content: question }]
}
