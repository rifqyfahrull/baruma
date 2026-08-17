import type { DesignLayout, ExteriorElement, FacadeElement, Site } from "@/types"
import {
  makeBoxElement,
  makeStairElement,
  makeFrameElement,
  makeSegmentElement,
  makeSurfaceElement,
} from "@/lib/exterior/factories"
import {
  buildFacadePreset,
  orientationToFrontSide,
} from "@/lib/three/facade-presets"

export type FacadeComposerTemplateId =
  | "modern_concrete_vertical"
  | "brick_gable_roster"
  | "minimalist_portal_carport"
  | "modern_tropis_villa"
  | "skillion_carport_wood"
  | "cantilever_wood_slat"
  | "japandi_screen_gate"
  | "tropis_green_wall"
  | "scandi_tropis"
  | "modern_staggered"

export const FACADE_COMPOSER_TEMPLATE_IDS = [
  "modern_concrete_vertical",
  "brick_gable_roster",
  "minimalist_portal_carport",
  "modern_tropis_villa",
  "skillion_carport_wood",
  "cantilever_wood_slat",
  "japandi_screen_gate",
  "tropis_green_wall",
  "scandi_tropis",
  "modern_staggered",
] as const satisfies readonly FacadeComposerTemplateId[]

export type FacadeComposerTemplate = {
  id: FacadeComposerTemplateId
  label: string
  description: string
  facadePresetId: string
}

export const FACADE_COMPOSER_TEMPLATES: readonly FacadeComposerTemplate[] = [
  {
    id: "modern_concrete_vertical",
    label: "Modern Concrete Vertical",
    description: "Portal besar, panel beton vertikal, canopy, gate, driveway, dan planter.",
    facadePresetId: "modern_dua_tona",
  },
  {
    id: "brick_gable_roster",
    label: "Brick Gable Roster",
    description: "Portal carport, roster depan, gate, walkway, dan planting bed.",
    facadePresetId: "tropis_kayu",
  },
  {
    id: "minimalist_portal_carport",
    label: "Minimalist Portal Carport",
    description: "Komposisi putih ringkas dengan portal, canopy, dan pagar depan.",
    facadePresetId: "minimalis_putih",
  },
  {
    id: "modern_tropis_villa",
    label: "Modern Tropis Villa",
    description: "Komposisi villa tropis mewah 2 lantai: fasad travertine marmer krem, overstek kanopi kayu WPC, balkon railing kaca, dan louver kayu vertikal.",
    facadePresetId: "modern_tropis_villa",
  },
  {
    id: "skillion_carport_wood",
    label: "Skillion Carport Kayu",
    description: "Carport terbuka berkanopi kayu, sirip vertikal kayu, planting bed batu, gate & driveway — gaya atap miring charcoal-kayu.",
    facadePresetId: "skillion_charcoal",
  },
  {
    id: "cantilever_wood_slat",
    label: "Cantilever Wood-Slat",
    description: "Portal garasi berkanopi menjorok, bilah kayu horizontal, planter beton, driveway + walkway — kubus putih-kayu bingkai hitam.",
    facadePresetId: "wood_slat_putih",
  },
  {
    id: "japandi_screen_gate",
    label: "Japandi Sirip + Gerbang",
    description: "Sirip kayu vertikal sebagai screen, gerbang pejalan dekoratif, planter batu, walkway — plester putih Japandi tropis.",
    facadePresetId: "japandi_sirip",
  },
  {
    id: "tropis_green_wall",
    label: "Tropis Green Wall",
    description: "Bidang taman vertikal (green wall) di muka, planting bed, pagar + walkway — fasad hijau tropis putih-kayu.",
    facadePresetId: "tropis_hijau",
  },
  {
    id: "scandi_tropis",
    label: "Scandi Tropis",
    description: "Putih + kayu + kusen hitam: tangga eksterior ke balkon, kanopi gelap, pilar batu, planter — pasangkan dgn gable asimetris + sopi-sopi kaca (kartu Atap) utk look penuh ref scandi-tropis.",
    facadePresetId: "scandi_tropis",
  },
  {
    id: "modern_staggered",
    label: "Modern Staggered",
    description: "Massa berundak modern: kanopi besar melintang, kolom aksen, panel kayu area pintu — bingkai jendela menonjol diatur per bukaan (frameDepthM); fascia via kartu Atap.",
    facadePresetId: "wood_slat_putih",
  },
] as const

