import { describe, expect, it } from "vitest"

import type { DesignLayout, Site } from "@/types"

import { analyzeRoom } from "./analyze-room"

/**
 * Fixture dasar: site 10×15, dua lantai; satu ruang "r1" (Kamar Tidur Utama,
 * lantai-1, x1 y6 w4 d5 → site x:[1,5] y:[6,11]). Jendela sisi selatan (dgn
 * gorden) & timur, pintu sisi utara; satu skylight di dalam rect ruang;
 * interiors berisi 2 furnitur, 1 material, 1 lampu warm qty 4.
 */
function baseLayout(): DesignLayout {
  return {
    id: "layout-room-intel",
    projectId: "project-room-intel",
    versionId: "version-room-intel",
    floors: [
      { id: "lantai-1", level: 0, name: "Lantai 1", heightM: 3.2 },
      { id: "lantai-2", level: 1, name: "Lantai 2", heightM: 3.2 },
    ],
    rooms: [
      {
        id: "r1",
        floorId: "lantai-1",
        name: "Kamar Tidur Utama",
        type: "kamar_tidur",
        x: 1,
        y: 6,
        width: 4,
        depth: 5,
        areaM2: 20,
      },
    ],
    walls: [],
    openings: [
      {
        id: "op1",
        floorId: "lantai-1",
        wallId: "r1:s",
        type: "window",
        positionM: 2,
        widthM: 1.2,
        heightM: 1.5,
        curtainModelUrl: "x.glb",
      },
      {
        id: "op2",
        floorId: "lantai-1",
        wallId: "r1:e",
        type: "window",
        positionM: 2,
        widthM: 1,
        heightM: 1.5,
      },
      {
        id: "op3",
        floorId: "lantai-1",
        wallId: "r1:n",
        type: "door",
        kind: "hinged_door",
        positionM: 1,
        widthM: 0.9,
        heightM: 2.1,
      },
    ],
    skylights: [{ id: "sky1", x: 2, y: 7, widthM: 1, depthM: 1, kind: "fixed" }],
    interiors: [
      {
        roomId: "r1",
        roomName: "Kamar Tidur Utama",
        roomType: "kamar_tidur",
        floorId: "lantai-1",
        style: "japandi",
        furniture: [
          {
            id: "f1",
            furnitureId: "cat-bed",
            roomId: "r1",
            name: "Bed",
            category: "bed",
            // Dekat tepi utara ruang (item.y=6.4 vs room.y=6 → gap 0.4 ≤0.7)
            // TAPI jauh dari timur/barat (gap 1 m keduanya) → satu tepi saja.
            x: 2,
            y: 6.4,
            rotationDeg: 0,
            widthM: 2,
            depthM: 1.8,
            heightM: 0.5,
            locked: false,
            priceRange: { low: 1000000, mid: 2000000, high: 3000000 },
          },
          {
            id: "f2",
            furnitureId: "cat-wardrobe",
            roomId: "r1",
            name: "Wardrobe",
            category: "storage",
            x: 4.2,
            y: 9.5,
            rotationDeg: 0,
            widthM: 0.6,
            depthM: 0.6,
            heightM: 2,
            locked: false,
            priceRange: { low: 1500000, mid: 2500000, high: 3500000 },
          },
        ],
        materials: [
          {
            id: "m1",
            roomId: "r1",
            surface: "floor",
            materialId: "mat-parket",
            name: "Parket kayu",
            areaM2: 20,
            priceRange: { low: 100000, mid: 200000, high: 300000 },
          },
        ],
        lighting: [
          {
            id: "l1",
            roomId: "r1",
            type: "downlight",
            x: 3,
            y: 8.5,
            heightM: 2.8,
            colorTemperature: "warm",
            qty: 4,
            priceRange: { low: 50000, mid: 80000, high: 120000 },
          },
        ],
        colorPalette: {
          primary: "#ffffff",
          secondary: "#000000",
          accent: "#ff0000",
          wood: "#a52a2a",
          metal: "#c0c0c0",
          fabric: "#dddddd",
        },
        warnings: [],
        budgetEstimate: { lowIDR: 0, midIDR: 0, highIDR: 0, lines: [] },
        score: {
          clearance: 1,
          usability: 1,
          styleMatch: 1,
          cost: 1,
          naturalLight: 1,
          circulation: 1,
        },
      },
    ],
    validation: { passed: true, issues: [] },
  } as DesignLayout
}

