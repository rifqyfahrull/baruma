import { describe, expect, it } from "vitest";

import {
  makeBoxElement,
  makeFrameElement,
  makeRoofZone,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "./factories";
import { validateExteriorElement, validateRoofZones } from "./validation";

const site = { widthM: 20, depthM: 20, areaM2: 400 };

describe("validateExteriorElement", () => {
  it("passes for a valid boundary wall", () => {
    const wall = makeSegmentElement(
      "boundary_wall",
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { heightM: 2.4, thicknessM: 0.2 },
    );
    const issues = validateExteriorElement(wall, { site });
    expect(issues).toHaveLength(0);
  });

  it("fails for a segment that is too short", () => {
    const wall = makeSegmentElement(
      "boundary_wall",
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { heightM: 2.4, thicknessM: 0.2 },
    );
    const issues = validateExteriorElement(wall, { site });
    expect(issues.some((i) => i.message.includes("terlalu pendek"))).toBe(true);
  });

  it("warns when element is outside site", () => {
    const wall = makeSegmentElement(
      "boundary_wall",
      { x: 25, y: 0 },
      { x: 30, y: 0 },
      { heightM: 2.4, thicknessM: 0.2 },
    );
    const issues = validateExteriorElement(wall, { site });
    expect(issues.some((i) => i.message.includes("di luar batas tapak"))).toBe(
      true,
    );
  });

  it("warns when an additive element is marked as secondary unverified structure", () => {
    const portal = makeFrameElement(5, 5, {
      widthM: 3,
      heightM: 3,
      memberSizeM: 0.25,
    });
    portal.structuralRole = "secondary_unverified";

    const issues = validateExteriorElement(portal, { site });
    expect(issues).toContainEqual(
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("perlu review engineer"),
      }),
    );
  });

  it("fails for a self-intersecting surface", () => {
    const surface = makeSurfaceElement("driveway", [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ]);
    const issues = validateExteriorElement(surface, { site });
    expect(issues.some((i) => i.message.includes("self-intersecting"))).toBe(
      true,
    );
  });

  it("fails for a portal with members too thick", () => {
    const portal = makeFrameElement(5, 5, {
      widthM: 1,
      heightM: 1,
      memberSizeM: 0.6,
    });
    const issues = validateExteriorElement(portal, { site });
    expect(issues.some((i) => i.message.includes("terlalu tebal"))).toBe(true);
  });

  it("fails for a box with zero dimension", () => {
    const column = makeBoxElement("column", 5, 5, {
      widthM: 1,
      depthM: 1,
      heightM: 0,
    });
    const issues = validateExteriorElement(column, { site });
    expect(issues.some((i) => i.message.includes("Tinggi box"))).toBe(true);
  });

  it("warns for a stair with riser outside range", () => {
    const stair = makeStairElement(5, 5, {
      widthM: 1.2,
      lengthM: 1,
      riseM: 0.11,
    });
    const issues = validateExteriorElement(stair, { site });
    expect(issues.some((i) => i.message.includes("Riser tangga"))).toBe(true);
  });
});

describe("validateRoofZones", () => {
  it("passes for non-overlapping zones", () => {
    const zones = [
      makeRoofZone("datar", 5, 5, { widthM: 6, depthM: 4 }),
      makeRoofZone("datar", 12, 5, { widthM: 6, depthM: 4 }),
    ];
    const issues = validateRoofZones(zones, site);
    expect(issues).toHaveLength(0);
  });

  it("fails for overlapping zones", () => {
    const zones = [
      makeRoofZone("datar", 5, 5, { widthM: 6, depthM: 4 }),
      makeRoofZone("datar", 7, 5, { widthM: 6, depthM: 4 }),
    ];
    const issues = validateRoofZones(zones, site);
    expect(issues.some((i) => i.message.includes("tumpang tindih"))).toBe(true);
  });

  it("fails for invalid slope", () => {
    const zones = [
      makeRoofZone("pelana", 5, 5, { widthM: 6, depthM: 4, slopeDeg: 70 }),
    ];
    const issues = validateRoofZones(zones, site);
    expect(issues.some((i) => i.message.includes("Kemiringan"))).toBe(true);
  });
});
