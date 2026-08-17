/**
 * Gaya Fasad 1-klik — komposisi cladding + kisi vertikal siap pakai untuk
 * seluruh muka bangunan, supaya awam mendapat fasad "advance" seketika lalu
 * tinggal menyetel per dinding (klik dinding di 3D). Murni (tanpa three.js /
 * store) → mudah diuji.
 *
 * Aturan komposisi: muka DEPAN (searah frontOrientation) memakai material HERO
 * berselang AKSEN; sisi lain memakai BASE. Ruang terbuka (carport/taman/kolam/
 * balkon/void) dilewati (tak berdinding). Opsional: satu band kisi vertikal
 * (louver) sebagai aksen di dinding depan ruang terlebar tiap lantai.
 */
import type { DesignLayout, FacadeElement, FacadeElementFinish } from "@/types"
import { OPEN_TYPES } from "@/lib/three/build-model"
import { roomsAdjacentOnSide } from "@/lib/geometry"
import { facadeKeysForWall } from "@/lib/three/facade-bands"

type SideId = "n" | "s" | "w" | "e"

export type FacadePreset = {
  id: string
  label: string
  description: string
  /** Cladding id (lihat FACADE_CLADDINGS). */
  hero: string
  accent: string
  base: string
  /** Aksen kisi vertikal di muka depan; null = tanpa. */
  louverFinish: FacadeElementFinish | null
}

export const FACADE_PRESETS: FacadePreset[] = [
  {
    id: "modern_dua_tona",
    label: "Modern Dua-Tona",
    description: "Beton ekspos + granit hitam + aksen kisi kayu — modern tegas.",
    hero: "beton_ekspos",
    accent: "granit_hitam",
    base: "beton_ekspos",
    louverFinish: "kayu",
  },
  {
    id: "minimalis_putih",
    label: "Minimalis Putih",
    description: "Marmer/bata putih + slat gelap — bersih & elegan.",
    hero: "marmer_carrara",
    accent: "granit_hitam",
    base: "bata_putih",
    louverFinish: "aluminium_gelap",
  },
  {
    id: "tropis_kayu",
    label: "Tropis Kayu",
    description: "Kayu cladding hangat + batu andesit — natural tropis.",
    hero: "kayu_cladding",
    accent: "batu_andesit",
    base: "kayu_alder",
    louverFinish: "kayu",
  },
  {
    id: "batu_mewah",
    label: "Batu Alam Mewah",
    description: "Batu alam gelap + marmer krem — kesan mewah.",
    hero: "batu_alam_gelap",
    accent: "marmer_krem",
    base: "marmer_krem",
    louverFinish: "putih",
  },
  {
    id: "modern_tropis_villa",
    label: "Modern Tropis Villa",
    description: "Marmer krem/travertine + cladding kayu hangat + aksen kisi kayu & glass balcony — kemewahan villa tropis Emporio Style.",
    hero: "marmer_krem",
    accent: "kayu_cladding",
    base: "marmer_krem",
    louverFinish: "kayu",
  },
  {
    id: "skillion_charcoal",
    label: "Skillion Charcoal-Kayu",
    description: "Kayu hangat + charcoal granit + beton krem — atap miring modern (ref: fasad skillion abu-kayu).",
    hero: "kayu_cladding",
    accent: "granit_hitam",
    base: "beton_ekspos",
    louverFinish: "kayu",
  },
  {
    id: "wood_slat_putih",
    label: "Wood-Slat Putih",
    description: "Kayu hangat + bata putih + bilah gelap — putih bersih dengan panel kayu & bingkai hitam (ref: kubus cantilever).",
    hero: "kayu_cladding",
    accent: "bata_putih",
    base: "bata_putih",
    louverFinish: "aluminium_gelap",
  },
  {
    id: "japandi_sirip",
    label: "Japandi Sirip Vertikal",
    description: "Plester putih + sirip kayu vertikal + aksen batu — Japandi tropis (ref: fasad sirip + gerbang dekoratif).",
    hero: "bata_putih",
    accent: "kayu_cladding",
    base: "bata_putih",
    louverFinish: "kayu",
  },
  {
    id: "scandi_tropis",
    label: "Scandi Tropis",
    description: "Plester putih + aksen kayu hangat + kusen hitam — Skandinavia tropis (ref: gable asimetris + kaca gable + roster putih).",
    hero: "bata_putih",
    accent: "kayu_cladding",
    base: "bata_putih",
    louverFinish: "kayu",
  },
  {
    id: "tropis_hijau",
    label: "Tropis Hijau (Green Wall)",
    description: "Plester putih + bidang taman vertikal (green wall) + aksen kayu — fasad hijau tropis (ref: fasad green wall).",
    hero: "taman_vertikal",
    accent: "kayu_cladding",
    base: "bata_putih",
    louverFinish: "kayu",
  },
]

