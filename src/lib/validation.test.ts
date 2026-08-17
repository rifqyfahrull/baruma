import { describe, it, expect } from "vitest"

import { structuralNotes, validateLayout } from "@/lib/validation"
import { makeLayout, sampleProject, sampleSite } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

describe("validateLayout", () => {
  it("passes a valid layout", () => {
    const res = validateLayout(makeLayout(), sampleSite)
    expect(res.passed).toBe(true)
    expect(res.issues).toHaveLength(0)
  })

  it("flags an out-of-bounds room as danger", () => {
    const layout = makeLayout()
    layout.rooms[0].x = 7.5
    layout.rooms[0].width = 3 // extends to 10.5 > 8
    const res = validateLayout(layout, sampleSite)
    expect(res.passed).toBe(false)
    expect(res.issues.some((i) => i.level === "danger")).toBe(true)
  })

  it("flags overlapping rooms", () => {
    const layout = makeLayout()
    layout.rooms[1].x = 1
    layout.rooms[1].y = 1 // now overlaps r1
    const res = validateLayout(layout, sampleSite)
    expect(res.issues.some((i) => i.id.startsWith("overlap"))).toBe(true)
  })

  it("flags overlapping roof zones through the root layout validator", () => {
    const layout = makeLayout()
    layout.roofZones = [
      { id: "roofz-a", type: "datar", x: 3, y: 3, widthM: 4, depthM: 4, slopeDeg: 0, overhangM: 0.3 },
      { id: "roofz-b", type: "limasan", x: 4, y: 3, widthM: 4, depthM: 4, slopeDeg: 25, overhangM: 0.3 },
    ]

    const res = validateLayout(layout, sampleSite)
    const issue = res.issues.find((i) => i.id.includes("roofz-a"))

    expect(res.passed).toBe(false)
    expect(issue).toBeDefined()
    expect(issue!.objectId).toBe("roofz-a,roofz-b")
  })

  it("carries extra structural notes", () => {
    const note = {
      id: "struct",
      level: "warning" as const,
      category: "structural" as const,
      message: "Perlu review struktur.",
    }
    const res = validateLayout(makeLayout(), sampleSite, [note])
    expect(res.issues.some((i) => i.id === "struct")).toBe(true)
  })

  it("flags a soakwell under a habitable ground-floor room as danger (needs open ground)", () => {
    const layout = makeLayout()
    layout.sanitation = {
      // r1 is at (0.5,0.5,3x3) -> center (2,2); this soakwell sits right on it.
      soakwell: { id: "s1", x: 2, y: 2, widthM: 1, lengthM: 1, depthM: 2 },
    }
    const res = validateLayout(layout, sampleSite)
    expect(res.passed).toBe(false)
    const issue = res.issues.find((i) => i.id.startsWith("sanitation-overlap"))
    expect(issue).toBeDefined()
    expect(issue!.level).toBe("danger")
    expect(issue!.message).toContain("Ruang tamu")
    expect(issue!.message).toContain("Sumur resapan")
  })

  it("does not flag a soakwell under a taman at all — open ground is exactly where it belongs", () => {
    const layout = makeLayout()
    layout.rooms[0] = { ...layout.rooms[0], name: "Taman", type: "taman" }
    layout.sanitation = {
      soakwell: { id: "s1", x: 2, y: 2, widthM: 1, lengthM: 1, depthM: 2 },
    }
    const res = validateLayout(layout, sampleSite)
    expect(res.issues.some((i) => i.id.startsWith("sanitation-overlap"))).toBe(false)
    expect(res.passed).toBe(true)
  })

  it("flags a septic tank under a habitable room as warning (desludging access), NOT danger", () => {
    const layout = makeLayout()
    layout.sanitation = {
      septicTank: { id: "s1", x: 2, y: 2, widthM: 0.85, lengthM: 1.7, depthM: 1.8 },
    }
    const res = validateLayout(layout, sampleSite)
    const issue = res.issues.find((i) => i.id.startsWith("sanitation-overlap"))
    expect(issue).toBeDefined()
    expect(issue!.level).toBe("warning")
    expect(issue!.message).toContain("sedot WC")
    expect(res.passed).toBe(true) // warning does not fail validation
  })

  it("downgrades a septic tank under a carport to info (common practice on tight lots)", () => {
    const layout = makeLayout()
    layout.rooms[0] = { ...layout.rooms[0], name: "Carport", type: "carport" }
    layout.sanitation = {
      septicTank: { id: "s1", x: 2, y: 2, widthM: 0.85, lengthM: 1.7, depthM: 1.8 },
    }
    const res = validateLayout(layout, sampleSite)
    const issue = res.issues.find((i) => i.id.startsWith("sanitation-overlap"))
    expect(issue).toBeDefined()
    expect(issue!.level).toBe("info")
    expect(issue!.message).toContain("manhole")
    expect(res.passed).toBe(true)
  })

  it("flags a control box under any room as info only (inspection cover is normal practice)", () => {
    const layout = makeLayout()
    layout.sanitation = {
      controlBoxes: [{ id: "b1", x: 2, y: 2, widthM: 0.4, lengthM: 0.4, depthM: 0.5 }],
    }
    const res = validateLayout(layout, sampleSite)
    const issue = res.issues.find((i) => i.id.startsWith("sanitation-overlap"))
    expect(issue).toBeDefined()
    expect(issue!.level).toBe("info")
    expect(issue!.message).toContain("bak kontrol 1")
    expect(issue!.message).toContain("tutup akses")
    expect(res.passed).toBe(true)
  })

  it("does not flag sanitation objects that sit in genuinely free space", () => {
    const layout = makeLayout()
    layout.sanitation = {
      soakwell: { id: "s1", x: 7.5, y: 7.5, widthM: 1, lengthM: 1, depthM: 2 },
    }
    const res = validateLayout(layout, sampleSite)
    expect(res.issues.some((i) => i.id.startsWith("sanitation-overlap"))).toBe(false)
  })

  it("does not flag an upper-floor room against ground-level sanitation", () => {
    const layout = makeLayout()
    layout.floors.push({ id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 })
    layout.rooms.push({
      id: "r3", floorId: "floor-2", name: "Kamar Tidur", type: "kamar_tidur",
      x: 0.5, y: 0.5, width: 3, depth: 3, areaM2: 9,
    })
    layout.sanitation = {
      // Directly "under" r3's (x,y) footprint, but r3 is on floor-2, not grade.
      soakwell: { id: "s1", x: 2, y: 2, widthM: 1, lengthM: 1, depthM: 2 },
    }
    const res = validateLayout(layout, sampleSite)
    expect(res.issues.some((i) => i.id.includes("r3"))).toBe(false)
  })
})

