import { describe, it, expect } from "vitest"

import { generateRAB } from "@/lib/mock/rab"
import { kusenSchedule, kusenPrice } from "@/lib/drawings/kusen"
import { formatDimensions } from "@/lib/format"
import { buildingFootprintArea, deriveColumnGrid } from "@/lib/structural/grid"
import {
  deckAreaM2,
  deckPerimeterM,
  isPartialRooftop,
  roofStripsAreaM2,
} from "@/lib/geometry/rooftop"
import { occupantsOf, sizeSepticTank, sizeSoakwell, wetRoomCountOf } from "@/lib/water/sanitation"
import { makeLayout, sampleBrief, sampleProject } from "@/test-utils/fixtures"
import type {
  DesignLayout,
  ElectricalPoint,
  Floor,
  Opening,
  RoofSpec,
  Room,
  RoomInteriorPlan,
  WaterPoint,
} from "@/types"

const opening = (over: Partial<Opening>): Opening => ({
  id: "o",
  floorId: "floor-1",
  wallId: "r1:s",
  type: "door",
  positionM: 1,
  widthM: 0.9,
  heightM: 2.1,
  ...over,
})

/** `makeLayout()` plus a handful of door/window openings, so `kusenSchedule`
 *  produces real KusenType rows for the RAB kusen-line tests below. */
function layoutWithOpenings(): DesignLayout {
  return {
    ...makeLayout(),
    openings: [
      opening({ id: "d1", floorId: "floor-1", wallId: "r1:s", type: "door", widthM: 0.9, heightM: 2.1 }),
      opening({ id: "d2", floorId: "floor-1", wallId: "r2:s", type: "door", widthM: 0.9, heightM: 2.1 }),
      opening({ id: "w1", floorId: "floor-1", wallId: "r1:n", type: "window", widthM: 1.2, heightM: 1.2 }),
    ],
  }
}

