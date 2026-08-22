import { create } from "zustand"

import type { MaterialPresetId } from "@/lib/three/materials"
import { useEditorStore } from "@/stores/editor-store"
import { parseOpeningWall } from "@/lib/geometry"
import { hostRoomIdOf, wallRefId, type EntityRef } from "@/types/entity-ref"

export type ViewPreset = "iso" | "front" | "top" | "rooftop"

/** Render quality profile for the 3D preview. */
export type RenderMode = "edit" | "presentation"

/** Interaction mode for the 3D preview. */
export type InteractionMode = "edit" | "view"

type PreviewState = {
  visibleFloors: Record<string, boolean>
  exploded: boolean
  showRoof: boolean
  showLabels: boolean
  showInteriorLabels: boolean
  showFurniture: boolean
  /** Figur manusia 1,7 m di dalam rumah — pembanding skala. */
  showHumanScale: boolean
  /** Vegetasi taman (pohon/semak stylized) — konteks render. */
  showVegetation: boolean
  materialPreset: MaterialPresetId
  selectedRoomId: string | null
  /** Pintu/jendela terpilih (klik di 3D) — dieditkan via OpeningQuickEditor. */
  selectedOpeningId: string | null
  /** Dinding terpilih (klik di 3D), format `${roomId}:${side}` — untuk cladding fasad. */
  selectedWallId: string | null
  /** Atap terpilih (klik di 3D) — RoofQuickEditor (tipe/kemiringan/overhang/material). */
  roofSelected: boolean
  /** Lampu eksterior terpilih (klik di 3D) — LampQuickEditor. */
  selectedLampId: string | null
  /** Balkon yang railing-nya terpilih (klik railing di 3D) — RailingQuickEditor. */
  selectedRailingRoomId: string | null
  /** Elemen eksterior semantik terpilih dari Preview 3D. */
  selectedExteriorElementId: string | null
  draggingFurnitureId: string | null

  /** Sun azimuth (0–360°) & elevation (0–90°) for exterior lighting + drei <Sky>. */
  sunAzimuthDeg: number
  sunElevationDeg: number
  /**
   * Studi matahari: bila `enabled`, azimut/elevasi matahari DIHITUNG dari
   * bulan+jam+lintang lokasi (house-scene) alih-alih slider manual — bayangan
   * bergerak sesuai lintasan matahari nyata. `month` 0-11, `hour` 5–19 desimal.
   */
  sunStudy: { enabled: boolean; month: number; hour: number }
  /** Realistic mode: procedural sky + sun shadows. Off → flat background, no shadows. */
  realistic: boolean
  /**
   * "Kaca realistis" (lebih berat): kaca bukaan/curtain wall/railing kaca
   * memakai `meshPhysicalMaterial` transmisif (tembus pandang + refraksi)
   * alih-alih PBR datar biasa. Off by default — `transmission` di three.js
   * butuh render-target tambahan per frame, mahal di GPU lemah/tablet.
   */
  glassRealistic: boolean
  /**
   * Edit = responsive interaction profile. Presentation = deterministic
   * high-quality profile used before screenshots / visual regression.
   */
  renderMode: RenderMode
  /**
   * Mode malam (senja): langit gelap, matahari padam, dan kaca jendela/pintu
   * menyala hangat dari dalam — untuk render suasana malam ala visual arsitek.
   */
  nightMode: boolean

  /**
   * Edit mode: drag & drop furniture + klik cepat bukaan/eksterior. View
   * mode: orbit/zoom only, no editing. Sejak Fase 4, tidak ada lagi kontrol
   * UI untuk toggle ini — default selalu "edit"; satu-satunya jalur yang
   * mengubahnya adalah viewer publik `readOnly` (dipaksa "view" sekali per
   * mount, lihat preview-3d-view.tsx).
   */
  interactionMode: InteractionMode

  viewPreset: ViewPreset
  viewNonce: number

  /** Fly-to-room: CameraRig frames this room when the nonce bumps. */
  focusRoomId: string | null
  focusNonce: number

  canvasEl: HTMLCanvasElement | null
  setCanvas: (el: HTMLCanvasElement | null) => void

  /**
   * Elemen jarum kompas 3D (overlay DOM di luar Canvas). CompassBridge (di
   * dalam Canvas) memutasi style.transform-nya langsung tiap frame render —
   * tanpa re-render React (pola sama dgn setCanvas/captureFrame).
   */
  compassEl: HTMLDivElement | null
  setCompassEl: (el: HTMLDivElement | null) => void

  /**
   * Fungsi screenshot yang didaftarkan dari DALAM Canvas (ScreenshotBridge).
   * Me-render ulang frame lalu mengembalikan data-URL PNG — wajib karena
   * preserveDrawingBuffer:false membuat toDataURL langsung bisa kosong.
   * Null saat canvas belum mount / sudah unmount.
   */
  captureFrame: (() => string) | null
  setCaptureFrame: (fn: (() => string) | null) => void

  /**
   * Capture pasangan input render AI (beauty + depth), didaftarkan dari
   * DALAM Canvas oleh ScreenshotBridge (lihat komentar di sana untuk detail
   * presisi depth). Async karena render depth memakai WebGLRenderTarget +
   * readback yang lebih berat dari toDataURL biasa. Null saat canvas
   * belum/sudah unmount — sama seperti captureFrame.
   */
  captureRenderInputs:
    | (() => Promise<{ beauty: string; depth: string; width: number; height: number }>)
    | null
  setCaptureRenderInputs: (
    fn:
      | (() => Promise<{ beauty: string; depth: string; width: number; height: number }>)
      | null
  ) => void

  initFloors: (floorIds: string[]) => void
  toggleFloor: (id: string) => void
  setFloorVisible: (id: string, visible: boolean) => void
  setExploded: (v: boolean) => void
  setShowRoof: (v: boolean) => void
  setShowLabels: (v: boolean) => void
  setShowInteriorLabels: (v: boolean) => void
  setShowFurniture: (v: boolean) => void
  setShowHumanScale: (v: boolean) => void
  setShowVegetation: (v: boolean) => void
  setMaterialPreset: (p: MaterialPresetId) => void
  selectRoom: (id: string | null) => void
  selectOpening: (id: string | null) => void
  selectWall: (id: string | null) => void
  selectRoof: (v: boolean) => void
  selectLamp: (id: string | null) => void
  selectRailing: (roomId: string | null) => void
  selectExteriorElement: (id: string | null) => void
  setDragging: (id: string | null) => void
  setSunAzimuth: (deg: number) => void
  setSunElevation: (deg: number) => void
  /** Nyalakan/matikan studi matahari (menyalakan realistic + mematikan malam). */
  setSunStudyEnabled: (v: boolean) => void
  setSunStudyMonth: (month: number) => void
  setSunStudyHour: (hour: number) => void
  setRealistic: (v: boolean) => void
  toggleRealistic: () => void
  setGlassRealistic: (v: boolean) => void
  setNightMode: (v: boolean) => void
  toggleNightMode: () => void
  setRenderMode: (mode: RenderMode) => void
  applyRenderModePreset: (mode: RenderMode) => void
  setInteractionMode: (mode: InteractionMode) => void
  requestView: (preset: ViewPreset) => void
  /** Selects the room AND asks the camera to frame it (room-list click). */
  requestFocusRoom: (roomId: string) => void
}

