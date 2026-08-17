import { describe, it, expect } from "vitest"
import { hazardOpenSides, buildModel, ROOFTOP_RAIL_ID, WALL_T } from "./build-model"
import { interiorStairLayout } from "@/lib/stairs/geometry"
import { buildingFootprint } from "@/lib/structural/grid"
import { clampRooftopArea, rooftopStrips, type RooftopArea } from "@/lib/geometry/rooftop"
import { BOW_FLOOR_SEGMENTS, BOW_RAIL_SEGMENTS } from "@/lib/geometry/balcony-bow"
import type { DesignLayout, Project, Room, RoofSpec } from "@/types"

const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "ruang_tamu",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const layout = (rooms: Room[], roof?: RoofSpec): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 }],
  rooms, walls: [], openings: [], stairs: [], pools: [],
  ...(roof ? { roof } : {}),
  validation: { passed: true, issues: [] },
})
const project = { rooftop: false, name: "P" } as unknown as Project
const opts = { exploded: false, showRoof: false, showFurniture: false }
const roofOpts = { exploded: false, showRoof: true, showFurniture: false }
const site = { widthM: 6, depthM: 3 }

function primPlanRect(prim: { pos: number[]; args: number[] }) {
  return {
    minX: prim.pos[0] - prim.args[0] / 2,
    maxX: prim.pos[0] + prim.args[0] / 2,
    minZ: prim.pos[2] - prim.args[2] / 2,
    maxZ: prim.pos[2] + prim.args[2] / 2,
  }
}

function primsPlanOverlap(a: { pos: number[]; args: number[] }, b: { pos: number[]; args: number[] }) {
  const ra = primPlanRect(a)
  const rb = primPlanRect(b)
  const overlapX = Math.min(ra.maxX, rb.maxX) - Math.max(ra.minX, rb.minX)
  const overlapZ = Math.min(ra.maxZ, rb.maxZ) - Math.max(ra.minZ, rb.minZ)
  return overlapX > 1e-6 && overlapZ > 1e-6
}

describe("buildModel — zones + split-level", () => {
  it("drops the wall between two same-zone neighbors but keeps exterior walls", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, zoneId: "z1" }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, zoneId: "z1" }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).not.toContain("w-a-e") // shared edge with same-zone b => skipped
    expect(ids).not.toContain("w-b-w")
    expect(ids).toContain("w-a-w") // exterior wall kept
    expect(ids).toContain("w-b-e")
  })

  it("keeps the wall between neighbors in different zones", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, zoneId: "z1" }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, zoneId: "z2" }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("w-a-e")
  })

  it("cuts only the shared partial wall span between same-zone rooms — AND gives the void a railing there", () => {
    const rooms = [
      room({ id: "family", x: 2, y: 0, width: 4, depth: 4, zoneId: "open-1" }),
      room({ id: "void", type: "void", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, zoneId: "open-1" }),
      room({ id: "bed", type: "kamar_tidur", x: 0, y: 2, width: 2, depth: 2, areaM2: 4 }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    const westWalls = prims.filter((p) => p.id.startsWith("w-family-w"))

    // 2026-07-11 dedupe: dinding batas interior dimiliki SATU ruang (sisi
    // utara/barat garis batas → dinding s/e ruang itu). Segmen family-w di
    // rentang bed kini digambar oleh bed (e); segmen void terbuka (satu zona).
    expect(westWalls).toHaveLength(0)
    const bedEast = prims.filter((p) => p.id.startsWith("w-bed-e"))
    expect(bedEast).toHaveLength(1)

    // Sisi timur void (menghadap family, sezona, dinding di-drop) BUKAN tepi
    // footprint (void x:0-2,y:0-2; footprint x:0-6,y:0-4 dari bbox semua ruang)
    // → dapat railing pengganti, bukan cuma dinding hilang tanpa pengaman.
    // ID sekarang berbentuk vrail-<roomId>-<idxBentang>-<sisi>... (per-bentang).
    const voidRail = prims.filter((p) => /^vrail-void-\d+-e-/.test(p.id))
    expect(voidRail.length).toBeGreaterThan(0)
    expect(voidRail.every((p) => p.kind === "rail" || p.kind === "rail_glass")).toBe(true)
    // Sisi facade void (n & w, kena tepi footprint) tetap dinding penuh — TANPA railing dobel.
    expect(prims.some((p) => /^vrail-void-\d+-n-/.test(p.id))).toBe(false)
    expect(prims.some((p) => /^vrail-void-\d+-w-/.test(p.id))).toBe(false)
  })

  it("a lone void keeps only facade walls (all its sides ARE the footprint edge) — no railing", () => {
    // Perilaku 2026-07-11: void di tepi bangunan tetap ditutup dinding facade;
    // hanya sisi interiornya yang terbuka. Void tunggal = semua sisi facade.
    const prims = buildModel(layout([room({ id: "v", type: "void" })]), site, project, opts).prims
    const wallIds = prims.filter((p) => p.id.startsWith("w-v-")).map((p) => p.id).sort()
    expect(wallIds).toEqual(["w-v-e", "w-v-n", "w-v-s", "w-v-w"])
    // Semua sisi = footprint boundary → sudah dinding penuh → tanpa railing dobel.
    expect(prims.some((p) => p.id.startsWith("vrail-v-"))).toBe(false)
  })

  it("void + tetangga solid TIDAK sezona: dinding tetap ada, TANPA railing (negatif)", () => {
    // Sama persis dgn layout test "cuts only the shared partial wall span..."
    // di atas (footprint tertutup penuh: family+void+bed, tanpa celah tanpa
    // tetangga) TAPI tanpa zoneId — supaya isolasi murni efek zona, bukan
    // efek "tak ada tetangga sama sekali" di sisi lain.
    const rooms = [
      room({ id: "family", x: 2, y: 0, width: 4, depth: 4 }), // tanpa zoneId
      room({ id: "void", type: "void", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 }), // tanpa zoneId
      room({ id: "bed", type: "kamar_tidur", x: 0, y: 2, width: 2, depth: 2, areaM2: 4 }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("w-family-w"))).toBe(true) // dinding TIDAK didrop
    expect(prims.some((p) => p.id.startsWith("vrail-void-"))).toBe(false) // tak over-trigger
  })

  it("balkon + ruang solid SEZONA: dinding didrop DAN railing balkon tetap muncul (bug lama diperbaiki)", () => {
    const rooms = [
      room({ id: "family", x: 2, y: 0, width: 4, depth: 4, zoneId: "open-2" }),
      room({ id: "bal", type: "balkon", x: 0, y: 0, width: 2, depth: 4, zoneId: "open-2" }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("w-family-w"))).toBe(false) // dinding didrop
    // Dulu: balconyOpenSides type-only -> tetangga solid dianggap "menutup" ->
    // TANPA railing sama sekali di sisi ini walau dindingnya sudah hilang.
    const bal = prims.filter((p) => p.id.startsWith("railg-bal-e") || p.id.startsWith("railb-bal-e") || p.id.startsWith("railh-bal-e"))
    expect(bal.length).toBeGreaterThan(0)
  })

  it("ANY solid room's wall leaves a gap where a stair from the floor below exits — not just void (regression: converting void->solid room re-blocks the stair with a wall)", () => {
    const twoFloor: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "f2", level: 2, name: "Lantai 2", heightM: 2.95 },
      ],
      rooms: [
        room({ id: "tangga", floorId: "f1", type: "tangga", x: 2, y: 3, width: 2, depth: 3, areaM2: 6, stairDirection: "n" } as Partial<Room>),
        // Ruang SOLID biasa (bukan void) — dulu (sebelum fix) tak ada mekanisme
        // sama sekali yang mencegah dindingnya menutup mulut tangga.
        room({ id: "landing", floorId: "f2", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 }),
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    const prims = buildModel(twoFloor, { widthM: 6, depthM: 6 }, project, opts).prims
    const southWalls = prims.filter((p) => p.id.startsWith("w-landing-s"))
    const cx = 3 // site widthM=6 -> cx=3
    const spansAbs = southWalls.map((p) => {
      const half = p.args[0] / 2
      return [p.pos[0] + cx - half, p.pos[0] + cx + half] as const
    })
    // Harus ADA sisa dinding di kiri (barat, x:0-2) & kanan (timur, x:4-6) tangga...
    expect(spansAbs.some(([s]) => s < 0.1)).toBe(true)
    expect(spansAbs.some(([, e]) => e > 5.9)).toBe(true)
    // ...tapi TIDAK ADA dinding yang menutup bentang x:2-4 (lebar tangga, jalur keluarnya).
    const blocksExit = spansAbs.some(([s, e]) => Math.min(e, 4) - Math.max(s, 2) > 0.1)
    expect(blocksExit).toBe(false)
  })

  it("void railing leaves a gap where a stair from the floor below actually exits (regression: baluster row blocked the stair)", () => {
    const twoFloor: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "f2", level: 2, name: "Lantai 2", heightM: 2.95 },
      ],
      rooms: [
        room({ id: "tangga", floorId: "f1", type: "tangga", x: 2, y: 3, width: 2, depth: 3, areaM2: 6, stairDirection: "n" } as Partial<Room>),
        room({ id: "void", floorId: "f2", type: "void", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 }),
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    const prims = buildModel(twoFloor, { widthM: 6, depthM: 6 }, project, opts).prims
    const cx = 3, cz = 3
    // Railing selatan void (menghadap lubang tangga di lantai bawah) — sisi
    // x:2-4 (lebar tangga, tempat tangga lurus keluar) HARUS kosong.
    const southRail = prims.filter(
      (p) => p.id.startsWith("vrail-void-") && Math.abs(p.pos[2] + cz - 3) < 0.1
    )
    const xs = southRail.map((p) => p.pos[0] + cx)
    expect(xs.some((x) => x > 2.05 && x < 3.95)).toBe(false) // kosong tepat di lebar tangga
    expect(xs.some((x) => x < 2)).toBe(true) // tapi tetap berpagar di kiri...
    expect(xs.some((x) => x > 4)).toBe(true) // ...dan kanan tangga
  })

  it("void railing on a side only PARTIALLY covered by a same-type neighbor still guards the uncovered part (regression: whole-side check missed it)", () => {
    const rooms = [
      room({ id: "void1", type: "void", x: 0, y: 0, width: 2, depth: 4, areaM2: 8 }),
      room({ id: "void2", type: "void", x: 2, y: 0, width: 2, depth: 2, areaM2: 4 }), // cuma menutup y:0-2 dari sisi timur void1 (y:0-4)
    ]
    const bigSite = { widthM: 4, depthM: 4 }
    const prims = buildModel(layout(rooms, undefined), bigSite, project, opts).prims
    const cx = 2, cz = 2
    const eastRail = prims.filter(
      (p) => p.id.startsWith("vrail-void1-") && Math.abs(p.pos[0] + cx - 2) < 0.1
    )
    const zs = eastRail.map((p) => p.pos[2] + cz)
    expect(zs.some((z) => z > 2.05 && z < 3.95)).toBe(true) // y:2-4 tak tertutup void2 -> tetap berpagar
    expect(zs.some((z) => z < 1.9)).toBe(false) // y:0-2 tertutup void2 (setipe, menyatu) -> tanpa railing dobel
  })

  it("elevated-floor facade wall closes the gap next to a void that's near but not AT the footprint edge (regression: fasad bolong)", () => {
    const twoFloor: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "f2", level: 2, name: "Lantai 2", heightM: 2.95 },
      ],
      rooms: [
        room({ id: "ground", floorId: "f1", x: 0, y: 0, width: 6, depth: 6, areaM2: 36 }),
        room({ id: "solid", floorId: "f2", x: 0, y: 0, width: 3, depth: 6, areaM2: 18 }), // dinding sendiri tepat di tepi selatan
        // void ini 0.2 m dari tepi footprint (y=6) — dalam EDGE_NEAR lama (0.5)
        // tapi DI LUAR toleransi ketat void sendiri (0.05) -> celah kalau tak diperbaiki.
        room({ id: "void", floorId: "f2", type: "void", x: 3, y: 0, width: 2.8, depth: 5.8, areaM2: 16.24 }),
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    const prims = buildModel(twoFloor, { widthM: 6, depthM: 6 }, project, opts).prims
    const cx = 3, cz = 3
    const southEdge = prims.filter(
      (p) => p.kind === "wall" && p.floorId === "f2" && Math.abs(p.pos[2] + cz - 6) < 0.1
    )
    const spans = southEdge.map((p) => {
      const c = p.pos[0] + cx
      const half = p.args[0] / 2
      return [c - half, c + half] as const
    }).sort((a, b) => a[0] - b[0])
    // Tepi selatan (y=6) harus tertutup MENERUS dari x=0 sampai x=6 — tanpa
    // celah di sekitar x=3-5.8 (bentang void yang tak menggambar dindingnya sendiri).
    expect(spans[0][0]).toBeLessThanOrEqual(0.01)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][0] - spans[i - 1][1]).toBeLessThan(0.15)
    }
    expect(spans[spans.length - 1][1]).toBeGreaterThanOrEqual(5.99)
  })

  it("tags wall prims with roomId so room materials can drive 3D surfaces", () => {
    const prims = buildModel(layout([room({ id: "a" })]), site, project, opts).prims
    expect(prims.find((p) => p.id === "w-a-n")).toMatchObject({ kind: "wall", roomId: "a" })
  })

  it("emits a riser on the higher room's stepped edge", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, levelOffsetM: 0.18 }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, levelOffsetM: 0 }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    expect(prims.some((p) => p.id === "riser-a-e" && p.kind === "riser")).toBe(true)
    expect(prims.some((p) => p.id === "riser-b-w")).toBe(false) // lower side draws nothing
  })
})

describe("buildModel — semantic exterior elements", () => {
  it("includes site-owned exterior primitives without changing legacy layouts", () => {
    const legacy = layout([room({ id: "a" })])
    const before = buildModel(legacy, site, project, opts).prims.map((p) => p.id)

    const current = structuredClone(legacy)
    current.exteriorElements = [
      {
        id: "ext-box-1",
        kind: "facade_panel",
        structuralRole: "non_structural",
        x: 2,
        y: 1,
        widthM: 1,
        depthM: 0.2,
        heightM: 2.95,
      },
    ]
    const after = buildModel(current, site, project, opts).prims

    expect(after.map((p) => p.id)).toEqual([...before, "ext-ext-box-1"])
    expect(after.at(-1)?.exteriorElement).toMatchObject({
      id: "ext-box-1",
      kind: "facade_panel",
    })
  })

  it("byte-identity: layout TANPA pergola tak berubah setelah menambah pergola di layout lain", () => {
    const legacy = layout([room({ id: "a" })])
    const before = buildModel(legacy, site, project, opts).prims

    const withPergola = structuredClone(legacy)
    withPergola.exteriorElements = [
      {
        id: "pgl-1",
        kind: "pergola",
        structuralRole: "non_structural",
        x: 2,
        y: 1,
        widthM: 3,
        depthM: 3,
        heightM: 2.4,
      },
    ]
    const after = buildModel(withPergola, site, project, opts).prims

    // Prims dari layout TANPA pergola persis sama (byte-identity) — pergola
    // murni additive di ekor array.
    expect(after.slice(0, before.length)).toEqual(before)
    const added = after.slice(before.length)
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((p) => p.exteriorElement?.id === "pgl-1")).toBe(true)
    // 4 kolom penyangga default (posts absen → true).
    expect(added.filter((p) => p.id.includes("-post-"))).toHaveLength(4)
  })
})

describe("buildModel — opening metadata", () => {
  it("uses configured opening kind, sill, head, and roomId in 3D prims", () => {
    const l = layout([room({ id: "a", width: 4, depth: 3 })])
    l.openings = [
      {
        id: "op1",
        floorId: "f1",
        wallId: "a:n",
        type: "window",
        kind: "curtain_wall",
        purpose: "vision",
        operation: "fixed",
        frameMaterial: "frameless",
        privacyLevel: "low",
        shading: "secondary_skin",
        positionM: 2,
        widthM: 2.4,
        heightM: 1.2,
        sillHeightM: 0.1,
        headHeightM: 2.7,
      },
    ]

    const prim = buildModel(l, site, project, opts).prims.find((p) => p.id === "op-op1")

    expect(prim).toMatchObject({
      kind: "window",
      roomId: "a",
      args: [2.4, 2.6, 0.18],
      opening: {
        kind: "curtain_wall",
        operation: "fixed",
        frameMaterial: "frameless",
        shading: "secondary_skin",
      },
    })
    expect(prim?.pos[1]).toBeCloseTo(0.15 + 0.1 + 2.6 / 2, 5)
  })
})

