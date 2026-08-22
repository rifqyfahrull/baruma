import { create } from "zustand"

/**
 * Status autosave lintas-halaman untuk header workspace. Halaman editor
 * (2D denah / 3D interior) MELAPORKAAN status autosave-nya ke sini; header
 * project menampilkannya di bawah nama project ("Tersimpan otomatis" /
 * "Menyimpan…" / "Belum tersimpan" / "Gagal menyimpan"). Halaman non-editor
 * membiarkan store di state idle → header menampilkan default statis.
 *
 * "conflict" = autosave ditolak 409 (revision guard): tab lain menyimpan
 * lebih dulu. Header menampilkan status konflik dan LayoutConflictBanner
 * menawarkan reload / simpan-sebagai-salinan.
 */
export type GlobalSaveStatus = "idle" | "saving" | "saved" | "error" | "conflict"

type SaveStatusState = {
  status: GlobalSaveStatus
  dirty: boolean
  /**
   * Aksi "Simpan sekarang" halaman aktif (Fase 5, popover status simpan di
   * `ProjectBar`). Simpan itu PAGE-LOCAL (mis. `EditorClient.onSave` di
   * editor/page.tsx menutup atas `useEditorStore` + `useSaveLayout`
   * mutation) — bukan aksi global yang bisa dipanggil dari layout. Alih-alih
   * memindahkan logika simpan itu ke store (kehilangan akses ke hook React
   * query lokal), halaman yang punya tombol Simpan manual MENDAFTARKAN
   * closure-nya di sini saat mount, dan ProjectBar memanggilnya lewat sini.
   * Halaman tanpa simpan manual (mis. 3D preview — otosave saja) tidak
   * mendaftar apa pun → popover ProjectBar menyembunyikan tombol "Simpan
   * sekarang" di halaman itu (lihat project-bar.tsx).
   */
  saveHandler: (() => void) | null
  report: (status: GlobalSaveStatus, dirty?: boolean) => void
  registerSaveHandler: (fn: (() => void) | null) => void
  reset: () => void
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: "idle",
  dirty: false,
  saveHandler: null,
  report: (status, dirty = false) => set({ status, dirty }),
  registerSaveHandler: (fn) => set({ saveHandler: fn }),
  reset: () => set({ status: "idle", dirty: false, saveHandler: null }),
}))
