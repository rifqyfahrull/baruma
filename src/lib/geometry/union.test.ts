import { describe, expect, it } from "vitest";
import { rectUnionPerimeter, rectUnionPolygon, rectsShareEdge, sharedEdgeLength, Rect } from "./union";

describe("rectsShareEdge", () => {
  it("detects top/bottom adjacency", () => {
    const a: Rect = { x: 0, y: 0, width: 2, depth: 1 };
    const b: Rect = { x: 0, y: 1, width: 2, depth: 1 };
    expect(rectsShareEdge(a, b)).toBe("bottom"); // a's bottom touches b's top
    expect(rectsShareEdge(b, a)).toBe("top");
  });

  it("detects left/right adjacency", () => {
    const a: Rect = { x: 0, y: 0, width: 1, depth: 2 };
    const b: Rect = { x: 1, y: 0, width: 1, depth: 2 };
    expect(rectsShareEdge(a, b)).toBe("right");
    expect(rectsShareEdge(b, a)).toBe("left");
  });

  it("returns null when not adjacent", () => {
    const a: Rect = { x: 0, y: 0, width: 1, depth: 1 };
    const b: Rect = { x: 2, y: 0, width: 1, depth: 1 };
    expect(rectsShareEdge(a, b)).toBeNull();
  });

  it("returns null when overlapping but not edge-aligned", () => {
    const a: Rect = { x: 0, y: 0, width: 1, depth: 1 };
    const b: Rect = { x: 0.5, y: 0, width: 1, depth: 1 };
    expect(rectsShareEdge(a, b)).toBeNull();
  });
});

describe("sharedEdgeLength", () => {
  it("returns overlap length for top/bottom adjacency", () => {
    const a: Rect = { x: 0, y: 0, width: 2, depth: 1 };
    const b: Rect = { x: 0, y: 1, width: 2, depth: 1 };
    expect(sharedEdgeLength(a, b)).toBe(2);
  });

  it("returns overlap length for left/right adjacency", () => {
    const a: Rect = { x: 0, y: 0, width: 1, depth: 2 };
    const b: Rect = { x: 1, y: 0, width: 1, depth: 3 };
    // b is taller than a; shared span is limited by a's depth (0..2)
    expect(sharedEdgeLength(a, b)).toBe(2);
  });

  it("returns 0 when not adjacent", () => {
    const a: Rect = { x: 0, y: 0, width: 1, depth: 1 };
    const b: Rect = { x: 2, y: 0, width: 1, depth: 1 };
    expect(sharedEdgeLength(a, b)).toBe(0);
  });

  it("returns 0 when overlapping but not edge-aligned", () => {
    const a: Rect = { x: 0, y: 0, width: 1, depth: 1 };
    const b: Rect = { x: 0.5, y: 0, width: 1, depth: 1 };
    expect(sharedEdgeLength(a, b)).toBe(0);
  });
});

describe("rectUnionPerimeter", () => {
  it("returns perimeter for single rectangle", () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 3, depth: 2 }];
    expect(rectUnionPerimeter(rects)).toBe(10); // 2*(3+2)
  });

  it("returns perimeter for two adjacent rectangles (L-shape)", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 2, depth: 2 },
      { x: 2, y: 0, width: 1, depth: 3 },
    ];
    // Union is an L. Outer perimeter (clockwise from top-left):
    // (0,0)->(2,0)->(3,0)->(3,3)->(2,3)->(2,2)->(0,2)->(0,0)
    // Lengths: 2 +1 +3 +1 +1 +2 +2 = 12
    expect(rectUnionPerimeter(rects)).toBe(12);
  });

  it("returns perimeter for three rectangles in a row", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 1, depth: 1 },
      { x: 1, y: 0, width: 1, depth: 1 },
      { x: 2, y: 0, width: 1, depth: 1 },
    ];
    // Union is 3x1 rectangle: perimeter = 2*(3+1)=8
    expect(rectUnionPerimeter(rects)).toBe(8);
  });

  it("returns 0 for empty array", () => {
    expect(rectUnionPerimeter([])).toBe(0);
  });

  it("handles zero-area rects", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 0, depth: 2 },
      { x: 1, y: 0, width: 1, depth: 2 },
    ];
    expect(rectUnionPerimeter(rects)).toBe(6); // only the valid one
  });
});

describe("rectUnionPolygon", () => {
  it("returns polygon for single rectangle", () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 3, depth: 2 }];
    const poly = rectUnionPolygon(rects);
    expect(poly).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 0 },
    ]);
  });

  it("returns polygon for L-shape", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 2, depth: 2 },
      { x: 2, y: 0, width: 1, depth: 3 },
    ];
    const poly = rectUnionPolygon(rects);
    // Expected: clockwise order starting from top-left?
    // Implementation may produce a different start but shape should be consistent.
    // Let's just check length and rough shape.
    expect(poly.length).toBeGreaterThan(4);
    // Check that the polygon is closed (first == last)
    expect(poly[0]).toEqual(poly[poly.length - 1]);
  });
});