const site: Site = { widthM: 10, depthM: 15, areaM2: 150 }

describe("analyzeRoom", () => {
  it("mengekstrak RoomFacts dari roomId langsung", () => {
    const layout = baseLayout()
    const facts = analyzeRoom(layout, site, { roomId: "r1" })

    expect(facts).not.toBeNull()
    expect(facts?.roomName).toBe("Kamar Tidur Utama")
    expect(facts?.roomType).toBe("kamar_tidur")
    expect(facts?.floorIndex).toBe(0)
    expect(facts?.widthM).toBe(4)
    expect(facts?.depthM).toBe(5)
    expect(facts?.areaM2).toBe(20)
    // Fixture pakai heightM 3.2 (floor-to-floor) utk lantai-1 — BUKAN nilai
    // default 2.95 (WALL_H+SLAB_T). Resolver v2 memakai wallHM PER-LANTAI
    // (round2(3.2-0.15)=3.05 → round1=3.1), bukan lagi konstanta global
    // WALL_H=2.8 — perubahan spec disengaja (lihat task-1-brief.md).
    expect(facts?.ceilingHeightM).toBe(3.1)
    expect(facts?.floorKind).toBe("regular")
    expect(facts?.doubleHeight).toBe(false)
    expect(facts?.mezzanineOverlooking).toBeUndefined()
    expect(facts?.levelOffsetM).toBeUndefined()
    expect(facts?.style).toBe("japandi")
    expect(facts?.colorPalette).toEqual([
      "#ff0000", // accent
      "#dddddd", // fabric
      "#c0c0c0", // metal
      "#ffffff", // primary
      "#000000", // secondary
      "#a52a2a", // wood
    ])
    expect(facts?.windowSides).toEqual(["s", "e"])
    expect(facts?.doorCount).toBe(1)
    expect(facts?.hasCurtains).toBe(true)
    expect(facts?.skylightCount).toBe(1)
    expect(facts?.materials).toEqual([{ surface: "floor", name: "Parket kayu" }])
    expect(facts?.lighting).toEqual({ fixtureCount: 4, warmCount: 4 })

    expect(facts?.furniture).toHaveLength(2)
    // Urut nama abjad: Bed sebelum Wardrobe.
    expect(facts?.furniture[0].name).toBe("Bed")
    expect(facts?.furniture[0].placement).toBe("against the north wall")
    expect(facts?.furniture[1].name).toBe("Wardrobe")
  })

  it("roomId tak ditemukan → null", () => {
    const layout = baseLayout()
    expect(analyzeRoom(layout, site, { roomId: "nope" })).toBeNull()
  })

  it("placement koridor sempit: dua tepi berlawanan sama-sama dekat → tepi TERDEKAT menang (bukan 'near the center')", () => {
    const layout = baseLayout()
    // Koridor 1.4 m (sumbu x): lemari 0.6 m di x0.1 → distWest 0.1,
    // distEast 1.4−0.7 = 0.7 — keduanya ≤0.7 tapi satu sumbu (bukan corner).
    layout.rooms = [
      ...layout.rooms,
      {
        id: "r-koridor",
        floorId: "lantai-1",
        name: "Koridor",
        type: "koridor",
        x: 0,
        y: 0,
        width: 1.4,
        depth: 5,
        areaM2: 7,
      },
    ]
    layout.interiors = [
      ...(layout.interiors ?? []),
      {
        roomId: "r-koridor",
        roomName: "Koridor",
        roomType: "koridor",
        floorId: "lantai-1",
        style: "japandi",
        furniture: [
          {
            id: "f-lemari",
            furnitureId: "wardrobe-1",
            roomId: "r-koridor",
            name: "Lemari",
            category: "storage",
            x: 0.1,
            y: 2,
            rotationDeg: 0,
            widthM: 0.6,
            depthM: 0.5,
            heightM: 2,
            locked: false,
            priceRange: { min: 0, max: 0 },
          },
        ],
        materials: [],
        lighting: [],
        colorPalette: baseLayout().interiors![0].colorPalette,
        warnings: [],
        budgetEstimate: { min: 0, max: 0 },
        score: {
          clearance: 1,
          usability: 1,
          styleMatch: 1,
          cost: 1,
          naturalLight: 1,
          circulation: 1,
        },
      },
    ]

    const facts = analyzeRoom(layout, site, { roomId: "r-koridor" })
    expect(facts?.furniture[0].placement).toBe("against the west wall")
  })

  it("deteksi pose: kamera di dalam r1 lantai dasar → RoomFacts r1", () => {
    const layout = baseLayout()
    // site (3, 8.5) → world x = 3 - 10/2 = -2; world z = 8.5 - 15/2 = 1.
    const facts = analyzeRoom(layout, site, {
      pose: { position: [-2, 1.5, 1], target: [0, 1.4, 3], fov: 60 },
    })
    expect(facts?.roomId).toBe("r1")
  })

  it("deteksi pose: band lantai pakai tinggi per-lantai (bukan WALL_H+SLAB_T global)", () => {
    const layout = baseLayout()
    // r2: ruang sama persis (rect) dgn r1 tapi di lantai-2. lantai-1 &
    // lantai-2 sama-sama heightM 3.2 (floor-to-floor) → lantai-2 baseY=3.2,
    // band [3.2, 6.4). Konstanta global lama WALL_H+SLAB_T=2.95 akan salah
    // memangkas band jadi [3.2, 6.15) — y=6.2 gagal terdeteksi di kode lama.
    layout.rooms.push({
      id: "r2",
      floorId: "lantai-2",
      name: "Kamar Tidur Lantai 2",
      type: "kamar_tidur",
      x: 1,
      y: 6,
      width: 4,
      depth: 5,
      areaM2: 20,
    })

    // y=6.2 → dalam band floorToFloorM lantai-2 [3.2, 6.4) tapi DI LUAR band
    // WALL_H+SLAB_T lama [3.2, 6.15) → membuktikan fix pakai tinggi spesifik.
    const higherFacts = analyzeRoom(layout, site, {
      pose: { position: [-2, 6.2, 1], target: [0, 6.1, 3], fov: 60 },
    })
    expect(higherFacts?.roomId).toBe("r2")

    // y=3.1 → tepat di BAWAH base lantai-2 (3.2) → masih di dalam band
    // lantai-1 [0, 3.2) → harus resolve r1 (bukan r2), membuktikan batas
    // band tetap benar (tidak overshoot ke lantai berikutnya).
    const lowerFacts = analyzeRoom(layout, site, {
      pose: { position: [-2, 3.1, 1], target: [0, 3.0, 3], fov: 60 },
    })
    expect(lowerFacts?.roomId).toBe("r1")
  })

  it("deteksi pose: kamera di luar semua ruang → null", () => {
    const layout = baseLayout()
    const facts = analyzeRoom(layout, site, {
      pose: { position: [100, 1.5, 100], target: [0, 1.4, 3], fov: 60 },
    })
    expect(facts).toBeNull()
  })

  it("tak ada roomId maupun pose → null (tak pernah throw)", () => {
    const layout = baseLayout()
    expect(() => analyzeRoom(layout, site, {})).not.toThrow()
    expect(analyzeRoom(layout, site, {})).toBeNull()
  })
})

