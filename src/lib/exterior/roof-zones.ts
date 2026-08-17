import { ROOF_MATERIALS } from "@/lib/constants";
import { round2 } from "@/lib/geometry";
import { effectiveRoof } from "@/lib/geometry/roof";
import { buildingFootprint } from "@/lib/structural/grid";
import type { DesignLayout, RoofMaterial, RoofSpec, RoofType, RoofZone } from "@/types";
import { roofZoneFootprint } from "./geometry";

export type RoofZoneSource = "explicit" | "legacy";

export type EffectiveRoofZone = RoofZone & {
  source: RoofZoneSource;
  materialId: RoofMaterial;
  roof: RoofSpec;
};

export type RoofZonePlane = {
  id: string;
  zoneId: string;
  kind: RoofType;
  materialId: RoofMaterial;
  footprint: ReturnType<typeof roofZoneFootprint>;
  ridgeAxis: "x" | "y" | null;
  slopeDeg: number;
  overhangM: number;
  materialAreaM2: number;
  catchmentAreaM2: number;
};

export type RoofZonePlanProjection = {
  id: string;
  refId: string;
  label: string;
  points: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
  materialAreaM2: number;
  catchmentAreaM2: number;
};

const DEFAULT_ROOF_MATERIAL: RoofMaterial = "genteng_beton";

function isRoofMaterial(value: unknown): value is RoofMaterial {
  return typeof value === "string" && value in ROOF_MATERIALS;
}

function roofMaterial(zone: RoofZone, fallback: RoofSpec): RoofMaterial {
  return isRoofMaterial(zone.materialId) ? zone.materialId : fallback.material;
}

function roofSpecForZone(zone: RoofZone, fallback: RoofSpec): RoofSpec {
  const type = zone.type;
  const raw: RoofSpec = {
    type,
    slopeDeg: Number.isFinite(zone.slopeDeg) ? zone.slopeDeg : fallback.slopeDeg,
    overhangM: Number.isFinite(zone.overhangM) ? zone.overhangM : fallback.overhangM,
    material: roofMaterial(zone, fallback),
    lowSide: zone.lowSide ?? fallback.lowSide,
    fascia: fallback.fascia,
  };

  return effectiveRoof({
    id: "roof-zone-normalizer",
    projectId: "roof-zone-normalizer",
    versionId: "roof-zone-normalizer",
    floors: [],
    rooms: [],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    roof: raw,
    validation: { passed: true, issues: [] },
  });
}

function legacyRoofZone(layout: DesignLayout): EffectiveRoofZone | null {
  const fp = buildingFootprint(layout);
  if (fp.widthM <= 0 || fp.depthM <= 0) return null;

  const roof = effectiveRoof(layout);
  return {
    id: "roofz-legacy-global",
    source: "legacy",
    floorId: layout.floors[0]?.id,
    type: roof.type,
    x: round2(fp.x0 + fp.widthM / 2),
    y: round2(fp.y0 + fp.depthM / 2),
    widthM: fp.widthM,
    depthM: fp.depthM,
    slopeDeg: roof.slopeDeg,
    overhangM: roof.overhangM,
    materialId: roof.material,
    lowSide: roof.lowSide,
    roof,
  };
}

export function hasExplicitRoofZones(layout: DesignLayout): boolean {
  return Array.isArray(layout.roofZones) && layout.roofZones.length > 0;
}

export function effectiveRoofZones(layout: DesignLayout): EffectiveRoofZone[] {
  const fallback = effectiveRoof(layout);

  if (!hasExplicitRoofZones(layout)) {
    const legacy = legacyRoofZone(layout);
    return legacy ? [legacy] : [];
  }

  return (layout.roofZones ?? []).map((zone) => {
    const roof = roofSpecForZone(zone, fallback);
    return {
      ...zone,
      source: "explicit",
      slopeDeg: roof.slopeDeg,
      overhangM: roof.overhangM,
      materialId: roof.material,
      lowSide: roof.lowSide,
      roof,
    };
  });
}

