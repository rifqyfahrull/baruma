import { create } from "zustand"

/**
 * Global UI state (PRD §12.2). Editor/3D-view state lives in editor-store.ts
 * (added in milestone FE-4). This store covers chrome-level toggles that span
 * the whole app.
 */
type UIStore = {
  commandOpen: boolean
  /**
   * Mode fokus (Fase 5 — rename dari `preview-store.cleanMode`, dulu 3D-only
   * "mode bersih"). Sekarang dipakai BERSAMA oleh 2D & 3D lewat
   * `useFokusMode()` (src/hooks/use-fokus-mode.ts): mengecilkan `ProjectBar`
   * jadi pill kecil + menutup sidebar kiri. Dipindah ke sini (dari
   * preview-store yang khusus 3D) karena satu state kini dipakai kedua
   * permukaan editor.
   */
  fokusMode: boolean
  setCommandOpen: (open: boolean) => void
  toggleCommand: () => void
  setFokusMode: (v: boolean) => void
}

export const useUIStore = create<UIStore>((set) => ({
  commandOpen: false,
  fokusMode: false,
  setCommandOpen: (open) => set({ commandOpen: open }),
  toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
  setFokusMode: (v) => set({ fokusMode: v }),
}))
