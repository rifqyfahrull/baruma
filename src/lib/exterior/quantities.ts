import type {
  ExteriorAssetElement,
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
  Room,
} from "@/types";
import {
  exteriorElementBoundingBox,
  polygonArea,
  roofZoneSurfaceArea,
  segmentLength,
  stairRiserM,
  stairStepCount,
  stairTreadM,
} from "./geometry";
import { isOutdoorRoom } from "@/lib/geometry/connectivity";
import { rectUnionPerimeter, sharedEdgeLength } from "@/lib/geometry/union";

export type ExteriorQuantity = {
  elementId: string;
  kind: string;
  /** Human-readable line item name. */
  item: string;
  /** Numeric quantity. */
  qty: number;
  /** Unit of measure. */
  unit: "m" | "m2" | "m3" | "unit";
  /** Optional secondary quantity for composite items. */
  secondaryQty?: number;
  secondaryUnit?: "m" | "m2" | "m3" | "unit";
  /** Source material or rate catalog id, when determinable. */
  materialId?: string;
  /** Rate katalog spesifik untuk kuantitas ini (menang atas lookup per kind) —
   *  dipakai saat satu element menghasilkan beberapa kuantitas beda unit. */
  rateId?: string;
  /** Whether this line should be included in RAB by default. */
  included: boolean;
  /** Reason for exclusion, if any. */
  exclusionReason?: string;
};

/**
 * Compute exterior wall area from room footprints on a given floor.
 * Ruang terbuka (carport, taman, kolam, balkon, rooftop_lounge, void — lihat
 * `isOutdoorRoom`) dikecualikan dari union: 3D (`build-model.ts`) dan gambar
 * kerja (`elevation.ts`/`section.ts`) sudah merendernya tanpa dinding, jadi
 * takeoff material harus konsisten alih-alih menagih dinding yang tak ada.
 * Returns wall area in m2 (perimeter × wallHeight), with openings deduction.
 */
export function computeExteriorWallArea(
  rooms: Room[],
  wallHeight: number,
  openingDeductionFactor: number = 0.15,
): number {
  const indoorRooms = rooms.filter((r) => !isOutdoorRoom(r));
  if (indoorRooms.length === 0 || wallHeight <= 0) return 0;
  const rects = indoorRooms.map((r) => ({
    x: r.x,
    y: r.y,
    width: r.width,
    depth: r.depth,
  }));
  const perimeter = rectUnionPerimeter(rects);
  const grossArea = perimeter * wallHeight;
  return grossArea * (1 - openingDeductionFactor);
}

/**
 * Compute internal partition wall area from actual room adjacency on a
 * given floor — replaces the old flat `builtArea × 2.4` guess. Only indoor
 * rooms count (ruang terbuka tidak punya partisi); each shared wall is
 * counted once (iterate unique pairs), matching how `build-model.ts` draws
 * a shared boundary exactly once via its north/west ownership rule.
 * Returns wall area in m2 (shared edge length × wallHeight), with openings
 * deduction (doors between rooms reduce billable wall area).
 */
export function computeInternalWallArea(
  rooms: Room[],
  wallHeight: number,
  openingDeductionFactor: number = 0.15,
): number {
  const indoorRooms = rooms.filter((r) => !isOutdoorRoom(r));
  if (indoorRooms.length < 2 || wallHeight <= 0) return 0;
  let totalLength = 0;
  for (let i = 0; i < indoorRooms.length; i++) {
    for (let j = i + 1; j < indoorRooms.length; j++) {
      totalLength += sharedEdgeLength(indoorRooms[i], indoorRooms[j]);
    }
  }
  const grossArea = totalLength * wallHeight;
  return grossArea * (1 - openingDeductionFactor);
}

export function exteriorElementQuantities(
  element: ExteriorElement,
): ExteriorQuantity[] {
  switch (element.kind) {
    case "boundary_wall":
      return boundaryWallQuantities(element);
    case "fence":
      return fenceQuantities(element);
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      return gateQuantities(element);
    case "solid_wall":
    case "facade_panel":
      return wallPanelQuantities(element);
    case "column":
    case "beam":
    case "chimney":
      return columnBeamQuantities(element);
    case "slab":
    case "canopy":
    case "overhang_slab":
      return slabCanopyQuantities(element);
    case "planter":
      return planterQuantities(element);
    case "portal_frame":
      return portalFrameQuantities(element);
    case "exterior_stair":
      return stairQuantities(element);
    case "driveway":
    case "walkway":
    case "terrace_surface":
    case "garden_bed":
      return surfaceQuantities(element);
    case "asset":
    case "plant":
    case "tree":
    case "exterior_decor":
    case "vehicle":
      return assetQuantities(element);
    default:
      return [];
  }
}