/**
 * Fixture mezzanine/split-level/double-height: lantai-1 (reguler, heightM
 * 5.9 — floor-to-floor cukup tinggi utk menampung mezzanine DI DALAMNYA) +
 * lantai-mezz (kind:"mezzanine", baseOffsetM 2.8, heightM 2.2 → band
 * [2.8, 5.0), tumpang-tindih dgn band lantai-1 [0, 5.9)) + lantai-2 (reguler,
 * heightM 3.2, baseY 5.9 — TIDAK terpengaruh mezzanine, konsisten dgn
 * floorElevations). Ruang:
 * - r-bawah: lantai-1, rect 6×6 (x:[0,6] y:[0,6]) — menaungi r-mezz & r-split.
 * - r-mezz: lantai-mezz, rect 3×3 di sudut utara r-bawah (x:[0,3] y:[0,3]) —
 *   sepenuhnya di dalam r-bawah (utk mezzanineOverlooking), SENGAJA tak
 *   overlap r-void (rect selatan) supaya doubleHeight r-mezz tetap false —
 *   isolasi kasus uji.
 * - r-split: lantai-1, rect 1.5×1.5 di sudut r-bawah (x:[4.5,6] y:[4.5,6]),
 *   `levelOffsetM: 1.2` — tak overlap r-mezz, utk uji pergeseran band murni.
 * - r-void: lantai-2, type "void", rect parametrik di selatan r-bawah
 *   (default x:[0,6] y:[3,6], 6×3=18 → overlap 18/36 = 50% ≥50% r-bawah →
 *   double-height; parameter dipakai utk kasus overlap <50%).
 */
