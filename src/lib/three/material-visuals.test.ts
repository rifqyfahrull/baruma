import { describe, expect, it } from "vitest"

import { MATERIAL_LIBRARY } from "@/lib/interior/presets"
import { materialVisualForAssignment, materialVisualForRoof } from "./material-visuals"
import type { MaterialAssignment } from "@/types"

const assignment = (materialId: string): MaterialAssignment => ({
  id: `mat-r1-${materialId}`,
  roomId: "r1",
  surface: "wall",
  materialId,
  name: materialId,
  areaM2: 10,
  priceRange: { low: 1, mid: 2, high: 3 },
})

describe("material visuals", () => {
  it("maps exposed brick to the brick procedural texture", () => {
    expect(materialVisualForAssignment(assignment("wall-exposed-brick"))).toMatchObject({
      color: "#9b5139",
      texture: "brick",
    })
  })

  it("maps roof metal to a real photo map (asset bank) with semi-metallic PBR", () => {
    // 2026-07-11: roof visuals moved from procedural to real photos where the
    // asset bank has them (metal/genteng/keramik) — aspal stays procedural.
    expect(materialVisualForRoof("metal")).toMatchObject({
      mapUrl: "/textures/tex-atap-metal.jpg",
      metalness: 0.3,
    })
    expect(materialVisualForRoof("aspal")).toMatchObject({ texture: "concrete" })
  })
})

describe("material-visuals — konsistensi katalog motif", () => {
  it("every asset-bank motif material has a visual with a /textures/ mapUrl", () => {
    const motifIds = MATERIAL_LIBRARY.filter((m) =>
      m.id.startsWith("wall-bata-") || m.id.startsWith("panel-kayu-") ||
      m.id.startsWith("floor-parket-") || m.id.startsWith("floor-karpet-")
    ).map((m) => m.id)
    expect(motifIds.length).toBeGreaterThanOrEqual(13)
    for (const id of motifIds) {
      const visual = materialVisualForAssignment(assignment(id))
      expect(visual, `visual for ${id}`).toBeTruthy()
      expect(visual!.mapUrl, `mapUrl for ${id}`).toMatch(/^\/textures\/tex-[\w-]+\.jpg$/)
    }
  })

  it("procedural motif materials still resolve", () => {
    for (const id of ["wall-wallpaper-stripes", "wall-wainscot-panel", "wall-geometric-motif"]) {
      expect(materialVisualForAssignment(assignment(id))?.texture).toBeTruthy()
    }
  })
})
