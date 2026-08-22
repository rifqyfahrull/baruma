"use client"

import * as React from "react"
import Link from "next/link"
import {
  Activity,
  Box,
  Building2,
  Camera,
  Eye,
  Focus,
  Grid2x2,
  Home,
  Redo2,
  Sun,
  Undo2,
} from "lucide-react"

import type { DesignLayout, Project } from "@/types"
import { usePreviewStore, type ViewPreset } from "@/stores/preview-store"
import { useProjectCapabilities } from "@/hooks/use-project-capabilities"
import { useToolbarCompact } from "@/hooks/use-toolbar-compact"
import { useUnifiedUndo } from "@/hooks/use-unified-undo"
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
import { FloatingBar, FloatingBarSeparator } from "@/components/chrome/floating-bar"
import { ToolButton } from "@/components/chrome/tool-button"
import { ToolbarMore } from "@/components/chrome/toolbar-more"

const VIEWS: { id: ViewPreset; label: string; icon: typeof Box }[] = [
  { id: "iso", label: "Isometrik", icon: Box },
  { id: "front", label: "Depan", icon: Home },
  { id: "top", label: "Atas", icon: Grid2x2 },
  { id: "rooftop", label: "Rooftop", icon: Building2 },
]

function ToggleLine({
  label,
  checked,
  onChange,
  switchTestId,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  /** testid pada elemen Switch — dipakai saat toggle punya jangkar e2e/unit
   * test sendiri (mis. mode malam), bukan dicari lewat label teks. */
  switchTestId?: string
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={switchTestId} />
    </label>
  )
}

/** Satu baris menu di dalam flyout Popover (Kamera/Tampilan) — tombol lebar
 * penuh, ikon + label kiri, dipakai alih-alih idiom `DropdownMenuItem` (rail
 * ini konsisten pakai `Popover`, bukan menu — lihat catatan di ToolbarMore). */
function FlyoutRow({
  icon: Icon,
  children,
  ...rest
}: React.ComponentProps<typeof Button> & { icon: typeof Camera }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 text-xs"
      {...rest}
    >
      <Icon className="size-3.5" />
      {children}
    </Button>
  )
}

