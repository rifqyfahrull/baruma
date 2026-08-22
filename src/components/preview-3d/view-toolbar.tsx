"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, Box, Building2, Camera, Eye, Focus, Grid2x2, Home, Moon, MoreVertical, Sun } from "lucide-react"

import type { DesignLayout, Project } from "@/types"
import { usePreviewStore, type ViewPreset } from "@/stores/preview-store"
import { useProjectCapabilities } from "@/hooks/use-project-capabilities"
import { useNarrowViewport } from "@/hooks/use-narrow-viewport"
import { isPartialRooftop } from "@/lib/geometry/rooftop"
import {
  cityLatitude,
  compassLabel,
  formatHour,
  MONTH_LABELS,
  solarPosition,
} from "@/lib/three/solar"
import { buildPreviewSceneStats, formatBytes } from "@/lib/three/scene-stats"
import { PhotoPackage } from "@/components/preview-3d/photo-package"
import { AiRenderDialog } from "@/components/preview-3d/ai-render-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const VIEWS: { id: ViewPreset; label: string; icon: typeof Box }[] = [
  { id: "iso", label: "Isometrik", icon: Box },
  { id: "front", label: "Depan", icon: Home },
  { id: "top", label: "Atas", icon: Grid2x2 },
  { id: "rooftop", label: "Rooftop", icon: Building2 },
]

function ToggleLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

/**
 * Simple floating toolbar on the LEFT of the 3D canvas: view presets +
 * screenshot, a lighting popover (realistic + sun sliders), and a display
 * options popover. Replaces the old "Sudut pandang", "Pencahayaan", and
 * "Opsi tampilan" accordion sections in the floating panel.
 *
 * Responsive: pada viewport pendek/sempit (tinggi tak cukup untuk semua icon)
 * kontrol sekunder diciutkan ke tombol "More" (⋯) yang membuka DropdownMenu —
 * kontrol yang sama dipakai ulang, jadi popover & toggle tetap berfungsi.
 */
