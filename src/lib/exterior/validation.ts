import type {
  ExteriorAssetElement,
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
  RoofZone,
  Site,
  ValidationIssue,
} from "@/types";
import {
  boundingBoxContains,
  exteriorElementBoundingBox,
  hasDegenerateEdges,
  isFiniteNumber,
  isSelfIntersecting,
  polygonArea,
  roofZonesOverlap,
  segmentLength,
  stairRiserM,
  stairTreadM,
} from "./geometry";

export type ExteriorValidationOptions = {
  site: Site;
  /** IDs of floors that currently exist in the layout. */
  validFloorIds?: Set<string>;
};

const MIN_SEGMENT_LENGTH_M = 0.2;
const MIN_SURFACE_AREA_M2 = 0.1;
const MAX_POLYGON_POINTS = 32;
const MIN_STAIR_RISER_M = 0.12;
const MAX_STAIR_RISER_M = 0.2;
const MIN_STAIR_TREAD_M = 0.25;
const MAX_STAIR_TREAD_M = 0.35;
const MIN_DIMENSION_M = 0.05;

export function validateExteriorElement(
  element: ExteriorElement,
  options: ExteriorValidationOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const base = validateCommon(element, options);
  issues.push(...base);
  if (base.length > 0) return issues;

  switch (element.kind) {
    case "boundary_wall":
    case "fence":
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      issues.push(...validateSegment(element));
      break;
    case "solid_wall":
    case "facade_panel":
    case "column":
    case "chimney":
    case "beam":
    case "slab":
    case "canopy":
    case "overhang_slab":
    case "planter":
    case "pergola":
      issues.push(...validateBox(element));
      break;
    case "portal_frame":
      issues.push(...validateFrame(element));
      break;
    case "exterior_stair":
      issues.push(...validateStair(element));
      break;
    case "driveway":
    case "walkway":
    case "terrace_surface":
    case "garden_bed":
      issues.push(...validateSurface(element));
      break;
    case "asset":
    case "plant":
    case "tree":
    case "exterior_decor":
    case "vehicle":
      issues.push(...validateAsset(element));
      break;
  }

  return issues;
}

function validateCommon(
  element: ExteriorElement,
  options: ExteriorValidationOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { site, validFloorIds } = options;

  if (!element.id || typeof element.id !== "string") {
    issues.push(
      makeIssue(element.id ?? "unknown", "danger", "ID elemen tidak valid"),
    );
  }

  if (element.floorId && validFloorIds && !validFloorIds.has(element.floorId)) {
    issues.push(
      makeIssue(
        element.id,
        "danger",
        `Floor '${element.floorId}' tidak ditemukan untuk elemen ${element.kind}`,
      ),
    );
  }

  if (element.structuralRole === "secondary_unverified") {
    issues.push(
      makeIssue(
        element.id,
        "warning",
        `Elemen ${element.kind} ditandai struktural sekunder dan perlu review engineer`,
      ),
    );
  }

  const bbox = exteriorElementBoundingBox(element);
  const siteBox = { minX: 0, minY: 0, maxX: site.widthM, maxY: site.depthM };
  if (!boundingBoxContains(bbox, siteBox, 0.1)) {
    issues.push(
      makeIssue(
        element.id,
        "warning",
        `Elemen ${element.kind} berada di luar batas tapak`,
      ),
    );
  }

  return issues;
}

function validateSegment(element: ExteriorSegmentElement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lengthM = segmentLength(element.start, element.end);

  if (!isFiniteNumber(element.start.x) || !isFiniteNumber(element.start.y)) {
    issues.push(
      makeIssue(element.id, "danger", "Titik awal segment tidak valid"),
    );
  }
  if (!isFiniteNumber(element.end.x) || !isFiniteNumber(element.end.y)) {
    issues.push(
      makeIssue(element.id, "danger", "Titik akhir segment tidak valid"),
    );
  }
  if (lengthM < MIN_SEGMENT_LENGTH_M) {
    issues.push(
      makeIssue(
        element.id,
        "danger",
        `Panjang segment ${lengthM.toFixed(2)} m terlalu pendek (min ${MIN_SEGMENT_LENGTH_M} m)`,
      ),
    );
  }
  if (!isFiniteNumber(element.heightM) || element.heightM <= 0) {
    issues.push(
      makeIssue(element.id, "danger", "Tinggi segment harus lebih dari 0"),
    );
  }

  return issues;
}

function validateBox(element: ExteriorBoxElement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isFiniteNumber(element.widthM) || element.widthM < MIN_DIMENSION_M) {
    issues.push(makeIssue(element.id, "danger", "Lebar box tidak valid"));
  }
  if (!isFiniteNumber(element.depthM) || element.depthM < MIN_DIMENSION_M) {
    issues.push(makeIssue(element.id, "danger", "Kedalaman box tidak valid"));
  }
  if (!isFiniteNumber(element.heightM) || element.heightM < MIN_DIMENSION_M) {
    issues.push(makeIssue(element.id, "danger", "Tinggi box tidak valid"));
  }

  return issues;
}

function validateFrame(element: ExteriorFrameElement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isFiniteNumber(element.widthM) || element.widthM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Lebar portal tidak valid"));
  }
  if (!isFiniteNumber(element.heightM) || element.heightM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Tinggi portal tidak valid"));
  }
  if (!isFiniteNumber(element.memberSizeM) || element.memberSizeM <= 0) {
    issues.push(
      makeIssue(element.id, "danger", "Ukuran member portal tidak valid"),
    );
  }
  if (element.memberSizeM * 2 >= Math.min(element.widthM, element.heightM)) {
    issues.push(
      makeIssue(
        element.id,
        "warning",
        "Member portal terlalu tebal untuk dimensi yang dipilih",
      ),
    );
  }

  return issues;
}

