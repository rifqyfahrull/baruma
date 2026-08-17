import { describe, it, expect } from "vitest"

import {
  applyResize,
  clampOrDropOpeningsForRoom,
  findFreeRect,
  findOpeningGapPositionM,
  rectsOverlap,
  roomArea,
  snap,
  squarifiedTreemap,
} from "@/lib/geometry"
import type { Room } from "@/types"

const room = (over: Partial<Room> = {}): Room => ({
  id: "r1", floorId: "f1", name: "R", type: "kamar_mandi",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9,
  ...over,
})

describe("geometry", () => {
  it("snaps to the grid", () => {
    expect(snap(0.44, 0.5)).toBe(0.5)
    expect(snap(0.2, 0.5)).toBe(0)
    expect(snap(1.3, 0.25)).toBe(1.25)
  })

  it("detects rectangle overlap", () => {
    const a = { x: 0, y: 0, width: 2, depth: 2 }
    const b = { x: 1, y: 1, width: 2, depth: 2 }
    const c = { x: 3, y: 3, width: 1, depth: 1 }
    expect(rectsOverlap(a, b)).toBe(true)
    expect(rectsOverlap(a, c)).toBe(false)
  })

  it("computes room area", () => {
    expect(roomArea(4, 3)).toBe(12)
  })

  it("keeps a minimum size when resizing", () => {
    const r = applyResize({ x: 0, y: 0, width: 5, depth: 5 }, "se", 1, 1, 1.2)
    expect(r.width).toBeGreaterThanOrEqual(1.2)
    expect(r.depth).toBeGreaterThanOrEqual(1.2)
  })

  it("treemap fills the rect without overflow", () => {
    const rects = squarifiedTreemap([2, 1, 1, 3], 0, 0, 10, 10)
    expect(rects).toHaveLength(4)
    let area = 0
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.01)
      expect(r.y).toBeGreaterThanOrEqual(-0.01)
      expect(r.x + r.width).toBeLessThanOrEqual(10.01)
      expect(r.y + r.depth).toBeLessThanOrEqual(10.01)
      area += r.width * r.depth
    }
    expect(area).toBeCloseTo(100, 0)
  })
})

describe("findOpeningGapPositionM — BUG C: klik 'Tambah jendela' ke-2 di dinding terisi", () => {
  it("dinding kosong: posisi klik dipakai apa adanya (dalam batas dinding)", () => {
    expect(findOpeningGapPositionM(3, 1.2, [], 1.5)).toBe(1.5)
  })

  it("posisi klik ke-2 BERTUMPUK dgn bukaan pertama → digeser ke celah kosong terdekat", () => {
    // Dinding 3 m, jendela pertama 1.2 m di tengah (0.9–2.1). Sisa celah:
    // 0–0.9 dan 2.1–3 (masing-masing 0.9 m) — TAK cukup utk jendela 1.2 m lagi.
    const existing = [{ positionM: 1.5, widthM: 1.2 }]
    expect(findOpeningGapPositionM(3, 1.2, existing, 1.5)).toBeNull()
  })

  it("dinding cukup panjang: bukaan ke-2 ditempatkan di celah kosong terdekat dgn klik, tak menumpuk", () => {
    // Dinding 5 m, jendela pertama 1.2 m di x=1 (0.4–1.6). Klik ke-2 di x=4
    // (jauh dari yg pertama) → celah kosong [1.65, 5] cukup, posisi = klik itu sendiri.
    const existing = [{ positionM: 1, widthM: 1.2 }]
    const pos = findOpeningGapPositionM(5, 1.2, existing, 4)
    expect(pos).toBe(4)
  })

  it("klik ke-2 menumpuk tapi MASIH ADA celah lain di dinding → digeser ke celah itu, bukan ditolak", () => {
    // Dinding 5 m, jendela pertama di x=1 (0.4–1.6, + jarak kusen 0.05 →
    // occupied 0.35–1.65). Klik ke-2 tetap di x=1 (menumpuk) — satu-satunya
    // celah yg muat 1.2 m adalah [1.65, 5], jadi digeser ke situ (bukan null).
    const existing = [{ positionM: 1, widthM: 1.2 }]
    const pos = findOpeningGapPositionM(5, 1.2, existing, 1)
    expect(pos).not.toBeNull()
    expect(pos!).toBeGreaterThanOrEqual(1.65 + 0.6 - 1e-6) // >= lo celah kedua
  })

  it("dinding penuh sama sekali (lebar < bukaan) → null di semua posisi klik", () => {
    expect(findOpeningGapPositionM(1, 1.2, [], 0.5)).toBeNull()
  })
})

