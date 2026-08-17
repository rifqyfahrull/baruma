/**
 * Converts Baruma's deterministic advisory context (brief summary, computed
 * standards audit, curated design knowledge, real asset suggestions, recent
 * chat history) into `askAssistant`'s context blocks. Pure for testing.
 *
 * The advisory SYSTEM PROMPT itself lives in llm.ts's ASSISTANT_SYSTEM_PROMPT,
 * NOT here — this only supplies grounding context.
 */
import type { Brief, RiskCategory, RiskWarning, RoomType, Severity, SpaceProgramItem } from "@/types"
import type { AuditFinding } from "@/lib/audit/design-audit"
import type { AssistantContextBlock } from "./llm"
import type { AssistantTurn } from "./brief-assistant"

const MAX_HISTORY = 8

export function buildAssistantContextBlocks(input: {
  brief: Brief | null
  history?: AssistantTurn[]
  standardsNote?: string
  designKnowledgeNote?: string
  assetSuggestionsNote?: string
  existingLayoutNote?: string
}): AssistantContextBlock[] {
  const { brief, history, standardsNote, designKnowledgeNote, assetSuggestionsNote, existingLayoutNote } = input
  const blocks: AssistantContextBlock[] = []

  let briefContext = ""
  if (brief) {
    briefContext = JSON.stringify({
      summary: brief.summary,
      site: brief.site,
      building: brief.building,
      priorities: brief.priorities,
      spaceProgram: brief.spaceProgram.map((s) => ({
        roomType: s.roomType, name: s.name, quantity: s.quantity,
      })),
      constraints: brief.constraints,
      risks: brief.risks.map((r) => r.title),
    })
  } else if (existingLayoutNote) {
    briefContext = [
      "Brief proyek belum diisi oleh pengguna.",
      "KETERANGAN PENTING: Meskipun brief proyek masih kosong, DESAIN DENAH & 2D SUDAH TERSEDIA untuk proyek ini!",
      existingLayoutNote,
      "TINDAKAN AGENT:",
      "1. Mengenali desain yang sudah ada: Ketika disapa atau ditanya mengenai brief, beri tahu pengguna secara ramah bahwa denah & desain rumah ini sudah tersedia.",
      "2. Tawarkan Opsi Berpenomoran (Gunakan format 1. 2. 3. di bawah ini agar UI dapat merender wizard interaktif):",
      "1. **Gaya & Konsep** – Gunakan gaya rumah dari denah yang ada (Modern Tropis) atau tentukan gaya baru?",
      "2. **Program Ruang & Lantai** – Gunakan susunan ruang dari denah yang ada atau ubah kebutuhan ruang?",
      "3. **Prioritas Utama** – Prioritaskan pencahayaan alami, sirkulasi udara, atau efisiensi biaya?",
      "3. Jika pengguna setuju (atau memilih opsi denah), buatkan dan rangkum brief proyek secara AKURAT mencocokkan jumlah lantai, ukuran lahan, dan daftar ruang dari data denah di atas!"
    ].join("\n")
  } else {
    briefContext = "Brief proyek belum diisi oleh pengguna. Jika pengguna meminta bantuan membuat brief, bantu pandu dan susun ringkasan brief (gaya rumah, jumlah lantai, kebutuhan ruang, prioritas, & batasan) secara interaktif."
  }

  blocks.push({ title: "Brief proyek", content: briefContext })

  blocks.push({
    title: "FORMAT RESPONS JSON & ATURAN KLARIFIKASI WAJIB (needs_clarify)",
    content:
      'Balas pesan pengguna dengan format JSON valid: {"reply":"<jawaban/penjelasan>","needs_clarify":[{"question":"<Judul/Pertanyaan>","suggestions":["<Opsi 1>","<Opsi 2>"]}]}.\n' +
      'ATURAN KLARIFIKASI WAJIB:\n' +
      'Setiap kali Anda bertanya, meminta konfirmasi, atau menawarkan pilihan ke pengguna (walaupun hanya 1 pertanyaan atau 2+ pertanyaan), Anda WAJIB memasukkan semua item klarifikasi ke dalam array JSON "needs_clarify": [{"question": "...", "suggestions": ["...", "..."]}]. Jika balasan bersifat jawaban final / penjelasan tanpa pilihan, kirim "needs_clarify": [] atau hilangkan key tersebut.',
  })

  if (standardsNote) {
    blocks.push({
      title: "Hasil audit standar (computed — kutip, jangan mengarang penilaian)",
      content: standardsNote,
    })
  }
  if (designKnowledgeNote) {
    blocks.push({
      title: "Pengetahuan desain (kurasi — pakai bila relevan, jangan mengarang di luar)",
      content: designKnowledgeNote,
    })
  }
  if (assetSuggestionsNote) {
    blocks.push({
      title: "Aset/model tersedia di library (rekomendasikan HANYA dari sini, sebut nama persis)",
      content: assetSuggestionsNote,
    })
  }
  if (history && history.length > 0) {
    const recent = history
      .slice(-MAX_HISTORY)
      .map((t) => `${t.role === "user" ? "User" : "Asisten"}: ${t.content}`)
      .join("\n")
    blocks.push({ title: "Percakapan sebelumnya", content: recent })
  }

  return blocks.slice(0, 8)
}

