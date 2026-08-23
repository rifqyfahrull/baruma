"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useParams } from "next/navigation"
import {
  Loader2,
  Maximize,
  Monitor,
  PanelRightOpen,
  Save,
  Sparkles,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { toast } from "sonner"

import { useLayout, useProject, useSaveLayout } from "@/lib/api/hooks"
import { usePageView } from "@/lib/analytics"
import { useEditorStore } from "@/stores/editor-store"
import { useEditorPanelUiStore } from "@/stores/editor-panel-ui-store"
import { structuralNotes } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { CompassRose } from "@/components/ui/compass-rose"
import { FloatingBar } from "@/components/chrome/floating-bar"
import { ToolButton } from "@/components/chrome/tool-button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { PlanCanvas } from "@/components/editor/plan-canvas"
import { EditorToolbar } from "@/components/editor/editor-toolbar"
import { FloorSwitcher } from "@/components/editor/floor-switcher"
import { useWarningPrefs } from "@/hooks/use-warning-prefs"
import { FloatingPanel, PanelDrawer, PanelTab } from "@/components/layout/floating-panel"
import { useLayoutAutosave } from "@/hooks/use-layout-autosave"
import { useSaveStatusStore } from "@/stores/save-status-store"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Bundle trim (G2b): none of these three are needed for first paint — the
// canvas/toolbar/floor-switcher above must render immediately, but the
// inspector (visible only once a layout is loaded and, on FloatingPanel,
// often starts minimized), the audit card + warnings list (behind the "Cek"
// tab) and the asset picker (a Sheet closed until something requests it) can
// all load in a trailing chunk instead of the editor route's first-load JS.
const EditorInspector = dynamic(
  () => import("@/components/editor/editor-inspector").then((m) => m.EditorInspector),
  { loading: () => <InspectorSkeleton /> }
)
const ComponentStudioHost = dynamic(
  () => import("@/components/studio/component-studio").then((m) => m.ComponentStudioHost),
  { ssr: false },
)
const AssetPickerHost = dynamic(
  () => import("@/components/assets/asset-picker-host").then((m) => m.AssetPickerHost),
  { ssr: false }
)
const DesignAuditCard = dynamic(
  () => import("@/components/assistant/design-audit-card").then((m) => m.DesignAuditCard),
  { loading: () => <AuditCardSkeleton /> }
)
const EditorWarningsList = dynamic(
  () => import("@/components/editor/editor-warnings-panel").then((m) => m.EditorWarningsList),
  { loading: () => <AuditCardSkeleton /> }
)

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const { data: layoutDocument, isLoading } = useLayout(projectId)
  const layout = layoutDocument?.layout ?? null

  const loadLayout = useEditorStore((s) => s.loadLayout)
  const storeLayoutId = useEditorStore((s) => s.layout?.id)
  const loadedRef = React.useRef<string | null>(null)

  usePageView("editor_opened", { project_id: projectId })

  // Load once per layout into the editor store (refetch won't clobber edits).
  React.useEffect(() => {
    const revision = layoutDocument?.revision
    if (!layout || !project || !revision) return
    if (loadedRef.current === layout.id) return
    loadLayout(layout, project.site, structuralNotes(project, layout), revision)
    loadedRef.current = layout.id
  }, [layout, layoutDocument?.revision, project, loadLayout])

  if (isLoading) return <EditorSkeleton />
  if (!layout) {
    return (
      <div className="p-6">
        <EmptyState
          title="Layout belum tersedia"
          description="Pilih salah satu alternatif layout dulu, lalu kembali ke editor."
        />
      </div>
    )
  }
  if (!storeLayoutId) return <EditorSkeleton />

  return <EditorClient projectId={projectId} />
}

