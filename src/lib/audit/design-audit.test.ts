import { describe, it, expect } from "vitest"

import { auditDesign, type DesignAudit } from "./design-audit"
import type { DesignLayout, Project, Room } from "@/types"

function room(partial: Partial<Room> & Pick<Room, "id" | "type" | "x" | "y" | "width" | "depth">): Room {
  return {
    floorId: "floor-1",
    name: partial.name ?? partial.type,
    areaM2: partial.areaM2 ?? Math.round(partial.width * partial.depth * 100) / 100,
    ...partial,
  } as Room
}

function makeLayout(rooms: Room[], extra: Partial<DesignLayout> = {}): DesignLayout {
  return {
    id: "layout-x",
    projectId: "proj-x",
    versionId: "v1",
    floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 }],
    rooms,
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    validation: { passed: true, issues: [] },
    ...extra,
  }
}

function makeProject(site: Partial<Project["site"]> = {}): Pick<Project, "floors" | "rooftop" | "readiness" | "site"> {
  return {
    floors: 1,
    rooftop: false,
    readiness: "concept_ready",
    site: { widthM: 8, depthM: 12, areaM2: 96, frontRoadWidthM: 6, ...site },
  }
}

/** A generously-sized, standards-compliant single-storey house used as the
 *  "clean" baseline; individual tests break one thing at a time. */
function goodHouse(): { project: ReturnType<typeof makeProject>; layout: DesignLayout } {
  const rooms: Room[] = [
    room({ id: "tamu", type: "ruang_tamu", name: "Ruang tamu", x: 0, y: 1, width: 4, depth: 3.5 }),
    room({ id: "kt1", type: "kamar_tidur", name: "Kamar utama", x: 4, y: 1, width: 3.2, depth: 3.2 }),
    // y=4.5 agar benar-benar MENEMPEL ke Ruang tamu (yang berakhir di y=4.5).
    // Sebelumnya y=5 menyisakan celah 0,5 m sehingga tak ada ruang yang
    // bersebelahan — rumahnya terpecah dan tiap kamar hanya bisa dimasuki
    // dari halaman.
    room({ id: "km1", type: "kamar_mandi", name: "Kamar mandi", x: 0, y: 4.5, width: 1.8, depth: 2.2 }),
    room({ id: "dapur", type: "dapur", name: "Dapur", x: 2, y: 4.5, width: 2.5, depth: 2.5 }),
    room({ id: "carport", type: "carport", name: "Carport", x: 5, y: 5, width: 2.6, depth: 5 }),
  ]
  // Windows ≥ 10% floor area on habitable rooms (1.2×1.2 = 1.44 m² each covers it).
  const windows = ["tamu", "kt1", "dapur"].map((id) => ({
    id: `op-${id}`,
    floorId: "floor-1",
    wallId: `${id}:s`,
    type: "window" as const,
    positionM: 1,
    widthM: 1.5,
    heightM: 1.5,
  }))
  // Rumah yang benar bukan cuma "tiap ruang punya pintu", tapi ruang-ruangnya
  // SALING TERHUBUNG tanpa harus keluar rumah. Versi lama menaruh semua pintu
  // di dinding `:n` yang menghadap luar — tiap kamar hanya bisa dimasuki dari
  // halaman, dan itu bukan baseline "bersih".
  const door = (id: string, wallId: string, positionM: number) => ({
    id, floorId: "floor-1", wallId, type: "door" as const,
    positionM, widthM: 0.9, heightM: 2.1,
  })
  const doors = [
    door("door-entry", "tamu:w", 1.7),   // pintu masuk rumah (dinding luar)
    door("door-tamu-kt1", "tamu:e", 2),  // tamu ↔ kamar utama
    door("door-tamu-km1", "tamu:s", 0.9), // tamu ↔ kamar mandi
    door("door-tamu-dapur", "tamu:s", 3), // tamu ↔ dapur
  ]
  return { project: makeProject(), layout: makeLayout(rooms, { openings: [...windows, ...doors] }) }
}

