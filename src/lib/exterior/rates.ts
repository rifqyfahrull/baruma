import type { ExteriorElementKind } from "@/types"

export type ExteriorRate = {
  id: string
  kind: ExteriorElementKind
  unit: "m" | "m2" | "m3" | "unit"
  unitPriceIDR: number
  confidence: "low" | "medium" | "high"
  effectiveDate: string
}

/**
 * Concept-stage regional defaults. These are explicit rates, never inferred
 * from GLB bounding boxes. A project-specific catalog can replace them later
 * through `CostingPolicy.rateId` without changing quantity formulas.
 */
export const EXTERIOR_RATES: readonly ExteriorRate[] = [
  { id: "ext-boundary-wall-v1", kind: "boundary_wall", unit: "m2", unitPriceIDR: 850_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-fence-v1", kind: "fence", unit: "m", unitPriceIDR: 1_250_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-sliding-gate-v1", kind: "sliding_gate", unit: "unit", unitPriceIDR: 12_000_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-swing-gate-v1", kind: "swing_gate", unit: "unit", unitPriceIDR: 8_500_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-pedestrian-gate-v1", kind: "pedestrian_gate", unit: "unit", unitPriceIDR: 3_500_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-solid-wall-v1", kind: "solid_wall", unit: "m2", unitPriceIDR: 900_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-facade-panel-v1", kind: "facade_panel", unit: "m2", unitPriceIDR: 1_350_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-column-v1", kind: "column", unit: "m3", unitPriceIDR: 4_500_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-chimney-v1", kind: "chimney", unit: "m3", unitPriceIDR: 4_500_000, confidence: "low", effectiveDate: "2026-08-16" },
  { id: "ext-beam-v1", kind: "beam", unit: "m3", unitPriceIDR: 4_500_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-slab-v1", kind: "slab", unit: "m2", unitPriceIDR: 1_150_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-canopy-v1", kind: "canopy", unit: "m2", unitPriceIDR: 1_650_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-overhang-slab-v1", kind: "overhang_slab", unit: "m2", unitPriceIDR: 1_450_000, confidence: "low", effectiveDate: "2026-08-09" },
  { id: "ext-planter-v1", kind: "planter", unit: "m3", unitPriceIDR: 2_100_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-portal-v1", kind: "portal_frame", unit: "m3", unitPriceIDR: 4_800_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-stair-v1", kind: "exterior_stair", unit: "m2", unitPriceIDR: 2_400_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-stair-beton-v1", kind: "exterior_stair", unit: "m3", unitPriceIDR: 4_500_000, confidence: "low", effectiveDate: "2026-07-15" },
  { id: "ext-stair-finish-v1", kind: "exterior_stair", unit: "m2", unitPriceIDR: 350_000, confidence: "low", effectiveDate: "2026-07-15" },
  { id: "ext-driveway-v1", kind: "driveway", unit: "m2", unitPriceIDR: 650_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-walkway-v1", kind: "walkway", unit: "m2", unitPriceIDR: 550_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-terrace-v1", kind: "terrace_surface", unit: "m2", unitPriceIDR: 750_000, confidence: "low", effectiveDate: "2026-07-13" },
  { id: "ext-garden-bed-v1", kind: "garden_bed", unit: "m2", unitPriceIDR: 250_000, confidence: "low", effectiveDate: "2026-07-15" },
  { id: "ext-plant-v1", kind: "plant", unit: "unit", unitPriceIDR: 150_000, confidence: "low", effectiveDate: "2026-07-15" },
  { id: "ext-tree-v1", kind: "tree", unit: "unit", unitPriceIDR: 1_500_000, confidence: "low", effectiveDate: "2026-07-15" },
  { id: "ext-decor-v1", kind: "exterior_decor", unit: "unit", unitPriceIDR: 800_000, confidence: "low", effectiveDate: "2026-07-15" },
] as const

export function exteriorRateFor(
  kind: ExteriorElementKind,
  rateId?: string,
): ExteriorRate | undefined {
  if (rateId) return EXTERIOR_RATES.find((rate) => rate.id === rateId && rate.kind === kind)
  return EXTERIOR_RATES.find((rate) => rate.kind === kind)
}
