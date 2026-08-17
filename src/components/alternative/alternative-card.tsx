"use client"

import { Check, Minus } from "lucide-react"

import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { ReadinessBadge } from "@/components/shared/readiness-badge"
import { RiskBadgeGroup } from "@/components/shared/risk-badge"
import { ScoreBadge } from "@/components/shared/score-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { formatArea, formatIDRRange } from "@/lib/format"
import type { Alternative } from "@/types"

export function AlternativeCard({
  alternative,
  onSelect,
  selecting = false,
}: {
  alternative: Alternative
  onSelect: (id: string) => void
  selecting?: boolean
}) {
  return (
    <Card className="overflow-hidden pt-0">
      <LayoutThumbnail
        variant={alternative.thumbnail}
        label={alternative.name}
        className="aspect-[16/10] w-full rounded-none border-b"
      />

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight">{alternative.name}</h3>
            <ScoreBadge score={alternative.score} />
          </div>
          <p className="text-sm text-muted-foreground">
            {alternative.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{alternative.floors} lantai</span>
          <span>{formatArea(alternative.areaM2)}</span>
          <span>{alternative.roomCount} ruang</span>
        </div>

        <p className="font-semibold">
          {formatIDRRange(
            alternative.estimatedCost.minIDR,
            alternative.estimatedCost.maxIDR
          )}
        </p>

        {alternative.keyFeatures.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {alternative.keyFeatures.slice(0, 3).map((feature) => (
              <Badge key={feature} variant="secondary">
                {feature}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {alternative.pros.length > 0 && (
            <ul className="space-y-1.5">
              {alternative.pros.map((pro) => (
                <li
                  key={pro}
                  className="flex items-start gap-1.5 text-sm text-foreground"
                >
                  <Check
                    className="mt-0.5 size-3.5 shrink-0 text-success"
                    aria-hidden
                  />
                  <span>{pro}</span>
                </li>
              ))}
            </ul>
          )}
          {alternative.cons.length > 0 && (
            <ul className="space-y-1.5">
              {alternative.cons.map((con) => (
                <li
                  key={con}
                  className="flex items-start gap-1.5 text-sm text-muted-foreground"
                >
                  <Minus
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span>{con}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ReadinessBadge status={alternative.readiness} size="sm" />
          <RiskBadgeGroup risks={alternative.risks} />
        </div>
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          disabled={selecting}
          onClick={() => onSelect(alternative.id)}
        >
          {selecting ? "Memilih..." : "Pilih layout ini"}
        </Button>
      </CardFooter>
    </Card>
  )
}