function validateStair(element: ExteriorStairElement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isFiniteNumber(element.riseM) || element.riseM <= 0) {
    issues.push(
      makeIssue(element.id, "danger", "Ketinggian tangga tidak valid"),
    );
  }
  if (!isFiniteNumber(element.lengthM) || element.lengthM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Panjang tangga tidak valid"));
  }
  if (!isFiniteNumber(element.widthM) || element.widthM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Lebar tangga tidak valid"));
  }

  const riserM = stairRiserM(element);
  const treadM = stairTreadM(element);

  if (
    riserM > 0 &&
    (riserM < MIN_STAIR_RISER_M || riserM > MAX_STAIR_RISER_M)
  ) {
    issues.push(
      makeIssue(
        element.id,
        "warning",
        `Riser tangga ${riserM.toFixed(2)} m di luar rentang ${MIN_STAIR_RISER_M}-${MAX_STAIR_RISER_M} m`,
      ),
    );
  }
  if (
    treadM > 0 &&
    (treadM < MIN_STAIR_TREAD_M || treadM > MAX_STAIR_TREAD_M)
  ) {
    issues.push(
      makeIssue(
        element.id,
        "warning",
        `Tread tangga ${treadM.toFixed(2)} m di luar rentang ${MIN_STAIR_TREAD_M}-${MAX_STAIR_TREAD_M} m`,
      ),
    );
  }

  return issues;
}

function validateSurface(element: ExteriorSurfaceElement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const points = element.points;

  if (!Array.isArray(points) || points.length < 3) {
    issues.push(
      makeIssue(
        element.id,
        "danger",
        "Polygon permukaan membutuhkan minimal 3 titik",
      ),
    );
    return issues;
  }
  if (points.length > MAX_POLYGON_POINTS) {
    issues.push(
      makeIssue(
        element.id,
        "danger",
        `Polygon permukaan memiliki terlalu banyak titik (max ${MAX_POLYGON_POINTS})`,
      ),
    );
  }
  if (hasDegenerateEdges(points)) {
    issues.push(
      makeIssue(
        element.id,
        "danger",
        "Polygon permukaan memiliki sisi degenerate",
      ),
    );
  }
  if (isSelfIntersecting(points)) {
    issues.push(
      makeIssue(element.id, "danger", "Polygon permukaan self-intersecting"),
    );
  }

  const area = polygonArea(points);
  if (area < MIN_SURFACE_AREA_M2) {
    issues.push(
      makeIssue(
        element.id,
        "danger",
        `Luas permukaan ${area.toFixed(2)} m² terlalu kecil (min ${MIN_SURFACE_AREA_M2} m²)`,
      ),
    );
  }

  return issues;
}

function validateAsset(element: ExteriorAssetElement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isFiniteNumber(element.widthM) || element.widthM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Lebar asset tidak valid"));
  }
  if (!isFiniteNumber(element.depthM) || element.depthM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Kedalaman asset tidak valid"));
  }
  if (!isFiniteNumber(element.heightM) || element.heightM <= 0) {
    issues.push(makeIssue(element.id, "danger", "Tinggi asset tidak valid"));
  }
  if (!element.model?.modelUrl && !element.model?.modelAssetId) {
    issues.push(
      makeIssue(element.id, "warning", "Asset tidak memiliki model GLB"),
    );
  }

  return issues;
}

export function validateRoofZones(
  zones: RoofZone[],
  site: Site,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const zone of zones) {
    if (!isFiniteNumber(zone.widthM) || zone.widthM <= 0) {
      issues.push(makeIssue(zone.id, "danger", "Lebar roof zone tidak valid"));
    }
    if (!isFiniteNumber(zone.depthM) || zone.depthM <= 0) {
      issues.push(
        makeIssue(zone.id, "danger", "Kedalaman roof zone tidak valid"),
      );
    }
    if (
      !isFiniteNumber(zone.slopeDeg) ||
      zone.slopeDeg < 0 ||
      zone.slopeDeg > 60
    ) {
      issues.push(
        makeIssue(zone.id, "danger", "Kemiringan roof zone harus 0-60°"),
      );
    }
    if (!isFiniteNumber(zone.overhangM) || zone.overhangM < 0) {
      issues.push(
        makeIssue(zone.id, "warning", "Overhang roof zone tidak valid"),
      );
    }
  }

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (roofZonesOverlap(zones[i], zones[j])) {
        issues.push(
          makeIssue(
            `${zones[i].id},${zones[j].id}`,
            "danger",
            `Roof zone ${zones[i].id} dan ${zones[j].id} saling tumpang tindih`,
          ),
        );
      }
    }
  }

  const siteBox = { minX: 0, minY: 0, maxX: site.widthM, maxY: site.depthM };
  for (const zone of zones) {
    const footprint = {
      minX: zone.x - zone.widthM / 2,
      minY: zone.y - zone.depthM / 2,
      maxX: zone.x + zone.widthM / 2,
      maxY: zone.y + zone.depthM / 2,
    };
    if (!boundingBoxContains(footprint, siteBox, -0.01)) {
      issues.push(
        makeIssue(
          zone.id,
          "warning",
          `Roof zone ${zone.id} berada di luar tapak`,
        ),
      );
    }
  }

  return issues;
}

function makeIssue(
  objectId: string,
  level: ValidationIssue["level"],
  message: string,
  category: ValidationIssue["category"] = "spatial",
): ValidationIssue {
  return {
    id: `ext-val-${objectId}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    category,
    message,
    objectId,
  };
}