function EditorClient({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId)
  const save = useSaveLayout(projectId)
  const dirty = useEditorStore((s) => s.dirty)
  const layoutRevision = useEditorStore((s) => s.layoutRevision)
  const markSaved = useEditorStore((s) => s.markSaved)
  const deleteSelected = useEditorStore((s) => s.deleteSelected)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const selectObject = useEditorStore((s) => s.selectObject)
  const setTool = useEditorStore((s) => s.setTool)
  const zoomBy = useEditorStore((s) => s.zoomBy)
  const resetView = useEditorStore((s) => s.resetView)
  // Fase 6: state tab panel kanan (Properti | Cek) dipindah ke store kecil
  // (bukan lagi useState lokal) — marker warning di kanvas (pohon komponen
  // TERPISAH, di dalam <svg> PlanCanvas) perlu memicu "pindah ke tab Cek +
  // fokus baris ybs" tanpa props-drilling lintas dua sub-tree yang tak
  // bertetangga. Lihat src/stores/editor-panel-ui-store.ts.
  const sidePanel = useEditorPanelUiStore((s) => s.sidePanel)
  const setSidePanel = useEditorPanelUiStore((s) => s.setSidePanel)
  const injectAgentDraft = useProjectAgentUiStore((s) => s.injectDraft)
  const agentOpen = useProjectAgentUiStore((s) => s.open)
  const autosaveStatus = useLayoutAutosave(projectId)
  const reportSaveStatus = useSaveStatusStore((s) => s.report)
  const warnings = useWarningPrefs(projectId)

  // Tablet/mobile (<lg, panel kanan tak ada): tap objek di kanvas AUTO-membuka
  // drawer Properti — dulu seleksi diam-diam terjadi tanpa UI apa pun dan user
  // harus tahu sendiri ada tombol drawer. Nonce naik tiap select() (termasuk
  // memilih ulang objek yang sama), jadi tap ulang juga membuka kembali. Union
  // (bukan boolean) karena mobile kini punya DUA drawer (Properti/Cek, Fase 6)
  // — hanya satu yang boleh terbuka sekaligus.
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = React.useState<
    "properti" | "cek" | null
  >(null)
  const selectionNonce = useEditorStore((s) => s.selectionNonce)
  const hasSelection = useEditorStore((s) => s.selected !== null)
  // Guard "run pertama" berbasis NILAI nonce, bukan boolean sekali-pakai:
  // boolean patah di StrictMode (efek mount jalan 2x — invokasi kedua lolos
  // guard dan membuka drawer tanpa interaksi user).
  const lastSelectionNonceRef = React.useRef(selectionNonce)
  React.useEffect(() => {
    if (lastSelectionNonceRef.current === selectionNonce) return
    lastSelectionNonceRef.current = selectionNonce
    if (!hasSelection) return
    if (window.matchMedia("(min-width: 64rem)").matches) return // desktop: panel kanan
    // PRA-EXISTING (bukan dari WS-A): setState sinkron dalam effect, respons
    // ke nonce eksternal (bukan derivable dari state React) — lihat TODOS.md P1.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInspectorDrawerOpen("properti")
  }, [selectionNonce, hasSelection])

  // Marker warning di kanvas (mobile): klik → focusWarning() menaikkan
  // focusNonce di store bersama → buka drawer Cek (paritas dgn auto-open
  // drawer Properti di atas saat objek biasa dipilih).
  const focusNonce = useEditorPanelUiStore((s) => s.focusNonce)
  const lastFocusNonceRef = React.useRef(focusNonce)
  React.useEffect(() => {
    if (lastFocusNonceRef.current === focusNonce) return
    lastFocusNonceRef.current = focusNonce
    if (window.matchMedia("(min-width: 64rem)").matches) return // desktop: panel kanan
    // PRA-EXISTING (bukan dari WS-A): lihat catatan di atas (TODOS.md P1).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInspectorDrawerOpen("cek")
  }, [focusNonce])

  // Status autosave (+dirty) tampil di header workspace, di bawah nama project.
  React.useEffect(() => {
    reportSaveStatus(autosaveStatus, dirty)
  }, [autosaveStatus, dirty, reportSaveStatus])
  React.useEffect(() => () => useSaveStatusStore.getState().reset(), [])
  React.useEffect(() => () => useEditorPanelUiStore.getState().reset(), [])

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        deleteSelected()
      } else if (e.key === "Escape") {
        // Fase 5: preventDefault() HANYA saat memang ada seleksi dibatalkan —
        // `useFokusMode()` (ProjectBar/EditorToolbar) punya listener Escape
        // terpisah yang keluar dari mode fokus, dan menunda pengecekan
        // `defaultPrevented` satu tick (lihat use-fokus-mode.ts) supaya
        // "Escape membatalkan seleksi" di sini selalu menang lebih dulu.
        if (useEditorStore.getState().selected !== null) {
          e.preventDefault()
          selectObject(null)
        }
      } else if (e.key.toLowerCase() === "v") {
        setTool("select")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo, deleteSelected, selectObject, setTool])

  const onSave = async () => {
    const current = useEditorStore.getState().layout
    const revision = useEditorStore.getState().layoutRevision
    const savedEditSequence = useEditorStore.getState().editSequence
    if (!current || !revision) return
    try {
      const document = await save.mutateAsync({ layout: current, expectedRevision: revision })
      markSaved(savedEditSequence, document.revision)
      toast.success("Layout tersimpan.")
    } catch {
      toast.error("Gagal menyimpan layout.")
    }
  }

  // "Simpan sekarang" di popover status-simpan ProjectBar (Fase 5): save di
  // halaman ini PAGE-LOCAL (menutup atas useEditorStore + mutation React
  // Query) — bukan aksi global yang bisa dipanggil dari layout. Daftarkan
  // closure-nya lewat ref supaya ProjectBar bisa memanggilnya tanpa
  // memindahkan logika simpan itu sendiri ke store (lihat komentar di
  // save-status-store.ts). ref selalu diperbarui tiap render supaya handler
  // terdaftar tidak pernah stale walau onSave dibuat ulang tiap render.
  const onSaveRef = React.useRef(onSave)
  React.useEffect(() => {
    onSaveRef.current = onSave
  })
  React.useEffect(() => {
    useSaveStatusStore.getState().registerSaveHandler(() => onSaveRef.current())
    return () => useSaveStatusStore.getState().registerSaveHandler(null)
  }, [])

  const addWarningToAiContext = React.useCallback((text: string) => {
    injectAgentDraft(text, "floorplan")
  }, [injectAgentDraft])

  // Isi tab "Cek": daftar peringatan (porting popover lama, Fase 6) + audit
  // standar desain — dipakai baik di panel desktop maupun drawer mobile.
  const cekTabContent = (
    <div className="flex h-full min-h-0 flex-col">
      <EditorWarningsList
        layout={warnings.layout}
        issues={warnings.issues}
        prefs={warnings.prefs}
        updateIssuePrefs={warnings.updateIssuePrefs}
        onAddToAiContext={addWarningToAiContext}
      />
      {project && <DesignAuditCard project={project} onFix={addWarningToAiContext} />}
      <div className="p-3">
        <Button className="w-full" onClick={() => injectAgentDraft("", "floorplan")}>
          <Sparkles /> Buka AI Agent
        </Button>
      </div>
    </div>
  )

  return (
    <div className={cn("relative flex h-full min-h-0 transition-[padding] duration-300", agentOpen && "lg:pr-[28rem]")}>
      <div className="relative min-w-0 flex-1">
        {/* Mobile hint */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-warning/15 px-3 py-1.5 text-xs text-warning-foreground lg:hidden">
          <Monitor className="size-3.5 shrink-0" />
          Editing denah lebih nyaman di laptop/desktop.
        </div>

        <PlanCanvas />

        {/* Arah mata angin — statis: atas kanvas 2D = utara (plan-y → dunia-z,
            utara = −z; lihat lib/three/compass.ts & solar.ts). */}
        <div className="absolute bottom-3 left-3 z-10">
          <CompassRose className="size-12" />
        </div>

        {/* Zoom cluster (Fase 3): dipindah dari rail vertikal ke sini agar
            rail tetap 11 tombol. Diposisikan bottom-CENTER, bukan
            bottom-right — `FloatingPanel` desktop (`side="right"`) memakai
            `absolute inset-y-4 right-4 w-80`, yaitu HAMPIR SELURUH tinggi
            viewport di kolom kanan; bottom-right akan selalu tumpang tindih
            dengan panel itu (kecuali di-minimize), jadi bottom-center yang
            aman di semua breakpoint (tak dipakai elemen lain). */}
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <FloatingBar orientation="horizontal">
            <ToolButton label="Perkecil" onClick={() => zoomBy(1 / 1.2)}>
              <ZoomOut className="size-4" />
            </ToolButton>
            <ToolButton label="Pas ke layar" onClick={resetView}>
              <Maximize className="size-4" />
            </ToolButton>
            <ToolButton label="Perbesar" onClick={() => zoomBy(1.2)}>
              <ZoomIn className="size-4" />
            </ToolButton>
          </FloatingBar>
        </div>

        {/* Toolbar. Safety-net CSS terhadap tinggi viewport (independen dari
            deteksi compact JS di EditorToolbar): tanpa ini toolbar yang lebih
            panjang dari layar meluber diam-diam ke luar viewport alih-alih
            terlihat/di-scroll. */}
        <div className="absolute left-3 top-10 z-10 max-h-[calc(100dvh-3.25rem)] overflow-y-auto lg:top-3 lg:max-h-[calc(100dvh-1.5rem)]">
          <EditorToolbar />
        </div>

        {/* Floor switcher. Desktop: terpusat. Mobile: dibatasi ke pita di antara
            toolbar kiri & tombol kanan + scroll — cegah tumpang-tindih di layar
            sempit (paritas fix floating bar 3D). */}
        {/* Center di ruang bebas antara rail kiri & panel kanan (w-80) —
            paritas fix bar 3D; center viewport penuh bisa tabrakan panel. */}
        <div className="absolute left-14 right-14 top-10 z-10 overflow-x-auto lg:left-16 lg:right-[22rem] lg:top-3 lg:overflow-visible">
          <div className="mx-auto w-max">
            <FloorSwitcher />
          </div>
        </div>

        {/* Save bar — mobile only. Kontrol Simpan + status autosave desktop
            dipindah ke header FloatingPanel agar tidak tertutup panel. */}
        <div className="absolute right-3 top-10 z-10 flex items-center gap-2 lg:top-3 lg:hidden">
          <SaveControls
            variant="overlay"
            dirty={dirty}
            disabled={!layoutRevision}
            pending={save.isPending}
            onSave={onSave}
          />

          {/* Satu AI Agent global; konteks Denah dipilih eksplisit. */}
          <Button
            size="icon"
            variant="outline"
            aria-label="Buka AI Agent untuk Denah"
            onClick={() => injectAgentDraft("", "floorplan")}
          >
            <Sparkles />
          </Button>

          {/* Mobile/tablet: Cek — badge unread sama dgn tab desktop. */}
          <PanelDrawer
            title="Cek"
            triggerLabel={`Peringatan denah (${warnings.unread} belum dibaca dari ${warnings.issues.length})`}
            triggerIcon={
              <span className="relative">
                <TriangleAlert />
                {warnings.unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">
                    {warnings.unread}
                  </span>
                )}
              </span>
            }
            open={inspectorDrawerOpen === "cek"}
            onOpenChange={(open) => setInspectorDrawerOpen(open ? "cek" : null)}
          >
            {cekTabContent}
          </PanelDrawer>

          {/* Mobile/tablet inspector — controlled: auto-open saat objek di-tap
              di kanvas (lihat efek selectionNonce di atas). */}
          <PanelDrawer
            title="Properti"
            triggerLabel="Properti"
            triggerIcon={<PanelRightOpen />}
            open={inspectorDrawerOpen === "properti"}
            onOpenChange={(open) => setInspectorDrawerOpen(open ? "properti" : null)}
          >
            <EditorInspector />
          </PanelDrawer>
        </div>

        {/* Desktop right panel: Properti / Asisten Denah — floating overlay.
            Positioned INSIDE the canvas container so its absolute right-4 is
            measured from the canvas edge, not the outer wrapper. When the AI
            Agent Sheet opens, the outer wrapper gets pr-[28rem] → this canvas
            shrinks → the panel follows without ending up behind the Sheet. */}
        <FloatingPanel
          side="right"
          testId="editor-floating-sidebar"
          storageKey="panel:editor"
          widthClass="w-80"
          minimizeLabel="Properti"
          bodyClassName="overflow-y-visible p-0"
          forceMinimized={agentOpen}
          actions={
            <SaveControls
              variant="header"
              dirty={dirty}
              disabled={!layoutRevision}
              pending={save.isPending}
              onSave={onSave}
            />
          }
          title={
            <div className="flex gap-1">
              <PanelTab active={sidePanel === "properti"} onClick={() => setSidePanel("properti")}>
                Properti
              </PanelTab>
              {/* Fase 6: "Cek & AI" (bell popover terpisah) → SATU model "Cek",
                  badge unread + aria-label pola lama "Peringatan denah (N
                  belum dibaca dari M)" — e2e critical-flows menemukan tab
                  ini lewat pola itu, dulu di tombol lonceng. */}
              <PanelTab
                active={sidePanel === "cek"}
                onClick={() => setSidePanel("cek")}
                badge={warnings.unread}
                ariaLabel={`Peringatan denah (${warnings.unread} belum dibaca dari ${warnings.issues.length})`}
              >
                Cek
              </PanelTab>
            </div>
          }
        >
          {sidePanel === "properti" ? <EditorInspector /> : cekTabContent}
        </FloatingPanel>

        {/* Picker My Library global — dipakai inspector terpadu (mis. model
            daun bukaan/gorden) juga dari halaman 2D; id entity ditangkap saat
            request (lihat asset-picker-host). */}
        <AssetPickerHost projectId={projectId} />
        <ComponentStudioHost />
      </div>
    </div>
  )
}

