"use client"

import * as React from "react"

import type { TemplateDetail } from "@/types/templates"
import { useEditorStore } from "@/stores/editor-store"
import { structuralNotes } from "@/lib/validation"
import { PlanCanvas } from "@/components/editor/plan-canvas"
import { FloorSwitcher } from "@/components/editor/floor-switcher"

/**
 * Read-only 2D plan viewer for the public template gallery. Loads the
 * template's layout straight into the (global) editor store with
 * `readOnly: true` — `PlanCanvas` already treats every pointer-down as
 * pan-only in that mode (no drag-mutation/selection ever reaches `commit()`).
 * No autosave hook is mounted here, so nothing is ever written back.
 */
export function TemplatePlanViewer({ template }: { template: TemplateDetail }) {
  const loadLayout = useEditorStore((s) => s.loadLayout)

  React.useEffect(() => {
    loadLayout(
      template.layout,
      template.site,
      structuralNotes(
        { floors: template.floors, rooftop: template.rooftop, readiness: "concept_ready" },
        template.layout
      ),
      1,
      { readOnly: true }
    )
  }, [template.id, template.layout, template.site, template.floors, template.rooftop, loadLayout])

  return (
    <div className="relative h-[70vh] min-h-[480px] w-full overflow-hidden rounded-xl border">
      <PlanCanvas />
      <div className="absolute left-3 top-3 z-10">
        <FloorSwitcher />
      </div>
    </div>
  )
}