describe("auditDesign — room size (SNI 03-1733)", () => {
  it("flags an undersized bedroom as a ruang finding citing SNI 03-1733", () => {
    const { project, layout } = goodHouse()
    const kt = layout.rooms.find((r) => r.id === "kt1")!
    kt.width = 2.0
    kt.depth = 2.0
    kt.areaM2 = 4 // well under the 9 m² minimum → critical (< 70%)
    const audit = auditDesign({ project, layout })
    const f = audit.findings.find((x) => x.id === "ruang-area:kt1")
    expect(f).toBeDefined()
    expect(f!.category).toBe("ruang")
    expect(f!.severity).toBe("critical")
    expect(f!.standard).toBe("SNI 03-1733-2004")
    expect(f!.fix).toBeTruthy()
  })

  it("does not flag a compliant bedroom", () => {
    const { project, layout } = goodHouse()
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((f) => f.id === "ruang-area:kt1")).toBe(false)
  })

  it("flags a too-narrow room even when its area is fine", () => {
    const { project, layout } = goodHouse()
    const tamu = layout.rooms.find((r) => r.id === "tamu")!
    tamu.width = 1.4
    tamu.depth = 8 // area 11.2 (ok) but short side 1.4 < 3.0
    tamu.areaM2 = 11.2
    const audit = auditDesign({ project, layout })
    const f = audit.findings.find((x) => x.id === "ruang-lebar:tamu")
    expect(f).toBeDefined()
    expect(f!.severity).toBe("warning")
  })
})

describe("auditDesign — daylight (SNI 03-6572)", () => {
  it("flags a habitable room with no window", () => {
    const { project, layout } = goodHouse()
    layout.openings = layout.openings.filter((o) => o.wallId !== "kt1:s") // remove the bedroom window
    // kt1 has no window now
    layout.openings.push({ id: "op-kt1b", floorId: "floor-1", wallId: "kt1:n", type: "door", positionM: 1, widthM: 0.9, heightM: 2.1 })
    const audit = auditDesign({ project, layout })
    const f = audit.findings.find((x) => x.id === "cahaya:kt1")
    expect(f).toBeDefined()
    expect(f!.category).toBe("cahaya")
    expect(f!.title).toMatch(/belum punya jendela/)
  })

  it("does not flag a non-habitable room (kamar mandi) for daylight", () => {
    const { project, layout } = goodHouse()
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((f) => f.id === "cahaya:km1")).toBe(false)
  })
})

describe("auditDesign — circulation", () => {
  it("flags a sub-0.8m door", () => {
    const { project, layout } = goodHouse()
    layout.openings.push({ id: "op-narrow", floorId: "floor-1", wallId: "tamu:n", type: "door", positionM: 1, widthM: 0.6, heightM: 2.1 })
    const audit = auditDesign({ project, layout })
    const f = audit.findings.find((x) => x.id === "sirkulasi-pintu:op-narrow")
    expect(f).toBeDefined()
    expect(f!.category).toBe("sirkulasi")
  })
})

describe("auditDesign — akses ruang (pintu)", () => {
  it("menandai ruang tertutup yang tidak punya pintu sama sekali", () => {
    const { project, layout } = goodHouse()
    layout.openings = layout.openings.filter((o) => o.id !== "door-tamu-kt1")
    const audit = auditDesign({ project, layout })
    const f = audit.findings.find((x) => x.id === "sirkulasi-akses:kt1")
    expect(f).toBeDefined()
    expect(f!.category).toBe("sirkulasi")
    expect(f!.severity).toBe("warning")
  })

  it("jendela saja TIDAK dianggap akses — celah yang lolos aturan ventilasi", () => {
    const { project, layout } = goodHouse()
    // Dapur tetap punya JENDELA (aturan ventilasi diam) tapi pintunya dicabut.
    layout.openings = layout.openings.filter((o) => o.id !== "door-tamu-dapur")
    expect(layout.openings.some((o) => o.id === "op-dapur")).toBe(true)
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((x) => x.id === "sirkulasi-akses:dapur")).toBe(true)
  })

  it("pintu di dinding BERSAMA menghitung utk kedua ruang", () => {
    const { project, layout } = goodHouse()
    // Cabut pintu milik kamar utama; ganti satu pintu di dinding bersama
    // tamu↔kt1 (x=4). Satu daun melayani KEDUA ruang — menghitung by-wallId
    // saja akan salah menandai kt1 tak punya akses.
    layout.openings = layout.openings.filter((o) => o.id !== "door-tamu-kt1")
    layout.openings.push({
      id: "door-antar", floorId: "floor-1", wallId: "tamu:e",
      type: "door", positionM: 1, widthM: 0.9, heightM: 2.1,
    })
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((x) => x.id === "sirkulasi-akses:kt1")).toBe(false)
  })

  it("ruang terbuka (carport) tidak dituntut punya pintu", () => {
    const { project, layout } = goodHouse()
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((x) => x.id === "sirkulasi-akses:carport")).toBe(false)
  })

  it("rumah lengkap berpintu tidak menghasilkan temuan akses sama sekali", () => {
    const { project, layout } = goodHouse()
    const audit = auditDesign({ project, layout })
    expect(audit.findings.filter((x) => x.id.startsWith("sirkulasi-akses:"))).toHaveLength(0)
  })
})

