"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"

import type { DesignLayout, Project, Room } from "@/types"
import type { SavedInterior } from "@/lib/schemas/interior"
import { useInterior, useLayout, useProject } from "@/lib/api/hooks"
import { useEditorStore } from "@/stores/editor-store"
import { pickEffectiveLayout } from "@/components/preview-3d/effective-layout"
import { EmptyState } from "@/components/shared/empty-state"
import { SheetSvg } from "@/components/drawings/sheet-svg"
import { FloatingPanel } from "@/components/layout/floating-panel"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { buildKusenDetails } from "@/lib/drawings/kusen-sheets"
import { buildSheetList } from "@/lib/drawings/sheet-list"
import {
  applySavedInterior,
  generateInteriorPlan,
  interiorStyleFromHouseStyle,
} from "@/lib/interior/plan"
import type { Drawing } from "@/lib/drawings/types"
import { round2 } from "@/lib/geometry"
import { cn } from "@/lib/utils"

const ROOFTOP_FLOOR_ID = "floor-rooftop"

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.25

function subscribeDesktop(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

/**
 * True at Tailwind's `lg` breakpoint and up. The sheet nav is mounted in exactly
 * ONE place — the floating panel (desktop) OR the top strip (mobile) — so the
 * `sheet-tab-*` / `cut-slider` / `mini-plan` testids never appear twice in the
 * DOM at once (which would trip Playwright's strict-mode locators). SSR + first
 * paint render the desktop branch (getServerSnapshot → true).
 */
function useIsDesktop(): boolean {
  return React.useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    () => true
  )
}

/** Bounding footprint (meters) of the building's non-rooftop rooms. */
function buildingBounds(layout: DesignLayout): { width: number; depth: number } {
  const rooms = layout.rooms.filter((r) => r.floorId !== ROOFTOP_FLOOR_ID)
  const width = rooms.reduce((m, r) => Math.max(m, r.x + r.width), 0)
  const depth = rooms.reduce((m, r) => Math.max(m, r.y + r.depth), 0)
  return { width: round2(width), depth: round2(depth) }
}

/** Lowest-level non-rooftop floor id — the mini-plan always shows the ground floor. */
function groundFloorId(layout: DesignLayout): string | null {
  const floors = layout.floors
    .filter((f) => f.id !== ROOFTOP_FLOOR_ID)
    .slice()
    .sort((a, b) => a.level - b.level)
  return floors[0]?.id ?? null
}

export default function DrawingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const { data: fetchedLayoutDocument, isLoading } = useLayout(projectId, { fresh: true })
  const fetchedLayout = fetchedLayoutDocument?.layout ?? null
  // Saved interior intent (may still be in flight — the workspace falls back
  // to the pure generated plan immediately, then re-resolves once it lands).
  const { data: savedInterior } = useInterior(projectId)
  // Prefer the live editor draft so this page reflects unsaved 2D edits (same
  // pattern as /preview-3d), fall back to the saved layout.
  const editorLayout = useEditorStore((s) => s.layout)
  const layout = pickEffectiveLayout(editorLayout, fetchedLayout, projectId)

  if (!project) return <PageLoading />
  if (!layout) {
    if (isLoading) return <PageLoading />
    return (
      <div className="p-6">
        <EmptyState
          title="Gambar kerja belum tersedia"
          description="Pilih salah satu alternatif layout dulu untuk membuat tampak & potongan."
        />
      </div>
    )
  }

  return <DrawingsWorkspace layout={layout} project={project} savedInterior={savedInterior ?? null} />
}

function PageLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-muted/30">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Menyiapkan gambar kerja…
      </div>
    </div>
  )
}