describe("buildModel — roof (datar/pelana/limasan)", () => {
  const gableSite = { widthM: 8, depthM: 6 }
  // 2026-07-12: atap mengikuti FOOTPRINT BANGUNAN (di sini room 3×3), bukan
  // kavling penuh — dimensi yang dikunci di bawah adalah dimensi footprint.
  const rooms = [room({ id: "a" })] // footprint 3×3 di (0,0)

  it("datar with no layout.roof (absent) emits the flat slab prim over the footprint", () => {
    const prims = buildModel(layout(rooms), site, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")
    expect(roof?.kind).toBe("roof")
    expect(roof?.args).toEqual([3 + 0.2, 0.15, 3 + 0.2])
  })

  it("datar with an explicit layout.roof emits the same flat slab prim", () => {
    const roofSpec: RoofSpec = { type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    const prims = buildModel(layout(rooms, roofSpec), site, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")
    expect(roof?.kind).toBe("roof")
    expect(roof?.args).toEqual([3 + 0.2, 0.15, 3 + 0.2])
  })

  it("pelana emits roof_gable with exact args (footprint 3x3, slope 30, overhang 0.5)", () => {
    const roofSpec: RoofSpec = { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    const prims = buildModel(layout(rooms, roofSpec), gableSite, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")
    expect(roof?.kind).toBe("roof_gable")
    // span = shorter footprint dim (3, square) => rise = (1.5+0.5)*tan(30deg)
    const expectedRise = (3 / 2 + 0.5) * Math.tan((30 * Math.PI) / 180)
    expect(roof?.args[0]).toBe(4) // footprint width + 2*overhang = 3 + 1
    expect(roof?.args[1]).toBeCloseTo(expectedRise, 2)
    expect(roof?.args[1]).toBeCloseTo(1.15, 2)
    expect(roof?.args[2]).toBe(4) // footprint depth + 2*overhang = 3 + 1
  })

  it("limasan emits roof_hip with the same args formula as pelana", () => {
    const roofSpec: RoofSpec = { type: "limasan", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    const prims = buildModel(layout(rooms, roofSpec), gableSite, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")
    expect(roof?.kind).toBe("roof_hip")
    expect(roof?.args).toEqual([4, roof?.args[1], 4])
    expect(roof?.args[1]).toBeCloseTo(1.15, 2)
  })

  it("clamps a persisted out-of-range slopeDeg (999) down to 40 before computing rise", () => {
    const roofSpec = { type: "pelana", slopeDeg: 999, overhangM: 0.5, material: "genteng_beton" } as RoofSpec
    const prims = buildModel(layout(rooms, roofSpec), gableSite, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")
    const expectedRise = (3 / 2 + 0.5) * Math.tan((40 * Math.PI) / 180)
    expect(roof?.args[1]).toBeCloseTo(expectedRise, 2)
  })

  it("clamps a persisted out-of-range overhangM (5) down to 1 for both rise and args padding", () => {
    const roofSpec = { type: "pelana", slopeDeg: 30, overhangM: 5, material: "genteng_beton" } as RoofSpec
    const prims = buildModel(layout(rooms, roofSpec), gableSite, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")
    const expectedRise = (3 / 2 + 1) * Math.tan((30 * Math.PI) / 180)
    expect(roof?.args[0]).toBe(5) // 3 + 2*1
    expect(roof?.args[2]).toBe(5) // 3 + 2*1
    expect(roof?.args[1]).toBeCloseTo(expectedRise, 2)
  })

  it("explicit roofZones replace the legacy global roof and keep per-zone material", () => {
    const l = layout(rooms, { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" })
    l.roofZones = [
      { id: "rz-flat", type: "datar", x: 1.5, y: 1.5, widthM: 3, depthM: 2, slopeDeg: 0, overhangM: 0.2, materialId: "metal" },
      { id: "rz-hip", type: "limasan", x: 4.5, y: 1.5, widthM: 3, depthM: 2, slopeDeg: 25, overhangM: 0.3, materialId: "aspal" },
    ]

    const prims = buildModel(l, gableSite, project, roofOpts).prims
    const roofs = prims.filter((p) => p.id.startsWith("roof"))

    expect(roofs.map((p) => p.id).sort()).toEqual(["roof-zone-rz-flat", "roof-zone-rz-hip"])
    expect(roofs.find((p) => p.id === "roof-zone-rz-flat")).toMatchObject({
      kind: "roof",
      roofMaterial: "metal",
      args: [3.2, 0.15, 2.4],
    })
    expect(roofs.find((p) => p.id === "roof-zone-rz-hip")).toMatchObject({
      kind: "roof_hip",
      roofMaterial: "aspal",
    })
  })

  it("trims overhang on internal roof-zone seams so multi-zone roofs do not z-fight", () => {
    const l = layout(
      [room({ id: "house", width: 6, depth: 6, areaM2: 36 })],
      { type: "datar", slopeDeg: 0, overhangM: 0.2, material: "genteng_beton" }
    )
    l.roofZones = [
      { id: "nw", type: "datar", x: 1.5, y: 1.5, widthM: 3, depthM: 3, slopeDeg: 0, overhangM: 0.2, materialId: "genteng_beton" },
      { id: "ne", type: "datar", x: 4.5, y: 1.5, widthM: 3, depthM: 3, slopeDeg: 0, overhangM: 0.2, materialId: "genteng_beton" },
      { id: "sw", type: "datar", x: 1.5, y: 4.5, widthM: 3, depthM: 3, slopeDeg: 0, overhangM: 0.2, materialId: "genteng_beton" },
      { id: "se", type: "datar", x: 4.5, y: 4.5, widthM: 3, depthM: 3, slopeDeg: 0, overhangM: 0.2, materialId: "genteng_beton" },
    ]

    const roofs = buildModel(l, { widthM: 6, depthM: 6 }, project, roofOpts).prims.filter((p) =>
      p.id.startsWith("roof-zone-")
    )

    expect(roofs).toHaveLength(4)
    expect(roofs.map((p) => p.args)).toEqual([
      [3.2, 0.15, 3.2],
      [3.2, 0.15, 3.2],
      [3.2, 0.15, 3.2],
      [3.2, 0.15, 3.2],
    ])

    for (let i = 0; i < roofs.length; i++) {
      for (let j = i + 1; j < roofs.length; j++) {
        expect(primsPlanOverlap(roofs[i], roofs[j])).toBe(false)
      }
    }
  })
})

describe("buildModel — atap & slab mengikuti footprint bangunan (bukan kavling)", () => {
  const bigSite = { widthM: 10, depthM: 8 } // cx=5, cz=4

  it("rumah 6×3 di kavling 10×8: slab & atap datar tepat di atas footprint, tidak menggantung di halaman", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 })])
    const prims = buildModel(l, bigSite, project, roofOpts).prims

    // Slab lantai dasar = footprint 6×3, berpusat di pusat footprint dunia
    // ((3,1.5) − (cx,cz) = (−2, −2.5)) — halaman bukan beton.
    const slab = prims.find((p) => p.id === "slab-f1")!
    expect(slab.args).toEqual([6, 0.15, 3])
    expect(slab.pos[0]).toBeCloseTo(-2, 6)
    expect(slab.pos[2]).toBeCloseTo(-2.5, 6)

    // Atap datar: footprint + lip 0.2 — tepinya berakhir 0.1 di luar dinding,
    // BUKAN di tepi kavling.
    const roof = prims.find((p) => p.id === "roof")!
    expect(roof.args).toEqual([6.2, 0.15, 3.2])
    expect(roof.pos[0]).toBeCloseTo(-2, 6)
    expect(roof.pos[2]).toBeCloseTo(-2.5, 6)
    expect(roof.pos[0] + roof.args[0] / 2).toBeCloseTo(6 - 5 + 0.1, 6) // tepi timur atap
    expect(roof.pos[2] + roof.args[2] / 2).toBeCloseTo(3 - 4 + 0.1, 6) // tepi selatan atap
  })

  it("pelana pada kavling besar: span, rise, dan posisi dari footprint (termasuk footprint tak mulai di origin)", () => {
    const l = layout(
      [room({ id: "a", x: 1, y: 1, width: 6, depth: 3, areaM2: 18 })],
      { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" }
    )
    const roof = buildModel(l, bigSite, project, roofOpts).prims.find((p) => p.id === "roof")!
    expect(roof.kind).toBe("roof_gable")
    expect(roof.args[0]).toBeCloseTo(7, 6) // 6 + 2*0.5
    expect(roof.args[2]).toBeCloseTo(4, 6) // 3 + 2*0.5
    expect(roof.args[1]).toBeCloseTo((3 / 2 + 0.5) * Math.tan((30 * Math.PI) / 180), 2)
    // pusat footprint (4, 2.5) → dunia (−1, −1.5)
    expect(roof.pos[0]).toBeCloseTo(-1, 6)
    expect(roof.pos[2]).toBeCloseTo(-1.5, 6)
  })

  it("miring pada kavling besar: run span dari footprint searah lowSide", () => {
    const l = layout(
      [room({ id: "a", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 })],
      { type: "miring", slopeDeg: 10, overhangM: 0, material: "metal", lowSide: "s" }
    )
    const roof = buildModel(l, bigSite, project, roofOpts).prims.find((p) => p.id === "roof")!
    expect(roof.kind).toBe("roof_skillion")
    // lowSide s → run sepanjang z: footprint depth 3 (bukan site depth 8)
    expect(roof.args[1]).toBeCloseTo(3 * Math.tan((10 * Math.PI) / 180), 2)
    expect(roof.args[0]).toBeCloseTo(6, 6)
    expect(roof.args[2]).toBeCloseTo(3, 6)
  })

  it("layout tanpa ruang (footprint degenerate): slab jatuh kembali ke kavling penuh", () => {
    const prims = buildModel(layout([]), site, project, opts).prims
    expect(prims.find((p) => p.id === "slab-f1")?.args).toEqual([site.widthM, 0.15, site.depthM])
  })
})

describe("buildModel — rooftop deck is the flat roof", () => {
  const WALL_H = 2.8
  const SLAB_T = 0.15
  const floorStep = WALL_H + SLAB_T
  // 2 regular floors + an open rooftop deck (the demo's shape, minified).
  const rooftopLayout = (): DesignLayout => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.95 },
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 2.95 },
      { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [
      room({ id: "a", floorId: "floor-1" }),
      room({ id: "rt", floorId: "floor-rooftop", type: "rooftop_lounge" }),
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  })
  const rooftopProject = { rooftop: true, name: "P" } as unknown as Project

  it("rests the rooftop deck slab on the top regular floor (no floating storey)", () => {
    const prims = buildModel(rooftopLayout(), site, rooftopProject, roofOpts).prims
    const deck = prims.find((p) => p.id === "slab-floor-rooftop")
    const topRegular = prims.find((p) => p.id === "slab-floor-2")
    expect(deck).toBeDefined()
    // Deck stacks exactly one storey above the top regular floor — like any
    // floor, NOT two (the old bug lifted it an extra WALL_H+SLAB_T, which buried
    // the roof under it and left an empty void between them).
    expect(deck!.pos[1]).toBeCloseTo(topRegular!.pos[1] + floorStep, 5)
    expect(deck!.pos[1]).toBeCloseTo(2 * floorStep + SLAB_T / 2, 5)
  })

  it("emits no separate roof prim for a rooftop house (the deck IS the flat roof)", () => {
    const prims = buildModel(rooftopLayout(), site, rooftopProject, roofOpts).prims
    expect(prims.find((p) => p.id === "roof")).toBeUndefined()
    // ...but the rooftop deck slab still caps the building.
    expect(prims.some((p) => p.id === "slab-floor-rooftop")).toBe(true)
  })

  it("still emits the datar roof for a non-rooftop house (regression guard)", () => {
    const prims = buildModel(layout([room({ id: "a" })]), site, project, roofOpts).prims
    expect(prims.find((p) => p.id === "roof")?.kind).toBe("roof")
  })

  it("non-rooftop house has no roof-strip prims (regression)", () => {
    const prims = buildModel(layout([room({ id: "a" })]), site, project, roofOpts).prims
    expect(prims.some((p) => p.id.startsWith("roof-strip-"))).toBe(false)
  })
})

describe("buildModel — partial rooftop (deck + roof strips)", () => {
  const SLAB_T = 0.15
  const RAIL_H = 1.0
  // Default rooftop railing style (no rooftopRailingStyle set) = "kaca", a
  // glass panel of thickness 0.05 m (rail_glass kind), id `railrt-<side>`.
  const RAIL_T = 0.05
  // Footprint 8×6 (base room on floor-1); site matches so cx/cz are clean.
  const partialSite = { widthM: 8, depthM: 6 }
  const rooftopProject = { rooftop: true, name: "P" } as unknown as Project
  const cx = partialSite.widthM / 2
  const cz = partialSite.depthM / 2

  const partialLayout = (over?: {
    rooftopArea?: RooftopArea
    roof?: RoofSpec
  }): DesignLayout =>
    ({
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
      ],
      rooms: [
        room({ id: "base", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "rt", floorId: "floor-rooftop", type: "rooftop_lounge" }),
      ],
      walls: [], openings: [], stairs: [], pools: [],
      ...(over?.rooftopArea ? { rooftopArea: over.rooftopArea } : {}),
      ...(over?.roof ? { roof: over.roof } : {}),
      validation: { passed: true, issues: [] },
    }) as DesignLayout

  // Deck strictly inside the 8×6 footprint → 4 strips, each ≥1 m short-dim.
  const DECK: RooftopArea = { x: 2, y: 2, width: 4, depth: 2 }
  const roofSpec = (type: RoofSpec["type"]): RoofSpec => ({
    type, slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
  })

  it("(a) full-rooftop (no rooftopArea): full-site deck slab + rails, no roof strip, no roof prim", () => {
    const l = partialLayout() // floor-rooftop present, rooftopArea absent
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    expect(prims.find((p) => p.id === "slab-floor-rooftop")?.args).toEqual([
      partialSite.widthM, SLAB_T, partialSite.depthM,
    ])
    const railN = prims.find((p) => p.id === "railrt-n")!
    expect(railN.kind).toBe("rail_glass")
    expect(railN.roomId).toBe(ROOFTOP_RAIL_ID)
    expect(railN.args).toEqual([partialSite.widthM, RAIL_H, RAIL_T])
    expect(prims.find((p) => p.id === "railrt-w")?.args).toEqual([RAIL_T, RAIL_H, partialSite.depthM])
    expect(prims.some((p) => p.id.startsWith("roof-strip-"))).toBe(false)
    expect(prims.find((p) => p.id === "roof")).toBeUndefined()
  })

  it("(c) partial datar: deck-sized slab, deck-perimeter rails, one 'roof' strip per rooftopStrips entry", () => {
    const l = partialLayout({ rooftopArea: DECK, roof: roofSpec("datar") })
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims

    // Deck slab = rooftopArea dims/position (not full site).
    const deckSlab = prims.find((p) => p.id === "slab-floor-rooftop")!
    expect(deckSlab.args).toEqual([DECK.width, SLAB_T, DECK.depth])
    expect(deckSlab.pos[0]).toBeCloseTo(DECK.x + DECK.width / 2 - cx, 6)
    expect(deckSlab.pos[2]).toBeCloseTo(DECK.y + DECK.depth / 2 - cz, 6)

    // Rails around the deck perimeter (not the whole site).
    const railN = prims.find((p) => p.id === "railrt-n")!
    expect(railN.args).toEqual([DECK.width, RAIL_H, RAIL_T])
    expect(railN.pos[2]).toBeCloseTo(DECK.y - cz, 6)
    const railW = prims.find((p) => p.id === "railrt-w")!
    expect(railW.args).toEqual([RAIL_T, RAIL_H, DECK.depth])
    expect(railW.pos[0]).toBeCloseTo(DECK.x - cx, 6)

    // One roof strip per strip, all datar → kind "roof"; no full-site roof prim.
    const fp = buildingFootprint(l)
    const nStrips = rooftopStrips(fp, clampRooftopArea(DECK, fp)).length
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    expect(nStrips).toBeGreaterThan(0)
    expect(strips).toHaveLength(nStrips)
    expect(strips.every((p) => p.kind === "roof")).toBe(true)
    expect(prims.find((p) => p.id === "roof")).toBeUndefined()
  })

  it("(c) partial pelana: each roof strip is a roof_gable prim", () => {
    const l = partialLayout({ rooftopArea: DECK, roof: roofSpec("pelana") })
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    expect(strips.length).toBeGreaterThan(0)
    expect(strips.every((p) => p.kind === "roof_gable")).toBe(true)
  })

  it("(c) partial limasan: each roof strip is a roof_hip prim", () => {
    const l = partialLayout({ rooftopArea: DECK, roof: roofSpec("limasan") })
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    expect(strips.length).toBeGreaterThan(0)
    expect(strips.every((p) => p.kind === "roof_hip")).toBe(true)
  })

  it("BUG FIX: rooftop rail prims carry ROOFTOP_RAIL_ID as roomId (were previously unclickable — no roomId at all)", () => {
    const l = partialLayout() // full rooftop, no deck
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    const rails = prims.filter((p) => p.id.startsWith("railrt-"))
    expect(rails.length).toBeGreaterThan(0)
    expect(rails.every((p) => p.roomId === ROOFTOP_RAIL_ID)).toBe(true)
    // Distinct from any real room id in the layout (never collides).
    expect(l.rooms.some((r) => r.id === ROOFTOP_RAIL_ID)).toBe(false)
    // floorId "floor-rooftop" → ikut sembunyi saat lantai Rooftop di-hide.
    expect(rails.every((p) => p.floorId === "floor-rooftop")).toBe(true)
  })

  it("rooftopRailingModelUrl: prim gaya bawaan (railrt-*) di-SKIP — house-model men-tile GLB", () => {
    const l = { ...partialLayout(), rooftopRailingModelUrl: "/api/v1/assets/file/railing.glb" } as DesignLayout
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    expect(prims.some((p) => p.id.startsWith("railrt-"))).toBe(false)
    // dak tetap ada (hanya VISUAL railing yg pindah ke GLB)
    expect(prims.some((p) => p.id === "slab-floor-rooftop")).toBe(true)
  })

  it("BUG FIX: railing dak render walau project.rooftop=false (gate = hasRooftopFloor, bukan flag proyek)", () => {
    // Rumah Qyfa di prod: layout PUNYA floor-rooftop tapi project.rooftop=false
    // → dulu dak & teras muncul tapi RAILING hilang total. Gate kini ke layout.
    const noFlagProject = { rooftop: false, name: "Qyfa" } as unknown as Project
    const l = partialLayout() // layout punya floor-rooftop
    const prims = buildModel(l, partialSite, noFlagProject, roofOpts).prims
    expect(prims.some((p) => p.id.startsWith("railrt-"))).toBe(true)
    // Slab dak tetap ada (konsistensi: dak + railing sama-sama dari layout).
    expect(prims.some((p) => p.id === "slab-floor-rooftop")).toBe(true)
  })

  it("rooftopRailingStyle switches the rooftop deck's rail geometry independently of any balcony", () => {
    // "base" (0,0,6,6) + "bal" (6,0,2,2) tile the same 8×6 footprint as
    // partialLayout() WITHOUT overlapping, so this is a valid, realistic layout.
    const layoutWith = (rooftopRailingStyle?: "besi") =>
      ({
        id: "l", projectId: "p", versionId: "v",
        floors: [
          { id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.95 },
          { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
        ],
        rooms: [
          room({ id: "base", floorId: "floor-1", x: 0, y: 0, width: 6, depth: 6, areaM2: 36 }),
          room({ id: "bal", floorId: "floor-1", type: "balkon", x: 6, y: 0, width: 2, depth: 2, areaM2: 4, railingStyle: "kaca" }),
          room({ id: "rt", floorId: "floor-rooftop", type: "rooftop_lounge" }),
        ],
        walls: [], openings: [], stairs: [], pools: [],
        ...(rooftopRailingStyle ? { rooftopRailingStyle } : {}),
        validation: { passed: true, issues: [] },
      }) as DesignLayout

    const kaca = buildModel(layoutWith(), partialSite, rooftopProject, roofOpts).prims
    expect(kaca.find((p) => p.id === "railrt-n")?.kind).toBe("rail_glass")
    // The balcony's OWN railing is unaffected (still glass, still keyed to its own room).
    expect(kaca.some((p) => p.id.startsWith("railg-bal-"))).toBe(true)

    const besi = buildModel(layoutWith("besi"), partialSite, rooftopProject, roofOpts).prims
    // Rooftop switched to baluster style (many thin "rail" posts, no rail_glass).
    expect(besi.some((p) => p.id.startsWith("railrt-n-") && p.kind === "rail")).toBe(true)
    expect(besi.find((p) => p.id === "railrt-n")).toBeUndefined() // glass panel gone
    // Balcony STILL renders its own glass panel — changing rooftop style must
    // not touch it (this is exactly the reported bug: editing one changed the other).
    expect(besi.some((p) => p.id.startsWith("railg-bal-"))).toBe(true)
  })

  it("(d) partial with showRoof OFF: no roof strips, but deck slab + rails remain", () => {
    const l = partialLayout({ rooftopArea: DECK, roof: roofSpec("pelana") })
    const prims = buildModel(l, partialSite, rooftopProject, opts).prims // opts.showRoof = false
    expect(prims.some((p) => p.id.startsWith("roof-strip-"))).toBe(false)
    expect(prims.find((p) => p.id === "slab-floor-rooftop")?.args).toEqual([DECK.width, SLAB_T, DECK.depth])
    expect(prims.find((p) => p.id === "railrt-n")?.args).toEqual([DECK.width, RAIL_H, RAIL_T])
  })

  it("datar strips: exact expanded-rect args + deck-facing eave stays flush (overhang only on footprint sides)", () => {
    const l = partialLayout({ rooftopArea: DECK, roof: roofSpec("datar") })
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    // footprint 8×6, deck {2,2,4,2}, overhang 0.5. Strips (T1 order S,N,W,E) with
    // overhang added ONLY on footprint-touching sides:
    //   S {0,0,8,2}+ov(s,w,e) → [9,·,2.5]; N {0,4,8,2}+ov(n,w,e) → [9,·,2.5];
    //   W {0,2,2,2}+ov(w)     → [2.5,·,2]; E {6,2,2,2}+ov(e)     → [2.5,·,2].
    const wd = strips.map((p) => [p.args[0], p.args[2]]).sort()
    expect(wd).toEqual([[2.5, 2], [2.5, 2], [9, 2.5], [9, 2.5]].sort())
    // Datar strips sit at the deck's flat-roof level (roofY + SLAB_T/2).
    const roofY = SLAB_T + 2.8 // topBaseY(0) + SLAB_T + WALL_H
    expect(strips.every((p) => Math.abs(p.pos[1] - (roofY + SLAB_T / 2)) < 1e-6)).toBe(true)
    // South strip (roof-strip-0): its deck-facing (+z) eave is flush at the deck's
    // south edge — NO overhang bleeds under the deck.
    const south = prims.find((p) => p.id === "roof-strip-0")!
    expect(south.pos[2] + south.args[2] / 2).toBeCloseTo(DECK.y - cz, 6)
  })

  it("narrow strip (<1 m short dim) stays datar even under a pelana roof", () => {
    // Deck flush on 3 sides, leaving a single 0.5 m North strip.
    const narrowDeck: RooftopArea = { x: 0, y: 0, width: 8, depth: 5.5 }
    const l = partialLayout({ rooftopArea: narrowDeck, roof: roofSpec("pelana") })
    const prims = buildModel(l, partialSite, rooftopProject, roofOpts).prims
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    expect(strips).toHaveLength(1)
    expect(strips[0].kind).toBe("roof") // forced flat, NOT roof_gable
  })
})

describe("buildModel — void gets exterior (facade) walls", () => {
  it("draws walls on void sides that lie on the building footprint boundary", () => {
    // Building 6×3: void occupies the NW corner — its n + w sides are facade.
    const rooms = [
      room({ id: "v1", type: "void", x: 0, y: 0, width: 2, depth: 3, areaM2: 6 }),
      room({ id: "liv", x: 2, y: 0, width: 4, depth: 3, areaM2: 12 }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("w-v1-n") // facade utara
    expect(ids).toContain("w-v1-w") // facade barat
    expect(ids).toContain("w-v1-s") // facade selatan (footprint depth 3 = void depth)
    expect(ids).not.toContain("w-v1-e") // sisi dalam — tetap terbuka
  })

  it("an interior void still has no walls; taman at the edge stays open", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 2, depth: 3 }),
      room({ id: "vmid", type: "void", x: 2, y: 1, width: 1, depth: 1, areaM2: 1 }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3 }),
      room({ id: "grdn", type: "taman", x: 2, y: 0, width: 1, depth: 1, areaM2: 1 }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids.some((id) => id.startsWith("w-vmid-"))).toBe(false)
    expect(ids.some((id) => id.startsWith("w-grdn-"))).toBe(false)
  })
})

describe("buildModel — door holes + open_passage", () => {
  const doorLayout = (kind?: "open_passage"): DesignLayout => {
    const l = layout([
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3 }),
    ])
    l.openings = [{
      id: "op1", floorId: "f1", wallId: "a:e", type: "door",
      ...(kind ? { kind } : {}),
      positionM: 1.5, widthM: 0.9, heightM: 2.1,
    }]
    return l
  }

  it("punches the door span out of the (single, deduped) shared wall and adds a header", () => {
    const prims = buildModel(doorLayout(), site, project, opts).prims
    // Dedupe: dinding batas digambar sekali (milik a, sisi e); b tidak
    // menggambar w-nya lagi. Lubang pintu membelah dinding itu jadi 2 span.
    expect(prims.filter((p) => p.id.startsWith("w-a-e")).length).toBe(2)
    expect(prims.filter((p) => p.id.startsWith("w-b-w")).length).toBe(0)
    // Header di atas daun pintu
    const header = prims.find((p) => p.id === "wh-op1")
    expect(header).toBeTruthy()
    expect(header!.args[1]).toBeCloseTo(2.8 - 2.1, 2)
    // Panel pintu tetap dirender untuk pintu biasa
    expect(prims.some((p) => p.id === "op-op1" && p.kind === "door")).toBe(true)
  })

  it("open_passage renders the hole + header but NO door leaf", () => {
    const prims = buildModel(doorLayout("open_passage"), site, project, opts).prims
    expect(prims.filter((p) => p.id.startsWith("w-a-e")).length).toBe(2)
    expect(prims.filter((p) => p.id.startsWith("w-b-w")).length).toBe(0)
    expect(prims.find((p) => p.id === "wh-op1")).toBeTruthy()
    expect(prims.some((p) => p.id === "op-op1")).toBe(false)
  })
})

describe("buildModel — multi-zone rooms (zoneIds)", () => {
  it("a room in TWO zones opens walls to both neighbours; the neighbours stay walled from each other", () => {
    const rooms = [
      room({ id: "kit", x: 0, y: 0, width: 2, depth: 3, zoneIds: ["zA"] }),
      room({ id: "fam", x: 2, y: 0, width: 2, depth: 3, zoneIds: ["zA", "zB"] }),
      room({ id: "din", x: 4, y: 0, width: 2, depth: 3, zoneIds: ["zB"] }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).not.toContain("w-kit-e") // kit ↔ fam terbuka (zA)
    expect(ids).not.toContain("w-fam-w")
    expect(ids).not.toContain("w-fam-e") // fam ↔ din terbuka (zB)
    expect(ids).not.toContain("w-din-w")
  })

  it("legacy zoneId interoperates with zoneIds", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3, zoneId: "z1" }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3, zoneIds: ["z1", "z9"] }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).not.toContain("w-a-e")
    expect(ids).not.toContain("w-b-w")
  })
})