describe("generateRAB", () => {
  it("BOQ items sum to the mid estimate", () => {
    const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
    const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
    expect(rab.summary.midIDR).toBe(sum)
    expect(rab.items.length).toBeGreaterThan(5)
  })

  it("low < mid < high", () => {
    const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
    expect(rab.summary.lowIDR).toBeLessThan(rab.summary.midIDR)
    expect(rab.summary.midIDR).toBeLessThan(rab.summary.highIDR)
  })

  it("premium finishing costs more than standar", () => {
    const std = generateRAB(sampleProject, sampleBrief, makeLayout(), "standar")
    const prem = generateRAB(sampleProject, sampleBrief, makeLayout(), "premium")
    expect(prem.summary.midIDR).toBeGreaterThan(std.summary.midIDR)
  })

  it("adds rooftop line items when the project has a rooftop", () => {
    const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
    expect(rab.items.some((i) => i.category === "rooftop")).toBe(true)
  })

  describe("furnishing lines (furnitur ↔ RAB)", () => {
    function furnishedLayout(): DesignLayout {
      const interiors = [
        {
          roomId: "r1",
          roomName: "Ruang Tamu",
          furniture: [
            // katalog berharga
            { id: "f1", name: "Sofa 3 Seat", category: "seating", priceRange: { low: 4_000_000, mid: 5_000_000, high: 7_000_000 } },
            // custom + override per-instance
            { id: "f2", name: "Kursi Kustom", category: "seating", priceRange: { low: 0, mid: 0, high: 0 }, priceOverrideIDR: 2_000_000, modelAssetId: "asset-1" },
            // custom TANPA harga → excluded eksplisit, bukan Rp 0
            { id: "f3", name: "Patung Kustom", category: "decor", priceRange: { low: 0, mid: 0, high: 0 }, modelAssetId: "asset-2" },
          ],
        },
      ] as unknown as RoomInteriorPlan[]
      return { ...makeLayout(), interiors }
    }

    it("furniture berharga masuk kategori furnishing dengan sourceElementIds", () => {
      const rab = generateRAB(sampleProject, sampleBrief, furnishedLayout())
      const line = rab.items.find((i) => i.category === "furnishing")
      expect(line).toBeDefined()
      expect(line!.totalIDR).toBe(7_000_000) // 5jt katalog + 2jt override
      expect(line!.volume).toBe(2)
      expect(line!.sourceElementIds).toEqual(expect.arrayContaining(["f1", "f2"]))
      expect(line!.sourceElementIds).not.toContain("f3")
    })

    it("furniture tanpa harga TIDAK dihitung dan tercatat sebagai assumption", () => {
      const rab = generateRAB(sampleProject, sampleBrief, furnishedLayout())
      expect(
        rab.assumptions.some((a) => a.includes("Patung Kustom") && a.includes("belum dihargai"))
      ).toBe(true)
    })

    it("tanpa furniture: tidak ada kategori furnishing sama sekali", () => {
      const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
      expect(rab.items.some((i) => i.category === "furnishing")).toBe(false)
    })

    it("summary tetap reconcile dengan furnishing di dalamnya", () => {
      const rab = generateRAB(sampleProject, sampleBrief, furnishedLayout())
      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })
  })

  describe("rooftop lines (SP7 deck rebase)", () => {
    const rooftopFloor: Floor = { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 3 }
    const waterproofing = (l: DesignLayout) =>
      generateRAB(sampleProject, sampleBrief, l).items.find(
        (i) => i.item === "Waterproofing & finishing rooftop"
      )
    const railing = (l: DesignLayout) =>
      generateRAB(sampleProject, sampleBrief, l).items.find(
        (i) => i.item === "Railing pengaman rooftop"
      )
    const roofLine = (l: DesignLayout) =>
      generateRAB(sampleProject, sampleBrief, l).items.find((i) => i.item.startsWith("Atap "))

    /** 8×6 footprint, a rooftop floor, and a 4×3 partial deck at (2,1). */
    function partialRooftopLayout(roof?: RoofSpec): DesignLayout {
      return {
        ...makeLayout(),
        floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 }, rooftopFloor],
        rooms: [
          { id: "A", floorId: "floor-1", name: "A", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 },
          { id: "B", floorId: "floor-1", name: "B", type: "kamar_tidur", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 },
        ],
        roof: roof ?? { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
        rooftopArea: { x: 2, y: 1, width: 4, depth: 3 },
      }
    }

    it("full rooftop bills the BUILDING FOOTPRINT deck, not the lot (lot→footprint rebase)", () => {
      // makeLayout() carries no floor-rooftop, but sampleProject.rooftop is set,
      // so the block falls back to the building footprint (19.5 m²). PREVIOUSLY
      // this line billed the whole lot `project.site.areaM2` = 64 m²; the SP7/SP6
      // rebase drops it to the building footprint, so the number CHANGED 64→19.5.
      const wp = waterproofing(makeLayout())
      expect(wp).toBeDefined()
      expect(wp!.unit).toBe("m²")
      expect(wp!.volume).toBe(buildingFootprintArea(makeLayout())) // 19.5, not 64
      expect(wp!.volume).not.toBe(sampleProject.site.areaM2) // no longer the lot
      // Railing rebased from the lot perimeter (2·(8+8)=32 m) to the footprint
      // perimeter (2·(6.5+3.0)=19 m).
      expect(railing(makeLayout())!.volume).toBe(19)
    })

    it("full rooftop WITH a floor-rooftop bills deckAreaM2 = buildingFootprintArea", () => {
      // A real full-deck rooftop: floor-rooftop present, no rooftopArea.
      const l: DesignLayout = { ...partialRooftopLayout(), rooftopArea: undefined }
      expect(isPartialRooftop(l)).toBe(false)
      expect(waterproofing(l)!.volume).toBe(deckAreaM2(l)) // = buildingFootprintArea = 48
      expect(waterproofing(l)!.volume).toBe(48)
    })

    it("partial rooftop: roof line = Σ strip area × slope factor", () => {
      const l = partialRooftopLayout() // pelana 30° over the 36 m² of strips
      expect(isPartialRooftop(l)).toBe(true)
      expect(roofStripsAreaM2(l)).toBe(36)
      const item = roofLine(l)
      expect(item).toBeDefined()
      // 36 × (1/cos30°) × 1.15 = 36 × 1.154700… × 1.15 = 47.8046… → round1 47.8.
      expect(item!.volume).toBe(47.8)
      expect(item!.unit).toBe("m²")
    })

    it("partial rooftop: waterproofing = deck area, railing = deck perimeter", () => {
      const l = partialRooftopLayout()
      expect(deckAreaM2(l)).toBe(12) // 4 × 3
      expect(deckPerimeterM(l)).toBe(14) // 2 × (4 + 3)
      expect(waterproofing(l)!.volume).toBe(12)
      expect(railing(l)!.volume).toBe(14)
    })

    it("summary.midIDR still reconciles to Σ items for a partial rooftop", () => {
      const rab = generateRAB(sampleProject, sampleBrief, partialRooftopLayout())
      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })

    it("partial rooftop: soakwell sizes off the FULL-footprint catchment, matching the S-02 sheet", () => {
      // Rain falls on the deck too and drains to the same soakwell, so the
      // catchment must stay the full building footprint (sheet-list roofAreaOf's
      // source), NOT shrink to the strips-only roof-material area.
      const l = partialRooftopLayout() // footprint 48 m², strips 36 m², pelana 30°
      const rab = generateRAB(sampleProject, sampleBrief, l)
      const soakwellItem = rab.items.find((i) => i.item.toLowerCase().includes("resapan"))
      expect(soakwellItem).toBeDefined()
      // catchment = 48 × (1/cos30°) × 1.15 = 63.7 (round1) — the strips-only
      // material area would be 47.8; the note must carry the 63.7 catchment.
      expect(soakwellItem!.notes).toContain("63.7")
      expect(soakwellItem!.notes).not.toContain("47.8")
    })
  })

  it("no longer includes the generic 'Kusen, pintu & jendela' line item", () => {
    const rab = generateRAB(sampleProject, sampleBrief, layoutWithOpenings())
    expect(rab.items.some((i) => i.item === "Kusen, pintu & jendela")).toBe(false)
  })

  it("adds one BOQ line per KusenType, priced via kusenPrice(type, w, h, finishing)", () => {
    const layout = layoutWithOpenings()
    const rab = generateRAB(sampleProject, sampleBrief, layout)
    const finishing = sampleBrief.building.finishingLevel
    const schedule = kusenSchedule(layout)
    expect(schedule.length).toBeGreaterThan(0)

    for (const t of schedule) {
      const label = t.openingType === "door" ? "Pintu" : "Jendela"
      const expectedItemName = `Kusen ${t.code} — ${label} ${formatDimensions(t.widthM, t.heightM)}`
      const item = rab.items.find((i) => i.item === expectedItemName)
      expect(item).toBeDefined()

      const price = kusenPrice(t.openingType, t.widthM, t.heightM, finishing)
      expect(item!.category).toBe("arsitektur")
      expect(item!.volume).toBe(t.count)
      expect(item!.unit).toBe("unit")
      expect(item!.unitPriceIDR).toBe(price)
      expect(item!.totalIDR).toBe(price * t.count)
      expect(item!.confidence).toBe("high")
    }
  })

  it("summary.midIDR still reconciles to the sum of items with kusen lines included", () => {
    const rab = generateRAB(sampleProject, sampleBrief, layoutWithOpenings())
    const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
    expect(rab.summary.midIDR).toBe(sum)
  })

  describe("electrical lines (SP4)", () => {
    // 10 placed points + interiors carrying 4 + 2 = 6 lamp fixtures.
    const electrical: ElectricalPoint[] = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      roomId: "r1",
      type: "stopkontak" as const,
      x: 1,
      y: 1,
    }))
    const interiors = [
      { roomId: "r1", lighting: [{ type: "downlight", qty: 4 }, { type: "downlight", qty: 2 }] },
    ] as unknown as RoomInteriorPlan[]

    function electricalLayout(): DesignLayout {
      return { ...makeLayout(), electrical, interiors }
    }

    it("'Instalasi titik listrik' volume = electrical count + Σ lighting qty (titik)", () => {
      const rab = generateRAB(sampleProject, sampleBrief, electricalLayout())
      const item = rab.items.find((i) => i.item === "Instalasi titik listrik")
      expect(item).toBeDefined()
      expect(item!.volume).toBe(16) // 10 points + (4 + 2) lamps
      expect(item!.unit).toBe("titik")
    })

    it("'Panel, MCB & grounding' note mentions the circuit count + MCB", () => {
      const rab = generateRAB(sampleProject, sampleBrief, electricalLayout())
      const item = rab.items.find((i) => i.item === "Panel, MCB & grounding")
      expect(item).toBeDefined()
      // floor-1: penerangan (6 lamps) + stopkontak (10 points) = 2 circuits.
      expect(item!.notes).toContain("2 sirkuit")
      expect(item!.notes).toContain("MCB")
    })

    it("summary.midIDR still reconciles to Σ items with real electrical volume", () => {
      const rab = generateRAB(sampleProject, sampleBrief, electricalLayout())
      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })

    it("falls back to an area estimate (not the '1 titik' floor) when nothing electrical is modeled", () => {
      // makeLayout() has no `electrical`/`interiors` → modeled count is 0.
      const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
      const item = rab.items.find((i) => i.item === "Instalasi titik listrik")
      const builtArea = makeLayout().rooms.reduce((s, r) => s + r.areaM2, 0)
      expect(item!.volume).toBeCloseTo(Math.round(builtArea * 0.6 * 10) / 10, 1)
      expect(item!.volume).toBeGreaterThan(1)
      // panel note must not read "0 sirkuit" for an unmodeled project.
      const panel = rab.items.find((i) => i.item === "Panel, MCB & grounding")
      expect(panel!.notes).not.toContain("0 sirkuit")
      expect(panel!.notes).toContain("Panel utama")
    })
  })

  describe("roof line (SP3)", () => {
    const roofItem = (layout: DesignLayout) =>
      generateRAB(sampleProject, sampleBrief, layout).items.find((i) =>
        i.item.startsWith("Atap ")
      )

    it("no longer includes the generic 'Atap (rangka + penutup)' line item", () => {
      const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
      expect(rab.items.some((i) => i.item === "Atap (rangka + penutup)")).toBe(false)
    })

    it("pelana 30° on the building footprint (SP6), genteng beton: area 25.9 m² × Rp400rb", () => {
      // SP6: roof area now covers the BUILDING footprint (bbox of non-rooftop
      // rooms), not the whole lot. makeLayout() rooms r1(0.5,0.5,3×3) +
      // r2(4,0.5,3×3) → bbox 6.5×3.0 → buildingFootprintArea 19.5 m².
      // Sloped area = 19.5 × (1/cos30°) × 1.15 = 19.5 × 1.1547005… × 1.15
      // = 25.89416… → round1 = 25.9. total = 25.9 × 400,000 = 10,360,000.
      const layout: DesignLayout = {
        ...makeLayout(),
        roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      }
      const item = roofItem(layout)
      expect(item).toBeDefined()
      expect(item!.item).toBe("Atap Pelana — Genteng Beton (rangka + penutup)")
      expect(item!.category).toBe("arsitektur")
      expect(item!.volume).toBe(25.9)
      expect(item!.unit).toBe("m²")
      expect(item!.unitPriceIDR).toBe(400_000)
      expect(item!.totalIDR).toBe(10_360_000)
      expect(item!.confidence).toBe("medium")
    })

    it("absent roof defaults to datar + genteng beton: area = buildingFootprint 19.5 × 1.1 = 21.5 m²", () => {
      // makeLayout() has no `roof` — effectiveRoof falls back to datar defaults.
      // SP6: datar area = buildingFootprintArea(19.5) × 1.1 = 21.45 → round1
      // = 21.5. total = 21.5 × 400,000 = 8,600,000 (was 70.4 m²/28,160,000
      // when the lot area 64 m² drove it).
      const item = roofItem(makeLayout())
      expect(item).toBeDefined()
      expect(item!.item).toBe("Atap Datar — Genteng Beton (rangka + penutup)")
      expect(item!.volume).toBe(21.5)
      expect(item!.unit).toBe("m²")
      expect(item!.unitPriceIDR).toBe(400_000)
      expect(item!.totalIDR).toBe(8_600_000)
      expect(item!.confidence).toBe("medium")
    })

    it("clamps an out-of-range slope to 40° and prices the chosen material", () => {
      // slope 60 → clamped 40. SP6 building footprint 19.5 m²:
      // 19.5 × (1/cos40°) × 1.15 = 19.5 × 1.3054072… × 1.15 = 29.27375… → 29.3.
      // total = 29.3 × 350,000 = 10,255,000.
      const layout: DesignLayout = {
        ...makeLayout(),
        roof: { type: "limasan", slopeDeg: 60, overhangM: 0.5, material: "metal" },
      }
      const item = roofItem(layout)
      expect(item).toBeDefined()
      expect(item!.item).toBe("Atap Limasan — Metal (rangka + penutup)")
      expect(item!.volume).toBe(29.3)
      expect(item!.unitPriceIDR).toBe(350_000)
      expect(item!.totalIDR).toBe(10_255_000)
    })

    it("summary.midIDR reconciles to Σ items with the material-priced roof line", () => {
      const layout: DesignLayout = {
        ...makeLayout(),
        roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_keramik" },
      }
      const rab = generateRAB(sampleProject, sampleBrief, layout)
      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })

    it("explicit roofZones price per zone material and size sanitation from the union catchment", () => {
      const layout: DesignLayout = {
        ...makeLayout(),
        roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
        roofZones: [
          {
            id: "rz-flat",
            type: "datar",
            x: 1.5,
            y: 1.5,
            widthM: 3,
            depthM: 3,
            slopeDeg: 0,
            overhangM: 0.2,
            materialId: "genteng_beton",
          },
          {
            id: "rz-metal",
            type: "limasan",
            x: 4.5,
            y: 1.5,
            widthM: 3,
            depthM: 3,
            slopeDeg: 30,
            overhangM: 0.2,
            materialId: "metal",
          },
        ],
      }

      const rab = generateRAB(sampleProject, sampleBrief, layout)
      const roofItems = rab.items.filter((i) => i.item.startsWith("Atap zona "))

      expect(roofItems).toHaveLength(2)
      expect(rab.items.some((i) => i.item === "Atap Pelana — Genteng Beton (rangka + penutup)")).toBe(false)
      expect(roofItems.find((i) => i.item.includes("Datar"))).toMatchObject({
        volume: 9.9,
        unitPriceIDR: 400_000,
        totalIDR: 3_960_000,
        sourceElementIds: ["rz-flat"],
      })
      expect(roofItems.find((i) => i.item.includes("Limasan"))).toMatchObject({
        volume: 12,
        unitPriceIDR: 350_000,
        totalIDR: 4_200_000,
        sourceElementIds: ["rz-metal"],
      })

      const soakwell = rab.items.find((i) => i.item === "Sumur resapan")
      expect(soakwell?.notes).toContain("area tangkapan hujan 18 m²")

      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })
  })

  describe("struktur lines (SP6 real concrete volumes)", () => {
    // A layout whose non-rooftop rooms tile an 8×6 footprint from the origin —
    // the canonical grid example. deriveColumnGrid → nx3 spanX4 ny3 spanY3, 9
    // columns. builtArea = 24 + 24 = 48 m². sampleProject has floors 2.
    function struktur8x6Layout(): DesignLayout {
      return {
        ...makeLayout(),
        rooms: [
          { id: "A", floorId: "floor-1", name: "A", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 },
          { id: "B", floorId: "floor-1", name: "B", type: "kamar_tidur", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 },
        ],
      }
    }

    // HAND DERIVATION (sampleProject floors 2, σ default 150):
    //   grid: spanX 4, spanY 3, nx 3, ny 3, columnCount 9, footprint 8×6.
    //   columnLoad(4,3,2): Atrib 12, Pu = 12×(2×9.2+3.4)=12×21.8=261.6,
    //                      Ps = 12×(2×7.0+2.5)=12×16.5=198.
    //   sizeColumn(261.6): Ag=261600/8.25=31709 → √=178.07 → roundUp50 = 200 mm.
    //   sizeFooting(198,150): area=1.32 → side=roundUp(1.1489,0.1)=1.2 m, t 0.25.
    //   sizeBeam(4.0): h=roundUp50(333.3)=350, b=roundUp50(175)=200 mm.
    //   totalBeamLen = ny×W + nx×D = 3×8 + 3×6 = 42 m; sloofLen = 42 m.

    it("Pondasi telapak: 9 × side² × 0.25 = 9 × 1.44 × 0.25 = 3.24 → 3.2 m³ @ 3.5jt", () => {
      const rab = generateRAB(sampleProject, sampleBrief, struktur8x6Layout())
      const item = rab.items.find((i) => i.item === "Pondasi telapak")
      expect(item).toBeDefined()
      expect(item!.category).toBe("struktur")
      expect(item!.unit).toBe("m³")
      expect(item!.volume).toBe(3.2)
      expect(item!.unitPriceIDR).toBe(3_500_000)
      expect(item!.totalIDR).toBe(11_200_000) // 3.2 × 3,500,000
      expect(item!.confidence).toBe("medium")
      // footprint shared with the grid: 9 columns → 9 telapak in the note.
      expect(item!.notes).toContain("9 telapak")
      expect(item!.notes).toContain("1.2×1.2")
    })

    it("Kolom beton: 9 × (0.2)² × 3.0 × 2 = 9 × 0.24 = 2.16 → 2.2 m³ @ 4.5jt", () => {
      const rab = generateRAB(sampleProject, sampleBrief, struktur8x6Layout())
      const item = rab.items.find((i) => i.item === "Kolom beton")
      expect(item).toBeDefined()
      expect(item!.unit).toBe("m³")
      expect(item!.volume).toBe(2.2)
      expect(item!.unitPriceIDR).toBe(4_500_000)
      expect(item!.totalIDR).toBe(9_900_000) // 2.2 × 4,500,000
      expect(item!.notes).toContain("9 kolom")
      expect(item!.notes).toContain("200×200 mm")
    })

    it("Balok & sloof: (0.2×0.35×42) + (0.15×0.2×42) = 2.94 + 1.26 = 4.2 m³ @ 4.5jt", () => {
      const rab = generateRAB(sampleProject, sampleBrief, struktur8x6Layout())
      const item = rab.items.find((i) => i.item === "Balok & sloof")
      expect(item).toBeDefined()
      expect(item!.unit).toBe("m³")
      expect(item!.volume).toBe(4.2)
      expect(item!.unitPriceIDR).toBe(4_500_000)
      expect(item!.totalIDR).toBe(18_900_000) // 4.2 × 4,500,000
      expect(item!.notes).toContain("200×350 mm")
    })

    it("Plat lantai: builtArea 48 × 0.12 = 5.76 → 5.8 m³ @ 3.8jt", () => {
      const rab = generateRAB(sampleProject, sampleBrief, struktur8x6Layout())
      const item = rab.items.find((i) => i.item === "Plat lantai")
      expect(item).toBeDefined()
      expect(item!.unit).toBe("m³")
      expect(item!.volume).toBe(5.8)
      expect(item!.unitPriceIDR).toBe(3_800_000)
      expect(item!.totalIDR).toBe(22_040_000) // 5.8 × 3,800,000
    })

    it("footprint shared: grid column count = telapak count in the Pondasi line", () => {
      const layout = struktur8x6Layout()
      expect(deriveColumnGrid(layout).columns.length).toBe(9)
      const rab = generateRAB(sampleProject, sampleBrief, layout)
      const item = rab.items.find((i) => i.item === "Pondasi telapak")
      expect(item!.notes).toContain("9 telapak")
    })

    it("drops the old %-of-budget struktur line items (rebased to volume)", () => {
      const rab = generateRAB(sampleProject, sampleBrief, struktur8x6Layout())
      const names = rab.items.map((i) => i.item)
      expect(names).not.toContain("Pondasi & sloof")
      expect(names).not.toContain("Kolom & balok beton")
      expect(names).not.toContain("Plat lantai & tangga")
    })

    it("summary.midIDR reconciles to Σ items with the volume-based struktur lines", () => {
      const rab = generateRAB(sampleProject, sampleBrief, struktur8x6Layout())
      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })
  })

  describe("plumbing lines (SP5 water + sanitation)", () => {
    // 12 placed water points → real "titik air" count.
    const water: WaterPoint[] = Array.from({ length: 12 }, (_, i) => ({
      id: `w${i}`,
      roomId: "r1",
      type: "kran" as const,
      x: 1,
      y: 1,
    }))
    function waterLayout(): DesignLayout {
      return { ...makeLayout(), water }
    }
    // Four bedrooms → occupantsOf = max(4, 4×2) = 8 → septic capacity 4.32 m³.
    function bedroomLayout(): DesignLayout {
      return {
        ...makeLayout(),
        rooms: Array.from(
          { length: 4 },
          (_, i): Room => ({
            id: `kt${i}`,
            floorId: "floor-1",
            name: `Kamar ${i + 1}`,
            type: "kamar_tidur",
            x: i * 2,
            y: 0.5,
            width: 2,
            depth: 2,
            areaM2: 4,
          })
        ),
      }
    }

    it("'Instalasi titik air' volume = real layout.water count (titik)", () => {
      const rab = generateRAB(sampleProject, sampleBrief, waterLayout())
      const item = rab.items.find((i) => i.item === "Instalasi titik air")
      expect(item).toBeDefined()
      expect(item!.volume).toBe(12)
      expect(item!.unit).toBe("titik")
      expect(item!.category).toBe("plumbing")
    })

    it("no longer includes the flat 'Instalasi air bersih & kotor' line item", () => {
      const rab = generateRAB(sampleProject, sampleBrief, waterLayout())
      expect(rab.items.some((i) => i.item === "Instalasi air bersih & kotor")).toBe(false)
    })

    it("falls back to an area estimate (builtArea × 0.5, not the '1 titik' floor) when no water is modeled", () => {
      // makeLayout() has no `water` → real count is 0.
      const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
      const item = rab.items.find((i) => i.item === "Instalasi titik air")
      const builtArea = makeLayout().rooms.reduce((s, r) => s + r.areaM2, 0)
      expect(item!.volume).toBeCloseTo(Math.round(builtArea * 0.5 * 10) / 10, 1)
      expect(item!.volume).toBeGreaterThan(1)
    })

    it("keeps the bathrooms-based 'Sanitair' line", () => {
      const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
      const item = rab.items.find((i) => i.item === "Sanitair (kloset, wastafel, shower)")
      expect(item).toBeDefined()
      expect(item!.unit).toBe("set")
    })

    it("'Septic tank (SNI)' capacity reflects occupantsOf (4 bedrooms → 8 occupants → 4.32 m³)", () => {
      const layout = bedroomLayout()
      expect(occupantsOf(layout)).toBe(8)
      expect(sizeSepticTank(8).capacity).toBe(4.32)
      const rab = generateRAB(sampleProject, sampleBrief, layout)
      const item = rab.items.find((i) => i.item === "Septic tank (SNI)")
      expect(item).toBeDefined()
      expect(item!.unit).toBe("m³")
      expect(item!.volume).toBe(4.3) // toItem round1(4.32)
      expect(item!.notes).toContain("4.32")
      expect(item!.notes).toContain("8 penghuni")
      expect(item!.category).toBe("plumbing")
    })

    it("'Sumur resapan' is sized exactly from sizeSoakwell(roofArea)", () => {
      // SP6: roofArea now comes from the BUILDING footprint, not the lot.
      // makeLayout bbox 6.5×3.0 → buildingFootprintArea 19.5, roof absent →
      // datar → roofArea = round1(19.5 × 1.1) = 21.5 → sizeSoakwell(21.5):
      //   Vr = round2(21.5 × 0.05) = round2(1.075) = 1.08
      //   D  = clamp(round2(√(4×1.08/(π×2))), 0.8, 1.4)
      //      = clamp(round2(√0.68755), …) = clamp(0.83, …) = 0.83
      const roofArea = 21.5
      const sw = sizeSoakwell(roofArea)
      expect(sw.capacity).toBe(1.08)
      expect(sw.widthM).toBe(0.83)
      const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
      const item = rab.items.find((i) => i.item === "Sumur resapan")
      expect(item).toBeDefined()
      expect(item!.unit).toBe("unit")
      expect(item!.category).toBe("plumbing")
      // total = capacity × Rp1,5jt (round1k) → ties the line to the SNI sizer
      expect(item!.totalIDR).toBe(1_620_000) // 1.08 × 1,500,000
      expect(item!.notes).toContain("1.08")
      expect(item!.notes).toContain("0.83")
      expect(item!.notes).toContain("21.5")
    })

    it("'Bak kontrol' volume = wetRoomCount + 1", () => {
      const layout = makeLayout()
      const rab = generateRAB(sampleProject, sampleBrief, layout)
      const item = rab.items.find((i) => i.item === "Bak kontrol")
      expect(item).toBeDefined()
      expect(item!.volume).toBe(wetRoomCountOf(layout) + 1)
      expect(item!.unit).toBe("unit")
      expect(item!.category).toBe("plumbing")
    })

    it("summary.midIDR still reconciles to Σ items with the sanitation lines", () => {
      const rab = generateRAB(sampleProject, sampleBrief, waterLayout())
      const sum = rab.items.reduce((s, i) => s + i.totalIDR, 0)
      expect(rab.summary.midIDR).toBe(sum)
    })
  })
})