export const usePreviewStore = create<PreviewState>((set) => ({
  visibleFloors: {},
  exploded: false,
  showRoof: false,
  showLabels: false,
  showInteriorLabels: true,
  showFurniture: true,
  showHumanScale: false,
  showVegetation: true,
  materialPreset: "modern_tropis",
  selectedRoomId: null,
  selectedOpeningId: null,
  selectedWallId: null,
  roofSelected: false,
  selectedLampId: null,
  selectedRailingRoomId: null,
  selectedExteriorElementId: null,
  draggingFurnitureId: null,
  sunAzimuthDeg: 135,
  sunElevationDeg: 45,
  sunStudy: { enabled: false, month: 5, hour: 12 },
  realistic: true,
  glassRealistic: false,
  renderMode: "presentation",
  nightMode: false,
  // Fase 4: konsep UI "Edit/View" dihapus (rail + toggle panel dibongkar) —
  // user SELALU edit-capable secara default; field ini kini murni gate
  // `readOnly` (viewer publik) yang memaksanya ke "view" via efek di
  // preview-3d-view.tsx. Default lama "view" hanya masuk akal saat ada
  // tombol toggle eksplisit; tanpa itu, default "view" akan mengunci semua
  // interaksi edit (furniture drag, klik cepat bukaan/eksterior) tanpa jalan
  // keluar bagi user biasa.
  interactionMode: "edit",
  viewPreset: "iso",
  viewNonce: 0,
  focusRoomId: null,
  focusNonce: 0,
  canvasEl: null,
  compassEl: null,
  captureFrame: null,
  captureRenderInputs: null,

  setCanvas: (el) => set({ canvasEl: el }),
  setCompassEl: (el) => set({ compassEl: el }),
  setCaptureFrame: (fn) => set({ captureFrame: fn }),
  setCaptureRenderInputs: (fn) => set({ captureRenderInputs: fn }),

  // initFloors TIDAK lagi menge-null selectedRoomId: seleksi kini milik
  // editor-store (ref basi dibersihkan validateSelection di sana), dan
  // menge-null mirror di mount 3D justru membatalkan seleksi bawaan dari 2D.
  initFloors: (floorIds) =>
    set({
      visibleFloors: Object.fromEntries(floorIds.map((id) => [id, true])),
    }),
  toggleFloor: (id) =>
    set((s) => ({
      visibleFloors: { ...s.visibleFloors, [id]: !s.visibleFloors[id] },
    })),
  setFloorVisible: (id, visible) =>
    set((s) => ({
      visibleFloors: { ...s.visibleFloors, [id]: visible },
    })),
  setExploded: (v) => set({ exploded: v }),
  setShowRoof: (v) => set({ showRoof: v }),
  setShowLabels: (v) => set({ showLabels: v }),
  setShowInteriorLabels: (v) => set({ showInteriorLabels: v }),
  setShowFurniture: (v) => set({ showFurniture: v }),
  setShowHumanScale: (v) => set({ showHumanScale: v }),
  setShowVegetation: (v) => set({ showVegetation: v }),
  setMaterialPreset: (p) => set({ materialPreset: p }),
  // ── Seleksi (unifikasi P1) ─────────────────────────────────────────────
  // Ketujuh setter ini kini DELEGATE ke seleksi terpadu editor-store
  // (`select(EntityRef)`) lalu memproyeksikan hasilnya balik ke field mirror
  // lokal (projectEditorSelection — sinkron, supaya pemanggil & test langsung
  // melihat state final). Mutual-exclusion jadi STRUKTURAL: semua field
  // turunan dari SATU ref — bug kartu quick-editor menumpuk (exclusion
  // tulis-tangan asimetris) mati dengan sendirinya. Field mirror dihapus
  // bertahap saat migrasi P2 per-entity.
  selectRoom: (id) => delegateSelect(id ? { kind: "room", id } : null, "room"),
  selectOpening: (id) => delegateSelect(id ? { kind: "opening", id } : null, "opening"),
  selectWall: (id) => {
    if (!id) return delegateSelect(null, "wall")
    const parsed = parseOpeningWall(id)
    if (!parsed) return
    delegateSelect({ kind: "wall", roomId: parsed.roomId, side: parsed.side }, "wall")
  },
  selectRoof: (v) => delegateSelect(v ? { kind: "roof" } : null, "roof"),
  selectLamp: (id) => delegateSelect(id ? { kind: "lamp", id } : null, "lamp"),
  selectRailing: (roomId) =>
    delegateSelect(roomId ? { kind: "railing", roomId } : null, "railing"),
  selectExteriorElement: (id) =>
    delegateSelect(id ? { kind: "exterior", id } : null, "exterior"),
  setDragging: (id) => set({ draggingFurnitureId: id }),
  setSunAzimuth: (deg) => set({ sunAzimuthDeg: deg }),
  setSunElevation: (deg) => set({ sunElevationDeg: deg }),
  setSunStudyEnabled: (v) =>
    set((s) => ({
      sunStudy: { ...s.sunStudy, enabled: v },
      // Studi butuh langit+bayangan; matikan mode malam agar matahari tampak.
      ...(v ? { realistic: true, nightMode: false } : {}),
    })),
  setSunStudyMonth: (month) =>
    set((s) => ({ sunStudy: { ...s.sunStudy, month: Math.max(0, Math.min(11, Math.round(month))) } })),
  setSunStudyHour: (hour) =>
    set((s) => ({ sunStudy: { ...s.sunStudy, hour: Math.max(0, Math.min(24, hour)) } })),
  setRealistic: (v) => set({ realistic: v }),
  toggleRealistic: () => set((s) => ({ realistic: !s.realistic })),
  setGlassRealistic: (v) => set({ glassRealistic: v }),
  setNightMode: (v) => set({ nightMode: v }),
  toggleNightMode: () => set((s) => ({ nightMode: !s.nightMode })),
  setRenderMode: (mode) => set({ renderMode: mode }),
  applyRenderModePreset: (mode) =>
    set((s) => ({
      renderMode: mode,
      realistic: mode === "presentation",
      nightMode: false,
      sunStudy: { ...s.sunStudy, enabled: false },
      sunAzimuthDeg: 135,
      sunElevationDeg: 45,
      showRoof: true,
      showFurniture: true,
      showVegetation: true,
      showLabels: mode === "edit",
      showInteriorLabels: mode === "edit",
      viewPreset: mode === "presentation" ? "iso" : s.viewPreset,
      viewNonce: mode === "presentation" ? s.viewNonce + 1 : s.viewNonce,
    })),
  setInteractionMode: (mode) => set({ interactionMode: mode }),
  requestView: (preset) =>
    set((s) => ({ viewPreset: preset, viewNonce: s.viewNonce + 1 })),
  requestFocusRoom: (roomId) => {
    delegateSelect({ kind: "room", id: roomId }, "room")
    set((s) => ({
      focusRoomId: roomId,
      focusNonce: s.focusNonce + 1,
    }))
  },
}))

