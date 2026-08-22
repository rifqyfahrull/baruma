"use client";

/**
 * Routing undo terpadu (diekstrak dari `PreviewControlsHeaderActions` di
 * `preview-3d/preview-controls.tsx` — heuristik itu TIDAK diubah di sini,
 * hanya dipindah ke satu tempat yang bisa dipakai rail 2D maupun 3D):
 * sebagian besar quick editor menulis ke EDITOR-store, tapi saat seleksi
 * berada di furniture/light (domain interior), Ctrl+Z harus meng-undo
 * INTERIOR-store, bukan diam-diam no-op di sana. Aturan:
 * - Jika seleksi (editor-store `selected.kind`) adalah "furniture"/"light",
 *   ATAU interior-store punya seleksi furniture/light aktif sendiri → pakai
 *   stack interior BILA stack itu punya riwayat; kalau kosong, fallback ke
 *   editor-store bila editor-store punya riwayat; kalau keduanya kosong,
 *   tetap pakai fungsi interior (no-op aman).
 * - Selain itu (bukan konteks interior) → pakai editor-store bila punya
 *   riwayat, fallback ke interior-store.
 *
 * Unifikasi stack undo yang sesungguhnya (satu stack tunggal) SENGAJA
 * DITUNDA — lihat plan Fase 4. Hook ini hanya memindahkan LOGIKA ROUTING,
 * bukan mengubahnya.
 */

import * as React from "react";

import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";

export type UnifiedUndo = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

/** Versi non-hook untuk pemakaian di luar komponen React (mis. keydown
 * listener yang mengambil state store langsung via `getState()`). */
export function routeUndo(): void {
  const editor = useEditorStore.getState();
  const interior = useInteriorStore.getState();
  const interiorSelected =
    (editor.selected?.kind ?? null) === "furniture" ||
    (editor.selected?.kind ?? null) === "light";
  const furnitureFocused =
    interior.selectedFurnitureId !== null || interior.selectedLightId !== null;
  const useInterior = interiorSelected || furnitureFocused;
  const interiorCanUndo = interior.history.length > 0;
  const editorCanUndo = editor.past.length > 0;
  const undo =
    useInterior && interiorCanUndo
      ? interior.undo
      : editorCanUndo
        ? editor.undo
        : interior.undo;
  undo();
}

export function routeRedo(): void {
  const editor = useEditorStore.getState();
  const interior = useInteriorStore.getState();
  const interiorSelected =
    (editor.selected?.kind ?? null) === "furniture" ||
    (editor.selected?.kind ?? null) === "light";
  const furnitureFocused =
    interior.selectedFurnitureId !== null || interior.selectedLightId !== null;
  const useInterior = interiorSelected || furnitureFocused;
  const interiorCanRedo = interior.future.length > 0;
  const editorCanRedo = editor.future.length > 0;
  const redo =
    useInterior && interiorCanRedo
      ? interior.redo
      : editorCanRedo
        ? editor.redo
        : interior.redo;
  redo();
}

/** Hook React: subscribe ke kedua store, kembalikan `undo`/`redo` yang
 * SUDAH di-route + flag `canUndo`/`canRedo` — dipakai langsung oleh rail. */
export function useUnifiedUndo(): UnifiedUndo {
  const interiorUndo = useInteriorStore((s) => s.undo);
  const interiorRedo = useInteriorStore((s) => s.redo);
  const interiorCanUndo = useInteriorStore((s) => s.history.length > 0);
  const interiorCanRedo = useInteriorStore((s) => s.future.length > 0);
  const editorUndo = useEditorStore((s) => s.undo);
  const editorRedo = useEditorStore((s) => s.redo);
  const editorCanUndo = useEditorStore((s) => s.past.length > 0);
  const editorCanRedo = useEditorStore((s) => s.future.length > 0);
  const selectedKind = useEditorStore((s) => s.selected?.kind ?? null);
  const interiorSelected =
    selectedKind === "furniture" || selectedKind === "light";
  const furnitureFocused = useInteriorStore(
    (s) => s.selectedFurnitureId !== null || s.selectedLightId !== null,
  );
  const useInterior = interiorSelected || furnitureFocused;

  const undo =
    useInterior && interiorCanUndo
      ? interiorUndo
      : editorCanUndo
        ? editorUndo
        : interiorUndo;
  const redo =
    useInterior && interiorCanRedo
      ? interiorRedo
      : editorCanRedo
        ? editorRedo
        : interiorRedo;
  const canUndo = useInterior
    ? interiorCanUndo || editorCanUndo
    : editorCanUndo || interiorCanUndo;
  const canRedo = useInterior
    ? interiorCanRedo || editorCanRedo
    : editorCanRedo || interiorCanRedo;

  return React.useMemo(
    () => ({ undo, redo, canUndo, canRedo }),
    [undo, redo, canUndo, canRedo],
  );
}
