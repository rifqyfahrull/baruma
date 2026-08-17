import { AlertTriangle, Info, ShieldAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import type { RiskBadge as RiskBadgeType, Severity } from "@/types"

const severityClasses: Record<Severity, string> = {
  info: "border-info/25 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/20 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
}

const severityIcon = {
  info: Info,
  warning: AlertTriangle,
  danger: ShieldAlert,
} as const

export function RiskBadge({
  level,
  label,
  className,
}: {
  level: Severity
  label: string
  className?: string
}) {
  const Icon = severityIcon[level]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium",
        severityClasses[level],
        className
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

export function RiskBadgeGroup({
  risks,
  className,
}: {
  risks: RiskBadgeType[]
  className?: string
}) {
  if (risks.length === 0) return null
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {risks.map((r, i) => (
        <RiskBadge key={`${r.label}-${i}`} level={r.level} label={r.label} />
      ))}
    </div>
  )
}
