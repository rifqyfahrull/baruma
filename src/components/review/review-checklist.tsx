"use client"

import type { Review, ReviewChecklistItem, ReviewRole } from "@/types"
import { REVIEW_ROLES } from "@/lib/constants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const STATUS_OPTS: { value: ReviewChecklistItem["status"]; label: string }[] = [
  { value: "pending", label: "Belum" },
  { value: "reviewed", label: "Sudah ditinjau" },
  { value: "not_required", label: "Tidak perlu" },
]

export function ReviewChecklist({
  review,
  onSet,
}: {
  review: Review
  onSet: (role: ReviewRole, status: ReviewChecklistItem["status"]) => void
}) {
  const applicable = review.checklist.filter((c) => c.status !== "not_required")
  const reviewed = review.checklist.filter((c) => c.status === "reviewed").length
  const pct = applicable.length ? (reviewed / applicable.length) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Checklist review profesional</CardTitle>
        <div className="space-y-1 pt-1">
          <Progress value={pct} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            {reviewed} dari {applicable.length} tenaga ahli sudah meninjau
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {review.checklist.map((item) => (
          <div key={item.role} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{REVIEW_ROLES[item.role]}</span>
              <Select
                value={item.status}
                onValueChange={(v) =>
                  onSet(item.role, v as ReviewChecklistItem["status"])
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-36"
                  aria-label={`Status review ${REVIEW_ROLES[item.role]}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
