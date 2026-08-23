// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { DesignLayout, Floor, Room } from "@/types"
import { buildLayoutSheet } from "./layout-sheet"
import { buildSheetSvgString } from "./sheet-to-svg"

const floor = (over: Partial<Floor>): Floor => ({
  id: "f1", level: 0, name: "Lantai 1", heightM: 3, ...over,
})
const room = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f1", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})
const layout = (over: Partial<DesignLayout>): DesignLayout => ({
  id: "l", projectId: "p", versionId: "v",
  floors: [floor({})], rooms: [], walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
  ...over,
})

const twoRoomLayout = layout({
  rooms: [
    room({ id: "A", name: "Kamar A", x: 0, y: 0, width: 4, depth: 3, areaM2: 12 }),
    room({ id: "B", name: "Kamar B", x: 4, y: 0, width: 3, depth: 3, areaM2: 9 }),
  ],
})

describe("buildSheetSvgString", () => {
  const drawing = buildLayoutSheet(twoRoomLayout, "f1")
  const svg = buildSheetSvgString(drawing, "D-01", "Rumah Test")

  it("is a self-contained SVG document with the A3 viewBox", () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 420 297"/)
    expect(svg.trim().endsWith("</svg>")).toBe(true)
  })

  it("emits one <line> per DrawLine (plus dim-chain lines and the 2 title-block dividers)", () => {
    const lineCount = (svg.match(/<line /g) ?? []).length
    const dimLineCount = drawing.dims.reduce(
      (s, d) => (d.points.length < 2 ? s : s + 1 + d.points.length),
      0
    )
    const titleBlockDividers = 2
    expect(lineCount).toBe(drawing.lines.length + dimLineCount + titleBlockDividers)
  })

  it("emits room name and sheet number text, escaped, with explicit ink color (no Tailwind classes)", () => {
    expect(svg).toContain(">Kamar A<")
    expect(svg).toContain(">Kamar B<")
    expect(svg).toContain(">D-01<")
    expect(svg).toContain(">Rumah Test<")
    expect(svg).not.toMatch(/class="/)
    expect(svg).toContain('fill="#18181b"')
  })

  it("escapes special characters in project name / titles", () => {
    const dangerous = buildSheetSvgString(drawing, "D-01", "Rumah <Test> & Co")
    expect(dangerous).toContain("Rumah &lt;Test&gt; &amp; Co")
    expect(dangerous).not.toContain("<Test>")
  })
})
