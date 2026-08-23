"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { GitCompare, LayoutGrid, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { AlternativeCard } from "@/components/alternative/alternative-card"
import { EmptyState } from "@/components/shared/empty-state"
import { ReadinessBadge } from "@/components/shared/readiness-badge"
import { ScoreBadge } from "@/components/shared/score-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useAlternatives,
  useGenerateAlternatives,
  useSelectAlternative,
} from "@/lib/api/hooks"
import { handlePlanError } from "@/lib/api/plan-error"
import { formatArea, formatIDRRange } from "@/lib/format"
import { track } from "@/lib/analytics"
import { cn } from "@/lib/utils"

export default function AlternativesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()

  const { data: alts, isLoading } = useAlternatives(projectId)
  const gen = useGenerateAlternatives(projectId)
  const select = useSelectAlternative(projectId)

  const [compare, setCompare] = useState(false)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  async function handleGenerate() {
    try {
      await gen.mutateAsync()
      track("alternatives_generated", { project_id: projectId })
    } catch (e) {
      if (!handlePlanError(e)) {
        toast.error("Gagal menyusun alternatif. Coba lagi sebentar.")
      }
    }
  }

  async function handleSelect(id: string) {
    setSelectingId(id)
    try {
      await select.mutateAsync(id)
      track("alternative_selected", { project_id: projectId, alternative_id: id })
      toast.success("Layout dipilih. Membuka editor denah…")
      router.push(`/app/projects/${projectId}/editor`)
    } catch {
      toast.error("Gagal memilih layout. Coba lagi sebentar.")
      setSelectingId(null)
    }
  }

  const hasAlts = !!alts && alts.length > 0

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Alternatif Layout
          </h2>
          <p className="text-sm text-muted-foreground">
            Bandingkan opsi yang disusun AI, lalu pilih yang paling cocok.
          </p>
        </div>

        {hasAlts && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={compare ? "secondary" : "outline"}
              onClick={() => setCompare((v) => !v)}
            >
              <GitCompare className="size-4" aria-hidden />
              Bandingkan
            </Button>
            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={gen.isPending}
            >
              <RefreshCw
                className={cn("size-4", gen.isPending && "animate-spin")}
                aria-hidden
              />
              {gen.isPending ? "Menyusun..." : "Regenerate — 1 kredit"}
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-full rounded-xl" />
          ))}
        </div>
      ) : !hasAlts ? (
        <EmptyState
          icon={LayoutGrid}
          title="Belum ada alternatif"
          description="Susun 3 alternatif layout dari brief kamu."
          action={
            <Button onClick={handleGenerate} disabled={gen.isPending}>
              <LayoutGrid className="size-4" aria-hidden />
              {gen.isPending ? "Menyusun..." : "Generate Alternatif"}
            </Button>
          }
        />
      ) : compare ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[8rem]">Atribut</TableHead>
                {alts.map((alt) => (
                  <TableHead key={alt.id} className="min-w-[10rem]">
                    {alt.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Nama
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id} className="font-medium">
                    {alt.name}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Skor
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id}>
                    <ScoreBadge score={alt.score} />
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Luas
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id}>{formatArea(alt.areaM2)}</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Jumlah ruang
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id}>{alt.roomCount} ruang</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Lantai
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id}>{alt.floors} lantai</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Estimasi biaya
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id} className="font-semibold">
                    {formatIDRRange(
                      alt.estimatedCost.minIDR,
                      alt.estimatedCost.maxIDR
                    )}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Kesiapan
                </TableCell>
                {alts.map((alt) => (
                  <TableCell key={alt.id}>
                    <ReadinessBadge status={alt.readiness} size="sm" />
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {alts.map((alt) => (
            <AlternativeCard
              key={alt.id}
              alternative={alt}
              onSelect={handleSelect}
              selecting={selectingId === alt.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