describe("auditDesign — regulatory KDB/KLB/GSB", () => {
  it("flags KDB over 60% when the building covers most of the lot", () => {
    // Lot 8×12=96; make rooms cover ~78 m² footprint → KDB ~81%.
    const rooms: Room[] = [
      room({ id: "a", type: "ruang_keluarga", name: "Keluarga", x: 0, y: 0, width: 8, depth: 6 }),
      room({ id: "b", type: "kamar_tidur", name: "Kamar", x: 0, y: 6, width: 5, depth: 6 }),
    ]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    const f = audit.findings.find((x) => x.id === "regulasi:kdb")
    expect(f).toBeDefined()
    expect(f!.category).toBe("regulasi")
    expect(f!.standard).toMatch(/KDB/)
  })

  it("flags a front setback smaller than half the road width (GSB)", () => {
    // road 6 → GSB 3.0; put an enclosed room flush at the front (y=0).
    const rooms: Room[] = [
      room({ id: "a", type: "ruang_tamu", name: "Tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "kt", type: "kamar_tidur", name: "Kamar", x: 4, y: 0, width: 3.2, depth: 3.2 }),
    ]
    const audit = auditDesign({ project: makeProject({ frontRoadWidthM: 6 }), layout: makeLayout(rooms) })
    const f = audit.findings.find((x) => x.id === "regulasi:gsb")
    expect(f).toBeDefined()
    expect(f!.title).toMatch(/[Ss]empadan/)
  })
})

describe("auditDesign — program completeness", () => {
  it("flags a house missing a bathroom + kitchen", () => {
    const rooms: Room[] = [
      room({ id: "kt", type: "kamar_tidur", name: "Kamar", x: 0, y: 3, width: 3.2, depth: 3.2 }),
      room({ id: "tamu", type: "ruang_tamu", name: "Tamu", x: 0, y: 6.5, width: 4, depth: 3.5 }),
    ]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    expect(audit.findings.some((f) => f.id === "ruang:missing-kamar_mandi")).toBe(true)
    expect(audit.findings.some((f) => f.id === "ruang:missing-dapur")).toBe(true)
  })
})

describe("auditDesign — scoring & shape", () => {
  it("a clean house scores high with a positive summary", () => {
    const { project, layout } = goodHouse()
    const audit = auditDesign({ project, layout })
    expect(audit.score).toBeGreaterThanOrEqual(80)
    expect(audit.counts.critical).toBe(0)
    expect(audit.byCategory).toHaveLength(6)
    expect(audit.summary).toBeTruthy()
  })

  it("sorts findings critical → warning → advisory and never scores below 0", () => {
    const rooms: Room[] = [
      room({ id: "kt", type: "kamar_tidur", name: "Kamar", x: 0, y: 0, width: 1.5, depth: 1.5, areaM2: 2.25 }),
    ]
    const audit: DesignAudit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    const severities = audit.findings.map((f) => f.severity)
    const order = { critical: 0, warning: 1, advisory: 2 }
    for (let i = 1; i < severities.length; i++) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]])
    }
    expect(audit.score).toBeGreaterThanOrEqual(0)
  })

  it("never throws on an empty / malformed layout", () => {
    const audit = auditDesign({ project: makeProject(), layout: makeLayout([]) })
    expect(audit.score).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(audit.findings)).toBe(true)
  })
})

describe("auditDesign — jendela ke courtyard (openToSky, Fase C5)", () => {
  const mk = (openToSky: boolean | undefined) =>
    makeLayout(
      [
        room({ id: "kamar", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 }),
        room({ id: "taman-1", type: "taman", x: 3, y: 0, width: 2, depth: 3, openToSky } as never),
      ],
      {
        openings: [
          { id: "w1", floorId: "floor-1", wallId: "kamar:e", type: "window", positionM: 1.5, widthM: 1.5, heightM: 1.2 },
        ],
      },
    )

  it("courtyard beratap → jendela TIDAK dikredit (tetap warning)", () => {
    const audit = auditDesign({ project: makeProject(), layout: mk(undefined) })
    expect(audit.findings.some((f) => f.id === "cahaya:kamar")).toBe(true)
  })

  it("courtyard openToSky → jendela dikredit penuh (warning hilang)", () => {
    const audit = auditDesign({ project: makeProject(), layout: mk(true) })
    expect(audit.findings.some((f) => f.id === "cahaya:kamar")).toBe(false)
  })
})