describe("buildModel — shared interior walls are deduped (no z-fighting)", () => {
  it("draws a shared boundary wall exactly once (owner = room north/west of the line)", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "b", x: 3, y: 0, width: 3, depth: 3 }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("w-a-e")     // pemilik garis batas
    expect(ids).not.toContain("w-b-w") // duplikat koinsiden dihapus
    // dinding eksterior tetap utuh
    expect(ids).toContain("w-a-w")
    expect(ids).toContain("w-b-e")
  })

  it("keeps this room's wall when the neighbour is an open type (draws no walls)", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "grdn", type: "taman", x: 3, y: 0, width: 3, depth: 3 }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("w-a-e")
  })
})

describe("buildModel — dedupe juga untuk tetangga ber-gap kecil (<= tebal dinding)", () => {
  it("skips the near-duplicate wall when rooms are 5-6 cm apart (hand-drawn layouts)", () => {
    const rooms = [
      room({ id: "a", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "b", x: 0, y: 3.06, width: 3, depth: 3 }), // gap 0.06 dari a
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("w-a-s")     // pemilik (utara garis batas)
    expect(ids).not.toContain("w-b-n") // near-duplicate dihapus
  })
})

describe("buildModel — wallSide untuk cladding fasad & edit-dari-3D", () => {
  it("tags room wall prims with their side", () => {
    const prims = buildModel(layout([room({ id: "a" })]), site, project, opts).prims
    const north = prims.find((p) => p.id === "w-a-n")!
    expect(north.wallSide).toBe("n")
    expect(prims.filter((p) => p.kind === "wall" && p.roomId === "a").every((p) => p.wallSide)).toBe(true)
  })
})

describe("buildModel — railing kaca balkon", () => {
  it("emits glass panel + handrail on OPEN sides only", () => {
    const rooms = [
      room({ id: "kamar", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "balkon", type: "balkon", x: 3, y: 0, width: 2, depth: 3, areaM2: 6 }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    const glass = prims.filter((p) => p.kind === "rail_glass").map((p) => p.id).sort()
    // sisi barat menempel kamar (tertutup dinding kamar) → tanpa railing
    expect(glass).toEqual(["railg-balkon-e", "railg-balkon-n", "railg-balkon-s"])
    expect(prims.some((p) => p.id === "railh-balkon-e" && p.kind === "rail")).toBe(true)
    const panel = prims.find((p) => p.id === "railg-balkon-e")!
    expect(panel.args[1]).toBe(1.0) // tinggi railing 1,0 m
  })

  it("skips the shared edge between two adjacent balconies (menerus, no z-fight)", () => {
    const rooms = [
      room({ id: "b1", type: "balkon", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 }),
      room({ id: "b2", type: "balkon", x: 2, y: 0, width: 2, depth: 2, areaM2: 4 }),
    ]
    const ids = buildModel(layout(rooms), site, project, opts).prims.map((p) => p.id)
    expect(ids).not.toContain("railg-b1-e")
    expect(ids).not.toContain("railg-b2-w")
    expect(ids).toContain("railg-b1-w")
    expect(ids).toContain("railg-b2-e")
  })
})

describe("buildModel — louver band fasad", () => {
  it("emits fins + top/bottom rails proud of the host wall's outer face", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
    }]
    const prims = buildModel(l, site, project, opts).prims
    const fins = prims.filter((p) => p.id.startsWith("louv-fe1-"))
    expect(fins.length).toBeGreaterThanOrEqual(9) // 2.5 m / pitch 0.25
    expect(fins.every((p) => p.kind === "louver" && p.tint === "#8a6242")).toBe(true)
    // dinding utara: sirip berada DI LUAR garis dinding (z dunia < garis y=0)
    const wallLineZ = 0 - 1.5 // room.y - cz (site 6x3 → cz = 1.5)
    expect(fins.every((p) => p.pos[2] < wallLineZ)).toBe(true)
    expect(prims.some((p) => p.id === "louvr-fe1-t")).toBe(true)
    expect(prims.some((p) => p.id === "louvr-fe1-b")).toBe(true)
  })

  it("slat_horizontal: bilah HORIZONTAL (louv-*-h), tanpa sirip vertikal", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "slat_horizontal",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
    }]
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("louv-fe1-h"))).toBe(true)
    expect(prims.some((p) => p.id.startsWith("louv-fe1-v"))).toBe(false)
    expect(prims.some((p) => p.id === "louvr-fe1-t")).toBe(true)
  })

  it("roster_screen: grid — sirip vertikal DAN bilah horizontal", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "roster_screen",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
    }]
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("louv-fe1-v"))).toBe(true)
    expect(prims.some((p) => p.id.startsWith("louv-fe1-h"))).toBe(true)
  })

  it("custom model: emits one GLB envelope and skips procedural fins/rails", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "roster_screen",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      modelUrl: "/models/custom-facade.glb", modelAssetId: "asset-facade",
    }]
    const prims = buildModel(l, site, project, opts).prims
    const model = prims.find((p) => p.id === "louv-fe1-model")!
    expect(model.kind).toBe("louver")
    expect(model.facadeElement?.modelUrl).toBe("/models/custom-facade.glb")
    expect(model.args).toEqual([2.5, 2.2, 0.15])
    expect(prims.some((p) => p.id.startsWith("louv-fe1-v"))).toBe(false)
    expect(prims.some((p) => p.id.startsWith("louv-fe1-h"))).toBe(false)
    expect(prims.some((p) => p.id.startsWith("louvr-fe1-"))).toBe(false)
  })
})

describe("buildModel — pola kustom kisi/roster (ComponentPatternSpec)", () => {
  it("byte-identity: tanpa pattern jumlah/args bilah PERSIS jalur lama", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
    }]
    const prims = buildModel(l, site, project, opts).prims
    const fins = prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    // span 2.5 / PITCH 0.25 = 10 pas — jalur lama pakai vCount = floor(span/PITCH).
    expect(fins).toHaveLength(10)
    expect(fins.every((p) => p.args[0] === 0.08 && p.args[2] === 0.15)).toBe(true)

    // pattern:undefined eksplisit tak boleh menyimpang dari absen sama sekali.
    const withUndefined = structuredClone(l)
    withUndefined.facadeElements![0].pattern = undefined
    expect(buildModel(withUndefined, site, project, opts).prims).toEqual(prims)
  })

  it("pitch custom mengubah jumlah bilah sesuai rumus floor(span/pitch)", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.2, widthM: 2.4, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { pitchM: 0.4 },
    }]
    const prims = buildModel(l, site, project, opts).prims
    const fins = prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(fins).toHaveLength(6) // 2.4 / 0.4
    expect(fins.every((p) => p.args[0] === 0.08)).toBe(true) // barWidthM absen → fallback FIN_W

    const wider = structuredClone(l)
    wider.facadeElements![0].pattern = { pitchM: 0.8 }
    const finsWider = buildModel(wider, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(finsWider).toHaveLength(3)
  })

  it("barWidthM/barDepthM custom menggantikan konstanta FIN_W/FIN_D", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.2, widthM: 2.4, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { pitchM: 0.4, barWidthM: 0.12, barDepthM: 0.25 },
    }]
    const fins = buildModel(l, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(fins.every((p) => p.args[0] === 0.12 && p.args[2] === 0.25)).toBe(true)
  })

  it("rhythm [1,1] menghasilkan lebih sedikit bilah daripada pitch seragam", () => {
    const base = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    base.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.2, widthM: 2.4, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { pitchM: 0.4 },
    }]
    const uniformCount = buildModel(base, site, project, opts).prims
      .filter((p) => p.id.startsWith("louv-fe1-v")).length

    const rhythm = structuredClone(base)
    rhythm.facadeElements![0].pattern = { pitchM: 0.4, rhythm: [1, 1] }
    const rhythmCount = buildModel(rhythm, site, project, opts).prims
      .filter((p) => p.id.startsWith("louv-fe1-v")).length

    expect(rhythmCount).toBeLessThan(uniformCount)
  })

  it("orientation grid menghasilkan bilah 2 arah (vertikal DAN horizontal) walau kind louver_band", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { orientation: "grid", pitchM: 0.5 },
    }]
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("louv-fe1-v"))).toBe(true)
    expect(prims.some((p) => p.id.startsWith("louv-fe1-h"))).toBe(true)
  })

  it("frame:true menambah bingkai kiri/kanan (louvr-*-l/-r) selain rel atas/bawah", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { pitchM: 0.5, frame: true },
    }]
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.some((p) => p.id === "louvr-fe1-t")).toBe(true)
    expect(prims.some((p) => p.id === "louvr-fe1-b")).toBe(true)
    expect(prims.some((p) => p.id === "louvr-fe1-l")).toBe(true)
    expect(prims.some((p) => p.id === "louvr-fe1-r")).toBe(true)
  })
})

describe("buildModel — colorHex kustom elemen fasad (panel sirip/fluted)", () => {
  it("byte-identity: colorHex absen (juga undefined eksplisit) → tint identik dgn LOUVER_FINISH_COLORS[finish], PERSIS jalur lama", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
    }]
    const prims = buildModel(l, site, project, opts).prims
    const fins = prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(fins.length).toBeGreaterThan(0)
    expect(fins.every((p) => p.tint === "#8a6242")).toBe(true) // LOUVER_FINISH_COLORS.kayu

    const withUndefined = structuredClone(l)
    withUndefined.facadeElements![0].colorHex = undefined
    expect(buildModel(withUndefined, site, project, opts).prims).toEqual(prims)
  })

  it("colorHex kustom menang atas warna finish pada bilah, tapi rel/bingkai keliling TETAP warna metal tetap", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      colorHex: "#6f4e37",
    }]
    const prims = buildModel(l, site, project, opts).prims
    const fins = prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(fins.length).toBeGreaterThan(0)
    expect(fins.every((p) => p.tint === "#6f4e37")).toBe(true)
    // Rel atas/bawah tak ikut colorHex (selalu abu-abu metal).
    expect(prims.find((p) => p.id === "louvr-fe1-t")?.tint).toBe("#3c4245")
    expect(prims.find((p) => p.id === "louvr-fe1-b")?.tint).toBe("#3c4245")
  })

  it("colorHex berlaku juga di jalur pattern kustom (bukan hanya jalur numerik lama)", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "putih",
      colorHex: "#6f4e37",
      pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
    }]
    const prims = buildModel(l, site, project, opts).prims
    const fins = prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(fins.length).toBeGreaterThan(0)
    expect(fins.every((p) => p.tint === "#6f4e37")).toBe(true)
  })

  it("preset panel sirip (fluted): pitch 0.07 pada bidang penuh menghasilkan jumlah bilah floor(span/pitch)", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 3, sillHeightM: 0, heightM: 2.95, finish: "kayu",
      pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
    }]
    const fins = buildModel(l, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-v"))
    expect(fins).toHaveLength(Math.floor(3 / 0.07)) // 42
    expect(fins.every((p) => p.args[0] === 0.025 && p.args[2] === 0.02)).toBe(true)
  })
})

describe("buildModel — pattern.inset (nat beton/reveal line)", () => {
  it("byte-identity: inset absen === inset:false eksplisit — prims identik (jalur proud tak berubah)", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { orientation: "h", pitchM: 0.8, barWidthM: 0.02, barDepthM: 0.012 },
    }]
    const prims = buildModel(l, site, project, opts).prims

    const withFalse = structuredClone(l)
    withFalse.facadeElements![0].pattern = {
      orientation: "h", pitchM: 0.8, barWidthM: 0.02, barDepthM: 0.012, inset: false,
    }
    expect(buildModel(withFalse, site, project, opts).prims).toEqual(prims)
  })

  it("inset:true membalik arah standoff: bilah tenggelam DI DALAM ketebalan dinding (bukan menonjol proud)", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { orientation: "h", pitchM: 0.8, barWidthM: 0.02, barDepthM: 0.012 },
    }]
    const proudBars = buildModel(l, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-h"))
    expect(proudBars.length).toBeGreaterThan(0)
    // Jalur proud (jalur lama, tak berubah): standoff = WALL_T/2 + 0.06 + FIN_D/2 (FIN_D=0.15) → 0.195.
    expect(Math.abs(proudBars[0].pos[2])).toBeGreaterThan(WALL_T / 2)

    const inset = structuredClone(l)
    inset.facadeElements![0].pattern = {
      orientation: "h", pitchM: 0.8, barWidthM: 0.02, barDepthM: 0.012, inset: true,
    }
    const insetBars = buildModel(inset, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-h"))
    expect(insetBars.length).toBe(proudBars.length)

    // czOff identik di kedua kasus (geometri dinding sama) — derivasi dari
    // constant standoff proud yang sudah diketahui (0.195) & out=-1 (wall "a:n").
    const czOff = proudBars[0].pos[2] + 0.195
    // barDepthM 0.012 di bawah batas aman (WALL_T/2-0.01=0.05) → tak diclamp;
    // barStandoff = WALL_T/2 - 0.01 - 0.012/2 = 0.044.
    const expectedZ = czOff - 0.044
    for (const b of insetBars) {
      expect(b.pos[2]).toBeCloseTo(expectedZ, 6)
      // Pusat bilah lebih dekat ke sumbu dinding (0) drpd muka luar (±WALL_T/2).
      expect(Math.abs(b.pos[2] - czOff)).toBeLessThan(WALL_T / 2)
      // Tidak melewati sisi dalam dinding (muka dalam = -WALL_T/2 dari sumbu, out=-1).
      const innerFace = Math.abs(b.pos[2] - czOff) - b.args[2] / 2
      expect(innerFace).toBeGreaterThanOrEqual(-1e-9)
      expect(b.args[2]).toBeCloseTo(0.012, 6) // barDepthM tak diclamp (di bawah batas aman)
    }
  })

  it("inset:true dgn barDepthM besar (0.6) diclamp aman ≈ WALL_T/2 - 0.01, tak tembus sisi dalam", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 3, depth: 3 })])
    l.facadeElements = [{
      id: "fe1", wallId: "a:n", floorId: "f1", kind: "louver_band",
      positionM: 1.5, widthM: 2.5, sillHeightM: 0.3, heightM: 2.2, finish: "kayu",
      pattern: { orientation: "h", pitchM: 0.8, barWidthM: 0.02, barDepthM: 0.6, inset: true },
    }]
    const bars = buildModel(l, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-h"))
    expect(bars.length).toBeGreaterThan(0)
    const maxDepth = WALL_T / 2 - 0.01
    for (const b of bars) {
      expect(b.args[2]).toBeCloseTo(maxDepth, 6) // diclamp, bukan 0.6 mentah
    }
    // Bandingkan thd czOff (sama spt test sebelumnya via constant proud 0.195).
    const proud = structuredClone(l)
    proud.facadeElements![0].pattern = { orientation: "h", pitchM: 0.8, barWidthM: 0.02, barDepthM: 0.6 }
    const proudBars = buildModel(proud, site, project, opts).prims.filter((p) => p.id.startsWith("louv-fe1-h"))
    const czOff = proudBars[0].pos[2] + 0.195
    for (const b of bars) {
      const distFromAxis = Math.abs(b.pos[2] - czOff)
      const innerFace = distFromAxis - b.args[2] / 2
      // Sisi dalam dinding ada di jarak WALL_T/2 dari sumbu (arah berlawanan) —
      // batang tak boleh sampai ke sana sama sekali (bahkan tak boleh dekat 0
      // dilewati ke arah negatif, tapi disini cukup pastikan tak melewati sisi
      // dalam yakni distFromAxis+depth/2 tak pernah representasikan tembus).
      expect(innerFace).toBeGreaterThanOrEqual(-1e-9)
      expect(distFromAxis).toBeLessThan(WALL_T / 2)
    }
  })
})

