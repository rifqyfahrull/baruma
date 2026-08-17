import type { OpeningFrameMaterial, OpeningKind, OpeningOperation } from "@/types"

export type OpeningVisualSpec = {
  panelColor: string
  frameColor: string
  opacity: number
  roughness: number
  metalness: number
  panelSegments: number
  horizontalSlats: number
  verticalSlats: number
  perforationRows: number
  perforationCols: number
  showsGlass: boolean
  showsSolidPanel: boolean
  /** Hint bentuk non-persegi: "round" = daun/kusen bundar (porthole). */
  shape?: "round"
}

const FRAME_COLOR: Record<OpeningFrameMaterial, string> = {
  aluminium: "#647076",
  wood: "#8a5a33",
  upvc: "#e8ecec",
  steel: "#3f4544",
  frameless: "#bfdff2",
  concrete: "#9a968d",
  grc: "#c4beb2",
}

export function openingVisualSpec(input: {
  type: "door" | "window"
  kind?: OpeningKind
  operation?: OpeningOperation
  frameMaterial?: OpeningFrameMaterial
  /** Warna kusen custom (hex) — menang atas warna bawaan material/jenis. */
  frameColor?: string | null
}): OpeningVisualSpec {
  const spec = kindVisualSpec(input)
  return input.frameColor ? { ...spec, frameColor: input.frameColor } : spec
}

function kindVisualSpec(input: {
  type: "door" | "window"
  kind?: OpeningKind
  operation?: OpeningOperation
  frameMaterial?: OpeningFrameMaterial
}): OpeningVisualSpec {
  const kind = input.kind
  const operation = input.operation
  const frameMaterial = input.frameMaterial ?? (input.type === "door" ? "wood" : "aluminium")
  const frameColor = FRAME_COLOR[frameMaterial]

  const base: OpeningVisualSpec = {
    panelColor: input.type === "door" ? "#8a5a33" : "#a9cfe3",
    frameColor,
    opacity: input.type === "door" ? 1 : 0.45,
    roughness: input.type === "door" ? 0.65 : 0.12,
    metalness: input.type === "door" ? 0 : 0.2,
    panelSegments: operation === "sliding" ? 2 : operation === "folding" ? 4 : 1,
    horizontalSlats: 0,
    verticalSlats: 0,
    perforationRows: 0,
    perforationCols: 0,
    showsGlass: input.type === "window",
    showsSolidPanel: input.type === "door",
  }

  switch (kind) {
    case "curtain_wall":
      return {
        ...base,
        panelColor: "#b9dff4",
        frameColor: "#2f3a3d",
        opacity: 0.34,
        panelSegments: 4,
        showsGlass: true,
        showsSolidPanel: false,
      }
    case "clerestory_window":
      return {
        ...base,
        panelSegments: 3,
        opacity: 0.38,
      }
    case "jalousie_window":
      return {
        ...base,
        horizontalSlats: 7,
        opacity: 0.3,
      }
    case "roster":
      return {
        ...base,
        panelColor: "#b8afa0",
        frameColor: "#918879",
        opacity: 0.92,
        roughness: 0.85,
        metalness: 0,
        perforationRows: 3,
        perforationCols: 5,
        showsGlass: false,
        showsSolidPanel: true,
      }
    case "krawangan":
      return {
        ...base,
        panelColor: "#d5c8b3",
        frameColor: "#9f7a53",
        opacity: 0.9,
        roughness: 0.78,
        metalness: 0,
        perforationRows: 3,
        perforationCols: 4,
        verticalSlats: 3,
        showsGlass: false,
        showsSolidPanel: true,
      }
    case "sliding_glass_door":
    case "pocket_door":
      return {
        ...base,
        panelColor: "#abd8ee",
        frameColor: "#465056",
        opacity: 0.42,
        panelSegments: 2,
        showsGlass: true,
        showsSolidPanel: false,
      }
    case "folding_door":
      return {
        ...base,
        panelColor: "#b7dcec",
        frameColor: "#7a5b3e",
        opacity: 0.48,
        panelSegments: 4,
        showsGlass: true,
        showsSolidPanel: false,
      }
    case "pivot_door":
      return {
        ...base,
        frameColor: "#3b3027",
        panelSegments: 2,
        verticalSlats: 1,
      }
    case "garage_door":
      // Pintu garasi sectional: daun solid abu dengan 4 garis panel horizontal
      // (tampilan panel-lift khas garasi modern), kusen baja gelap.
      return {
        ...base,
        panelColor: "#b3b1ac",
        frameColor: "#3c4245",
        opacity: 1,
        roughness: 0.55,
        metalness: 0.35,
        panelSegments: 1,
        horizontalSlats: 4,
        showsGlass: false,
        showsSolidPanel: true,
      }
    case "facade_cutout":
    case "cantilever_opening":
      return {
        ...base,
        panelColor: "#101716",
        frameColor: "#d8d2c5",
        opacity: 0.18,
        panelSegments: 1,
        showsGlass: false,
        showsSolidPanel: false,
      }
    case "awning_window":
      return {
        ...base,
        horizontalSlats: 1,
      }
    case "porthole":
      // Jendela bulat: kaca fixed satu panel, tanpa slat/perforasi — bentuk
      // bundar ditangani renderer via hint `shape` (torus + disc di 3D,
      // poligon lingkaran di elevasi).
      return {
        ...base,
        opacity: 0.4,
        panelSegments: 1,
        showsGlass: true,
        showsSolidPanel: false,
        shape: "round",
      }
    default:
      return base
  }
}
