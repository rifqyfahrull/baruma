"use client"

import { useParams } from "next/navigation"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import {
  useAddComment,
  useProject,
  useReview,
  useSetChecklist,
  useToggleComment,
  useToggleWarning,
} from "@/lib/api/hooks"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { ValidationSummary } from "@/components/review/validation-summary"
import { WarningList } from "@/components/review/warning-list"
import { ReviewChecklist } from "@/components/review/review-checklist"
import { CommentThread } from "@/components/review/comment-thread"
import { ProfessionalReviewCTA } from "@/components/review/professional-review-cta"

export default function ReviewPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const { data: review, isLoading } = useReview(projectId)

  const addComment = useAddComment(projectId)
  const toggleComment = useToggleComment(projectId)
  const setChecklist = useSetChecklist(projectId)
  const toggleWarning = useToggleWarning(projectId)

  if (isLoading || !project) return <ReviewSkeleton />
  if (!review) {
    return (
      <div className="p-6">
        <EmptyState
          title="Review belum tersedia"
          description="Pilih salah satu alternatif layout dulu untuk membuat catatan review."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Review & catatan</h2>
        <p className="text-sm text-muted-foreground">
          Kumpulan peringatan, checklist tenaga ahli, dan diskusi sebelum membangun.
        </p>
      </div>

      <ValidationSummary review={review} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" />
            Ringkasan AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{review.aiSummary}</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Peringatan</h3>
            <WarningList review={review} onToggle={(id) => toggleWarning.mutate(id)} />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Diskusi</h3>
            <CommentThread
              review={review}
              onAdd={(body) => addComment.mutate(body)}
              onToggle={(id) => toggleComment.mutate(id)}
              adding={addComment.isPending}
            />
          </section>
        </div>

        <div className="space-y-4">
          <ReviewChecklist
            review={review}
            onSet={(role, status) => setChecklist.mutate({ role, status })}
          />
          <ProfessionalReviewCTA
            requesting={addComment.isPending}
            onRequest={() => {
              addComment.mutate(
                "Permintaan review profesional dikirim ke arsitek & engineer (mock)."
              )
              toast.success("Permintaan review dikirim.")
            }}
            onMark={() => toast.success("Project ditandai sudah kamu tinjau.")}
          />
        </div>
      </div>
    </div>
  )
}

function ReviewSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  )
}
