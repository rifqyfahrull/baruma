/**
 * Builds the "Contractor Pack" PDF (jsPDF + autotable) — matches its
 * EXPORT_META promise ("denah, 3D, RAB ringkas, catatan"): project summary,
 * site/building data, the full RAB table, then (when the inputs are
 * available) a denah page per floor, a 3D thumbnail page, and a closing
 * "Catatan & Asumsi" page (RAB assumptions + top layout warnings).
 */
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import type { Brief, DesignLayout, Project, RAB, ValidationIssue } from "@/types"
import { COPY } from "@/lib/constants"
import { buildLayoutSheet } from "@/lib/drawings/layout-sheet"
import { buildSheetSvgString } from "@/lib/drawings/sheet-to-svg"
import { validateLayout } from "@/lib/validation"
import { applyDraftWatermark } from "./watermark"

const ROOFTOP_FLOOR_ID = "floor-rooftop"
const MAX_WARNINGS = 10
const SEVERITY_ORDER: Record<ValidationIssue["level"], number> = { danger: 0, warning: 1, info: 2 }
const SEVERITY_LABEL: Record<ValidationIssue["level"], string> = {
  danger: "Bahaya",
  warning: "Peringatan",
  info: "Info",
}

const idr = (n: number): string =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n)

const CONF: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi" }

export type ContractorPackOpts = {
  /** Present → adds one "Denah — <lantai>" page per regular floor. */
  layout?: DesignLayout
  /** `usePreviewStore.getState().captureFrame?.()` result, grabbed by the
   *  caller ONLY when the 3D canvas happens to be mounted — the exports page
   *  is a different route than the editor, so in practice this is usually
   *  absent, and the thumbnail page is simply omitted (no error). */
  thumbnailDataUrl?: string
  /** Free plan (`!entitlements.exportPdf`) → tiles a translucent draft stamp. */
  watermark?: boolean
}

export async function buildContractorPackPdf(
  project: Project,
  brief: Brief,
  rab: RAB | null,
  opts: ContractorPackOpts = {}
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const pageW = doc.internal.pageSize.getWidth()
  let y = 18

  // Title
  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text(`Contractor Pack — ${project.name}`, 14, y)
  y += 8

  // Draft notice
  doc.setFontSize(9)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(120, 80, 0)
  doc.text(COPY.draftNotice, 14, y, { maxWidth: pageW - 28 })
  doc.setTextColor(0, 0, 0)
  y += 10

  // Section: Ringkasan
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.text("Ringkasan", 14, y)
  y += 6
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  const summaryLines = doc.splitTextToSize(brief.summary, pageW - 28) as string[]
  doc.text(summaryLines, 14, y)
  y += summaryLines.length * 5 + 4

  // Section: Data tanah & bangunan
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.text("Data tanah & bangunan", 14, y)
  y += 6

  const siteRows: [string, string][] = [
    ["Dimensi lahan", `${brief.site.widthM} m × ${brief.site.depthM} m`],
    ["Luas lahan", `${brief.site.areaM2} m²`],
    ["Jumlah lantai", String(brief.building.floors)],
    ["Finishing", brief.building.finishingLevel],
    [
      "Anggaran",
      `${idr(brief.building.budget.minIDR)} – ${idr(brief.building.budget.maxIDR)}`,
    ],
  ]
  if (brief.site.city) siteRows.unshift(["Kota", brief.site.city])

  autoTable(doc, {
    startY: y,
    head: [],
    body: siteRows,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 46 } },
    margin: { left: 14, right: 14 },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8

  // Section: RAB table (optional)
  if (rab && rab.items.length > 0) {
    doc.setFontSize(12)
    doc.setFont("helvetica", "bold")
    doc.text("Rincian Anggaran Biaya (RAB)", 14, y)
    y += 4

    const rabRows = rab.items.map((item) => [
      item.category,
      item.item,
      String(item.volume),
      item.unit,
      idr(item.unitPriceIDR),
      idr(item.totalIDR),
    ])

    const total = rab.items.reduce((s, i) => s + i.totalIDR, 0)
    rabRows.push(["", "TOTAL", "", "", "", idr(total)])

    autoTable(doc, {
      startY: y,
      head: [["Kategori", "Item", "Volume", "Satuan", "Harga satuan", "Total"]],
      body: rabRows,
      theme: "striped",
      headStyles: { fillColor: [40, 40, 40], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 50 },
        2: { cellWidth: 16, halign: "right" },
        3: { cellWidth: 14 },
        4: { cellWidth: 30, halign: "right" },
        5: { cellWidth: 30, halign: "right" },
      },
      margin: { left: 14, right: 14 },
      didParseCell(data) {
        // Bold the TOTAL row
        if (data.row.index === rabRows.length - 1) {
          data.cell.styles.fontStyle = "bold"
        }
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6

    // Summary box
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    doc.text(
      `Estimasi tengah: ${idr(rab.summary.midIDR)}   |   Per m²: ${idr(rab.summary.perM2IDR)}   |   Keyakinan: ${CONF[rab.summary.confidence] ?? rab.summary.confidence}`,
      14,
      y
    )
  }

  // Denah per lantai — reuses the exact SheetSvg-equivalent primitives
  // (buildLayoutSheet + buildSheetSvgString), rasterized to PNG so jsPDF can
  // embed it. Browser-only (canvas 2D context) — silently skips a floor (or
  // the whole section) where that's unavailable, e.g. in a test/node
  // environment, rather than failing the whole export.
  if (opts.layout) {
    await addFloorPlanPages(doc, opts.layout, project.name)
  }

  // 3D thumbnail — only when the caller actually had a mounted 3D canvas to
  // capture from (see `ContractorPackOpts.thumbnailDataUrl`); omitted
  // gracefully otherwise.
  if (opts.thumbnailDataUrl) {
    addThumbnailPage(doc, opts.thumbnailDataUrl, project.name)
  }

  // Catatan & Asumsi — RAB assumptions + top layout warnings (severity-
  // sorted, capped) so the contractor sees the same caveats the app shows.
  addNotesPage(doc, rab, opts.layout, project)

  if (opts.watermark) applyDraftWatermark(doc)

  return doc.output("blob")
}

/* ------------------------------------------------------------------ */
/* Denah per lantai — SVG → canvas → PNG → doc.addImage               */
/* ------------------------------------------------------------------ */

/**
 * Rasterizes an SVG string to a PNG data URL via an off-DOM `<canvas>`.
 * Returns `null` (rather than throwing) when the browser canvas 2D context
 * is unavailable — true in jsdom/node test environments without the
 * optional `canvas` package, and the caller treats it as "skip this image".
 */
function rasterizeSvgToPngDataUrl(svg: string, widthPx: number, heightPx: number): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return Promise.resolve(null)

  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas")
      canvas.width = widthPx
      canvas.height = heightPx
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(null)
        return
      }

      // jsdom's Image never fires load/error by default — guard against a
      // hung promise with a short timeout that resolves to "skip".
      const timeout = setTimeout(() => resolve(null), 4000)
      const img = new Image()
      img.onload = () => {
        clearTimeout(timeout)
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, widthPx, heightPx)
        ctx.drawImage(img, 0, 0, widthPx, heightPx)
        resolve(canvas.toDataURL("image/png"))
      }
      img.onerror = () => {
        clearTimeout(timeout)
        resolve(null)
      }
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    } catch {
      resolve(null)
    }
  })
}