describe("structuralNotes", () => {
  /** Rooms tiling an 8×6 footprint from the origin → deriveColumnGrid gives
   *  nx3 spanX4 ny3 spanY3, 9 columns. */
  function struktur8x6Layout(): DesignLayout {
    return {
      ...makeLayout(),
      rooms: [
        { id: "A", floorId: "floor-1", name: "A", type: "ruang_tamu", x: 0, y: 0, width: 8, depth: 3, areaM2: 24 },
        { id: "B", floorId: "floor-1", name: "B", type: "kamar_tidur", x: 0, y: 3, width: 8, depth: 3, areaM2: 24 },
      ],
    }
  }

  it("without a layout returns only the project-level notes (backwards-compatible)", () => {
    // sampleProject: floors 2 (< 3 → no floors note), rooftop true → 1 note.
    const notes = structuralNotes(sampleProject)
    expect(notes.some((n) => n.id === "struct:rooftop")).toBe(true)
    expect(notes.some((n) => n.id === "struct:floors")).toBe(false)
    // No calc-driven notes when no layout is passed.
    expect(notes.some((n) => n.id === "struct:column")).toBe(false)
    expect(notes.some((n) => n.id === "struct:footing")).toBe(false)
  })

  it("adds calc-driven notes from the modules when a layout is supplied", () => {
    // 8×6 footprint, floors 2, σ default 150 →
    //   Pu 261.6 kN → kolom 200×200 mm; Ps 198 → telapak 1.2×1.2 m; span 4 m.
    const notes = structuralNotes(sampleProject, struktur8x6Layout())

    const column = notes.find((n) => n.id === "struct:column")
    expect(column).toBeDefined()
    expect(column!.category).toBe("structural")
    expect(column!.message).toContain("261.6 kN")
    expect(column!.message).toContain("200×200 mm")

    const footing = notes.find((n) => n.id === "struct:footing")
    expect(footing).toBeDefined()
    expect(footing!.message).toContain("150 kPa")
    expect(footing!.message).toContain("1.2×1.2 m")

    // spanX = 4.0 reaches MAX_SPAN → span-at-limit warning.
    const span = notes.find((n) => n.id === "struct:span")
    expect(span).toBeDefined()
    expect(span!.level).toBe("warning")
  })

  it("emits no calc notes for a degenerate (empty-room) layout", () => {
    const empty: DesignLayout = { ...makeLayout(), rooms: [] }
    const notes = structuralNotes(sampleProject, empty)
    expect(notes.some((n) => n.id === "struct:column")).toBe(false)
    expect(notes.some((n) => n.id === "struct:footing")).toBe(false)
  })
})

