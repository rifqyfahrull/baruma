/** Pure routing and context policy for the unified project AI Agent. */
import type {
  AssistantMode,
  AssistantSurface,
  ProjectAgentRequest,
} from "@/lib/assistant/actions"

const FLOORPLAN_TERMS = [
  "denah", "ruang", "kamar", "lantai", "pintu", "jendela", "bukaan",
  "atap", "rooftop", "fasad", "dinding", "kolam", "tangga", "balkon",
  "listrik", "stopkontak", "saklar", "air bersih", "air kotor", "sanitasi",
  "septic", "resapan", "struktur", "pondasi", "kolom", "geser", "pindahkan",
  "perbesar", "perkecil", "hapus ruang", "tambah ruang", "perbaiki", "perbaikan",
  "koneksi", "akses", "rute", "jalur", "penghubung", "hubungkan", "sekat", "aksesibilitas",
]

const INTERIOR_TERMS = [
  "interior", "furnitur", "furniture", "sofa", "meja", "kursi", "kasur",
  "lemari", "kabinet", "dekor", "japandi", "scandinavian", "industrial",
  "tata ulang", "gaya ruangan", "lampu interior", "downlight", "pendant",
]

const BRIEF_TERMS = [
  "brief", "prioritas", "kebutuhan", "budget", "anggaran", "lebih hemat",
  "realistis", "saran", "jelaskan", "kenapa", "apakah", "risiko",
]

const SURFACE_DEFAULT: Record<AssistantSurface, AssistantMode> = {
  project: "brief",
  brief: "brief",
  alternatives: "brief",
  editor: "floorplan",
  "preview-3d": "interior",
  rab: "brief",
  drawings: "brief",
  exports: "brief",
  review: "brief",
  furniture: "interior",
  materials: "interior",
}

function normalize(text: string): string {
  return text.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim()
}

function score(text: string, terms: string[]): number {
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0)
}

export type AgentRouteDecision =
  | { kind: "route"; mode: AssistantMode; reason: "explicit" | "intent" | "surface" }
  | { kind: "clarify"; suggestedModes: [AssistantMode, AssistantMode] }

export function routeAgentIntent(
  input: Pick<ProjectAgentRequest, "requestedMode" | "surface" | "instruction">,
  previousMode?: AssistantMode
): AgentRouteDecision {
  if (input.requestedMode !== "auto") {
    return { kind: "route", mode: input.requestedMode, reason: "explicit" }
  }

  const text = normalize(input.instruction)
  const floorplan = score(text, FLOORPLAN_TERMS)
  const interior = score(text, INTERIOR_TERMS)
  const brief = score(text, BRIEF_TERMS)
  const max = Math.max(floorplan, interior, brief)
  const leaders = ([
    ["floorplan", floorplan],
    ["interior", interior],
    ["brief", brief],
  ] as const).filter(([, value]) => value === max && value > 0)

  if (leaders.length === 1) {
    return { kind: "route", mode: leaders[0][0], reason: "intent" }
  }
  if (leaders.length > 1) {
    if (previousMode && leaders.some(([mode]) => mode === previousMode)) {
      return { kind: "route", mode: previousMode, reason: "intent" }
    }
    const surfaceMode = SURFACE_DEFAULT[input.surface]
    if (leaders.some(([mode]) => mode === surfaceMode)) {
      return { kind: "route", mode: surfaceMode, reason: "surface" }
    }
    return { kind: "clarify", suggestedModes: [leaders[0][0], leaders[1][0]] }
  }

  if (previousMode) {
    return { kind: "route", mode: previousMode, reason: "intent" }
  }

  return { kind: "route", mode: SURFACE_DEFAULT[input.surface], reason: "surface" }
}

export function clarificationReply(modes: [AssistantMode, AssistantMode]): string {
  const label: Record<AssistantMode, string> = {
    brief: "Membahas Brief / Saran Desain",
    floorplan: "Mengubah Denah 2D",
    interior: "Menata Interior 3D",
  }
  const text = `Maksud Anda ingin ${label[modes[0]].toLowerCase()} atau ${label[modes[1]].toLowerCase()}? Pilih target di bawah ini:`
  return JSON.stringify({
    reply: text,
    needs_clarify: [
      {
        question: "Target Perubahan",
        suggestions: [label[modes[0]], label[modes[1]]],
      },
    ],
  })
}
