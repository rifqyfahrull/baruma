"use client"

import {
  AlertTriangle,
  Building2,
  Home,
  Info,
  Layers,
  MapPin,
  Ruler,
  Sparkles,
  Wallet,
} from "lucide-react"

import {
  FINISHING_LEVELS,
  HOUSE_STYLES,
  PRIORITIES,
  ROOM_TYPES,
} from "@/lib/constants"
import { formatArea, formatIDRRange, formatNumber } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { WizardForm } from "../types"

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Home
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  )
}

export function StepSummary({ form }: { form: WizardForm }) {
  const v = form.watch()
  const area =
    Number.isFinite(v.widthM) && Number.isFinite(v.depthM)
      ? v.widthM * v.depthM
      : 0
  const hasPool = (v.rooms ?? []).some((r) => r.roomType === "kolam")
  const narrow = v.widthM < 7 || (v.sidesAttached ?? 0) > 0

  const risks: { level: "info" | "warning"; text: string }[] = []
  if (v.floors >= 3)
    risks.push({
      level: "warning",
      text: `Bangunan ${v.floors} lantai perlu ditinjau engineer struktur.`,
    })
  if (hasPool)
    risks.push({
      level: "warning",
      text: "Kolam menambah beban & kebutuhan waterproofing — perlu review struktur.",
    })
  if (v.rooftop)
    risks.push({
      level: "info",
      text: "Pastikan beban rooftop dan railing pengaman sesuai standar.",
    })
  if (narrow)
    risks.push({
      level: "info",
      text: "Lahan sempit/menempel tetangga — pertimbangkan void atau skylight.",
    })

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat icon={Home} label="Nama project" value={v.name || "—"} />
        <Stat icon={MapPin} label="Lokasi" value={v.city || "—"} />
        <Stat
          icon={Ruler}
          label="Tanah"
          value={
            area > 0
              ? `${formatNumber(v.widthM)} × ${formatNumber(v.depthM)} m · ${formatArea(area)}`
              : "—"
          }
        />
        <Stat
          icon={Layers}
          label="Bangunan"
          value={`${v.floors} lantai${v.rooftop ? " + rooftop" : ""}`}
        />
        <Stat
          icon={Wallet}
          label="Budget"
          value={formatIDRRange(v.budgetMinIDR || 0, v.budgetMaxIDR || 0)}
        />
        <Stat
          icon={Building2}
          label="Gaya & finishing"
          value={`${HOUSE_STYLES[v.style]} · ${FINISHING_LEVELS[v.finishingLevel].label}`}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Prioritas</p>
        <div className="flex flex-wrap gap-2">
          {(v.priorities ?? []).length > 0 ? (
            v.priorities.map((p) => (
              <Badge key={p} variant="secondary">
                {PRIORITIES[p]}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">
              Belum ada prioritas dipilih.
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Ruang yang diminta ({(v.rooms ?? []).length})
        </p>
        <div className="flex flex-wrap gap-2">
          {(v.rooms ?? []).map((r, i) => (
            <Badge key={`${r.roomType}-${i}`} variant="outline">
              {ROOM_TYPES[r.roomType].label}
              {r.quantity > 1 ? ` ×${r.quantity}` : ""}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Catatan AI awal
        </p>
        {risks.length > 0 ? (
          <div className="space-y-2">
            {risks.map((r, i) => (
              <Alert key={i} className="bg-card">
                {r.level === "warning" ? (
                  <AlertTriangle className="size-4 text-warning" />
                ) : (
                  <Info className="size-4 text-info" />
                )}
                <AlertTitle className="text-sm">
                  {r.level === "warning" ? "Perlu perhatian" : "Saran"}
                </AlertTitle>
                <AlertDescription>{r.text}</AlertDescription>
              </Alert>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Tidak ada catatan risiko menonjol dari input kamu.
          </p>
        )}
      </div>
    </div>
  )
}
