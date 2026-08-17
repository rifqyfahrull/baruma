import { Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

function toneFor(score: number) {
  if (score >= 85) return "border-success/30 bg-success/12 text-success"
  if (score >= 75) return "border-info/25 bg-info/10 text-info"
  return "border-warning/40 bg-warning/20 text-warning-foreground"
}

export function ScoreBadge({
  score,
  className,
}: {
  score: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
        toneFor(score),
        className
      )}
    >
      <Sparkles className="size-3" aria-hidden />
      {score}
    </span>
  )
}
