import { describe, expect, it } from "vitest"

import {
  floorplanActionSchema,
  interiorActionSchema,
  type FloorplanScene,
  type InteriorScene,
} from "./actions"
import { buildMessages } from "@/lib/server/editor-assistant"

const FLOORPLAN_CAPABILITIES = [
  "updateRoom", "addOpening", "deleteRoom", "addRoom", "addFloor", "removeFloor",
  "updateFloor",
  "updateOpening", "deleteOpening", "setRoof", "addRoofZone", "updateRoofZone",
  "removeRoofZone", "setRooftop", "setRooftopArea", "clearRooftopArea",
  "setWallCladding", "addFacadeElement", "updateFacadeElement",
  "removeFacadeElement", "addExteriorElement", "updateExteriorElement",
  "removeExteriorElement", "applyFacadeTemplate", "addWallLamp", "updateLamp", "removeLamp", "setSoilBearing",
  "addElectricalPoint", "moveElectricalPoint", "updateElectricalPoint",
  "removeElectricalPoint", "autoGenerateElectrical", "addWaterPoint", "moveWaterPoint",
  "updateWaterPoint", "removeWaterPoint", "autoGenerateWater", "moveSanitationObject",
  "autoSizeSanitation", "aiRender",
] as const

const INTERIOR_CAPABILITIES = [
  "addFurniture", "moveFurniture", "rotateFurniture", "removeFurniture", "setStyle",
  "resetRoom", "addLight", "moveLight", "updateLight", "removeLight", "aiRender",
] as const

// Semua aksi terstruktur (termasuk `aiRender`, 2026-08-29) kini didokumentasikan
// di system prompt LLM (editor-assistant.ts) — tidak ada lagi yang dikecualikan.
const PROMPT_DOC_EXEMPT = new Set<string>([])

function discriminatorValues(schema: typeof floorplanActionSchema | typeof interiorActionSchema): string[] {
  return schema.options.map((option) => option.shape.type.value)
}

const floorplanScene: FloorplanScene = {
  site: { widthM: 8, depthM: 12 },
  floors: [{ id: "floor-1", name: "Lantai 1", level: 1 }],
  rooms: [{
    id: "room-1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "floor-1",
    x: 0, y: 0, width: 4, depth: 4, areaM2: 16,
  }],
  openings: [],
  facadeElements: [],
  exteriorElements: [],
  exteriorLamps: [],
  electrical: [],
  water: [],
}
const interiorScene: InteriorScene = {
  style: "japandi",
  rooms: [{
    roomId: "room-1", name: "Ruang Tamu", type: "ruang_tamu", widthM: 4, depthM: 4,
    furniture: [], lighting: [],
  }],
}

describe("Unified Agent capability parity", () => {
  it("locks the complete floorplan/MEP/facade/exterior capability surface", () => {
    expect(discriminatorValues(floorplanActionSchema)).toEqual(FLOORPLAN_CAPABILITIES)
  })

  it("locks the complete 10-action interior/lighting capability surface", () => {
    expect(discriminatorValues(interiorActionSchema)).toEqual(INTERIOR_CAPABILITIES)
  })

  it("keeps every structured action documented in its mode-specific prompt", () => {
    const floorPrompt = buildMessages("floorplan", floorplanScene, "bantu", [])[0].content
    const interiorPrompt = buildMessages("interior", interiorScene, "bantu", [])[0].content
    for (const capability of FLOORPLAN_CAPABILITIES) {
      if (PROMPT_DOC_EXEMPT.has(capability)) continue
      expect(floorPrompt).toContain(`"${capability}"`)
    }
    for (const capability of INTERIOR_CAPABILITIES) {
      if (PROMPT_DOC_EXEMPT.has(capability)) continue
      expect(interiorPrompt).toContain(`"${capability}"`)
    }
  })

  it("round-trips updateRoom.patch.edgeBowM (balkon tepi melengkung) through the zod action schema", () => {
    const parsed = floorplanActionSchema.parse({
      type: "updateRoom",
      roomId: "room-1",
      patch: { edgeBowM: 0.6 },
    })
    expect(parsed).toMatchObject({ type: "updateRoom", roomId: "room-1", patch: { edgeBowM: 0.6 } })
  })

  it("rejects an out-of-range edgeBowM", () => {
    const result = floorplanActionSchema.safeParse({
      type: "updateRoom",
      roomId: "room-1",
      patch: { edgeBowM: 5 },
    })
    expect(result.success).toBe(false)
  })
})
