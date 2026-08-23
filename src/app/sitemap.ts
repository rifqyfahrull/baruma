import type { MetadataRoute } from "next"

import { listTemplates } from "@/lib/server/repo/templates"

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://baruma.tampil.dev").replace(/\/$/, "")

/**
 * Marketing routes + active templates (WS-D §3 — quick win from
 * docs/seo-marketing-analysis.md). `/app/**` and `/s/**` are intentionally
 * excluded — private/per-user (app) or per-token (share links, see
 * robots.ts) and would just be noise/leak surface for a crawler.
 */
// Template list changes as admins curate it — hourly revalidate keeps new/
// removed templates showing up in the sitemap without needing a redeploy.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const templates = await listTemplates(true).catch(() => [])

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${APP_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${APP_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${APP_URL}/templates`, changeFrequency: "weekly", priority: 0.8 },
  ]

  const templateRoutes: MetadataRoute.Sitemap = templates.map((t) => ({
    url: `${APP_URL}/templates/${t.slug}`,
    lastModified: t.updatedAt,
    changeFrequency: "monthly",
    priority: 0.6,
  }))

  return [...staticRoutes, ...templateRoutes]
}
