"use client"

import { Check, Info, ShieldAlert, TriangleAlert, Undo2 } from "lucide-react"

import type { Review, RiskCategory, Severity } from "@/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  structural: "Struktur",
  spatial: "Tata ruang",
  cost: "Biaya",
  legal: "Legal & perizinan",
  general: "Umum",
}

const SEV_ICON: Record<Severity, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: ShieldAlert,
}
const SEV_COLOR: Record<Severity, string> = {
  info: "text-info",
  warning: "text-warning",
  danger: "text-destructive",
}

export function WarningList({
  review,
  onToggle,
}: {
  review: Review
  onToggle: (id: string) => void
}) {
  const cats = [...new Set(review.warnings.map((w) => w.category))]

  return (
    <div className="space-y-5">
      {cats.map((cat) => {
        const items = review.warnings.filter((w) => w.category === cat)
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-sm font-semibold">{CATEGORY_LABEL[cat]}</h3>
            <ul className="space-y-2">
              {items.map((w) => {
                const resolved = review.resolvedWarningIds.includes(w.id)
                const Icon = SEV_ICON[w.level]
                return (
                  <li
                    key={w.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3",
                      resolved && "bg-muted/40 opacity-70"
                    )}
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        resolved ? "text-success" : SEV_COLOR[w.level]
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          resolved && "line-through"
                        )}
                      >
                        {w.title}
                      </p>
                      <p className="text-sm text-muted-foreground">{w.message}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => onToggle(w.id)}
                    >
                      {resolved ? (
                        <>
                          <Undo2 /> Buka lagi
                        </>
                      ) : (
                        <>
                          <Check /> Teratasi
                        </>
                      )}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