describe("baris lis fascia (band tepi atap/dak)", () => {
  it("roof.fascia aktif → 1 baris arsitektur m' dengan volume = keliling footprint", () => {
    const l: DesignLayout = {
      ...makeLayout(),
      roof: {
        type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
        fascia: { heightM: 0.35, color: "#3c4245" },
      },
    }
    const line = generateRAB(sampleProject, sampleBrief, l).items.find((i) =>
      i.item.startsWith("Lis fascia")
    )
    expect(line).toBeDefined()
    expect(line!.category).toBe("arsitektur")
    expect(line!.unit).toBe("m'")
    expect(line!.volume).toBeGreaterThan(0)
    expect(line!.totalIDR).toBe(line!.volume * 150_000)
  })

  it("tanpa roof.fascia → tidak ada baris lis fascia", () => {
    const line = generateRAB(sampleProject, sampleBrief, makeLayout()).items.find((i) =>
      i.item.startsWith("Lis fascia")
    )
    expect(line).toBeUndefined()
  })
})

describe("RAB elemen eksterior semantik", () => {
  it("adds traceable native quantities without breaking summary reconciliation", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "drive-1",
          kind: "driveway",
          structuralRole: "non_structural",
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 3 },
            { x: 0, y: 3 },
          ],
          thicknessM: 0.15,
        },
      ],
    }

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    const driveway = rab.items.find((item) => item.item === "Driveway")
    expect(driveway).toMatchObject({
      category: "arsitektur",
      volume: 12,
      unit: "m²",
      unitPriceIDR: 650_000,
      totalIDR: 7_800_000,
      sourceElementIds: ["drive-1"],
    })
    expect(rab.summary.midIDR).toBe(rab.items.reduce((sum, item) => sum + item.totalIDR, 0))
  })

  it("keeps custom assets excluded with an explicit assumption", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "asset-1",
          kind: "asset",
          label: "Pohon custom",
          structuralRole: "non_structural",
          x: 2,
          y: 2,
          widthM: 1,
          depthM: 1,
          heightM: 3,
          model: { modelUrl: "/tree.glb", fitMode: "fit_envelope" },
        },
      ],
    }

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    expect(rab.items.some((item) => item.sourceElementIds?.includes("asset-1"))).toBe(false)
    expect(rab.assumptions.some((text) => text.includes("asset-1") && text.includes("Custom GLB"))).toBe(true)
  })

  it("honors explicit exterior costing exclusion without removing the design element", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "drive-excluded",
          kind: "driveway",
          label: "Driveway konsep",
          structuralRole: "non_structural",
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 2 },
            { x: 0, y: 2 },
          ],
          thicknessM: 0.12,
          costing: { includeInRab: false },
        },
      ],
    }

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    expect(rab.items.some((item) => item.sourceElementIds?.includes("drive-excluded"))).toBe(false)
    expect(
      rab.assumptions.some(
        (text) =>
          text.includes("drive-excluded") && text.includes("dikecualikan dari RAB"),
      ),
    ).toBe(true)
  })

  it("costs semantic garden beds as low-confidence landscape work", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "garden-1",
          kind: "garden_bed",
          structuralRole: "non_structural",
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 2 },
            { x: 0, y: 2 },
          ],
          thicknessM: 0.1,
        },
      ],
    }

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    expect(rab.items.find((item) => item.sourceElementIds?.includes("garden-1"))).toMatchObject({
      category: "arsitektur",
      item: "Planting bed",
      volume: 8,
      unit: "m²",
      unitPriceIDR: 250_000,
      totalIDR: 2_000_000,
    })
  })

  it("costs semantic tree assets by unit without costing generic custom GLB assets", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "tree-1",
          kind: "tree",
          label: "Pohon peneduh",
          structuralRole: "non_structural",
          x: 2,
          y: 2,
          widthM: 1.2,
          depthM: 1.2,
          heightM: 3,
          model: { modelUrl: null, fitMode: "fit_envelope" },
        },
        {
          id: "asset-manual",
          kind: "asset",
          label: "Patung custom",
          structuralRole: "non_structural",
          x: 4,
          y: 2,
          widthM: 1,
          depthM: 1,
          heightM: 1,
          model: { modelUrl: "/custom.glb", fitMode: "fit_envelope" },
        },
      ],
    }

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    expect(rab.items.find((item) => item.sourceElementIds?.includes("tree-1"))).toMatchObject({
      item: "Pohon peneduh",
      unit: "unit",
      unitPriceIDR: 1_500_000,
    })
    expect(rab.items.some((item) => item.sourceElementIds?.includes("asset-manual"))).toBe(false)
  })

  it("does not cost custom assets even when a stale policy tries to include them", () => {
    const layout: DesignLayout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "asset-stale-policy",
          kind: "asset",
          label: "Facade import",
          structuralRole: "non_structural",
          x: 2,
          y: 2,
          widthM: 4,
          depthM: 0.5,
          heightM: 3,
          model: { modelUrl: "/facade.glb", fitMode: "fit_envelope" },
          costing: { includeInRab: true },
        },
      ],
    }

    const rab = generateRAB(sampleProject, sampleBrief, layout)
    expect(rab.items.some((item) => item.sourceElementIds?.includes("asset-stale-policy"))).toBe(false)
    expect(
      rab.assumptions.some(
        (text) => text.includes("asset-stale-policy") && text.includes("Custom GLB"),
      ),
    ).toBe(true)
  })
})