describe("clampOrDropOpeningsForRoom — BUG D: bukaan yatim setelah resize", () => {
  it("dinding mengecil tapi bukaan masih muat: positionM di-clamp ke dalam dinding baru", () => {
    // Pintu di dinding s, tadinya lebar 4 m (positionM 3.5 dekat sudut kanan).
    // Dinding s diperkecil jadi width 2 m — 3.5 kini di luar rentang.
    const after = room({ width: 2 })
    const openings = [{ wallId: "r1:s", positionM: 3.5, widthM: 0.9 }]
    const result = clampOrDropOpeningsForRoom(openings, after)
    expect(result).toHaveLength(1)
    // Muat (0.9 ≤ 2): clamp ke [0.45, 1.55] → 3.5 dipangkas ke 1.55.
    expect(result[0].positionM).toBe(1.55)
  })

  it("dinding mengecil sampai TAK MUAT sama sekali (lebar bukaan > panjang dinding baru): bukaan dihapus", () => {
    const after = room({ width: 0.8 }) // dinding s jadi 0.8 m
    const openings = [{ wallId: "r1:s", positionM: 2, widthM: 0.9 }] // 0.9 > 0.8
    expect(clampOrDropOpeningsForRoom(openings, after)).toEqual([])
  })

  it("dinding MELEBAR (bukan mengecil): posisi yang masih sah dibiarkan apa adanya (byte-identik)", () => {
    const after = room({ width: 6 })
    const op = { wallId: "r1:s", positionM: 1.5, widthM: 0.9 }
    const result = clampOrDropOpeningsForRoom([op], after)
    expect(result[0]).toBe(op) // referensi objek sama — tak di-clone tanpa perlu
  })

  it("bukaan milik ruang LAIN tak tersentuh sama sekali", () => {
    const after = room({ id: "r1", width: 1 })
    const op = { wallId: "r2:s", positionM: 5, widthM: 3 }
    const result = clampOrDropOpeningsForRoom([op], after)
    expect(result).toEqual([op])
  })

  it("resize dinding w/e (bergantung DEPTH, bukan width) juga tercakup", () => {
    const after = room({ depth: 1 })
    const openings = [{ wallId: "r1:e", positionM: 2.5, widthM: 0.9 }]
    const result = clampOrDropOpeningsForRoom(openings, after)
    expect(result).toHaveLength(1)
    expect(result[0].positionM).toBe(0.55) // clamp ke [0.45, 0.55] utk dinding 1 m
  })
})

