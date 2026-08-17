import { describe, expect, it } from "vitest"

import { buildGableEndGeometry, buildGableGeometry } from "./roof-geometry-core"
import { roofProfile } from "@/lib/drawings/elevation"
import { buildModel } from "@/lib/three/build-model"
import { useEditorStore } from "@/stores/editor-store"
import { makeLayout, sampleProject, sampleSite } from "@/test-utils/fixtures"
import type { RoofZone } from "@/types"

const BUILD_OPTS = { exploded: false, showRoof: true, showFurniture: false }

function apexVerts(geom: ReturnType<typeof buildGableGeometry>): Array<[number, number, number]> {
  const pos = geom.getAttribute("position")
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y > 0) out.push([pos.getX(i), y, pos.getZ(i)])
  }
  return out
}

describe("G1 — gable asimetris (ridgeOffsetM)", () => {
  it("ro=0 → apex tepat di tengah (jalur simetris)", () => {
    // width 8 > depth 6 → ridge along x → offset di sumbu z.
    const apex = apexVerts(buildGableGeometry(8, 2, 6))
    expect(apex).toHaveLength(2)
    for (const [, , z] of apex) expect(z).toBeCloseTo(0, 6)
  })

  it("ro=1 menggeser apex ke +z saat ridge along x", () => {
    const apex = apexVerts(buildGableGeometry(8, 2, 6, 1))
    for (const [, , z] of apex) expect(z).toBeCloseTo(1, 6)
  })

  it("ro digeser di sumbu x saat ridge along z (depth > width)", () => {
    const apex = apexVerts(buildGableGeometry(6, 2, 8, -0.8))
    for (const [x] of apex) expect(x).toBeCloseTo(-0.8, 6)
  })

  it("ro di-clamp < setengah bentang (tidak degenerate)", () => {
    const apex = apexVerts(buildGableGeometry(8, 2, 6, 99))
    for (const [, , z] of apex) expect(z).toBeCloseTo(3 - 0.05, 6)
  })

  it("roofProfile: apexH menggeser puncak segitiga gable-end", () => {
    const sym = roofProfile({
      roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      hExtent: 6,
      crossExtent: 10,
      ridgeParallelToH: false,
      topY: 6,
    })
    const asym = roofProfile({
      roof: { type: "pelana", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton" },
      hExtent: 6,
      crossExtent: 10,
      ridgeParallelToH: false,
      topY: 6,
      apexH: 4.5,
    })
    const apexXs = (lines: typeof sym.lines) =>
      lines.filter((l) => l.y2 === sym.apexY).map((l) => l.x2)
    expect(apexXs(sym.lines)).toEqual([3, 3])
    expect(apexXs(asym.lines)).toEqual([4.5, 4.5])
    expect(asym.apexY).toBe(sym.apexY)
  })

  it("buildModel meneruskan ridgeOffsetM ke prim roof-zone pelana", () => {
    const layout = makeLayout()
    layout.roofZones = [
      {
        id: "zp", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4,
        slopeDeg: 30, overhangM: 0.4, ridgeOffsetM: 0.9,
      },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    const prim = prims.find((p) => p.id === "roof-zone-zp")!
    expect(prim.kind).toBe("roof_gable")
    expect(prim.ridgeOffsetM).toBe(0.9)
  })

  it("store updateRoofZone meng-clamp & membersihkan ridgeOffsetM", () => {
    const layout = makeLayout()
    layout.roofZones = [
      { id: "zc", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4, slopeDeg: 30, overhangM: 0.4 },
    ]
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    const s = useEditorStore.getState()
    s.updateRoofZone("zc", { ridgeOffsetM: 99 })
    // span = min(6,4)=4 → clamp 4/2−0.3 = 1.7
    expect(useEditorStore.getState().layout!.roofZones![0].ridgeOffsetM).toBeCloseTo(1.7, 2)
    s.updateRoofZone("zc", { type: "datar" })
    expect(useEditorStore.getState().layout!.roofZones![0].ridgeOffsetM).toBeUndefined()
  })
})

describe("G2 — sopi-sopi (wall_gable)", () => {
  it("tanpa gableEnds → tak ada prim wall_gable (byte-identik)", () => {
    const layout = makeLayout()
    layout.roofZones = [
      { id: "zg", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4, slopeDeg: 30, overhangM: 0.4 },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    expect(prims.some((p) => p.kind === "wall_gable")).toBe(false)
  })

  it("gableEnds w=wall & e=glass → 2 prim di ujung ridge (ridge along x)", () => {
    const layout = makeLayout()
    layout.roofZones = [
      {
        id: "zg", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4,
        slopeDeg: 30, overhangM: 0.4, ridgeOffsetM: 0.5,
        gableEnds: { w: "wall", e: "glass" },
      },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    const gw = prims.filter((p) => p.kind === "wall_gable")
    expect(gw.map((p) => p.id).sort()).toEqual(["gw-zone-zg-e", "gw-zone-zg-w"])
    const w = gw.find((p) => p.id.endsWith("-w"))!
    const e = gw.find((p) => p.id.endsWith("-e"))!
    expect(w.glassEnd).toBeUndefined()
    expect(e.glassEnd).toBe(true)
    // span = depthM (lintang ridge), tebal WALL_T, overhang & ro diteruskan.
    expect(w.args[0]).toBe(4)
    expect(w.gableOverhangM).toBe(0.4)
    expect(w.ridgeOffsetM).toBe(0.5)
    // Posisi di bidang dinding ujung ridge (x = zone.x ± (w/2 − t/2)).
    expect(w.pos[0]).toBeCloseTo(4 - 3 + 0.06 - sampleSite.widthM / 2, 2)
  })

  it("sisi tak valid (n/s saat ridge along x) diabaikan oleh emisi", () => {
    const layout = makeLayout()
    layout.roofZones = [
      {
        id: "zg", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4,
        slopeDeg: 30, overhangM: 0.4, gableEnds: { n: "wall", s: "glass" },
      },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    expect(prims.some((p) => p.kind === "wall_gable")).toBe(false)
  })

  it("store updateRoofZone membersihkan sisi tak valid & objek kosong", () => {
    const layout = makeLayout()
    layout.roofZones = [
      { id: "zs", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4, slopeDeg: 30, overhangM: 0.4 },
    ]
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    const s = useEditorStore.getState()
    s.updateRoofZone("zs", { gableEnds: { n: "wall", w: "glass" } })
    // ridge along x → hanya w/e valid; n dibuang.
    expect(useEditorStore.getState().layout!.roofZones![0].gableEnds).toEqual({ w: "glass" })
    s.updateRoofZone("zs", { gableEnds: {} })
    expect(useEditorStore.getState().layout!.roofZones![0].gableEnds).toBeUndefined()
  })

  it("buildGableEndGeometry: profil naik dari dinding & apex sadar ro", () => {
    const g = buildGableEndGeometry(4, 1.5, 0.5, 0.8, 0.12, true)
    const pos = g.getAttribute("position")
    let maxY = 0
    let apexS = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > maxY) {
        maxY = pos.getY(i)
        apexS = pos.getZ(i) // ridgeAlongX → s dipetakan ke z
      }
    }
    expect(maxY).toBeCloseTo(1.5, 6)
    expect(apexS).toBeCloseTo(0.8, 6)
  })
})

describe("R1 — bukaan railing balkon di pendaratan tangga eksterior", () => {
  const balkonLayout = () => {
    const layout = makeLayout()
    // Balkon lantai 2 menempel tepi selatan bangunan.
    layout.floors.push({ id: "floor-2", level: 2, name: "Lantai 2", heightM: 2.95 })
    layout.rooms.push({
      id: "balk", floorId: "floor-2", name: "Balkon", type: "balkon",
      x: 1, y: 4, width: 3, depth: 2, areaM2: 6,
    })
    return layout
  }

  it("tanpa tangga eksterior → railing satu span penuh (id lama, tanpa suffix)", () => {
    const { prims } = buildModel(balkonLayout(), sampleSite, sampleProject, BUILD_OPTS)
    expect(prims.some((p) => p.id === "railg-balk-s")).toBe(true)
    expect(prims.some((p) => p.id.startsWith("railg-balk-s-s"))).toBe(false)
  })

  it("tangga eksterior mendarat di sisi selatan → railing terpotong 2 span", () => {
    const layout = balkonLayout()
    layout.exteriorElements = [
      {
        id: "xst", kind: "exterior_stair", x: 2.5, y: 11, widthM: 1.2,
        lengthM: 5, riseM: 3, direction: "s",
        structuralRole: "non_structural",
      },
    ]
    // direction "s" → vektor z:-1 → pendaratan di y = 11 − 5 = 6 = tepi selatan balkon (y+depth=6).
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    const spans = prims.filter((p) => p.id.startsWith("railg-balk-s-s"))
    expect(spans.length).toBe(2)
    // Total panjang dua span ≈ lebar sisi − (widthM + 0.1).
    const total = spans.reduce((acc, p) => acc + p.args[0], 0)
    expect(total).toBeCloseTo(3 - 1.3, 2)
    expect(prims.some((p) => p.id === "railg-balk-s")).toBe(false)
  })

  it("undakan pendek (riseM < 1.5) tidak memotong railing", () => {
    const layout = balkonLayout()
    layout.exteriorElements = [
      {
        id: "xst", kind: "exterior_stair", x: 2.5, y: 11, widthM: 1.2,
        lengthM: 5, riseM: 0.6, direction: "s",
        structuralRole: "non_structural",
      },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    expect(prims.some((p) => p.id === "railg-balk-s")).toBe(true)
  })
})

describe("G2b — end-cap prisma gable terbuka pada ujung ber-sopi-sopi", () => {
  it("default kedua cap tertutup: 24 index (8 muka) — byte-identik", () => {
    const g = buildGableGeometry(8, 2, 6)
    expect(g.getIndex()!.count).toBe(24)
  })

  it("openEnds membuang segitiga cap sesuai ujung (neg/pos/keduanya)", () => {
    expect(buildGableGeometry(8, 2, 6, 0, { neg: true }).getIndex()!.count).toBe(21)
    expect(buildGableGeometry(8, 2, 6, 0, { pos: true }).getIndex()!.count).toBe(21)
    expect(
      buildGableGeometry(8, 2, 6, 0, { neg: true, pos: true }).getIndex()!.count,
    ).toBe(18)
  })

  it("prim roof-zone pelana membawa openGableEnds sesuai gableEnds", () => {
    const layout = makeLayout()
    layout.roofZones = [
      {
        id: "zo", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4,
        slopeDeg: 30, overhangM: 0.4, gableEnds: { w: "wall", e: "glass" },
      },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    const roofPrim = prims.find((p) => p.id === "roof-zone-zo")!
    expect(roofPrim.openGableEnds).toEqual({ neg: true, pos: true })
  })

  it("tanpa gableEnds → openGableEnds absen (byte-identik)", () => {
    const layout = makeLayout()
    layout.roofZones = [
      { id: "zo", type: "pelana", x: 4, y: 4, widthM: 6, depthM: 4, slopeDeg: 30, overhangM: 0.4 },
    ]
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    expect(prims.find((p) => p.id === "roof-zone-zo")!.openGableEnds).toBeUndefined()
  })
})

describe("W1 pada strip partial-rooftop (dak sebagian + atap pelana)", () => {
  function stripLayout() {
    const layout = makeLayout()
    layout.floors = [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 1.0 },
    ]
    layout.roof = {
      type: "pelana",
      slopeDeg: 30,
      overhangM: 0.4,
      material: "genteng_beton",
      ridgeOffsetM: 0.6,
      gableEnds: { w: "wall", e: "glass" },
    }
    // Footprint fixture: x 0.5..7, y 0.5..3.5. Dak kiri → strip kanan yang
    // ujung TIMUR-nya berimpit tepi footprint (barat menempel dak).
    layout.rooftopArea = { x: 0.5, y: 0.5, width: 3, depth: 3 }
    return layout
  }

  it("prim strip pelana membawa ridgeOffsetM + openGableEnds ujung tepi", () => {
    const { prims } = buildModel(stripLayout(), sampleSite, sampleProject, BUILD_OPTS)
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-") && p.kind === "roof_gable")
    expect(strips.length).toBeGreaterThan(0)
    for (const s of strips) expect(s.ridgeOffsetM).toBe(0.6)
    // Hanya ujung yang berimpit tepi footprint yang terbuka/berisi infill:
    // strip kanan ridge along x → e = tepi footprint (open), w = menempel dak.
    const open = strips.find((s) => s.openGableEnds)
    expect(open).toBeTruthy()
    expect(open!.openGableEnds).toEqual({ pos: true })
  })

  it("sopi-sopi strip hanya di ujung tepi footprint (gw-strip-*-e, glass)", () => {
    const { prims } = buildModel(stripLayout(), sampleSite, sampleProject, BUILD_OPTS)
    const gw = prims.filter((p) => p.kind === "wall_gable" && p.id.startsWith("gw-strip-"))
    expect(gw.length).toBe(1)
    expect(gw[0].id.endsWith("-e")).toBe(true)
    expect(gw[0].glassEnd).toBe(true)
  })

  it("tanpa gableEnds/ro → prim strip tanpa field baru (byte-identik)", () => {
    const layout = stripLayout()
    delete layout.roof!.ridgeOffsetM
    delete layout.roof!.gableEnds
    const { prims } = buildModel(layout, sampleSite, sampleProject, BUILD_OPTS)
    const strips = prims.filter((p) => p.id.startsWith("roof-strip-"))
    expect(strips.length).toBeGreaterThan(0)
    for (const s of strips) {
      expect(s.ridgeOffsetM).toBeUndefined()
      expect(s.openGableEnds).toBeUndefined()
    }
    expect(prims.some((p) => p.id.startsWith("gw-strip-"))).toBe(false)
  })
})

describe("convertLegacyRoofToZone — lantai pemilik & fitur gable terbawa", () => {
  it("zona hasil konversi milik lantai reguler teratas + bawa ro/gableEnds", () => {
    const layout = makeLayout()
    layout.floors = [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.0 },
    ]
    layout.rooms.push({
      id: "r3", floorId: "floor-2", name: "Kamar", type: "kamar_tidur",
      x: 0.5, y: 0.5, width: 3, depth: 3, areaM2: 9,
    })
    layout.roof = {
      type: "pelana",
      slopeDeg: 30,
      overhangM: 0.4,
      material: "genteng_beton",
      ridgeOffsetM: 1.2,
      gableEnds: { e: "glass" },
    }
    useEditorStore.getState().loadLayout(layout, sampleSite, [])
    useEditorStore.getState().convertLegacyRoofToZone()
    const zone = useEditorStore.getState().layout!.roofZones![0]
    expect(zone.floorId).toBe("floor-2")
    expect(zone.ridgeOffsetM).toBe(1.2)
    expect(zone.gableEnds).toEqual({ e: "glass" })
  })
})