describe("stair lines (tangga interior → RAB)", () => {
  function stairLayout(): DesignLayout {
    const base = makeLayout()
    return {
      ...base,
      rooms: [
        ...base.rooms,
        {
          ...base.rooms[0],
          id: "room-stair",
          name: "Tangga",
          type: "tangga",
          x: 1,
          y: 1,
          width: 2.5,
          depth: 1.0,
          areaM2: 2.5,
          stairDirection: "e",
        },
      ],
    }
  }

  it("tangga interior menghasilkan 3 line item struktur dengan sourceElementIds", () => {
    const rab = generateRAB(sampleProject, sampleBrief, stairLayout())
    const beton = rab.items.find((i) => i.item.includes("Beton tangga"))
    const finish = rab.items.find((i) => i.item.includes("Finishing tangga"))
    const railing = rab.items.find((i) => i.item.includes("Railing tangga"))
    expect(beton).toBeDefined()
    expect(beton!.category).toBe("struktur")
    expect(beton!.unit).toBe("m³")
    expect(beton!.sourceElementIds).toEqual(["room-stair"])
    expect(beton!.notes).toContain("review struktur")
    expect(finish!.unit).toBe("m²")
    expect(railing!.unit).toBe("m")
  })

  it("tanpa room tangga → tidak ada item tangga", () => {
    const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
    expect(rab.items.some((i) => i.item.includes("tangga"))).toBe(false)
  })

  it("summary tetap reconcile", () => {
    const rab = generateRAB(sampleProject, sampleBrief, stairLayout())
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
  })
})


