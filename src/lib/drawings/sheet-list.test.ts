import { describe, it, expect } from "vitest"
import { buildSheetList, type Cuts } from "./sheet-list"
import { buildSection } from "./section"
import { buildElevation } from "./elevation"
import { buildKusenDetails } from "./kusen-sheets"
import type { DesignLayout, Floor, Opening, Room } from "@/types"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const opening = (over: Partial<Opening>): Opening => ({
  id: "o", floorId: "f1", wallId: "r:s", type: "window", positionM: 1, widthM: 1, heightM: 1, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

// Same fixture as drawings-pack.test.ts: 2 regular floors, 2 kusen types
// (P1 door + J1 window) -> 1 "Detail Kusen" panel sheet.
const baseLayout = layout({
  floors: [
    floor({ id: "f1", level: 0, name: "Lantai 1", heightM: 3 }),
    floor({ id: "f2", level: 1, name: "Lantai 2", heightM: 3 }),
  ],
  rooms: [
    room({ id: "A", floorId: "f1", name: "Kamar A", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    room({ id: "B", floorId: "f1", name: "Kamar B", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 3, areaM2: 9 }),
    room({ id: "CP", floorId: "f1", name: "Carport", type: "carport", x: 0, y: 3, width: 3, depth: 2.5, areaM2: 7.5 }),
    room({ id: "C", floorId: "f2", name: "Kamar C", type: "kamar_tidur", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
  ],
  openings: [
    opening({ id: "doorAS", floorId: "f1", wallId: "A:s", type: "door", positionM: 1.8, widthM: 0.9, heightM: 2.1 }),
    opening({ id: "winBS", floorId: "f1", wallId: "B:s", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 }),
    opening({ id: "winCS", floorId: "f2", wallId: "C:s", type: "window", positionM: 1, widthM: 1.2, heightM: 1.2 }),
  ],
})

const CUTS: Cuts = { cutX: 3.5, cutY: 2.75 }

describe("buildSheetList", () => {
  const list = buildSheetList(baseLayout)

  it("SP6 count + site plan = 32", () => {
    // SP2 for this fixture: 6 A-sheets + 2 kusen plans + 1 daftar + 1 detail = 10.
    // SP3: + 2 pola lantai + 2 plafon + 1 roof detail = 15.
    // SP4: + 2 "Rencana Listrik" (one per regular floor) = 17.
    // SP5: + 2 "Rencana Air" (per regular floor) + 1 "Diagram Riser"
    //      + 3 sanitation details (septic/soakwell/control) = 23.
    // SP6: + 1 "Rencana Pondasi" (F-01) + 2 "Rencana Kolom" (per regular floor)
    //      + 2 "Rencana Balok" (per regular floor) + 1 "Perhitungan Struktur"
    //      (ST-01), after sanitation, before roof-detail = 29.
    // 2026-07-11: + 1 "Denah" per regular floor (D-01..) di DEPAN paket = 31.
    // 2026-07-15: + 1 "Rencana Tapak" dedicated site-plan sheet = 32.
    expect(list).toHaveLength(32)
  })

  it("ids are stable and ordered: …, sanitasi, struktur (pondasi/kolom/balok/calc), detail atap last", () => {
    expect(list.map((e) => e.id)).toEqual([
      "site-plan",
      "denah-f1", "denah-f2",
      "n", "s", "e", "w", "secA", "secB",
      "kusen-f1", "kusen-f2", "kusen-daftar", "kusen-detail-0",
      "floor-pattern-f1", "floor-pattern-f2",
      "ceiling-f1", "ceiling-f2",
      "electrical-f1", "electrical-f2",
      "plumbing-f1", "plumbing-f2",
      "riser",
      "sanitation-septic", "sanitation-soakwell", "sanitation-control",
      "structural-foundation",
      "structural-column-f1", "structural-column-f2",
      "structural-beam-f1", "structural-beam-f2",
      "structural-calc",
      "roof-detail",
    ])
  })

  it("numbers sheets A-01…A-06, K-01…, then L-01…, C-01…, E-01…, P-01…, P-R, S-01…S-03, F-01, SK-.., B-.., ST-01, R-01", () => {
    expect(list.map((e) => e.sheetNo)).toEqual([
      "SP-01",
      "D-01", "D-02",
      "A-01", "A-02", "A-03", "A-04", "A-05", "A-06",
      "K-01", "K-02", "K-03", "K-04",
      "L-01", "L-02",
      "C-01", "C-02",
      "E-01", "E-02",
      "P-01", "P-02",
      "P-R",
      "S-01", "S-02", "S-03",
      "F-01",
      "SK-01", "SK-02",
      "B-01", "B-02",
      "ST-01",
      "R-01",
    ])
  })

  it("labels the new sheets in Bahasa with the floor name", () => {
    expect(list[0]).toMatchObject({ id: "site-plan", label: "Rencana Tapak", kind: "site-plan" })
    const fpIdx = list.findIndex((e) => e.id.startsWith("floor-pattern"))
    expect(list.slice(fpIdx).map((e) => e.label)).toEqual([
      "Pola Lantai — Lantai 1",
      "Pola Lantai — Lantai 2",
      "Rencana Plafon — Lantai 1",
      "Rencana Plafon — Lantai 2",
      "Rencana Listrik — Lantai 1",
      "Rencana Listrik — Lantai 2",
      "Rencana Air — Lantai 1",
      "Rencana Air — Lantai 2",
      "Diagram Riser",
      "Detail Septic Tank",
      "Detail Sumur Resapan",
      "Detail Bak Kontrol",
      "Rencana Pondasi",
      "Rencana Kolom — Lantai 1",
      "Rencana Kolom — Lantai 2",
      "Rencana Balok — Lantai 1",
      "Rencana Balok — Lantai 2",
      "Perhitungan Struktur",
      "Detail Atap",
    ])
    expect(list.slice(fpIdx).map((e) => e.kind)).toEqual([
      "floor-pattern", "floor-pattern", "ceiling", "ceiling",
      "electrical", "electrical",
      "plumbing", "plumbing",
      "riser",
      "sanitation-detail", "sanitation-detail", "sanitation-detail",
      "structural-plan",
      "structural-plan", "structural-plan",
      "structural-plan", "structural-plan",
      "structural-calc",
      "roof-detail",
    ])
  })

  it("inserts SP5 water/sanitation sheets after electrical, before roof-detail (last)", () => {
    const ids = list.map((e) => e.id)

    // One "Rencana Air" per regular floor (P-0n): after that floor's electrical,
    // before the riser.
    for (const [i, floorId] of ["f1", "f2"].entries()) {
      const entry = list.find((e) => e.id === `plumbing-${floorId}`)!
      expect(entry).toBeDefined()
      expect(entry.kind).toBe("plumbing")
      expect(entry.sheetNo).toBe(`P-0${i + 1}`)
      expect(entry.label).toBe(`Rencana Air — Lantai ${i + 1}`)
      expect(ids.indexOf(`plumbing-${floorId}`)).toBeGreaterThan(ids.indexOf(`electrical-${floorId}`))
      expect(ids.indexOf(`plumbing-${floorId}`)).toBeLessThan(ids.indexOf("riser"))
    }

    // One riser diagram (P-R) after all plumbing, before the sanitation details.
    const riser = list.find((e) => e.id === "riser")!
    expect(riser.kind).toBe("riser")
    expect(riser.sheetNo).toBe("P-R")
    expect(riser.label).toBe("Diagram Riser")
    expect(ids.indexOf("riser")).toBeGreaterThan(ids.indexOf("plumbing-f2"))

    // Three sanitation details S-01/02/03 in order, all before roof-detail.
    const sani: [string, string, string][] = [
      ["sanitation-septic", "S-01", "Detail Septic Tank"],
      ["sanitation-soakwell", "S-02", "Detail Sumur Resapan"],
      ["sanitation-control", "S-03", "Detail Bak Kontrol"],
    ]
    let prev = ids.indexOf("riser")
    for (const [id, no, label] of sani) {
      const entry = list.find((e) => e.id === id)!
      expect(entry.kind).toBe("sanitation-detail")
      expect(entry.sheetNo).toBe(no)
      expect(entry.label).toBe(label)
      expect(ids.indexOf(id)).toBeGreaterThan(prev)
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf("roof-detail"))
      prev = ids.indexOf(id)
    }

    // roof-detail stays last.
    expect(ids[ids.length - 1]).toBe("roof-detail")

    // build(layout, interiors) yields drawings whose titles match the labels.
    expect(list.find((e) => e.id === "plumbing-f1")!.build(baseLayout, [], CUTS).title).toBe("Rencana Air — Lantai 1")
    expect(list.find((e) => e.id === "riser")!.build(baseLayout, [], CUTS).title).toBe("Diagram Riser")
    expect(list.find((e) => e.id === "sanitation-septic")!.build(baseLayout, [], CUTS).title).toBe("Detail Septic Tank")
    expect(list.find((e) => e.id === "sanitation-soakwell")!.build(baseLayout, [], CUTS).title).toBe("Detail Sumur Resapan")
    expect(list.find((e) => e.id === "sanitation-control")!.build(baseLayout, [], CUTS).title).toBe("Detail Bak Kontrol")
  })

  it("inserts SP6 structural sheets after sanitation, before roof-detail (last)", () => {
    const ids = list.map((e) => e.id)

    // One foundation plan (F-01) right after the last sanitation detail.
    const foundation = list.find((e) => e.id === "structural-foundation")!
    expect(foundation).toBeDefined()
    expect(foundation.kind).toBe("structural-plan")
    expect(foundation.sheetNo).toBe("F-01")
    expect(foundation.label).toBe("Rencana Pondasi")
    expect(ids.indexOf("structural-foundation")).toBeGreaterThan(ids.indexOf("sanitation-control"))
    expect(foundation.build(baseLayout, [], CUTS).title).toBe("Rencana Pondasi")

    // One column plan (SK-0n) + one beam plan (B-0n) per regular floor.
    for (const [i, floorId] of ["f1", "f2"].entries()) {
      const col = list.find((e) => e.id === `structural-column-${floorId}`)!
      expect(col.kind).toBe("structural-plan")
      expect(col.sheetNo).toBe(`SK-0${i + 1}`)
      expect(col.label).toBe(`Rencana Kolom — Lantai ${i + 1}`)
      expect(col.build(baseLayout, [], CUTS).title).toBe(`Rencana Kolom — Lantai ${i + 1}`)
      expect(ids.indexOf(`structural-column-${floorId}`)).toBeGreaterThan(ids.indexOf("structural-foundation"))

      const beam = list.find((e) => e.id === `structural-beam-${floorId}`)!
      expect(beam.kind).toBe("structural-plan")
      expect(beam.sheetNo).toBe(`B-0${i + 1}`)
      expect(beam.label).toBe(`Rencana Balok — Lantai ${i + 1}`)
      expect(beam.build(baseLayout, [], CUTS).title).toBe(`Rencana Balok — Lantai ${i + 1}`)
      expect(ids.indexOf(`structural-beam-${floorId}`)).toBeGreaterThan(ids.indexOf("structural-column-f2"))
    }

    // The calc sheet (ST-01) closes the structural block, before roof-detail.
    const calc = list.find((e) => e.id === "structural-calc")!
    expect(calc.kind).toBe("structural-calc")
    expect(calc.sheetNo).toBe("ST-01")
    expect(calc.label).toBe("Perhitungan Struktur")
    expect(calc.build(baseLayout, [], CUTS).title).toBe("Perhitungan Struktur")
    expect(ids.indexOf("structural-calc")).toBeGreaterThan(ids.indexOf("structural-beam-f2"))
    expect(ids.indexOf("structural-calc")).toBeLessThan(ids.indexOf("roof-detail"))

    // Every structural entry sits before the roof-detail sheet, which stays last.
    for (const id of ["structural-foundation", "structural-column-f1", "structural-beam-f2", "structural-calc"]) {
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf("roof-detail"))
    }
    expect(ids[ids.length - 1]).toBe("roof-detail")
  })

  it("adds one 'Rencana Listrik' sheet per regular floor: after ceiling, before roof-detail (last)", () => {
    const ids = list.map((e) => e.id)
    // One electrical entry per regular floor, correctly shaped.
    for (const [i, floorId] of ["f1", "f2"].entries()) {
      const entry = list.find((e) => e.id === `electrical-${floorId}`)!
      expect(entry).toBeDefined()
      expect(entry.kind).toBe("electrical")
      expect(entry.sheetNo).toBe(`E-0${i + 1}`)
      expect(entry.label).toBe(`Rencana Listrik — Lantai ${i + 1}`)
      // Ordered after this floor's ceiling entry…
      expect(ids.indexOf(`electrical-${floorId}`)).toBeGreaterThan(
        ids.indexOf(`ceiling-${floorId}`)
      )
      // …and before the roof-detail sheet, which stays last.
      expect(ids.indexOf(`electrical-${floorId}`)).toBeLessThan(ids.indexOf("roof-detail"))
    }
    expect(ids[ids.length - 1]).toBe("roof-detail")
    // build(layout, interiors) yields a "Rencana Listrik" drawing.
    const first = list.find((e) => e.id === "electrical-f1")!
    const drawing = first.build(baseLayout, [], CUTS)
    expect(drawing.title).toMatch(/^Rencana Listrik/)
  })

  it("build() closures produce drawings whose titles match the labels (empty interiors ok)", () => {
    for (const entry of list) {
      const drawing = entry.build(baseLayout, [], CUTS)
      if (entry.kind === "section" || entry.kind === "kusen-detail") continue
      expect(drawing.title).toBe(entry.label)
    }
  })

  it("section entries honour the passed cut positions", () => {
    const secA = list.find((e) => e.id === "secA")!
    const secB = list.find((e) => e.id === "secB")!
    expect(secA.build(baseLayout, [], CUTS)).toEqual(
      buildSection(baseLayout, { axis: "x", positionM: 3.5 })
    )
    expect(secB.build(baseLayout, [], CUTS)).toEqual(
      buildSection(baseLayout, { axis: "y", positionM: 2.75 })
    )
  })

  it("elevation entries ignore interiors/cuts and match buildElevation", () => {
    const north = list.find((e) => e.id === "n")!
    expect(north.build(baseLayout, [], CUTS)).toEqual(buildElevation(baseLayout, "n"))
  })

  it("accepts pre-built kusen details so callers can memoize them", () => {
    const details = buildKusenDetails(baseLayout)
    const withShared = buildSheetList(baseLayout, details)
    const detailEntry = withShared.find((e) => e.id === "kusen-detail-0")!
    // Same array element by reference — not rebuilt.
    expect(detailEntry.build(baseLayout, [], CUTS)).toBe(details[0])
  })

  it("keeps the floor-pattern/ceiling sheets per REGULAR floor only (rooftop excluded)", () => {
    const withRooftop = layout({
      floors: [
        floor({ id: "f1", level: 0, name: "Lantai 1" }),
        floor({ id: "floor-rooftop", level: 1, name: "Rooftop" }),
      ],
      rooms: [room({ id: "A", floorId: "f1" })],
    })
    const ids = buildSheetList(withRooftop).map((e) => e.id)
    expect(ids).toContain("floor-pattern-f1")
    expect(ids).toContain("ceiling-f1")
    expect(ids).toContain("electrical-f1")
    expect(ids).toContain("plumbing-f1")
    expect(ids).toContain("riser")
    expect(ids).toContain("sanitation-septic")
    expect(ids).toContain("structural-foundation")
    expect(ids).toContain("structural-column-f1")
    expect(ids).toContain("structural-beam-f1")
    expect(ids).toContain("structural-calc")
    expect(ids).not.toContain("floor-pattern-floor-rooftop")
    expect(ids).not.toContain("ceiling-floor-rooftop")
    expect(ids).not.toContain("electrical-floor-rooftop")
    expect(ids).not.toContain("plumbing-floor-rooftop")
    expect(ids).not.toContain("structural-column-floor-rooftop")
    expect(ids).not.toContain("structural-beam-floor-rooftop")
    // 6 + (1 kusen plan + 1 daftar + 0 details) + 1 pola + 1 plafon + 1 listrik
    //   + 1 air + 1 riser + 3 sanitasi + 1 pondasi + 1 kolom + 1 balok
    //   + 1 calc + 1 atap
    expect(ids[ids.length - 1]).toBe("roof-detail")
  })
})


describe("buildSheetList â€” sheet kolam (pool-piping)", () => {
  it("layout dengan kolam mendaftarkan sheet pool-piping P-K1 setelah riser; tanpa kolam tidak ada", () => {
    const withPool = layout({
      rooms: [
        ...baseLayout.rooms,
        { ...room({}), id: "room-pool", name: "Kolam", type: "kolam", poolKind: "renang" },
      ],
    })
    const entries = buildSheetList(withPool)
    const idx = entries.findIndex((e) => e.id === "pool-piping")
    expect(idx).toBeGreaterThan(entries.findIndex((e) => e.id === "riser"))
    expect(entries[idx].sheetNo).toBe("P-K1")
    expect(buildSheetList(baseLayout).some((e) => e.id === "pool-piping")).toBe(false)
  })

  it("layout dengan kolam juga mendaftarkan sheet pool-detail P-K2 tepat setelah pool-piping", () => {
    const withPool = layout({
      rooms: [
        ...baseLayout.rooms,
        { ...room({}), id: "room-pool", name: "Kolam", type: "kolam", poolKind: "renang" },
      ],
    })
    const entries = buildSheetList(withPool)
    const idx = entries.findIndex((e) => e.id === "pool-detail")
    expect(idx).toBe(entries.findIndex((e) => e.id === "pool-piping") + 1)
    expect(entries[idx].sheetNo).toBe("P-K2")
    expect(buildSheetList(baseLayout).some((e) => e.id === "pool-detail")).toBe(false)
  })
})
