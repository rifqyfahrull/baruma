/**
 * Selection bridge (unifikasi P1): mirror SATU-ARAH dari seleksi terpadu
 * editor-store → field seleksi legacy preview-store. Delegate setter di
 * preview-store sudah memproyeksikan sinkron untuk klik yang lahir di 3D;
 * bridge ini menangkap perubahan yang lahir DI LUAR preview — kanvas 2D,
 * shortcut keyboard (Esc/Del), AI apply, dan epilogue validateSelection —
 * supaya kartu quick-editor 3D selalu mengikuti. Satu arah = mustahil loop.
 * Bridge (dan seluruh field mirror) dihapus saat migrasi P2 tuntas.
 */
import { useEditorStore } from "@/stores/editor-store"
import { useInteriorStore } from "@/stores/interior-store"
import { projectEditorSelection } from "@/stores/preview-store"

export function initSelectionBridge(): () => void {
  projectEditorSelection()
  // Guard anti-loop untuk jembatan dua-arah interior↔editor (furnitur):
  // seleksi furnitur lahir di interior-store (klik mesh 3D / editor 2D
  // interior), tapi kartu terpadu (registry) membaca editor-store.selected.
  let syncing = false

  const unsubEditor = useEditorStore.subscribe((state, prevState) => {
    if (state.selected !== prevState.selected || state.layout !== prevState.layout) {
      projectEditorSelection()
    }
    // editor → interior: pilih non-furnitur / bersihkan seleksi ⇒ lepas
    // seleksi furnitur interior (highlight mesh ikut padam).
    if (syncing) return
    if (state.selected !== prevState.selected) {
      const it = useInteriorStore.getState()
      const k = state.selected?.kind
      if (k !== "furniture" && it.selectedFurnitureId) {
        syncing = true
        it.selectFurniture(null)
        syncing = false
      }
      if (k !== "light" && it.selectedLightId) {
        syncing = true
        it.selectLight(null)
        syncing = false
      }
    }
  })

  const unsubInterior = useInteriorStore.subscribe((state, prevState) => {
    const furnChanged = state.selectedFurnitureId !== prevState.selectedFurnitureId
    const lightChanged = state.selectedLightId !== prevState.selectedLightId
    if (!furnChanged && !lightChanged) return
    if (syncing) return
    syncing = true
    const ed = useEditorStore.getState()
    // interior → editor: munculkan kartu furnitur/lampu terpadu.
    if (state.selectedFurnitureId && state.selectedRoomId) {
      ed.select({ kind: "furniture", roomId: state.selectedRoomId, id: state.selectedFurnitureId })
    } else if (state.selectedLightId && state.selectedRoomId) {
      ed.select({ kind: "light", roomId: state.selectedRoomId, id: state.selectedLightId })
    } else if (ed.selected?.kind === "furniture" || ed.selected?.kind === "light") {
      ed.clearSelection()
    }
    syncing = false
  })

  return () => {
    unsubEditor()
    unsubInterior()
  }
}