describe("stair lines — tangga bentuk L (Gelombang 2)", () => {
  it("dengan item railing (2 sisi tiap run + bordes), notes menyebut bordes", () => {
    const base = makeLayout()
    const layoutL: DesignLayout = {
      ...base,
      rooms: [
        ...base.rooms,
        { ...base.rooms[0], id: "room-stair", name: "Tangga", type: "tangga",
          x: 1, y: 1, width: 3, depth: 2.5, areaM2: 7.5,
          stairDirection: "e", stairShape: "L", stairTurn: "kanan" },
      ],
    }
    const rab = generateRAB(sampleProject, sampleBrief, layoutL)
    expect(rab.items.some((i) => i.item.includes("Railing tangga"))).toBe(true)
    expect(rab.items.find((i) => i.item.includes("Beton tangga"))!.notes).toContain("bordes")
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
  })
})

describe("RAB struktur kolam per m³ (KL-5)", () => {
  function poolLayout(): DesignLayout {
    const base = makeLayout()
    return { ...base, rooms: [...base.rooms, { ...base.rooms[0], id: "room-pool",
      name: "Kolam", type: "kolam", x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
      poolKind: "renang", poolFinish: "mozaik_hijau" }] }
  }

  it("item lama m² kasar hilang; lima item terukur muncul dengan sourceElementIds", () => {
    const rab = generateRAB(sampleProject, sampleBrief, poolLayout())
    expect(rab.items.some((i) => i.item === "Struktur & waterproofing kolam")).toBe(false)
    // avg renang default 1.5; keliling 24; area 32
    const beton = rab.items.find((i) => i.item.includes("Beton bertulang kolam"))!
    expect(beton).toBeDefined()
    expect(beton.unit).toBe("m³")
    expect(beton.volume).toBeCloseTo(24 * (1.5 + 0.15) * 0.2 + 32 * 0.2, 1) // 14.3
    expect(beton.sourceElementIds).toEqual(["room-pool"])
    expect(beton.notes).toContain("review struktur")
    const galian = rab.items.find((i) => i.item.includes("Galian"))!
    expect(galian.volume).toBeCloseTo(32 * (1.5 + 0.25) * 1.1, 1) // 61.6
    const wp = rab.items.find((i) => i.item.includes("Waterproofing area basah"))!
    expect(wp.volume).toBeCloseTo(32 + 24 * 1.5, 1) // 68
    const finish = rab.items.find((i) => i.item.includes("Finishing kolam"))!
    expect(finish.item).toContain("Mozaik hijau")
    expect(rab.items.some((i) => i.item.includes("Coping"))).toBe(true)
  })

  it("summary tetap reconcile", () => {
    const rab = generateRAB(sampleProject, sampleBrief, poolLayout())
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
  })
})