export function ViewToolbar({
  layout,
  project,
  readOnly = false,
}: {
  layout: DesignLayout
  project: Project
  /** Viewer publik read-only: sembunyikan pintasan "Buka 2D Editor" (mode
   *  bersih) — menuju halaman ber-login yang tak relevan untuk pengunjung
   *  publik. Semua kontrol lain (sudut pandang, pencahayaan, lantai, dst.)
   *  tetap aktif — tak ada yang di sini memutasi/menyimpan apa pun. */
  readOnly?: boolean
}) {
  const viewPreset = usePreviewStore((s) => s.viewPreset)
  const requestView = usePreviewStore((s) => s.requestView)
  const realistic = usePreviewStore((s) => s.realistic)
  const setRealistic = usePreviewStore((s) => s.setRealistic)
  const sunAzimuthDeg = usePreviewStore((s) => s.sunAzimuthDeg)
  const setSunAzimuth = usePreviewStore((s) => s.setSunAzimuth)
  const sunElevationDeg = usePreviewStore((s) => s.sunElevationDeg)
  const setSunElevation = usePreviewStore((s) => s.setSunElevation)
  const sunStudy = usePreviewStore((s) => s.sunStudy)
  const showRoof = usePreviewStore((s) => s.showRoof)
  const setShowRoof = usePreviewStore((s) => s.setShowRoof)
  const showLabels = usePreviewStore((s) => s.showLabels)
  const setShowLabels = usePreviewStore((s) => s.setShowLabels)
  const showInteriorLabels = usePreviewStore((s) => s.showInteriorLabels)
  const setShowInteriorLabels = usePreviewStore((s) => s.setShowInteriorLabels)
  const showFurniture = usePreviewStore((s) => s.showFurniture)
  const setShowFurniture = usePreviewStore((s) => s.setShowFurniture)
  const showHumanScale = usePreviewStore((s) => s.showHumanScale)
  const setShowHumanScale = usePreviewStore((s) => s.setShowHumanScale)
  const showVegetation = usePreviewStore((s) => s.showVegetation)
  const glassRealistic = usePreviewStore((s) => s.glassRealistic)
  const setGlassRealistic = usePreviewStore((s) => s.setGlassRealistic)
  const renderMode = usePreviewStore((s) => s.renderMode)
  const applyRenderModePreset = usePreviewStore((s) => s.applyRenderModePreset)
  const cleanMode = usePreviewStore((s) => s.cleanMode)
  const toggleCleanMode = usePreviewStore((s) => s.toggleCleanMode)
  const nightMode = usePreviewStore((s) => s.nightMode)
  const toggleNightMode = usePreviewStore((s) => s.toggleNightMode)
  // Gating rollout §21: preset Edit/Presentasi hanya UI — scene tetap render.
  const capabilities = useProjectCapabilities(project.id)

  const hasRooftop = layout.floors.some((f) => f.id === "floor-rooftop")
  const showRoofToggle = !hasRooftop || isPartialRooftop(layout)
  const devStatsEnabled = process.env.NODE_ENV !== "production"
  const sceneStats = React.useMemo(
    () =>
      devStatsEnabled
        ? buildPreviewSceneStats(layout, project.site, project, {
            showRoof,
            showFurniture,
            realistic,
          })
        : null,
    [devStatsEnabled, layout, project, showRoof, showFurniture, realistic]
  )

  const screenshot = () => {
    // captureFrame me-render ulang sebelum membaca pixel (preserveDrawingBuffer
    // false + frameloop demand = buffer bisa kosong). Fallback toDataURL
    // langsung hanya untuk jaga-jaga bila bridge belum terdaftar.
    const { captureFrame, canvasEl } = usePreviewStore.getState()
    const dataUrl = captureFrame ? captureFrame() : canvasEl?.toDataURL("image/png")
    if (!dataUrl) return
    const a = document.createElement("a")
    a.href = dataUrl
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}-3d.png`
    a.click()
  }

  // Table/sempit → sekunder menciut ke tombol More; desktop lebar → inline.
  const compact = useNarrowViewport()

  // Kontrol sekunder — dipakai baik inline (layar tinggi) maupun di dalam
  // dropdown More (layar pendek). Logika identik, tanpa duplikasi.
  const secondaryControls = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" onClick={screenshot} aria-label="Screenshot">
            <Camera />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Screenshot PNG</TooltipContent>
      </Tooltip>

      {/* Paket foto presentasi — render multi-sudut siang+senja sekali klik */}
      <PhotoPackage project={project} />

      {/* Render AI — visualisasi bergaya foto (Fase 8). Digerbangi
          ai_render_v1 DI DALAM komponen (return null bila nonaktif). */}
      <AiRenderDialog project={project} layout={layout} />

      {sceneStats && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant={sceneStats.ok ? "ghost" : "destructive"}
                  className="size-8"
                  aria-label="Scene stats"
                  data-testid="scene-stats-button"
                >
                  <Activity />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              {sceneStats.ok ? "Scene stats — budget aman" : "Scene stats — budget terlampaui"}
            </TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="start" className="w-72 space-y-3">
            <div>
              <p className="text-xs font-semibold">Scene stats · dev only</p>
              <p className="text-[11px] text-muted-foreground">
                Estimasi pure dari prim 3D; GPU FPS tetap perlu browser benchmark.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">Semantic objects</span>
              <span className="text-right tabular-nums">{sceneStats.semanticObjects}</span>
              <span className="text-muted-foreground">Meshes / prims</span>
              <span className="text-right tabular-nums">{sceneStats.meshes}</span>
              <span className="text-muted-foreground">Draw calls</span>
              <span className="text-right tabular-nums">
                {sceneStats.drawCalls} / {sceneStats.budgets.drawCalls.limit}
              </span>
              <span className="text-muted-foreground">Triangles</span>
              <span className="text-right tabular-nums">{sceneStats.triangles.toLocaleString("id-ID")}</span>
              <span className="text-muted-foreground">Textures</span>
              <span className="text-right tabular-nums">
                {sceneStats.textureCount} · {formatBytes(sceneStats.textureMemoryBytes)}
              </span>
            </div>
            {!sceneStats.ok && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
                Budget scene terlampaui. Kurangi elemen repetitif atau pakai instancing/LOD sebelum presentasi rendering.
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* Pencahayaan */}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" variant={realistic ? "default" : "ghost"} className="size-8" aria-label="Pencahayaan">
                <Sun />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Pencahayaan</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-72 space-y-3">
          <p className="text-xs font-semibold">Pencahayaan</p>
          <ToggleLine label="Realistis (bayangan & langit)" checked={realistic} onChange={setRealistic} />
          <ToggleLine label="Mode malam (senja)" checked={nightMode} onChange={(v) => usePreviewStore.getState().setNightMode(v)} />

          <SunStudySection project={project} />

          {!sunStudy.enabled && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Azimuth matahari — {sunAzimuthDeg}°</Label>
                <Slider min={0} max={360} step={1} value={[sunAzimuthDeg]} onValueChange={([v]) => setSunAzimuth(v)} aria-label="Azimuth matahari (derajat)" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Elevasi matahari — {sunElevationDeg}°</Label>
                <Slider min={0} max={90} step={1} value={[sunElevationDeg]} onValueChange={([v]) => setSunElevation(v)} aria-label="Elevasi matahari (derajat)" />
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Mode malam — toggle cepat (juga di popover Pencahayaan) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant={nightMode ? "default" : "ghost"}
            className="size-8"
            aria-pressed={nightMode}
            aria-label="Mode malam"
            data-testid="night-mode-toggle"
            onClick={toggleNightMode}
          >
            <Moon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {nightMode ? "Kembali ke siang" : "Mode malam — jendela menyala"}
        </TooltipContent>
      </Tooltip>

      {/* Opsi tampilan */}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Opsi tampilan">
                <Eye />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Opsi tampilan</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-60 space-y-0.5">
          <p className="pb-1 text-xs font-semibold">Opsi tampilan</p>
          {capabilities.presentation_mode_v1 && (
            <div className="grid grid-cols-2 gap-1 pb-2">
              <Button
                type="button"
                size="sm"
                variant={renderMode === "edit" ? "default" : "outline"}
                className="h-7 text-xs"
                data-testid="render-mode-edit"
                aria-pressed={renderMode === "edit"}
                onClick={() => applyRenderModePreset("edit")}
              >
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant={renderMode === "presentation" ? "default" : "outline"}
                className="h-7 text-xs"
                data-testid="render-mode-presentation"
                aria-pressed={renderMode === "presentation"}
                onClick={() => applyRenderModePreset("presentation")}
              >
                Presentasi
              </Button>
            </div>
          )}
          {showRoofToggle && <ToggleLine label="Tampilkan atap" checked={showRoof} onChange={setShowRoof} />}
          <ToggleLine label="Label ruang" checked={showLabels} onChange={setShowLabels} />
          <ToggleLine label="Label interior" checked={showInteriorLabels} onChange={setShowInteriorLabels} />
          <ToggleLine label="Furnitur interior" checked={showFurniture} onChange={setShowFurniture} />
          <ToggleLine label="Orang (1,7 m)" checked={showHumanScale} onChange={setShowHumanScale} />
          <ToggleLine
            label="Vegetasi taman"
            checked={showVegetation}
            onChange={(v) => usePreviewStore.getState().setShowVegetation(v)}
          />
          <ToggleLine
            label="Kaca realistis (lebih berat)"
            checked={glassRealistic}
            onChange={setGlassRealistic}
          />
          <p className="pb-1 text-[10px] leading-tight text-muted-foreground">
            Kaca bukaan/curtain wall/railing jadi tembus pandang & membias cahaya (transmisi). Lebih berat di GPU — biarkan nonaktif di perangkat lemah/tablet.
          </p>
        </PopoverContent>
      </Popover>

      <div className="mx-1 h-px bg-border" />

      {/* Mode bersih — sembunyikan header, tab, sidebar kiri, & panel mengambang */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant={cleanMode ? "default" : "ghost"}
            className="size-8"
            aria-pressed={cleanMode}
            aria-label="Mode bersih"
            data-testid="clean-mode-toggle"
            onClick={toggleCleanMode}
          >
            <Focus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {cleanMode ? "Keluar mode bersih (Esc)" : "Mode bersih — sembunyikan panel"}
        </TooltipContent>
      </Tooltip>
    </>
  )

  return (
    <div
      data-testid="view-toolbar"
      className="flex flex-col gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur"
    >
      {/* Mode bersih menyembunyikan ProjectTabs (satu-satunya navigasi 2D↔3D)
          — sediakan jalan pintas ke editor 2D di sini. Inline di atas (bukan di
          secondaryControls) supaya tak terlipat ke dropdown More di layar
          sempit. Navigasi keluar halaman otomatis mengakhiri mode bersih. */}
      {cleanMode && !readOnly && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Buka 2D Editor"
                data-testid="clean-mode-2d-link"
              >
                <Link href={`/app/projects/${project.id}/editor`}>
                  <span className="text-xs font-bold">2D</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Buka 2D Editor</TooltipContent>
          </Tooltip>
          <div className="mx-1 h-px bg-border" />
        </>
      )}

      {/* Sudut pandang — selalu inline */}
      {VIEWS.map((v) => (
        <Tooltip key={v.id}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={viewPreset === v.id ? "default" : "ghost"}
              className="size-8"
              aria-label={`Sudut pandang ${v.label}`}
              aria-pressed={viewPreset === v.id}
              onClick={() => requestView(v.id)}
            >
              <v.icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{v.label}</TooltipContent>
        </Tooltip>
      ))}

      <div className="mx-1 h-px bg-border" />

      {/* Kontrol sekunder: inline di layar tinggi, atau di dropdown "More"
          ketika tinggi viewport tak mencukupi (tablet/pendek). */}
      {compact ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label="Kontrol lainnya"
                  data-testid="view-toolbar-more"
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Kontrol lainnya</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="start" className="max-h-[min(60vh,28rem)] w-11 overflow-y-auto p-1">
            <div className="flex flex-col gap-1">{secondaryControls}</div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        secondaryControls
      )}
    </div>
  )
}

/**
 * Studi matahari: nyalakan → azimut/elevasi matahari dihitung dari bulan+jam+
 * lintang lokasi (bayangan bergerak sesuai lintasan nyata). "Putar sehari"
 * menganimasikan jam 6→18 (setInterval memutasi store → r3f demand invalidate).
 */
function SunStudySection({ project }: { project: Project }) {
  const sunStudy = usePreviewStore((s) => s.sunStudy)
  const setEnabled = usePreviewStore((s) => s.setSunStudyEnabled)
  const setMonth = usePreviewStore((s) => s.setSunStudyMonth)
  const setHour = usePreviewStore((s) => s.setSunStudyHour)
  const [playing, setPlaying] = React.useState(false)

  const latitude = cityLatitude(project.site.city ?? project.city)
  const solar = solarPosition(latitude, sunStudy.month, sunStudy.hour)
  const belowHorizon = solar.elevationDeg < 0

  // Animasi hari: majukan jam kira-kira 0.25 jam / 120 ms; berhenti di 18:00.
  React.useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const cur = usePreviewStore.getState().sunStudy.hour
      const next = cur + 0.25
      if (next >= 18) {
        usePreviewStore.getState().setSunStudyHour(18)
        setPlaying(false)
      } else {
        usePreviewStore.getState().setSunStudyHour(next)
      }
    }, 120)
    return () => window.clearInterval(id)
  }, [playing])

  // Matikan animasi bila studi dimatikan.
  React.useEffect(() => {
    if (sunStudy.enabled || !playing) return
    const timer = setTimeout(() => setPlaying(false), 0)
    return () => clearTimeout(timer)
  }, [sunStudy.enabled, playing])

  return (
    <div className="space-y-2 rounded-md border p-2" data-testid="sun-study">
      <ToggleLine
        label="Studi matahari (lintasan nyata)"
        checked={sunStudy.enabled}
        onChange={(v) => {
          setEnabled(v)
          if (!v) setPlaying(false)
        }}
      />
      {sunStudy.enabled && (
        <>
          <p className="text-[11px] text-muted-foreground" data-testid="sun-study-readout">
            {formatHour(sunStudy.hour)} · {MONTH_LABELS[sunStudy.month]} · matahari di{" "}
            <span className="font-medium">{compassLabel(solar.azimuthCompassDeg)}</span>,{" "}
            {belowHorizon ? "di bawah horizon" : `${Math.round(solar.elevationDeg)}° di atas horizon`}
          </p>
          <div className="space-y-1">
            <Label className="text-xs">Jam — {formatHour(sunStudy.hour)}</Label>
            <Slider
              min={5}
              max={19}
              step={0.25}
              value={[sunStudy.hour]}
              onValueChange={([v]) => setHour(v)}
              aria-label="Jam studi matahari"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bulan — {MONTH_LABELS[sunStudy.month]}</Label>
            <Slider
              min={0}
              max={11}
              step={1}
              value={[sunStudy.month]}
              onValueChange={([v]) => setMonth(v)}
              aria-label="Bulan studi matahari"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            data-testid="sun-study-play"
            onClick={() => {
              if (!playing && sunStudy.hour >= 17.9) setHour(6) // ulang dari pagi
              setPlaying((p) => !p)
            }}
          >
            {playing ? "Jeda" : "Putar sehari (6→18)"}
          </Button>
          <p className="text-[10px] leading-tight text-muted-foreground">
            Lokasi: {project.site.city ?? project.city ?? "—"} (lintang {latitude.toFixed(1)}°).
            Perkiraan lintasan; abaikan geseran menit.
          </p>
        </>
      )}
    </div>
  )
}