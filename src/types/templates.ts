/**
 * "Templates" feature — client-facing contract types for the curated,
 * publicly browsable list of ready-made designs (seeded from showcase
 * projects, see db/migrations/0036_templates.sql + 0037_seed_templates.sql).
 */
import type { Brief, DesignLayout, HouseStyle, Site, ThumbnailVariant } from "@/types"
import type { SavedInterior } from "@/lib/schemas/interior"

/**
 * List-view shape — everything EXCEPT the large jsonb payloads (layout,
 * brief, interior). Used by `GET /api/v1/templates` and the admin list.
 */
export type TemplateSummary = {
  id: string
  slug: string
  name: string
  description: string | null
  style?: HouseStyle
  city?: string
  province?: string
  floors: number
  rooftop: boolean
  thumbnail: ThumbnailVariant
  /** Site dimensions/area so a template card can show tapak size. */
  site: Site
  sortOrder: number
  active: boolean
  sourceProjectId: string | null
  createdAt: string
  updatedAt: string
}

/** Detail-view shape — adds the full generated design payloads. */
export type TemplateDetail = TemplateSummary & {
  layout: DesignLayout
  brief: Brief | null
  interior: SavedInterior | null
}
