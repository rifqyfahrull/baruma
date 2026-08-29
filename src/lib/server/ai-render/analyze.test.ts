import { describe, expect, it } from "vitest"

import type { DesignLayout, Site } from "@/types"

import { analyzeScene } from "./analyze"

/**
 * Fixture dasar: site 10×15, dua ruang berdampingan di "lantai-1" yang
 * menempel PERSIS ke tepi selatan tapak (r1.y+depth = r2.y+depth = 15 =
 * fy+fd) — jadi keduanya edgeRooms("s"). Dinding fasad/opening/elemen fasad
 * hanya didefinisikan pada "r1:s" supaya SideFacts teruji spesifik per
 * dinding, bukan seluruh sisi.
 */
function baseLayout(): DesignLayout {
  return {
    id: "layout-scene-intel",
    projectId: "project-scene-intel",
    versionId: "version-scene-intel",
    floors: [
      { id: "lantai-1", level: 0, name: "Lantai 1", heightM: 3.2 },
      { id: "lantai-2", level: 1, name: "Lantai 2", heightM: 3.2 },
    ],
    rooms: [
      {
        id: "r1",
        floorId: "lantai-1",
        name: "Kamar tidur",
        type: "kamar_tidur",
        x: 0,
        y: 5,
        width: 5,
        depth: 10,
        areaM2: 50,
      },
      {
        id: "r2",
        floorId: "lantai-1",
        name: "Dapur",
        type: "dapur",
        x: 5,
        y: 5,
        width: 5,
        depth: 10,
        areaM2: 50,
      },
      // Balkon kecil, menempel tepi selatan (y+depth=15) TAPI di dalam bbox
      // r1∪r2 (x:[0,10] y:[5,15]) supaya tak mengubah footprint/diag —
      // murni menambah 1 balconyCount pada sisi "s".
      {
        id: "r3",
        floorId: "lantai-1",
        name: "Balkon",
        type: "balkon",
        x: 2,
        y: 13,
        width: 2,
        depth: 2,
        areaM2: 4,
      },
    ],
    walls: [],
    openings: [
      {
        id: "op1",
        floorId: "lantai-1",
        wallId: "r1:s",
        type: "window",
        positionM: 2.5,
        widthM: 1.2,
        heightM: 1.5,
      },
      // Pintu biasa vs pintu garasi pada sisi terlihat yang sama — buktikan
      // doorCount/garageDoorCount terhitung terpisah (bukan digabung).
      {
        id: "op2",
        floorId: "lantai-1",
        wallId: "r1:s",
        type: "door",
        kind: "hinged_door",
        positionM: 0.5,
        widthM: 0.9,
        heightM: 2.1,
      },
      {
        id: "op3",
        floorId: "lantai-1",
        wallId: "r1:s",
        type: "door",
        kind: "garage_door",
        positionM: 1.5,
        widthM: 3,
        heightM: 2.2,
      },
    ],
    facade: { "r1:s": "beton_ekspos" },
    facadeElements: [
      {
        id: "fe1",
        wallId: "r1:s",
        floorId: "lantai-1",
        kind: "louver_band",
        positionM: 2.5,
        widthM: 2,
        sillHeightM: 0,
        heightM: 3,
        finish: "kayu",
      },
    ],
    exteriorElements: [
      {
        id: "ext-fence",
        kind: "fence",
        structuralRole: "non_structural",
        start: { x: 0, y: 14.5 },
        end: { x: 10, y: 14.5 },
        heightM: 1.2,
      },
      // Ditempatkan dekat kamera secara kedalaman tapi jauh secara lateral
      // (bukan koordinat (1,1) di brief): pada pose kamera depan, titik
      // (1,1) TERNYATA masih lolos ambang sudut ~46° (formula murni
      // sudut+jarak, tanpa oklusi geometri bangunan) — jadi fixture ini
      // memindahkan tree ke posisi yang benar-benar di luar kerucut
      // pandang kamera (titik wakil +setengah lebar/dalam ⇒ sudut ~74°
      // > ambang), membuktikan jalur exclude.
      {
        id: "ext-tree",
        kind: "tree",
        structuralRole: "non_structural",
        x: 1,
        y: 20,
        widthM: 1,
        depthM: 1,
        heightM: 3,
      },
    ],
    roofZones: [
      {
        id: "rz1",
        type: "pelana",
        x: 5,
        y: 10,
        widthM: 10,
        depthM: 10,
        slopeDeg: 30,
        overhangM: 0.5,
      },
    ],
    exteriorLamps: [
      { id: "lamp1", kind: "wall", x: 1, y: 15, mountH: 2.2, side: "s", floorId: "lantai-1" },
      { id: "lamp2", kind: "bollard", x: 5, y: 16, mountH: 0.6, floorId: "lantai-1" },
    ],
    validation: { passed: true, issues: [] },
  } as DesignLayout
}

