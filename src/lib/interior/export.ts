import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import type { DesignLayout, InteriorBudgetLine, InteriorPlan, Project } from "@/types"
import { COPY } from "@/lib/constants"
import { formatIDR, formatIDRCompact } from "@/lib/format"
import { generateInteriorPlan, interiorStyleFromHouseStyle } from "./plan"
import { getInteriorStyle } from "./presets"

export async function buildInteriorPackPdf(
  project: Project,
  layout: DesignLayout,
  interiorPlan?: InteriorPlan
): Promise<Blob> {
  const plan =
    interiorPlan?.projectId === project.id && interiorPlan.versionId === layout.versionId
      ? interiorPlan
      : generateInteriorPlan(layout, {
          projectId: project.id,
          versionId: layout.versionId,
          style: interiorStyleFromHouseStyle(project.style),
        })
  const style = getInteriorStyle(plan.style)
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 18

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.text(`Interior Pack - ${project.name}`, 14, y)
  y += 8

  doc.setFont("helvetica", "italic")
  doc.setFontSize(9)
  doc.setTextColor(120, 80, 0)
  doc.text(COPY.draftNotice, 14, y, { maxWidth: pageW - 28 })
  doc.setTextColor(0, 0, 0)
  y += 10

  section(doc, "Interior concept", y)
  y += 6
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text(
    doc.splitTextToSize(
      `${style.name}: ${style.description} ${style.mood}`,
      pageW - 28
    ) as string[],
    14,
    y
  )
  y += 18

  autoTable(doc, {
    startY: y,
    head: [["Ringkasan", "Nilai"]],
    body: [
      ["Total ruang interior", String(plan.rooms.length)],
      ["Estimasi low", formatIDR(plan.totalEstimate.lowIDR)],
      ["Estimasi mid", formatIDR(plan.totalEstimate.midIDR)],
      ["Estimasi high", formatIDR(plan.totalEstimate.highIDR)],
      ["Jumlah warning", String(plan.warnings.length)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [41, 87, 79] },
    margin: { left: 14, right: 14 },
  })
  y = lastY(doc) + 8

  for (const room of plan.rooms.slice(0, 8)) {
    if (y > 240) {
      doc.addPage()
      y = 18
    }
    section(doc, room.roomName, y)
    y += 6
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text(
      `Furniture: ${room.furniture.length} item | Lighting: ${room.lighting.reduce((s, l) => s + l.qty, 0)} titik | Budget mid: ${formatIDRCompact(room.budgetEstimate.midIDR)}`,
      14,
      y
    )
    y += 5
    const warnings =
      room.warnings.length > 0
        ? room.warnings.map((w) => `- ${w.title}: ${w.message}`).join("\n")
        : "- Tidak ada warning ergonomi utama."
    doc.text(doc.splitTextToSize(warnings, pageW - 28) as string[], 14, y)
    y += Math.min(28, room.warnings.length * 8 + 8)
  }

  doc.addPage()
  section(doc, "Furniture schedule", 18)
  autoTable(doc, {
    startY: 24,
    head: [["Ruang", "Furniture", "Ukuran", "Mid"]],
    body: plan.rooms.flatMap((room) =>
      room.furniture.map((item) => [
        room.roomName,
        item.name,
        `${item.widthM} x ${item.depthM} m`,
        formatIDR(item.priceRange.mid),
      ])
    ),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 87, 79] },
    margin: { left: 14, right: 14 },
  })

  doc.addPage()
  section(doc, "Interior RAB", 18)
  const lines = groupTopLines(plan.totalEstimate.lines)
  autoTable(doc, {
    startY: 24,
    head: [["Kategori", "Item", "Qty", "Mid"]],
    body: lines.map((line) => [
      line.category,
      line.item,
      `${line.qty} ${line.unit}`,
      formatIDR(line.midIDR),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 87, 79] },
    margin: { left: 14, right: 14 },
  })

  return doc.output("blob")
}

function section(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text(title, 14, y)
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY ?? 24
}

function groupTopLines(lines: InteriorBudgetLine[]): InteriorBudgetLine[] {
  return [...lines].sort((a, b) => b.midIDR - a.midIDR).slice(0, 40)
}
