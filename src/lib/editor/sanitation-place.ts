/**
 * Pure placement helpers for land-level sanitation objects in the 2D editor.
 * Kept out of the React component so they are unit-testable and reusable.
 *
 * Sanitation objects (septic tank / soakwell / control box) live on the LOT,
 * not inside a room: their `x/y` are absolute metres on the Site
 * (widthM × depthM), so drag-clamp bounds are the whole lot, NOT a room rect.
 */
import type { DesignLayout } from "@/types"
import { clamp, round2 } from "@/lib/geometry"
import { effectiveRoof } from "@/lib/drawings/elevation"
import { effectiveRoofCatchmentArea } from "@/lib/exterior/roof-zones"

/** Clamp (x, y) so it stays within the Site's lot bounds ([0,widthM]×[0,depthM]). */
export function clampToSite(
  site: { widthM: number; depthM: number },
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: clamp(x, 0, site.widthM),
    y: clamp(y, 0, site.depthM),
  }
}

/** Rooftop pseudo-floor id, excluded from the building footprint (same magic
 *  constant the drawing builders use). */
const ROOFTOP_FLOOR_ID = "floor-rooftop"

/**
 * Roof-catchment area (m²) used to size the soakwell in the editor's
 * "Auto-size sanitasi". Mirrors sheet-list.ts `roofAreaOf` VERBATIM so the
 * soakwell dropped on the plan matches the dimensions the S-02 detail sheet
 * shows: footprint = non-rooftop room bounding box; datar × 1.1; sloped ×
 * (1/cos slope) × 1.15 via the clamped `effectiveRoof` reader.
 *
 * Defensive over the un-validated layout PUT (malformed rooms tolerated).
 */
export function roofAreaForLayout(layout: DesignLayout): number {
  if (layout.roofZones?.length) return effectiveRoofCatchmentArea(layout)

  const roof = effectiveRoof(layout)
  const rooms = (Array.isArray(layout.rooms) ? layout.rooms : []).filter(
    (r) => r && r.floorId !== ROOFTOP_FLOOR_ID,
  )
  const totalW = rooms.reduce((m, r) => Math.max(m, r.x + r.width), 0)
  const totalD = rooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0)
  const footprint = totalW * totalD
  return round2(
    roof.type === "datar"
      ? footprint * 1.1
      : footprint * (1 / Math.cos((roof.slopeDeg * Math.PI) / 180)) * 1.15,
  )
}