describe("buildModel — kanopi carport", () => {
  it("standalone carport: canopy slab + 4 tiang", () => {
    const prims = buildModel(
      layout([room({ id: "cp", type: "carport", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 })]),
      site, project, opts
    ).prims
    expect(prims.some((p) => p.id === "cpr-cp" && p.kind === "roof")).toBe(true)
    expect(prims.filter((p) => p.id.startsWith("cpp-cp-"))).toHaveLength(4)
  })

  it("menempel rumah: tiang sisi rumah dilewati; tertutup lantai atas: tanpa kanopi", () => {
    const attached = buildModel(
      layout([
        room({ id: "rumah", x: 0, y: 0, width: 3, depth: 3 }),
        room({ id: "cp", type: "carport", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 }),
      ]),
      site, project, opts
    ).prims
    // sisi barat menempel rumah → tiang nw & sw dilewati
    expect(attached.filter((p) => p.id.startsWith("cpp-cp-")).map((p) => p.id).sort())
      .toEqual(["cpp-cp-ne", "cpp-cp-se"])

    const covered: ReturnType<typeof layout> = {
      ...layout([room({ id: "cp", type: "carport", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 })]),
      floors: [
        { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "f2", level: 2, name: "Lantai 2", heightM: 2.95 },
      ],
    }
    covered.rooms.push(room({ id: "atas", floorId: "f2", x: 0, y: 0, width: 3, depth: 3 }))
    const prims = buildModel(covered, site, project, opts).prims
    expect(prims.some((p) => p.id === "cpr-cp")).toBe(false)
  })

  it("respects explicit carportCanopyMode none for custom canopy modelling", () => {
    const prims = buildModel(
      layout([
        room({
          id: "cp",
          type: "carport",
          x: 0,
          y: 0,
          width: 3,
          depth: 3,
          areaM2: 9,
          carportCanopyMode: "none",
        }),
      ]),
      site,
      project,
      opts,
    ).prims

    expect(prims.some((p) => p.id === "cpr-cp")).toBe(false)
    expect(prims.some((p) => p.id.startsWith("cpp-cp-"))).toBe(false)
  })
})

describe("buildModel — anak tangga untuk ruang tipe tangga", () => {
  it("solid steps fill the room, ascending toward stairDirection, top step = floor rise", () => {
    const rooms = [
      room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3, areaM2: 3.6, stairDirection: "s" }),
    ]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    const steps = prims.filter((p) => p.kind === "stair")
    expect(steps.length).toBeGreaterThanOrEqual(14) // rise 2.95 / ~0.18
    // naik ke selatan: anak terakhir (tertinggi) di y terbesar
    const last = steps[steps.length - 1]
    const first = steps[0]
    expect(last.pos[2]).toBeGreaterThan(first.pos[2])
    expect(last.args[1]).toBeCloseTo(2.95, 2) // WALL_H + SLAB_T
    // tanpa placeholder furniture di ruang tangga
    expect(prims.some((p) => p.id === "f-tg")).toBe(false)
  })

  it("defaults the run along the LONGER side", () => {
    const prims = buildModel(
      layout([room({ id: "tg", type: "tangga", x: 0, y: 0, width: 3, depth: 1.2, areaM2: 3.6 })]),
      site, project, opts
    ).prims
    const steps = prims.filter((p) => p.kind === "stair")
    // lebar 3 > dalam 1.2 → run sepanjang x (default "e"): anak tangga bertambah x
    expect(steps[steps.length - 1].pos[0]).toBeGreaterThan(steps[0].pos[0])
  })
})

describe("buildModel — handrail tangga", () => {
  it("stepped handrail on both sides + posts every 4 steps", () => {
    const prims = buildModel(
      layout([room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3, areaM2: 3.6, stairDirection: "s" })]),
      site, project, opts
    ).prims
    const steps = prims.filter((p) => p.kind === "stair")
    const rails = prims.filter((p) => p.id.startsWith("strail-tg-"))
    expect(rails).toHaveLength(steps.length * 2) // dua sisi
    expect(prims.some((p) => p.id.startsWith("strailp-tg-"))).toBe(true)
    // rel duduk 0,9 m di atas puncak anak tangganya
    const firstStep = steps[0]
    const firstRail = rails.find((r) => r.id === "strail-tg-a-0")!
    expect(firstRail.pos[1]).toBeCloseTo(firstStep.pos[1] + firstStep.args[1] / 2 + 0.9, 2)
  })
})

describe("buildModel — jendela melubangi dinding sungguhan", () => {
  it("wall span is cut at the window; sill + header strips carry wallSide", () => {
    const l = layout([room({ id: "a", x: 0, y: 0, width: 4, depth: 3 })])
    l.openings = [{
      id: "op-w1", type: "window", wallId: "a:n", widthM: 1.2, heightM: 1.2,
      positionM: 2, sillHeightM: 0.9, floorId: "f1",
    }]
    const prims = buildModel(l, site, project, opts).prims
    // dinding utara terpecah dua segmen (kiri & kanan jendela)
    const northSegs = prims.filter((p) => p.id.startsWith("w-a-n"))
    expect(northSegs.length).toBe(2)
    // ambang bawah + balok atas ada, membawa wallSide utk cladding
    const sill = prims.find((p) => p.id === "ws-op-w1")!
    const header = prims.find((p) => p.id === "wh-op-w1")!
    expect(sill.args[1]).toBeCloseTo(0.9, 2)
    expect(sill.wallSide).toBe("n")
    expect(header.wallSide).toBe("n")
    // balok atas: dari head (0.9+1.2=2.1) sampai plafon 2.8 → tinggi 0.7
    expect(header.args[1]).toBeCloseTo(0.7, 2)
  })
})

describe("buildModel — model railing balkon (railingStyle)", () => {
  const balkon = (style?: "kaca" | "besi" | "tembok" | "kayu") =>
    buildModel(
      layout([room({ id: "b", type: "balkon", x: 0, y: 0, width: 2.4, depth: 2, areaM2: 4.8, ...(style ? { railingStyle: style } : {}) })]),
      site, project, opts
    ).prims

  it("default kaca: panel rail_glass + handrail", () => {
    const prims = balkon()
    expect(prims.some((p) => p.id === "railg-b-n" && p.kind === "rail_glass")).toBe(true)
    expect(prims.some((p) => p.id === "railh-b-n" && p.kind === "rail")).toBe(true)
  })

  it("besi: baluster vertikal banyak; kayu: 3 bilah + tiang; tembok: parapet kind wall (claddable)", () => {
    const besi = balkon("besi")
    expect(besi.filter((p) => p.id.startsWith("railb-b-n-")).length).toBeGreaterThanOrEqual(15)
    const kayu = balkon("kayu")
    expect(kayu.filter((p) => p.id.startsWith("railb-b-n-"))).toHaveLength(3)
    expect(kayu.some((p) => p.id.startsWith("railp-b-n-"))).toBe(true)
    expect(kayu.find((p) => p.id === "railb-b-n-0")?.tint).toBe("#8a6242")
    const tembok = balkon("tembok")
    const parapet = tembok.find((p) => p.id === "railg-b-n")!
    expect(parapet.kind).toBe("wall")
    expect(parapet.wallSide).toBe("n")
    expect(tembok.some((p) => p.id === "railh-b-n")).toBe(false) // tanpa handrail terpisah
  })
})

describe("buildModel — balkon tepi melengkung (edgeBowM)", () => {
  const rooms = (bow?: number, style?: "kaca" | "besi" | "tembok" | "kayu", railingModelUrl?: string) => [
    room({ id: "kamar", x: 0, y: 0, width: 3, depth: 3 }),
    room({
      id: "balkon", type: "balkon", x: 3, y: 0, width: 2, depth: 3, areaM2: 6,
      ...(bow != null ? { edgeBowM: bow } : {}),
      ...(style ? { railingStyle: style } : {}),
      ...(railingModelUrl ? { railingModelUrl } : {}),
    }),
  ]
  // Setup persis "railing kaca balkon" di atas: kamar menutup sisi w →
  // hazardOpenSides(balkon) = e,n,s; footprint bbox = union(kamar,balkon) =
  // x:0–5,y:0–3 → sisi e (x:3–5) paling menjorok keluar pusat footprint →
  // balconyBowSide memilih "e" sebagai depan. n/s = samping (tetap lurus).

  it("edgeBowM absen ATAU 0 → prims IDENTIK dgn jalur lurus lama (byte-identity)", () => {
    const withoutField = buildModel(layout(rooms()), site, project, opts).prims
    const withZero = buildModel(layout(rooms(0)), site, project, opts).prims
    expect(withZero).toEqual(withoutField)
    expect(withoutField.some((p) => p.id.startsWith("slabb-"))).toBe(false)
    expect(withoutField.some((p) => /-b\d+$/.test(p.id))).toBe(false)
    expect(withoutField.map((p) => p.id)).toContain("railg-balkon-e") // jalur lurus lama tetap ada
  })

  it("membusurkan HANYA sisi paling menjorok keluar (e); pelat & railing sisi samping (n/s) tak berubah", () => {
    const straight = buildModel(layout(rooms()), site, project, opts).prims
    const bowed = buildModel(layout(rooms(0.5)), site, project, opts).prims

    expect(bowed.find((p) => p.id === "railg-balkon-n")).toEqual(straight.find((p) => p.id === "railg-balkon-n"))
    expect(bowed.find((p) => p.id === "railg-balkon-s")).toEqual(straight.find((p) => p.id === "railg-balkon-s"))
    expect(bowed.some((p) => p.id.startsWith("slabb-balkon-n-"))).toBe(false)
    expect(bowed.some((p) => p.id.startsWith("slabb-balkon-s-"))).toBe(false)
    expect(bowed.some((p) => p.id.startsWith("slabb-balkon-w-"))).toBe(false)

    // Pelat lantai sisi e: BOW_FLOOR_SEGMENTS strip kipas.
    const floorStrips = bowed.filter((p) => p.id.startsWith("slabb-balkon-e-"))
    expect(floorStrips).toHaveLength(BOW_FLOOR_SEGMENTS)
    expect(floorStrips.every((p) => p.kind === "slab")).toBe(true)
    // Sisi e = VERTIKAL (w/e) → args = [vDepth, SLAB_T, uLen]. Strip TENGAH
    // (indeks (N-1)/2, N ganjil) menonjol PERSIS edgeBowM.
    const midStrip = floorStrips[(BOW_FLOOR_SEGMENTS - 1) / 2]
    expect(midStrip.args[0]).toBeCloseTo(0.5, 6)
    expect(floorStrips[0].args[0]).toBeLessThan(midStrip.args[0]) // strip ujung menyatu ke sudut lurus

    // Railing sisi e: id lama hilang, diganti BOW_RAIL_SEGMENTS segmen pendek beranjak sudut.
    expect(bowed.some((p) => p.id === "railg-balkon-e")).toBe(false)
    const railSegs = bowed.filter((p) => p.kind === "rail_glass" && p.id.startsWith("railg-balkon-e-b"))
    expect(railSegs).toHaveLength(BOW_RAIL_SEGMENTS)
    const rotations = railSegs.map((p) => Math.abs(p.rotationY ?? 0))
    expect(Math.max(...rotations)).toBeGreaterThan(Math.abs(rotations[0])) // segmen tengah paling curam
    const totalLen = railSegs.reduce((sum, p) => sum + p.args[0], 0)
    expect(totalLen).toBeGreaterThan(3) // polyline busur > chord lurus (3 m, = depth ruang)
  })

  it("besi/kayu/tembok tetap berlaku di tepi busur — jumlah segmen bertambah drpd satu span lurus", () => {
    const besi = buildModel(layout(rooms(0.4, "besi")), site, project, opts).prims
    expect(besi.filter((p) => p.id.startsWith("railb-balkon-e-b")).length).toBeGreaterThan(BOW_RAIL_SEGMENTS)

    const kayu = buildModel(layout(rooms(0.4, "kayu")), site, project, opts).prims
    expect(kayu.filter((p) => /^railb-balkon-e-b\d+-\d+$/.test(p.id))).toHaveLength(BOW_RAIL_SEGMENTS * 3)
    expect(kayu.filter((p) => p.id.startsWith("railp-balkon-e-b")).length).toBeGreaterThan(0)

    const tembok = buildModel(layout(rooms(0.4, "tembok")), site, project, opts).prims
    const parapets = tembok.filter((p) => p.id.startsWith("railg-balkon-e-b") && p.kind === "wall")
    expect(parapets).toHaveLength(BOW_RAIL_SEGMENTS)
    expect(tembok.some((p) => p.id.startsWith("railh-balkon-e-b"))).toBe(false) // tembok: tanpa handrail terpisah
  })

  it("railingModelUrl kustom: tanpa prim railing gaya bawaan di sisi e, TAPI pelat lantai busur tetap muncul", () => {
    const prims = buildModel(layout(rooms(0.4, undefined, "https://example.com/r.glb")), site, project, opts).prims
    expect(prims.some((p) => p.kind === "rail_glass" || p.id.startsWith("railb-balkon-e-"))).toBe(false)
    expect(prims.filter((p) => p.id.startsWith("slabb-balkon-e-"))).toHaveLength(BOW_FLOOR_SEGMENTS)
  })

  it("edgeBowM tak wajar (> separuh panjang tepi) di-clamp — geometri tetap waras", () => {
    const prims = buildModel(layout(rooms(999)), site, project, opts).prims
    const midStrip = prims.filter((p) => p.id.startsWith("slabb-balkon-e-"))[(BOW_FLOOR_SEGMENTS - 1) / 2]
    expect(midStrip.args[0]).toBeCloseTo(1.5, 6) // clamp(edgeBowM, 0, 1.5) build-model
  })
})

