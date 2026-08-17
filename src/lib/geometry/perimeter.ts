/**
 * Building perimeter calculation from room footprints.
 * Uses rectUnionPerimeter from union.ts to compute the union outline.
 */

import type { DesignLayout, Room } from "@/types";
import { isOutdoorRoom } from "./connectivity";
import { rectUnionPerimeter, rectUnionPolygon, type Point, type Rect } from "./union";

/**
 * Compute building perimeter from a list of rooms on a specific floor.
 * Ruang terbuka (carport, taman, kolam, balkon, rooftop_lounge, void — lihat
 * `isOutdoorRoom`) dikecualikan: union 3D/gambar kerja sudah memperlakukannya
 * tanpa dinding, jadi perimeter/material dinding luar harus konsisten.
 * Returns perimeter in meters and the polygon points.
 */
export function computeBuildingPerimeterFromRooms(
  rooms: Room[],
  floorId: string
): { perimeter: number; polygon: Point[] } {
  const filteredRooms = rooms.filter(
    (room) => room.floorId === floorId && !isOutdoorRoom(room)
  );

  if (filteredRooms.length === 0) {
    return { perimeter: 0, polygon: [] };
  }

  const rects: Rect[] = filteredRooms.map((room) => ({
    x: room.x,
    y: room.y,
    width: room.width,
    depth: room.depth,
  }));

  const perimeter = rectUnionPerimeter(rects);
  const polygon = rectUnionPolygon(rects);
  return { perimeter, polygon };
}

/**
 * Compute building perimeter for all floors in a layout.
 */
export function computeAllBuildingPerimeters(
  layout: DesignLayout
): Map<string, { perimeter: number; polygon: Point[] }> {
  const result = new Map<string, { perimeter: number; polygon: Point[] }>();
  const floorIds = new Set(layout.rooms.map((room) => room.floorId));
  for (const floorId of floorIds) {
    const perim = computeBuildingPerimeterFromRooms(layout.rooms, floorId);
    result.set(floorId, perim);
  }
  return result;
}

/**
 * Get total building perimeter across all floors (sum per floor).
 */
export function totalBuildingPerimeter(layout: DesignLayout): number {
  const perimeters = computeAllBuildingPerimeters(layout);
  let total = 0;
  for (const [, perim] of perimeters) {
    total += perim.perimeter;
  }
  return total;
}