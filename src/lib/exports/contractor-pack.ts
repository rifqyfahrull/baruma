/**
 * Builds a "Contractor Pack" PDF (jsPDF + autotable) that combines project
 * summary, site/building data, and the full RAB table into a single document
 * ready for contractor discussion.
 */
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import type { Brief, Project, RAB } from "@/types"
import { COPY } from "@/lib/constants"

const idr = (n: number): string =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n)

const CONF: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi" }

export async function buildContractorPackPdf(
  project: Project,
  brief: Brief,
  rab: RAB | null
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

  return doc.output("blob")
}