describe("findFreeRect", () => {
  const site = { widthM: 8, depthM: 8 }

  it("places at the origin on an empty floor", () => {
    expect(findFreeRect({ width: 2, depth: 2 }, [], site)).toEqual({ x: 0, y: 0 })
  })

  it("finds space beside a single obstacle instead of overlapping it", () => {
    const obstacles = [{ x: 0, y: 0, width: 4, depth: 8 }] // left half of the floor
    const pos = findFreeRect({ width: 2, depth: 2 }, obstacles, site)
    expect(pos).not.toBeNull()
    const placed = { x: pos!.x, y: pos!.y, width: 2, depth: 2 }
    expect(rectsOverlap(placed, obstacles[0])).toBe(false)
    expect(placed.x + 2).toBeLessThanOrEqual(site.widthM + 0.01)
    expect(placed.y + 2).toBeLessThanOrEqual(site.depthM + 0.01)
  })

  it("reproduces the reported bug: a room moved onto a floor with an existing room must NOT overlap it", () => {
    // The exact shapes from the "pindahkan kamar mandi dari lantai 2 ke lantai 1"
    // report: Dapur occupies most of the floor; Kamar Mandi (2x2) must land
    // somewhere that doesn't overlap it.
    const dapur = { x: 0, y: 0, width: 6, depth: 5 }
    const pos = findFreeRect({ width: 2, depth: 2 }, [dapur], { widthM: 6, depthM: 8 })
    expect(pos).not.toBeNull()
    const placed = { x: pos!.x, y: pos!.y, width: 2, depth: 2 }
    expect(rectsOverlap(placed, dapur)).toBe(false)
  })

  it("returns null when the size doesn't fit the site at all", () => {
    expect(findFreeRect({ width: 20, depth: 2 }, [], site)).toBeNull()
  })

  it("returns null when the floor is genuinely full (no resize attempted)", () => {
    const obstacles = [
      { x: 0, y: 0, width: 8, depth: 4 },
      { x: 0, y: 4, width: 8, depth: 3.5 },
    ]
    // Only a 8x0.5 sliver remains — too thin for a 2x2 room.
    expect(findFreeRect({ width: 2, depth: 2 }, obstacles, site)).toBeNull()
  })

  it("avoids multiple obstacles, not just the first one", () => {
    const obstacles = [
      { x: 0, y: 0, width: 3, depth: 3 },
      { x: 3, y: 0, width: 3, depth: 3 },
      { x: 0, y: 3, width: 3, depth: 3 },
    ]
    const pos = findFreeRect({ width: 3, depth: 3 }, obstacles, site)
    expect(pos).toEqual({ x: 3, y: 3 })
  })

  describe("requireExterior", () => {
    it("accepts a spot on the site boundary", () => {
      const pos = findFreeRect({ width: 2, depth: 2 }, [], site, { requireExterior: true })
      expect(pos).toEqual({ x: 0, y: 0 }) // (0,0) touches two edges
    })

    it("rejects a spot boxed in on all four sides, even though it's collision-free", () => {
      // A 2x2 hole dead-center of an 8x8 site, fully surrounded on every side.
      const obstacles = [
        { x: 0, y: 0, width: 8, depth: 3 }, // above
        { x: 0, y: 5, width: 8, depth: 3 }, // below
        { x: 0, y: 3, width: 3, depth: 2 }, // left
        { x: 5, y: 3, width: 3, depth: 2 }, // right
      ]
      // Sanity check: without requireExterior, the 2x2 gap at (3,3) IS found.
      expect(findFreeRect({ width: 2, depth: 2 }, obstacles, site)).toEqual({ x: 3, y: 3 })
      // With requireExterior, that interior-only gap must be rejected.
      expect(findFreeRect({ width: 2, depth: 2 }, obstacles, site, { requireExterior: true })).toBeNull()
    })

    it("still finds a valid exterior spot when one exists alongside interior obstacles", () => {
      const obstacles = [{ x: 0, y: 0, width: 4, depth: 8 }] // occupies the left half only
      const pos = findFreeRect({ width: 2, depth: 2 }, obstacles, site, { requireExterior: true })
      expect(pos).not.toBeNull()
      const placed = { x: pos!.x, y: pos!.y, width: 2, depth: 2 }
      expect(rectsOverlap(placed, obstacles[0])).toBe(false)
      const touchesBoundary =
        placed.x <= 0.01 ||
        placed.y <= 0.01 ||
        placed.x + 2 >= site.widthM - 0.01 ||
        placed.y + 2 >= site.depthM - 0.01
      expect(touchesBoundary).toBe(true)
    })
  })

  describe("preferredPositions", () => {
    it("uses a preferred position (e.g. stacked above a bathroom on another floor) when it's valid", () => {
      const obstacles = [{ x: 0, y: 0, width: 3, depth: 3 }]
      const pos = findFreeRect({ width: 2, depth: 2 }, obstacles, site, {
        preferredPositions: [{ x: 5, y: 5 }],
      })
      // The general search would pick a compact top-left spot (e.g. (3,0));
      // preferredPositions should win instead since (5,5) is itself valid.
      expect(pos).toEqual({ x: 5, y: 5 })
    })

    it("falls back to the general search when every preferred position collides", () => {
      const obstacles = [{ x: 5, y: 5, width: 3, depth: 3 }]
      const pos = findFreeRect({ width: 2, depth: 2 }, obstacles, site, {
        preferredPositions: [{ x: 5, y: 5 }, { x: 6, y: 6 }],
      })
      expect(pos).toEqual({ x: 0, y: 0 })
    })

    it("falls back to the general search when a preferred position fails requireExterior", () => {
      const pos = findFreeRect({ width: 2, depth: 2 }, [], site, {
        preferredPositions: [{ x: 3, y: 3 }], // dead-center, no boundary contact
        requireExterior: true,
      })
      expect(pos).toEqual({ x: 0, y: 0 })
    })
  })
})
