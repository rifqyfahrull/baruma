"use client";

import * as React from "react";

import { useNarrowViewport } from "@/hooks/use-narrow-viewport";
import { useToolbarOverflow } from "@/hooks/use-toolbar-overflow";

/**
 * Sinyal compact terpadu untuk `FloatingBar`: gabungan dua sinyal independen
 * — lebar viewport sempit (`useNarrowViewport`) ATAU tinggi konten toolbar
 * yang SECARA NYATA melebihi ruang tersisa (`useToolbarOverflow`, diukur
 * dari `ref`). Menggantikan pola duplikat "compact = narrow || overflows"
 * yang sebelumnya ditulis tangan di tiap toolbar (mis. `editor-toolbar.tsx`).
 */
export function useToolbarCompact(
  ref: React.RefObject<HTMLElement | null>,
): boolean {
  const narrow = useNarrowViewport();
  const overflowsHeight = useToolbarOverflow(ref, narrow);
  return narrow || overflowsHeight;
}
