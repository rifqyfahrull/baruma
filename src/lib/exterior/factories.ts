import { nanoid } from "nanoid";

import type {
  ComponentPatternSpec,
  ExteriorAssetElement,
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorGableFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
  ExteriorStructuralRole,
  MaterialRef,
  ModelRef,
  RoofZone,
} from "@/types";

export const EXTERIOR_ID_PREFIXES = {
  segment: "ext-seg-",
  box: "ext-box-",
  frame: "ext-frame-",
  stair: "ext-stair-",
  surface: "ext-surface-",
  asset: "ext-asset-",
  roofZone: "roofz-",
} as const;

export type ExteriorSegmentKind = ExteriorSegmentElement["kind"];
export type ExteriorBoxKind = ExteriorBoxElement["kind"];
export type ExteriorSurfaceKind = ExteriorSurfaceElement["kind"];
export type ExteriorAssetKind = ExteriorAssetElement["kind"];

const DEFAULT_STRUCTURAL_ROLE: ExteriorStructuralRole = "non_structural";

export function makeExteriorId(
  category: keyof typeof EXTERIOR_ID_PREFIXES,
): string {
  return `${EXTERIOR_ID_PREFIXES[category]}${nanoid(8)}`;
}

export function defaultMaterialRef(): MaterialRef {
  return { materialId: "beton_ekspos" };
}

export function defaultModelRef(partial?: Partial<ModelRef>): ModelRef {
  return {
    modelAssetId: null,
    modelUrl: null,
    fitMode: "fit_envelope",
    ...partial,
  };
}

export function makeSegmentElement(
  kind: ExteriorSegmentKind,
  start: { x: number; y: number },
  end: { x: number; y: number },
  options: {
    id?: string;
    heightM?: number;
    thicknessM?: number;
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
    rotationDeg?: number;
    /** Hanya kind fence/gate — diabaikan untuk boundary_wall (selalu solid). */
    pattern?: ComponentPatternSpec;
  } = {},
): ExteriorSegmentElement {
  return {
    id: options.id ?? makeExteriorId("segment"),
    kind,
    start,
    end,
    heightM: options.heightM ?? 2.4,
    thicknessM: options.thicknessM ?? (kind === "boundary_wall" ? 0.2 : 0.05),
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
    material: options.material ?? defaultMaterialRef(),
    rotationDeg: options.rotationDeg,
    ...(kind !== "boundary_wall" ? { pattern: options.pattern } : {}),
  };
}

export function segmentDefaultLengthM(kind: ExteriorSegmentKind): number {
  switch (kind) {
    case "pedestrian_gate":
      return 1.2;
    case "boundary_wall":
    case "fence":
    case "sliding_gate":
    case "swing_gate":
    default:
      return 3;
  }
}

export function makeBoxElement(
  kind: ExteriorBoxKind,
  x: number,
  y: number,
  options: {
    id?: string;
    widthM?: number;
    depthM?: number;
    heightM?: number;
    zM?: number;
    rotationDeg?: number;
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
    /** Hanya kind "pergola". */
    pattern?: ComponentPatternSpec;
    /** Hanya kind "pergola"; absen → true (default 4 kolom). */
    posts?: boolean;
  } = {},
): ExteriorBoxElement {
  const defaults = boxDefaults(kind);
  return {
    id: options.id ?? makeExteriorId("box"),
    kind,
    x,
    y,
    zM: options.zM ?? 0,
    widthM: options.widthM ?? defaults.widthM,
    depthM: options.depthM ?? defaults.depthM,
    heightM: options.heightM ?? defaults.heightM,
    rotationDeg: options.rotationDeg ?? 0,
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
    material: options.material ?? defaultMaterialRef(),
    ...(kind === "pergola" ? { pattern: options.pattern, posts: options.posts } : {}),
  };
}

function boxDefaults(kind: ExteriorBoxKind) {
  switch (kind) {
    case "column":
      return { widthM: 0.3, depthM: 0.3, heightM: 3 };
    case "chimney":
      return { widthM: 0.6, depthM: 0.6, heightM: 1.6 };
    case "beam":
      return { widthM: 0.3, depthM: 0.6, heightM: 0.6 };
    case "slab":
      return { widthM: 3, depthM: 3, heightM: 0.2 };
    case "canopy":
      return { widthM: 3, depthM: 1.5, heightM: 0.2 };
    case "overhang_slab":
      // Pelat lantai atas menjorok (kesan cantilever) — pelat beton tipis.
      return { widthM: 3, depthM: 1.2, heightM: 0.18 };
    case "facade_panel":
      return { widthM: 1, depthM: 0.1, heightM: 3 };
    case "solid_wall":
      return { widthM: 3, depthM: 0.2, heightM: 3 };
    case "planter":
      return { widthM: 1, depthM: 0.6, heightM: 0.6 };
    case "pergola":
      // heightM = elevasi bidang kisi (atas kolom), bukan tinggi ekstrusi.
      return { widthM: 3, depthM: 3, heightM: 2.4 };
    default:
      return { widthM: 1, depthM: 1, heightM: 1 };
  }
}

