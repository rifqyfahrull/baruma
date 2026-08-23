"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Layers, Loader2, MapPin, Ruler, ShieldAlert } from "lucide-react"

import type { Brief, Comment, DesignLayout, Project } from "@/types"
import { HOUSE_STYLES } from "@/lib/constants"
import { formatArea, formatDimensions } from "@/lib/format"
import { isWebGLAvailable } from "@/lib/three/webgl-support"
import { cn } from "@/lib/utils"
import { ReadinessBadge } from "@/components/shared/readiness-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SharePlanViewer } from "./share-plan-viewer"
import { ShareCommentForm } from "./share-comment-form"

const Preview3DView = dynamic(
  () => import("@/components/preview-3d/preview-3d-view").then((m) => m.Preview3DView),
  { ssr: false, loading: () => <SceneLoading /> }
)

type Tab = "3d" | "2d" | "review"

export interface ShareReviewSummary {
  aiSummary: string
  warningsCount: number
  comments: Comment[]
}

/** Public, read-only project view rendered at `/s/[token]` (WS-D §2). */
export function ShareViewer({
  token,
  project,
  brief,
  layout,
  review,
}: {
  token: string
  project: Project
  brief: Brief | null
  layout: DesignLayout | null
  review: ShareReviewSummary | null
}) {
  const [tab, setTab] = React.useState<Tab>("2d")
  const userChoseRef = React.useRef(false)

  React.useEffect(() => {
    if (!userChoseRef.current && layout && isWebGLAvailable()) setTab("3d")
  }, [layout])

  const tabs: { key: Tab; label: string }[] = [
    { key: "3d", label: "3D" },
    { key: "2d", label: "2D" },
    { key: "review", label: "Review" },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {project.style && (
              <span className="rounded-full bg-muted px-2 py-0.5">{HOUSE_STYLES[project.style]}</span>
            )}
            {(project.city || project.province) && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {[project.city, project.province].filter(Boolean).join(", ")}
              </span>
            )}
            <ReadinessBadge status={project.readiness} size="sm" />
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{project.name}</h1>
          {brief?.summary && <p className="mt-3 text-muted-foreground">{brief.summary}</p>}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Layers className="size-4" />
              {project.floors} lantai{project.rooftop ? " + rooftop" : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <Ruler className="size-4" />
              {formatDimensions(project.site.widthM, project.site.depthM)} ·{" "}
              {formatArea(project.site.areaM2)}
            </span>
          </div>
        </div>
      </div>

      <Alert className="mt-6">
        <ShieldAlert className="size-4 text-info" />
        <AlertTitle>Tautan lihat-saja</AlertTitle>
        <AlertDescription>
          Kamu melihat pratinjau read-only project ini lewat tautan yang dibagikan pemiliknya. Tinggalkan komentar di bawah untuk memberi masukan.
        </AlertDescription>
      </Alert>

      {layout ? (
        <>
          <div className="mt-8 inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            {tabs.map((t) => (
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
                <Preview3DView layout={layout} project={project} readOnly />
              </div>
            )}
            {tab === "2d" && <SharePlanViewer project={project} layout={layout} />}
            {tab === "review" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Ringkasan review</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{review?.aiSummary ?? "Belum ada ringkasan review."}</p>
                  <p className="font-medium">
                    {review?.warningsCount ?? 0} peringatan otomatis dari validasi denah.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : (
        <div className="mt-10 rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Denah belum dibuat oleh pemilik project ini.
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Komentar</CardTitle>
        </CardHeader>
        <CardContent>
          <ShareCommentForm token={token} comments={review?.comments ?? []} />
        </CardContent>
      </Card>
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
