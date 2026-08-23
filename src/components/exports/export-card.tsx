"use client"

import * as React from "react"
import Link from "next/link"
import {
  Armchair,
  Box,
  Boxes,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Loader2,
  Lock,
  PenTool,
  Ruler,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import type { Entitlements, ExportFormat, Plan, ReadinessStatus } from "@/types"
import { EXPORT_META } from "@/lib/constants"
import { formatRelative } from "@/lib/format"
import { track } from "@/lib/analytics"
import { exportJobKey, triggerDownload, useExportStore } from "@/stores/export-store"
import { usePreviewStore } from "@/stores/preview-store"
import { ReadinessBadge } from "@/components/shared/readiness-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

const ICONS: Record<ExportFormat, typeof FileText> = {
  contractor_pack: FileText,
  interior_pack: Armchair,
  drawings_pack: Ruler,
  dxf: PenTool,
  ifc: Boxes,
  glb: Box,
  rab_excel: FileSpreadsheet,
  zip_all: FileArchive,
}

export function ExportCard({
  format,
  readiness,
  entitlements,
  projectId,
  extraAction,
}: {
  format: ExportFormat
  readiness: ReadinessStatus
  plan: Plan
  entitlements?: Entitlements | null
  projectId: string
  projectName: string
  extraAction?: React.ReactNode
}) {
  const meta = EXPORT_META[format]
  const Icon = ICONS[format]
  // Client-only gate (no server export route — accepted v1 limitation,
  // bypassable via devtools; see spec §Enforcement / plan Global Constraints).
  // Missing/null entitlements defaults to locked, never to free access.
  const locked = meta.proOnly && !entitlements?.exportPdf
  // IFC (G2, needs web-ifc) — only relevant once a user is actually unlocked;
  // a locked user already sees the Pro upsell below, never a Buat that errors.
  const comingSoon = !!meta.comingSoon
  // Free plan (no exportPdf) → every generated PDF gets a draft watermark.
  const watermark = !entitlements?.exportPdf

  const job = useExportStore((s) => s.jobs[exportJobKey(projectId, format)])
  const generate = useExportStore((s) => s.generate)
  const downloadJob = useExportStore((s) => s.download)

  const processing = job?.status === "processing"
  const completed = job?.status === "completed"
  const hasError = job?.status === "error"

  // Auto-download once when job flips to completed
  const wasCompleted = React.useRef(false)
  React.useEffect(() => {
    if (completed && !wasCompleted.current) {
      wasCompleted.current = true
      track("export_completed", { project_id: projectId, format })
      if (job?.blobUrl && job.filename) {
        triggerDownload(job.blobUrl, job.filename)
        toast.success(`${meta.title} siap diunduh.`)
      }
    }
    if (!completed) wasCompleted.current = false
  }, [completed, job?.blobUrl, job?.filename, projectId, format, meta.title])

  // Show error toast when job fails
  const prevError = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    if (hasError && job?.error && job.error !== prevError.current) {
      prevError.current = job.error
      toast.error(job.error)
    }
    if (!hasError) prevError.current = undefined
  }, [hasError, job?.error])

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          {locked ? (
            <Badge variant="secondary" className="gap-1">
              <Lock className="size-3" /> Pro
            </Badge>
          ) : comingSoon ? (
            <Badge variant="secondary">Segera hadir</Badge>
          ) : (
            <ReadinessBadge status={readiness} size="sm" showDot={false} />
          )}
        </div>
        <h3 className="mt-3 font-semibold">{meta.title}</h3>
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </CardHeader>

      <CardContent className="flex-1 space-y-2">
        <Explain label="Untuk" value={meta.audience} />
        <Explain label="Dibuka dengan" value={meta.opensWith} />
        <Explain label="Kapan dipakai" value={meta.whenToUse} />
        <Explain label="Batasan" value={meta.limitation} muted />

        {processing && (
          <div className="space-y-1 pt-1">
            <Progress value={job.progress} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              Membuat… {Math.round(job.progress)}%
            </p>
          </div>
        )}
        {completed && job.lastGeneratedAt && (
          <p className="pt-1 text-xs text-muted-foreground">
            Dibuat {formatRelative(job.lastGeneratedAt)} · {job.fileSize}
          </p>
        )}
        {hasError && job.error && (
          <p className="pt-1 text-xs text-destructive">{job.error}</p>
        )}
      </CardContent>

      <CardFooter className="flex-wrap gap-2 border-t pt-3">
        {locked ? (
          <Button asChild variant="outline" className="w-full">
            <Link
              href="/app/billing"
              onClick={() =>
                track("upgrade_clicked", { source: "export_lock", format })
              }
            >
              <Sparkles className="text-warning" /> Upgrade untuk akses
            </Link>
          </Button>
        ) : comingSoon ? (
          <Button size="sm" variant="outline" disabled className="w-full">
            Segera hadir
          </Button>
        ) : (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant={completed ? "outline" : "default"}
                  size="sm"
                  disabled={processing}
                  className="flex-1"
                >
                  {processing ? (
                    <>
                      <Loader2 className="animate-spin" /> Membuat…
                    </>
                  ) : completed ? (
                    "Buat ulang"
                  ) : hasError ? (
                    "Coba lagi"
                  ) : (
                    "Generate"
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sebelum membuat file</AlertDialogTitle>
                  <AlertDialogDescription>
                    Dokumen ini adalah draft desain awal untuk diskusi. Belum
                    dapat digunakan sebagai gambar kerja final sebelum ditinjau
                    tenaga ahli.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      track("export_started", { project_id: projectId, format })
                      // Only meaningful for contractor_pack, and only when the
                      // 3D canvas happens to be mounted (a different route
                      // usually — see ContractorPackOpts.thumbnailDataUrl).
                      const thumbnailDataUrl =
                        format === "contractor_pack"
                          ? (usePreviewStore.getState().captureFrame?.() ?? undefined)
                          : undefined
                      void generate(projectId, format, { watermark, thumbnailDataUrl })
                    }}
                  >
                    Saya mengerti, lanjut
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              size="sm"
              variant="secondary"
              disabled={!completed || !job?.blobUrl}
              onClick={() => {
                downloadJob(projectId, format)
                track("export_downloaded", { project_id: projectId, format })
              }}
            >
              <Download /> Download
            </Button>
          </>
        )}
        {extraAction}
      </CardFooter>
    </Card>
  )
}

function Explain({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <p className="text-xs leading-relaxed">
      <span className="font-medium text-foreground">{label}: </span>
      <span className={muted ? "text-warning-foreground" : "text-muted-foreground"}>
        {value}
      </span>
    </p>
  )
}