describe("buildModel — atap miring (skillion) & lis fascia", () => {
  it("type miring: satu prim roof_skillion dengan dir = lowSide, rise = bentang penuh × tan(slope)", () => {
    const l = layout([room({ id: "a", width: 6, depth: 3 })], {
      type: "miring", slopeDeg: 10, overhangM: 0.5, material: "metal", lowSide: "e",
    })
    const prims = buildModel(l, site, project, roofOpts).prims
    const roof = prims.find((p) => p.id === "roof")!
    expect(roof.kind).toBe("roof_skillion")
    expect(roof.dir).toBe("e")
    // lowSide e → kemiringan sepanjang x: run = widthM + 2·ov = 7 m
    expect(roof.args[1]).toBeCloseTo(7 * Math.tan((10 * Math.PI) / 180), 2)
    expect(roof.args[0]).toBeCloseTo(7, 5)
  })

  it("miring slope di-clamp min 5° (bukan 15°) dan lowSide default s", () => {
    const l = layout([room({ id: "a" })], {
      type: "miring", slopeDeg: 5, overhangM: 0, material: "metal",
    })
    const roof = buildModel(l, site, project, roofOpts).prims.find((p) => p.id === "roof")!
    expect(roof.dir).toBe("s")
    // slope 5 dipertahankan: rise = depthM(3) × tan(5°)
    expect(roof.args[1]).toBeCloseTo(3 * Math.tan((5 * Math.PI) / 180), 2)
  })

  it("atap datar + fascia: 4 band kind fascia keliling tepi, tint sesuai warna", () => {
    const l = layout([room({ id: "a" })], {
      type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
      fascia: { heightM: 0.4, color: "#1d2022" },
    })
    const prims = buildModel(l, site, project, roofOpts).prims
    const bands = prims.filter((p) => p.kind === "fascia" && p.id.startsWith("fascia-roof-"))
    expect(bands).toHaveLength(4)
    expect(bands[0].tint).toBe("#1d2022")
    expect(bands[0].args[1]).toBeCloseTo(0.4, 5)
  })

  it("tanpa roof.fascia: tidak ada prim fascia (perilaku lama utuh)", () => {
    const prims = buildModel(layout([room({ id: "a" })]), site, project, roofOpts).prims
    expect(prims.some((p) => p.kind === "fascia")).toBe(false)
  })

  it("balkon + fascia: band di tepi dak sisi TERBUKA balkon", () => {
    const l = layout(
      [room({ id: "b", type: "balkon", x: 0, y: 0, width: 2.4, depth: 2, areaM2: 4.8 })],
      { type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton", fascia: { heightM: 0.35, color: "#3c4245" } }
    )
    const prims = buildModel(l, site, project, opts).prims
    const band = prims.find((p) => p.id === "fasciab-b-n")
    expect(band).toBeDefined()
    expect(band!.kind).toBe("fascia")
    expect(band!.tint).toBe("#3c4245")
  })

  it("BUG A — atap pelana + fascia: band di 2 sisi EAVE (sejajar bubungan), bukan di ujung sopi-sopi", () => {
    const l = layout([room({ id: "a", width: 6, depth: 3 })], {
      type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
      fascia: { heightM: 0.35, color: "#f5f2ea" },
    })
    const prims = buildModel(l, site, project, roofOpts).prims
    const bands = prims.filter((p) => p.kind === "fascia" && p.id.startsWith("fascia-roof-"))
    // bentang x (6+2·0.5=7) >= bentang z (3+2·0.5=4) → bubungan sejajar x →
    // eave (tepi rendah) ada di sisi n & s saja; w/e = ujung sopi-sopi (tegak).
    expect(bands.map((p) => p.id).sort()).toEqual(["fascia-roof-n", "fascia-roof-s"])
    expect(bands.every((p) => p.tint === "#f5f2ea")).toBe(true)
  })

  it("BUG A — atap pelana tanpa fascia: tidak ada prim fascia (byte-identik legacy)", () => {
    const l = layout([room({ id: "a", width: 6, depth: 3 })], {
      type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
    })
    const prims = buildModel(l, site, project, roofOpts).prims
    expect(prims.some((p) => p.kind === "fascia")).toBe(false)
  })

  it("BUG A — atap limasan + fascia: 4 bidang miring semua turun ke roofY → band di 4 sisi", () => {
    const l = layout([room({ id: "a", width: 6, depth: 3 })], {
      type: "limasan", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
      fascia: { heightM: 0.35, color: "#f5f2ea" },
    })
    const prims = buildModel(l, site, project, roofOpts).prims
    const bands = prims.filter((p) => p.kind === "fascia" && p.id.startsWith("fascia-roof-"))
    expect(bands.map((p) => p.id).sort()).toEqual(["fascia-roof-e", "fascia-roof-n", "fascia-roof-s", "fascia-roof-w"])
  })

  it("BUG A — atap miring + fascia: hanya sisi RENDAH (lowSide) yang dapat band", () => {
    const l = layout([room({ id: "a", width: 6, depth: 3 })], {
      type: "miring", slopeDeg: 10, overhangM: 0.5, material: "metal", lowSide: "e",
      fascia: { heightM: 0.3, color: "#f5f2ea" },
    })
    const prims = buildModel(l, site, project, roofOpts).prims
    const bands = prims.filter((p) => p.kind === "fascia" && p.id.startsWith("fascia-roof-"))
    expect(bands.map((p) => p.id)).toEqual(["fascia-roof-e"])
  })

  it("partial rooftop + miring: strip dirender slab datar (kind roof), bukan wedge", () => {
    const l = layout([room({ id: "a", width: 6, depth: 3 })], {
      type: "miring", slopeDeg: 10, overhangM: 0, material: "metal",
    })
    l.floors = [
      { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0 },
    ]
    l.rooftopArea = { x: 0, y: 0, width: 3, depth: 3 }
    const prims = buildModel(l, site, project, roofOpts).prims
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    expect(strips.length).toBeGreaterThan(0)
    expect(strips.every((p) => p.kind === "roof")).toBe(true)
  })
})

describe("buildModel — strip header/ambang memakai identitas PEMILIK dinding", () => {
  it("bukaan di dinding w ruang timur → wh- membawa roomId ruang barat + side e (selaras dedupe)", () => {
    const rooms = [
      room({ id: "barat", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "timur", x: 3, y: 0, width: 3, depth: 3 }),
    ]
    const l = layout(rooms)
    l.openings = [{
      id: "opd", floorId: "f1", wallId: "timur:w", type: "door", kind: "hinged_door",
      positionM: 1, widthM: 0.9, heightM: 2.1,
    }]
    const wh = buildModel(l, site, project, opts).prims.find((p) => p.id === "wh-opd")!
    expect(wh).toBeDefined()
    expect(wh.roomId).toBe("barat")
    expect(wh.wallSide).toBe("e")
  })

  it("bukaan di dinding s (ruang ini pemilik garis) atau tanpa tetangga solid → key milik sendiri", () => {
    const rooms = [
      room({ id: "utara", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "selatan", x: 0, y: 3, width: 3, depth: 3 }),
    ]
    const l = layout(rooms)
    l.openings = [
      { id: "ops", floorId: "f1", wallId: "utara:s", type: "door", kind: "hinged_door", positionM: 1, widthM: 0.9, heightM: 2.1 },
      { id: "opw", floorId: "f1", wallId: "utara:w", type: "window", kind: "sliding_window", positionM: 1, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
    ]
    const prims = buildModel(l, site, project, opts).prims
    const whS = prims.find((p) => p.id === "wh-ops")!
    expect(whS.roomId).toBe("utara")
    expect(whS.wallSide).toBe("s")
    // dinding w utara = tepi luar (tanpa tetangga) → tetap key sendiri; ambang jendela ikut
    const wsW = prims.find((p) => p.id === "ws-opw")!
    expect(wsW.roomId).toBe("utara")
    expect(wsW.wallSide).toBe("w")
  })

  it("tetangga tipe OPEN (taman) tidak mengambil kepemilikan strip", () => {
    const rooms = [
      room({ id: "taman1", type: "taman", x: 0, y: 0, width: 3, depth: 3 }),
      room({ id: "timur", x: 3, y: 0, width: 3, depth: 3 }),
    ]
    const l = layout(rooms)
    l.openings = [{
      id: "opd", floorId: "f1", wallId: "timur:w", type: "door", kind: "hinged_door",
      positionM: 1, widthM: 0.9, heightM: 2.1,
    }]
    const wh = buildModel(l, site, project, opts).prims.find((p) => p.id === "wh-opd")!
    expect(wh.roomId).toBe("timur")
    expect(wh.wallSide).toBe("w")
  })
})

describe("buildModel — railing GLB kustom (railingModelUrl)", () => {
  it("hazardOpenSides: sisi menempel ruang solid tertutup; balkon tetangga menerus", () => {
    const b = room({ id: "b", type: "balkon", x: 3, y: 0, width: 2, depth: 2, areaM2: 4 })
    const others = [
      room({ id: "kamar", x: 3, y: 2, width: 2, depth: 2, areaM2: 4 }), // selatan b
      room({ id: "b2", type: "balkon", x: 5, y: 0, width: 1, depth: 2, areaM2: 2 }), // timur b
    ]
    expect(hazardOpenSides(b, others).sort()).toEqual(["n", "w"])
    expect(hazardOpenSides(b, []).sort()).toEqual(["e", "n", "s", "w"])
  })

  it("hazardOpenSides: tetangga solid SEZONA jadi terbuka juga (dindingnya di-drop)", () => {
    const b = room({ id: "b", type: "balkon", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, zoneId: "z1" })
    const others = [
      room({ id: "n", x: 3, y: -2, width: 2, depth: 2, areaM2: 4 }), // utara b, beda zona -> tertutup
      room({ id: "s", x: 3, y: 2, width: 2, depth: 2, areaM2: 4, zoneId: "z1" }), // selatan b, sezona -> terbuka
      room({ id: "w", x: 1, y: 0, width: 2, depth: 2, areaM2: 4 }), // barat b, beda zona -> tertutup
      room({ id: "e", x: 5, y: 0, width: 2, depth: 2, areaM2: 4 }), // timur b, beda zona -> tertutup
    ]
    expect(hazardOpenSides(b, others).sort()).toEqual(["s"])
  })

  it("railingModelUrl aktif: prim gaya bawaan di-skip, fascia dak tetap digambar", () => {
    const mk = (withModel: boolean) =>
      buildModel(
        layout(
          [room({
            id: "b", type: "balkon", x: 0, y: 0, width: 2.4, depth: 2, areaM2: 4.8,
            ...(withModel ? { railingModelUrl: "/api/v1/assets/file/x.glb", railingModelAssetId: "asset-x" } : {}),
          })],
          { type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton", fascia: { heightM: 0.35, color: "#3c4245" } }
        ),
        site, project, opts
      ).prims

    const custom = mk(true)
    expect(custom.some((p) => p.id.startsWith("railg-b-"))).toBe(false)
    expect(custom.some((p) => p.id.startsWith("railh-b-"))).toBe(false)
    expect(custom.some((p) => p.id.startsWith("railb-b-"))).toBe(false)
    expect(custom.some((p) => p.id === "fasciab-b-n")).toBe(true) // fascia tak ikut hilang

    // Regresi: tanpa model, prim gaya bawaan utuh seperti sebelumnya.
    const plain = mk(false)
    expect(plain.some((p) => p.id === "railg-b-n" && p.kind === "rail_glass")).toBe(true)
    expect(plain.some((p) => p.id === "railh-b-n")).toBe(true)
  })
})

describe("buildModel — bukaan menghormati levelOffsetM ruang host", () => {
  const mk = (off?: number) => {
    const l = layout([
      room({ id: "a", x: 0, y: 0, width: 4, depth: 3, ...(off !== undefined ? { levelOffsetM: off } : {}) }),
    ])
    l.openings = [
      { id: "opw", floorId: "f1", wallId: "a:n", type: "window", positionM: 2, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
      { id: "opd", floorId: "f1", wallId: "a:s", type: "door", positionM: 1, widthM: 0.9, heightM: 2.1 },
    ]
    return buildModel(l, site, project, opts).prims
  }

  it("ruang levelOffsetM 0.18: panel/ambang naik 0.18; balok atas MEMENDEK (plafon rata, E2)", () => {
    const base = mk()
    const raised = mk(0.18)
    // Panel & ambang bawah ikut lantai ruang yang terangkat — dimensi tetap.
    for (const id of ["op-opw", "ws-opw", "op-opd"]) {
      const b = base.find((p) => p.id === id)!
      const r = raised.find((p) => p.id === id)!
      expect(r.pos[1]).toBeCloseTo(b.pos[1] + 0.18, 6)
      expect(r.args).toEqual(b.args)
    }
    // Balok ATAS: puncaknya terkunci di bidang plafon rata (slabTop + 2.8) —
    // tingginya berkurang sebesar offset, bukan ikut naik utuh.
    for (const id of ["wh-opw", "wh-opd"]) {
      const b = base.find((p) => p.id === id)!
      const r = raised.find((p) => p.id === id)!
      expect(r.args[1]).toBeCloseTo(b.args[1] - 0.18, 6)
      expect(r.pos[1] + r.args[1] / 2).toBeCloseTo(0.15 + 2.8, 6) // puncak = plafon
      expect(b.pos[1] + b.args[1] / 2).toBeCloseTo(0.15 + 2.8, 6)
    }
    // Panel jendela duduk di atas lantai ruang yang terangkat: slabTop 0.15 +
    // offset 0.18 + sill 0.9 + panelH/2 0.6.
    expect(raised.find((p) => p.id === "op-opw")!.pos[1]).toBeCloseTo(0.15 + 0.18 + 0.9 + 0.6, 6)
    // Dinding ruang ber-offset memendek: puncak = plafon rata (sisi e — tanpa
    // bukaan, satu bentang penuh).
    const rw = raised.find((p) => p.id === "w-a-e")!
    expect(rw.args[1]).toBeCloseTo(2.8 - 0.18, 6)
    expect(rw.pos[1] + rw.args[1] / 2).toBeCloseTo(0.15 + 2.8, 6)
  })

  it("tanpa offset: perilaku lama utuh (regresi)", () => {
    const prims = mk()
    expect(prims.find((p) => p.id === "op-opw")!.pos[1]).toBeCloseTo(0.15 + 0.9 + 0.6, 6)
    expect(prims.find((p) => p.id === "wh-opd")!.pos[1]).toBeCloseTo(0.15 + 2.1 + 0.35, 6)
  })
})

describe("buildModel — model GLB kustom bukaan (Opening.modelUrl)", () => {
  it("prim bukaan membawa opening.modelUrl agar renderer bisa mengganti daunnya", () => {
    const l = layout([room({ id: "a", width: 4, depth: 3 })])
    l.openings = [{
      id: "opm", floorId: "f1", wallId: "a:s", type: "door", kind: "hinged_door",
      positionM: 1, widthM: 0.9, heightM: 2.1,
      modelUrl: "/api/v1/assets/file/pintu.glb", modelAssetId: "asset-pintu",
    }]
    const prim = buildModel(l, site, project, opts).prims.find((p) => p.id === "op-opm")!
    expect(prim.opening?.modelUrl).toBe("/api/v1/assets/file/pintu.glb")
  })

  it("tanpa modelUrl: opening.modelUrl undefined (perilaku lama utuh)", () => {
    const l = layout([room({ id: "a", width: 4, depth: 3 })])
    l.openings = [{ id: "op0", floorId: "f1", wallId: "a:s", type: "door", positionM: 1, widthM: 0.9, heightM: 2.1 }]
    const prim = buildModel(l, site, project, opts).prims.find((p) => p.id === "op-op0")!
    expect(prim.opening?.modelUrl).toBeUndefined()
  })
})

describe("buildModel — gorden/tirai jendela (Opening.curtainModelUrl)", () => {
  it("prim jendela membawa opening.curtainModelUrl untuk overlay gorden", () => {
    const l = layout([room({ id: "a", width: 4, depth: 3 })])
    l.openings = [{
      id: "opc", floorId: "f1", wallId: "a:s", type: "window", kind: "sliding_window",
      positionM: 1, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9,
      curtainModelUrl: "/api/v1/assets/file/asset-library/global/furniture/w4-gorden-1.glb",
      curtainAssetId: "asset-glb-w4-gorden-1",
    }]
    const prim = buildModel(l, site, project, opts).prims.find((p) => p.id === "op-opc")!
    expect(prim.opening?.curtainModelUrl).toBe(
      "/api/v1/assets/file/asset-library/global/furniture/w4-gorden-1.glb"
    )
  })

  it("interiorSign menunjuk ke DALAM ruang: kebalikan arah keluar (out) louver", () => {
    // Dinding "s" (selatan): out = +1 (keluar) → interior = -1. Dinding "n": +1.
    const l = layout([room({ id: "a", width: 4, depth: 3 })])
    l.openings = [
      { id: "ops", floorId: "f1", wallId: "a:s", type: "window", positionM: 1, widthM: 1, heightM: 1.2, sillHeightM: 0.9 },
      { id: "opn", floorId: "f1", wallId: "a:n", type: "window", positionM: 1, widthM: 1, heightM: 1.2, sillHeightM: 0.9 },
    ]
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.find((p) => p.id === "op-ops")!.interiorSign).toBe(-1)
    expect(prims.find((p) => p.id === "op-opn")!.interiorSign).toBe(1)
  })

  it("tanpa curtainModelUrl: opening.curtainModelUrl undefined (regresi)", () => {
    const l = layout([room({ id: "a", width: 4, depth: 3 })])
    l.openings = [{ id: "op0", floorId: "f1", wallId: "a:s", type: "window", positionM: 1, widthM: 1, heightM: 1.2, sillHeightM: 0.9 }]
    const prim = buildModel(l, site, project, opts).prims.find((p) => p.id === "op-op0")!
    expect(prim.opening?.curtainModelUrl).toBeUndefined()
  })
})

describe("buildModel — kolam renang (pool)", () => {
  it("emits a depth-aware recessed water prim + 4 coping bars", () => {
    const l = layout([room({ id: "p", type: "kolam", x: 0, y: 0, width: 4, depth: 3, poolKind: "renang", poolDepthM: 1.5 })])
    const prims = buildModel(l, { widthM: 4, depthM: 3 }, project, opts).prims
    const water = prims.find((pp) => pp.id === "pool-p")
    expect(water?.kind).toBe("pool")
    expect(water?.args[1]).toBeCloseTo(1.5, 5) // tinggi box air = kedalaman
    expect(prims.filter((pp) => pp.id.startsWith("coping-p-")).length).toBe(4)
  })

  it("kedalaman di-clamp ke rentang tipe (anak max 0.6)", () => {
    const l = layout([room({ id: "p", type: "kolam", x: 0, y: 0, width: 4, depth: 3, poolKind: "anak", poolDepthM: 3 })])
    const water = buildModel(l, { widthM: 4, depthM: 3 }, project, opts).prims.find((pp) => pp.id === "pool-p")!
    expect(water.args[1]).toBeCloseTo(0.6, 5)
  })

  it("kolam biasa (non-pool) tetap memakai prim tile- (regresi)", () => {
    const l = layout([room({ id: "a", type: "ruang_tamu", width: 4, depth: 3 })])
    const ids = buildModel(l, { widthM: 4, depthM: 3 }, project, opts).prims.map((p) => p.id)
    expect(ids).toContain("tile-a")
    expect(ids).not.toContain("pool-a")
  })

  it("kolam NON-rooftop tidak mendapat prim poolwall- (basin tambal hanya perlu di rooftop)", () => {
    const l = layout([room({ id: "p", type: "kolam", x: 0, y: 0, width: 4, depth: 3, poolKind: "renang" })])
    const ids = buildModel(l, { widthM: 4, depthM: 3 }, project, opts).prims.map((p) => p.id)
    expect(ids.filter((id) => id.startsWith("poolwall-")).length).toBe(0)
  })
})

describe("buildModel — kolam di ROOFTOP (bug: air kolam tak terlihat, tertutup slab dak)", () => {
  const rtSite = { widthM: 6, depthM: 4 }
  const rtProject = { rooftop: true, name: "P" } as unknown as Project
  const rtLayout = (poolOver: Partial<Room> = {}, includePool = true): DesignLayout => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.95 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [
      room({ id: "base", floorId: "floor-1", x: 0, y: 0, width: 6, depth: 4, areaM2: 24 }),
      ...(includePool
        ? [
            room({
              id: "rtp", floorId: "floor-rooftop", type: "kolam",
              x: 1, y: 1, width: 3, depth: 2, areaM2: 6,
              poolKind: "plunge",
              ...poolOver,
            }),
          ]
        : []),
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  })

  it("slab dak dilubangi SELUAS ruang kolam — tak ada potongan slab yang menutupi pusat kolam (dulu: 1 slab utuh menutup air)", () => {
    const prims = buildModel(rtLayout(), rtSite, rtProject, roofOpts).prims
    const rtSlabs = prims.filter((p) => p.id.startsWith("slab-floor-rooftop"))
    // Lubang → slab dak pecah jadi beberapa strip (byte-identik case tanpa
    // kolam tetap 1 prim tunggal, lihat test di bawah).
    expect(rtSlabs.length).toBeGreaterThan(1)
    const poolCenterX = 1 + 3 / 2 - rtSite.widthM / 2
    const poolCenterZ = 1 + 2 / 2 - rtSite.depthM / 2
    for (const s of rtSlabs) {
      const r = primPlanRect(s)
      const covers =
        poolCenterX > r.minX && poolCenterX < r.maxX && poolCenterZ > r.minZ && poolCenterZ < r.maxZ
      expect(covers).toBe(false)
    }
  })

  it("emits prim air pool-<id> + 4 coping + 4 poolwall basin (menambal celah lubang↔kotak air)", () => {
    const prims = buildModel(rtLayout(), rtSite, rtProject, roofOpts).prims
    const water = prims.find((p) => p.id === "pool-rtp")
    expect(water?.kind).toBe("pool")
    expect(prims.filter((p) => p.id.startsWith("coping-rtp-")).length).toBe(4)
    const walls = prims.filter((p) => p.id.startsWith("poolwall-rtp-"))
    expect(walls.length).toBe(4)
    // Dinding basin setinggi SLAB_T, warna coping, di elevasi slab (bukan
    // mengambang di atas air atau di bawah dasar kolam).
    for (const wprim of walls) expect(wprim.args[1]).toBeCloseTo(0.15, 5)
  })

  it("layout rooftop TANPA kolam: slab dak tetap satu prim utuh, tanpa poolwall- (regresi byte-identik)", () => {
    const prims = buildModel(rtLayout({}, false), rtSite, rtProject, roofOpts).prims
    const rtSlabs = prims.filter((p) => p.id.startsWith("slab-floor-rooftop"))
    expect(rtSlabs.length).toBe(1)
    expect(rtSlabs[0].id).toBe("slab-floor-rooftop")
    expect(prims.some((p) => p.id.startsWith("poolwall-"))).toBe(false)
  })
})

describe("buildModel — lubang slab (akses tangga/void vertikal)", () => {
  const twoFloor = (extra: Room[] = []): DesignLayout =>
    ({
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "floor-2", level: 2, name: "Lantai 2", heightM: 2.95 },
      ],
      rooms: [
        room({ id: "g", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "u", floorId: "floor-2", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        ...extra,
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }) as DesignLayout

  const bigSite = { widthM: 8, depthM: 6 }

  it("tanpa tangga/void: slab tunggal per lantai (id lama, byte-identik)", () => {
    const prims = buildModel(twoFloor(), bigSite, project, opts).prims
    expect(prims.some((p) => p.id === "slab-floor-1")).toBe(true)
    expect(prims.some((p) => p.id === "slab-floor-2")).toBe(true)
    expect(prims.some((p) => p.id.startsWith("slab-floor-2-h"))).toBe(false)
  })

  it("tangga di lantai 1 → slab lantai 2 DILUBANGI tepat di atasnya (strips, luas berkurang)", () => {
    // tangga 2×2 di pojok lantai 1 → lubang 2×2 di slab lantai 2.
    const prims = buildModel(
      twoFloor([room({ id: "st", floorId: "floor-1", type: "tangga", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 })]),
      bigSite, project, opts
    ).prims
    // slab lantai-1 (paling bawah) TIDAK dilubangi (tak ada lantai di bawahnya).
    expect(prims.some((p) => p.id === "slab-floor-1")).toBe(true)
    // slab lantai-2 kini strips, bukan slab tunggal.
    expect(prims.some((p) => p.id === "slab-floor-2")).toBe(false)
    const strips = prims.filter((p) => p.id.startsWith("slab-floor-2-h"))
    expect(strips.length).toBeGreaterThan(0)
    // total luas strips = footprint 8×6 − lubang 2×2 = 44 m².
    const areaSum = strips.reduce((s, p) => s + p.args[0] * p.args[2], 0)
    expect(areaSum).toBeCloseTo(8 * 6 - 2 * 2, 4)
  })

  it("void room melubangi slab lantainya SENDIRI (atrium)", () => {
    const prims = buildModel(
      twoFloor([room({ id: "v", floorId: "floor-2", type: "void", x: 3, y: 2, width: 2, depth: 2, areaM2: 4 })]),
      bigSite, project, opts
    ).prims
    expect(prims.some((p) => p.id === "slab-floor-2")).toBe(false)
    const strips = prims.filter((p) => p.id.startsWith("slab-floor-2-h"))
    const areaSum = strips.reduce((s, p) => s + p.args[0] * p.args[2], 0)
    expect(areaSum).toBeCloseTo(8 * 6 - 2 * 2, 4)
  })

  // Bentang tepi footprint lantai elevated yang tak tertutup ruang = slab
  // telanjang di tepi gedung → ditutup dinding `w-edge-*`. Span dinding di
  // pengujian dihitung dari prim (pos/args world → absolut) supaya assertion
  // membaca GEOMETRI, bukan sekadar id.
  const edgeWalls = (prims: ReturnType<typeof buildModel>["prims"], side: string) =>
    prims
      .filter((p) => p.id.startsWith(`w-edge-floor-2-${side}-`))
      .map((p) => {
        const horizontal = side === "n" || side === "s"
        const axis = horizontal ? 0 : 2
        const off = horizontal ? bigSite.widthM / 2 : bigSite.depthM / 2
        // args ber-inflasi ujung +WALL_T (0.12) — kembalikan ke span murni.
        const len = p.args[axis] - 0.12
        const mid = p.pos[axis] + off
        return { start: mid - len / 2, end: mid + len / 2, prim: p }
      })

  it("tangga di pojok footprint → dinding tepi menutup SEMUA bentang lantai-2 yang terbuka", () => {
    // Tangga 2×2 di pojok BARAT-UTARA lantai 1 (x=0,y=0). Footprint = 8×6.
    // Ruang lantai-2 DIUNDUR (x=2,y=2): seluruh sisi n & w terbuka, plus
    // pojok slab telanjang di s (x:0..2) & e (y:0..2) yang DULU bolong
    // (parapet lama hanya menutup tepi lubang tangga, bukan slab di sekitarnya).
    const two: DesignLayout = {
      ...twoFloor([]),
      rooms: [
        room({ id: "g", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "u", floorId: "floor-2", x: 2, y: 2, width: 6, depth: 4, areaM2: 24 }),
        room({ id: "st", floorId: "floor-1", type: "tangga", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 }),
      ],
    }
    const prims = buildModel(two, bigSite, project, opts).prims
    const n = edgeWalls(prims, "n")
    const w = edgeWalls(prims, "w")
    const s = edgeWalls(prims, "s")
    const e = edgeWalls(prims, "e")
    // Sisi n & w: u 2 m dari tepi → seluruh bentang terbuka → satu dinding penuh.
    expect(n.length).toBe(1)
    expect(n[0].start).toBeCloseTo(0, 4)
    expect(n[0].end).toBeCloseTo(8, 4)
    expect(w.length).toBe(1)
    expect(w[0].start).toBeCloseTo(0, 4)
    expect(w[0].end).toBeCloseTo(6, 4)
    // Sisi s & e: u menutup x:2..8 / y:2..6 → sisa pojok telanjang berdinding.
    expect(s.length).toBe(1)
    expect(s[0].start).toBeCloseTo(0, 4)
    expect(s[0].end).toBeCloseTo(2, 4)
    expect(e.length).toBe(1)
    expect(e[0].start).toBeCloseTo(0, 4)
    expect(e[0].end).toBeCloseTo(2, 4)
    // Dinding penuh (tinggi WALL_H), kind wall.
    const all = [...n, ...w, ...s, ...e].map((x) => x.prim)
    expect(all.every((p) => p.kind === "wall" && p.args[1] === 2.8)).toBe(true)
  })

  it("sisi yang ditutup ruang lantai 2 tidak berdinding ganda; sisa bentang tetap ditutup", () => {
    // u-north (0.5,0, 7×1) menutup sisi n di x:0.5..7.5; tepinya 0.5 m dari
    // garis w/e (≤ EDGE_NEAR) → ikut menutup w/e di y:0..1. Tangga 2×2 di
    // (0,0) lantai 1. Sisa bentang (stub n 0.5 m, w/e y:1..6, s penuh) ditutup.
    const layoutInput: DesignLayout = {
      ...twoFloor([]),
      rooms: [
        room({ id: "g", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "u-north", floorId: "floor-2", x: 0.5, y: 0, width: 7, depth: 1, areaM2: 7 }),
        room({ id: "st", floorId: "floor-1", type: "tangga", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 }),
      ],
    }
    const prims = buildModel(layoutInput, bigSite, project, opts).prims
    const n = edgeWalls(prims, "n")
    // Bentang u-north TIDAK berdinding (anti dobel); dua stub 0.5 m di ujung.
    expect(n.length).toBe(2)
    expect(n[0].end).toBeCloseTo(0.5, 4)
    expect(n[1].start).toBeCloseTo(7.5, 4)
    expect(n.some((sp) => sp.start < 7.4 && sp.end > 0.6)).toBe(false)
    // Sisi w terbuka di y:1..6 (termasuk bentang lubang tangga y:1..2).
    const w = edgeWalls(prims, "w")
    expect(w.length).toBe(1)
    expect(w[0].start).toBeCloseTo(1, 4)
    expect(w[0].end).toBeCloseTo(6, 4)
  })

  it("ruang lantai 2 menutup semua tepi → TANPA dinding tepi (anti dobel)", () => {
    // Ruang lantai-2 penuh (0,0,8×6) menutup seluruh tepi footprint.
    const prims = buildModel(
      twoFloor([room({ id: "st", floorId: "floor-1", type: "tangga", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 })]),
      bigSite, project, opts
    ).prims
    expect(prims.some((p) => p.id.startsWith("w-edge-"))).toBe(false)
  })

  it("regression bentuk-prod: ruang 0.11 & 0.3 m inboard tetap MENUTUP; sliver < 0.3 m di-skip", () => {
    // Mini proj-modern-tropis-1: laundry 0.11 m inboard dari s, area_kumpul
    // 0.3 m inboard dari e — keduanya ≤ EDGE_NEAR → tanpa dinding ganda di
    // depan dinding ruang. Sisa bentang s (x:4..8) & e (y:3..6) ditutup satu
    // dinding menerus. Sliver n 0.2 m (x:7.8..8) < EDGE_MIN_SPAN → di-skip.
    const l: DesignLayout = {
      ...twoFloor([]),
      rooms: [
        room({ id: "g", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "r1", floorId: "floor-2", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
        room({ id: "r2", floorId: "floor-2", x: 4, y: 0, width: 3.8, depth: 3, areaM2: 11.4 }),
        room({ id: "r3", floorId: "floor-2", x: 0, y: 3, width: 4, depth: 2.89, areaM2: 11.56 }),
        room({ id: "st", floorId: "floor-1", type: "tangga", x: 5, y: 3.5, width: 3, depth: 2.5, areaM2: 7.5 }),
      ],
    }
    const prims = buildModel(l, bigSite, project, opts).prims
    const s = edgeWalls(prims, "s")
    expect(s.length).toBe(1)
    expect(s[0].start).toBeCloseTo(4, 4)
    expect(s[0].end).toBeCloseTo(8, 4)
    const e = edgeWalls(prims, "e")
    expect(e.length).toBe(1)
    expect(e[0].start).toBeCloseTo(3, 4)
    expect(e[0].end).toBeCloseTo(6, 4)
    // Sliver n (0.2 m) & w (0.11 m) < EDGE_MIN_SPAN → tidak ada dinding.
    expect(edgeWalls(prims, "n").length).toBe(0)
    expect(edgeWalls(prims, "w").length).toBe(0)
  })

  it("balkon di tepi lantai 2 dianggap menutup (railing, bukan dinding)", () => {
    const l: DesignLayout = {
      ...twoFloor([]),
      rooms: [
        room({ id: "g", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "u", floorId: "floor-2", x: 2, y: 0, width: 6, depth: 6, areaM2: 36 }),
        room({ id: "b", floorId: "floor-2", type: "balkon", x: 0, y: 0, width: 2, depth: 6, areaM2: 12 }),
      ],
    }
    const prims = buildModel(l, bigSite, project, opts).prims
    expect(edgeWalls(prims, "w").length).toBe(0)
  })

  it("lantai dasar & rooftop tidak pernah dapat dinding tepi", () => {
    // Lantai dasar: halaman/carport memang terbuka. Rooftop: railing dak.
    const prims = buildModel(
      twoFloor([room({ id: "st", floorId: "floor-1", type: "tangga", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 })]),
      bigSite, project, opts
    ).prims
    expect(prims.some((p) => p.id.startsWith("w-edge-floor-1-"))).toBe(false)
    const rt: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "floor-2", level: 2, name: "Lantai 2", heightM: 2.95 },
        { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 0.3 },
      ],
      rooms: [
        room({ id: "g", floorId: "floor-1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48 }),
        room({ id: "rt", floorId: "floor-rooftop", type: "rooftop_lounge", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 }),
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    } as DesignLayout
    const rtPrims = buildModel(rt, bigSite, { rooftop: true, name: "P" } as unknown as Project, opts).prims
    expect(rtPrims.some((p) => p.id.startsWith("w-edge-floor-rooftop-"))).toBe(false)
  })
})

describe("buildModel — tangga bentuk L/U", () => {
  it("tangga bentuk L: prim anak per run + bordes solid + railing kedua sisi (dulu: tanpa railing)", () => {
    const rooms = [room({
      id: "room-stair", name: "Tangga", type: "tangga",
      x: 1, y: 1, width: 3, depth: 2.5, areaM2: 7.5,
      stairDirection: "e", stairShape: "L", stairTurn: "kanan",
    })]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    const steps = prims.filter((p) => p.id.startsWith("stair-room-stair-"))
    const landing = prims.find((p) => p.id === "stairland-room-stair")
    expect(steps.length).toBe(16) // 9 + 7 anak menerus (WALL_H+SLAB_T = 2.88)
    expect(landing).toBeDefined()
    expect(landing!.kind).toBe("stair")

    // Railing sekarang SELALU digambar untuk L/U — belt-and-suspenders sama
    // seperti tangga lurus, tanpa mengecek status dinding (lihat build-model.ts).
    const railBars = prims.filter(
      (p) => p.id.startsWith("strail-room-stair-") && !p.id.includes("-land-")
    )
    const landingRails = prims.filter((p) => p.id.startsWith("strail-room-stair-land-"))
    const posts = prims.filter((p) => p.id.startsWith("strailp-room-stair-"))
    expect(railBars.length).toBe(steps.length * 2) // 2 sisi lateral tiap anak
    // Bordes disambung run sebelum & sesudahnya di 2 dari 4 sisi (jalur jalan)
    // — HANYA 2 sisi lain (yang tak bersambung segmen manapun) dapat railing;
    // dulu (bug) ke-4 sisi dirender, menaruh palang tepat di jalur naik/turun.
    expect(landingRails.length).toBe(2)
    expect(posts.length).toBeGreaterThan(0)
    expect(railBars.every((p) => p.kind === "rail")).toBe(true)

    const firstStep = steps.find((p) => p.id === "stair-room-stair-0")!
    const firstRail = railBars.find((p) => p.id === "strail-room-stair-0-a")!
    expect(firstRail.pos[1]).toBeCloseTo(firstStep.pos[1] + firstStep.args[1] / 2 + 0.9, 2)

    // Geometri: railing bordes cuma di 2 sisi yang TIDAK bersambung ke run
    // (n/s/w/e index 0-3 mengikuti urutan array landEdges di build-model.ts).
    const stairLayout = interiorStairLayout(rooms[0], 3)
    const landSeg = stairLayout.segments.find((s) => s.kind === "landing")!
    const runs = stairLayout.segments.filter((s) => s.kind === "run")
    const touchesRun = (side: "n" | "s" | "w" | "e") =>
      runs.some((r) =>
        side === "n" ? Math.abs(r.y + r.depth - landSeg.y) < 1e-6 && r.x < landSeg.x + landSeg.width && r.x + r.width > landSeg.x
        : side === "s" ? Math.abs(r.y - (landSeg.y + landSeg.depth)) < 1e-6 && r.x < landSeg.x + landSeg.width && r.x + r.width > landSeg.x
        : side === "w" ? Math.abs(r.x + r.width - landSeg.x) < 1e-6 && r.y < landSeg.y + landSeg.depth && r.y + r.depth > landSeg.y
        : Math.abs(r.x - (landSeg.x + landSeg.width)) < 1e-6 && r.y < landSeg.y + landSeg.depth && r.y + r.depth > landSeg.y
      )
    const expectedOpenIndices = (["n", "s", "w", "e"] as const)
      .map((side, i) => (touchesRun(side) ? null : i))
      .filter((i): i is number => i !== null)
    const actualIndices = landingRails.map((p) => Number(p.id.split("-land-")[1])).sort()
    expect(actualIndices).toEqual(expectedOpenIndices.sort())
  })

  it("tangga tanpa stairShape merender persis seperti sebelumnya (regresi lurus)", () => {
    const rooms = [room({
      id: "room-stair", name: "Tangga", type: "tangga",
      x: 1, y: 1, width: 2.5, depth: 2.5, areaM2: 6.25,
    })]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("strail-room-stair"))).toBe(true)
    expect(prims.some((p) => p.id === "stairland-room-stair")).toBe(false)
  })
})

describe("buildModel — tangga masuk kolam", () => {
  it("kolam dengan poolEntrySide merender undakan masuk menurun (pool-step-)", () => {
    const rooms = [room({
      id: "room-pool", name: "Kolam", type: "kolam",
      x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
      poolKind: "renang", poolShallowM: 1.2, poolDeepM: 1.8, poolEntrySide: "n",
    })]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    const steps = prims.filter((p) => p.id.startsWith("pool-step-room-pool-"))
    // shallow 1.2 → k = clamp(round(1.2/0.25),3,5) = 5 → 4 blok solid menurun
    expect(steps.length).toBe(4)
    const heights = steps.map((p) => p.args[1])
    expect(heights[0]).toBeCloseTo(0.96, 2)
    expect(heights[3]).toBeCloseTo(0.24, 2)
  })

  it("kolam tanpa poolEntrySide tidak punya prim pool-step- (regresi)", () => {
    const rooms = [room({
      id: "room-pool", name: "Kolam", type: "kolam",
      x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang",
    })]
    const prims = buildModel(layout(rooms), site, project, opts).prims
    expect(prims.some((p) => p.id.startsWith("pool-step-"))).toBe(false)
  })
})

describe("buildModel — tangga monyet (akses dak servis)", () => {
  const rooftopLayout = (over?: Partial<DesignLayout>): DesignLayout => ({
    ...layout([room({ id: "a" })]),
    floors: [
      { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
    ],
    ...over,
  })

  it("merender 2 rel + anak tangga di sisi terpilih saat rooftopAccess terpasang", () => {
    const prims = buildModel(
      rooftopLayout({ rooftopAccess: { kind: "tangga_monyet", side: "e" } }),
      site, project, opts,
    ).prims
    const rails = prims.filter((p) => p.id.startsWith("rooftop-ladder-rail"))
    const rungs = prims.filter((p) => p.id.startsWith("rooftop-ladder-rung"))
    expect(rails).toHaveLength(2)
    expect(rungs.length).toBeGreaterThan(5)
    // Sisi timur: semua prim ladder berada di LUAR muka timur footprint.
    const fp = buildingFootprint(rooftopLayout())
    const eastFaceX = fp.x0 + fp.widthM - site.widthM / 2
    for (const p of [...rails, ...rungs]) {
      expect(p.pos[0]).toBeGreaterThan(eastFaceX)
    }
  })

  it("tanpa rooftopAccess (atau tanpa dak) tidak ada prim ladder", () => {
    const no1 = buildModel(rooftopLayout(), site, project, opts).prims
    const no2 = buildModel(
      { ...layout([room({ id: "a" })]), rooftopAccess: { kind: "tangga_monyet", side: "e" } },
      site, project, opts,
    ).prims
    expect(no1.some((p) => p.id.startsWith("rooftop-ladder"))).toBe(false)
    expect(no2.some((p) => p.id.startsWith("rooftop-ladder"))).toBe(false)
  })
})

describe("buildModel — posisi tangga monyet (posM)", () => {
  it("posM menggeser tangga sepanjang sisinya; absent = tengah", () => {
    const base: DesignLayout = {
      ...layout([room({ id: "a", x: 0, y: 0, width: 6, depth: 3 })]),
      floors: [
        { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
      ],
    }
    const railX = (l: DesignLayout) =>
      buildModel(l, site, project, opts).prims.find((p) =>
        p.id.startsWith("rooftop-ladder-rung"),
      )!.pos[0]

    // Footprint x0=0 w=6, site w=6 (cx=3): tengah sisi s → world x = 0.
    expect(
      railX({ ...base, rooftopAccess: { kind: "tangga_monyet", side: "s" } }),
    ).toBeCloseTo(0, 5)
    // posM 1.5 → world x = 0 + 1.5 - 3 = -1.5.
    expect(
      railX({
        ...base,
        rooftopAccess: { kind: "tangga_monyet", side: "s", posM: 1.5 },
      }),
    ).toBeCloseTo(-1.5, 5)
  })
})

describe("buildModel — ubin ruang ikut berlubang di atas tangga (akses dak)", () => {
  it("tile rooftop_lounge tidak menutupi lubang tangga lantai di bawahnya", () => {
    // Geometri riil proj-modern-tropis-1: lounge seluas deck; tangga L2
    // sebagian menjorok keluar tepi deck (y 8.5 < deck y0 8.7).
    const l: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "floor-1", level: 1, name: "L1", heightM: 3.2 },
        { id: "f2", level: 2, name: "L2", heightM: 3.2 },
        { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 0.3 },
      ],
      rooms: [
        room({ id: "a1", floorId: "floor-1", x: 0.5, y: 0.5, width: 11.5, depth: 8, areaM2: 92 }),
        room({ id: "b1", floorId: "f2", x: 0.5, y: 8.5, width: 11.5, depth: 7, areaM2: 80 }),
        room({ id: "st2", floorId: "f2", type: "tangga", x: 8.5, y: 8.5, width: 3.5, depth: 2.5, areaM2: 8.75 }),
        room({ id: "lounge", floorId: "floor-rooftop", type: "rooftop_lounge", x: 0.5, y: 8.7, width: 11.5, depth: 6.71, areaM2: 77 }),
      ],
      walls: [], openings: [], stairs: [], pools: [],
      rooftopArea: { x: 0.5, y: 8.7, width: 11.5, depth: 6.71 },
      validation: { passed: true, issues: [] },
    }
    const bigSite = { widthM: 12.5, depthM: 16 }
    const prims = buildModel(l, bigSite, project, opts).prims

    // Slab rooftop berlubang (multi-strip) DAN tile lounge ikut terpotong.
    expect(prims.filter((p) => p.id.startsWith("slab-floor-rooftop")).length).toBeGreaterThan(1)
    const loungeTiles = prims.filter((p) => p.id.startsWith("tile-lounge"))
    expect(loungeTiles.length).toBeGreaterThan(1)
    // Tidak ada satu pun potongan tile menutupi titik tengah tangga (10.25, 9.85).
    const px = 10.25 - bigSite.widthM / 2
    const pz = 9.85 - bigSite.depthM / 2
    for (const t of loungeTiles) {
      const inside =
        Math.abs(px - t.pos[0]) < t.args[0] / 2 - 1e-6 &&
        Math.abs(pz - t.pos[2]) < t.args[2] / 2 - 1e-6
      expect(inside).toBe(false)
    }
  })

  it("ruang tanpa lubang tetap satu prim tile-<id> (kompat lama)", () => {
    const prims = buildModel(layout([room({ id: "a" })]), site, project, opts).prims
    expect(prims.some((p) => p.id === "tile-a")).toBe(true)
  })
})

describe("buildModel — railing pengaman lubang tangga di dak", () => {
  // Geometri riil proj-modern-tropis-1: deck x0.5-12 y8.7-15.41; tangga L2
  // x8.5-12 y8.5-11 (w>d → arah naik default "e" → keluar di tepi TIMUR dak).
  const l = (): DesignLayout => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "floor-1", level: 1, name: "L1", heightM: 3.2 },
      { id: "f2", level: 2, name: "L2", heightM: 3.2 },
      { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [
      room({ id: "a1", floorId: "floor-1", x: 0.5, y: 0.5, width: 11.5, depth: 8, areaM2: 92 }),
      room({ id: "b1", floorId: "f2", x: 0.5, y: 8.5, width: 11.5, depth: 7, areaM2: 80 }),
      room({ id: "st2", floorId: "f2", type: "tangga", x: 8.5, y: 8.5, width: 3.5, depth: 2.5, areaM2: 8.75 }),
      room({ id: "lounge", floorId: "floor-rooftop", type: "rooftop_lounge", x: 0.5, y: 8.7, width: 11.5, depth: 6.71, areaM2: 77 }),
    ],
    walls: [], openings: [], stairs: [], pools: [],
    rooftopArea: { x: 0.5, y: 8.7, width: 11.5, depth: 6.71 },
    validation: { passed: true, issues: [] },
  })
  const bigSite = { widthM: 12.5, depthM: 16 }

  it("tepi lubang dapat railing; sisi keluar tangga & tepi berimpit perimeter tidak", () => {
    const prims = buildModel(l(), bigSite, project, opts).prims
    const hole = prims.filter((p) => p.id.startsWith("railhole-st2-"))
    // Sisi barat (x=8.5) & selatan (y=11) dirail; utara (y=8.7 = perimeter)
    // di-skip; timur (x=12 = perimeter + exit) di-skip.
    expect(hole.some((p) => p.id.startsWith("railhole-st2-w"))).toBe(true)
    expect(hole.some((p) => p.id.startsWith("railhole-st2-s"))).toBe(true)
    expect(hole.some((p) => p.id.startsWith("railhole-st2-n"))).toBe(false)
    expect(hole.some((p) => p.id.startsWith("railhole-st2-e"))).toBe(false)
    // Identitas railing dak → klik membuka kartu railing rooftop yang sama.
    expect(hole.every((p) => p.roomId === "rooftop-deck-railing")).toBe(true)
  })

  it("perimeter timur dak TERPOTONG di bentang keluar tangga (akses tetap terbuka)", () => {
    const prims = buildModel(l(), bigSite, project, opts).prims
    // Rail perimeter timur: garis x=12 (world x = 12 - 6.25 = 5.75). Tidak
    // boleh ada segmen menutupi titik keluar tangga (y site 9.85 → world 1.85).
    const east = prims.filter(
      (p) =>
        (p.kind === "rail" || p.kind === "rail_glass") &&
        p.id.startsWith("railrt") &&
        Math.abs(p.pos[0] - 5.75) < 0.1,
    )
    expect(east.length).toBeGreaterThan(0)
    const exitZ = 9.85 - 8
    for (const p of east) {
      const covers = Math.abs(exitZ - p.pos[2]) < p.args[2] / 2 - 1e-6
      expect(covers).toBe(false)
    }
  })
})

