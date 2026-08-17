import { CircleCheck, ShieldAlert, TriangleAlert } from "lucide-react"

import type { Review } from "@/types"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function ValidationSummary({ review }: { review: Review }) {
  const active = review.warnings.filter(
    (w) => !review.resolvedWarningIds.includes(w.id)
  )
  const danger = active.filter((w) => w.level === "danger").length
  const warning = active.filter((w) => w.level === "warning").length
  const info = active.filter((w) => w.level === "info").length
  const resolved = review.resolvedWarningIds.length

  const status =
    danger > 0
      ? { label: "Belum valid", cls: "text-destructive", Icon: ShieldAlert }
      : warning > 0
        ? { label: "Perlu perhatian", cls: "text-warning-foreground", Icon: TriangleAlert }
        : { label: "Tidak ada peringatan besar", cls: "text-success", Icon: CircleCheck }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className={cn("grid size-11 place-items-center rounded-full bg-muted", status.cls)}>
            <status.Icon className="size-5" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Status validasi</p>
            <p className={cn("text-lg font-semibold", status.cls)}>{status.label}</p>
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <Stat value={danger} label="Risiko" cls="text-destructive" />
          <Stat value={warning} label="Perhatian" cls="text-warning-foreground" />
          <Stat value={info} label="Saran" cls="text-info" />
          <Stat value={resolved} label="Teratasi" cls="text-success" />
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ value, label, cls }: { value: number; label: string; cls: string }) {
  return (
    <div className="text-center">
      <p className={cn("text-xl font-semibold tabular-nums", cls)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