describe("validateLayout — ventilasi via dinding bersama", () => {
  // Reproduksi kasus prod (Rumah Qyfa): pintu kamar mandi digambar pada
  // dinding ruang TETANGGA yang berimpit (wallId milik tetangga) — dulu
  // memicu "belum punya jendela/pintu" yang menyesatkan.
  function bathroomWithNeighbourDoor(): DesignLayout {
    const layout = makeLayout()
    layout.rooms = [
      { id: "km", floorId: "floor-1", name: "Kamar mandi 1", type: "kamar_mandi", x: 0, y: 1.41, width: 1.38, depth: 2.09, areaM2: 2.88, requiresVentilation: true },
      { id: "vd", floorId: "floor-1", name: "Void", type: "void", x: 1.38, y: 1.41, width: 0.88, depth: 2.09, areaM2: 1.84 },
    ]
    layout.openings = [
      // pintu di dinding BARAT void = garis x=1.38 = batas timur kamar mandi
      { id: "op-1", type: "door", wallId: "vd:w", widthM: 0.6, heightM: 2.1, positionM: 1.0, floorId: "floor-1" },
    ]
    return layout
  }

  it("credits a door registered on the neighbour's coincident wall", () => {
    const res = validateLayout(bathroomWithNeighbourDoor(), sampleSite)
    expect(res.issues.some((i) => i.id === "vent:km")).toBe(false)
  })

  it("still flags when the neighbour's opening is on a NON-shared wall", () => {
    const layout = bathroomWithNeighbourDoor()
    layout.openings[0].wallId = "vd:e" // sisi timur void — tidak menyentuh kamar mandi
    const res = validateLayout(layout, sampleSite)
    expect(res.issues.some((i) => i.id === "vent:km")).toBe(true)
  })
})

describe("validateLayout — resapan di courtyard tertutup atap", () => {
  const base = (): DesignLayout => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [{ id: "f1", level: 1, name: "L1", heightM: 3 }],
    rooms: [
      { id: "n1", floorId: "f1", name: "A", type: "kamar_tidur", x: 2, y: 0, width: 2, depth: 2, areaM2: 4 },
      { id: "s1", floorId: "f1", name: "B", type: "kamar_tidur", x: 2, y: 4, width: 2, depth: 2, areaM2: 4 },
      { id: "w1", floorId: "f1", name: "C", type: "kamar_tidur", x: 0, y: 2, width: 2, depth: 2, areaM2: 4 },
      { id: "taman-1", floorId: "f1", name: "Taman Dalam", type: "taman", x: 2, y: 2, width: 2, depth: 2, areaM2: 4 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    sanitation: {
      soakwell: { id: "soak-1", x: 3, y: 3, widthM: 1, lengthM: 1 } as never,
    } as never,
    validation: { passed: true, issues: [] },
  })

  it("taman terkurung (≥3 sisi solid) TANPA openToSky → warning; openToSky menghapusnya", () => {
    const site = { widthM: 8, depthM: 8 } as never
    const r1 = validateLayout(base(), site, [])
    expect(r1.issues.some((i) => i.id === "resapan:tertutup-atap:taman-1")).toBe(true)

    const open = base()
    open.rooms = open.rooms.map((r) =>
      r.id === "taman-1" ? { ...r, openToSky: true } : r,
    )
    const r2 = validateLayout(open, site, [])
    expect(r2.issues.some((i) => i.id.startsWith("resapan:tertutup-atap"))).toBe(false)
  })
})

