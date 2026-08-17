import { describe, expect, it } from "vitest"

import { openingVisualSpec } from "./opening-visuals"

describe("openingVisualSpec", () => {
  it("makes curtain wall visibly different from a regular sliding window", () => {
    const regular = openingVisualSpec({ type: "window", kind: "sliding_window", operation: "sliding" })
    const curtain = openingVisualSpec({ type: "window", kind: "curtain_wall", operation: "fixed", frameMaterial: "frameless" })

    expect(curtain.panelSegments).toBeGreaterThan(regular.panelSegments)
    expect(curtain.opacity).toBeLessThan(regular.opacity)
    expect(curtain.frameColor).not.toBe(regular.frameColor)
  })

  it("renders jalousie as slatted ventilation instead of plain glass", () => {
    const spec = openingVisualSpec({ type: "window", kind: "jalousie_window", operation: "louvre" })

    expect(spec.horizontalSlats).toBeGreaterThan(0)
    expect(spec.showsGlass).toBe(true)
  })

  it("renders roster as a perforated solid block", () => {
    const spec = openingVisualSpec({ type: "window", kind: "roster", operation: "perforated", frameMaterial: "concrete" })

    expect(spec.perforationCols).toBeGreaterThan(0)
    expect(spec.perforationRows).toBeGreaterThan(0)
    expect(spec.showsGlass).toBe(false)
    expect(spec.showsSolidPanel).toBe(true)
  })

  it("renders folding door as multiple panels", () => {
    const spec = openingVisualSpec({ type: "door", kind: "folding_door", operation: "folding" })

    expect(spec.panelSegments).toBe(4)
    expect(spec.showsGlass).toBe(true)
  })
})

describe("openingVisualSpec — pintu garasi (sectional)", () => {
  it("panel solid abu + 4 garis panel horizontal, tanpa kaca", () => {
    const spec = openingVisualSpec({ type: "door", kind: "garage_door", operation: "sliding" })
    expect(spec.showsSolidPanel).toBe(true)
    expect(spec.showsGlass).toBe(false)
    expect(spec.opacity).toBe(1)
    expect(spec.horizontalSlats).toBe(4)
    expect(spec.panelSegments).toBe(1) // daun tunggal, bukan 2 panel sliding
    expect(spec.frameColor).toBe("#3c4245")
  })

  it("frameColor custom menang atas kusen baja bawaan", () => {
    const spec = openingVisualSpec({ type: "door", kind: "garage_door", frameColor: "#ffffff" })
    expect(spec.frameColor).toBe("#ffffff")
  })
})

describe("openingVisualSpec — porthole (jendela bulat)", () => {
  it("kaca fixed satu panel dengan hint bentuk bundar, tanpa panel solid", () => {
    const spec = openingVisualSpec({ type: "window", kind: "porthole", operation: "fixed" })
    expect(spec.shape).toBe("round")
    expect(spec.showsGlass).toBe(true)
    expect(spec.showsSolidPanel).toBe(false)
    expect(spec.panelSegments).toBe(1)
    expect(spec.horizontalSlats).toBe(0)
    expect(spec.verticalSlats).toBe(0)
    expect(spec.opacity).toBeLessThan(1) // kaca transparan seperti jendela lain
  })

  it("jendela persegi biasa tidak membawa hint shape", () => {
    const spec = openingVisualSpec({ type: "window", kind: "fixed_window", operation: "fixed" })
    expect(spec.shape).toBeUndefined()
  })
})