describe("buildModel — w-edge claddable (roomId sintetis)", () => {
  it("prim w-edge membawa roomId edge-{floorId} + wallSide (bisa diklik & di-cladding)", () => {
    const rooms = [
      room({ id: "a", floorId: "f1", x: 0, y: 0, width: 6, depth: 3 }),
      room({ id: "b", floorId: "f2", x: 0, y: 0, width: 3, depth: 3 }),
    ]
    const l: DesignLayout = {
      ...layout(rooms),
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 2.95 },
        { id: "f2", level: 2, name: "L2", heightM: 2.95 },
      ],
    }
    const prims = buildModel(l, site, project, opts).prims
    const edges = prims.filter((p) => p.id.startsWith("w-edge-f2-"))
    expect(edges.length).toBeGreaterThan(0)
    for (const e of edges) {
      expect(e.roomId).toBe("edge-f2")
      expect(e.wallSide).toBeTruthy()
    }
  })
})

describe("buildModel — elemen fasad (kisi/roster) di dinding tepi sintetis w-edge", () => {
  // Lantai 2 mundur dari tepi footprint lantai 1 di sisi timur (b hanya 3 m
  // lebar vs footprint 6 m dari a) → w-edge-f2-e-* menutup bentang y:0..3 di
  // x=6 (lihat describe "w-edge claddable" di atas, fixture sama).
  const rooms = [
    room({ id: "a", floorId: "f1", x: 0, y: 0, width: 6, depth: 3 }),
    room({ id: "b", floorId: "f2", x: 0, y: 0, width: 3, depth: 3 }),
  ]
  const twoFloorLayout = (extra: Partial<DesignLayout> = {}): DesignLayout => ({
    ...layout(rooms),
    floors: [
      { id: "f1", level: 1, name: "L1", heightM: 2.95 },
      { id: "f2", level: 2, name: "L2", heightM: 2.95 },
    ],
    ...extra,
  })

  it("FacadeElement pada wallId edge-{floorId}:{side} MENGEMIT prim bilah (dulu nol, host tak pernah ketemu)", () => {
    const l = twoFloorLayout({
      facadeElements: [
        {
          id: "fe-1",
          wallId: "edge-f2:e",
          floorId: "f2",
          kind: "louver_band",
          positionM: 1.5,
          widthM: 2.6,
          sillHeightM: 0.3,
          heightM: 2.2,
          finish: "kayu",
        },
      ],
    })
    const prims = buildModel(l, site, project, opts).prims
    const bars = prims.filter((p) => p.id.startsWith("louv-fe-1"))
    // Sebelum perbaikan: nol prim (host tak ketemu via rooms.find, `continue` diam-diam).
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every((p) => p.kind === "louver")).toBe(true)
    // cx = site.widthM/2 = 3 → posisi bar (koordinat lokal ber-pusat cx) harus
    // dekat +2.9..3.3 (muka dinding tepi x=6 dunia ± standoff), BUKAN dekat 0
    // (tengah bangunan) atau di sisi barat (negatif).
    for (const p of bars) {
      expect(p.pos[0]).toBeGreaterThan(2.5)
    }
  })

  it("byte-identity: facadeElements kosong/absen tak mengubah prims dinding tepi", () => {
    const withoutField = buildModel(twoFloorLayout(), site, project, opts).prims
    const withEmpty = buildModel(twoFloorLayout({ facadeElements: [] }), site, project, opts).prims
    expect(withEmpty).toEqual(withoutField)
    // Sanity: dinding w-edge memang tergambar di fixture ini (bukan cuma
    // kebetulan kedua sisi kosong sama-sama nol elemen).
    expect(withoutField.some((p) => p.id.startsWith("w-edge-f2-e-"))).toBe(true)
  })
})