export function makeFrameElement(
  x: number,
  y: number,
  options: {
    id?: string;
    widthM?: number;
    heightM?: number;
    depthM?: number;
    memberSizeM?: number;
    rotationDeg?: number;
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
  } = {},
): ExteriorFrameElement {
  return {
    id: options.id ?? makeExteriorId("frame"),
    kind: "portal_frame",
    x,
    y,
    widthM: options.widthM ?? 3,
    heightM: options.heightM ?? 2.8,
    depthM: options.depthM ?? 0.3,
    memberSizeM: options.memberSizeM ?? 0.3,
    rotationDeg: options.rotationDeg ?? 0,
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
    material: options.material ?? defaultMaterialRef(),
  };
}

/** BINGKAI GABLE (W4): outline pelana asimetris di bidang fasad — kaki
 *  kiri/kanan boleh beda tinggi, apex digeser. `heightM` = tinggi apex. */
export function makeGableFrameElement(
  x: number,
  y: number,
  options: {
    id?: string;
    widthM?: number;
    heightM?: number;
    eaveLeftM?: number;
    eaveRightM?: number;
    apexOffsetM?: number;
    depthM?: number;
    memberSizeM?: number;
    zM?: number;
    rotationDeg?: number;
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
  } = {},
): ExteriorGableFrameElement {
  return {
    id: options.id ?? makeExteriorId("frame"),
    kind: "gable_frame",
    x,
    y,
    zM: options.zM ?? 0,
    widthM: options.widthM ?? 5,
    heightM: options.heightM ?? 4.5,
    eaveLeftM: options.eaveLeftM ?? 3.2,
    eaveRightM: options.eaveRightM ?? 2.8,
    apexOffsetM: options.apexOffsetM ?? 0,
    depthM: options.depthM ?? 0.5,
    memberSizeM: options.memberSizeM ?? 0.45,
    rotationDeg: options.rotationDeg ?? 0,
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
    material: options.material ?? defaultMaterialRef(),
  };
}

export function makeStairElement(
  x: number,
  y: number,
  options: {
    id?: string;
    widthM?: number;
    lengthM?: number;
    riseM?: number;
    direction?: "n" | "s" | "w" | "e";
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
  } = {},
): ExteriorStairElement {
  return {
    id: options.id ?? makeExteriorId("stair"),
    kind: "exterior_stair",
    x,
    y,
    widthM: options.widthM ?? 1.2,
    lengthM: options.lengthM ?? 3,
    riseM: options.riseM ?? 3,
    direction: options.direction ?? "n",
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
    material: options.material ?? defaultMaterialRef(),
  };
}

export function makeSurfaceElement(
  kind: ExteriorSurfaceKind,
  points: Array<{ x: number; y: number }>,
  options: {
    id?: string;
    thicknessM?: number;
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
    scatterSeed?: number;
  } = {},
): ExteriorSurfaceElement {
  return {
    id: options.id ?? makeExteriorId("surface"),
    kind,
    points,
    thicknessM: options.thicknessM ?? (kind === "driveway" ? 0.15 : 0.1),
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
    material: options.material ?? defaultMaterialRef(),
    scatterSeed: options.scatterSeed,
  };
}

export function makeAssetElement(
  kind: ExteriorAssetKind,
  x: number,
  y: number,
  model: ModelRef,
  options: {
    id?: string;
    widthM?: number;
    depthM?: number;
    heightM?: number;
    zM?: number;
    rotationDeg?: number;
    floorId?: string;
    label?: string;
    locked?: boolean;
    hidden?: boolean;
    material?: MaterialRef;
  } = {},
): ExteriorAssetElement {
  return {
    id: options.id ?? makeExteriorId("asset"),
    kind,
    x,
    y,
    zM: options.zM ?? 0,
    widthM: options.widthM ?? 1,
    depthM: options.depthM ?? 1,
    heightM: options.heightM ?? 1,
    rotationDeg: options.rotationDeg ?? 0,
    model,
    floorId: options.floorId,
    label: options.label,
    locked: options.locked,
    hidden: options.hidden,
    material: options.material,
    structuralRole: DEFAULT_STRUCTURAL_ROLE,
  };
}

export function makeRoofZone(
  type: RoofZone["type"],
  x: number,
  y: number,
  options: {
    id?: string;
    widthM?: number;
    depthM?: number;
    slopeDeg?: number;
    overhangM?: number;
    materialId?: string;
    lowSide?: RoofZone["lowSide"];
    floorId?: string;
  } = {},
): RoofZone {
  return {
    id: options.id ?? makeExteriorId("roofZone"),
    type,
    x,
    y,
    widthM: options.widthM ?? 6,
    depthM: options.depthM ?? 6,
    slopeDeg: options.slopeDeg ?? (type === "datar" ? 0 : 30),
    overhangM: options.overhangM ?? 0.5,
    materialId: options.materialId,
    lowSide: options.lowSide,
    floorId: options.floorId,
  };
}

export function isExteriorElementId(id: string): boolean {
  return Object.values(EXTERIOR_ID_PREFIXES).some((prefix) =>
    id.startsWith(prefix),
  );
}

export function exteriorElementKind(element: ExteriorElement): string {
  return element.kind;
}
