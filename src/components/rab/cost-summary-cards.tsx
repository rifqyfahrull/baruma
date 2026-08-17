import { Banknote, Ruler, TrendingUp } from "lucide-react"

import type { Confidence, CostSummary } from "@/types"
import { formatArea, formatIDRCompact, formatIDRRange } from "@/lib/format"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const CONFIDENCE: Record<Confidence, { label: string; cls: string }> = {
  low: { label: "Rendah", cls: "border-warning/40 bg-warning/15 text-warning-foreground" },
  medium: { label: "Sedang", cls: "border-info/25 bg-info/10 text-info" },
  high: { label: "Tinggi", cls: "border-success/30 bg-success/12 text-success" },
}

export function CostSummaryCards({
  summary,
  areaM2,
}: {
  summary: CostSummary
  areaM2: number
}) {
  const conf = CONFIDENCE[summary.confidence]
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="lg:col-span-2 border-primary/30 bg-primary/5">
        <CardContent className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Banknote className="size-4" /> Estimasi biaya (tengah)
          </p>
          <p className="text-3xl font-semibold tracking-tight">
            {formatIDRCompact(summary.midIDR)}
          </p>
          <p className="text-sm text-muted-foreground">
            Kisaran {formatIDRRange(summary.lowIDR, summary.highIDR)}
          </p>
          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              conf.cls
            )}
          >
            Keyakinan: {conf.label}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <TrendingUp className="size-4" /> Biaya per m²
          </p>
          <p className="text-2xl font-semibold">
            {formatIDRCompact(summary.perM2IDR)}
          </p>
          <p className="text-sm text-muted-foreground">per meter persegi</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Ruler className="size-4" /> Luas bangunan
          </p>
          <p className="text-2xl font-semibold">{formatArea(areaM2)}</p>
          <p className="text-sm text-muted-foreground">total semua lantai</p>
        </CardContent>
      </Card>
    </div>
  )
}
