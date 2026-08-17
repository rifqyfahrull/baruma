import { describe, it, expect } from "vitest"

import type { DesignLayout, SanitationObject } from "@/types"
import {
  occupantsOf,
  sizeSepticTank,
  sizeSoakwell,
  sizeControlBoxes,
  autoSizeSanitation,
  sanitationObstacles,
  groundFloorIds,
} from "./sanitation"
import { rectsOverlap, round2 } from "@/lib/geometry"

/** Hand-built fixture: 1 floor with kamar_mandi (wet) + dapur (wet) +
 *  2 × kamar_tidur (dry bedrooms) + void. Derived:
 *  - occupantsOf = max(4, bedroomCount 2 × 2) = 4
 *  - wetRoomCount = kamar_mandi + dapur = 2 → control boxes count 3 */
const baseLayout = (): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
  rooms: [
    { id: "r-km", floorId: "f1", name: "Kamar Mandi", type: "kamar_mandi", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-dp", floorId: "f1", name: "Dapur", type: "dapur", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 },
    { id: "r-kt1", floorId: "f1", name: "Kamar Tidur 1", type: "kamar_tidur", x: 0, y: 3, width: 3, depth: 3, areaM2: 9 },
    { id: "r-kt2", floorId: "f1", name: "Kamar Tidur 2", type: "kamar_tidur", x: 3, y: 3, width: 3, depth: 3, areaM2: 9 },
    { id: "r-vd", floorId: "f1", name: "Void", type: "void", x: 6, y: 0, width: 2, depth: 2, areaM2: 4 },
  ],
  walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
})

const SITE = { widthM: 10, depthM: 12 }
const ROOF_AREA = 70.4

describe("occupantsOf", () => {
  it("max(4, bedroomCount × 2) — 2 bedrooms → 4 (min floor still applies here)", () => {
    expect(occupantsOf(baseLayout())).toBe(4)
  })

  it("0 bedrooms hits the min-4 floor", () => {
    const l = baseLayout()
    l.rooms = l.rooms.filter((r) => r.type !== "kamar_tidur")
    expect(occupantsOf(l)).toBe(4)
  })

  it("4 bedrooms → 8; 3 bedrooms → 6 (above the floor)", () => {
    const mk = (n: number): DesignLayout => {
      const l = baseLayout()
      l.rooms = Array.from({ length: n }, (_, i) => ({
        id: `kt${i}`, floorId: "f1", name: `KT${i}`, type: "kamar_tidur" as const,
        x: 0, y: 0, width: 3, depth: 3, areaM2: 9,
      }))
      return l
    }
    expect(occupantsOf(mk(4))).toBe(8)
    expect(occupantsOf(mk(3))).toBe(6)
  })
})

describe("sizeSepticTank", () => {
  it("8 occupants → V 4.32, W 1.2, L 2.4, depth 1.8, capacity 4.32 (worked example)", () => {
    expect(sizeSepticTank(8)).toEqual({ widthM: 1.2, lengthM: 2.4, depthM: 1.8, capacity: 4.32 })
  })

  it("4 occupants → V 2.16, W 0.85, L 1.7, depth 1.8", () => {
    // Q 600, Vww 1.8, Vsludge 0.36, V 2.16, A 1.44, W round2(√0.72)=0.85, L 1.7
    expect(sizeSepticTank(4)).toEqual({ widthM: 0.85, lengthM: 1.7, depthM: 1.8, capacity: 2.16 })
  })
})

describe("sizeSoakwell", () => {
  it("roofArea 70.4 → Vr 3.52, D 1.4 (clamped from 1.5), H 2 (worked example)", () => {
    expect(sizeSoakwell(70.4)).toEqual({ widthM: 1.4, lengthM: 1.4, depthM: 2, capacity: 3.52 })
  })

  it("tiny roofArea hits the D lower bound 0.8", () => {
    const s = sizeSoakwell(1)
    // Vr 0.05, √(0.2/6.2832)=0.178 → round2 0.18 → clamp lo 0.8
    expect(s.widthM).toBe(0.8)
    expect(s.lengthM).toBe(0.8)
    expect(s.depthM).toBe(2)
    expect(s.capacity).toBe(0.05)
  })
})

