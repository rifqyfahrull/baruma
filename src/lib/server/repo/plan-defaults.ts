/**
 * Default plan rows — the single TS source the in-memory plans store seeds
 * from when `DATABASE_URL` is absent. Also the mock data-source's `getPlans`
 * result (src/lib/mock/index.ts) — this module has only a type-only import,
 * so it's safe to pull into the client bundle despite living under
 * lib/server/repo.
 *
 * The seed UPDATEs in db/migrations/0007_billing_admin.sql mirror this list
 * verbatim. Its card content (name/tagline/featured/features/limits) is the
 * pixel-equal snapshot of the landing's pre-T2 hardcoded `PRICING_PLANS`
 * (src/lib/pricing.ts, removed in T2 now that `/pricing` + `/app/billing`
 * read plans from here / `GET /api/v1/plans` instead) — that parity is
 * locked by a test in plans.test.ts.
 */
import type { PlanRow } from "@/types"

export const DEFAULT_PLANS: PlanRow[] = [
  {
    id: "free",
    name: "Free",
    priceIdr: 0,
    period: "month",
    tagline: "Untuk mencoba dan eksplorasi konsep awal.",
    featured: false,
    sortOrder: 0,
    active: true,
    features: [
      "1 project aktif",
      "Brief + 3 alternatif layout",
      "Editor denah 2D dasar",
      "3D preview sederhana",
      "RAB awal (estimasi)",
    ],
    limits: ["Watermark pada export", "Tanpa DXF/IFC"],
    entitlements: {
      creditsPerPeriod: 10,
      maxProjects: 1,
      exportPdf: false,
      glbUpload: false,
      aiRenderHd: false,
    },
  },
  {
    id: "pro",
    name: "Pro",
    priceIdr: 149000,
    period: "month",
    tagline: "Untuk yang serius menyiapkan diskusi dengan kontraktor.",
    featured: true,
    sortOrder: 1,
    active: true,
    features: [
      "Project tanpa batas",
      "Semua fitur Free",
      "Export Contractor Pack PDF",
      "Export DXF & IFC",
      "RAB Excel",
      "AI assistant penuh",
    ],
    limits: ["Tanpa watermark"],
    entitlements: {
      creditsPerPeriod: 100,
      maxProjects: 10,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    },
  },
  {
    id: "studio",
    name: "Studio",
    priceIdr: 499000,
    period: "month",
    tagline: "Untuk studio & kontraktor dengan banyak proyek.",
    featured: false,
    sortOrder: 2,
    active: true,
    features: [
      "Semua fitur Pro",
      "Kolaborasi tim",
      "Professional review priority",
      "Brand kustom pada export",
      "Dukungan prioritas",
    ],
    limits: [],
    entitlements: {
      creditsPerPeriod: 500,
      maxProjects: 50,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    },
  },
]