export type FacadeTemplateResult = {
  exteriorElements: ExteriorElement[]
  facade: Record<string, string>
  facadeElements: FacadeElement[]
}

function templateById(id: string): FacadeComposerTemplate {
  return FACADE_COMPOSER_TEMPLATES.find((template) => template.id === id)
    ?? FACADE_COMPOSER_TEMPLATES[0]
}

export function buildFacadeComposerTemplate(
  layout: DesignLayout,
  site: Pick<Site, "widthM" | "depthM" | "frontOrientation">,
  templateId: string,
): FacadeTemplateResult {
  const template = templateById(templateId)
  const frontSide = orientationToFrontSide(site.frontOrientation)
  const horizontal = frontSide === "n" || frontSide === "s"
  const frontageM = horizontal ? site.widthM : site.depthM
  const groundFloorId = layout.floors
    .filter((floor) => floor.id !== "floor-rooftop")
    .sort((a, b) => a.level - b.level)[0]?.id
  const storeyCount = Math.max(
    1,
    layout.floors.filter((floor) => floor.id !== "floor-rooftop").length,
  )
  const fullHeightM = Math.min(9, storeyCount * 2.9)
  const tag = (name: string) => `Template:${template.id}:${name}`
  const point = (u: number, inset: number) => {
    if (frontSide === "n") return { x: u, y: inset }
    if (frontSide === "s") return { x: u, y: site.depthM - inset }
    if (frontSide === "w") return { x: inset, y: u }
    return { x: site.widthM - inset, y: u }
  }
  const box = (
    kind: "facade_panel" | "canopy" | "overhang_slab" | "planter",
    u: number,
    inset: number,
    widthM: number,
    depthM: number,
    heightM: number,
    zM: number,
    label: string,
    materialId: string,
  ) => {
    const center = point(u, inset)
    return makeBoxElement(kind, center.x, center.y, {
      floorId: groundFloorId,
      label: tag(label),
      widthM,
      depthM,
      heightM,
      zM,
      rotationDeg: horizontal ? 0 : 90,
      material: { materialId },
    })
  }
  const segment = (
    kind: "boundary_wall" | "sliding_gate" | "pedestrian_gate",
    u0: number,
    u1: number,
    heightM: number,
    label: string,
  ) => makeSegmentElement(kind, point(u0, 0.12), point(u1, 0.12), {
    label: tag(label),
    heightM,
    material: { materialId: kind === "boundary_wall" ? "beton_ekspos" : "granit_hitam" },
  })
  const surface = (
    kind: "driveway" | "walkway" | "garden_bed",
    u0: number,
    u1: number,
    inset: number,
    label: string,
  ) => makeSurfaceElement(kind, [
    point(u0, 0.2),
    point(u1, 0.2),
    point(u1, inset),
    point(u0, inset),
  ], {
    label: tag(label),
    material: { materialId: kind === "garden_bed" ? "tanah_taman" : "beton_ekspos" },
  })
  const portalAt = (u: number, inset: number, widthM: number, label: string) => {
    const center = point(u, inset)
    return makeFrameElement(center.x, center.y, {
      floorId: groundFloorId,
      label: tag(label),
      widthM,
      heightM: 3.1,
      depthM: 0.35,
      memberSizeM: 0.3,
      rotationDeg: horizontal ? 0 : 90,
      material: { materialId: "bata_putih" },
    })
  }

  const ext: ExteriorElement[] = []
  const wallA = frontageM * 0.1
  const vehicleEnd = frontageM * 0.55
  const pedestrianStart = frontageM * 0.68
  const pedestrianEnd = Math.min(frontageM * 0.8, pedestrianStart + 1.2)
  ext.push(
    segment("boundary_wall", 0, wallA, 1.6, "boundary-left"),
    segment("sliding_gate", wallA, vehicleEnd, 1.8, "vehicle-gate"),
    segment("boundary_wall", vehicleEnd, pedestrianStart, 1.6, "boundary-center"),
    segment("pedestrian_gate", pedestrianStart, pedestrianEnd, 1.8, "pedestrian-gate"),
    segment("boundary_wall", pedestrianEnd, frontageM, 1.6, "boundary-right"),
    surface("driveway", wallA, vehicleEnd, Math.min(5, site.depthM * 0.35), "driveway"),
    surface("walkway", pedestrianStart, pedestrianEnd, Math.min(4, site.depthM * 0.28), "walkway"),
  )

  if (template.id === "modern_concrete_vertical") {
    const portalWidth = Math.max(2.8, (vehicleEnd - wallA) * 0.95)
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.15, portalWidth, "portal"),
      box("canopy", (wallA + vehicleEnd) / 2, 2.2, portalWidth, 3.2, 0.18, 2.75, "canopy", "kayu_cladding"),
      box("planter", frontageM * 0.86, 1.15, Math.max(1, frontageM * 0.18), 0.6, 0.55, 0, "planter", "beton_ekspos"),
    )
    const start = frontageM * 0.58
    const available = Math.max(2, frontageM * 0.36)
    const panelW = Math.min(0.75, available / 7)
    for (let i = 0; i < 5; i++) {
      ext.push(box(
        "facade_panel",
        start + (i + 0.5) * (available / 5),
        2.3,
        panelW,
        0.22,
        fullHeightM,
        0,
        `vertical-panel-${i + 1}`,
        "beton_ekspos",
      ))
    }
  } else if (template.id === "modern_tropis_villa") {
    const portalWidth = Math.max(3.2, (vehicleEnd - wallA) * 0.98)
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.1, portalWidth, "portal-carport"),
      box("canopy", (wallA + vehicleEnd) / 2, 2.1, portalWidth, 3.2, 0.2, 2.8, "canopy-wpc", "kayu_cladding"),
      box("planter", frontageM * 0.82, 1.1, Math.max(1.2, frontageM * 0.2), 0.7, 0.5, 0, "planter-terrace", "marmer_krem"),
    )
  } else if (template.id === "brick_gable_roster") {
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.05, Math.max(2.8, vehicleEnd - wallA), "portal"),
      box("planter", frontageM * 0.84, 1.1, Math.max(1.2, frontageM * 0.22), 0.7, 0.5, 0, "planting-bed", "bata_ekspos"),
    )
  } else if (template.id === "skillion_carport_wood") {
    const portalWidth = Math.max(2.8, (vehicleEnd - wallA) * 0.96)
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.1, portalWidth, "portal-carport"),
      box("canopy", (wallA + vehicleEnd) / 2, 2.1, portalWidth, 3.0, 0.18, 2.7, "canopy-kayu", "kayu_cladding"),
      box("planter", frontageM * 0.84, 1.05, Math.max(1.1, frontageM * 0.2), 0.6, 0.5, 0, "planting-bed", "batu_andesit"),
      surface("garden_bed", pedestrianEnd, frontageM, Math.min(3, site.depthM * 0.22), "garden-strip"),
    )
  } else if (template.id === "cantilever_wood_slat") {
    const portalWidth = Math.max(3.0, (vehicleEnd - wallA) * 0.98)
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.1, portalWidth, "portal-garasi"),
      // Pelat menjorok selebar carport di elevasi pelat lantai 1 (~2.95 m) —
      // memberi kesan lantai atas cantilever tanpa mengubah massa lantai
      // (PLAN_TUTUP_GAP Gap 2 Track A).
      box("overhang_slab", (wallA + vehicleEnd) / 2, 2.4, portalWidth, 3.4, 0.18, 2.95, "overhang-cantilever", "beton_ekspos"),
      box("planter", frontageM * 0.85, 1.05, Math.max(1.0, frontageM * 0.2), 0.6, 0.5, 0, "planter-entry", "beton_ekspos"),
    )
  } else if (template.id === "japandi_screen_gate") {
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.05, Math.max(2.8, vehicleEnd - wallA), "portal"),
      box("planter", frontageM * 0.86, 1.1, Math.max(1.0, frontageM * 0.18), 0.55, 0.5, 0, "planter-batu", "batu_alam_gelap"),
      surface("garden_bed", 0, wallA, Math.min(2.5, site.depthM * 0.2), "garden-left"),
    )
  } else if (template.id === "tropis_green_wall") {
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.05, Math.max(2.8, vehicleEnd - wallA), "portal"),
      box("planter", frontageM * 0.84, 1.1, Math.max(1.2, frontageM * 0.22), 0.7, 0.5, 0, "planting-bed", "taman_vertikal"),
      surface("garden_bed", pedestrianEnd, frontageM, Math.min(3, site.depthM * 0.24), "garden-strip"),
    )
  } else if (template.id === "scandi_tropis") {
    // Ref prototipe scandi-tropis: tangga eksterior kiri → balkon lt-2 (railing
    // otomatis terpotong di pendaratan, R1), kanopi gelap di entry, pilar batu,
    // planter. Gable asimetris + sopi-sopi kaca menyusul via kartu Atap.
    const stairStart = point(Math.max(0.8, frontageM * 0.06), 0.5)
    const dirToHouse =
      frontSide === "n" ? "n" : frontSide === "s" ? "s" : frontSide === "w" ? "e" : "w"
    ext.push(
      makeStairElement(stairStart.x, stairStart.y, {
        label: tag("tangga-balkon"),
        widthM: 1.2,
        lengthM: 5,
        riseM: 3,
        direction: dirToHouse,
        floorId: groundFloorId,
        material: { materialId: "beton_ekspos" },
      }),
      box("canopy", pedestrianStart + 0.6, 1.6, Math.max(2.4, frontageM * 0.22), 2.2, 0.16, 2.6, "kanopi-gelap", "granit_hitam"),
      box("facade_panel", vehicleEnd + 0.5, 1.0, 0.6, 0.3, 4.0, 0, "pilar-batu", "batu_alam_gelap"),
      box("planter", frontageM * 0.8, 1.15, Math.max(1.4, frontageM * 0.24), 0.6, 0.45, 0, "planter-roster", "batu_andesit"),
    )
  } else if (template.id === "modern_staggered") {
    // Ref prototipe v5: kanopi BESAR melintang, kolom aksen abu, panel kayu
    // area pintu. Bingkai jendela menonjol = Opening.frameDepthM per bukaan.
    ext.push(
      box("canopy", frontageM * 0.45, 2.4, Math.max(6, frontageM * 0.78), 3.4, 0.24, 2.9, "kanopi-besar", "bata_putih"),
      box("facade_panel", vehicleEnd + 0.8, 1.0, 1.5, 0.4, 6.5, 0, "kolom-aksen", "granit_hitam"),
      box("facade_panel", pedestrianStart + 0.5, 0.9, Math.max(3.0, frontageM * 0.28), 0.2, 5.5, 0, "panel-kayu-entry", "kayu_cladding"),
      box("planter", frontageM * 0.9, 1.2, Math.max(1.0, frontageM * 0.16), 0.6, 0.5, 0, "planter", "beton_ekspos"),
    )
  } else {
    ext.push(
      portalAt((wallA + vehicleEnd) / 2, 1.05, Math.max(2.8, vehicleEnd - wallA), "portal"),
      box("canopy", (wallA + vehicleEnd) / 2, 2, Math.max(2.8, vehicleEnd - wallA), 2.8, 0.16, 2.7, "canopy", "bata_putih"),
    )
  }

  const facade = buildFacadePreset(layout, template.facadePresetId, frontSide)
  let facadeElements: FacadeElement[]
  if (template.id === "brick_gable_roster") {
    // Muka bata + gable → sirip diganti roster (krawangan/breeze-block) warna
    // terakota, khas fasad tropis bata tanah liat (ref #10/#11).
    facadeElements = facade.facadeElements.map((element) => ({
      ...element,
      kind: "roster_screen" as const,
      finish: "terakota" as const,
    }))
  } else if (template.id === "cantilever_wood_slat") {
    // Kubus putih-kayu → bilah kayu HORIZONTAL, bukan sirip vertikal.
    facadeElements = facade.facadeElements.map((element) => ({
      ...element,
      kind: "slat_horizontal" as const,
      finish: "kayu" as const,
    }))
  } else {
    // skillion_carport_wood & japandi_screen_gate memakai louver vertikal
    // bawaan preset (finish kayu) — sudah sesuai referensi sirip vertikal.
    facadeElements = facade.facadeElements
  }

  return {
    exteriorElements: ext,
    facade: facade.facade,
    facadeElements,
  }
}
