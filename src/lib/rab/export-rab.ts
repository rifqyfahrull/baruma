/**
 * RAB exports: a real .xlsx (SheetJS, lazy-loaded) and a print-to-PDF document.
 * `rabToAoa` and `rabToPrintHtml` are pure/exported for testing; the xlsx writer
 * and printer run only in the browser.
 */
import type { RAB, Project } from "@/types"
import { COST_CATEGORIES } from "@/lib/constants"
import { printHtmlDocument } from "@/lib/print/print-html"

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}
const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
const num = (n?: number): string => (n == null ? "-" : new Intl.NumberFormat("id-ID").format(n))
const idr = (n: number): string =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n)
const CONF: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi" }
const catLabel = (c: string): string => (COST_CATEGORIES as Record<string, string>)[c] ?? c

const fileBase = (project?: Project): string =>
  (project?.name ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"

/** Spreadsheet rows (array-of-arrays) for the .xlsx export. */
export function rabToAoa(rab: RAB, project?: Project): (string | number)[][] {
  return [
    [`RAB / BOQ — ${project?.name ?? "Project"}`],
    [`Luas bangunan: ${rab.areaM2} m²`, "", "", "", "Estimasi (mid):", rab.summary.midIDR],
    ["", "", "", "", "Rentang:", rab.summary.lowIDR, rab.summary.highIDR],
    ["", "", "", "", "Per m²:", rab.summary.perM2IDR],
    [],
    ["Kategori", "Item", "Volume", "Satuan", "Harga Satuan (IDR)", "Total (IDR)", "Keyakinan", "Catatan"],
    ...rab.items.map((i) => [
      catLabel(i.category),
      i.item,
      i.volume,
      i.unit,
      i.unitPriceIDR,
      i.totalIDR,
      CONF[i.confidence] ?? i.confidence,
      [i.notes, i.sourceElementIds?.length ? `Ref: ${i.sourceElementIds.join(", ")}` : ""]
        .filter(Boolean)
        .join(" | "),
    ]),
    [],
    ["", "", "", "", "TOTAL", rab.items.reduce((s, i) => s + i.totalIDR, 0)],
  ]
}

/** Returns a real .xlsx Blob (suitable for URL.createObjectURL or tests). */
export async function rabToXlsxBlob(rab: RAB, project?: Project): Promise<Blob> {
  const XLSX = await import("xlsx")
  const ws = XLSX.utils.aoa_to_sheet(rabToAoa(rab, project))
  ws["!cols"] = [{ wch: 14 }, { wch: 34 }, { wch: 9 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "RAB")
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

export async function exportRabExcel(rab: RAB, project?: Project): Promise<void> {
  const blob = await rabToXlsxBlob(rab, project)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `rab-${fileBase(project)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function rabToPrintHtml(rab: RAB, project?: Project): string {
  const title = project?.name ?? "Project"
  const rows = rab.items
    .map(
      (i) =>
        `<tr><td>${esc(catLabel(i.category))}</td><td>${esc(i.item)}${
          i.notes ? `<div class="muted">${esc(i.notes)}</div>` : ""
        }${i.sourceElementIds?.length ? `<div class="muted">Ref: ${esc(i.sourceElementIds.join(", "))}</div>` : ""
        }</td><td class="r">${num(i.volume)}</td><td>${esc(i.unit)}</td><td class="r">${idr(
          i.unitPriceIDR
        )}</td><td class="r b">${idr(i.totalIDR)}</td><td>${esc(CONF[i.confidence] ?? i.confidence)}</td></tr>`
    )
    .join("")
  const total = rab.items.reduce((s, i) => s + i.totalIDR, 0)

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>RAB — ${esc(title)}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: #18181b; margin: 0; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 2px solid #18181b; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  .sub { color: #52525b; margin-top: 2px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .card { border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px; }
  .card span { display: block; color: #71717a; font-size: 10px; }
  .card b { font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; border-bottom: 1px solid #e4e4e7; padding: 5px 6px; vertical-align: top; }
  th { color: #52525b; font-weight: 600; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .b { font-weight: 600; }
  .muted { color: #71717a; font-size: 10px; }
  tfoot td { border-top: 2px solid #18181b; font-weight: 700; }
  ul { margin: 12px 0 0; padding-left: 18px; color: #52525b; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 10px; }
</style></head>
<body>
  <header><h1>RAB / BOQ</h1><div class="sub">${esc(title)} · luas ${num(rab.areaM2)} m²</div></header>
  <div class="cards">
    <div class="card"><span>Estimasi bawah</span><b>${idr(rab.summary.lowIDR)}</b></div>
    <div class="card"><span>Estimasi tengah</span><b>${idr(rab.summary.midIDR)}</b></div>
    <div class="card"><span>Estimasi atas</span><b>${idr(rab.summary.highIDR)}</b></div>
    <div class="card"><span>Per m²</span><b>${idr(rab.summary.perM2IDR)}</b></div>
  </div>
  <table>
    <thead><tr><th>Kategori</th><th>Item</th><th class="r">Volume</th><th>Satuan</th><th class="r">Harga satuan</th><th class="r">Total</th><th>Keyakinan</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5" class="r">TOTAL</td><td class="r">${idr(total)}</td><td></td></tr></tfoot>
  </table>
  ${rab.assumptions.length ? `<ul>${rab.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
  <footer>Dibuat dengan Baruma · estimasi awal, verifikasi dengan kontraktor lokal.</footer>
</body></html>`
}

export function printRab(rab: RAB, project?: Project): void {
  printHtmlDocument(rabToPrintHtml(rab, project))
}
