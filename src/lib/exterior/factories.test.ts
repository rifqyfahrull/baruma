import { describe, it, expect } from "vitest";
import { makeBoxElement, segmentDefaultLengthM } from "@/lib/exterior/factories";

describe("segmentDefaultLengthM", () => {
  it("returns 1.2m for pedestrian_gate", () => {
    expect(segmentDefaultLengthM("pedestrian_gate")).toBe(1.2);
  });

  it("returns 3m for boundary_wall, fence, sliding_gate, and swing_gate", () => {
    expect(segmentDefaultLengthM("boundary_wall")).toBe(3);
    expect(segmentDefaultLengthM("fence")).toBe(3);
    expect(segmentDefaultLengthM("sliding_gate")).toBe(3);
    expect(segmentDefaultLengthM("swing_gate")).toBe(3);
  });
});

describe("makeBoxElement overhang_slab", () => {
  it("memberi default pelat tipis 3 x 1.2 x 0.18 m bermaterial beton", () => {
    const element = makeBoxElement("overhang_slab", 1, 2);
    expect(element.kind).toBe("overhang_slab");
    expect(element.widthM).toBe(3);
    expect(element.depthM).toBe(1.2);
    expect(element.heightM).toBe(0.18);
    expect(element.material?.materialId).toBe("beton_ekspos");
  });
});