export function formatExistingLayoutNote(
  layout: { rooms?: any[]; floors?: any[]; site?: { widthM?: number; depthM?: number } } | null,
  projectSite?: { widthM?: number; depthM?: number }
): string | undefined {
  if (!layout) return undefined
  const rooms = layout.rooms || []
  if (rooms.length === 0) return undefined

  const floors = layout.floors || [{ id: "f1", name: "Lantai 1" }]
  const roomList = Array.from(new Set(rooms.map((r) => r.name || r.type))).join(", ")
  const siteW = projectSite?.widthM || layout.site?.widthM || 10
  const siteD = projectSite?.depthM || layout.site?.depthM || 12

  const roomDetails = rooms
    .slice(0, 15)
    .map((r) => `${r.name || r.type}${r.areaM2 ? ` (${r.areaM2}m²)` : ''}`)
    .join(", ")

  return [
    `DESAIN DENAH & 2D TERSEDIA:`,
    `- Ukuran Lahan: ${siteW}m x ${siteD}m`,
    `- Jumlah Lantai: ${floors.length} lantai (${floors.map((f) => f.name || f.id).join(", ")})`,
    `- Total Ruangan: ${rooms.length} ruang (${roomList})`,
    `- Detail Ruangan: ${roomDetails}`,
  ].join("\n")
}

export function buildBriefFromLayout(
  projectId: string,
  layout: { rooms?: any[]; floors?: any[]; site?: { widthM?: number; depthM?: number } } | null,
  projectSite?: { widthM?: number; depthM?: number }
): Brief {
  const rooms = layout?.rooms || []
  const floors = layout?.floors || [{ id: "f1", name: "Lantai 1" }]
  const siteW = projectSite?.widthM || layout?.site?.widthM || 10
  const siteD = projectSite?.depthM || layout?.site?.depthM || 12

  const spaceProgram: SpaceProgramItem[] = rooms.map((r, idx) => ({
    id: `sp-${idx + 1}`,
    roomType: (r.type as RoomType) || "kamar_tidur",
    name: r.name || r.type || "Ruangan",
    required: true,
    quantity: 1,
  }))

  const totalArea = rooms.reduce((acc, r) => acc + (r.areaM2 || 0), 0)

  return {
    projectId,
    summary: `Brief disusun berdasarkan denah eksisting (${floors.length} lantai, ${rooms.length} ruang, total ~${Math.round(totalArea)}m²).`,
    site: { widthM: siteW, depthM: siteD, areaM2: siteW * siteD },
    building: {
      floors: floors.length,
      rooftop: false,
      budget: { minIDR: Math.round(totalArea) * 4000000, maxIDR: Math.round(totalArea) * 6000000 },
      finishingLevel: "menengah",
    },
    priorities: ["terasa_lega", "ventilasi", "banyak_cahaya"],
    spaceProgram,
    assumptions: ["Sesuai denah 2D eksisting"],
    constraints: ["Garis Sempadan Bangunan"],
    risks: [],
  }
}

export function mapAuditFindingsToRisks(findings: AuditFinding[]): RiskWarning[] {
  return findings.map((f, idx) => {
    let category: RiskCategory = "general"
    if (f.category === "regulasi") category = "legal"
    else if (f.category === "struktur") category = "structural"
    else if (f.category === "ruang" || f.category === "sirkulasi" || f.category === "cahaya") category = "spatial"
    else if (f.category === "sanitasi") category = "general"

    let level: Severity = "warning"
    if (f.severity === "critical") level = "danger"
    else if (f.severity === "advisory") level = "info"

    return {
      id: f.id || `risk-${idx + 1}`,
      level,
      category,
      title: f.title,
      message: f.detail || f.fix || f.standard || f.title,
    }
  })
}

