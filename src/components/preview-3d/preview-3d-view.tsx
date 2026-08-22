"use client"

import * as React from "react"
import Link from "next/link"
import { PanelRightOpen, RotateCcw, TriangleAlert } from "lucide-react"

import type { DesignLayout, Project } from "@/types"
import type { SavedInterior } from "@/lib/schemas/interior"
import { interiorRooms, interiorStyleFromHouseStyle } from "@/lib/interior/plan"
import { isPartialRooftop } from "@/lib/geometry/rooftop"
import { isWebGLAvailable } from "@/lib/three/webgl-support"
import { useInteriorStore } from "@/stores/interior-store"
import { usePreviewStore } from "@/stores/preview-store"
import { useInterior } from "@/lib/api/hooks"
import { useInteriorAutosave } from "@/hooks/use-interior-autosave"
import { useLayoutAutosave } from "@/hooks/use-layout-autosave"
import { routeRedo, routeUndo } from "@/hooks/use-unified-undo"
import { useFokusMode } from "@/hooks/use-fokus-mode"
import { useEditorStore } from "@/stores/editor-store"
import { actionsForContext } from "@/components/editor/context-menu/action-registry"
import {
  EditorCursorMenu,
  type CursorMenuState,
} from "@/components/editor/context-menu/cursor-menu"
import { useSaveStatusStore } from "@/stores/save-status-store"
import { Button } from "@/components/ui/button"
import { FloatingPanel, PanelDrawer } from "@/components/layout/floating-panel"
import { CompassRose } from "@/components/ui/compass-rose"
import { HouseScene } from "./house-scene"
import { FloorToggleBar } from "./floor-toggle-bar"
import { ViewToolbar } from "./view-toolbar"
import { initSelectionBridge } from "./selection-bridge"
import { AssetPickerHost } from "@/components/assets/asset-picker-host"
import { ComponentStudioHost } from "@/components/studio/component-studio"
import {
  PreviewControlsBody,
  PreviewControlsHeaderActions,
} from "./preview-controls"

/**
 * Kompas 3D: mendaftarkan elemen jarumnya ke preview-store; rotasi ditulis
 * langsung oleh CompassBridge (di dalam Canvas) tiap frame render — tanpa
 * re-render React di sini (pola setCanvas/captureFrame).
 */
function Compass3DOverlay() {
  const setCompassEl = usePreviewStore((s) => s.setCompassEl)
  const ref = React.useCallback(
    (el: HTMLDivElement | null) => setCompassEl(el),
    [setCompassEl],
  )
  return (
    <div className="absolute bottom-3 left-3 z-10">
      <CompassRose ref={ref} className="size-12" />
    </div>
  )
}