/**
 * Save cluster (autosave status + "Simpan"). Rendered in the FloatingPanel
 * header on desktop (`variant="header"`) and in the mobile save bar over the
 * canvas (`variant="overlay"`). Both wire to the same save handler/state, so
 * mobile keeps a manual Simpan even though the desktop panel is `lg:flex` only.
 */
function SaveControls({
  variant,
  dirty,
  disabled,
  pending,
  onSave,
}: {
  variant: "header" | "overlay"
  dirty: boolean
  disabled?: boolean
  pending: boolean
  onSave: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Status autosave pindah ke header workspace (di bawah nama project).
          Bell "Peringatan" DIHAPUS (Fase 6) — isinya kini tab "Cek" panel
          kanan (lihat cekTabContent di EditorClient). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size={variant === "header" ? "icon-sm" : "icon"}
            onClick={onSave}
            disabled={pending || !dirty || disabled}
            aria-label="Simpan"
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Simpan</TooltipContent>
      </Tooltip>
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 p-6">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
      <div className="hidden w-80 shrink-0 border-l p-4 lg:block">
        <Skeleton className="h-8 w-32" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}

/** Loading fallback for the lazy-loaded EditorInspector (FloatingPanel body). */
function InspectorSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

/** Loading fallback for the lazy-loaded DesignAuditCard / EditorWarningsList ("Cek" tab). */
function AuditCardSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
