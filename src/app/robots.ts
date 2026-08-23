import type { MetadataRoute } from "next"

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://baruma.tampil.dev").replace(/\/$/, "")

/**
 * WS-D §3. `/app/**` (authenticated workspace) is disallowed — nothing to
 * index, and it'd waste crawl budget. `/s/**` (public share links) is
 * deliberately left crawlable here: each share page sets its OWN
 * `noindex` via `generateMetadata` (see src/app/s/[token]/page.tsx) —
 * blocking the path in robots.txt would stop crawlers from ever fetching a
 * page to see that meta tag, which can paradoxically leave a bare URL
 * indexed with no snippet instead of fully excluded.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/app/",
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  }
}
