import { describe, it, expect } from "vitest"
import { defaultSheets } from "./drawings-pack"
import { buildSection } from "@/lib/drawings/section"
import { buildSheetList } from "@/lib/drawings/sheet-list"
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

// Same fixture as section.test.ts: 2 floors. Floor 1: Kamar A (0..4 x 0..3) +
// Kamar B (4..7 x 0..3) + Carport OPEN (0..3 x 3..5.5). Floor 2: Kamar C
// (0..4 x 0..3). Bounding footprint across all non-rooftop rooms:
// width = max(x+width) = 7 (B), depth = max(y+depth) = 5.5 (carport).
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

describe("defaultSheets", () => {
  const sheets = defaultSheets(baseLayout, [])

  it("returns 32 entries: site plan + 29 + 2 denah", () => {
    // 2 regular floors -> 2 "Rencana Kusen" plans; 2 kusen types (P1 door,
    // J1 window) -> ceil(2/6)=1 "Detail Kusen" sheet. SP2: 6 + 2 + 1 + 1 = 10.
    // SP3 adds per-floor "Pola Lantai" (L-01…) + "Rencana Plafon" (C-01…)
    // and "Detail Atap" (R-01): 10 + 2 + 2 + 1 = 15.
    // SP4 adds per-floor "Rencana Listrik" (E-01…) after plafon, before atap:
    // 15 + 2 = 17.
    // SP5 adds per-floor "Rencana Air" (P-01…) + "Diagram Riser" (P-R) + 3
    // sanitation details (S-01…S-03) after listrik, before atap: 17 + 6 = 23.
    // SP6 adds "Rencana Pondasi" (F-01) + per-floor "Rencana Kolom" (SK-..) +
    // per-floor "Rencana Balok" (B-..) + "Perhitungan Struktur" (ST-01) after
    // sanitasi, before atap: 23 + 1 + 2 + 2 + 1 = 29.
    // 2026-07-11: + 1 Denah per lantai reguler di DEPAN paket = 31.
    // 2026-07-15: + 1 Rencana Tapak di DEPAN paket = 32.
    expect(sheets).toHaveLength(32)
    expect(sheets.map((s) => s.sheetNo)).toEqual([
      "SP-01",
      "D-01", "D-02",
      "A-01", "A-02", "A-03", "A-04", "A-05", "A-06",
      "K-01", "K-02", "K-03", "K-04",
      "L-01", "L-02", "C-01", "C-02", "E-01", "E-02",
      "P-01", "P-02", "P-R", "S-01", "S-02", "S-03",
      "F-01", "SK-01", "SK-02", "B-01", "B-02", "ST-01", "R-01",
    ])
  })

  it("is the shared sheet-list module verbatim: same ids/order/numbering as the /drawings page tabs", () => {
    const entries = buildSheetList(baseLayout)
    expect(sheets.map((s) => s.sheetNo)).toEqual(entries.map((e) => e.sheetNo))
    // Every PDF page title matches its shared-entry drawing title, built with
    // the same mid-building cuts defaultSheets uses (width 7 / depth 5.5).
    const cuts = { cutX: 3.5, cutY: 2.75 }
    entries.forEach((entry, i) => {
      expect(sheets[i].drawing).toEqual(entry.build(baseLayout, [], cuts))
    })
  })

  it("orders titles: site plan, 2 denah, 4 tampak (n/s/e/w) then potongan A-A / B-B", () => {
    expect(sheets.slice(0, 9).map((s) => s.title)).toEqual([
      "Rencana Tapak",
      "Denah — Lantai 1",
      "Denah — Lantai 2",
      "Tampak Utara",
      "Tampak Selatan",
      "Tampak Timur",
      "Tampak Barat",
      "Potongan A-A",
      "Potongan B-B",
    ])
  })

  it("cuts the potongan tengah at the building's mid-width / mid-depth", () => {
    // width = 7 (room B: x=4..7), depth = 5.5 (carport: y=3..5.5) => mid 3.5 / 2.75.
    const expectedA = buildSection(baseLayout, { axis: "x", positionM: 3.5 })
    const expectedB = buildSection(baseLayout, { axis: "y", positionM: 2.75 })
    expect(sheets[7].drawing).toEqual(expectedA)
    expect(sheets[8].drawing).toEqual(expectedB)
  })

  it("appends kusen sheets after the 6 A/B sheets, then pola lantai, plafon, listrik, air, riser, sanitasi, struktur, detail atap", () => {
    expect(sheets.slice(9).map((s) => s.title)).toEqual([
      "Rencana Kusen — Lantai 1",
      "Rencana Kusen — Lantai 2",
      "Daftar Kusen",
      "Detail Kusen",
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
  })
})