const SIDES: SideId[] = ["n", "s", "w", "e"]
const ORIENT_TO_SIDE: Record<string, SideId> = { north: "n", south: "s", east: "e", west: "w" }

/** Sisi denah (n/s/e/w) yang menghadap jalan/depan dari orientasi proyek. */
export function orientationToFrontSide(orientation?: string | null): SideId {
  return ORIENT_TO_SIDE[orientation ?? ""] ?? "s"
}

export function facadePresetById(id: string): FacadePreset | null {
  return FACADE_PRESETS.find((p) => p.id === id) ?? null
}

/**
 * Bangun komposisi fasad (facade record + facadeElements) untuk sebuah preset.
 * Menggantikan komposisi lama (gaya fresh), bukan menambah — KECUALI dinding
 * yang menghadap ruang terbuka (courtyard/taman) yang sudah di-set manual:
 * entry lamanya (polos maupun band) dipertahankan.
 *
 * Sadar-LANTAI (split-facade F3): muka depan lantai idx genap = hero, ganjil
 * = accent ("podium vs atas"), sisi lain = base — menggantikan alternasi
 * `i % 2` datar lintas lantai yang lama. Dinding INTERIOR (menempel ruang
 * solid lain) dilewati — key-nya tak pernah dirender sebagai fasad.
 */
export function buildFacadePreset(
  layout: DesignLayout,
  presetId: string,
  frontSide: SideId,
  existingFacade?: Record<string, string>
): { facade: Record<string, string>; facadeElements: FacadeElement[] } {
  const preset = facadePresetById(presetId) ?? FACADE_PRESETS[0]
  const facade: Record<string, string> = {}
  const facadeElements: FacadeElement[] = []

  const walledRooms = layout.rooms.filter((r) => !OPEN_TYPES.includes(r.type))
  const floorOrder = new Map(
    [...layout.floors]
      .filter((f) => f.id !== "floor-rooftop")
      .sort((a, b) => a.level - b.level)
      .map((f, idx) => [f.id, idx]),
  )
  walledRooms.forEach((room) => {
    const others = walledRooms.filter(
      (o) => o.id !== room.id && o.floorId === room.floorId,
    )
    const openNeighborOf = (side: SideId) =>
      layout.rooms.find(
        (o) =>
          o.id !== room.id &&
          o.floorId === room.floorId &&
          OPEN_TYPES.includes(o.type) &&
          roomsAdjacentOnSide(room, side, [o]) !== null,
      )
    const floorIdx = floorOrder.get(room.floorId) ?? 0
    for (const side of SIDES) {
      // Dinding interior (menempel ruang solid lain) tak pernah dirender
      // sebagai fasad — jangan mengotori map dengan key mati.
      if (roomsAdjacentOnSide(room, side, others)) continue
      // Dinding menghadap ruang terbuka yang SUDAH di-clad manual (mis.
      // dinding courtyard) dipertahankan — preset tidak menimpanya.
      if (existingFacade && openNeighborOf(side)) {
        const kept = facadeKeysForWall(existingFacade, room.id, side)
        if (kept.length > 0) {
          for (const key of kept) facade[key] = existingFacade[key]
          continue
        }
      }
      facade[`${room.id}:${side}`] =
        side === frontSide
          ? floorIdx % 2 === 0
            ? preset.hero
            : preset.accent
          : preset.base
    }
  })

  if (preset.louverFinish) {
    const frontLen = (r: (typeof walledRooms)[number]) =>
      frontSide === "n" || frontSide === "s" ? r.width : r.depth
    const byFloor = new Map<string, (typeof walledRooms)[number]>()
    for (const r of walledRooms) {
      const cur = byFloor.get(r.floorId)
      if (!cur || frontLen(r) > frontLen(cur)) byFloor.set(r.floorId, r)
    }
    for (const [floorId, room] of byFloor) {
      const len = frontLen(room)
      if (len < 1) continue
      facadeElements.push({
        id: `fe-${presetId}-${room.id}`,
        wallId: `${room.id}:${frontSide}`,
        floorId,
        kind: "louver_band",
        positionM: Math.round((len / 2) * 100) / 100,
        widthM: Math.round(Math.max(0.8, len - 0.4) * 100) / 100,
        sillHeightM: 0.9,
        heightM: 1.4,
        finish: preset.louverFinish,
      })
    }
  }

  return { facade, facadeElements }
}