describe("buildModel — skylight bidang datar (roof-holes)", () => {
  const skl = (over?: Partial<NonNullable<DesignLayout["skylights"]>[number]>) => ({
    id: "sk-1", x: 2, y: 1, widthM: 1.2, depthM: 1.2, kind: "fixed" as const, ...over,
  })

  it("tanpa skylights (atau []) → prims byte-identik dgn baseline", () => {
    const l0 = layout([room({ id: "a" })])
    const base = buildModel(l0, site, project, roofOpts).prims
    const withEmpty = buildModel({ ...l0, skylights: [] }, site, project, roofOpts).prims
    expect(withEmpty).toEqual(base)
    expect(base.some((p) => p.id === "roof")).toBe(true)
  })

  it("atap datar legacy: skylight memecah atap + prim roof_glass tanpa menutupi lubang", () => {
    const l = { ...layout([room({ id: "a", width: 6, depth: 3 })]), skylights: [skl()] }
    const prims = buildModel(l, site, project, roofOpts).prims
    expect(prims.some((p) => p.id === "roof")).toBe(false)
    const strips = prims.filter((p) => p.id.startsWith("roof-h"))
    expect(strips.length).toBeGreaterThan(1)
    const glass = prims.find((p) => p.id === "roof-glass-sk-1")!
    expect(glass.kind).toBe("roof_glass")
    expect(glass.skylightId).toBe("sk-1")
    // Tidak ada strip atap menutupi titik tengah skylight.
    const px = 2.6 - site.widthM / 2, pz = 1.6 - site.depthM / 2
    for (const st of strips) {
      const covers =
        Math.abs(px - st.pos[0]) < st.args[0] / 2 - 1e-6 &&
        Math.abs(pz - st.pos[2]) < st.args[2] / 2 - 1e-6
      expect(covers).toBe(false)
    }
  })

  it("dak rooftop: skylight melubangi slab dak + kaca pada elevasi slab", () => {
    const l: DesignLayout = {
      ...layout([room({ id: "a", width: 6, depth: 3 })]),
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 2.95 },
        { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
      ],
      skylights: [skl()],
    }
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.filter((p) => p.id.startsWith("slab-floor-rooftop")).length).toBeGreaterThan(1)
    expect(prims.some((p) => p.id === "roof-glass-sk-1")).toBe(true)
  })

  it("zona atap datar: skylight melubangi zona; atap pelana → tanpa prim kaca", () => {
    const lZone: DesignLayout = {
      ...layout([room({ id: "a", width: 6, depth: 3 })]),
      roofZones: [
        { id: "z1", type: "datar", x: 3, y: 1.5, widthM: 6, depthM: 3, slopeDeg: 0, overhangM: 0 },
      ],
      skylights: [skl()],
    }
    const zPrims = buildModel(lZone, site, project, roofOpts).prims
    expect(zPrims.some((p) => p.id === "roof-zone-z1")).toBe(false)
    expect(zPrims.filter((p) => p.id.startsWith("roof-zone-z1-h")).length).toBeGreaterThan(1)
    expect(zPrims.some((p) => p.id === "roof-glass-sk-1")).toBe(true)

    const lGable: DesignLayout = {
      ...layout([room({ id: "a", width: 6, depth: 3 })], {
        type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
      }),
      skylights: [skl()],
    }
    const gPrims = buildModel(lGable, site, project, roofOpts).prims
    expect(gPrims.some((p) => p.kind === "roof_glass")).toBe(false)
  })
})

describe("buildModel — band cladding vertikal (split-facade F1)", () => {
  it("dinding ber-band terpecah vertikal; segmen membawa facadeKey; total tinggi = WALL_H", () => {
    const l: DesignLayout = {
      ...layout([room({ id: "a", width: 6, depth: 3 })]),
      facade: { "a:s": "beton_ekspos", "a:s@0.90-2.10": "granit_hitam" },
    }
    const prims = buildModel(l, site, project, opts).prims
    const segs = prims.filter((p) => p.id.startsWith("w-a-s"))
    expect(segs).toHaveLength(3)
    expect(segs.map((p) => p.args[1]).reduce((x, y) => x + y, 0)).toBeCloseTo(2.8, 5)
    const banded = segs.find((p) => p.facadeKey === "a:s@0.90-2.10")!
    expect(banded.args[1]).toBeCloseTo(1.2, 5)
    // Segmen di luar band tanpa facadeKey → renderer fallback key polos.
    expect(segs.filter((p) => !p.facadeKey)).toHaveLength(2)
    // Dinding lain tanpa band tetap satu box id lama.
    expect(prims.some((p) => p.id === "w-a-n")).toBe(true)
  })

  it("strip di atas pintu ikut terpecah band milik dinding pemiliknya", () => {
    const l: DesignLayout = {
      ...layout([room({ id: "a", width: 6, depth: 3 })]),
      openings: [
        {
          id: "op-1", floorId: "f1", wallId: "a:s", type: "door",
          positionM: 3, widthM: 0.9, heightM: 2.1,
        } as DesignLayout["openings"][number],
      ],
      facade: { "a:s@2.30-2.60": "granit_hitam" },
    }
    const prims = buildModel(l, site, project, opts).prims
    const header = prims.filter((p) => p.id.startsWith("wh-op-1"))
    expect(header.length).toBeGreaterThan(1)
    expect(header.some((p) => p.facadeKey === "a:s@2.30-2.60")).toBe(true)
  })

  it("levelOffsetM: band mengikuti dasar dinding ruang (bukan slab)", () => {
    const l: DesignLayout = {
      ...layout([
        room({ id: "a", width: 6, depth: 3, levelOffsetM: 0.36 }),
      ]),
      facade: { "a:s@0.00-1.00": "granit_hitam" },
    }
    const prims = buildModel(l, site, project, opts).prims
    const banded = prims.find((p) => p.facadeKey === "a:s@0.00-1.00")!
    // Dasar dinding = slabTop(0.15) + offset(0.36); band 0..1 → center 0.5.
    expect(banded.pos[1]).toBeCloseTo(0.15 + 0.36 + 0.5, 5)
  })
})

describe("buildModel — courtyard openToSky (Fase C2)", () => {
  it("taman openToSky di lantai teratas melubangi atap datar TANPA prim kaca", () => {
    const l: DesignLayout = {
      ...layout([
        room({ id: "a", x: 0, y: 0, width: 6, depth: 3 }),
        room({ id: "taman-1", x: 2, y: 0.5, width: 2, depth: 2, type: "taman", openToSky: true }),
      ]),
    }
    const prims = buildModel(l, site, project, roofOpts).prims
    expect(prims.some((p) => p.id === "roof")).toBe(false)
    expect(prims.filter((p) => p.id.startsWith("roof-h")).length).toBeGreaterThan(1)
    expect(prims.some((p) => p.kind === "roof_glass")).toBe(false)
    // Tidak ada strip atap menutupi titik tengah courtyard (3, 1.5).
    const px = 3 - site.widthM / 2, pz = 1.5 - site.depthM / 2
    for (const st of prims.filter((p) => p.id.startsWith("roof-h"))) {
      const covers =
        Math.abs(px - st.pos[0]) < st.args[0] / 2 - 1e-6 &&
        Math.abs(pz - st.pos[2]) < st.args[2] / 2 - 1e-6
      expect(covers).toBe(false)
    }
  })

  it("openToSkyRect user-editable menggeser lubang (bukan rect ruang)", () => {
    const l: DesignLayout = {
      ...layout([
        room({ id: "a", x: 0, y: 0, width: 6, depth: 3 }),
        room({
          id: "taman-1", x: 2, y: 0.5, width: 2, depth: 2, type: "taman",
          openToSky: true, openToSkyRect: { x: 2.5, y: 1, width: 1, depth: 1 },
        }),
      ]),
    }
    const prims = buildModel(l, site, project, roofOpts).prims
    // Titik dalam rect ruang tapi di LUAR openToSkyRect tetap tertutup atap.
    const px = 2.2 - site.widthM / 2, pz = 0.7 - site.depthM / 2
    const covered = prims
      .filter((p) => p.id.startsWith("roof-h"))
      .some(
        (st) =>
          Math.abs(px - st.pos[0]) < st.args[0] / 2 - 1e-6 &&
          Math.abs(pz - st.pos[2]) < st.args[2] / 2 - 1e-6,
      )
    expect(covered).toBe(true)
  })

  it("taman openToSky lantai 1 melubangi slab lantai 2 (light well)", () => {
    const l: DesignLayout = {
      ...layout([
        room({ id: "a", floorId: "f1", x: 0, y: 0, width: 6, depth: 3 }),
        room({ id: "taman-1", floorId: "f1", x: 2, y: 0.5, width: 2, depth: 2, type: "taman", openToSky: true }),
        room({ id: "b", floorId: "f2", x: 0, y: 0, width: 6, depth: 3 }),
      ]),
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 2.95 },
        { id: "f2", level: 2, name: "L2", heightM: 2.95 },
      ],
    }
    const prims = buildModel(l, site, project, opts).prims
    expect(prims.filter((p) => p.id.startsWith("slab-f2")).length).toBeGreaterThan(1)
    // Tanpa openToSky → slab tunggal (byte-identik).
    const l0: DesignLayout = {
      ...l,
      rooms: l.rooms.map((r) => (r.id === "taman-1" ? { ...r, openToSky: undefined } : r)),
    }
    const prims0 = buildModel(l0, site, project, opts).prims
    expect(prims0.some((p) => p.id === "slab-f2")).toBe(true)
  })
})

describe("buildModel — overhangSides zona (cincin courtyard)", () => {
  it("sisi ber-override 0 tidak menumbuhkan tritisan; sisi lain tetap overhangM", () => {
    const l: DesignLayout = {
      ...layout([room({ id: "a", x: 0, y: 0, width: 6, depth: 3 })]),
      roofZones: [
        {
          id: "z1", type: "datar", x: 2, y: 1.5, widthM: 4, depthM: 3,
          slopeDeg: 0, overhangM: 0.5, overhangSides: { e: 0 },
        },
      ],
    }
    const prims = buildModel(l, site, project, roofOpts).prims
    const zone = prims.find((p) => p.id === "roof-zone-z1")!
    // Barat/utara/selatan tumbuh 0.5; timur 0 → lebar 4+0.5, dalam 3+1.
    expect(zone.args[0]).toBeCloseTo(4.5, 5)
    expect(zone.args[2]).toBeCloseTo(4, 5)
    // Tepi timur tetap di x site 4 → world 4 − cx(3) = 1.
    expect(zone.pos[0] + zone.args[0] / 2).toBeCloseTo(1, 5)
  })
})

describe("buildModel — tinggi lantai per-data (tabel elevasi, Fase D3)", () => {
  it("lantai 3.5 m: slab lantai 2 di 3.5, dinding lantai 1 setinggi 3.35, atap ikut naik", () => {
    const l: DesignLayout = {
      ...layout([
        room({ id: "a", floorId: "f1", x: 0, y: 0, width: 6, depth: 3 }),
        room({ id: "b", floorId: "f2", x: 0, y: 0, width: 6, depth: 3 }),
      ]),
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 3.5 },
        { id: "f2", level: 2, name: "L2", heightM: 2.95 },
      ],
    }
    const prims = buildModel(l, site, project, roofOpts).prims
    const slab2 = prims.find((p) => p.id.startsWith("slab-f2"))!
    expect(slab2.pos[1]).toBeCloseTo(3.5 + 0.15 / 2, 5)
    const wall1 = prims.find((p) => p.id === "w-a-n")!
    expect(wall1.args[1]).toBeCloseTo(3.35, 5)
    // Dinding lantai 2 tetap default 2.8; atap di atas puncak lantai 2.
    const wall2 = prims.find((p) => p.id === "w-b-n")!
    expect(wall2.args[1]).toBeCloseTo(2.8, 5)
    const roof = prims.find((p) => p.id === "roof")!
    expect(roof.pos[1]).toBeCloseTo(3.5 + 0.15 + 2.8 + 0.15 / 2, 5)
  })
})

describe("buildModel — undakan konektor split-level (E3)", () => {
  it("pintu antar ruang beda 0.36 → prim stepc naik ke lantai ruang tinggi; tanpa koneksi = tidak ada", () => {
    const l: DesignLayout = {
      ...layout([
        room({ id: "bawah", x: 0, y: 0, width: 4, depth: 1.5 }),
        room({ id: "atas", x: 0, y: 1.5, width: 4, depth: 1.5, levelOffsetM: 0.36 }),
      ]),
      openings: [
        { id: "d1", floorId: "f1", wallId: "bawah:s", type: "door", positionM: 2, widthM: 0.9, heightM: 2.1 } as DesignLayout["openings"][number],
      ],
    }
    const prims = buildModel(l, site, project, opts).prims
    const steps = prims.filter((p) => p.id.startsWith("stepc-bawah-atas"))
    expect(steps).toHaveLength(1) // 2 anak → 1 blok undakan (anak teratas = lantai atas)
    expect(steps[0].args[1]).toBeCloseTo(0.18, 6)
    expect(steps[0].pos[1]).toBeCloseTo(0.15 + 0.09, 6)

    const l0 = { ...l, openings: [] }
    expect(
      buildModel(l0, site, project, opts).prims.some((p) => p.id.startsWith("stepc-")),
    ).toBe(false)
  })
})