describe("auditDesign — KDH (Koefisien Dasar Hijau, Tier 1)", () => {
  it("flags KDH below 20% when the footprint leaves little open land", () => {
    const rooms: Room[] = [
      room({ id: "a", type: "ruang_keluarga", name: "Keluarga", x: 0, y: 0, width: 8, depth: 6 }),
      room({ id: "b", type: "kamar_tidur", name: "Kamar", x: 0, y: 6, width: 5, depth: 6 }),
    ]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    const f = audit.findings.find((x) => x.id === "regulasi:kdh")
    expect(f).toBeDefined()
    expect(f!.category).toBe("regulasi")
    expect(f!.standard).toMatch(/default nasional/)
  })

  it("does not flag KDH on a house with enough open land", () => {
    const { project, layout } = goodHouse()
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((f) => f.id === "regulasi:kdh")).toBe(false)
  })

  it("driveway perkerasan counts against KDH, garden_bed does not", () => {
    const rooms: Room[] = [room({ id: "a", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 })]
    // Lot 8x12=96, footprint 4x4=16. Paved rect 8x8=64 → open 16 → kdh ~16.7% (< 20%).
    const pavedRect = [
      { x: 0, y: 4 },
      { x: 8, y: 4 },
      { x: 8, y: 12 },
      { x: 0, y: 12 },
    ]
    const pavedLayout = makeLayout(rooms, {
      exteriorElements: [{ id: "dw1", kind: "driveway", structuralRole: "non_structural", points: pavedRect }],
    })
    const gardenLayout = makeLayout(rooms, {
      exteriorElements: [{ id: "gb1", kind: "garden_bed", structuralRole: "non_structural", points: pavedRect }],
    })
    const pavedAudit = auditDesign({ project: makeProject(), layout: pavedLayout })
    const gardenAudit = auditDesign({ project: makeProject(), layout: gardenLayout })
    expect(pavedAudit.findings.some((f) => f.id === "regulasi:kdh")).toBe(true)
    expect(gardenAudit.findings.some((f) => f.id === "regulasi:kdh")).toBe(false)
  })

  it("site.regulation.minKdh raises the KDH bar (override)", () => {
    const { project, layout } = goodHouse() // baseline KDH ~28.75% — passes the 20% default
    const withOverride = { ...project, site: { ...project.site, regulation: { minKdh: 0.35 } } }
    const audit = auditDesign({ project: withOverride, layout })
    const f = audit.findings.find((x) => x.id === "regulasi:kdh")
    expect(f).toBeDefined()
    expect(f!.standard).toMatch(/Anda isi/)
  })
})

describe("auditDesign — 0-lot-line (bukaan di dinding batas kavling, Tier 1)", () => {
  it("flags a window flush with the west lot boundary as warning when >=2 sides attached", () => {
    const rooms: Room[] = [room({ id: "kt", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 })]
    const layout = makeLayout(rooms, {
      openings: [{ id: "w1", floorId: "floor-1", wallId: "kt:w", type: "window", positionM: 1.5, widthM: 1, heightM: 1.2 }],
    })
    const audit = auditDesign({ project: makeProject({ widthM: 8, sidesAttached: 2 }), layout })
    const f = audit.findings.find((x) => x.id.startsWith("regulasi:lotline-opening:"))
    expect(f).toBeDefined()
    expect(f!.severity).toBe("warning")
    expect(f!.category).toBe("regulasi")
  })

  it("does not flag a window on an interior wall away from the boundary", () => {
    const rooms: Room[] = [room({ id: "kt", type: "kamar_tidur", x: 2, y: 0, width: 3, depth: 3 })]
    const layout = makeLayout(rooms, {
      openings: [{ id: "w1", floorId: "floor-1", wallId: "kt:w", type: "window", positionM: 1.5, widthM: 1, heightM: 1.2 }],
    })
    const audit = auditDesign({ project: makeProject({ widthM: 8, sidesAttached: 2 }), layout })
    expect(audit.findings.some((x) => x.id.startsWith("regulasi:lotline-opening:"))).toBe(false)
  })

  it("downgrades to advisory when only one side is attached", () => {
    const rooms: Room[] = [room({ id: "kt", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3 })]
    const layout = makeLayout(rooms, {
      openings: [{ id: "w1", floorId: "floor-1", wallId: "kt:w", type: "window", positionM: 1.5, widthM: 1, heightM: 1.2 }],
    })
    const audit = auditDesign({ project: makeProject({ widthM: 8, sidesAttached: 1 }), layout })
    const f = audit.findings.find((x) => x.id.startsWith("regulasi:lotline-opening:"))
    expect(f?.severity).toBe("advisory")
  })
})