function mezzFixtureLayout(voidRect = { x: 0, y: 3, width: 6, depth: 3 }): DesignLayout {
  return {
    id: "layout-mezz",
    projectId: "project-mezz",
    versionId: "version-mezz",
    floors: [
      { id: "lantai-1", level: 0, name: "Lantai 1", heightM: 5.9 },
      {
        id: "lantai-mezz",
        level: 0,
        name: "Mezzanine",
        heightM: 2.2,
        kind: "mezzanine",
        baseOffsetM: 2.8,
      },
      { id: "lantai-2", level: 1, name: "Lantai 2", heightM: 3.2 },
    ],
    rooms: [
      {
        id: "r-bawah",
        floorId: "lantai-1",
        name: "Ruang Keluarga",
        type: "ruang_keluarga",
        x: 0,
        y: 0,
        width: 6,
        depth: 6,
        areaM2: 36,
      },
      {
        id: "r-mezz",
        floorId: "lantai-mezz",
        name: "Mezzanine Baca",
        type: "workspace",
        x: 0,
        y: 0,
        width: 3,
        depth: 3,
        areaM2: 9,
      },
      {
        id: "r-split",
        floorId: "lantai-1",
        name: "Sudut Split",
        type: "workspace",
        x: 4.5,
        y: 4.5,
        width: 1.5,
        depth: 1.5,
        areaM2: 2.25,
        levelOffsetM: 1.2,
      },
      {
        id: "r-void",
        floorId: "lantai-2",
        name: "Void Atas",
        type: "void",
        x: voidRect.x,
        y: voidRect.y,
        width: voidRect.width,
        depth: voidRect.depth,
        areaM2: voidRect.width * voidRect.depth,
      },
    ],
    walls: [],
    openings: [],
    validation: { passed: true, issues: [] },
  } as DesignLayout
}