export function roofZoneRidgeAxis(zone: RoofZone): "x" | "y" | null {
  if (zone.type === "datar") return null;
  if (zone.type === "miring") {
    const lowSide = zone.lowSide ?? "s";
    return lowSide === "n" || lowSide === "s" ? "x" : "y";
  }
  return zone.widthM >= zone.depthM ? "x" : "y";
}

export function roofZoneMaterialArea(zone: RoofZone): number {
  const footprint = Math.max(0, zone.widthM) * Math.max(0, zone.depthM);
  const slopeRad = (zone.slopeDeg * Math.PI) / 180;
  const slopeFactor =
    zone.type === "datar" ? 1.1 : (1 / Math.cos(slopeRad)) * 1.15;
  return round2(footprint * slopeFactor);
}

export function roofZoneCatchmentArea(zone: RoofZone): number {
  return round2(Math.max(0, zone.widthM) * Math.max(0, zone.depthM));
}

export function roofZoneFootprintUnionArea(zones: readonly RoofZone[]): number {
  const rects = zones
    .map(roofZoneFootprint)
    .filter((r) => r.maxX > r.minX && r.maxY > r.minY);
  if (rects.length === 0) return 0;

  const xs = Array.from(new Set(rects.flatMap((r) => [r.minX, r.maxX]))).sort(
    (a, b) => a - b,
  );
  let area = 0;

  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    if (x1 <= x0) continue;

    const intervals = rects
      .filter((r) => r.minX < x1 && r.maxX > x0)
      .map((r) => [r.minY, r.maxY] as [number, number])
      .sort((a, b) => a[0] - b[0]);

    let coveredY = 0;
    let current: [number, number] | null = null;
    for (const [y0, y1] of intervals) {
      if (!current) {
        current = [y0, y1];
      } else if (y0 <= current[1]) {
        current[1] = Math.max(current[1], y1);
      } else {
        coveredY += current[1] - current[0];
        current = [y0, y1];
      }
    }
    if (current) coveredY += current[1] - current[0];
    area += (x1 - x0) * coveredY;
  }

  return round2(area);
}

export function effectiveRoofMaterialArea(layout: DesignLayout): number {
  return round2(
    effectiveRoofZones(layout).reduce(
      (sum, zone) => sum + roofZoneMaterialArea(zone),
      0,
    ),
  );
}

export function effectiveRoofCatchmentArea(layout: DesignLayout): number {
  const zones = effectiveRoofZones(layout);
  if (zones.length === 0) return 0;
  if (!hasExplicitRoofZones(layout)) return effectiveRoofMaterialArea(layout);
  return roofZoneFootprintUnionArea(zones);
}

export function roofZonePlanes(layout: DesignLayout): RoofZonePlane[] {
  return effectiveRoofZones(layout).map((zone) => ({
    id: `${zone.id}:plane`,
    zoneId: zone.id,
    kind: zone.type,
    materialId: zone.materialId ?? DEFAULT_ROOF_MATERIAL,
    footprint: roofZoneFootprint(zone),
    ridgeAxis: roofZoneRidgeAxis(zone),
    slopeDeg: zone.slopeDeg,
    overhangM: zone.overhangM,
    materialAreaM2: roofZoneMaterialArea(zone),
    catchmentAreaM2: roofZoneCatchmentArea(zone),
  }));
}

export function projectRoofZonesPlan(layout: DesignLayout): RoofZonePlanProjection[] {
  return effectiveRoofZones(layout).map((zone) => {
    const f = roofZoneFootprint(zone);
    return {
      id: `${zone.id}:plan`,
      refId: zone.id,
      label: `Atap ${zone.type}`,
      points: [
        { x: f.minX, y: f.minY },
        { x: f.maxX, y: f.minY },
        { x: f.maxX, y: f.maxY },
        { x: f.minX, y: f.maxY },
      ],
      center: { x: zone.x, y: zone.y },
      materialAreaM2: roofZoneMaterialArea(zone),
      catchmentAreaM2: roofZoneCatchmentArea(zone),
    };
  });
}
