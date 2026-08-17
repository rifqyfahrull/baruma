import { describe, it } from "vitest"
import { writeFileSync } from "node:fs"
import { buildModel } from "./build-model"
import type { DesignLayout, Project, Room } from "@/types"

// Geometri asli floor-k4KTN1 (proj-modern-tropis-1) dari DB.
const rooms: Room[] = [
  { id: "koridor", name: "Koridor", type: "koridor", floorId: "floor-k4KTN1", x: 0.5, y: 0.5, width: 0.94, depth: 17.44, areaM2: 16.39 },
  { id: "k1", name: "Kamar tidur", type: "kamar_tidur", floorId: "floor-k4KTN1", x: 1.5, y: 0.5, width: 5.39, depth: 3.5, areaM2: 18.86 },
  { id: "k2", name: "Kamar tidur", type: "kamar_tidur", floorId: "floor-k4KTN1", x: 1.5, y: 4, width: 5.39, depth: 3.5, areaM2: 18.86 },
  { id: "k3", name: "Kamar tidur", type: "kamar_tidur", floorId: "floor-k4KTN1", x: 1.5, y: 7.5, width: 5.39, depth: 3.5, areaM2: 18.86 },
  { id: "km1", name: "Kamar mandi", type: "kamar_mandi", floorId: "floor-k4KTN1", x: 1.5, y: 11, width: 2.98, depth: 2.15, areaM2: 6.41 },
  { id: "km2", name: "Kamar mandi", type: "kamar_mandi", floorId: "floor-k4KTN1", x: 1.5, y: 13.15, width: 2.98, depth: 2.35, areaM2: 7 },
  { id: "laundry", name: "Laundry", type: "laundry", floorId: "floor-k4KTN1", x: 1.5, y: 15.5, width: 2.98, depth: 2.15, areaM2: 6.41 },
]

const layout: DesignLayout = {
  id: "l", projectId: "p", versionId: "v",
  floors: [{ id: "floor-k4KTN1", level: 2, name: "Lantai 2", heightM: 3.2 }],
  rooms, walls: [], openings: [], stairs: [], pools: [],
  validation: { passed: true, issues: [] },
}
const project = { rooftop: false, name: "P" } as unknown as Project
const opts = { exploded: false, showRoof: false, showFurniture: false }
const site = { widthM: 18, depthM: 18 }

it("dump floor-2 walls", () => {
  const prims = buildModel(layout, site, project, opts).prims.filter((p) => p.kind === "wall")
  // Kelompokkan per (roomId, side), tampilkan posisi & panjang.
  const rows = prims.map((p) => {
    const side = (p as { wallSide?: string }).wallSide ?? "?"
    const pos = p.pos as number[]
    const args = p.args as number[]
    const horizontal = side === "n" || side === "s"
    return {
      id: p.id,
      side,
      line: horizontal ? pos[2] : pos[0],
      span: horizontal ? args[0] : args[2],
    }
  })
  const lines = [`TOTAL WALL PRIMS: ${rows.length}`]
  for (const r of rows) lines.push(`${r.id.padEnd(16)} side=${r.side} line=${r.line} len=${r.span.toFixed(2)}`)
  writeFileSync("wall-dump-out.txt", lines.join("\n"))
})
