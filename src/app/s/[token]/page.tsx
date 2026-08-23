import type { Metadata } from "next"
import { notFound } from "next/navigation"

import type { Brief } from "@/types"
import { getSharedProjectByToken } from "@/lib/server/repo/share-links"
import { getComments } from "@/lib/server/repo/review"
import { generateReview } from "@/lib/mock/review"
import { ShareViewer, type ShareReviewSummary } from "@/components/share/share-viewer"

// Public preview — never cached across owners/tokens, and a fresh review
// comment (or a revoke) must show up immediately, not after some ISR window.
export const dynamic = "force-dynamic"

function fallbackBrief(shared: NonNullable<Awaited<ReturnType<typeof getSharedProjectByToken>>>): Brief {
  return {
    projectId: shared.project.id,
    summary: "",
    site: shared.project.site,
    building: {
      floors: shared.project.floors,
      rooftop: shared.project.rooftop,
      budget: { minIDR: 0, maxIDR: 0 },
      finishingLevel: "menengah",
    },
    priorities: [],
    spaceProgram: [],
    assumptions: [],
    constraints: [],
    risks: [],
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const shared = await getSharedProjectByToken(token).catch(() => null)
  if (!shared) return { title: "Tautan tidak ditemukan" }
  return {
    title: `${shared.project.name} — Desain rumah di Baruma`,
    description: shared.brief?.summary ?? `Lihat pratinjau desain rumah "${shared.project.name}" dari Baruma.`,
    robots: { index: false, follow: false }, // tautan privat per-project, tidak untuk diindeks
  }
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const shared = await getSharedProjectByToken(token).catch(() => null)
  if (!shared) notFound()

  let review: ShareReviewSummary | null = null
  if (shared.layout) {
    const generated = generateReview(shared.project, shared.brief ?? fallbackBrief(shared), shared.layout)
    const comments = await getComments(shared.project.id).catch(() => [])
    review = { aiSummary: generated.aiSummary, warningsCount: generated.warnings.length, comments }
  }

  return (
    <ShareViewer
      token={token}
      project={shared.project}
      brief={shared.brief}
      layout={shared.layout}
      review={review}
    />
  )
}
