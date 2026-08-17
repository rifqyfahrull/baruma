"use client"

import { useParams } from "next/navigation"
import { TriangleAlert } from "lucide-react"

import type { ExportFormat } from "@/types"
import { useCurrentUser, useProject } from "@/lib/api/hooks"
import { COPY } from "@/lib/constants"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { ExportCard } from "@/components/exports/export-card"
import { ContractorPackPreview } from "@/components/exports/contractor-pack-preview"

const ORDER: ExportFormat[] = [
  "contractor_pack",
  "interior_pack",
  "drawings_pack",
  "glb",
  "rab_excel",
  "dxf",
  "ifc",
  "zip_all",
]

export default function ExportsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project, isLoading } = useProject(projectId)
  const { data: user } = useCurrentUser()
  const plan = user?.plan ?? "free"

  if (isLoading) return <ExportsSkeleton />
  if (!project) {
    return (
      <div className="p-6">
        <EmptyState
          title="Export belum tersedia"
          description="Pilih salah satu alternatif layout dulu sebelum meng-export."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Export</h2>
        <p className="text-sm text-muted-foreground">
          Hasilkan file untuk dibawa ke kontraktor, drafter, atau tim teknis.
        </p>
      </div>

      <Alert>
        <TriangleAlert className="size-4 text-warning" />
        <AlertTitle>File ini adalah draft awal</AlertTitle>
        <AlertDescription>{COPY.draftNotice}</AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((format) => (
          <ExportCard
            key={format}
            format={format}
            readiness={project.readiness}
            plan={plan}
            entitlements={user?.entitlements}
            projectId={projectId}
            projectName={project.name}
            extraAction={
              format === "contractor_pack" ? (
                <ContractorPackPreview
                  projectName={project.name}
                  location={project.location}
                  thumbnail={project.thumbnail}
                  readiness={project.readiness}
                />
              ) : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

function ExportsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full" />
        ))}
      </div>
    </div>
  )
}