function DrawingsWorkspace({
  layout,
  project,
  savedInterior,
}: {
  layout: DesignLayout
  project: Project
  savedInterior: SavedInterior | null
}) {
  const bounds = React.useMemo(() => buildingBounds(layout), [layout])
  const kusenDetails = React.useMemo(() => buildKusenDetails(layout), [layout])
  const list = React.useMemo(() => buildSheetList(layout, kusenDetails), [layout, kusenDetails])
  // Pure saved-vs-generated interior resolution — the exact pattern the PDF
  // export (generate.ts) uses, so page and PDF always agree. While the saved
  // interior is still loading, `savedInterior` is null and the generated plan
  // renders immediately (it is pure and synchronous — no flash of nothing).
  const interiors = React.useMemo(() => {
    const plan = savedInterior
      ? applySavedInterior(layout, savedInterior, { projectId: project.id })
      : generateInteriorPlan(layout, {
          projectId: project.id,
          style: interiorStyleFromHouseStyle(project.style),
        })
    return plan.rooms
  }, [layout, savedInterior, project.id, project.style])
  const [sheet, setSheet] = React.useState<string>("s")
  const [cutX, setCutX] = React.useState(() => round2(bounds.width / 2))
  const [cutY, setCutY] = React.useState(() => round2(bounds.depth / 2))

  const active = list.find((s) => s.id === sheet) ?? list[1]
  const isSection = active.kind === "section"

  const drawing: Drawing = React.useMemo(
    () => active.build(layout, interiors, { cutX, cutY }),
    [active, layout, interiors, cutX, cutY]
  )

  const groundId = React.useMemo(() => groundFloorId(layout), [layout])
  const groundRooms = React.useMemo(
    () => layout.rooms.filter((r) => r.floorId === groundId),
    [layout, groundId]
  )

  const isDesktop = useIsDesktop()
  const [panelMinimized, setPanelMinimized] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const zoomPct = Math.round(zoom * 100)

  function updateZoom(next: number) {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)))
  }

  // Shared sheet-nav body (header copy + sheet-tab list + conditional section-cut
  // control). Rendered in exactly ONE of the two branches below, never both, so
  // its testids stay unique in the DOM (see useIsDesktop).
  const sheetNav = (
    <>
      <p className="text-xs text-muted-foreground">
        Tampak, potongan, kusen, pola lantai, plafon & detail atap — siap cetak A3.
      </p>

      <nav className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`sheet-tab-${s.id}`}
            aria-pressed={sheet === s.id}
            onClick={() => setSheet(s.id)}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              sheet === s.id
                ? "border-primary bg-primary/5 font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <span>{s.label}</span>
            <span className="text-[10px] text-muted-foreground">{s.sheetNo}</span>
          </button>
        ))}
      </nav>

      {isSection && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span>Posisi potongan</span>
            <span className="text-muted-foreground">
              {(sheet === "secA" ? cutX : cutY).toFixed(1)} m
            </span>
          </div>
          <input
            type="range"
            data-testid="cut-slider"
            min={0}
            max={sheet === "secA" ? bounds.width : bounds.depth}
            step={0.1}
            value={sheet === "secA" ? cutX : cutY}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (sheet === "secA") setCutX(v)
              else setCutY(v)
            }}
            className="w-full accent-primary"
          />
          <MiniPlan
            rooms={groundRooms}
            bounds={bounds}
            axis={sheet === "secA" ? "x" : "y"}
            position={sheet === "secA" ? cutX : cutY}
          />
        </div>
      )}
    </>
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col lg:flex-row">
      {isDesktop ? (
        // Desktop: floating overlay pinned to the left edge over the SVG area.
        <FloatingPanel
          side="left"
          storageKey="panel:drawings"
          widthClass="w-72"
          minimizeLabel="Gambar Kerja"
          bodyClassName="flex flex-col gap-3"
          title={<h1 className="text-sm font-semibold">Gambar Kerja</h1>}
          onMinimizedChange={setPanelMinimized}
        >
          {sheetNav}
        </FloatingPanel>
      ) : (
        // Mobile: reflow as a full-width top strip (FloatingPanel is desktop-only,
        // so this keeps the sheet tabs reachable on small screens).
        <aside className="flex w-full shrink-0 flex-col gap-3 border-b p-4">
          <h1 className="text-sm font-semibold">Gambar Kerja</h1>
          {sheetNav}
        </aside>
      )}

      {/*
        While the panel is expanded, reserve its footprint (left-4 inset 1rem +
        w-72 18rem = 19rem, +1rem gutter = 20rem) — unlike the editor/3D canvas,
        the sheet cannot be panned out from under the overlay. Minimized (pill)
        reclaims the full width.
      */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-muted/20 p-4",
          isDesktop && !panelMinimized && "lg:pl-80"
        )}
      >
        <div className="sticky top-3 z-20 mb-3 flex justify-end">
          <div
            className="flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm backdrop-blur"
            role="group"
            aria-label="Kontrol zoom gambar kerja"
          >
            <ZoomButton
              label="Perkecil gambar kerja"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => updateZoom(zoom - ZOOM_STEP)}
            >
              <ZoomOut className="size-4" />
            </ZoomButton>
            <span
              className="min-w-12 px-1 text-center text-xs font-medium tabular-nums"
              aria-live="polite"
              data-testid="drawings-zoom-value"
            >
              {zoomPct}%
            </span>
            <ZoomButton
              label="Reset zoom gambar kerja"
              disabled={zoom === 1}
              onClick={() => updateZoom(1)}
            >
              <RotateCcw className="size-4" />
            </ZoomButton>
            <ZoomButton
              label="Perbesar gambar kerja"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => updateZoom(zoom + ZOOM_STEP)}
            >
              <ZoomIn className="size-4" />
            </ZoomButton>
          </div>
        </div>
        <div
          className="mx-auto transition-[width,max-width] duration-150 ease-out"
          style={{
            width: `${zoomPct}%`,
            maxWidth: `${64 * zoom}rem`,
          }}
          data-testid="drawings-sheet-zoom-frame"
        >
          <SheetSvg drawing={drawing} sheetNo={active.sheetNo} projectName={project.name} />
        </div>
      </div>
    </div>
  )
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Simple ground-floor plan (rect per room) with a red cut line at the current position. */
function MiniPlan({
  rooms,
  bounds,
  axis,
  position,
}: {
  rooms: Room[]
  bounds: { width: number; depth: number }
  axis: "x" | "y"
  position: number
}) {
  const w = Math.max(bounds.width, 1)
  const d = Math.max(bounds.depth, 1)
  const pad = 0.3

  return (
    <svg
      data-testid="mini-plan"
      viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${d + 2 * pad}`}
      className="mt-3 h-auto w-full rounded border bg-background"
      role="img"
      aria-label="Denah mini dengan garis potong"
    >
      {rooms.map((r) => (
        <rect
          key={r.id}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.depth}
          className="fill-muted stroke-foreground/50"
          strokeWidth={0.02}
        />
      ))}
      {axis === "x" ? (
        <line
          x1={position}
          y1={-pad}
          x2={position}
          y2={d + pad}
          stroke="red"
          strokeWidth={0.04}
          data-testid="mini-plan-cut-line"
        />
      ) : (
        <line
          x1={-pad}
          y1={position}
          x2={w + pad}
          y2={position}
          stroke="red"
          strokeWidth={0.04}
          data-testid="mini-plan-cut-line"
        />
      )}
    </svg>
  )
}