describe("sizeControlBoxes", () => {
  it("wetRoomCount 3 → count 4, dims 0.4 × 0.4 × 0.5 (worked example)", () => {
    expect(sizeControlBoxes(3)).toEqual({
      count: 4,
      dims: { widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
    })
  })

  it("count = wetRoomCount + 1", () => {
    expect(sizeControlBoxes(0).count).toBe(1)
    expect(sizeControlBoxes(2).count).toBe(3)
  })
})

describe("autoSizeSanitation", () => {
  const inLot = (o: SanitationObject) => {
    expect(o.x).toBeGreaterThanOrEqual(0)
    expect(o.x).toBeLessThanOrEqual(SITE.widthM)
    expect(o.y).toBeGreaterThanOrEqual(0)
    expect(o.y).toBeLessThanOrEqual(SITE.depthM)
  }

  it("sizes the three objects with sani- ids, positioned inside the lot", () => {
    const s = autoSizeSanitation(baseLayout(), ROOF_AREA, SITE)

    expect(s.septicTank.id).toMatch(/^sani-/)
    expect(s.soakwell.id).toMatch(/^sani-/)
    for (const b of s.controlBoxes) expect(b.id).toMatch(/^sani-/)

    inLot(s.septicTank)
    inLot(s.soakwell)
    for (const b of s.controlBoxes) inLot(b)

    // Septic sized from occupants 4; soakwell from roofArea 70.4.
    expect(s.septicTank).toMatchObject({ widthM: 0.85, lengthM: 1.7, depthM: 1.8, capacity: 2.16 })
    expect(s.soakwell).toMatchObject({ widthM: 1.4, lengthM: 1.4, depthM: 2, capacity: 3.52 })

    // Default positions per Global Constraints.
    expect(s.septicTank.x).toBe(2.5) // site.widthM * 0.25
    expect(s.soakwell.x).toBe(7.5) // site.widthM * 0.75

    // wetRoomCount = kamar_mandi + dapur = 2 → 3 boxes, each 0.4 × 0.4 × 0.5.
    expect(s.controlBoxes).toHaveLength(3)
    for (const b of s.controlBoxes) {
      expect(b.widthM).toBe(0.4)
      expect(b.lengthM).toBe(0.4)
      expect(b.depthM).toBe(0.5)
    }
  })

  it("is idempotent: a 2nd call returns the existing objects and adds no duplicates", () => {
    const layout = baseLayout()
    const first = autoSizeSanitation(layout, ROOF_AREA, SITE)
    const second = autoSizeSanitation({ ...layout, sanitation: first }, ROOF_AREA, SITE)

    // Same ids come back — nothing was regenerated with a fresh nanoid.
    expect(second.septicTank).toEqual(first.septicTank)
    expect(second.soakwell).toEqual(first.soakwell)
    expect(second.controlBoxes).toEqual(first.controlBoxes)
    expect(second.controlBoxes).toHaveLength(first.controlBoxes.length)
  })

  it("does not mutate the input layout", () => {
    const layout = baseLayout()
    autoSizeSanitation(layout, ROOF_AREA, SITE)
    expect(layout.sanitation).toBeUndefined()
  })

  it("tolerates a missing rooms/sanitation shape without crashing (PUT has no zod)", () => {
    const layout = { ...baseLayout(), sanitation: undefined }
    expect(() => autoSizeSanitation(layout, ROOF_AREA, SITE)).not.toThrow()
  })

  it("reproduces the real 'Rumah Qyfa' production bug: the lot is built up edge-to-edge, so there is nowhere to dodge — verify a graceful, no-worse-than-before fallback instead of a crash", () => {
    // Exact Lantai 1 geometry pulled live from proj-sKeE6zh- (site 8x8m).
    // Carport+Ruang Tamu tile the left half and Dapur+Ruang Keluarga tile
    // the right half — together with the 0.28m structural setback, this
    // covers the ENTIRE lot. There is no free 0.85x1.7m (or even 0.4x0.4m)
    // rect anywhere on this site, so no local placement fix CAN dodge the
    // septic tank away from Ruang Tamu or the soakwell away from Ruang
    // Keluarga — that would require reserving yard space in the floor plan
    // itself (out of scope here). The fix must still degrade gracefully:
    // no crash, and no WORSE than the pre-fix numbers (see the dedicated
    // "dodge" test below for the case where free yard space does exist).
    const site = { widthM: 8, depthM: 8 }
    const layout: DesignLayout = {
      id: "l-qyfa", projectId: "proj-sKeE6zh-", versionId: "v",
      floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 }],
      rooms: [
        { id: "room-OVGDUO", floorId: "floor-1", name: "Carport", type: "carport", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11 },
        { id: "room-BB_A3S", floorId: "floor-1", name: "Ruang tamu", type: "ruang_tamu", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25 },
        { id: "room-B9lRfP", floorId: "floor-1", name: "Dapur", type: "dapur", x: 3.22, y: 0.28, width: 4.5, depth: 3.04, areaM2: 13.68 },
        { id: "room-FPMQ_F", floorId: "floor-1", name: "Ruang keluarga", type: "ruang_keluarga", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71 },
        { id: "room-uPeA4g", floorId: "floor-1", name: "Kamar mandi 1", type: "kamar_mandi", x: 4.57, y: 2, width: 3.15, depth: 1.61, areaM2: 5.07 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }

    const roomRects = layout.rooms.map((r) => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }))
    let s: ReturnType<typeof autoSizeSanitation> | undefined
    expect(() => { s = autoSizeSanitation(layout, ROOF_AREA, site) }).not.toThrow()

    // Same numbers as the pre-fix formula — confirms the fallback is exact,
    // not a different (and possibly worse) overlap.
    expect(s!.septicTank.x).toBe(2)
    expect(s!.septicTank.y).toBe(6.65)
    expect(s!.soakwell.x).toBe(6)
    expect(s!.soakwell.y).toBe(6.8)

    const septicRect = { x: s!.septicTank.x - s!.septicTank.widthM / 2, y: s!.septicTank.y - s!.septicTank.lengthM / 2, width: s!.septicTank.widthM, depth: s!.septicTank.lengthM }
    expect(roomRects.some((r) => rectsOverlap(septicRect, r))).toBe(true) // documents the residual limitation
  })

  it("dodges an obstacle at the default position when free yard space genuinely exists", () => {
    // A more generous lot: rooms occupy only the FRONT half (y < 5) of a
    // 8x10 site, leaving a real, unobstructed backyard (y: 5..10) — except
    // a shed sitting exactly where the septic tank's default position would
    // land. Unlike the saturated Rumah Qyfa case above, a free spot exists
    // elsewhere in the yard, so the fix must actually use it.
    const site = { widthM: 8, depthM: 10 }
    const layout: DesignLayout = {
      id: "l-yard", projectId: "p", versionId: "v",
      floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
      rooms: [
        { id: "r-front", floorId: "f1", name: "Rumah", type: "ruang_keluarga", x: 0, y: 0, width: 8, depth: 5, areaM2: 40 },
        // Shed sitting exactly on the septic tank's default lot spot:
        // center (site.widthM*0.25, site.depthM - septicLength/2 - 0.5) for
        // occupants=4 (septicSize.lengthM=1.7) = (2, 8.65).
        { id: "r-shed", floorId: "f1", name: "Gudang", type: "gudang", x: 1.5, y: 7.5, width: 1, depth: 1.5, areaM2: 1.5 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    const roomRects = layout.rooms.map((r) => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }))

    const s = autoSizeSanitation(layout, ROOF_AREA, site)
    const septicRect = { x: s.septicTank.x - s.septicTank.widthM / 2, y: s.septicTank.y - s.septicTank.lengthM / 2, width: s.septicTank.widthM, depth: s.septicTank.lengthM }

    // The default spot really did collide with the shed... (occupants=4 →
    // septicSize.lengthM=1.7 → default center (site.widthM*0.25, site.depthM
    // - 1.7/2 - 0.5) = (2, 8.65))
    const oldDefaultRect = { x: 2 - s.septicTank.widthM / 2, y: 8.65 - s.septicTank.lengthM / 2, width: s.septicTank.widthM, depth: s.septicTank.lengthM }
    expect(rectsOverlap(oldDefaultRect, roomRects[1])).toBe(true)
    // ...but the fix found a different, genuinely free spot in the yard.
    for (const r of roomRects) expect(rectsOverlap(septicRect, r)).toBe(false)
    expect(septicRect.y).toBeGreaterThanOrEqual(5) // still in the yard, not inside the house
  })

  it("falls back to the original default position when no free spot exists anywhere (no worse than before, never throws)", () => {
    // A single room covers the ENTIRE site — there is nowhere at all for any
    // sanitation object to go without overlapping it.
    const site = { widthM: 4, depthM: 4 }
    const layout: DesignLayout = {
      id: "l-full", projectId: "p", versionId: "v",
      floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
      rooms: [
        { id: "r1", floorId: "f1", name: "Dapur", type: "dapur", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    let s: ReturnType<typeof autoSizeSanitation> | undefined
    expect(() => { s = autoSizeSanitation(layout, ROOF_AREA, site) }).not.toThrow()
    const septicSize = sizeSepticTank(occupantsOf(layout))
    expect(s!.septicTank.x).toBe(site.widthM * 0.25)
    expect(s!.septicTank.y).toBe(round2(site.depthM - septicSize.lengthM / 2 - 0.5))
  })
})

describe("sanitationObstacles", () => {
  it("converts each object's CENTER (x,y) + widthM/lengthM into a top-left-corner Rect", () => {
    const out = sanitationObstacles({
      septicTank: { x: 5, y: 10, widthM: 2, lengthM: 4 },
      soakwell: { x: 8, y: 10, widthM: 1.4, lengthM: 1.4 },
      controlBoxes: [{ x: 3, y: 3, widthM: 0.4, lengthM: 0.4 }],
    })
    expect(out).toHaveLength(3)
    expect(out.find((o) => o.label === "septic tank")?.rect).toEqual({ x: 4, y: 8, width: 2, depth: 4 })
    expect(out.find((o) => o.label === "sumur resapan")?.rect).toEqual({ x: 7.3, y: 9.3, width: 1.4, depth: 1.4 })
    expect(out.find((o) => o.label === "bak kontrol 1")?.rect).toEqual({ x: 2.8, y: 2.8, width: 0.4, depth: 0.4 })
  })

  it("labels multiple control boxes distinctly", () => {
    const out = sanitationObstacles({
      controlBoxes: [
        { x: 1, y: 1, widthM: 0.4, lengthM: 0.4 },
        { x: 2, y: 1, widthM: 0.4, lengthM: 0.4 },
      ],
    })
    expect(out.map((o) => o.label)).toEqual(["bak kontrol 1", "bak kontrol 2"])
  })

  it("returns [] for undefined/empty sanitation", () => {
    expect(sanitationObstacles(undefined)).toEqual([])
    expect(sanitationObstacles({})).toEqual([])
  })

  it("produces rects usable directly with rectsOverlap (the reported bug's exact shape)", () => {
    // Kamar Mandi 1 resized/moved by the assistant to 3.15×1.61 at (4.85,6.39)
    // — landing on the septic's absorption field, exactly like the report.
    const room = { x: 4.85, y: 6.39, width: 3.15, depth: 1.61 }
    const [obstacle] = sanitationObstacles({ soakwell: { x: 6, y: 7, widthM: 1.4, lengthM: 1.4 } })
    expect(rectsOverlap(room, obstacle.rect)).toBe(true)
  })
})

describe("groundFloorIds", () => {
  it("returns the single lowest-level floor for a normal multi-floor layout", () => {
    const ids = groundFloorIds([
      { id: "f1", level: 1 },
      { id: "f2", level: 2 },
      { id: "f3", level: 3 },
    ])
    expect(ids).toEqual(new Set(["f1"]))
  })

  it("excludes the rooftop floor even if it somehow has the lowest level", () => {
    const ids = groundFloorIds([
      { id: "floor-rooftop", level: 1 },
      { id: "f1", level: 2 },
    ])
    expect(ids).toEqual(new Set(["f1"]))
  })

  it("returns an empty set when there are no regular floors", () => {
    expect(groundFloorIds([{ id: "floor-rooftop", level: 1 }])).toEqual(new Set())
    expect(groundFloorIds([])).toEqual(new Set())
  })

  it("returns all floors tied at the lowest level (defensive; shouldn't normally happen)", () => {
    const ids = groundFloorIds([
      { id: "f1", level: 1 },
      { id: "f2", level: 1 },
    ])
    expect(ids).toEqual(new Set(["f1", "f2"]))
  })
})