export function Preview3DView({
  layout,
  project,
  initialRoomId,
  readOnly = false,
  presetInterior = null,
}: {
  layout: DesignLayout
  project: Project
  initialRoomId?: string
  /**
   * Viewer publik read-only (mis. template gallery): tanpa fetch ber-auth,
   * tanpa autosave, tanpa mutasi. Memaksa `interactionMode` ke "view" (kamera/
   * orbit, ganti lantai, mode tampilan tetap jalan), menyembunyikan panel
   * Properti, menu klik-kanan, dan affordance mode Edit.
   */
  readOnly?: boolean
  /**
   * Dokumen interior pra-hitung (bentuk sama dengan hasil `useInterior`) —
   * dipakai SEBAGAI PENGGANTI fetch saat `readOnly`, supaya viewer publik
   * tidak memanggil endpoint ber-auth.
   */
  presetInterior?: SavedInterior | null
}) {
  const initFloors = usePreviewStore((s) => s.initFloors)
  const setShowRoof = usePreviewStore((s) => s.setShowRoof)
  const previewRoomId = usePreviewStore((s) => s.selectedRoomId)
  const selectPreviewRoom = usePreviewStore((s) => s.selectRoom)
  const loadInterior = useInteriorStore((s) => s.load)
  const interiorRoomId = useInteriorStore((s) => s.selectedRoomId)
  const selectInteriorRoom = useInteriorStore((s) => s.selectRoom)

  // readOnly: hook tetap dipanggil unconditional (rules-of-hooks) — `enabled`
  // menutup fetch/efek di dalamnya; `saved`/status jadi turunan lokal.
  const { data: fetchedSaved, isLoading: fetchedSavedLoading } = useInterior(
    project.id,
    { enabled: !readOnly }
  )
  const saved = readOnly ? (presetInterior ?? undefined) : fetchedSaved
  const savedLoading = readOnly ? false : fetchedSavedLoading
  const saveStatus = useInteriorAutosave(project.id, { enabled: !readOnly })
  // Edit-dari-3D (pintu/jendela) memutasi editor store — autosave layout ikut
  // berjalan di halaman ini, sama seperti di 2D editor. Nonaktif saat readOnly.
  const layoutSaveStatus = useLayoutAutosave(project.id, { enabled: !readOnly })
  const layoutDirty = useEditorStore((s) => s.dirty)
  const reportSaveStatus = useSaveStatusStore((s) => s.report)
  // Fokus (Fase 5 — dulu cleanMode lokal 3D-only): hook bersama dgn 2D
  // (editor-toolbar.tsx) — sinkron sidebar & reset-on-unmount kini hidup di
  // dalam hook, bukan lagi diduplikasi di sini.
  const { fokusMode } = useFokusMode()

  // Status autosave gabungan (interior + layout) di header workspace. readOnly:
  // tidak pernah reportSaveStatus sama sekali (tanpa autosave, tak ada yang
  // relevan untuk dilaporkan).
  React.useEffect(() => {
    if (readOnly) return
    const combined =
      layoutSaveStatus === "conflict"
        ? "conflict"
        : saveStatus === "error" || layoutSaveStatus === "error"
          ? "error"
          : saveStatus === "saving" || layoutSaveStatus === "saving"
            ? "saving"
            : saveStatus === "saved" || layoutSaveStatus === "saved"
              ? "saved"
              : "idle"
    reportSaveStatus(combined, layoutDirty)
  }, [readOnly, saveStatus, layoutSaveStatus, layoutDirty, reportSaveStatus])
  React.useEffect(() => () => useSaveStatusStore.getState().reset(), [])

  // readOnly: paksa mode tampilan (bukan Edit) — menutup jalur edit-dari-3D
  // (pintu/jendela/quick editor di house-model.tsx & house-scene.tsx, yang
  // semuanya gated di belakang interactionMode === "edit"). Sekali per mount;
  // toggle "E"/tombol Edit disembunyikan/di-guard di bawah supaya tak lolos.
  React.useEffect(() => {
    if (readOnly) usePreviewStore.getState().setInteractionMode("view")
  }, [readOnly])

  // Mirror seleksi terpadu editor-store → field legacy preview-store
  // (unifikasi P1) — seleksi yang dibuat di 2D langsung terlihat di sini.
  React.useEffect(() => initSelectionBridge(), [])

  // Tablet (<lg): tap entity non-ruang di 3D → auto-buka drawer Kontrol
  // (kartu editornya di sana). Nonce naik tiap select(), termasuk tap ulang.
  const [controlsDrawerOpen, setControlsDrawerOpen] = React.useState(false)
  const selectionNonce = useEditorStore((s) => s.selectionNonce)
  const selectedKind = useEditorStore((s) => s.selected?.kind ?? null)
  const firstNonceRef = React.useRef(true)
  React.useEffect(() => {
    if (firstNonceRef.current) {
      firstNonceRef.current = false
      return
    }
    if (!selectedKind || selectedKind === "room") return
    if (window.matchMedia("(min-width: 64rem)").matches) return // desktop: panel kanan
    setControlsDrawerOpen(true)
  }, [selectionNonce, selectedKind])

  // Track initial load vs autosave re-render to avoid resetting furniture selection
  const loadedRef = React.useRef(false)
  // Auto-enable the roof toggle at most once per mount, so a user's later manual
  // toggle-off isn't re-forced when the (live editor) layout ref changes.
  const didAutoEnableRoof = React.useRef(false)

  // initFloors HANYA saat susunan lantai berubah (id join) — dulu deps [layout]
  // sehingga SETIAP edit dari 3D/autosave me-reset visibilitas lantai (dollhouse
  // fly-to-room buyar) & mengembalikan lantai yang sengaja disembunyikan.
  const floorIdsSig = layout.floors.map((f) => f.id).join("|")
  const floorsSigRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (floorsSigRef.current === floorIdsSig) return
    floorsSigRef.current = floorIdsSig
    initFloors(layout.floors.map((f) => f.id))
    // A partial rooftop has roof strips over the non-deck footprint — show them
    // by default (user Q4), but only the first time (respect a later manual OFF).
    // Full-rooftop / non-rooftop keep the store default.
    if (isPartialRooftop(layout) && !didAutoEnableRoof.current) {
      setShowRoof(true)
      didAutoEnableRoof.current = true
    }
  }, [floorIdsSig, layout, initFloors, setShowRoof])

  // Keyboard shortcuts: "Escape" exits clean mode, else membersihkan seleksi
  // terpadu (kontrak sama dgn 2D — unifikasi P1). Ctrl+Z / Ctrl+Shift+Z =
  // undo/redo terpadu (Fase 4): tombolnya kini di rail ViewToolbar via
  // useUnifiedUndo, tapi shortcut-nya perlu tetap hidup di level halaman —
  // dipindah ke sini dari listener lokal PreviewControlsHeaderActions yang
  // dihapus. readOnly: tak ada mutasi yang boleh terjadi, jadi shortcut ini
  // di-skip sepenuhnya (samakan dgn guard "E" lama).
  //
  // "E" (toggle Edit/View) DIHAPUS — konsep interactionMode di UI dihapus;
  // user selalu edit-capable, interactionMode kini murni gate readOnly
  // (lihat efek di atas & komentar di preview-store.ts).
  //
  // Escape (Fase 5): HANYA clearSelection bila memang ada seleksi aktif, dan
  // memanggil preventDefault() saat itu terjadi — `useFokusMode()` (dipakai
  // di ProjectBar/ViewToolbar) punya listener Escape TERPISAH yang keluar
  // dari mode fokus, tapi menunda pengecekan `defaultPrevented` satu tick
  // (lihat use-fokus-mode.ts) supaya "Escape membatalkan seleksi" di sini
  // SELALU menang lebih dulu tanpa perlu koordinasi urutan listener eksplisit.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        if (readOnly) return
        e.preventDefault()
        if (e.shiftKey) routeRedo()
        else routeUndo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape" && useEditorStore.getState().selected !== null) {
        e.preventDefault()
        useEditorStore.getState().clearSelection()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [readOnly])

  React.useEffect(() => {
    if (savedLoading) return
    const firstInteriorRoom = interiorRooms(layout)[0]?.id
    const requestedRoom = initialRoomId ?? firstInteriorRoom
    loadInterior({
      projectId: project.id,
      layout,
      style: interiorStyleFromHouseStyle(project.style),
      initialRoomId: requestedRoom,
      saved: saved ?? undefined,
      site: project.site,
    })
    // Only auto-select room on initial load, not on every autosave cycle.
    // Autosave re-runs this effect (saved changes) but the guard in loadInterior
    // short-circuits — we must NOT re-select the room here because it would
    // trigger selectInteriorRoom → selectedFurnitureId = null.
    // Seleksi bawaan dari 2D (seleksi terpadu) MENANG atas auto-select ruang
    // pertama — jangan menimpanya saat user baru pindah halaman.
    if (!loadedRef.current && requestedRoom) {
      if (!useEditorStore.getState().selected) selectPreviewRoom(requestedRoom)
      loadedRef.current = true
    }
  }, [initialRoomId, layout, loadInterior, project.id, project.site, project.style, selectPreviewRoom, saved, savedLoading])

  React.useEffect(() => {
    if (previewRoomId) selectInteriorRoom(previewRoomId)
  }, [previewRoomId, selectInteriorRoom])

  React.useEffect(() => {
    if (!previewRoomId && interiorRoomId) selectPreviewRoom(interiorRoomId)
  }, [interiorRoomId, previewRoomId, selectPreviewRoom])

  // ── Menu klik-kanan 3D — beraksi pada entity yang sedang terpilih
  // (klik-kanan mesh memilihnya lebih dulu via onContextMenu di house-model).
  // readOnly: menu ini SELALU tertutup — semua aksinya memutasi editor store. ──
  const selected3d = useEditorStore((s) => s.selected)
  const menu3dItems = readOnly
    ? []
    : actionsForContext({
        ref: selected3d,
        point: null,
        layout,
        store: useEditorStore.getState(),
        openAddRoom: () => {},
      })
  const [menu3dState, setMenu3dState] = React.useState<CursorMenuState>({ open: false, x: 0, y: 0 })
  const close3dMenu = React.useCallback(() => setMenu3dState((s) => ({ ...s, open: false })), [])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        onContextMenu={(e) => {
          e.preventDefault()
          if (readOnly) return
          setMenu3dState({ open: true, x: e.clientX, y: e.clientY })
        }}
      >
        {isWebGLAvailable() ? (
          <SceneBoundary projectId={project.id} readOnly={readOnly}>
            <HouseScene layout={layout} site={project.site} project={project} />
          </SceneBoundary>
        ) : (
          <Scene3DUnavailable projectId={project.id} readOnly={readOnly} />
        )}
      </div>
      {!readOnly && <EditorCursorMenu state={menu3dState} items={menu3dItems} onClose={close3dMenu} />}

        {/* Floor visibility + exploded view. Desktop: terpusat. Mobile: dibatasi
            ke PITA di antara toolbar kiri (left-14) & drawer kanan (right-14)
            dan bisa di-scroll — dulu `left-1/2 -translate-x-1/2` meluber ke kiri
            di layar sempit dan menumpuk ViewToolbar (bug "2 bar kiri berantakan"). */}
        {/* Bar di-center di RUANG BEBAS antara rail kiri & panel kanan
            (w-[24rem]) — center viewport penuh membuat ujung kanan bar
            tertutup panel saat pill lantai banyak (mis. 1280×720). */}
        <div className="absolute left-14 right-14 top-3 z-10 overflow-x-auto lg:left-16 lg:right-[26rem] lg:overflow-visible">
          <div className="mx-auto w-max">
            <FloorToggleBar floors={layout.floors} />
          </div>
        </div>

        {/* Sudut pandang / pencahayaan / opsi tampilan — toolbar kiri.
            Mobile: batasi tinggi kolom + biar scroll internal bila melebihi. */}
        <div className="absolute left-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto">
          <ViewToolbar layout={layout} project={project} />
        </div>

        {/* Arah mata angin — jarum diputar CompassBridge (dalam Canvas)
            mengikuti azimut kamera, langsung via style.transform. Ikut
            disembunyikan mode bersih agar screenshot tetap polos. */}
        {!fokusMode && <Compass3DOverlay />}

        {/* Panel Properti + drawer mobile: SELURUHNYA jalur
            edit (quick-add kolam/tangga, gaya fasad, inspector terpadu,
            asisten AI, dst.) — disembunyikan total saat readOnly, bukan
            di-disable satu-satu. Navigasi kamera/lantai/tampilan (di atas)
            tidak tersentuh, tetap berfungsi penuh. */}
        {!readOnly && (
          <>
            {/* Mobile controls — mode bersih ikut menyembunyikannya. Controlled:
                tablet auto-membuka drawer saat entity NON-ruang di-tap di 3D
                (kartu editornya di dalam drawer ini — dulu tap diam-diam memilih
                tanpa UI apa pun). Tap ruang dikecualikan: dipakai utk navigasi/
                fly-to & auto-select saat load — auto-popup justru mengganggu.
                PanelDrawer (Fase 6) menggantikan Drawer hand-rolled — satu
                idiom mobile bersama dgn editor 2D. */}
            {!fokusMode && (
              <div className="absolute right-3 top-3 z-10 lg:hidden">
                <PanelDrawer
                  title="Properti — Preview 3D"
                  triggerLabel="Properti 3D"
                  triggerIcon={<PanelRightOpen />}
                  open={controlsDrawerOpen}
                  onOpenChange={setControlsDrawerOpen}
                >
                  <PreviewControlsBody layout={layout} project={project} />
                </PanelDrawer>
              </div>
            )}

            {/* Mode bersih menyembunyikan isi panel, tapi pill "Preview 3D" tetap
                tampil — mengkliknya membuka panel sejenak tanpa keluar dari mode
                bersih (tombol minimize di header panel mengembalikan ke pill).
                Fase 6: tab "Asisten Interior" DIHAPUS (stub yang cuma
                mengarahkan ke AI Agent global) — satu section "Properti" saja,
                jadi title kini judul statis, bukan lagi PanelTab berpasangan. */}
            <FloatingPanel
              side="right"
              testId="preview-floating-sidebar"
              bodyTestId="preview-controls-scroll"
              storageKey="panel:preview3d"
              widthClass="w-[24rem]"
              bodyClassName="space-y-3"
              minimizeLabel="Preview 3D"
              forceMinimized={fokusMode}
              title={
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  {/* Nama panel utk pembaca layar & e2e. */}
                  <h2 className="sr-only">Preview 3D</h2>
                  <span className="truncate px-2 py-1.5 text-xs font-medium text-foreground">
                    Properti
                  </span>
                </div>
              }
              actions={<PreviewControlsHeaderActions />}
            >
              <PreviewControlsBody layout={layout} project={project} />
            </FloatingPanel>
          </>
        )}

        {/* Picker My Library global — dipakai inspector terpadu & quick editor
            (id entity ditangkap saat request; lihat asset-picker-host). Tidak
            ada pemanggilnya saat readOnly (panel yang memintanya disembunyikan
            di atas) — tak perlu dipasang. */}
        {!readOnly && <AssetPickerHost projectId={project.id} />}
        {!readOnly && <ComponentStudioHost />}
    </div>
  )
}