function boundaryWallQuantities(
  element: ExteriorSegmentElement,
): ExteriorQuantity[] {
  const lengthM = segmentLength(element.start, element.end);
  const areaM2 = lengthM * element.heightM;
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: "Dinding pagar/batas",
      qty: areaM2,
      unit: "m2",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function fenceQuantities(element: ExteriorSegmentElement): ExteriorQuantity[] {
  const lengthM = segmentLength(element.start, element.end);
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: "Pagar",
      qty: lengthM,
      unit: "m",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function gateQuantities(element: ExteriorSegmentElement): ExteriorQuantity[] {
  const lengthM = segmentLength(element.start, element.end);
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: `Gerbang (${element.kind})`,
      qty: 1,
      unit: "unit",
      secondaryQty: lengthM,
      secondaryUnit: "m",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function wallPanelQuantities(element: ExteriorBoxElement): ExteriorQuantity[] {
  const areaM2 = element.widthM * element.heightM;
  const volumeM3 = areaM2 * element.depthM;
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item:
        element.kind === "facade_panel" ? "Panel fasad" : "Dinding eksterior",
      qty: areaM2,
      unit: "m2",
      secondaryQty: volumeM3,
      secondaryUnit: "m3",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function columnBeamQuantities(element: ExteriorBoxElement): ExteriorQuantity[] {
  const volumeM3 = element.widthM * element.depthM * element.heightM;
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item:
        element.kind === "column"
          ? "Kolom aksen"
          : element.kind === "chimney"
            ? "Cerobong"
            : "Balok aksen",
      qty: volumeM3,
      unit: "m3",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function slabCanopyQuantities(element: ExteriorBoxElement): ExteriorQuantity[] {
  const areaM2 = element.widthM * element.depthM;
  const volumeM3 = areaM2 * element.heightM;
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item:
        element.kind === "canopy"
          ? "Kanopi"
          : element.kind === "overhang_slab"
            ? "Pelat menjorok (overhang)"
            : "Slab eksterior",
      qty: areaM2,
      unit: "m2",
      secondaryQty: volumeM3,
      secondaryUnit: "m3",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function planterQuantities(element: ExteriorBoxElement): ExteriorQuantity[] {
  const volumeM3 = element.widthM * element.depthM * element.heightM;
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: "Planter",
      qty: volumeM3,
      unit: "m3",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function portalFrameQuantities(
  element: ExteriorFrameElement,
): ExteriorQuantity[] {
  const outerArea = element.widthM * element.heightM;
  const innerWidth = Math.max(0, element.widthM - 2 * element.memberSizeM);
  const innerHeight = Math.max(0, element.heightM - element.memberSizeM);
  const innerArea = innerWidth * innerHeight;
  const memberArea = outerArea - innerArea;
  const memberVolume = memberArea * (element.depthM ?? 0.3);
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: "Portal frame",
      qty: memberVolume,
      unit: "m3",
      secondaryQty: outerArea,
      secondaryUnit: "m2",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function stairQuantities(element: ExteriorStairElement): ExteriorQuantity[] {
  // Basis lapangan (Gelombang 2): beton prisma 0.5*w*l*rise (m3) + finishing
  // (tread+riser)*lebar*anak (m2) — menggantikan luas footprint * rate kasar.
  const steps = stairStepCount(element);
  const tread = stairTreadM(element);
  const riser = stairRiserM(element);
  const betonM3 = 0.5 * element.widthM * element.lengthM * element.riseM;
  const finishM2 = steps * (tread + riser) * element.widthM;
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: "Tangga luar — beton",
      qty: betonM3,
      unit: "m3",
      rateId: "ext-stair-beton-v1",
      materialId: element.material?.materialId,
      included: true,
    },
    {
      elementId: element.id,
      kind: element.kind,
      item: "Tangga luar — finishing",
      qty: finishM2,
      unit: "m2",
      rateId: "ext-stair-finish-v1",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function surfaceQuantities(
  element: ExteriorSurfaceElement,
): ExteriorQuantity[] {
  const areaM2 = polygonArea(element.points);
  const volumeM3 = areaM2 * (element.thicknessM ?? 0.1);
  const labels: Record<typeof element.kind, string> = {
    driveway: "Driveway",
    walkway: "Walkway",
    terrace_surface: "Teras",
    garden_bed: "Planting bed",
  };
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: labels[element.kind],
      qty: areaM2,
      unit: "m2",
      secondaryQty: volumeM3,
      secondaryUnit: "m3",
      materialId: element.material?.materialId,
      included: true,
    },
  ];
}

function assetQuantities(element: ExteriorAssetElement): ExteriorQuantity[] {
  const labels: Record<ExteriorAssetElement["kind"], string> = {
    asset: "Aset eksterior",
    plant: "Tanaman",
    tree: "Pohon",
    exterior_decor: "Dekor eksterior",
    vehicle: "Kendaraan",
  };
  const included = element.kind === "plant" || element.kind === "tree" || element.kind === "exterior_decor";
  return [
    {
      elementId: element.id,
      kind: element.kind,
      item: element.label ?? labels[element.kind],
      qty: 1,
      unit: "unit",
      materialId: element.material?.materialId,
      included,
      exclusionReason: included
        ? undefined
        : element.kind === "vehicle"
          ? "Kendaraan hanya konteks visual, bukan item RAB bangunan"
          : "Custom GLB memerlukan costing manual",
    },
  ];
}

export { roofZoneSurfaceArea };

export function exteriorElementFootprintArea(element: ExteriorElement): number {
  const bbox = exteriorElementBoundingBox(element);
  return (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
}
