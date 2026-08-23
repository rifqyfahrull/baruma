"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { FileSpreadsheet, FileText, Info, Loader2, Pencil, RotateCcw, Save, X } from "lucide-react"
import { toast } from "sonner"

import { exportRabExcel, printRab } from "@/lib/rab/export-rab"

import type { BOQItem, FinishingLevel } from "@/types"
import { useBrief, useProject, useRAB, useSaveRAB, useResetRAB } from "@/lib/api/hooks"
import { usePageView } from "@/lib/analytics"
import { markOnboardingSeen } from "@/hooks/use-onboarding-progress"
import { COPY } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { CostSummaryCards } from "@/components/rab/cost-summary-cards"
import { FinishingLevelSelector } from "@/components/rab/finishing-level-selector"
import { CategoryBreakdown } from "@/components/rab/category-breakdown"
import { BOQTable } from "@/components/rab/boq-table"
import { EditableBOQTable } from "@/components/rab/editable-boq-table"
import { CostSavingSuggestions } from "@/components/rab/cost-saving-suggestions"

export default function RABPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const { data: brief } = useBrief(projectId)

  const [override, setOverride] = React.useState<FinishingLevel | null>(null)
  const finishing: FinishingLevel =
    override ?? brief?.building.finishingLevel ?? "menengah"

  const { data: rab, isLoading, isFetching } = useRAB(projectId, finishing)

  const [editMode, setEditMode] = React.useState(false)
  const [draft, setDraft] = React.useState<BOQItem[]>([])

  const saveRAB = useSaveRAB(projectId)
  const resetRAB = useResetRAB(projectId)

  usePageView("rab_opened", { project_id: projectId })
  // Checklist onboarding dashboard (WS-E §2) — tandai langkah "Cek estimasi RAB".
  React.useEffect(() => markOnboardingSeen("rab"), [])

  if (isLoading && !rab) return <RABSkeleton />
  if (!rab || !project) {
    return (
      <div className="p-6">
        <EmptyState
          title="RAB belum tersedia"
          description="Pilih salah satu alternatif layout dulu untuk menghitung estimasi biaya."
        />
      </div>
    )
  }

  // Narrow rab for closures — already guarded above.
  const safeRab = rab

  function enterEditMode() {
    setDraft(structuredClone(safeRab.items))
    setEditMode(true)
  }

  function cancelEdit() {
    setDraft([])
    setEditMode(false)
  }

  function handleSave() {
    saveRAB.mutate(
      { items: draft, areaM2: safeRab.areaM2, assumptions: safeRab.assumptions },
      {
        onSuccess: () => {
          toast.success("Harga manual disimpan.")
          setEditMode(false)
          setDraft([])
        },
        onError: () => {
          toast.error("Gagal menyimpan harga manual.")
        },
      }
    )
  }

  function handleReset() {
    resetRAB.mutate(undefined, {
      onSuccess: () => {
        toast.success("RAB dikembalikan ke estimasi otomatis.")
      },
      onError: () => {
        toast.error("Gagal mereset RAB.")
      },
    })
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">RAB / BOQ</h2>
            <p className="text-sm text-muted-foreground">
              {rab.manual
                ? "Menggunakan harga manual yang kamu tentukan."
                : "Estimasi biaya awal dihitung dari luas dan level finishing."}
            </p>
          </div>
          {rab.manual && (
            <Badge variant="secondary" className="shrink-0">
              Mode manual
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!rab.manual && !editMode && (
            <FinishingLevelSelector value={finishing} onChange={setOverride} />
          )}
          {rab.manual && !editMode && (
            <p className="text-xs text-muted-foreground">
              Reset ke otomatis untuk menggunakan FinishingLevel kembali.
            </p>
          )}
          {isFetching && !editMode && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <CostSummaryCards summary={rab.summary} areaM2={rab.areaM2} />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            exportRabExcel(rab, project).catch(() => toast.error("Gagal export Excel."))
          }}
        >
          <FileSpreadsheet /> Export Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => printRab(rab, project)}>
          <FileText /> Export PDF
        </Button>

        {!editMode && (
          <Button variant="outline" size="sm" onClick={enterEditMode}>
            <Pencil /> Harga manual
          </Button>
        )}

        {editMode && (
          <>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveRAB.isPending}
            >
              {saveRAB.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Simpan
            </Button>
            <Button variant="outline" size="sm" onClick={cancelEdit}>
              <X className="size-4" /> Batal
            </Button>
          </>
        )}

        {rab.manual && !editMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetRAB.isPending}
          >
            {resetRAB.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Reset ke otomatis
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <h3 className="text-sm font-semibold">Rincian BOQ</h3>
          {editMode ? (
            <EditableBOQTable items={draft} onChange={setDraft} />
          ) : (
            <BOQTable items={rab.items} />
          )}
        </div>

        <div className="space-y-4">
          <CategoryBreakdown items={editMode ? draft : rab.items} />
          {!rab.manual && !editMode && (
            <CostSavingSuggestions
              items={rab.items}
              midIDR={rab.summary.midIDR}
              project={project}
              finishing={finishing}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Asumsi</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {rab.assumptions.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary">•</span>
                    {a}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Alert>
        <Info className="size-4 text-info" />
        <AlertTitle>Estimasi awal untuk diskusi</AlertTitle>
        <AlertDescription>{COPY.draftNotice}</AlertDescription>
      </Alert>
    </div>
  )
}

function RABSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  )
}
