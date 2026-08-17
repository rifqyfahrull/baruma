import { describe, expect, it } from "vitest";

import type { Room } from "@/types";
import {
  makeAssetElement,
  makeBoxElement,
  makeFrameElement,
  makeSegmentElement,
  makeSurfaceElement,
  makeStairElement,
} from "./factories";
import { computeExteriorWallArea, computeInternalWallArea, exteriorElementQuantities } from "./quantities";

function room(overrides: Partial<Room> & Pick<Room, "id" | "type" | "x" | "y" | "width" | "depth">): Room {
  return {
    floorId: "floor-1",
    name: overrides.id,
    areaM2: overrides.width * overrides.depth,
    ...overrides,
  } as Room;
}

describe("exterior quantities", () => {
  it("calculates boundary wall area", () => {
    const wall = makeSegmentElement(
      "boundary_wall",
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { heightM: 2.4, thicknessM: 0.2 },
    );
    const [q] = exteriorElementQuantities(wall);
    expect(q.qty).toBe(12);
    expect(q.unit).toBe("m2");
  });

  it("calculates fence length", () => {
    const fence = makeSegmentElement(
      "fence",
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { heightM: 1.8, thicknessM: 0.05 },
    );
    const [q] = exteriorElementQuantities(fence);
    expect(q.qty).toBe(8);
    expect(q.unit).toBe("m");
  });

  it("calculates gate as unit with secondary length", () => {
    const gate = makeSegmentElement(
      "sliding_gate",
      { x: 0, y: 0 },
      { x: 4.5, y: 0 },
      { heightM: 2.1, thicknessM: 0.05 },
    );
    const [q] = exteriorElementQuantities(gate);
    expect(q.qty).toBe(1);
    expect(q.unit).toBe("unit");
    expect(q.secondaryQty).toBe(4.5);
  });

  it("calculates facade panel area and volume", () => {
    const panel = makeBoxElement("facade_panel", 5, 5, {
      widthM: 2,
      depthM: 0.2,
      heightM: 3,
    });
    const [q] = exteriorElementQuantities(panel);
    expect(q.qty).toBe(6);
    expect(q.unit).toBe("m2");
    expect(q.secondaryQty).toBeCloseTo(1.2, 5);
    expect(q.secondaryUnit).toBe("m3");
  });

  it("calculates portal frame member volume", () => {
    const portal = makeFrameElement(5, 5, {
      widthM: 3,
      heightM: 2.8,
      depthM: 0.3,
      memberSizeM: 0.3,
    });
    const [q] = exteriorElementQuantities(portal);
    expect(q.unit).toBe("m3");
    expect(q.qty).toBeCloseTo(0.72, 5);
    expect(q.secondaryQty).toBeCloseTo(8.4, 5);
  });

  it("calculates driveway area and volume", () => {
    const driveway = makeSurfaceElement("driveway", [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 0, y: 3 },
    ]);
    const [q] = exteriorElementQuantities(driveway);
    expect(q.qty).toBe(15);
    expect(q.unit).toBe("m2");
    expect(q.secondaryQty).toBe(2.25);
  });

  it("includes garden bed area for landscape costing", () => {
    const bed = makeSurfaceElement("garden_bed", [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
    const [q] = exteriorElementQuantities(bed);
    expect(q.included).toBe(true);
    expect(q.qty).toBe(2);
    expect(q.unit).toBe("m2");
    expect(q.secondaryQty).toBe(0.2);
  });

  it("excludes custom asset by default", () => {
    const asset = makeAssetElement("asset", 5, 5, {
      modelUrl: "/custom.glb",
      fitMode: "fit_envelope",
    }, {
      widthM: 1,
      depthM: 1,
      heightM: 1,
    });
    const [q] = exteriorElementQuantities(asset);
    expect(q.included).toBe(false);
    expect(q.exclusionReason).toBe("Custom GLB memerlukan costing manual");
  });

  it("includes semantic landscape/decor assets but keeps vehicles visual-only", () => {
    const tree = makeAssetElement("tree", 5, 5, {
      modelUrl: null,
      fitMode: "fit_envelope",
    }, {
      widthM: 1,
      depthM: 1,
      heightM: 3,
    });
    const vehicle = makeAssetElement("vehicle", 5, 5, {
      modelUrl: null,
      fitMode: "fit_envelope",
    }, {
      widthM: 2,
      depthM: 4,
      heightM: 1.5,
    });

    expect(exteriorElementQuantities(tree)[0]).toMatchObject({
      item: "Pohon",
      unit: "unit",
      included: true,
    });
    expect(exteriorElementQuantities(vehicle)[0]).toMatchObject({
      item: "Kendaraan",
      unit: "unit",
      included: false,
      exclusionReason: "Kendaraan hanya konteks visual, bukan item RAB bangunan",
    });
  });
});

describe("stair quantities — basis volume (Gelombang 2)", () => {
  it("beton m3 + finishing m2 dengan rateId spesifik", () => {
    const el = makeStairElement(2, 2, { widthM: 1.2, lengthM: 1.8, riseM: 0.9 })
    const quantities = exteriorElementQuantities(el)
    expect(quantities).toHaveLength(2)
    const beton = quantities.find((q) => q.item.includes("beton"))!
    expect(beton.unit).toBe("m3")
    expect(beton.rateId).toBe("ext-stair-beton-v1")
    expect(beton.qty).toBeCloseTo(0.5 * 1.2 * 1.8 * 0.9, 5) // 0.972
    const finish = quantities.find((q) => q.item.includes("finishing"))!
    expect(finish.unit).toBe("m2")
    expect(finish.rateId).toBe("ext-stair-finish-v1")
  })
})

describe("computeExteriorWallArea", () => {
  it("excludes a carport bersebelahan dari perimeter — tidak menagih dinding yang tak ada", () => {
    const withCarport: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
      room({ id: "B", type: "carport", x: 4, y: 0, width: 3, depth: 3 }),
    ];
    const withoutCarport: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
    ];
    // Perimeter luar sama: carport tidak melebarkan union bangunan.
    expect(computeExteriorWallArea(withCarport, 3, 0)).toBeCloseTo(
      computeExteriorWallArea(withoutCarport, 3, 0),
      5,
    );
  });

  it("returns 0 when every room is an outdoor type", () => {
    const rooms: Room[] = [room({ id: "A", type: "taman", x: 0, y: 0, width: 4, depth: 3 })];
    expect(computeExteriorWallArea(rooms, 3, 0)).toBe(0);
  });
});

describe("computeInternalWallArea", () => {
  it("bills the shared edge between two adjacent indoor rooms once", () => {
    const rooms: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
      room({ id: "B", type: "kamar_tidur", x: 4, y: 0, width: 3, depth: 3 }),
    ];
    // Shared edge length = 3 m, wallHeight = 3 m, no opening deduction.
    expect(computeInternalWallArea(rooms, 3, 0)).toBeCloseTo(9, 5);
  });

  it("returns 0 for non-adjacent rooms", () => {
    const rooms: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
      room({ id: "B", type: "kamar_tidur", x: 10, y: 0, width: 3, depth: 3 }),
    ];
    expect(computeInternalWallArea(rooms, 3, 0)).toBe(0);
  });

  it("excludes outdoor rooms from partition accounting", () => {
    const rooms: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
      room({ id: "B", type: "carport", x: 4, y: 0, width: 3, depth: 3 }),
    ];
    expect(computeInternalWallArea(rooms, 3, 0)).toBe(0);
  });
});
