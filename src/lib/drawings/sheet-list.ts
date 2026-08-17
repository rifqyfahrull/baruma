/**
 * THE shared "Gambar Kerja" sheet enumeration — single source of truth for
 * both the `/drawings` page (interactive tabs) and the drawings-pack PDF
 * (`defaultSheets`), killing the SP2-era duplication between the two.
 *
 * Order (ids/numbering are e2e-gated — do not change):
 *   1. "Rencana Tapak"                         SP-01
 *   2. "Denah — <lantai>" per floor            D-01…
 *   3. 4 tampak  n/s/e/w                       A-01…A-04
 *   4. 2 potongan secA/secB                    A-05…A-06 (cut position via `Cuts`)
 *   5. "Rencana Kusen — <lantai>" per floor    K-01…
 *      "Daftar Kusen", then one entry per pre-built "Detail Kusen" panel
 *   6. "Pola Lantai — <lantai>" per floor      L-01…
 *   7. "Rencana Plafon — <lantai>" per floor   C-01…
 *   8. "Rencana Listrik — <lantai>" per floor  E-01…
 *   9. "Rencana Air — <lantai>" per floor      P-01…
 *  10. "Diagram Riser"                         P-R
 *  11. "Detail Septic Tank" / "Detail Sumur    S-01…S-03
 *      Resapan" / "Detail Bak Kontrol"
 *  12. "Rencana Pondasi"                       F-01
 *      "Rencana Kolom — <lantai>" per floor     SK-01… (K- is the kusen prefix)
 *      "Rencana Balok — <lantai>" per floor     B-01…
 *      "Perhitungan Struktur"                   ST-01
 *  13. "Detail Atap"                           R-01 (always last)
 *
 * Every entry carries what BOTH consumers need: a stable `id` (the page
 * renders testid `sheet-tab-<id>`), a UI `label`, the printed `sheetNo`, a
 * `kind` discriminator, and a `build(layout, interiors, cuts)` closure that
 * produces the renderer-agnostic `Drawing`. Builders that don't need
 * interiors (elevations, sections, kusen) or cuts simply ignore those args —
 * the interiors array may be empty (the pure builders all have fallbacks).
 */
import type { DesignLayout, Floor, RoomInteriorPlan } from "@/types"
import { round2 } from "@/lib/geometry"
import { buildElevation, effectiveRoof } from "./elevation"
import { effectiveRoofCatchmentArea } from "@/lib/exterior/roof-zones"
import { openToSkyRoofHoleAreaM2 } from "@/lib/geometry/roof-holes"
import { buildSection } from "./section"
import { buildKusenPlan } from "./kusen-plan"
import { buildLayoutSheet } from "./layout-sheet"
import { buildSitePlan } from "./site-plan"
import { buildKusenScheduleDrawing, buildKusenDetails } from "./kusen-sheets"
import { buildFloorPatternPlan } from "./floor-pattern"
import { buildCeilingPlan } from "./ceiling-plan"
import { buildElectricalPlan } from "./electrical-plan"
import { buildPlumbingPlan } from "./plumbing-plan"
import { buildRiserDiagram } from "./riser-diagram"
import { buildSepticDetail, buildSoakwellDetail, buildControlBoxDetail } from "./sanitation-detail"
import { buildFoundationPlan, buildColumnPlan, buildBeamPlan } from "./structural-plan"
import { buildStructuralCalc } from "./structural-calc"
import { buildRoofDetail } from "./roof-detail"
import { buildPoolPiping } from "./pool-piping"
import { buildPoolDetail } from "./pool-detail"
import type { Drawing } from "./types"

const ROOFTOP_FLOOR_ID = "floor-rooftop"

/** Section-cut positions (meters) for the potongan A-A / B-B sheets. */
export type Cuts = { cutX: number; cutY: number }

export type SheetKind =
  | "site-plan"
  | "denah"
  | "elevation"
  | "section"
  | "kusen-plan"
  | "kusen-daftar"
  | "kusen-detail"
  | "floor-pattern"
  | "ceiling"
  | "electrical"
  | "plumbing"
  | "riser"
  | "sanitation-detail"
  | "structural-plan"
  | "structural-calc"
  | "roof-detail"

export type SheetListEntry = {
  /** Stable id — the page renders it as `data-testid="sheet-tab-<id>"`. */
  id: string
  label: string
  sheetNo: string
  kind: SheetKind
  build: (layout: DesignLayout, interiors: RoomInteriorPlan[], cuts: Cuts) => Drawing
}

