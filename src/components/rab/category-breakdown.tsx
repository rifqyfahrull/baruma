import type { BOQItem, CostCategory } from "@/types"
import { COST_CATEGORIES } from "@/lib/constants"
import { formatIDRCompact } from "@/lib/format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const CAT_COLOR: Record<CostCategory, string> = {
  struktur: "bg-chart-1",
  arsitektur: "bg-chart-3",
  finishing: "bg-chart-2",
  plumbing: "bg-chart-4",
  listrik: "bg-warning",
  kolam: "bg-info",
  rooftop: "bg-success",
  furnishing: "bg-chart-5",
}

export function CategoryBreakdown({ items }: { items: BOQItem[] }) {
  const byCat = new Map<CostCategory, number>()
  for (const it of items) {
    byCat.set(it.category, (byCat.get(it.category) ?? 0) + it.totalIDR)
  }
  const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  const max = rows[0]?.[1] ?? 1
  const grandTotal = rows.reduce((s, [, v]) => s + v, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Biaya per kategori</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([cat, total]) => (
          <div key={cat} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", CAT_COLOR[cat])} />
                {COST_CATEGORIES[cat]}
              </span>
              <span className="font-medium tabular-nums">
                {formatIDRCompact(total)}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {Math.round((total / grandTotal) * 100)}%
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", CAT_COLOR[cat])}
                style={{ width: `${(total / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