describe("validateLayout — headroom split-level (E4)", () => {
  it("offset +0.9 di lantai 1 rumah 2 lantai → warning headroom; offset kecil aman", () => {
    const l: DesignLayout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "L1", heightM: 2.95 },
        { id: "f2", level: 2, name: "L2", heightM: 2.95 },
      ],
      rooms: [
        { id: "a", floorId: "f1", name: "Keluarga", type: "ruang_keluarga", x: 0, y: 0, width: 4, depth: 3, areaM2: 12, levelOffsetM: 0.9 },
        { id: "b", floorId: "f1", name: "Tamu", type: "ruang_tamu", x: 4, y: 0, width: 4, depth: 3, areaM2: 12, levelOffsetM: 0.18 },
      ],
      walls: [], openings: [], stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    }
    const res = validateLayout(l, { widthM: 10, depthM: 10 } as never, [])
    expect(res.issues.some((i) => i.id === "headroom:a")).toBe(true)
    expect(res.issues.some((i) => i.id === "headroom:b")).toBe(false)
  })
})

describe("validateLayout — mezzanine headroom & luas (E8)", () => {
  const mk = (baseOffsetM: number, mzWidth = 3): DesignLayout => ({
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "f1", level: 1, name: "L1", heightM: 2.95 },
      { id: "mz", level: 1.5, name: "Mezzanine", heightM: 2.2, kind: "mezzanine", baseOffsetM },
    ],
    rooms: [
      { id: "a", floorId: "f1", name: "Studio", type: "ruang_keluarga", x: 0, y: 0, width: 6, depth: 3, areaM2: 18 },
      { id: "p1", floorId: "mz", name: "Platform", type: "balkon", x: 0, y: 0, width: mzWidth, depth: 3, areaM2: mzWidth * 3 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  })
  const site = { widthM: 10, depthM: 10 } as never

  it("offset 1.48 pada induk 2.95 → dua warning headroom (bawah & atas sempit)", () => {
    const res = validateLayout(mk(1.48), site, [])
    expect(res.issues.some((i) => i.id === "mezzanine:headroom-bawah:mz")).toBe(true)
    expect(res.issues.some((i) => i.id === "mezzanine:headroom-atas:mz")).toBe(true)
  })

  it("luas platform > 50% induk → info; ≤ 50% aman", () => {
    const res = validateLayout(mk(1.48, 5), site, [])
    expect(res.issues.some((i) => i.id === "mezzanine:luas:mz")).toBe(true)
    const ok = validateLayout(mk(1.48, 2), site, [])
    expect(ok.issues.some((i) => i.id === "mezzanine:luas:mz")).toBe(false)
  })
})

describe("validateLayout — porthole ukuran (Track B)", () => {
  it("porthole terlalu besar (diameter+ambang > tinggi dinding) → warning; pas → aman", () => {
    const base = (widthM: number, sillHeightM: number): DesignLayout => ({
      id: "l", projectId: "p", versionId: "v",
      floors: [{ id: "f1", level: 1, name: "L1", heightM: 2.95 }],
      rooms: [{ id: "a", floorId: "f1", name: "Kamar", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }],
      walls: [],
      openings: [{ id: "ph", floorId: "f1", wallId: "a:s", type: "window", kind: "porthole", positionM: 2, widthM, heightM: widthM, sillHeightM } as never],
      stairs: [], pools: [], validation: { passed: true, issues: [] },
    })
    const site = { widthM: 8, depthM: 8 } as never
    // wallH = 2.95 − 0.15 = 2.8. dia 2 + sill 1.2 = 3.2 > 2.8 → warning.
    expect(validateLayout(base(2, 1.2), site, []).issues.some((i) => i.id === "porthole:tinggi:ph")).toBe(true)
    // dia 0.6 + sill 1.2 = 1.8 ≤ 2.8 → aman.
    expect(validateLayout(base(0.6, 1.2), site, []).issues.some((i) => i.id === "porthole:tinggi:ph")).toBe(false)
  })
})