/**
 * Proyeksikan seleksi terpadu editor-store → field mirror legacy preview-store.
 * SATU-SATUNYA tempat aturan proyeksi hidup — dipakai sinkron oleh delegate
 * setter di atas, dan oleh selection-bridge (subscribe) untuk perubahan yang
 * lahir di luar preview (kanvas 2D, keyboard, AI, epilogue commit).
 *
 * `selectedRoomId` di-mirror sebagai KONTEKS ruang turunan: ruang terpilih
 * langsung, atau ruang induk dari entity terpilih (bukaan → ruang host, dst.).
 * Entity tanpa ruang induk (atap/eksterior/lampu) MEMPERTAHANKAN konteks ruang
 * sebelumnya — mempertahankan perilaku lama di mana kartu ruang 3D tak hilang
 * saat memilih atap/lampu.
 */
export function projectEditorSelection(): void {
  const { selected, layout } = useEditorStore.getState()
  const prev = usePreviewStore.getState()
  const ctxRoom =
    selected === null
      ? null
      : selected.kind === "room"
        ? selected.id
        : layout
          ? (hostRoomIdOf(selected, layout) ?? prev.selectedRoomId)
          : prev.selectedRoomId
  usePreviewStore.setState({
    selectedRoomId: ctxRoom,
    selectedOpeningId: selected?.kind === "opening" ? selected.id : null,
    selectedWallId: selected?.kind === "wall" ? wallRefId(selected) : null,
    roofSelected: selected?.kind === "roof",
    selectedLampId: selected?.kind === "lamp" ? selected.id : null,
    selectedRailingRoomId: selected?.kind === "railing" ? selected.roomId : null,
    selectedExteriorElementId: selected?.kind === "exterior" ? selected.id : null,
  })
}

/**
 * Delegasi setter legacy → seleksi terpadu. `null` hanya meng-clear bila
 * seleksi aktif memang ber-kind sama (perilaku setter lama: menutup kartunya
 * sendiri tanpa mengganggu seleksi jenis lain), lalu selalu memproyeksikan.
 */
function delegateSelect(ref: EntityRef | null, kindForNull: EntityRef["kind"]): void {
  const editor = useEditorStore.getState()
  if (ref) editor.select(ref)
  else if (editor.selected?.kind === kindForNull) editor.clearSelection()
  projectEditorSelection()
}
