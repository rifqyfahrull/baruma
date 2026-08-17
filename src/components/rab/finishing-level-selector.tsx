"use client"

import type { FinishingLevel } from "@/types"
import { FINISHING_LEVELS } from "@/lib/constants"
import { formatIDRCompact } from "@/lib/format"
import { cn } from "@/lib/utils"

const ORDER: FinishingLevel[] = ["standar", "menengah", "premium"]

export function FinishingLevelSelector({
  value,
  onChange,
}: {
  value: FinishingLevel
  onChange: (v: FinishingLevel) => void
}) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-1">
      {ORDER.map((lvl) => {
        const meta = FINISHING_LEVELS[lvl]
        const active = value === lvl
        return (
          <button
            key={lvl}
            type="button"
            onClick={() => onChange(lvl)}
            className={cn(
              "flex flex-col items-center rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <span className="font-medium">{meta.label}</span>
            <span
              className={cn(
                "text-[0.7rem]",
                active ? "text-primary-foreground/90" : "text-muted-foreground"
              )}
            >
              {formatIDRCompact(meta.perM2IDR)}/m²
            </span>
          </button>
        )
      })}
    </div>
  )
}
