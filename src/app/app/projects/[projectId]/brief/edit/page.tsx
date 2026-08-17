"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, FileText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { EditBriefWizard } from "@/components/wizard/edit-brief-wizard"
import { useBrief, useProject } from "@/lib/api/hooks"
import { briefToFormValues } from "@/lib/brief/brief-to-form"

export default function EditBriefPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: brief, isLoading: briefLoading } = useBrief(projectId)
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const isLoading = briefLoading || projectLoading

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6 space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/app/projects/${projectId}/brief`}>
            <ArrowLeft />
            Kembali ke brief
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Edit brief</h1>
          <p className="text-sm text-muted-foreground">
            Ubah data tanah, bangunan, dan kebutuhan ruang. Ringkasan, asumsi,
            batasan, dan catatan risiko otomatis diperbarui.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : !brief || !project ? (
        <EmptyState
          icon={FileText}
          title="Brief belum tersedia"
          description="Brief untuk proyek ini belum dibuat."
          action={
            <Button asChild variant="outline">
              <Link href="/app">Kembali ke daftar proyek</Link>
            </Button>
          }
        />
      ) : (
        <EditBriefWizard
          projectId={projectId}
          initialValues={briefToFormValues(brief, project)}
        />
      )}
    </div>
  )
}
