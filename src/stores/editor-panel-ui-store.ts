import { create } from "zustand"

/**
 * State panel kanan editor 2D (Fase 6) — dipindah dari `useState` lokal
 * `EditorClient` (editor/page.tsx) ke store kecil supaya komponen LAIN di
 * pohon terpisah (marker warning di `PlanCanvas`, di dalam `<svg>` kanvas)
 * bisa memicu "pindah ke tab Cek + fokus baris peringatan tertentu" tanpa
 * props-drilling lintas dua sub-tree yang tak bertetangga.
 *
 * `focusNonce` naik setiap `focusWarning()` dipanggil (bahkan bila
 * `focusObjectId` sama seperti sebelumnya) — daftar peringatan (Cek tab)
 * meng-observe nonce ini utk scroll+highlight, supaya klik marker yang SAMA
 * dua kali berturut-turut tetap men-scroll ulang.
 */
export type EditorSidePanel = "properti" | "cek"

type EditorPanelUiState = {
  sidePanel: EditorSidePanel
  setSidePanel: (panel: EditorSidePanel) => void
  /** objectId (roomId, dst.) dari peringatan yang barusan diklik di kanvas. */
  focusObjectId: string | null
  focusNonce: number
  /** Marker kanvas diklik → pindah ke tab Cek + minta baris ybs di-scroll+highlight. */
  focusWarning: (objectId: string) => void
  reset: () => void
}

export const useEditorPanelUiStore = create<EditorPanelUiState>((set) => ({
  sidePanel: "properti",
  setSidePanel: (panel) => set({ sidePanel: panel }),
  focusObjectId: null,
  focusNonce: 0,
  focusWarning: (objectId) =>
    set((s) => ({ sidePanel: "cek", focusObjectId: objectId, focusNonce: s.focusNonce + 1 })),
  reset: () => set({ sidePanel: "properti", focusObjectId: null, focusNonce: 0 }),
}))