describe("RAB overflow — balancing tank + gutter (KL-4)", () => {
  it("overflow: item balancing tank (m³) + gutter (m); skimmer-only tidak", () => {
    const base = makeLayout()
    const overflowLayout: DesignLayout = { ...base, rooms: [...base.rooms,
      { ...base.rooms[0], id: "room-pool", name: "Kolam", type: "kolam",
        x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang",
        poolCirculationType: "overflow" }] }
    const rab = generateRAB(sampleProject, sampleBrief, overflowLayout)
    expect(rab.items.some((i) => i.item.includes("Balancing tank"))).toBe(true)
    expect(rab.items.some((i) => i.item.includes("Gutter"))).toBe(true)
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))

    const skimmerLayout: DesignLayout = { ...base, rooms: [...base.rooms,
      { ...base.rooms[0], id: "room-pool", name: "Kolam", type: "kolam",
        x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" }] }
    const rab2 = generateRAB(sampleProject, sampleBrief, skimmerLayout)
    expect(rab2.items.some((i) => i.item.includes("Balancing tank"))).toBe(false)
  })
})

describe("RAB spa — jet/heater/chlorinator (KL-7)", () => {
  it("spa dengan opsi: tiga item ekstra + reconcile; tanpa opsi tidak", () => {
    const base = makeLayout()
    const spaLayout: DesignLayout = { ...base, rooms: [...base.rooms,
      { ...base.rooms[0], id: "room-spa", name: "Spa", type: "kolam",
        x: 1, y: 1, width: 2, depth: 2, areaM2: 4, poolKind: "spa",
        poolHasJets: true, poolHeater: true, poolSaltChlorinator: true }] }
    const rab = generateRAB(sampleProject, sampleBrief, spaLayout)
    expect(rab.items.some((i) => i.item.includes("Jet/blower spa"))).toBe(true)
    expect(rab.items.some((i) => i.item.includes("Pemanas kolam"))).toBe(true)
    expect(rab.items.some((i) => i.item.includes("Salt chlorinator"))).toBe(true)
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))

    const plain: DesignLayout = { ...base, rooms: [...base.rooms,
      { ...base.rooms[0], id: "room-spa2", name: "Spa", type: "kolam",
        x: 1, y: 1, width: 2, depth: 2, areaM2: 4, poolKind: "spa" }] }
    const rab2 = generateRAB(sampleProject, sampleBrief, plain)
    expect(rab2.items.some((i) => i.item.includes("Jet/blower"))).toBe(false)
  })
})

