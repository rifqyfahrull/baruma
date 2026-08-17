import { describe, expect, it } from "vitest";

import {
  makeBoxElement,
  makeFrameElement,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "./factories";
import {
  boxBoundingBox,
  exteriorElementBoundingBox,
  hasDegenerateEdges,
  isSelfIntersecting,
  normalizePolygonWinding,
  orientedRectCorners,
  polygonArea,
  polygonWinding,
  roofZoneSurfaceArea,
  rotatePoint,
  segmentLength,
} from "./geometry";

describe("exterior geometry", () => {
  describe("segmentLength", () => {
    it("calculates euclidean distance", () => {
      expect(segmentLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });
  });

  describe("rotatePoint", () => {
    it("rotates 90 degrees around origin", () => {
      const rotated = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
      expect(rotated.x).toBeCloseTo(0, 5);
      expect(rotated.y).toBeCloseTo(1, 5);
    });
  });

  describe("orientedRectCorners", () => {
    it("returns four corners for an axis-aligned rectangle", () => {
      const corners = orientedRectCorners({
        x: 2,
        y: 2,
        widthM: 4,
        depthM: 2,
        rotationDeg: 0,
      });
      expect(corners).toHaveLength(4);
      expect(corners[1]).toEqual({ x: 4, y: 1 });
    });
  });

  describe("boxBoundingBox", () => {
    it("computes axis-aligned bounds for a rotated box", () => {
      const box = makeBoxElement("column", 5, 5, {
        widthM: 2,
        depthM: 4,
        rotationDeg: 90,
      });
      const bbox = boxBoundingBox(box);
      expect(bbox.maxX - bbox.minX).toBeCloseTo(4, 5);
      expect(bbox.maxY - bbox.minY).toBeCloseTo(2, 5);
    });
  });

  describe("exteriorElementBoundingBox", () => {
    it("covers a segment with thickness", () => {
      const segment = makeSegmentElement(
        "boundary_wall",
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { thicknessM: 0.2, heightM: 2.4 },
      );
      const bbox = exteriorElementBoundingBox(segment);
      expect(bbox.maxX - bbox.minX).toBeCloseTo(4.2, 5);
      expect(bbox.maxY - bbox.minY).toBeCloseTo(0.2, 5);
    });

    it("covers a stair footprint", () => {
      const stair = makeStairElement(2, 2, {
        widthM: 1.2,
        lengthM: 3,
        direction: "n",
      });
      const bbox = exteriorElementBoundingBox(stair);
      expect(bbox.maxX - bbox.minX).toBeCloseTo(1.2, 5);
      expect(bbox.maxY - bbox.minY).toBeCloseTo(3, 5);
    });
  });

  describe("polygon helpers", () => {
    it("computes area of a right triangle", () => {
      const area = polygonArea([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 3 },
      ]);
      expect(area).toBe(6);
    });

    it("detects self-intersecting polygon", () => {
      const bowtie = [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ];
      expect(isSelfIntersecting(bowtie)).toBe(true);
    });

    it("normalizes winding to ccw", () => {
      const cw = [
        { x: 1, y: 1 },
        { x: 1, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 1 },
      ];
      expect(polygonWinding(cw)).toBe("cw");
      const ccw = normalizePolygonWinding(cw, "ccw");
      expect(polygonWinding(ccw)).toBe("ccw");
    });

    it("detects degenerate edges", () => {
      expect(
        hasDegenerateEdges([
          { x: 1, y: 1 },
          { x: 1, y: 1 },
          { x: 3, y: 1 },
        ]),
      ).toBe(true);
    });
  });

  describe("roofZoneSurfaceArea", () => {
    it("returns footprint for flat roof", () => {
      expect(
        roofZoneSurfaceArea({
          id: "z1",
          type: "datar",
          x: 0,
          y: 0,
          widthM: 6,
          depthM: 4,
          slopeDeg: 0,
          overhangM: 1,
        }),
      ).toBe(24);
    });

    it("returns sloped area for gable roof", () => {
      const area = roofZoneSurfaceArea({
        id: "z1",
        type: "pelana",
        x: 0,
        y: 0,
        widthM: 6,
        depthM: 4,
        slopeDeg: 30,
        overhangM: 0,
      });
      expect(area).toBeGreaterThan(24);
    });
  });

  describe("makeFrameElement", () => {
    it("produces a valid bounding box", () => {
      const frame = makeFrameElement(2, 2, {
        widthM: 3,
        heightM: 2.8,
        depthM: 0.3,
        rotationDeg: 0,
      });
      const bbox = exteriorElementBoundingBox(frame);
      expect(bbox.maxX - bbox.minX).toBeCloseTo(3, 5);
      expect(bbox.maxY - bbox.minY).toBeCloseTo(0.3, 5);
    });
  });

  describe("makeSurfaceElement", () => {
    it("produces a valid bounding box", () => {
      const surface = makeSurfaceElement("driveway", [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ]);
      const bbox = exteriorElementBoundingBox(surface);
      expect(bbox.maxX - bbox.minX).toBe(4);
      expect(bbox.maxY - bbox.minY).toBe(2);
    });
  });
});
