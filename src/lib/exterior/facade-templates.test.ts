import { beforeEach, describe, expect, it } from "vitest"

import { makeBoxElement } from "@/lib/exterior/factories"
import { validateExteriorElement } from "@/lib/exterior/validation"
import { useEditorStore } from "@/stores/editor-store"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import {
  buildFacadeComposerTemplate,
  FACADE_COMPOSER_TEMPLATES,
} from "./facade-templates"

describe("buildFacadeComposerTemplate", () => {
  it("builds every catalog template from native semantic elements", () => {
    const layout = makeLayout()
    for (const template of FACADE_COMPOSER_TEMPLATES) {
      const result = buildFacadeComposerTemplate(layout, sampleSite, template.id)
      expect(result.exteriorElements.length).toBeGreaterThanOrEqual(8)
      expect(new Set(result.exteriorElements.map((element) => element.id)).size)
        .toBe(result.exteriorElements.length)
      expect(result.exteriorElements.every((element) => element.label?.startsWith(`Template:${template.id}:`)))
        .toBe(true)
      expect(Object.keys(result.facade).length).toBeGreaterThan(0)
    }
  })

  it("creates the five multi-storey panels and one portal for Scene A", () => {
    const result = buildFacadeComposerTemplate(
      makeLayout(),
      { ...sampleSite, frontOrientation: "south" },
      "modern_concrete_vertical",
    )
    expect(result.exteriorElements.filter((element) => element.kind === "facade_panel")).toHaveLength(5)
    expect(result.exteriorElements.filter((element) => element.kind === "portal_frame")).toHaveLength(1)
  })

  it("uses hosted-wall roster for the Brick Gable template", () => {
    const result = buildFacadeComposerTemplate(
      makeLayout(),
      { ...sampleSite, frontOrientation: "east" },
      "brick_gable_roster",
    )
    expect(result.facadeElements.length).toBeGreaterThan(0)
    expect(result.facadeElements.every((element) => element.kind === "roster_screen")).toBe(true)
  })

  it("menghasilkan pelat overhang_slab pada template cantilever tanpa NaN", () => {
    const result = buildFacadeComposerTemplate(
      makeLayout(),
      sampleSite,
      "cantilever_wood_slat",
    )
    const overhangs = result.exteriorElements.filter(
      (element) => element.kind === "overhang_slab",
    )
    expect(overhangs).toHaveLength(1)
    const slab = overhangs[0]
    if (slab.kind !== "overhang_slab") throw new Error("unreachable")
    // Pelat tipis di elevasi pelat lantai 1 — semua dimensi finite (tanpa NaN).
    expect(slab.zM).toBeCloseTo(2.95, 2)
    expect(slab.heightM).toBeCloseTo(0.18, 2)
    for (const value of [slab.x, slab.y, slab.widthM, slab.depthM, slab.heightM, slab.zM ?? 0]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    // Kesan cantilever menggantikan kanopi menjorok — tak ada canopy ganda.
    expect(result.exteriorElements.some((element) => element.kind === "canopy")).toBe(false)
  })

  it("keeps generated geometry within the site for all four orientations", () => {
    for (const frontOrientation of ["north", "south", "east", "west"] as const) {
      const site = { ...sampleSite, frontOrientation }
      for (const templateId of ["modern_concrete_vertical", "modern_tropis_villa"] as const) {
        const result = buildFacadeComposerTemplate(makeLayout(), site, templateId)
        const dangers = result.exteriorElements.flatMap((element) =>
          validateExteriorElement(element, { site }).filter((issue) => issue.level === "danger"),
        )
        expect(dangers, `${templateId}-${frontOrientation}`).toEqual([])
      }
    }
  })

  it("handles edge cases with extreme site dimensions without throwing NaN or crashing", () => {
    const extremeSites = [
      { ...sampleSite, widthM: 4.5, depthM: 8 },
      { ...sampleSite, widthM: 30, depthM: 50 },
    ]
    for (const site of extremeSites) {
      for (const template of FACADE_COMPOSER_TEMPLATES) {
        const result = buildFacadeComposerTemplate(makeLayout(), site, template.id)
        expect(result.exteriorElements.length).toBeGreaterThan(0)
        expect(result.exteriorElements.every((el) => !Number.isNaN(el.heightM))).toBe(true)
      }
    }
  })
})

describe("editor store facade template transaction", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })

  it("applies as one undo entry and preserves manual exterior elements", () => {
    const manual = makeBoxElement("planter", 2, 2, { id: "manual-planter", label: "Planter manual" })
    useEditorStore.getState().addExteriorElement(manual)
    const before = useEditorStore.getState().past.length

    useEditorStore.getState().applyExteriorTemplate("modern_concrete_vertical")

    const state = useEditorStore.getState()
    expect(state.past).toHaveLength(before + 1)
    expect(state.layout!.exteriorElements!.some((element) => element.id === manual.id)).toBe(true)
    expect(state.layout!.exteriorElements!.some((element) => element.label?.includes("vertical-panel-5"))).toBe(true)

    state.undo()
    expect(useEditorStore.getState().layout!.exteriorElements).toEqual([manual])
  })

  it("replaces a previous template without duplicating template-owned elements", () => {
    useEditorStore.getState().applyExteriorTemplate("modern_concrete_vertical")
    useEditorStore.getState().applyExteriorTemplate("minimalist_portal_carport")

    const elements = useEditorStore.getState().layout!.exteriorElements!
    expect(elements.every((element) => !element.label?.startsWith("Template:modern_concrete_vertical:"))).toBe(true)
    expect(elements.some((element) => element.label?.startsWith("Template:minimalist_portal_carport:"))).toBe(true)
  })
})
