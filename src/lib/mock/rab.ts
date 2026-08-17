/**
 * Generates a believable RAB/BOQ from a layout (PRD §10.8). The total budget
 * (built area × finishing rate) is allocated across categories by typical
 * residential shares, then split into line items so the BOQ sums to the summary.
 */
import type {
  Brief,
  BOQItem,
  Confidence,
  CostCategory,
  DesignLayout,
  FinishingLevel,
  PoolFinish,
  Project,
  RAB,
} from "@/types"
import { FINISHING_LEVELS, ROOF_MATERIALS, ROOF_PRICES, ROOF_TYPES } from "@/lib/constants"
import { effectiveRoof } from "@/lib/drawings/elevation"
import {
  isUnpricedFurniture,
  resolvedFurniturePriceRange,
} from "@/lib/interior/plan"
import {
  effectiveRoofCatchmentArea,
  effectiveRoofZones,
  hasExplicitRoofZones,
  roofZoneMaterialArea,
} from "@/lib/exterior/roof-zones"
import {
  deckAreaM2,
  deckPerimeterM,
  isPartialRooftop,
  roofStripsAreaM2,
} from "@/lib/geometry/rooftop"
import { openToSkyRoofHoleAreaM2 } from "@/lib/geometry/roof-holes"
import { floorElevations, stairRiseM } from "@/lib/geometry/vertical"
import { kusenSchedule, kusenPrice } from "@/lib/drawings/kusen"
import { buildCircuits } from "@/lib/electrical/circuits"
import { computeElectricalCosting } from "@/lib/electrical/costing"
import { effectiveLamps } from "@/lib/three/lamps"
import { SLAB_T, WALL_H } from "@/lib/three/build-model"
import { interiorStairLayout, interiorStairQuantitiesFromLayout, interiorStairSpec } from "@/lib/stairs/geometry"
import { poolCirculation } from "@/lib/three/pool-circulation"
import { POOL_FINISHES, effectivePoolDepthRange, effectivePoolFinish } from "@/lib/three/pool"
import { poolElectrical } from "@/lib/three/pool-electrical"
import { formatDimensions } from "@/lib/format"
import {
  buildingFootprint,
  buildingFootprintArea,
  deriveColumnGrid,
} from "@/lib/structural/grid"
import { columnLoad } from "@/lib/structural/takedown"
import { sizeColumn, sizeBeam } from "@/lib/structural/sizing"
import { sizeFooting } from "@/lib/structural/foundation"
import { computeExteriorWallArea, computeInternalWallArea } from "@/lib/exterior/quantities"
import { SOIL_DEFAULT_KPA } from "@/lib/structural/loads"
import { exteriorElementQuantities } from "@/lib/exterior/quantities"
import { exteriorRateFor } from "@/lib/exterior/rates"
import {
  occupantsOf,
  sizeControlBoxes,
  sizeSepticTank,
  sizeSoakwell,
  wetRoomCountOf,
} from "@/lib/water/sanitation"

