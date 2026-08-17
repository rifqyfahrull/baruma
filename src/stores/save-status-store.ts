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
  report: (status: GlobalSaveStatus, dirty?: boolean) => void
  reset: () => void
}

export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: "idle",
  dirty: false,
  report: (status, dirty = false) => set({ status, dirty }),
  reset: () => set({ status: "idle", dirty: false }),
}))