describe("buildModel — geometri mezzanine (E6)", () => {
  const mezzLayout = (): DesignLayout => ({
    ...layout([
      room({ id: "studio", floorId: "f1", x: 0, y: 0, width: 6, depth: 3 }),
      room({ id: "st", floorId: "f1", type: "tangga", x: 0, y: 0, width: 1.2, depth: 2.4, areaM2: 2.88 }),
      room({ id: "platform", floorId: "mz", type: "balkon", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 }),
      room({ id: "atas", floorId: "f2", x: 0, y: 0, width: 6, depth: 3 }),
    ]),
    floors: [
      { id: "f1", level: 1, name: "L1", heightM: 2.95 },
      { id: "mz", level: 1.5, name: "Mezzanine", heightM: 2.2, kind: "mezzanine", baseOffsetM: 1.5 },
      { id: "f2", level: 2, name: "L2", heightM: 2.95 },
    ],
  })

  it("slab mezzanine per-RUANG di elevasi baseOffset; tanpa slab footprint & w-edge", () => {
    const prims = buildModel(mezzLayout(), site, project, opts).prims
    const mzSlab = prims.find((p) => p.id === "slab-mz-platform")!
    expect(mzSlab).toBeDefined()
    expect(mzSlab.pos[1]).toBeCloseTo(1.5 + 0.15 / 2, 5)
    expect(mzSlab.args).toEqual([3, 0.15, 3])
    expect(prims.some((p) => p.id === "slab-mz")).toBe(false)
    expect(prims.some((p) => p.id.startsWith("w-edge-mz"))).toBe(false)
    // Lantai 2 tetap di 2.95 (mezzanine tidak menambah tumpukan).
    const slab2 = prims.find((p) => p.id.startsWith("slab-f2"))!
    expect(slab2.pos[1]).toBeCloseTo(2.95 + 0.075, 5)
  })

  it("tangga induk naik ke mezzanine (rise 1.5) dan TIDAK melubangi slab lantai 2", () => {
    const prims = buildModel(mezzLayout(), site, project, opts).prims
    // Slab f2 utuh satu prim (tanpa lubang tangga — predikat penetrasi).
    expect(prims.some((p) => p.id === "slab-f2")).toBe(true)
    // Anak tangga teratas ≈ elevasi dasar mezzanine.
    const steps = prims.filter((p) => p.id.startsWith("stair-st") || (p.kind === "stair" && p.roomId === "st"))
    expect(steps.length).toBeGreaterThan(2)
    const topY = Math.max(...steps.map((p) => p.pos[1] + p.args[1] / 2))
    expect(topY).toBeGreaterThan(1.3)
    expect(topY).toBeLessThanOrEqual(1.5 + 0.16)
  })

  it("platform balkon mezzanine mendapat railing pada elevasinya", () => {
    const prims = buildModel(mezzLayout(), site, project, opts).prims
    const rails = prims.filter(
      (p) => (p.kind === "rail" || p.kind === "rail_glass") && p.roomId === "platform",
    )
    expect(rails.length).toBeGreaterThan(0)
    for (const r of rails) {
      expect(r.pos[1]).toBeGreaterThan(1.5)
      expect(r.pos[1]).toBeLessThan(3)
    }
  })
})

describe("buildModel — cantilever Floor.offsetM (CB2)", () => {
  const mk = (off?: { dx: number; dy: number }): DesignLayout => ({
    ...layout([
      room({ id: "a", floorId: "f1", x: 0, y: 0, width: 4, depth: 3 }),
      room({ id: "b", floorId: "f2", x: 0, y: 0, width: 4, depth: 3 }),
    ]),
    floors: [
      { id: "f1", level: 1, name: "L1", heightM: 2.95 },
      { id: "f2", level: 2, name: "L2", heightM: 2.95, ...(off ? { offsetM: off } : {}) },
    ],
  })

  it("prim lantai ber-offset digeser horizontal; lantai lain & elevasi tetap", () => {
    const base = buildModel(mk(), site, project, opts).prims
    const shifted = buildModel(mk({ dx: 1, dy: 0 }), site, project, opts).prims
    const bw = base.find((p) => p.id === "w-b-n")!
    const sw = shifted.find((p) => p.id === "w-b-n")!
    expect(sw.pos[0]).toBeCloseTo(bw.pos[0] + 1, 6)
    expect(sw.pos[1]).toBeCloseTo(bw.pos[1], 6) // elevasi tak berubah
    expect(sw.pos[2]).toBeCloseTo(bw.pos[2], 6)
    // Lantai 1 tidak ikut bergeser.
    const a0 = base.find((p) => p.id === "w-a-n")!
    const a1 = shifted.find((p) => p.id === "w-a-n")!
    expect(a1.pos[0]).toBeCloseTo(a0.pos[0], 6)
  })

  it("clamp ±1.5 m; offset absen = byte-identik", () => {
    const clamped = buildModel(mk({ dx: 9, dy: 0 }), site, project, opts).prims
    const at15 = buildModel(mk({ dx: 1.5, dy: 0 }), site, project, opts).prims
    const c = clamped.find((p) => p.id === "w-b-n")!
    const f = at15.find((p) => p.id === "w-b-n")!
    expect(c.pos[0]).toBeCloseTo(f.pos[0], 6)
    // absen → identik dgn baseline (tak ada offsetM di layout).
    expect(buildModel(mk(), site, project, opts).prims).toEqual(
      buildModel({ ...mk(), floors: mk().floors.map((fl) => ({ ...fl })) }, site, project, opts).prims,
    )
  })
})

describe("buildModel — porthole lubang bundar sejati (Track B)", () => {
  const mk = (kind?: string): DesignLayout => ({
    ...layout([room({ id: "a", x: 0, y: 0, width: 4, depth: 3 })]),
    openings: [
      {
        id: "ph", floorId: "f1", wallId: "a:s", type: "window",
        ...(kind ? { kind } : {}),
        positionM: 2, widthM: 0.6, heightM: 0.6, sillHeightM: 1.2,
      } as DesignLayout["openings"][number],
    ],
  })

  it("porthole → 4 wall-box sudut (wc-) mengisi kotak jadi oktagon; window biasa tidak", () => {
    const ph = buildModel(mk("porthole"), site, project, opts).prims
    const corners = ph.filter((p) => p.id.startsWith("wc-ph-"))
    expect(corners).toHaveLength(4)
    // Semua kind wall + membawa wallSide (dpt cladding), ukuran kecil (~0.088).
    for (const c of corners) {
      expect(c.kind).toBe("wall")
      expect(c.wallSide).toBe("s")
      const a = Math.min(c.args[0], c.args[1])
      expect(a).toBeGreaterThan(0.05)
      expect(a).toBeLessThan(0.12)
    }
    // Window biasa (tanpa kind porthole) tak menghasilkan corner fill.
    expect(buildModel(mk(), site, project, opts).prims.some((p) => p.id.startsWith("wc-"))).toBe(false)
  })

  it("corner fill menyinggung lingkaran radius r — tak menutupi kaca (jarak sudut-dalam ≥ r)", () => {
    const prims = buildModel(mk("porthole"), site, project, opts).prims
    const corners = prims.filter((p) => p.id.startsWith("wc-ph-"))
    const r = 0.3
    // Pusat bukaan sisi s ruang a: mx = 2 − cx; y band center = 0.15 + 1.2 + 0.3.
    // Cukup cek: tiap corner-box tidak melintasi radius r dari pusat band.
    const yCenter = 0.15 + 1.2 + 0.3
    for (const c of corners) {
      const dAlong = Math.abs(c.pos[0] - (2 - site.widthM / 2)) - c.args[0] / 2
      const dVert = Math.abs(c.pos[1] - yCenter) - c.args[1] / 2
      expect(Math.hypot(dAlong, dVert)).toBeGreaterThanOrEqual(r - 0.02)
    }
  })
})

describe("buildModel — bukaan LENGKUNG (arch & kapsul, Studio Komponen)", () => {
  // Sama pola dgn helper porthole di atas: satu ruang 4×3, bukaan di sisi
  // selatan ("a:s", horizontal). ARCH_STEPS = 5 di build-model.ts; step
  // i=0 SELALU nol (hSafe=r persis di a0=0) jadi konsisten terlepas dari
  // radius — sisanya (i=1..4) dipertahankan bila cukup besar (span ≥ 0.02).
  const ARCH_STEPS = 5
  const mkOpening = (over: Partial<{ widthM: number; heightM: number; sillHeightM: number; archShape: string; frameColor: string }>): DesignLayout => ({
    ...layout([room({ id: "a", x: 0, y: 0, width: 4, depth: 3 })]),
    openings: [
      {
        id: "op1", floorId: "f1", wallId: "a:s", type: "window", kind: "fixed_window",
        positionM: 2, widthM: 2.4, heightM: 2.6, sillHeightM: 0.1,
        ...over,
      } as DesignLayout["openings"][number],
    ],
  })

  // Reimplementasi step count murni dari radius (independen dari
  // build-model.ts) — cross-check jumlah box "jumlah step benar".
  function expectedStepCount(r: number): number {
    let n = 0
    for (let i = 0; i < ARCH_STEPS; i++) {
      const a0 = (i / ARCH_STEPS) * r
      const hSafe = Math.sqrt(Math.max(0, r * r - a0 * a0))
      if (r - hSafe >= 0.02) n++
    }
    return n
  }

  it("byte-identity: opening TANPA archShape tak menghasilkan prim 'wa-' (persegi biasa, jalur lama utuh)", () => {
    const withoutShape = buildModel(mkOpening({}), site, project, opts).prims
    expect(withoutShape.some((p) => p.id.startsWith("wa-"))).toBe(false)
    // Prims identik dgn build kedua kali (deterministik, tak ada residu state).
    expect(withoutShape).toEqual(buildModel(mkOpening({}), site, project, opts).prims)
  })

  it("arch: corner-fill di 2 sudut atas (kiri+kanan), jumlah step sesuai formula, semua kind wall + wallSide dinding host", () => {
    const r = Math.min(2.4, 2.6) / 2 // = 1.2 (dibatasi widthM)
    const n = expectedStepCount(r)
    expect(n).toBeGreaterThan(0)
    const prims = buildModel(mkOpening({ archShape: "arch" }), site, project, opts).prims
    const left = prims.filter((p) => p.id.startsWith("wa-op1-l-"))
    const right = prims.filter((p) => p.id.startsWith("wa-op1-r-"))
    expect(left).toHaveLength(n)
    expect(right).toHaveLength(n)
    for (const c of [...left, ...right]) {
      expect(c.kind).toBe("wall")
      expect(c.roomId).toBe("a")
      expect(c.wallSide).toBe("s")
      expect(c.args[0]).toBeGreaterThan(0)
      expect(c.args[1]).toBeGreaterThan(0)
    }
  })

  it("arch: setiap corner-fill berada dalam bbox lubang (persegi widthM×panelH) & tak melewati kurva radius r (tak menutup kaca)", () => {
    const halfW = 2.4 / 2
    const r = Math.min(2.4, 2.6) / 2
    const opBaseY = 0.15 // slabTopY default (lantai dasar, levelOffsetM 0)
    const sill = 0.1
    const panelH = 2.6
    const mx = 2 - site.widthM / 2 // pusat bukaan sepanjang dinding
    const springlineY = opBaseY + sill + panelH - r
    const prims = buildModel(mkOpening({ archShape: "arch" }), site, project, opts).prims
    const corners = prims.filter((p) => p.id.startsWith("wa-op1-"))
    expect(corners.length).toBeGreaterThan(0)
    for (const c of corners) {
      const alongLo = c.pos[0] - c.args[0] / 2
      const alongHi = c.pos[0] + c.args[0] / 2
      const yLo = c.pos[1] - c.args[1] / 2
      const yHi = c.pos[1] + c.args[1] / 2
      // Dalam bbox lubang (persegi widthM × panelH, sedikit toleransi).
      expect(alongLo).toBeGreaterThanOrEqual(mx - halfW - 1e-6)
      expect(alongHi).toBeLessThanOrEqual(mx + halfW + 1e-6)
      expect(yLo).toBeGreaterThanOrEqual(springlineY - 1e-6)
      expect(yHi).toBeLessThanOrEqual(opBaseY + sill + panelH + 1e-6)
      // Tak melewati kurva: jarak tepi-dalam box (dekat pusat lingkaran) ke
      // pusat springline ≥ r pada sisi yang lebih dekat pusat (batas aman).
      const dAlongInner = Math.min(Math.abs(alongLo - mx), Math.abs(alongHi - mx))
      const dVertInner = Math.abs(yLo - springlineY)
      expect(Math.hypot(dAlongInner, dVertInner)).toBeGreaterThanOrEqual(r - 0.02)
    }
  })

  it("kapsul VERTIKAL (heightM > widthM): corner-fill di 4 sudut (atas+bawah × kiri+kanan)", () => {
    const prims = buildModel(mkOpening({ widthM: 1.6, heightM: 2.4, sillHeightM: 0.2, archShape: "capsule" }), site, project, opts).prims
    const groups = ["tl", "tr", "bl", "br"] as const
    for (const g of groups) {
      const boxes = prims.filter((p) => p.id.startsWith(`wa-op1-${g}-`))
      expect(boxes.length).toBeGreaterThan(0)
      for (const b of boxes) {
        expect(b.kind).toBe("wall")
        expect(b.wallSide).toBe("s")
      }
    }
  })

  it("kapsul HORIZONTAL (widthM ≥ heightM): corner-fill di ujung kiri+kanan (atas+bawah tiap ujung)", () => {
    const prims = buildModel(mkOpening({ widthM: 2.4, heightM: 1.2, sillHeightM: 0.8, archShape: "capsule" }), site, project, opts).prims
    const groups = ["lt", "lb", "rt", "rb"] as const
    for (const g of groups) {
      const boxes = prims.filter((p) => p.id.startsWith(`wa-op1-${g}-`))
      expect(boxes.length).toBeGreaterThan(0)
      for (const b of boxes) {
        expect(b.kind).toBe("wall")
        expect(b.wallSide).toBe("s")
      }
    }
  })

  it("frameColor menang jadi tint corner-fill; absen = tanpa tint (menyatu cladding, sama seperti porthole)", () => {
    const withColor = buildModel(
      mkOpening({ archShape: "arch", frameColor: "#112233" }),
      site, project, opts,
    ).prims.filter((p) => p.id.startsWith("wa-op1-"))
    expect(withColor.length).toBeGreaterThan(0)
    for (const c of withColor) expect(c.tint).toBe("#112233")

    const noColor = buildModel(mkOpening({ archShape: "arch" }), site, project, opts).prims.filter((p) =>
      p.id.startsWith("wa-op1-"),
    )
    for (const c of noColor) expect(c.tint).toBeUndefined()
  })
})

describe("buildModel — bukaan TRAPESIUM (tepi atas miring, topSlopeM)", () => {
  // Sama helper/ruang dgn describe arch/kapsul di atas: ruang 4×3, bukaan di
  // sisi selatan ("a:s", horizontal). ARCH_STEPS = 5 di build-model.ts.
  const ARCH_STEPS = 5
  const width = 2.4
  const panelH = 2.6
  const sill = 0.1
  const opBaseY = 0.15 // slabTopY default (lantai dasar, levelOffsetM 0)
  const mx = 2 - site.widthM / 2 // pusat bukaan sepanjang dinding
  const halfW = width / 2
  const topY = opBaseY + sill + panelH

  const mkOpening = (
    over: Partial<{ widthM: number; heightM: number; sillHeightM: number; topSlopeM: number; frameColor: string }>,
  ): DesignLayout => ({
    ...layout([room({ id: "a", x: 0, y: 0, width: 4, depth: 3 })]),
    openings: [
      {
        id: "op1", floorId: "f1", wallId: "a:s", type: "window", kind: "fixed_window",
        positionM: 2, widthM: width, heightM: panelH, sillHeightM: sill,
        ...over,
      } as DesignLayout["openings"][number],
    ],
  })

  // Reimplementasi step count linear murni (independen dari build-model.ts)
  // — cross-check "jumlah step benar" (garis miring linear, bukan busur;
  // s=0 di sudut TINGGI → h=0 selalu di i=0, sama pola dgn arch test).
  function expectedStepCount(drop: number): number {
    let n = 0
    for (let i = 0; i < ARCH_STEPS; i++) {
      const s0 = (i / ARCH_STEPS) * width
      const h = (drop * s0) / width
      if (h >= 0.02) n++
    }
    return n
  }

  it("byte-identity: opening TANPA topSlopeM (absen ATAU 0) tak menghasilkan prim 'wa-…-tp-'", () => {
    const withoutSlope = buildModel(mkOpening({}), site, project, opts).prims
    const withZero = buildModel(mkOpening({ topSlopeM: 0 }), site, project, opts).prims
    expect(withoutSlope.some((p) => p.id.includes("-tp-"))).toBe(false)
    expect(withZero).toEqual(withoutSlope)
    // Deterministik, tak ada residu state.
    expect(withoutSlope).toEqual(buildModel(mkOpening({}), site, project, opts).prims)
  })

  it("topSlopeM POSITIF: sisi along− (kiri) RENDAH — box tertinggi (paling dalam) dekat sudut kiri, jumlah step sesuai formula", () => {
    const drop = 1.0
    const n = expectedStepCount(drop)
    expect(n).toBeGreaterThan(0)
    const prims = buildModel(mkOpening({ topSlopeM: drop }), site, project, opts).prims
    const fill = prims.filter((p) => p.id.startsWith("wa-op1-tp-"))
    expect(fill).toHaveLength(n)
    for (const c of fill) {
      expect(c.kind).toBe("wall")
      expect(c.roomId).toBe("a")
      expect(c.wallSide).toBe("s")
      expect(c.args[0]).toBeGreaterThan(0)
      expect(c.args[1]).toBeGreaterThan(0)
    }
    // Box PALING TINGGI (args[1] terbesar) = box terakhir sebelum sudut
    // rendah (along−) — pusatnya harus di sisi kiri (< mx).
    const tallest = fill.reduce((a, b) => (b.args[1] > a.args[1] ? b : a))
    expect(tallest.pos[0]).toBeLessThan(mx)
  })

  it("topSlopeM NEGATIF: sisi along+ (kanan) RENDAH — box tertinggi dekat sudut kanan", () => {
    const drop = 1.0
    const prims = buildModel(mkOpening({ topSlopeM: -drop }), site, project, opts).prims
    const fill = prims.filter((p) => p.id.startsWith("wa-op1-tp-"))
    expect(fill.length).toBeGreaterThan(0)
    const tallest = fill.reduce((a, b) => (b.args[1] > a.args[1] ? b : a))
    expect(tallest.pos[0]).toBeGreaterThan(mx)
  })

  it("setiap step-fill berada dalam bbox lubang & tak melewati garis miring sungguhan (tak menutup kaca)", () => {
    const drop = 1.0
    // topSlopeM > 0 ⇒ sudut TINGGI = along+ (mx+halfW), sudut RENDAH =
    // along− (mx−halfW) — sama konvensi dgn topSlopeCornerFillPrims.
    const highCornerAlong = mx + halfW

    const prims = buildModel(mkOpening({ topSlopeM: drop }), site, project, opts).prims
    const fill = prims.filter((p) => p.id.startsWith("wa-op1-tp-"))
    expect(fill.length).toBeGreaterThan(0)
    for (const c of fill) {
      const alongLo = c.pos[0] - c.args[0] / 2
      const alongHi = c.pos[0] + c.args[0] / 2
      const yLo = c.pos[1] - c.args[1] / 2
      const yHi = c.pos[1] + c.args[1] / 2
      // Dalam bbox lubang (persegi widthM × panelH, sedikit toleransi).
      expect(alongLo).toBeGreaterThanOrEqual(mx - halfW - 1e-6)
      expect(alongHi).toBeLessThanOrEqual(mx + halfW + 1e-6)
      expect(yHi).toBeLessThanOrEqual(topY + 1e-6)
      expect(yLo).toBeGreaterThanOrEqual(topY - drop - 1e-6)
      // Tak melewati garis miring sungguhan: pada tepi box TERJAUH dari
      // sudut tinggi (garis makin turun menuju sudut rendah), tinggi box
      // (yLo) harus tetap ≥ tinggi garis sesungguhnya di titik itu.
      const sFar = Math.abs(highCornerAlong - alongLo)
      const lineY = topY - drop * Math.min(1, sFar / width)
      expect(yLo).toBeGreaterThanOrEqual(lineY - 1e-6)
    }
  })

  it("frameColor menang jadi tint step-fill; absen = tanpa tint (menyatu cladding, sama seperti arch/kapsul)", () => {
    const withColor = buildModel(
      mkOpening({ topSlopeM: 1, frameColor: "#112233" }),
      site, project, opts,
    ).prims.filter((p) => p.id.startsWith("wa-op1-tp-"))
    expect(withColor.length).toBeGreaterThan(0)
    for (const c of withColor) expect(c.tint).toBe("#112233")

    const noColor = buildModel(mkOpening({ topSlopeM: 1 }), site, project, opts).prims.filter((p) =>
      p.id.startsWith("wa-op1-tp-"),
    )
    for (const c of noColor) expect(c.tint).toBeUndefined()
  })
})
