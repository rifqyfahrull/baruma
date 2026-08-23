"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useParams, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import { useLayout, useProject } from "@/lib/api/hooks"
import { useEditorStore } from "@/stores/editor-store"
import { structuralNotes } from "@/lib/validation"
import { pickEffectiveLayout } from "@/components/preview-3d/effective-layout"
import { usePageView } from "@/lib/analytics"
import { markOnboardingSeen } from "@/hooks/use-onboarding-progress"
import { EmptyState } from "@/components/shared/empty-state"

// three.js loads only when this view mounts (PRD §26: no 3D libs on other pages).
const Preview3DView = dynamic(
  () => import("@/components/preview-3d/preview-3d-view").then((m) => m.Preview3DView),
  {
    ssr: false,
    loading: () => <SceneLoading />,
  }
)

export default function Preview3DPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const searchParams = useSearchParams()
  const { data: project } = useProject(projectId)
  const { data: fetchedLayoutDocument, isLoading } = useLayout(projectId, { fresh: true })
  const fetchedLayout = fetchedLayoutDocument?.layout ?? null
  // Prefer the live editor draft (useEditorStore persists across route nav) so
  // this page reflects unsaved 2D edits; fall back to the saved layout.
  const editorLayout = useEditorStore((s) => s.layout)
  const loadLayout = useEditorStore((s) => s.loadLayout)
  const layout = pickEffectiveLayout(editorLayout, fetchedLayout, projectId)
  const initialRoomId = searchParams.get("room") ?? undefined

  usePageView("preview_3d_opened", { project_id: projectId })
  // Checklist onboarding dashboard (WS-E §2) — tandai langkah "Lihat preview 3D".
  React.useEffect(() => markOnboardingSeen("preview3d"), [])

  // Edit-dari-3D (mis. pintu/jendela via OpeningQuickEditor) memutasi editor
  // store — muat layout tersimpan ke store bila user belum membuka 2D editor,
  // supaya updateOpening + autosave layout bekerja langsung dari halaman ini.
  const bridgedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const revision = fetchedLayoutDocument?.revision
    // Store sudah memegang draft project INI → jangan timpa (bisa berisi edit
    // 2D yang belum tersimpan). Store kosong/berisi project lain → muat.
    if (editorLayout?.projectId === projectId) return
    if (!fetchedLayout || !project || !revision) return
    if (bridgedRef.current === fetchedLayout.id) return
    loadLayout(
      fetchedLayout,
      project.site,
      structuralNotes(project, fetchedLayout),
      revision
    )
    bridgedRef.current = fetchedLayout.id
  }, [editorLayout, fetchedLayout, fetchedLayoutDocument?.revision, project, projectId, loadLayout])

  if (!project) return <SceneLoading />
  if (!layout) {
    if (isLoading) return <SceneLoading />
    return (
      <div className="p-6">
        <EmptyState
          title="Model 3D belum tersedia"
          description="Pilih salah satu alternatif layout dulu untuk membuat denah & 3D."
        />
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0">
      <Preview3DView layout={layout} project={project} initialRoomId={initialRoomId} />
    </div>
  )
}

function SceneLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Menyiapkan preview 3D…
      </div>
    </div>
  )
}