describe("builtArea kejujuran — kecualikan ruang luar (WS-D §4a)", () => {
  // Taman ditaruh DI DALAM bbox r1+r2 (x 0.5–7, y 0.5–3.5) supaya
  // buildingFootprintArea (atap/struktur, bbox SEMUA ruang termasuk luar —
  // lihat buildingFootprint di structural/grid.ts, tak disentuh perbaikan
  // ini) tidak ikut berubah; hanya builtArea (isOutdoorRoom-filtered, dasar
  // slab/lantai/plafon/cat/finishing) yang diuji di sini.
  function layoutWithGarden(): DesignLayout {
    const base = makeLayout()
    return {
      ...base,
      rooms: [
        ...base.rooms,
        { id: "taman-1", floorId: "floor-1", name: "Taman", type: "taman", x: 1, y: 1, width: 1, depth: 1, areaM2: 1 },
      ],
    }
  }

  it("rab.areaM2 = luas ruang tertutup saja (r1 9 + r2 9 = 18), taman 1 m² dikecualikan", () => {
    const rab = generateRAB(sampleProject, sampleBrief, layoutWithGarden())
    expect(rab.areaM2).toBe(18)
  })

  it("SEBELUM ada ruang luar, angka tetap seperti semula (18) — perbaikan ini non-invasif untuk layout tanpa taman/kolam/carport/balkon/rooftop_lounge/void", () => {
    const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
    expect(rab.areaM2).toBe(18)
  })

  it("Plat lantai (slab) ikut mengecualikan taman: 18 × 0.12 = 2.16 → round1 2.2 m³", () => {
    const rab = generateRAB(sampleProject, sampleBrief, layoutWithGarden())
    const slab = rab.items.find((i) => i.item === "Plat lantai")
    expect(slab).toBeDefined()
    expect(slab!.volume).toBe(2.2)
  })

  it("footprint atap TIDAK berubah oleh taman di dalam bbox rumah (magnitude: hanya builtArea yang bergeser, bukan geometri atap/struktur)", () => {
    const withGarden = generateRAB(sampleProject, sampleBrief, layoutWithGarden())
    const without = generateRAB(sampleProject, sampleBrief, makeLayout())
    const roofOf = (rab: typeof withGarden) => rab.items.find((i) => i.item.startsWith("Atap "))
    expect(roofOf(withGarden)!.volume).toBe(roofOf(without)!.volume)
  })

  it("summary.midIDR tetap reconcile dengan taman di layout", () => {
    const rab = generateRAB(sampleProject, sampleBrief, layoutWithGarden())
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
  })
})