/**
 * Rail kiri kanvas 3D: `FloatingBar` vertikal berisi 10 `ToolButton` — undo/
 * redo terpadu (§Fase 4, dipindah dari header panel via `useUnifiedUndo`),
 * 4 preset sudut, tiga flyout Popover (Kamera/Cahaya/Tampilan), dan toggle
 * Fokus (mode bersih). Menggantikan idiom lama "Sudut pandang", "Pencahayaan",
 * "Opsi tampilan" di floating panel.
 *
 * Responsive: grup sekunder (Kamera/Cahaya/Tampilan/Fokus) menciut ke
 * `ToolbarMore` saat `useToolbarCompact` mendeteksi viewport sempit ATAU
 * tinggi rail nyata melebihi ruang tersisa — kontrol yang sama dipakai ulang
 * persis, tanpa duplikasi JSX.
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
  // Gating rollout §21: preset Tampilan Kerja/Presentasi hanya UI — scene tetap render.
  const capabilities = useProjectCapabilities(project.id)

  // Undo/redo terpadu (§Fase 4): heuristik routing 2D/interior TIDAK diubah
  // di sini — hanya dipindah ke `useUnifiedUndo`, dipakai bersama rail 2D.
  // Shortcut Ctrl+Z/Ctrl+Shift+Z didaftarkan terpisah di preview-3d-view.tsx
  // (level halaman, survive walau rail ini unmount/scroll).
  const { undo, redo, canUndo, canRedo } = useUnifiedUndo()

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

  // Rail sempit/pendek → grup sekunder (Kamera/Cahaya/Tampilan/Fokus) menciut
  // ke ToolbarMore; desktop lebar+tinggi → inline. Diukur langsung dari DOM
  // rail (bukan cuma breakpoint lebar) — lihat use-toolbar-compact.ts.
  const railRef = React.useRef<HTMLDivElement>(null)
  const compact = useToolbarCompact(railRef)

  // Grup sekunder — dipakai baik inline (rail lega) maupun di dalam
  // ToolbarMore (rail sempit/pendek). Logika identik, tanpa duplikasi.
  const secondaryControls = (
    <>
      {/* Kamera — flyout: Screenshot langsung, atau buka dialog Paket Foto. */}
      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Kamera">
            <Camera />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-56 space-y-1">
          <p className="pb-1 text-xs font-semibold">Kamera</p>
          <FlyoutRow icon={Camera} onClick={screenshot}>
            Screenshot
          </FlyoutRow>
          {/* Dialog "Paket Foto Presentasi" — trigger-nya dirender sebagai baris
              flyout (testid photo-package-open dipertahankan di baris ini). */}
          <PhotoPackage project={project} trigger="row" />
        </PopoverContent>
      </Popover>

      {/* Render AI — visualisasi bergaya foto (Fase 8). Digerbangi
          ai_render_v1 DI DALAM komponen (return null bila nonaktif). */}
      <AiRenderDialog project={project} layout={layout} />

      {/* Cahaya (dulu "Pencahayaan") */}
      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Cahaya" pressed={realistic}>
            <Sun />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-72 space-y-3">
          <p className="text-xs font-semibold">Cahaya</p>
          <ToggleLine label="Realistis (bayangan & langit)" checked={realistic} onChange={setRealistic} />
          <ToggleLine
            label="Mode malam (senja)"
            checked={nightMode}
            onChange={(v) => usePreviewStore.getState().setNightMode(v)}
            switchTestId="night-mode-toggle"
          />

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

      {/* "Tampilan" (nama rail di plan §Fase 4) — trigger tetap berlabel
          "Opsi tampilan" (TIDAK di-rename, beda dgn Cahaya): banyak spec e2e
          lain di luar cakupan fase ini (critical-flows, facade-shapes,
          certification-visual) masih mereferensikan nama tombol ini. Yang
          berubah cuma isinya — preset direlabel + scene-stats pindah masuk. */}
      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Opsi tampilan">
            <Eye />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-60 space-y-0.5">
          <p className="pb-1 text-xs font-semibold">Tampilan</p>
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
                Tampilan Kerja
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

          {/* Scene stats — dev-only, baris footer (dulu tombol rail terpisah). */}
          {sceneStats && (
            <>
              <div className="my-1 h-px bg-border" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={sceneStats.ok ? "ghost" : "destructive"}
                    size="sm"
                    className="w-full justify-start gap-2 text-xs"
                    data-testid="scene-stats-button"
                  >
                    <Activity className="size-3.5" />
                    Scene stats · dev only
                  </Button>
                </PopoverTrigger>
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
            </>
          )}
        </PopoverContent>
      </Popover>

      <FloatingBarSeparator />

      {/* Fokus (mode bersih) — perilaku & testid PERSIS sama seperti sebelumnya
          (rename/pemindahan state ditunda ke Fase 5). */}
      <ToolButton
        label="Mode bersih"
        pressed={cleanMode}
        data-testid="clean-mode-toggle"
        onClick={toggleCleanMode}
      >
        <Focus />
      </ToolButton>
    </>
  )

  return (
    <FloatingBar ref={railRef} data-testid="view-toolbar">
      {/* Mode bersih menyembunyikan ProjectTabs (satu-satunya navigasi 2D↔3D)
          — sediakan jalan pintas ke editor 2D di sini. Inline di atas (bukan
          di secondaryControls) supaya tak terlipat ke ToolbarMore di rail
          sempit.
          TODO(Fase 5): dihapus begitu switcher [2D|3D] pill bar (floor-
          switcher/floor-toggle-bar) sudah jadi jalan keluar 2D yang selalu
          ada — sampai saat itu, link ini adalah satu-satunya cara keluar
          mode bersih ke 2D. */}
      {cleanMode && !readOnly && (
        <>
          <ToolButton asChild label="Buka 2D Editor" data-testid="clean-mode-2d-link">
            <Link href={`/app/projects/${project.id}/editor`}>
              <span className="text-xs font-bold">2D</span>
            </Link>
          </ToolButton>
          <FloatingBarSeparator />
        </>
      )}

      {/* Undo/redo terpadu — selalu inline di puncak rail. */}
      <ToolButton label="Undo" shortcut=" (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" shortcut=" (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </ToolButton>

      <FloatingBarSeparator />

      {/* Sudut pandang — selalu inline */}
      {VIEWS.map((v) => (
        <ToolButton
          key={v.id}
          label={`Sudut pandang ${v.label}`}
          pressed={viewPreset === v.id}
          exclusive
          onClick={() => requestView(v.id)}
        >
          <v.icon />
        </ToolButton>
      ))}

      <FloatingBarSeparator />

      {/* Grup sekunder: inline di rail lega, atau di dalam ToolbarMore (⋯)
          ketika ruang tak mencukupi (tablet/pendek). */}
      {compact ? (
        <ToolbarMore data-testid="view-toolbar-more">{secondaryControls}</ToolbarMore>
      ) : (
        secondaryControls
      )}
    </FloatingBar>
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