describe("auditDesign — wajib sumber cahaya tengah (lahan sempit diapit, Tier 1)", () => {
  it("flags a narrow (<=8m) lot attached on both sides with no void/courtyard/skylight", () => {
    const rooms: Room[] = [room({ id: "a", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 })]
    const audit = auditDesign({ project: makeProject({ widthM: 6, sidesAttached: 2 }), layout: makeLayout(rooms) })
    expect(audit.findings.some((f) => f.id === "pencahayaan:narrow-attached")).toBe(true)
  })

  it("does not flag when an openToSky courtyard is present", () => {
    const rooms: Room[] = [
      room({ id: "a", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "court", type: "taman", x: 4, y: 0, width: 2, depth: 4, openToSky: true } as never),
    ]
    const audit = auditDesign({ project: makeProject({ widthM: 6, sidesAttached: 2 }), layout: makeLayout(rooms) })
    expect(audit.findings.some((f) => f.id === "pencahayaan:narrow-attached")).toBe(false)
  })

  it("does not flag a wide lot even when attached on both sides", () => {
    const rooms: Room[] = [room({ id: "a", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 })]
    const audit = auditDesign({ project: makeProject({ widthM: 10, sidesAttached: 2 }), layout: makeLayout(rooms) })
    expect(audit.findings.some((f) => f.id === "pencahayaan:narrow-attached")).toBe(false)
  })
})

describe("auditDesign — tinggi plafon & mezzanine (Tier 1)", () => {
  it("flags a floor with ceiling height below 2.4 m", () => {
    const rooms: Room[] = [room({ id: "a", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 4 })]
    const layout = makeLayout(rooms, {
      floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 2.4 }],
    })
    const audit = auditDesign({ project: makeProject(), layout })
    const f = audit.findings.find((x) => x.id === "ruang-plafon:floor-1")
    expect(f).toBeDefined()
    expect(f!.severity).toBe("warning")
  })

  it("does not flag a floor with a comfortable ceiling height", () => {
    const { project, layout } = goodHouse() // floor-1 heightM: 3.2 → wallHM 3.05
    const audit = auditDesign({ project, layout })
    expect(audit.findings.some((f) => f.id.startsWith("ruang-plafon:"))).toBe(false)
  })

  it("flags a mezzanine with insufficient clearance below/above and total height", () => {
    const rooms: Room[] = [
      room({ id: "a", type: "ruang_tamu", floorId: "floor-1", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "b", type: "workspace", floorId: "floor-mezz", x: 0, y: 0, width: 4, depth: 4 }),
    ]
    const layout = makeLayout(rooms, {
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-mezz", level: 1, name: "Mezzanine", kind: "mezzanine", heightM: 1.8, baseOffsetM: 1.5 },
      ],
    })
    const audit = auditDesign({ project: makeProject(), layout })
    expect(audit.findings.some((f) => f.id === "ruang-mezzanine-bawah:floor-mezz")).toBe(true)
    expect(audit.findings.some((f) => f.id === "ruang-mezzanine-atas:floor-mezz")).toBe(true)
    expect(audit.findings.some((f) => f.id === "ruang-mezzanine-total:floor-mezz")).toBe(true)
  })

  it("does not flag a compliant mezzanine", () => {
    const rooms: Room[] = [
      room({ id: "a", type: "ruang_tamu", floorId: "floor-1", x: 0, y: 0, width: 4, depth: 4 }),
      room({ id: "b", type: "workspace", floorId: "floor-mezz", x: 0, y: 0, width: 4, depth: 4 }),
    ]
    const layout = makeLayout(rooms, {
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-mezz", level: 1, name: "Mezzanine", kind: "mezzanine", heightM: 2.3, baseOffsetM: 2.2 },
      ],
    })
    const audit = auditDesign({ project: makeProject(), layout })
    expect(audit.findings.some((f) => f.id.startsWith("ruang-mezzanine-"))).toBe(false)
  })
})

