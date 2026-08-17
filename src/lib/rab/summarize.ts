/**
 * Pure helpers for recomputing and summarizing a manual RAB.
 * No React imports — safe to use from server and client.
 */
import type { BOQItem, CostSummary } from "@/types"

export function round1k(n: number): number {
  return Math.round(n / 1000) * 1000
}

export function summarizeRab(
  items: BOQItem[],
  areaM2: number
): { items: BOQItem[]; summary: CostSummary } {
  const recomputed: BOQItem[] = items.map((it) => ({
    ...it,
    totalIDR: round1k(it.unitPriceIDR * it.volume),
  }))

  const mid = recomputed.reduce((sum, it) => sum + it.totalIDR, 0)
  const area = areaM2 || 1

  const summary: CostSummary = {
    lowIDR: round1k(mid * 0.88),
    midIDR: round1k(mid),
    highIDR: round1k(mid * 1.15),
    perM2IDR: round1k(mid / area),
    confidence: recomputed.some((i) => i.confidence === "low") ? "low" : "medium",
  }

  return { items: recomputed, summary }
}
