"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { Bot, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { AssistantSurface } from "@/lib/assistant/actions"
import { usePreviewStore } from "@/stores/preview-store"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"
import { ProjectAgentPanel } from "./project-agent-panel"

const SURFACES = new Set<AssistantSurface>([
  "brief", "alternatives", "editor", "preview-3d", "rab", "drawings",
  "exports", "review", "furniture", "materials",
])

function surfaceFromPath(pathname: string, projectId: string): AssistantSurface {
  const prefix = `/app/projects/${projectId}/`
  const segment = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/")[0] : "project"
  return SURFACES.has(segment as AssistantSurface) ? segment as AssistantSurface : "project"
}

export function ProjectAgentShell({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const surface = surfaceFromPath(pathname, projectId)
  const open = useProjectAgentUiStore((state) => state.open)
  const setOpen = useProjectAgentUiStore((state) => state.setOpen)
  const reset = useProjectAgentUiStore((state) => state.reset)
  const cleanMode = usePreviewStore((state) => state.cleanMode)

  React.useEffect(() => {
    reset()
  }, [projectId, reset])
  if (cleanMode) return null

  return (
    <>
      <Button
        type="button"
        className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Buka AI Agent"
        data-testid="project-agent-launcher"
      >
        <Sparkles /> AI Agent
      </Button>
      {/* modal={false}: tanpa overlay & tanpa kunci pointer — editor tetap bisa dipakai. */}
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          className="w-full gap-0 shadow-2xl sm:max-w-md"
          data-testid="project-agent-sheet"
          showOverlay={false}
          // Hanya tertutup lewat tombol X — klik di luar & Esc tidak menutup.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle className="flex items-center gap-2"><Bot className="size-4 text-info" /> AI Agent</SheetTitle>
            <SheetDescription>Satu percakapan untuk Brief, Denah, dan Interior.</SheetDescription>
          </SheetHeader>
          <ProjectAgentPanel projectId={projectId} surface={surface} />
        </SheetContent>
      </Sheet>
    </>
  )
}