describe("auditDesign — dimensi & kenyamanan tangga (Tier 1)", () => {
  it("flags a stair narrower than 0.9 m", () => {
    const rooms: Room[] = [room({ id: "tg", type: "tangga", x: 0, y: 0, width: 0.7, depth: 3 })]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    const f = audit.findings.find((x) => x.id === "sirkulasi-tangga-lebar:tg")
    expect(f).toBeDefined()
    expect(f!.severity).toBe("warning")
    expect(f!.category).toBe("sirkulasi")
  })

  it("does not flag a stair wide enough (>=0.9 m)", () => {
    const rooms: Room[] = [room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3 })]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    expect(audit.findings.some((x) => x.id === "sirkulasi-tangga-lebar:tg")).toBe(false)
  })

  it("flags a riser outside the 15-19 cm comfort range", () => {
    const rooms: Room[] = [
      room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3, stairRiserM: 0.25 } as never),
    ]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    const f = audit.findings.find((x) => x.id === "sirkulasi-tangga-riser:tg")
    expect(f).toBeDefined()
    expect(f!.severity).toBe("advisory")
  })

  it("does not flag the default riser target (0.18 m)", () => {
    const rooms: Room[] = [room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3 })]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    expect(audit.findings.some((x) => x.id === "sirkulasi-tangga-riser:tg")).toBe(false)
  })

  it("suggests L/U when a straight stair needs more than 12 steps", () => {
    // floor-1 default heightM 3.2 → ~18 steps at the 0.18 m target riser.
    const rooms: Room[] = [room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3 })]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    const f = audit.findings.find((x) => x.id === "sirkulasi-tangga-bordes:tg")
    expect(f).toBeDefined()
    expect(f!.severity).toBe("advisory")
  })

  it("does not suggest L/U when the stair is already L/U-shaped", () => {
    const rooms: Room[] = [
      room({ id: "tg", type: "tangga", x: 0, y: 0, width: 1.2, depth: 3, stairShape: "U" } as never),
    ]
    const audit = auditDesign({ project: makeProject(), layout: makeLayout(rooms) })
    expect(audit.findings.some((x) => x.id === "sirkulasi-tangga-bordes:tg")).toBe(false)
  })
})

describe("auditDesign — override site.regulation untuk KDB/KLB/GSB (Tier 1)", () => {
  it("site.regulation.maxKdb raises or lowers the KDB threshold", () => {
    // 8x9 room on an 8x12 lot → footprint/lot = 72/96 = 75%.
    const rooms: Room[] = [room({ id: "a", type: "ruang_keluarga", x: 0, y: 0, width: 8, depth: 9 })]
    const permissive = auditDesign({
      project: makeProject({ regulation: { maxKdb: 0.9 } }),
      layout: makeLayout(rooms),
    })
    expect(permissive.findings.some((f) => f.id === "regulasi:kdb")).toBe(false)

    const strict = auditDesign({
      project: makeProject({ regulation: { maxKdb: 0.5 } }),
      layout: makeLayout(rooms),
    })
    const f = strict.findings.find((x) => x.id === "regulasi:kdb")
    expect(f).toBeDefined()
    expect(f!.standard).toMatch(/Anda isi/)
  })

  it("site.regulation.gsbM overrides the half-road-width GSB formula", () => {
    const rooms: Room[] = [room({ id: "a", type: "ruang_tamu", x: 0, y: 2, width: 4, depth: 4 })] // setback 2 m
    const relaxed = auditDesign({
      project: makeProject({ frontRoadWidthM: 6, regulation: { gsbM: 1.5 } }),
      layout: makeLayout(rooms),
    })
    expect(relaxed.findings.some((f) => f.id === "regulasi:gsb")).toBe(false)

    const strict = auditDesign({
      project: makeProject({ frontRoadWidthM: 6, regulation: { gsbM: 4 } }),
      layout: makeLayout(rooms),
    })
    const f = strict.findings.find((x) => x.id === "regulasi:gsb")
    expect(f).toBeDefined()
    expect(f!.standard).toMatch(/Anda isi/)
  })
})
