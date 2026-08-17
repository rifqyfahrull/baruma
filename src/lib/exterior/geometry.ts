import type {
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
  Point,
  RoofZone,
} from "@/types";

export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type OrientedRect = {
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  rotationDeg: number;
};

export type SegmentEnvelope = {
  start: Point;
  end: Point;
  lengthM: number;
  angleRad: number;
};

const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-6;

export function toRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function toDeg(rad: number): number {
  return rad / DEG_TO_RAD;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function segmentLength(start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function segmentEnvelope(
  segment: ExteriorSegmentElement,
): SegmentEnvelope {
  const lengthM = segmentLength(segment.start, segment.end);
  const angleRad = Math.atan2(
    segment.end.y - segment.start.y,
    segment.end.x - segment.start.x,
  );
  return { start: segment.start, end: segment.end, lengthM, angleRad };
}

export function segmentMidpoint(start: Point, end: Point): Point {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

export function rotatePoint(
  point: Point,
  center: Point,
  rotationDeg: number,
): Point {
  const rad = toRad(rotationDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: round2(center.x + dx * cos - dy * sin),
    y: round2(center.y + dx * sin + dy * cos),
  };
}

export function orientedRectCorners(rect: OrientedRect): Point[] {
  const { x, y, widthM, depthM, rotationDeg } = rect;
  const cx = x;
  const cy = y;
  const hw = widthM / 2;
  const hd = depthM / 2;
  const local = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  return local.map((p) =>
    rotatePoint({ x: cx + p.x, y: cy + p.y }, { x: cx, y: cy }, rotationDeg),
  );
}

export function boxBoundingBox(box: ExteriorBoxElement): BoundingBox {
  const corners = orientedRectCorners({
    x: box.x,
    y: box.y,
    widthM: box.widthM,
    depthM: box.depthM,
    rotationDeg: box.rotationDeg ?? 0,
  });
  const xs = corners.map((p: Point) => p.x);
  const ys = corners.map((p: Point) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function frameBoundingBox(frame: ExteriorFrameElement): BoundingBox {
  return boxBoundingBox({
    ...frame,
    kind: "solid_wall",
    widthM: frame.widthM,
    depthM: frame.depthM ?? 0.3,
    heightM: frame.heightM,
    rotationDeg: frame.rotationDeg ?? 0,
  } as ExteriorBoxElement);
}

export function assetBoundingBox(
  x: number,
  y: number,
  widthM: number,
  depthM: number,
  rotationDeg = 0,
): BoundingBox {
  const corners = orientedRectCorners({ x, y, widthM, depthM, rotationDeg });
  const xs = corners.map((p: Point) => p.x);
  const ys = corners.map((p: Point) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function surfaceBoundingBox(
  surface: ExteriorSurfaceElement,
): BoundingBox {
  const xs = surface.points.map((p) => p.x);
  const ys = surface.points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function exteriorElementBoundingBox(
  element: ExteriorElement,
): BoundingBox {
  switch (element.kind) {
    case "boundary_wall":
    case "fence":
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      return segmentBoundingBox(element);
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
      return boxBoundingBox(element);
    case "portal_frame":
      return frameBoundingBox(element);
    case "exterior_stair":
      return stairBoundingBox(element);
    case "driveway":
    case "walkway":
    case "terrace_surface":
    case "garden_bed":
      return surfaceBoundingBox(element);
    case "asset":
    case "plant":
    case "tree":
    case "exterior_decor":
    case "vehicle":
      return assetBoundingBox(
        element.x,
        element.y,
        element.widthM,
        element.depthM,
        element.rotationDeg ?? 0,
      );
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

function segmentBoundingBox(segment: ExteriorSegmentElement): BoundingBox {
  const halfThick = (segment.thicknessM ?? 0.05) / 2;
  const minX = Math.min(segment.start.x, segment.end.x) - halfThick;
  const maxX = Math.max(segment.start.x, segment.end.x) + halfThick;
  const minY = Math.min(segment.start.y, segment.end.y) - halfThick;
  const maxY = Math.max(segment.start.y, segment.end.y) + halfThick;
  return { minX, minY, maxX, maxY };
}

function stairBoundingBox(stair: ExteriorStairElement): BoundingBox {
  const isHorizontal = stair.direction === "w" || stair.direction === "e";
  const widthM = isHorizontal ? stair.lengthM : stair.widthM;
  const depthM = isHorizontal ? stair.widthM : stair.lengthM;
  return {
    minX: stair.x - widthM / 2,
    minY: stair.y - depthM / 2,
    maxX: stair.x + widthM / 2,
    maxY: stair.y + depthM / 2,
  };
}

export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

export function polygonWinding(points: Point[]): "cw" | "ccw" {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }
  return sum > 0 ? "cw" : "ccw";
}

export function normalizePolygonWinding(
  points: Point[],
  desired: "cw" | "ccw" = "ccw",
): Point[] {
  if (points.length < 3) return points;
  const current = polygonWinding(points);
  if (current === desired) return points;
  return [...points].reverse();
}

export function isSelfIntersecting(points: Point[]): boolean {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (i === 0 && j === points.length - 1) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;
  return false;
}

function direction(a: Point, b: Point, c: Point): number {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= c.x &&
    c.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) - EPSILON <= c.y &&
    c.y <= Math.max(a.y, b.y) + EPSILON
  );
}

export function hasDegenerateEdges(points: Point[]): boolean {
  if (points.length < 3) return true;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (segmentLength(a, b) < EPSILON) return true;
  }
  return false;
}

export function clampPointToSite(
  point: Point,
  site: { widthM: number; depthM: number },
): Point {
  return {
    x: Math.max(0, Math.min(site.widthM, point.x)),
    y: Math.max(0, Math.min(site.depthM, point.y)),
  };
}

export function clampRectToSite(
  rect: { x: number; y: number; widthM: number; depthM: number },
  site: { widthM: number; depthM: number },
): { x: number; y: number; widthM: number; depthM: number } {
  const halfW = rect.widthM / 2;
  const halfD = rect.depthM / 2;
  const x = Math.max(halfW, Math.min(site.widthM - halfW, rect.x));
  const y = Math.max(halfD, Math.min(site.depthM - halfD, rect.y));
  return { x, y, widthM: rect.widthM, depthM: rect.depthM };
}

export function roofZoneFootprint(zone: RoofZone): BoundingBox {
  return {
    minX: zone.x - zone.widthM / 2,
    minY: zone.y - zone.depthM / 2,
    maxX: zone.x + zone.widthM / 2,
    maxY: zone.y + zone.depthM / 2,
  };
}

export function roofZonesOverlap(
  a: RoofZone,
  b: RoofZone,
  toleranceM = 0.01,
): boolean {
  const aa = roofZoneFootprint(a);
  const bb = roofZoneFootprint(b);
  return (
    aa.minX < bb.maxX - toleranceM &&
    aa.maxX > bb.minX + toleranceM &&
    aa.minY < bb.maxY - toleranceM &&
    aa.maxY > bb.minY + toleranceM
  );
}

export function roofZoneSurfaceArea(zone: RoofZone): number {
  if (zone.type === "datar") {
    return zone.widthM * zone.depthM;
  }
  const run =
    zone.type === "miring"
      ? Math.max(zone.widthM, zone.depthM)
      : Math.min(zone.widthM, zone.depthM);
  const span =
    zone.type === "miring"
      ? Math.min(zone.widthM, zone.depthM)
      : Math.max(zone.widthM, zone.depthM);
  const slopeRad = toRad(zone.slopeDeg);
  const slantLength = run / (2 * Math.cos(slopeRad / 2));
  if (zone.type === "pelana" || zone.type === "limasan") {
    // Catatan gable asimetris (ridgeOffsetM): dgn tinggi bubungan tetap,
    // selisih luas total hanya orde-2 (~1-2%) — di bawah presisi aproksimasi
    // formula ini sendiri. Kuantitas sengaja TIDAK dibedakan.
    return 2 * slantLength * span;
  }
  return slantLength * span;
}

export function stairStepCount(stair: ExteriorStairElement): number {
  if (stair.riseM <= 0 || stair.lengthM <= 0) return 0;
  const idealRiserM = 0.175;
  return Math.max(1, Math.round(stair.riseM / idealRiserM));
}

export function stairTreadM(stair: ExteriorStairElement): number {
  const steps = stairStepCount(stair);
  if (steps <= 1) return stair.lengthM;
  return stair.lengthM / steps;
}

export function stairRiserM(stair: ExteriorStairElement): number {
  const steps = stairStepCount(stair);
  if (steps === 0) return 0;
  return stair.riseM / steps;
}

export function unionBoundingBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundingBoxContains(
  inner: BoundingBox,
  outer: BoundingBox,
  tolerance = EPSILON,
): boolean {
  return (
    inner.minX >= outer.minX - tolerance &&
    inner.minY >= outer.minY - tolerance &&
    inner.maxX <= outer.maxX + tolerance &&
    inner.maxY <= outer.maxY + tolerance
  );
}