function round1k(n: number): number {
  return Math.round(n / 1000) * 1000
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

type Spec = {
  category: CostCategory
  item: string
  volume: number
  unit: string
  total: number
  confidence: Confidence
  notes?: string
  sourceElementIds?: string[]
}

function toItem(spec: Spec, i: number): BOQItem {
  const volume = round1(spec.volume) || 1
  const total = round1k(spec.total)
  return {
    id: `${spec.category}-${i}`,
    category: spec.category,
    item: spec.item,
    volume,
    unit: spec.unit,
    unitPriceIDR: round1k(total / volume),
    totalIDR: total,
    confidence: spec.confidence,
    notes: spec.notes,
    sourceElementIds: spec.sourceElementIds,
  }
}

export function generateRAB(
  project: Project,
  brief: Brief,
  layout: DesignLayout,
  finishingOverride?: FinishingLevel
): RAB {
  const finishing = finishingOverride ?? brief.building.finishingLevel
  const perM2 = FINISHING_LEVELS[finishing].perM2IDR

  const builtArea = round1(
    layout.rooms.reduce((sum, r) => sum + r.areaM2, 0)
  ) || project.site.areaM2 * project.floors

  const floors = project.floors
  const poolRooms = layout.rooms.filter((r) => r.type === "kolam")
  const poolArea = poolRooms.reduce((s, r) => s + r.areaM2, 0)
  const bathrooms = layout.rooms.filter((r) => r.type === "kamar_mandi").length || 1

  const base = builtArea * perM2 // mid estimate for the core house

  // Exterior + internal partition wall quantities per floor. Perimeter
  // (union luar, ruang terbuka dikecualikan) dan partisi (adjacency riil
  // antar ruang dalam) sama-sama dari geometri asli — tidak ada lagi baris
  // "Dinding bata & plester" sintetis berbasis builtArea × multiplier.
  const wallItems: Spec[] = []
  for (const floor of layout.floors) {
    const roomsOnFloor = layout.rooms.filter((r) => r.floorId === floor.id)
    if (roomsOnFloor.length === 0) continue
    const wallHeight = floor.heightM ?? 3.0

    const exteriorArea = computeExteriorWallArea(roomsOnFloor, wallHeight, 0.15)
    if (exteriorArea > 0) {
      const brickVol = exteriorArea * 0.12 // 12 cm thick brick
      const plasterArea = exteriorArea * 2 // both sides
      const paintArea = exteriorArea * 2 // both sides

      wallItems.push(
        {
          category: "arsitektur",
          item: `Dinding luar bata (lantai ${floor.level}) — t=12 cm`,
          volume: round1(brickVol),
          unit: "m³",
          total: brickVol * 1_200_000, // ~Rp1.2jt/m³ terpasang
          confidence: "medium",
          notes: `Tinggi dinding ${wallHeight} m, luas ${round1(exteriorArea)} m² (dikurangi bukaan 15%)`,
        },
        {
          category: "arsitektur",
          item: `Plesteran dinding luar (lantai ${floor.level}) — 2 sisi`,
          volume: round1(plasterArea),
          unit: "m²",
          total: plasterArea * 65_000, // ~Rp65k/m²
          confidence: "medium",
        },
        {
          category: "finishing",
          item: `Cat dinding luar (lantai ${floor.level}) — 2 sisi`,
          volume: round1(paintArea),
          unit: "m²",
          total: paintArea * 35_000, // ~Rp35k/m²
          confidence: "medium",
        }
      )
    }

    const internalArea = computeInternalWallArea(roomsOnFloor, wallHeight, 0.15)
    if (internalArea > 0) {
      const brickVol = internalArea * 0.12
      const plasterArea = internalArea * 2
      const paintArea = internalArea * 2

      wallItems.push(
        {
          category: "arsitektur",
          item: `Dinding partisi dalam (lantai ${floor.level}) — t=12 cm`,
          volume: round1(brickVol),
          unit: "m³",
          total: brickVol * 1_200_000,
          confidence: "medium",
          notes: `Tinggi dinding ${wallHeight} m, luas ${round1(internalArea)} m² dari sekat antar-ruang (dikurangi bukaan 15%)`,
        },
        {
          category: "arsitektur",
          item: `Plesteran dinding dalam (lantai ${floor.level}) — 2 sisi`,
          volume: round1(plasterArea),
          unit: "m²",
          total: plasterArea * 65_000,
          confidence: "medium",
        },
        {
          category: "finishing",
          item: `Cat dinding dalam (lantai ${floor.level}) — 2 sisi`,
          volume: round1(paintArea),
          unit: "m²",
          total: paintArea * 35_000,
          confidence: "medium",
        }
      )
    }
  }

  // Roof line: material-priced from `layout.roof` (clamped via `effectiveRoof`
  // — slope 15–40°, overhang 0–1 m; absent roof = datar + genteng_beton).
  // Roof area per SP3 Global Constraints: datar = footprint × 1.1; sloped =
  // footprint × (1/cos(slopeDeg)) × 1.15. Rounded to 0.1 m² first so
  // volume × unit price reconciles exactly in `toItem`.
  //
  // SP6: the roof plane covers the BUILDING footprint (bbox of the non-rooftop
  // rooms — the shared `buildingFootprintArea`), NOT the whole lot
  // (`project.site.areaM2`). This resolves the SP3 overstatement where a small
  // house on a big lot was billed a lot-sized roof; the grid, the drawing
  // sheets and this RAB now all agree on the covered area. SP7 rebases the
  // rooftop lines onto the deck too (below), so the whole-lot area no longer
  // drives any RAB line — pool lines bill the pool room area directly.
  // SP7 partial rooftop: when the deck only covers part of the footprint, the
  // roof material bills the ROOFED STRIPS only (`footprint − deck`); the deck's
  // own area is billed by the rooftop waterproofing line below. Full-rooftop and
  // non-rooftop layouts are unchanged — they bill the whole building footprint.
  // Courtyard openToSky = terbuka ke langit → tidak ada material atap di
  // situ (jalur roofZones eksplisit otomatis benar — cincin tak menutup
  // lubang; jalur legacy/deck dikurangi eksplisit).
  const courtyardHoleArea = openToSkyRoofHoleAreaM2(layout)
  const roofFootprintArea = Math.max(
    0,
    (isPartialRooftop(layout)
      ? roofStripsAreaM2(layout)
      : buildingFootprintArea(layout)) - courtyardHoleArea,
  )
  const roof = effectiveRoof(layout)
  const roofSlopeFactor =
    roof.type === "datar" ? 1.1 : (1 / Math.cos((roof.slopeDeg * Math.PI) / 180)) * 1.15
  const roofArea = round1(roofFootprintArea * roofSlopeFactor)
  const roofLineSpecs: Spec[] = hasExplicitRoofZones(layout)
    ? Array.from(
        effectiveRoofZones(layout).reduce((groups, zone) => {
          const key = `${zone.type}:${zone.materialId}`
          const existing = groups.get(key) ?? {
            type: zone.type,
            material: zone.materialId,
            area: 0,
            ids: [] as string[],
          }
          existing.area += roofZoneMaterialArea(zone)
          existing.ids.push(zone.id)
          groups.set(key, existing)
          return groups
        }, new Map<string, { type: typeof roof.type; material: typeof roof.material; area: number; ids: string[] }>())
      ).map(([, group]): Spec => {
        const area = round1(group.area)
        return {
          category: "arsitektur",
          item: `Atap zona ${ROOF_TYPES[group.type]} — ${ROOF_MATERIALS[group.material]} (rangka + penutup)`,
          volume: area,
          unit: "m²",
          total: area * ROOF_PRICES[group.material],
          confidence: "medium",
          notes: `${group.ids.length} zona atap eksplisit.`,
          sourceElementIds: group.ids,
        }
      })
    : [
        {
          category: "arsitektur",
          item: `Atap ${ROOF_TYPES[roof.type]} — ${ROOF_MATERIALS[roof.material]} (rangka + penutup)`,
          volume: roofArea,
          unit: "m²",
          total: roofArea * ROOF_PRICES[roof.material],
          confidence: "medium",
        },
      ]
  // Rainwater CATCHMENT is the whole building footprint (rain falls on the deck
  // too and drains to the same soakwell), so it deliberately does NOT shrink to
  // the strips-only material area for a partial rooftop — this keeps the RAB
  // soakwell in lockstep with the S-02 detail sheet (`sheet-list.ts` roofAreaOf).
  // Hujan yang jatuh ke courtyard meresap langsung di halaman dalam — bukan
  // beban talang/resapan atap.
  const roofCatchmentArea = round1(
    Math.max(
      0,
      (hasExplicitRoofZones(layout)
        ? effectiveRoofCatchmentArea(layout)
        : buildingFootprintArea(layout) * roofSlopeFactor) -
        courtyardHoleArea,
    ),
  )

  // Electrical: REAL point count = placed points + total lamp fixtures (qty).
  // `layout.interiors` carries the resolved room plans WHEN present; reads are
  // defensive (the layout PUT has no zod and interiors may be absent — then the
  // lamp portion is simply 0 and volume falls back to the placed-point count).
  const electricalPoints = Array.isArray(layout.electrical) ? layout.electrical.length : 0
  let lampCount = 0
  for (const plan of layout.interiors ?? []) {
    for (const fx of plan?.lighting ?? []) {
      const qty = typeof fx?.qty === "number" && Number.isFinite(fx.qty) ? fx.qty : 0
      if (qty > 0) lampCount += qty
    }
  }
  // When nothing electrical is modeled yet (fresh project — no placed points,
  // no resolved interiors), fall back to the area-based estimate so the RAB
  // shows a believable figure instead of the generic "1 titik" volume-floor.
  // Once the user places points the real count takes over.
  const modeledTitik = electricalPoints + lampCount
  const electricalTitik = modeledTitik > 0 ? modeledTitik : round1(builtArea * 0.6)

  // Rincian biaya kelistrikan (titik/kabel/panel/unit lampu + energi bulanan)
  // dari engine costing — lampu eksterior (effectiveLamps) ikut dihitung.
  const elCosting = computeElectricalCosting(
    layout,
    layout.interiors ?? [],
    effectiveLamps(layout)
  )

  // Circuits across every floor → panel note (circuit count + total MCB, one
  // MCB per circuit plus the main MCB).
  const circuitCount = layout.floors.reduce(
    (n, f) => n + buildCircuits(layout, layout.interiors ?? [], f.id).length,
    0
  )
  const panelNote =
    circuitCount > 0
      ? `${circuitCount} sirkuit, ${circuitCount + 1} MCB (termasuk MCB utama).`
      : "Panel utama + MCB per grup (penerangan & stopkontak)."

  // Water: REAL placed water-point count (`layout.water`). Defensive read —
  // the layout PUT has no zod. When nothing is modeled yet (fresh project) fall
  // back to an area-based estimate (builtArea × 0.5) so the RAB shows a
  // believable figure instead of the generic "1 titik" volume-floor — mirrors
  // the electrical titik fallback above.
  const waterCount = Array.isArray(layout.water) ? layout.water.length : 0
  const waterTitik = waterCount > 0 ? waterCount : round1(builtArea * 0.5)

  // Land-level sanitation sizing (SNI approach, SP5 Task 3). Septic sizes off
  // the occupant count only; the soakwell sizes off `roofCatchmentArea` (the
  // FULL building-footprint roof area — the same source the S-02 detail sheet's
  // `roofAreaOf` uses), NOT the strips-only material `roofArea`, so a partial
  // rooftop never under-sizes the soakwell (rain on the deck drains there too).
  const occupants = occupantsOf(layout)
  const septic = sizeSepticTank(occupants)
  const soakwell = sizeSoakwell(roofCatchmentArea)
  const controlBoxes = sizeControlBoxes(wetRoomCountOf(layout))
  // Pre-round the septic volume (like every other RAB line) so displayed
  // volume × unit price reconciles to `total` exactly; the precise SNI capacity
  // stays in the notes.
  const septicVol = round1(septic.capacity)

  // Structure (SP6): REAL concrete volumes from the pure structural modules
  // (grid → takedown → sizing → foundation), replacing the old 3 %-of-budget
  // lines. These CALL the same functions the drawing sheets use — never
  // re-derive the formulas — so RAB and the sheets always agree. All columns
  // share the full-bay tributary (conservative simplification from
  // `columnLoad`), so the pad / column / beam sections are uniform and the
  // volume scales by the grid column count.
  const grid = deriveColumnGrid(layout)
  const sigmaKPa = layout.structural?.soilBearingKPa ?? SOIL_DEFAULT_KPA
  const load = columnLoad(grid.spanX, grid.spanY, floors)
  const column = sizeColumn(load.Pu)
  const footing = sizeFooting(load.Ps, sigmaKPa)
  // Governing beam sized off the X-span (documented pin — one representative
  // section for the whole grid; keeps the BOQ a single believable line).
  const beam = sizeBeam(grid.spanX)
  const columnCount = grid.columns.length
  const STOREY_HEIGHT_M = 3.0 // storey height for column concrete volume

  // Beam / sloof grid length ≈ ny bands across the width + nx bands across the
  // depth of the shared building footprint; the sloof follows the same grid.
  const fp = buildingFootprint(layout)
  const totalBeamLenM = grid.ny * fp.widthM + grid.nx * fp.depthM
  const sloofLenM = totalBeamLenM

  // Pondasi telapak: columnCount × (side² × thickness) m³.
  const footingVol = round1(columnCount * footing.side * footing.side * footing.thickness)
  // Kolom beton: columnCount × (side_m)² × storey height × floors m³.
  const columnVol = round1(columnCount * (column.side / 1000) ** 2 * STOREY_HEIGHT_M * floors)
  // Balok & sloof: (b_m × h_m × beamLen) + (0.15 × 0.20 × sloofLen) m³.
  const beamVol = round1(
    (beam.b / 1000) * (beam.h / 1000) * totalBeamLenM + 0.15 * 0.2 * sloofLenM
  )
  // Plat lantai: built floor area × 12 cm slab thickness m³.
  const slabVol = round1(builtArea * 0.12)

  const specs: Spec[] = [
    ...wallItems,
    // Struktur — real concrete volumes (SP6). Unit m³, prices patoked per m³.
    {
      category: "struktur",
      item: "Pondasi telapak",
      volume: footingVol,
      unit: "m³",
      total: footingVol * 3_500_000,
      confidence: "medium",
      notes: `${columnCount} telapak ${footing.side}×${footing.side}×${footing.thickness} m dari σ ${sigmaKPa} kPa (Ps ${load.Ps} kN).${footing.deepNote ? ` ${footing.deepNote}.` : ""}`,
    },
    {
      category: "struktur",
      item: "Kolom beton",
      volume: columnVol,
      unit: "m³",
      total: columnVol * 4_500_000,
      confidence: "medium",
      notes: `${columnCount} kolom ${column.side}×${column.side} mm × ${floors} lantai (Pu ${load.Pu} kN).`,
    },
    {
      category: "struktur",
      item: "Balok & sloof",
      volume: beamVol,
      unit: "m³",
      total: beamVol * 4_500_000,
      confidence: "medium",
      notes: `Balok ${beam.b}×${beam.h} mm + sloof 150×200 mm, ~${round1(totalBeamLenM)} m grid.`,
    },
    {
      category: "struktur",
      item: "Plat lantai",
      volume: slabVol,
      unit: "m³",
      total: slabVol * 3_800_000,
      confidence: "medium",
      notes: `Plat beton t=12 cm seluas ${builtArea} m² lantai.`,
    },
    // Arsitektur ~22% — dinding bata/plester kini dari `wallItems` (geometri
    // riil: perimeter luar + partisi dalam), bukan builtArea × multiplier.
    ...kusenSchedule(layout).map(
      (t): Spec => ({
        category: "arsitektur",
        item: `Kusen ${t.code} — ${t.openingType === "door" ? "Pintu" : "Jendela"} ${formatDimensions(t.widthM, t.heightM)}`,
        volume: t.count,
        unit: "unit",
        total: kusenPrice(t.openingType, t.widthM, t.heightM, finishing) * t.count,
        confidence: "high",
      })
    ),
    ...roofLineSpecs,
    // Lis fascia (band tepi atap/dak) — hanya bila diaktifkan di editor atap.
    // Volume = keliling footprint bangunan (m'); harga GRC/kalsiplank terpasang
    // + finis cat per meter lari.
    ...(roof.fascia
      ? (() => {
          const fp = buildingFootprint(layout)
          const runM = round1(2 * (fp.widthM + fp.depthM))
          return [
            {
              category: "arsitektur",
              item: `Lis fascia tepi atap/dak — t. ${roof.fascia.heightM.toFixed(2)} m (GRC/kalsiplank + cat)`,
              volume: runM,
              unit: "m'",
              total: runM * 150_000,
              confidence: "medium",
            } satisfies Spec,
          ]
        })()
      : []),
    // Finishing ~28%
    {
      category: "finishing",
      item: "Lantai (keramik/granit)",
      volume: builtArea,
      unit: "m²",
      total: base * 0.28 * 0.4,
      confidence: "medium",
      notes: `Level ${FINISHING_LEVELS[finishing].label.toLowerCase()}.`,
    },
    {
      category: "finishing",
      item: "Pengecatan",
      volume: round1(builtArea * 2.6),
      unit: "m²",
      total: base * 0.28 * 0.3,
      confidence: "medium",
    },
    {
      category: "finishing",
      item: "Plafon",
      volume: builtArea,
      unit: "m²",
      total: base * 0.28 * 0.3,
      confidence: "medium",
    },
    // Plumbing ~8% (core water lines) + land-level sanitation (SNI sizing).
    {
      category: "plumbing",
      item: "Instalasi titik air",
      volume: waterTitik,
      unit: "titik",
      total: base * 0.08 * 0.5,
      confidence: "medium",
      notes:
        waterCount > 0
          ? undefined
          : "Estimasi awal (belum ada titik air ditempatkan).",
    },
    {
      category: "plumbing",
      item: "Sanitair (kloset, wastafel, shower)",
      volume: bathrooms,
      unit: "set",
      total: base * 0.08 * 0.5,
      confidence: "medium",
    },
    {
      category: "plumbing",
      item: "Septic tank (SNI)",
      volume: septicVol,
      unit: "m³",
      // Capacity-scaled cost (~Rp2,5jt/m³ terpasang, tangki + resapan efluen).
      total: septicVol * 2_500_000,
      confidence: "medium",
      notes: `Kapasitas ${septic.capacity} m³ untuk ${occupants} penghuni (SNI 2398:2017 pendekatan).`,
    },
    {
      category: "plumbing",
      item: "Sumur resapan",
      volume: 1,
      unit: "unit",
      // Capacity-scaled cost (~Rp1,5jt/m³ volume resapan terpasang).
      total: soakwell.capacity * 1_500_000,
      confidence: "medium",
      notes: `Ø${soakwell.widthM} m, kapasitas ${soakwell.capacity} m³ dari area tangkapan hujan ${roofCatchmentArea} m² (SNI 8456 pendekatan).`,
    },
    {
      category: "plumbing",
      item: "Bak kontrol",
      volume: controlBoxes.count,
      unit: "unit",
      // Per-unit cost for a 0,4×0,4×0,5 m masonry inspection box.
      total: controlBoxes.count * 850_000,
      confidence: "medium",
      notes: `${controlBoxes.count} bak (0,4×0,4×0,5 m) — 1 per ruang basah + 1 di dekat septic.`,
    },
    // Listrik — rincian nyata dari model kelistrikan (titik, kabel, panel,
    // unit lampu, watt per fixture) saat sudah ada yang dimodelkan; fallback
    // %-estimate hanya untuk project kosong.
    ...(modeledTitik > 0 || elCosting.counts.titikLampuEksterior > 0
      ? ([
          {
            category: "listrik",
            item: "Instalasi titik listrik",
            volume:
              elCosting.counts.titikLampuInterior +
              elCosting.counts.titikLampuEksterior +
              elCosting.counts.titikStopkontak +
              elCosting.counts.titikSaklar,
            unit: "titik",
            total: elCosting.costs.instalasiTitik,
            confidence: "medium",
            notes: `${elCosting.counts.titikLampuInterior + elCosting.counts.titikLampuEksterior} titik lampu (${elCosting.counts.titikLampuEksterior} eksterior), ${elCosting.counts.titikStopkontak} stopkontak, ${elCosting.counts.titikSaklar} saklar.`,
          },
          {
            category: "listrik",
            item: "Kabel NYM + conduit",
            volume: elCosting.cable.peneranganM + elCosting.cable.stopkontakM,
            unit: "m",
            total: elCosting.costs.kabelConduit,
            confidence: "medium",
            notes: `Penerangan NYM 2×1,5 ≈ ${elCosting.cable.peneranganM} m; stopkontak/daya NYM 3×2,5 ≈ ${elCosting.cable.stopkontakM} m (estimasi jalur dari panel).`,
          },
          {
            category: "listrik",
            item: "Panel, MCB & grounding",
            volume: 1,
            unit: "ls",
            total: elCosting.costs.panelMcbGrounding,
            confidence: "medium",
            notes: `${panelNote} Beban tersambung ±${elCosting.totalVA} VA → daya PLN disarankan ${elCosting.recommendedPlnVA} VA.`,
          },
          {
            category: "listrik",
            item: "Unit lampu (LED)",
            volume:
              elCosting.counts.titikLampuInterior + elCosting.counts.titikLampuEksterior,
            unit: "bh",
            total: elCosting.costs.unitLampu,
            confidence: "medium",
            notes: `Total ±${elCosting.totalLampWatt} W. Perkiraan energi bulanan (lampu + peralatan umum: AC, kulkas, pompa air, dll.): ${elCosting.monthlyEnergy.kwh} kWh ≈ Rp ${Math.round(elCosting.monthlyEnergy.costIDR).toLocaleString("id-ID")}/bulan.`,
          },
        ] as const)
      : ([
          {
            category: "listrik",
            item: "Instalasi titik listrik",
            volume: electricalTitik,
            unit: "titik",
            total: base * 0.07 * 0.6,
            confidence: "medium",
          },
          {
            category: "listrik",
            item: "Panel, MCB & grounding",
            volume: 1,
            unit: "ls",
            total: base * 0.07 * 0.4,
            confidence: "medium",
            notes: panelNote,
          },
        ] as const)),
  ]

  // Kolam (extra). Struktur/waterproofing dari luas; MEP sirkulasi (pompa,
  // filter, pipa, fitting) di-itemize dari poolCirculation (volume→debit→pompa)
  // per kolam — sesuai spesifikasi lapangan, bukan lump-sum.
  if (poolArea > 0) {
    // Struktur kolam TERUKUR (KL-5): galian, beton m³ (dinding+lantai dari
    // dimensi & kedalaman rata-rata), waterproofing & finishing area basah,
    // coping per meter — menggantikan rate m² kasar lama.
    const POOL_EXCAVATION_IDR_M3 = 125_000
    const POOL_CONCRETE_IDR_M3 = 4_500_000
    const POOL_WP_IDR_M2 = 185_000
    const POOL_COPING_IDR_M = 275_000
    const POOL_FINISH_IDR_M2: Record<PoolFinish, number> = {
      keramik_biru: 350_000,
      mozaik_hijau: 550_000,
      pebble_gelap: 450_000,
      batu_alam: 500_000,
    }
    const POOL_WALL_T = 0.2
    const POOL_FLOOR_T = 0.2
    const POOL_FREEBOARD = 0.15
    for (const pool of poolRooms) {
      const range = effectivePoolDepthRange(pool)
      const keliling = 2 * (pool.width + pool.depth)
      const area = pool.areaM2 > 0 ? pool.areaM2 : pool.width * pool.depth
      const galianM3 = area * (range.avgM + POOL_FLOOR_T + 0.05) * 1.1
      const betonM3 =
        keliling * (range.avgM + POOL_FREEBOARD) * POOL_WALL_T + area * POOL_FLOOR_T
      const basahM2 = area + keliling * range.avgM
      const finish = effectivePoolFinish(pool)
      specs.push(
        {
          category: "kolam",
          item: `Galian & urugan kolam — ${pool.name}`,
          volume: galianM3,
          unit: "m³",
          total: galianM3 * POOL_EXCAVATION_IDR_M3,
          confidence: "low",
          sourceElementIds: [pool.id],
        },
        {
          category: "kolam",
          item: `Beton bertulang kolam (dinding+lantai) — ${pool.name}`,
          volume: betonM3,
          unit: "m³",
          total: betonM3 * POOL_CONCRETE_IDR_M3,
          confidence: "low",
          notes: "K-300, dinding & lantai t=20 cm. Perlu review struktur.",
          sourceElementIds: [pool.id],
        },
        {
          category: "kolam",
          item: `Waterproofing area basah — ${pool.name}`,
          volume: basahM2,
          unit: "m²",
          total: basahM2 * POOL_WP_IDR_M2,
          confidence: "low",
          sourceElementIds: [pool.id],
        },
        {
          category: "kolam",
          item: `Finishing kolam (${POOL_FINISHES[finish].label}) — ${pool.name}`,
          volume: basahM2,
          unit: "m²",
          total: basahM2 * POOL_FINISH_IDR_M2[finish],
          confidence: "low",
          sourceElementIds: [pool.id],
        },
        {
          category: "kolam",
          item: `Coping bibir kolam — ${pool.name}`,
          volume: keliling,
          unit: "m",
          total: keliling * POOL_COPING_IDR_M,
          confidence: "low",
          sourceElementIds: [pool.id],
        },
      )
    }
    const circ = poolRooms.map((r) => poolCirculation(r))
    const totalPumpHp = circ.reduce((s, c) => s + c.pumpHp, 0)
    const totalPipeM = circ.reduce((s, c) => s + c.estPipeM, 0)
    const totalFittings = circ.reduce((s, c) => s + c.skimmers + c.returns + c.mainDrains, 0)
    specs.push(
      {
        category: "kolam",
        item: `Pompa sirkulasi (${round1(totalPumpHp)} HP)`,
        volume: round1(totalPumpHp),
        unit: "HP",
        total: totalPumpHp * 4_500_000,
        confidence: "low",
      },
      {
        category: "kolam",
        item: "Filter pasir + media",
        volume: poolRooms.length,
        unit: "unit",
        total: poolRooms.length * 6_500_000,
        confidence: "low",
      },
      {
        category: "kolam",
        item: "Pipa sirkulasi + fitting (skimmer/inlet/drain)",
        volume: round1(totalPipeM),
        unit: "m",
        total: totalPipeM * 185_000 + totalFittings * 350_000,
        confidence: "low",
        notes: `${totalFittings} fitting`,
      }
    )
    // Overflow (KL-4): balancing tank beton + gutter keliling grating.
    const overflowPools = poolRooms.filter(
      (r) => (r.poolCirculationType ?? "skimmer") === "overflow"
    )
    if (overflowPools.length > 0) {
      const oc = overflowPools.map((r) => ({ id: r.id, c: poolCirculation(r) }))
      const totalBalancingM3 = oc.reduce((s, x) => s + x.c.balancingTankM3, 0)
      const totalGutterM = oc.reduce((s, x) => s + x.c.gutterM, 0)
      const ids = oc.map((x) => x.id)
      specs.push(
        {
          category: "kolam",
          item: "Balancing tank beton (sistem overflow)",
          volume: round1(totalBalancingM3),
          unit: "m³",
          total: totalBalancingM3 * 4_500_000,
          confidence: "low",
          notes: "±7% volume kolam, K-300. Perlu review struktur.",
          sourceElementIds: ids,
        },
        {
          category: "kolam",
          item: "Gutter keliling + grating (sistem overflow)",
          volume: round1(totalGutterM),
          unit: "m",
          total: totalGutterM * 450_000,
          confidence: "low",
          sourceElementIds: ids,
        },
      )
    }
    // Kelistrikan kolam: panel/MCB pompa + kabel, lampu bawah air + trafo,
    // pembumian ekipotensial (bonding).
    const elec = poolRooms.map((r) => poolElectrical(r))
    const poolLights = elec.reduce((s, e) => s + e.lights, 0)
    const bondingM = elec.reduce((s, e) => s + e.bondingM, 0)
    specs.push(
      {
        category: "kolam",
        item: "Panel & MCB pompa + kabel",
        volume: poolRooms.length,
        unit: "set",
        total: poolRooms.length * 2_500_000,
        confidence: "low",
      },
      {
        category: "kolam",
        item: "Lampu bawah air + trafo",
        volume: poolLights,
        unit: "titik",
        total: poolLights * 1_200_000,
        confidence: "low",
      },
      {
        category: "kolam",
        item: "Pembumian ekipotensial (bonding)",
        volume: round1(bondingM),
        unit: "m",
        total: bondingM * 95_000,
        confidence: "low",
      }
    )
    // Opsi spa (KL-7): jet/blower, pemanas, salt chlorinator — per kolam aktif.
    const jetPools = poolRooms.filter((r) => r.poolHasJets)
    if (jetPools.length > 0) {
      specs.push({
        category: "kolam", item: "Jet/blower spa", volume: jetPools.length, unit: "set",
        total: jetPools.length * 6_500_000, confidence: "low",
        sourceElementIds: jetPools.map((r) => r.id),
      })
    }
    const heaterPools = poolRooms.filter((r) => r.poolHeater)
    if (heaterPools.length > 0) {
      specs.push({
        category: "kolam", item: "Pemanas kolam (heater)", volume: heaterPools.length, unit: "unit",
        total: heaterPools.length * 8_500_000, confidence: "low",
        sourceElementIds: heaterPools.map((r) => r.id),
      })
    }
    const chlorPools = poolRooms.filter((r) => r.poolSaltChlorinator)
    if (chlorPools.length > 0) {
      specs.push({
        category: "kolam", item: "Salt chlorinator", volume: chlorPools.length, unit: "unit",
        total: chlorPools.length * 7_500_000, confidence: "low",
        sourceElementIds: chlorPools.map((r) => r.id),
      })
    }
  }

  // Rooftop (extra). SP7: the rooftop lines bill the walk-on DECK, not the whole
  // lot. Waterproofing = deck area; railing = deck perimeter; pricing (`rtBase`)
  // scales with the deck too. This both (a) prices a partial deck correctly and
  // (b) fixes the pre-existing full-rooftop overstatement where the lot area
  // (`project.site.areaM2`) / lot perimeter drove these lines instead of the
  // building footprint. `deckAreaM2`/`deckPerimeterM` return 0 only when the
  // layout carries no rooftop floor at all (e.g. a bare fixture) — fall back to
  // the building footprint so a rooftop project always bills a building-sized
  // deck, never the lot and never Rp0.
  if (project.rooftop) {
    const deckArea = deckAreaM2(layout) || buildingFootprintArea(layout)
    const deckPerimeter = deckPerimeterM(layout) || round1((fp.widthM + fp.depthM) * 2)
    const rtBase = deckArea * 1_400_000
    specs.push(
      {
        category: "rooftop",
        item: "Waterproofing & finishing rooftop",
        volume: deckArea,
        unit: "m²",
        total: rtBase * 0.6,
        confidence: "low",
      },
      {
        category: "rooftop",
        item: "Railing pengaman rooftop",
        volume: deckPerimeter,
        unit: "m",
        total: rtBase * 0.4,
        confidence: "low",
        notes: "Tinggi & material railing sesuai standar keselamatan.",
      }
    )
  }

  const exteriorExclusions: string[] = []
  for (const element of layout.exteriorElements ?? []) {
    if (element.hidden) continue
    for (const quantity of exteriorElementQuantities(element)) {
      const explicitlyExcluded = element.costing?.includeInRab === false
      const rate = exteriorRateFor(element.kind, quantity.rateId ?? element.costing?.rateId)
      if (!quantity.included || explicitlyExcluded || !rate || rate.unit !== quantity.unit) {
        exteriorExclusions.push(
          `${element.label ?? quantity.item} (${element.id}): ${quantity.exclusionReason ?? (explicitlyExcluded ? "dikecualikan dari RAB" : "rate belum tersedia")}`,
        )
        continue
      }
      specs.push({
        category: element.kind === "column" || element.kind === "beam" || element.kind === "slab" || element.kind === "portal_frame"
          ? "struktur"
          : "arsitektur",
        item: quantity.item,
        volume: quantity.qty,
        unit: quantity.unit === "m2" ? "m²" : quantity.unit === "m3" ? "m³" : quantity.unit,
        total: quantity.qty * rate.unitPriceIDR,
        confidence: rate.confidence,
        notes: `Rate ${rate.id}, efektif ${rate.effectiveDate}.${quantity.secondaryQty != null ? ` Kuantitas sekunder ${round1(quantity.secondaryQty)} ${quantity.secondaryUnit}.` : ""}`,
        sourceElementIds: [element.id],
      })
    }
  }

  // ── Furnishing (furnitur lepas dari plan interior) — kategori TERPISAH agar
  // RAB konstruksi tetap jujur. Hanya furniture berharga (katalog / harga aset
  // / override) yang dihitung; yang "belum dihargai" masuk assumptions,
  // bukan Rp 0 senyap (guardrail no-fake-cost, paritas exterior excluded).
  const unpricedFurniture: string[] = []
  for (const plan of layout.interiors ?? []) {
    const furniture = Array.isArray(plan?.furniture) ? plan.furniture : []
    const priced = furniture.filter((f) => !isUnpricedFurniture(f))
    for (const f of furniture) {
      if (isUnpricedFurniture(f)) {
        unpricedFurniture.push(`${f.name} (${plan.roomName ?? plan.roomId})`)
      }
    }
    if (!priced.length) continue
    specs.push({
      category: "furnishing",
      item: `Furnitur & dekorasi — ${plan.roomName ?? plan.roomId}`,
      volume: priced.length,
      unit: "unit",
      total: priced.reduce((s, f) => s + resolvedFurniturePriceRange(f).mid, 0),
      confidence: "low",
      notes: "Furnitur lepas (di luar biaya konstruksi bangunan).",
      sourceElementIds: priced.map((f) => f.id),
    })
  }

  // ── Tangga interior (Room type:"tangga") — beton + finishing + railing.
  // Sebelum ini tangga sama sekali tidak punya line item (hanya terhitung
  // sebagai luas lantai) — investigasi 2026-07-15 §A.3.
  const STAIR_CONCRETE_IDR_M3 = 4_500_000
  const STAIR_FINISH_IDR_M2 = 450_000
  const STAIR_RAILING_IDR_M = 950_000
  for (const room of layout.rooms.filter((r) => r.type === "tangga")) {
    const rabElev = floorElevations(layout.floors)
    const spec = interiorStairSpec(room, stairRiseM(rabElev, room.floorId))
    const stairLayout = interiorStairLayout(room, stairRiseM(rabElev, room.floorId))
    const q = interiorStairQuantitiesFromLayout(stairLayout)
    specs.push(
      {
        category: "struktur",
        item: `Beton tangga — ${room.name}`,
        volume: q.concreteM3,
        unit: "m³",
        total: q.concreteM3 * STAIR_CONCRETE_IDR_M3,
        confidence: "low",
        notes: `${spec.steps} anak${stairLayout.shape !== "lurus" ? ` bentuk ${stairLayout.shape} + bordes` : ""}, riser ${Math.round(spec.riserM * 100)} cm, pelat miring 12 cm. Perlu review struktur.`,
        sourceElementIds: [room.id],
      },
      {
        category: "finishing",
        item: `Finishing tangga (injakan+tanjakan) — ${room.name}`,
        volume: q.finishM2,
        unit: "m²",
        total: q.finishM2 * STAIR_FINISH_IDR_M2,
        confidence: "low",
        notes: "Granit/homogenous tile + step nosing anti slip.",
        sourceElementIds: [room.id],
      },
    )
    // Railing 2 sisi (lurus & L/U — lihat interiorStairQuantitiesFromLayout).
    if (q.railingM > 0) {
      specs.push({
        category: "finishing",
        item: `Railing tangga 2 sisi — ${room.name}`,
        volume: q.railingM,
        unit: "m",
        total: q.railingM * STAIR_RAILING_IDR_M,
        confidence: "low",
        notes: "Hollow/besi tempa, tinggi 90 cm.",
        sourceElementIds: [room.id],
      })
    }
  }

  const items = specs.map(toItem)
  const mid = items.reduce((s, it) => s + it.totalIDR, 0)

  return {
    projectId: project.id,
    versionId: project.currentVersionId ?? `ver-${project.id}`,
    areaM2: builtArea,
    summary: {
      lowIDR: round1k(mid * 0.88),
      midIDR: round1k(mid),
      highIDR: round1k(mid * 1.15),
      perM2IDR: round1k(mid / builtArea),
      confidence: poolArea > 0 || floors >= 3 ? "low" : "medium",
    },
    items,
    assumptions: [
      `Harga satuan mengacu rata-rata ${project.province ?? "regional"} 2026.`,
      `Level finishing: ${FINISHING_LEVELS[finishing].label}.`,
      "Belum termasuk perizinan (PBG), pajak, dan biaya tak terduga (~10%).",
      "Estimasi awal untuk diskusi — harga final perlu diverifikasi kontraktor lokal.",
      ...exteriorExclusions.map((reason) => `Elemen eksterior belum dihitung: ${reason}.`),
      ...unpricedFurniture.map(
        (name) =>
          `Furnitur belum dihargai (tidak termasuk RAB): ${name} — isi harga di inspector furniture atau metadata aset.`
      ),
    ],
  }
}