/** Zero-padded sheet number, e.g. `sheetNo("K", 1)` → "K-01". */
function sheetNo(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(2, "0")}`
}

/** The regular (non-rooftop) floors, sorted by level — one plan sheet each. */
function regularFloors(layout: DesignLayout): Floor[] {
  return layout.floors
    .filter((f) => f.id !== ROOFTOP_FLOOR_ID)
    .slice()
    .sort((a, b) => a.level - b.level)
}

/**
 * Storey count the columns stack under — the `floors` arg the SP6 structural
 * builders take (semantically `Project.floors`, i.e. the regular storeys). The
 * rooftop pseudo-floor never carries structure, so it is excluded (same
 * `regularFloors` set the plan sheets use). Min 1 so a single-storey layout
 * still loads one floor's worth of load takedown.
 */
function storeyCount(layout: DesignLayout): number {
  return Math.max(1, regularFloors(layout).length)
}

/**
 * Roof-catchment area (m²) fed to the sanitation soakwell detail. Resolved from
 * the LAYOUT alone — `buildSheetList` has no `Project.site`, so the footprint
 * comes from the non-rooftop room bounding box, exactly the source
 * `buildRoofDetail` uses to size its span (and the same bbox the page/PDF use
 * for cut bounds). The area formula matches the RAB roof line (SP3 Global
 * Constraints): datar = footprint × 1.1; sloped = footprint × (1/cos slope) ×
 * 1.15, via the clamped `effectiveRoof` reader.
 */
function roofAreaOf(layout: DesignLayout): number {
  if (layout.roofZones?.length) return effectiveRoofCatchmentArea(layout)

  const roof = effectiveRoof(layout)
  const rooms = layout.rooms.filter((r) => r.floorId !== ROOFTOP_FLOOR_ID)
  const totalW = rooms.reduce((m, r) => Math.max(m, r.x + r.width), 0)
  const totalD = rooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0)
  // Courtyard openToSky terbuka ke langit — bukan bidang atap (selaras RAB).
  const footprint = Math.max(0, totalW * totalD - openToSkyRoofHoleAreaM2(layout))
  return round2(
    roof.type === "datar"
      ? footprint * 1.1
      : footprint * (1 / Math.cos((roof.slopeDeg * Math.PI) / 180)) * 1.15
  )
}

/**
 * Builds the full, dynamic sheet list. `kusenDetails` may be passed in
 * (rather than rebuilt here) so callers can memoize the array once and share
 * it with this list — omitted, it is built from the layout.
 */
export function buildSheetList(
  layout: DesignLayout,
  kusenDetails: Drawing[] = buildKusenDetails(layout)
): SheetListEntry[] {
  const entries: SheetListEntry[] = [
    {
      id: "site-plan",
      label: "Rencana Tapak",
      sheetNo: "SP-01",
      kind: "site-plan",
      build: (l) => buildSitePlan(l),
    },
    // Denah arsitektur per lantai — sheet pertama paket (D-01..); kini
    // menggambar tangga+NAIK, railing balkon, kanopi carport, louver band.
    ...layout.floors
      .filter((f) => f.id !== ROOFTOP_FLOOR_ID)
      .map((floor, i) => ({
        id: `denah-${floor.id}`,
        label: `Denah — ${floor.name}`,
        sheetNo: `D-${String(i + 1).padStart(2, "0")}`,
        kind: "denah" as const,
        build: (l: DesignLayout) => buildLayoutSheet(l, floor.id),
      })),
    { id: "n", label: "Tampak Utara", sheetNo: "A-01", kind: "elevation", build: (l) => buildElevation(l, "n") },
    { id: "s", label: "Tampak Selatan", sheetNo: "A-02", kind: "elevation", build: (l) => buildElevation(l, "s") },
    { id: "e", label: "Tampak Timur", sheetNo: "A-03", kind: "elevation", build: (l) => buildElevation(l, "e") },
    { id: "w", label: "Tampak Barat", sheetNo: "A-04", kind: "elevation", build: (l) => buildElevation(l, "w") },
    {
      id: "secA",
      label: "Potongan A-A",
      sheetNo: "A-05",
      kind: "section",
      build: (l, _i, cuts) => buildSection(l, { axis: "x", positionM: cuts.cutX }),
    },
    {
      id: "secB",
      label: "Potongan B-B",
      sheetNo: "A-06",
      kind: "section",
      build: (l, _i, cuts) => buildSection(l, { axis: "y", positionM: cuts.cutY }),
    },
  ]

  const floors = regularFloors(layout)
  let kNum = 1

  for (const floor of floors) {
    entries.push({
      id: `kusen-${floor.id}`,
      label: `Rencana Kusen — ${floor.name}`,
      sheetNo: sheetNo("K", kNum++),
      kind: "kusen-plan",
      build: (l) => buildKusenPlan(l, floor.id),
    })
  }

  entries.push({
    id: "kusen-daftar",
    label: "Daftar Kusen",
    sheetNo: sheetNo("K", kNum++),
    kind: "kusen-daftar",
    build: (l) => buildKusenScheduleDrawing(l),
  })

  kusenDetails.forEach((drawing, i) => {
    entries.push({
      id: `kusen-detail-${i}`,
      label: drawing.title,
      sheetNo: sheetNo("K", kNum++),
      kind: "kusen-detail",
      build: () => drawing,
    })
  })

  floors.forEach((floor, i) => {
    entries.push({
      id: `floor-pattern-${floor.id}`,
      label: `Pola Lantai — ${floor.name}`,
      sheetNo: sheetNo("L", i + 1),
      kind: "floor-pattern",
      build: (l, interiors) => buildFloorPatternPlan(l, interiors, floor.id),
    })
  })

  floors.forEach((floor, i) => {
    entries.push({
      id: `ceiling-${floor.id}`,
      label: `Rencana Plafon — ${floor.name}`,
      sheetNo: sheetNo("C", i + 1),
      kind: "ceiling",
      build: (l, interiors) => buildCeilingPlan(l, interiors, floor.id),
    })
  })

  floors.forEach((floor, i) => {
    entries.push({
      id: `electrical-${floor.id}`,
      label: `Rencana Listrik — ${floor.name}`,
      sheetNo: sheetNo("E", i + 1),
      kind: "electrical",
      build: (l, interiors) => buildElectricalPlan(l, interiors, floor.id),
    })
  })

  // SP5 water/sanitation — after electrical, before roof-detail (last):
  // per-floor "Rencana Air" (P-0n) → one "Diagram Riser" (P-R) → three
  // land-level sanitation details (S-01…S-03). The soakwell detail needs the
  // roof-catchment area; it is resolved per-build from the same layout the
  // roof-detail entry reads (`roofAreaOf`) — the septic builder keeps roofArea
  // in its signature for parity but ignores it, the control-box builder takes
  // only the layout.
  floors.forEach((floor, i) => {
    entries.push({
      id: `plumbing-${floor.id}`,
      label: `Rencana Air — ${floor.name}`,
      sheetNo: sheetNo("P", i + 1),
      kind: "plumbing",
      build: (l, interiors) => buildPlumbingPlan(l, interiors, floor.id),
    })
  })

  entries.push({
    id: "riser",
    label: "Diagram Riser",
    sheetNo: "P-R",
    kind: "riser",
    build: (l) => buildRiserDiagram(l),
  })

  entries.push(
    ...(layout.rooms.some((r) => r.type === "kolam")
      ? [{
          id: "pool-piping" as const,
          label: "Denah Pipa Kolam",
          sheetNo: "P-K1",
          kind: "riser" as const,
          build: (l: DesignLayout) => buildPoolPiping(l),
        }, {
          id: "pool-detail" as const,
          label: "Detail Kolam",
          sheetNo: "P-K2",
          kind: "riser" as const,
          build: (l: DesignLayout) => buildPoolDetail(l),
        }]
      : []),
  )

  entries.push({
    id: "sanitation-septic",
    label: "Detail Septic Tank",
    sheetNo: "S-01",
    kind: "sanitation-detail",
    build: (l) => buildSepticDetail(l, roofAreaOf(l)),
  })
  entries.push({
    id: "sanitation-soakwell",
    label: "Detail Sumur Resapan",
    sheetNo: "S-02",
    kind: "sanitation-detail",
    build: (l) => buildSoakwellDetail(l, roofAreaOf(l)),
  })
  entries.push({
    id: "sanitation-control",
    label: "Detail Bak Kontrol",
    sheetNo: "S-03",
    kind: "sanitation-detail",
    build: (l) => buildControlBoxDetail(l),
  })

  // SP6 structure — after the sanitation details (S-), before roof-detail
  // (last): one foundation plan (F-01), a column plan (K-0n) + a beam plan
  // (B-0n) per regular floor, and the calc sheet (ST-01). `storeyCount(l)` is
  // the load-takedown floor count (regular storeys, rooftop excluded); it is
  // resolved per-build from the same layout the builders read, exactly like
  // `roofAreaOf` feeds the sanitation soakwell.
  entries.push({
    id: "structural-foundation",
    label: "Rencana Pondasi",
    sheetNo: "F-01",
    kind: "structural-plan",
    build: (l) => buildFoundationPlan(l, storeyCount(l)),
  })

  let kolomNum = 1
  for (const floor of floors) {
    entries.push({
      id: `structural-column-${floor.id}`,
      label: `Rencana Kolom — ${floor.name}`,
      // SK = Struktur Kolom — NOT "K" (already the SP2 kusen prefix; a shared
      // "K-01" would collide in the printed sheet index).
      sheetNo: sheetNo("SK", kolomNum++),
      kind: "structural-plan",
      build: (l) => buildColumnPlan(l, storeyCount(l), floor.id),
    })
  }

  let balokNum = 1
  for (const floor of floors) {
    entries.push({
      id: `structural-beam-${floor.id}`,
      label: `Rencana Balok — ${floor.name}`,
      sheetNo: sheetNo("B", balokNum++),
      kind: "structural-plan",
      build: (l) => buildBeamPlan(l, storeyCount(l), floor.id),
    })
  }

  entries.push({
    id: "structural-calc",
    label: "Perhitungan Struktur",
    sheetNo: "ST-01",
    kind: "structural-calc",
    build: (l) => buildStructuralCalc(l, storeyCount(l)),
  })

  entries.push({
    id: "roof-detail",
    label: "Detail Atap",
    sheetNo: "R-01",
    kind: "roof-detail",
    build: (l) => buildRoofDetail(l),
  })

  return entries
}