async function addFloorPlanPages(doc: jsPDF, layout: DesignLayout, projectName: string): Promise<void> {
  const floors = layout.floors
    .filter((f) => f.id !== ROOFTOP_FLOOR_ID)
    .slice()
    .sort((a, b) => a.level - b.level)

  for (const floor of floors) {
    const drawing = buildLayoutSheet(layout, floor.id)
    const svg = buildSheetSvgString(drawing, `Denah — ${floor.name}`, projectName)
    // A3 sheet ratio (420x297mm) rasterized at ~4px/mm for print-legible text.
    const png = await rasterizeSvgToPngDataUrl(svg, 1680, 1188)
    if (!png) continue

    doc.addPage("a4", "landscape")
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text(`Denah — ${floor.name}`, 10, 10)
    doc.addImage(png, "PNG", 8, 14, pageW - 16, pageH - 22)
  }
}

/* ------------------------------------------------------------------ */
/* 3D thumbnail                                                       */
/* ------------------------------------------------------------------ */

function addThumbnailPage(doc: jsPDF, dataUrl: string, projectName: string): void {
  doc.addPage("a4", "landscape")
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text(`Pratinjau 3D — ${projectName}`, 10, 10)
  try {
    doc.addImage(dataUrl, "PNG", 8, 14, pageW - 16, pageH - 22)
  } catch {
    // Corrupt/invalid capture — skip rather than fail the whole export.
  }
}

/* ------------------------------------------------------------------ */
/* Catatan & Asumsi                                                   */
/* ------------------------------------------------------------------ */

/** Top layout warnings (danger first), capped at `MAX_WARNINGS`. */
function topWarnings(layout: DesignLayout, project: Project): ValidationIssue[] {
  const result = validateLayout(layout, project.site)
  return [...result.issues]
    .sort((a, b) => SEVERITY_ORDER[a.level] - SEVERITY_ORDER[b.level])
    .slice(0, MAX_WARNINGS)
}

function addNotesPage(doc: jsPDF, rab: RAB | null, layout: DesignLayout | undefined, project: Project): void {
  const assumptions = rab?.assumptions ?? []
  const warnings = layout ? topWarnings(layout, project) : []
  if (assumptions.length === 0 && warnings.length === 0) return

  doc.addPage("a4", "portrait")
  const pageW = doc.internal.pageSize.getWidth()
  let y = 18

  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text("Catatan & Asumsi", 14, y)
  y += 10

  if (assumptions.length > 0) {
    doc.setFontSize(12)
    doc.text("Asumsi RAB", 14, y)
    y += 4
    autoTable(doc, {
      startY: y,
      head: [],
      body: assumptions.map((a) => [a]),
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 1.5 },
      margin: { left: 14, right: 14 },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8
  }

  if (warnings.length > 0) {
    if (y > 240) {
      doc.addPage("a4", "portrait")
      y = 18
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text("Peringatan desain (ringkasan)", 14, y)
    y += 4
    autoTable(doc, {
      startY: y,
      head: [["Tingkat", "Catatan"]],
      body: warnings.map((w) => [SEVERITY_LABEL[w.level], w.message]),
      theme: "striped",
      headStyles: { fillColor: [40, 40, 40], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 26 } },
      margin: { left: 14, right: 14 },
    })
  }

  doc.setFont("helvetica", "italic")
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text(COPY.draftNotice, 14, doc.internal.pageSize.getHeight() - 12, { maxWidth: pageW - 28 })
  doc.setTextColor(0, 0, 0)
}