describe("analyzeRoom — resolver v2 (platform tertinggi) & RoomFacts mezzanine/split-level/double-height", () => {
  // site sama dgn fixture dasar (10×15) — cukup besar utk rect 6×6 fixture mezz.
  it("kamera di plan overlap r-bawah∩r-mezz, y = baseY mezz + 1.5 → resolve r-mezz (platform tertinggi)", () => {
    const layout = mezzFixtureLayout()
    // site (2, 2) → world x = 2 - 10/2 = -3; world z = 2 - 15/2 = -5.5.
    const facts = analyzeRoom(layout, site, {
      pose: { position: [-3, 4.3, -5.5], target: [-3, 4.2, -5], fov: 60 },
    })
    expect(facts?.roomId).toBe("r-mezz")
  })

  it("kamera di plan overlap r-bawah∩r-mezz, y = 1.5 (di bawah band mezz [2.8,5.0)) → resolve r-bawah", () => {
    const layout = mezzFixtureLayout()
    const facts = analyzeRoom(layout, site, {
      pose: { position: [-3, 1.5, -5.5], target: [-3, 1.4, -5], fov: 60 },
    })
    expect(facts?.roomId).toBe("r-bawah")
  })

  it("levelOffsetM menggeser band: y di bawah band tergeser r-split → resolve r-bawah (ruang lain)", () => {
    const layout = mezzFixtureLayout()
    // site (5, 5) → world x = 5 - 10/2 = 0; world z = 5 - 15/2 = -2.5. Rect
    // ini hanya milik r-split (di dalam r-bawah, di luar r-mezz).
    // Band r-split tergeser levelOffsetM 1.2: base = 0+1.2 = 1.2. y=1.1 < 1.2
    // → r-split BUKAN kandidat; band r-bawah [0,5.9) masih memuat 1.1.
    const facts = analyzeRoom(layout, site, {
      pose: { position: [0, 1.1, -2.5], target: [0, 1.0, -2], fov: 60 },
    })
    expect(facts?.roomId).toBe("r-bawah")
  })

  it("levelOffsetM menggeser band: y di dalam band tergeser → resolve r-split (base lebih tinggi menang)", () => {
    const layout = mezzFixtureLayout()
    // y=2.0: kedua band ([1.2,7.1) r-split & [0,5.9) r-bawah) memuatnya →
    // base tertinggi (r-split, 1.2 > 0) menang.
    const facts = analyzeRoom(layout, site, {
      pose: { position: [0, 2.0, -2.5], target: [0, 1.9, -2], fov: 60 },
    })
    expect(facts?.roomId).toBe("r-split")
  })

  it("kamera di atas semua band → null", () => {
    const layout = mezzFixtureLayout()
    const facts = analyzeRoom(layout, site, {
      pose: { position: [-3, 999, -5.5], target: [-3, 998, -5], fov: 60 },
    })
    expect(facts).toBeNull()
  })

  it("facts r-mezz: floorKind mezzanine, ceilingHeightM per-lantai mezzanine, mezzanineOverlooking = ruang induk terbesar", () => {
    const layout = mezzFixtureLayout()
    const facts = analyzeRoom(layout, site, { roomId: "r-mezz" })

    expect(facts?.floorKind).toBe("mezzanine")
    // wallHM lantai-mezz = round2(2.2 - SLAB_T 0.15) = 2.05 → round1 = 2.1.
    expect(facts?.ceilingHeightM).toBe(2.1)
    expect(facts?.mezzanineOverlooking).toBe("Ruang Keluarga")
    expect(facts?.doubleHeight).toBe(false)
    expect(facts?.levelOffsetM).toBeUndefined()
  })

  it("facts r-bawah: doubleHeight true (void ≥50% overlap), ceilingHeightM = wallHM + f2f lantai void", () => {
    const layout = mezzFixtureLayout()
    const facts = analyzeRoom(layout, site, { roomId: "r-bawah" })

    expect(facts?.floorKind).toBe("regular")
    expect(facts?.doubleHeight).toBe(true)
    // wallHM lantai-1 = round2(5.9-0.15) = 5.75; + f2f lantai-2 (3.2) = 8.95
    // → round1 = 9.
    expect(facts?.ceilingHeightM).toBe(9)
    expect(facts?.mezzanineOverlooking).toBeUndefined()
  })

  it("facts r-bawah: overlap void <50% → doubleHeight false, ceilingHeightM = hanya wallHM lantai ini", () => {
    // r-void 6×1=6 → 6/36 = 16,7% < 50%.
    const layout = mezzFixtureLayout({ x: 0, y: 3, width: 6, depth: 1 })
    const facts = analyzeRoom(layout, site, { roomId: "r-bawah" })

    expect(facts?.doubleHeight).toBe(false)
    expect(facts?.ceilingHeightM).toBe(5.8) // round1(5.75)
  })

  it("facts r-split: levelOffsetM ≠0 diteruskan (round1)", () => {
    const layout = mezzFixtureLayout()
    const facts = analyzeRoom(layout, site, { roomId: "r-split" })

    expect(facts?.floorKind).toBe("regular")
    expect(facts?.levelOffsetM).toBe(1.2)
  })

  it("ruang di lantai rooftop (wallHM 0) → ceilingHeightM fallback WALL_H, bukan 0 (regresi I1)", () => {
    const layout = baseLayout()
    layout.floors = [...layout.floors, { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 }]
    layout.rooms = [
      ...layout.rooms,
      {
        id: "r-deck",
        floorId: "floor-rooftop",
        name: "Rooftop Lounge",
        type: "rooftop_lounge",
        x: 1,
        y: 6,
        width: 3,
        depth: 3,
        areaM2: 9,
      },
    ]
    const facts = analyzeRoom(layout, site, { roomId: "r-deck" })
    expect(facts?.ceilingHeightM).toBe(2.8) // WALL_H, bukan 0
  })
})
