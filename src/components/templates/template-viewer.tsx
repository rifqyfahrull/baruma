"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Layers, Loader2, MapPin, Ruler } from "lucide-react"

import type { Project } from "@/types"
import type { TemplateDetail } from "@/types/templates"
import { HOUSE_STYLES } from "@/lib/constants"
import { formatArea, formatDimensions } from "@/lib/format"
import { isWebGLAvailable } from "@/lib/three/webgl-support"
import { cn } from "@/lib/utils"
import { TemplatePlanViewer } from "./template-plan-viewer"
import { TemplateBrief } from "./template-brief"
import { UseTemplateButton } from "./use-template-button"

// three.js loads only when the "3D" tab is actually active — dynamic +
// ssr:false, same pattern as the logged-in preview-3d page.
const Preview3DView = dynamic(
  () => import("@/components/preview-3d/preview-3d-view").then((m) => m.Preview3DView),
  { ssr: false, loading: () => <SceneLoading /> }
)

type Tab = "3d" | "2d" | "brief"

/** Read-only viewer for a public template: 2D plan / 3D model / Brief. */
export function TemplateViewer({ template }: { template: TemplateDetail }) {
  // Default to 2D (matches SSR, where WebGL can't be probed) — an effect
  // below flips to 3D on mount if the client's browser actually supports it,
  // unless the visitor has already picked a tab themselves.
  const [tab, setTab] = React.useState<Tab>("2d")
  const userChoseRef = React.useRef(false)

  React.useEffect(() => {
    if (!userChoseRef.current && isWebGLAvailable()) setTab("3d")
  }, [])

  const project: Project = React.useMemo<Project>(
    () => ({
      id: template.sourceProjectId ?? template.id,
      name: template.name,
      status: "editing",
      readiness: "concept_ready",
      city: template.city,
      province: template.province,
      style: template.style,
      projectType: "new",
      thumbnail: template.thumbnail,
      site: template.site,
      floors: template.floors,
      rooftop: template.rooftop,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }),
    [template]
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {template.style && (
              <span className="rounded-full bg-muted px-2 py-0.5">{HOUSE_STYLES[template.style]}</span>
            )}
            {(template.city || template.province) && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {[template.city, template.province].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{template.name}</h1>
          {template.description && (
            <p className="mt-3 text-muted-foreground">{template.description}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Layers className="size-4" />
              {template.floors} lantai{template.rooftop ? " + rooftop" : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <Ruler className="size-4" />
              {formatDimensions(template.site.widthM, template.site.depthM)} ·{" "}
              {formatArea(template.site.areaM2)}
            </span>
          </div>
        </div>

        <UseTemplateButton slug={template.slug} size="lg" className="shrink-0" />
      </div>

      <div className="mt-8 inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
        {(
          [
            { key: "3d", label: "3D" },
            { key: "2d", label: "2D" },
            { key: "brief", label: "Brief" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              userChoseRef.current = true
              setTab(t.key)
            }}
            aria-pressed={tab === t.key}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "3d" && (
          <div className="relative h-[70vh] min-h-[480px] w-full overflow-hidden rounded-xl border">
            <Preview3DView
              layout={template.layout}
              project={project}
              readOnly
              presetInterior={template.interior}
            />
          </div>
        )}
        {tab === "2d" && <TemplatePlanViewer template={template} />}
        {tab === "brief" && <TemplateBrief template={template} />}
      </div>
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
