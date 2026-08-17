/**
 * Pure brief-field builder shared by project creation (mock) and brief editing.
 * Turns wizard form input (CreateProjectInput) into the structured + derived
 * brief fields (summary/site/building/priorities/spaceProgram/assumptions/
 * constraints/risks). Keeping this in one place ensures an edited brief stays
 * consistent with how it was originally generated.
 */
import { nanoid } from "nanoid"

import type { Brief, RiskWarning, SpaceProgramItem } from "@/types"
import type { CreateProjectInput } from "@/lib/schemas/project"
import { ROOM_TYPES } from "@/lib/constants"

const round1 = (n: number) => Math.round(n * 10) / 10
const labelType = (t: "new" | "renovation") =>
  t === "renovation" ? "Renovasi rumah" : "Rumah baru"

export function spaceProgramFromInput(input: CreateProjectInput): SpaceProgramItem[] {
  const items: SpaceProgramItem[] = input.rooms.map((r) => ({
    id: nanoid(8),
    roomType: r.roomType,
    name: r.name || ROOM_TYPES[r.roomType].label,
    required: r.required,
    quantity: r.quantity,
    preferredFloor: r.preferredFloor,
    sizePreference: r.sizePreference,
    notes: r.notes,
  }))
  if (input.carport && !items.some((i) => i.roomType === "carport")) {
    items.unshift({
      id: nanoid(8),
      roomType: "carport",
      name: "Carport",
      required: true,
      quantity: 1,
      preferredFloor: 1,
    })
  }
  return items
}

export function buildConstraints(input: CreateProjectInput): string[] {
  const c: string[] = []
  if (input.widthM < 7) c.push("Lahan relatif sempit di sisi lebar.")
  if (input.sidesAttached > 0)
    c.push(`${input.sidesAttached} sisi menempel tetangga (bukaan terbatas).`)
  if (input.floors >= 2)
    c.push("Sirkulasi vertikal (tangga) memakan area tiap lantai.")
  if ((input.frontRoadWidthM ?? 0) > 0 && (input.frontRoadWidthM ?? 0) < 4)
    c.push("Jalan depan sempit, perhatikan akses material.")
  if (c.length === 0) c.push("Tidak ada kendala lahan yang menonjol.")
  return c
}

export function buildRisks(opts: {
  floors: number
  hasPool: boolean
  rooftop: boolean
  narrow: boolean
}): RiskWarning[] {
  const risks: RiskWarning[] = []
  if (opts.floors >= 3) {
    risks.push({
      id: nanoid(6),
      level: "warning",
      category: "structural",
      title: `Bangunan ${opts.floors} lantai`,
      message:
        "Struktur bertingkat tinggi perlu ditinjau engineer struktur sebelum dibangun.",
    })
  }
  if (opts.hasPool) {
    risks.push({
      id: nanoid(6),
      level: "warning",
      category: "structural",
      title: "Kolam",
      message:
        "Kolam menambah beban dan kebutuhan waterproofing. Perlu review struktur & MEP.",
    })
  }
  if (opts.rooftop) {
    risks.push({
      id: nanoid(6),
      level: "info",
      category: "structural",
      title: "Rooftop",
      message: "Pastikan beban rooftop dan pengaman (railing) sesuai standar.",
    })
  }
  if (opts.narrow) {
    risks.push({
      id: nanoid(6),
      level: "info",
      category: "spatial",
      title: "Cahaya & ventilasi",
      message:
        "Lahan sempit / menempel tetangga. Pertimbangkan void atau skylight agar terang dan adem.",
    })
  }
  return risks
}

/** The brief fields derived from form input (everything except projectId). */
export type BriefFields = Pick<
  Brief,
  | "summary"
  | "site"
  | "building"
  | "priorities"
  | "spaceProgram"
  | "assumptions"
  | "constraints"
  | "risks"
>

export function buildBriefFields(input: CreateProjectInput): BriefFields {
  const areaM2 = round1(input.widthM * input.depthM)
  const hasPool = input.rooms.some((r) => r.roomType === "kolam")
  const narrow = input.widthM < 7 || input.sidesAttached > 0

  return {
    summary: `${labelType(input.projectType)} ${input.floors} lantai${
      input.rooftop ? " + rooftop" : ""
    } di tanah ${input.widthM}×${input.depthM} m, ${input.city}. Gaya ${
      input.style
    }.`,
    site: {
      widthM: input.widthM,
      depthM: input.depthM,
      areaM2,
      city: input.city,
      frontOrientation: input.frontOrientation,
      sidesAttached: input.sidesAttached,
      frontRoadWidthM: input.frontRoadWidthM,
      notes: input.siteNotes,
      regulation: input.regulation,
    },
    building: {
      floors: input.floors,
      rooftop: input.rooftop,
      budget: { minIDR: input.budgetMinIDR, maxIDR: input.budgetMaxIDR },
      finishingLevel: input.finishingLevel,
    },
    priorities: input.priorities,
    spaceProgram: spaceProgramFromInput(input),
    assumptions: [
      "Tanah relatif datar dan kering.",
      "Akses jalan depan cukup untuk material standar.",
      "Sumber air dan listrik tersedia di lokasi.",
      "Tinggi antar lantai 3,2 m (standar rumah tinggal).",
    ],
    constraints: buildConstraints(input),
    risks: buildRisks({ floors: input.floors, hasPool, rooftop: input.rooftop, narrow }),
  }
}