const site: Site = { widthM: 10, depthM: 15, areaM2: 150 }

describe("analyzeScene", () => {
  it("mengekstrak SceneFacts dari pose kamera depan eye-level", () => {
    const layout = baseLayout()
    const facts = analyzeScene(layout, site, {
      position: [0, 1.6, 14],
      target: [0, 1.5, 0],
      fov: 50,
    })

    expect(facts.camera.visibleSides).toEqual(["s"])
    expect(facts.camera.heightClass).toBe("eye-level")
    // dist3D≈11.61 (pos ke pusat footprint world (0,2.5)) / diag≈14.14 →
    // ratio≈0.82 < 1.0 → "close-up".
    expect(facts.camera.distanceClass).toBe("close-up")
    expect(facts.camera.lensMm).toBe(35)

    expect(facts.sides).toHaveLength(1)
    expect(facts.sides[0]).toMatchObject({
      side: "s",
      claddings: ["Beton ekspos"],
      windowCount: 1,
      // op2 (hinged_door) & op3 (garage_door) sama-sama di wallId "r1:s":
      // buktikan keduanya dihitung terpisah, bukan digabung ke doorCount.
      doorCount: 1,
      garageDoorCount: 1,
      facadeElements: ["louver_band"],
      // r3 (type "balkon") menempel tepi selatan → masuk edgeRooms("s").
      balconyCount: 1,
    })

    expect(facts.exteriorInFrame).toContain("fence")
    expect(facts.exteriorInFrame).not.toContain("tree")

    expect(facts.roof.zoneTypes).toEqual(["pelana"])
    expect(facts.roof.globalType).toBe("datar")
    expect(facts.lighting.exteriorLampCount).toBe(2)
    expect(facts.massing.floors).toBe(2)
    expect(facts.massing.hasRooftopDeck).toBe(false)
    expect(facts.vegetationPresent).toBe(true)
  })

  it("mengenali dua sisi terlihat & aerial pada pose kamera iso tenggara", () => {
    const layout = baseLayout()
    const facts = analyzeScene(layout, site, {
      position: [18, 12, 18],
      target: [0, 1.5, 0],
      fov: 50,
    })

    // Azimuth kamera relatif pusat footprint (world 0, 2.5) ≈ 49.27° —
    // lebih dekat ke ring "e" (90°, selisih 40.73°) daripada "s" (0°,
    // selisih 49.27°), jadi primer = "e"; sekunder "s" karena selisih dari
    // sumbu primer (40.73°) ada di rentang [20°, 70°].
    expect(facts.camera.visibleSides).toEqual(["e", "s"])
    expect(facts.camera.heightClass).toBe("aerial")
    // dist3D≈26.61 (pos ke pusat footprint world (0,2.5)) / diag≈14.14 →
    // ratio≈1.88, di rentang [1.0, 2.2) → "medium".
    expect(facts.camera.distanceClass).toBe("medium")
  })

  it("heightClass 'elevated' untuk y antara 2.5 dan 9", () => {
    const layout = baseLayout()
    const facts = analyzeScene(layout, site, {
      position: [0, 5, 14],
      target: [0, 1.5, 0],
      fov: 50,
    })

    expect(facts.camera.heightClass).toBe("elevated")
  })

  it("rooftopRailing default 'kaca' saat ada floor-rooftop tanpa rooftopRailingStyle eksplisit", () => {
    const layout = baseLayout()
    layout.floors = [...layout.floors, { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 3.2 }]

    const facts = analyzeScene(layout, site, {
      position: [0, 1.6, 14],
      target: [0, 1.5, 0],
      fov: 50,
    })

    expect(facts.massing.hasRooftopDeck).toBe(true)
    expect(facts.massing.rooftopRailing).toBe("kaca")
  })

  it("vegetationPresent true untuk garden_bed sendirian, tanpa tree/plant", () => {
    const layout = baseLayout()
    layout.exteriorElements = [
      {
        id: "ext-garden",
        kind: "garden_bed",
        structuralRole: "non_structural",
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 2, y: 2 },
          { x: 1, y: 2 },
        ],
      },
    ]

    const facts = analyzeScene(layout, site, {
      position: [0, 1.6, 14],
      target: [0, 1.5, 0],
      fov: 50,
    })

    expect(facts.vegetationPresent).toBe(true)
  })

  it("oklusi: elemen di BELAKANG bangunan tereksklusi, elemen menempel fasad depan tetap masuk", () => {
    const layout = baseLayout()
    layout.exteriorElements = [
      // Tree di halaman BELAKANG (utara footprint y<5) — segmen kamera depan
      // (site 5,21.5) → titik wakil (5.5,2.5) menembus footprint [0..10]×
      // [5..15]; secara sudut MASUK kerucut pandang, tapi tertutup bangunan.
      {
        id: "ext-tree-belakang",
        kind: "tree",
        structuralRole: "non_structural",
        x: 5,
        y: 2,
        widthM: 1,
        depthM: 1,
        heightM: 3,
      },
      // Kanopi MENEMPEL fasad depan (selatan, y sedikit > 15) — inset 0.8 m
      // pada rect oklusi menjaga elemen tempelan seperti ini tetap terlihat.
      {
        id: "ext-kanopi-depan",
        kind: "canopy",
        structuralRole: "non_structural",
        x: 4,
        y: 15.05,
        widthM: 2,
        depthM: 0.5,
        heightM: 2.4,
      },
    ]

    const facts = analyzeScene(layout, site, {
      position: [0, 1.6, 14],
      target: [0, 1.5, 0],
      fov: 50,
    })

    expect(facts.exteriorInFrame).not.toContain("tree")
    expect(facts.exteriorInFrame).toContain("canopy")
  })

  it("oklusi: kamera DI DALAM footprint tidak meng-occlude apa pun (fallback aman)", () => {
    const layout = baseLayout()
    // Kamera di tengah footprint (site 5,10 → world 0,2.5) memandang selatan;
    // fence (14.5) & tree belakang keduanya dinilai murni sudut+jarak lama.
    layout.exteriorElements = [
      {
        id: "ext-tree-belakang",
        kind: "tree",
        structuralRole: "non_structural",
        x: 5,
        y: 2,
        widthM: 1,
        depthM: 1,
        heightM: 3,
      },
    ]
    const facts = analyzeScene(layout, site, {
      position: [0, 1.6, 2.5],
      target: [0, 1.5, 10],
      fov: 50,
    })
    // Tree di utara, kamera menghadap selatan → tetap tereksklusi oleh SUDUT
    // (di belakang kamera), bukan crash/oklusi keliru.
    expect(facts.exteriorInFrame).not.toContain("tree")
  })

  it("tidak pernah throw & fallback footprint=site saat tak ada ruang", () => {
    const layout: DesignLayout = {
      id: "layout-empty",
      projectId: "project-empty",
      versionId: "version-empty",
      floors: [{ id: "lantai-1", level: 0, name: "Lantai 1", heightM: 3.2 }],
      rooms: [],
      walls: [],
      openings: [],
      validation: { passed: true, issues: [] },
    } as DesignLayout

    expect(() =>
      analyzeScene(layout, site, { position: [0, 1.6, 14], target: [0, 0, 0], fov: 0 })
    ).not.toThrow()

    const facts = analyzeScene(layout, site, {
      position: [0, 1.6, 14],
      target: [0, 0, 0],
      fov: 0,
    })
    expect(facts.massing.footprintWidthM).toBe(site.widthM)
    expect(facts.massing.footprintDepthM).toBe(site.depthM)
    expect(facts.camera.lensMm).toBe(50) // fov di-clamp ke 10 → jalur "else 50"
  })
})
