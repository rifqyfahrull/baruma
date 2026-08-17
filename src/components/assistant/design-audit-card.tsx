"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, ShieldCheck, Wand2 } from "lucide-react"

import type { Project } from "@/types"
import { auditDesign, type AuditFinding, type AuditSeverity } from "@/lib/audit/design-audit"
import { useEditorStore } from "@/stores/editor-store"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/**
 * Proactive, always-visible design-standards health for the editor. Runs the
 * pure audit engine on the LIVE store layout (so it reflects unsaved edits,
 * unlike the server /audit endpoint) and surfaces the score, the top findings
 * with their SNI citation + fix, and one-tap "perbaiki…" buttons that hand the
 * instruction to the assistant. No LLM, no credits — recomputed on every edit.
 */
export function DesignAuditCard({
  project,
  onFix,
}: {
  project: Pick<Project, "floors" | "rooftop" | "readiness" | "site">
  onFix: (instruction: string) => void
}) {
  const layout = useEditorStore((s) => s.layout)
  const audit = React.useMemo(
    () => (layout && layout.rooms.length > 0 ? auditDesign({ project, layout }) : null),
    [layout, project],
  )
  const [open, setOpen] = React.useState(false)

  // Marker status done/undone: temuan yang PERNAH terlihat lalu hilang dari
  // audit (karena diperbaiki — manual maupun via "Perbaiki semua") ditandai ✓
  // dan tetap ditampilkan tercoret, alih-alih lenyap diam-diam.
  const [resolved, setResolved] = React.useState<Map<string, AuditFinding>>(new Map())
  const prevIdsRef = React.useRef<Map<string, AuditFinding>>(new Map())
  React.useEffect(() => {
    if (!audit) return
    const currentIds = new Set(audit.findings.map((f) => f.id))
    setResolved((prev) => {
      let next: Map<string, AuditFinding> | null = null
      // Temuan sebelumnya yang kini hilang → resolved.
      for (const [id, f] of prevIdsRef.current) {
        if (!currentIds.has(id) && !prev.has(id)) {
          next ??= new Map(prev)
          next.set(id, f)
        }
      }
      // Temuan yang muncul KEMBALI → bukan resolved lagi.
      for (const id of currentIds) {
        if (prev.has(id)) {
          next ??= new Map(prev)
          next.delete(id)
        }
      }
      return next ?? prev
    })
    prevIdsRef.current = new Map(audit.findings.map((f) => [f.id, f]))
  }, [audit])

  if (!audit) return null

  const tone = audit.score >= 80 ? "good" : audit.score >= 60 ? "warn" : "bad"
  const hasRoomSize = audit.findings.some((f) => f.id.startsWith("ruang-area:"))
  const hasDaylight = audit.findings.some((f) => f.category === "cahaya")
  const hasSanitasi = audit.findings.some((f) => f.category === "sanitasi" && f.severity === "critical")
  const anyFixable = hasRoomSize || hasDaylight || hasSanitasi

  return (
    <div className="border-b bg-muted/30 px-3 py-2.5 text-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            aria-label="Buka detail cek standar desain"
          >
            <ShieldCheck className={cn("size-4 shrink-0", TONE_TEXT[tone])} />
            <span className="font-medium">Cek Standar</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                TONE_BADGE[tone],
              )}
            >
              {audit.score}/100
            </span>
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              {audit.findings.length > 0 ? `${audit.findings.length} temuan` : "sesuai"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </span>
          </button>
        </CollapsibleTrigger>

        <p className="mt-1.5 text-xs text-muted-foreground">{audit.summary}</p>

        {anyFixable && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onFix("perbaiki semua")}>
              <Wand2 className="size-3.5" />
              Perbaiki semua
            </Button>
            {hasRoomSize && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onFix("perbaiki ukuran ruang")}>
                Ukuran
              </Button>
            )}
            {hasDaylight && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onFix("perbaiki cahaya")}>
                Cahaya
              </Button>
            )}
            {hasSanitasi && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onFix("perbaiki sanitasi")}>
                Sanitasi
              </Button>
            )}
          </div>
        )}

        <CollapsibleContent>
          {/* Semua temuan tampil — list-nya scroll sendiri, tidak memakan panel. */}
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
            {audit.findings.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
            {[...resolved.values()].map((f) => (
              <FindingRow key={`done-${f.id}`} finding={f} done />
            ))}
          </ul>
          {resolved.size > 0 && (
            <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              ✓ {resolved.size} temuan sudah beres di sesi ini.
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function FindingRow({ finding, done = false }: { finding: AuditFinding; done?: boolean }) {
  return (
    <li className={cn("rounded-md border bg-background p-2 text-xs", done && "opacity-70")}>
      <div className="flex items-start gap-1.5">
        {done ? (
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Sudah beres" />
        ) : (
          <span className={cn("mt-1 size-2 shrink-0 rounded-full", DOT[finding.severity])} aria-hidden />
        )}
        <div className="min-w-0">
          <p className={cn("font-medium", done && "line-through decoration-emerald-500/60")}>{finding.title}</p>
          {finding.standard && <p className="text-[11px] text-muted-foreground">{finding.standard}</p>}
          {!done && finding.fix && <p className="mt-0.5 text-muted-foreground">→ {finding.fix}</p>}
        </div>
      </div>
    </li>
  )
}

const TONE_TEXT = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
} as const

const TONE_BADGE = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  bad: "bg-destructive/15 text-destructive",
} as const

const DOT: Record<AuditSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  advisory: "bg-sky-500",
}
