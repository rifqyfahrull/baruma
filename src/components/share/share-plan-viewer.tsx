"use client"

import * as React from "react"

import type { DesignLayout, Project } from "@/types"
import { useEditorStore } from "@/stores/editor-store"
import { structuralNotes } from "@/lib/validation"
import { PlanCanvas } from "@/components/editor/plan-canvas"
import { FloorSwitcher } from "@/components/editor/floor-switcher"

/**
 * Read-only 2D plan viewer for the public share page (`/s/[token]`) — same
 * idea as `TemplatePlanViewer`, but takes a real `Project` + `DesignLayout`
 * directly instead of a synthetic `TemplateDetail` (a share link points at
 * an actual owner project, not a curated template row).
 */
export function SharePlanViewer({
  project,
  layout,
}: {
  project: Pick<Project, "floors" | "rooftop" | "readiness" | "site">
  layout: DesignLayout
}) {
  const loadLayout = useEditorStore((s) => s.loadLayout)

  React.useEffect(() => {
    loadLayout(
      layout,
      project.site,
      structuralNotes(
        { floors: project.floors, rooftop: project.rooftop, readiness: project.readiness },
        layout
      ),
      1,
      { readOnly: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layout identity is the real dependency
  }, [layout])

  return (
    <div className="relative h-[70vh] min-h-[480px] w-full overflow-hidden rounded-xl border">
      <PlanCanvas />
      <div className="absolute left-3 top-3 z-10">
        <FloorSwitcher />
      </div>
    </div>
  )
}
