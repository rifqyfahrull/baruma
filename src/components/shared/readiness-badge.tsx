import { cn } from "@/lib/utils"
import { READINESS, type ReadinessTone } from "@/lib/constants"
import type { ReadinessStatus } from "@/types"

const toneClasses: Record<ReadinessTone, string> = {
  info: "border-info/25 bg-info/10 text-info",
  success: "border-success/30 bg-success/12 text-success",
  warning: "border-warning/40 bg-warning/20 text-warning-foreground",
  emerald: "border-success/40 bg-success/15 text-success",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
}

const dotClasses: Record<ReadinessTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  emerald: "bg-success",
  danger: "bg-destructive",
}

export function ReadinessBadge({
  status,
  size = "default",
  showDot = true,
  className,
}: {
  status: ReadinessStatus
  size?: "sm" | "default"
  showDot?: boolean
  className?: string
}) {
  const meta = READINESS[status]
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[0.7rem]" : "px-2.5 py-1 text-xs",
        toneClasses[meta.tone],
        className
      )}
    >
      {showDot && (
        <span
          className={cn("size-1.5 rounded-full", dotClasses[meta.tone])}
          aria-hidden
        />
      )}
      {meta.label}
    </span>
  )
}
