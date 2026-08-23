/**
 * Shared draft watermark for PDF exports on the Free plan (`!entitlements.
 * exportPdf` — see `src/lib/server/entitlements.ts`). Stamps a translucent
 * diagonal "DRAFT — Baruma (plan Free)" tiled across EVERY existing page of
 * `doc` — call it once, after all page content has been drawn (it iterates
 * `doc.internal.getNumberOfPages()`, so pages added afterwards are missed on
 * purpose: callers must finish building the document first).
 *
 * Used by `contractor-pack.ts`, `drawings-pack.ts`, and the interior export
 * (`src/lib/interior/export.ts`) — gating (`watermark: boolean`) is threaded
 * in from `export-store.ts`, which reads `entitlements.exportPdf` at the
 * `export-card.tsx` layer (the only place entitlements are already in scope).
 */
import type { jsPDF } from "jspdf"

export const DEFAULT_WATERMARK_TEXT = "DRAFT — Baruma (plan Free)"

const OPACITY = 0.12
const FONT_SIZE_PT = 26
const ANGLE_DEG = 33
const GRAY = 120

/** Tiled diagonal watermark, applied in-place to every page of `doc`. */
export function applyDraftWatermark(doc: jsPDF, text: string = DEFAULT_WATERMARK_TEXT): void {
  const pageCount = doc.getNumberOfPages()

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)

    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()

    doc.saveGraphicsState()
    doc.setGState(doc.GState({ opacity: OPACITY }))
    doc.setTextColor(GRAY, GRAY, GRAY)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(FONT_SIZE_PT)

    const stepX = pageW / 2
    const stepY = pageH / 3
    for (let row = 0; row * stepY < pageH + stepY; row++) {
      const y = stepY / 2 + row * stepY
      for (let col = -1; col * stepX < pageW + stepX; col++) {
        const x = col * stepX + stepX / 2
        doc.text(text, x, y, { angle: ANGLE_DEG, align: "center" })
      }
    }

    doc.restoreGraphicsState()
  }
}
