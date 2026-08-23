/**
 * Union perimeter of axis-aligned rectangles.
 * Used to compute building perimeter from room footprints.
 */

export type Rect = {
  x: number;
  y: number;
  width: number;
  depth: number;
};

export type Point = {
  x: number;
  y: number;
};

/**
 * Check if two rectangles share an edge (adjacent with overlapping perpendicular extent).
 */
export function rectsShareEdge(
  a: Rect,
  b: Rect
): "left" | "right" | "top" | "bottom" | null {
  const eps = 0.001;

  // a's right edge touches b's left edge
  if (Math.abs(a.x + a.width - b.x) < eps) {
    const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    if (overlapY > eps) return "right";
  }
  // b's right edge touches a's left edge
  if (Math.abs(b.x + b.width - a.x) < eps) {
    const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    if (overlapY > eps) return "left";
  }
  // a sits below b: a's top edge touches b's bottom edge (y increases downward)
  if (Math.abs(a.y - (b.y + b.depth)) < eps) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (overlapX > eps) return "top";
  }
  // a sits above b: a's bottom edge touches b's top edge
  if (Math.abs(b.y - (a.y + a.depth)) < eps) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (overlapX > eps) return "bottom";
  }
  return null;
}

/**
 * Length of the edge two rectangles share (0 if not adjacent). Mirrors the
 * touch/overlap checks in `rectsShareEdge` but returns the overlap length
 * instead of the side label — used to bill internal partition walls from
 * actual room adjacency instead of a flat area multiplier.
 */
export function sharedEdgeLength(a: Rect, b: Rect): number {
  const eps = 0.001;

  if (Math.abs(a.x + a.width - b.x) < eps || Math.abs(b.x + b.width - a.x) < eps) {
    const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    if (overlapY > eps) return overlapY;
  }
  if (Math.abs(a.y - (b.y + b.depth)) < eps || Math.abs(b.y - (a.y + a.depth)) < eps) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (overlapX > eps) return overlapX;
  }
  return 0;
}

/**
 * Find perimeter edges (exposed edges not shared with another rect).
 *
 * Handles reentrant corners: when a neighbour covers only PART of a side
 * (L/T-shaped unions), the uncovered remainder stays exposed — the old
 * implementation dropped the whole side whenever `rectsShareEdge` reported
 * any overlap, losing the reentrant segment and inflating/defeating the
 * perimeter. Each side is covered-interval-subtracted from its full span,
 * and every leftover span is emitted as its own edge.
 */
export function findPerimeterEdges(
  rects: Rect[]
): { x1: number; y1: number; x2: number; y2: number }[] {
  const eps = 0.001;
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (rects.length === 0) return edges;

  // Subtract a set of covered intervals from a span, returning the leftover
  // (exposed) sub-spans. `covered` must already be filtered to intersecting.
  function subtract(
    span: [number, number],
    covered: Array<[number, number]>
  ): Array<[number, number]> {
    const sorted = covered
      .filter((c) => c[1] > span[0] + eps && c[0] < span[1] - eps)
      .sort((p, q) => p[0] - q[0]);
    const result: Array<[number, number]> = [];
    let cursor = span[0];
    for (const c of sorted) {
      const start = Math.max(cursor, c[0]);
      const end = Math.min(span[1], c[1]);
      if (start > cursor + eps) result.push([cursor, start]);
      cursor = Math.max(cursor, end);
      if (cursor >= span[1] - eps) break;
    }
    if (cursor < span[1] - eps) result.push([cursor, span[1]]);
    return result;
  }

  for (const r of rects) {
    const topCovered: Array<[number, number]> = [];
    const bottomCovered: Array<[number, number]> = [];
    const leftCovered: Array<[number, number]> = [];
    const rightCovered: Array<[number, number]> = [];
    for (const o of rects) {
      if (o === r) continue;
      // o sits above r, sharing r's top edge (y increases downward)
      if (Math.abs(o.y + o.depth - r.y) < eps) {
        const x0 = Math.max(r.x, o.x);
        const x1 = Math.min(r.x + r.width, o.x + o.width);
        if (x1 - x0 > eps) topCovered.push([x0, x1]);
      }
      // o sits below r, sharing r's bottom edge
      if (Math.abs(o.y - (r.y + r.depth)) < eps) {
        const x0 = Math.max(r.x, o.x);
        const x1 = Math.min(r.x + r.width, o.x + o.width);
        if (x1 - x0 > eps) bottomCovered.push([x0, x1]);
      }
      // o sits left of r, sharing r's left edge
      if (Math.abs(o.x + o.width - r.x) < eps) {
        const y0 = Math.max(r.y, o.y);
        const y1 = Math.min(r.y + r.depth, o.y + o.depth);
        if (y1 - y0 > eps) leftCovered.push([y0, y1]);
      }
      // o sits right of r, sharing r's right edge
      if (Math.abs(o.x - (r.x + r.width)) < eps) {
        const y0 = Math.max(r.y, o.y);
        const y1 = Math.min(r.y + r.depth, o.y + o.depth);
        if (y1 - y0 > eps) rightCovered.push([y0, y1]);
      }
    }

    for (const [x0, x1] of subtract([r.x, r.x + r.width], topCovered)) {
      edges.push({ x1: x0, y1: r.y, x2: x1, y2: r.y });
    }
    for (const [x0, x1] of subtract([r.x, r.x + r.width], bottomCovered)) {
      edges.push({ x1: x1, y1: r.y + r.depth, x2: x0, y2: r.y + r.depth });
    }
    for (const [y0, y1] of subtract([r.y, r.y + r.depth], leftCovered)) {
      edges.push({ x1: r.x, y1: y1, x2: r.x, y2: y0 });
    }
    for (const [y0, y1] of subtract([r.y, r.y + r.depth], rightCovered)) {
      edges.push({ x1: r.x + r.width, y1: y0, x2: r.x + r.width, y2: y1 });
    }
  }
  return edges;
}