/**
 * Fallback saat 3D tak bisa ditampilkan — dipakai DUA jalur: (1) proaktif,
 * saat `isWebGLAvailable()` sudah tahu sebelum mount (kasus umum: GPU
 * process gagal boot/di-disable — lihat komentar di webgl-support.ts kenapa
 * error boundary saja tak cukup), dan (2) reaktif via `SceneBoundary` di
 * bawah, untuk kegagalan lain yang baru ketahuan SETELAH mount (mis. context
 * hilang di tengah sesi, error compile shader).
 */
function Scene3DUnavailable({
  projectId,
  onRetry,
  readOnly = false,
}: {
  projectId: string
  onRetry?: () => void
  /** Viewer publik: sembunyikan "Buka 2D Editor" — link itu menuju halaman
   *  ber-login yang tak relevan/tak bisa diakses pengunjung publik. */
  readOnly?: boolean
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border bg-card p-6 text-center">
        <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-warning/15 text-warning">
          <TriangleAlert className="size-5" />
        </div>
        <h3 className="font-semibold">Gagal memuat preview 3D</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {readOnly
            ? "Browser/perangkat mungkin tidak mendukung 3D."
            : "Denah tetap aman tersimpan. Browser/perangkat mungkin tidak mendukung 3D. Coba buka editor denah 2D."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw /> Coba lagi
            </Button>
          )}
          {!readOnly && (
            <Button asChild size="sm">
              <Link href={`/app/projects/${projectId}/editor`}>
                Buka 2D Editor
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* Error boundary → fallback reaktif untuk kegagalan 3D SETELAH mount (PRD §10.7, §24). */
class SceneBoundary extends React.Component<
  { projectId: string; readOnly?: boolean; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { projectId: string; readOnly?: boolean; children: React.ReactNode }) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <Scene3DUnavailable
          projectId={this.props.projectId}
          onRetry={() => this.setState({ failed: false })}
          readOnly={this.props.readOnly}
        />
      )
    }
    return this.props.children
  }
}
