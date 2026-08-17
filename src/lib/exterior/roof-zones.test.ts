import { describe, expect, it } from "vitest";

import type { DesignLayout, RoofZone } from "@/types";
import {
  effectiveRoofCatchmentArea,
  effectiveRoofMaterialArea,
  effectiveRoofZones,
  projectRoofZonesPlan,
  roofZoneFootprintUnionArea,
  roofZonePlanes,
  roofZoneRidgeAxis,
} from "./roof-zones";

function layoutWith(roofZones?: RoofZone[]): DesignLayout {
  return {
    id: "layout-roof-zone",
    projectId: "project-roof-zone",
    versionId: "version-roof-zone",
    floors: [{ id: "f1", level: 1, name: "Lantai 1", heightM: 3 }],
    rooms: [
      {
        id: "r1",
        floorId: "f1",
        name: "Ruang 1",
        type: "ruang_keluarga",
        x: 1,
        y: 2,
        width: 8,
        depth: 6,
        areaM2: 48,
      },
    ],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    roof: {
      type: "pelana",
      slopeDeg: 30,
      overhangM: 0.5,
      material: "metal",
      lowSide: "s",
    },
    ...(roofZones ? { roofZones } : {}),
    validation: { passed: true, issues: [] },
  } as DesignLayout;
}

describe("roof zone domain engine", () => {
  it("adapts legacy layout.roof into one effective zone over the building footprint", () => {
    const [zone] = effectiveRoofZones(layoutWith());

    expect(zone.source).toBe("legacy");
    expect(zone.id).toBe("roofz-legacy-global");
    expect(zone.x).toBe(5);
    expect(zone.y).toBe(5);
    expect(zone.widthM).toBe(8);
    expect(zone.depthM).toBe(6);
    expect(zone.materialId).toBe("metal");
  });

  it("keeps legacy roof material/catchment area compatible with the old formula", () => {
    const layout = layoutWith();
    const expected = 48 * (1 / Math.cos((30 * Math.PI) / 180)) * 1.15;

    expect(effectiveRoofMaterialArea(layout)).toBeCloseTo(expected, 2);
    expect(effectiveRoofCatchmentArea(layout)).toBeCloseTo(expected, 2);
  });

  it("uses explicit zones instead of the global roof and clamps unsafe values", () => {
    const zones: RoofZone[] = [
      {
        id: "roofz-a",
        type: "pelana",
        x: 3,
        y: 3,
        widthM: 4,
        depthM: 5,
        slopeDeg: 99,
        overhangM: -1,
        materialId: "genteng_keramik",
      },
    ];

    const [zone] = effectiveRoofZones(layoutWith(zones));

    expect(zone.source).toBe("explicit");
    expect(zone.slopeDeg).toBe(40);
    expect(zone.overhangM).toBe(0);
    expect(zone.materialId).toBe("genteng_keramik");
  });

  it("computes catchment from the footprint union without double-counting overlap", () => {
    const zones: RoofZone[] = [
      {
        id: "roofz-a",
        type: "datar",
        x: 3,
        y: 3,
        widthM: 4,
        depthM: 4,
        slopeDeg: 0,
        overhangM: 0.5,
      },
      {
        id: "roofz-b",
        type: "datar",
        x: 5,
        y: 3,
        widthM: 4,
        depthM: 4,
        slopeDeg: 0,
        overhangM: 0.5,
      },
    ];

    expect(roofZoneFootprintUnionArea(zones)).toBe(24);
    expect(effectiveRoofCatchmentArea(layoutWith(zones))).toBe(24);
  });

  it("derives plane metadata and ridge axis deterministically", () => {
    const zones: RoofZone[] = [
      {
        id: "roofz-gable",
        type: "pelana",
        x: 5,
        y: 5,
        widthM: 8,
        depthM: 4,
        slopeDeg: 30,
        overhangM: 0.5,
      },
      {
        id: "roofz-skillion",
        type: "miring",
        x: 10,
        y: 5,
        widthM: 4,
        depthM: 5,
        slopeDeg: 10,
        overhangM: 0.3,
        lowSide: "e",
      },
    ];

    expect(roofZoneRidgeAxis(zones[0])).toBe("x");
    expect(roofZoneRidgeAxis(zones[1])).toBe("y");

    const planes = roofZonePlanes(layoutWith(zones));
    expect(planes).toHaveLength(2);
    expect(planes[0]).toMatchObject({
      id: "roofz-gable:plane",
      zoneId: "roofz-gable",
      ridgeAxis: "x",
    });
    expect(planes[0].materialAreaM2).toBeGreaterThan(32);
  });

  it("projects roof zones to plan rectangles with stable refs", () => {
    const zones: RoofZone[] = [
      {
        id: "roofz-plan",
        type: "datar",
        x: 4,
        y: 5,
        widthM: 6,
        depthM: 2,
        slopeDeg: 0,
        overhangM: 0.5,
      },
    ];

    const [projection] = projectRoofZonesPlan(layoutWith(zones));

    expect(projection.refId).toBe("roofz-plan");
    expect(projection.points).toEqual([
      { x: 1, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 6 },
      { x: 1, y: 6 },
    ]);
  });
});