/**
 * Trace edges into a single polygon (clockwise, closed).
 * Assumes edges form a single connected loop.
 */
export function tracePolygon(
  edges: { x1: number; y1: number; x2: number; y2: number }[]
): Point[] {
  if (edges.length === 0) return [];
  if (edges.length === 4) {
    // Single rectangle: return corners from the first edge
    const e = edges[0];
    return [
      { x: e.x1, y: e.y1 },
      { x: e.x2, y: e.y2 },
    ];
  }

  const pts: Point[] = [];
  const remaining = [...edges];

  // Start with the first edge
  const current = remaining.shift()!;
  pts.push({ x: current.x1, y: current.y1 });
  pts.push({ x: current.x2, y: current.y2 });

  while (remaining.length > 0) {
    const last = pts[pts.length - 1];
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i];
      if (Math.abs(e.x1 - last.x) < 0.001 && Math.abs(e.y1 - last.y) < 0.001) {
        pts.push({ x: e.x2, y: e.y2 });
        remaining.splice(i, 1);
        found = true;
        break;
      }
      if (Math.abs(e.x2 - last.x) < 0.001 && Math.abs(e.y2 - last.y) < 0.001) {
        pts.push({ x: e.x1, y: e.y1 });
        remaining.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  // Deduplicate consecutive points
  const unique: Point[] = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (!last || Math.abs(p.x - last.x) > 0.001 || Math.abs(p.y - last.y) > 0.001) {
      unique.push(p);
    }
  }
  // Close the polygon if needed
  if (unique.length > 1) {
    const first = unique[0];
    const last = unique[unique.length - 1];
    if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001) {
      unique.push({ x: first.x, y: first.y });
    }
  }
  return unique;
}

/**
 * Compute union perimeter of a set of rectangles (meters).
 */
export function rectUnionPerimeter(rects: Rect[]): number {
  const filtered = rects.filter((r) => r.width > 0.001 && r.depth > 0.001);
  if (filtered.length === 0) return 0;
  if (filtered.length === 1) {
    const r = filtered[0];
    return 2 * (r.width + r.depth);
  }

  const edges = findPerimeterEdges(filtered);
  const polygon = tracePolygon(edges);
  let perimeter = 0;
  for (let i = 0; i < polygon.length - 1; i++) {
    const dx = polygon[i + 1].x - polygon[i].x;
    const dy = polygon[i + 1].y - polygon[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/**
 * Get union polygon points (for drawing).
 * Returns a closed polygon (first point = last point).
 */
export function rectUnionPolygon(rects: Rect[]): Point[] {
  const filtered = rects.filter((r) => r.width > 0.001 && r.depth > 0.001);
  if (filtered.length === 0) return [];
  if (filtered.length === 1) {
    const r = filtered[0];
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.depth },
      { x: r.x, y: r.y + r.depth },
      { x: r.x, y: r.y },
    ];
  }
  const edges = findPerimeterEdges(filtered);
  return tracePolygon(edges);
}