/**
 * Export a brief as PDF via the browser's print dialog ("Save as PDF").
 * Renders a clean, self-contained HTML document into a hidden iframe and calls
 * print() — no external dependency, crisp vector text. `briefToPrintHtml` is
 * pure/exported for testing.
 */
import type { Brief, Project } from "@/types"
import { PRIORITIES, ROOM_TYPES, FINISHING_LEVELS } from "@/lib/constants"
import { printHtmlDocument } from "@/lib/print/print-html"

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)

const ORIENTATION: Record<string, string> = {
  north: "Utara",
  east: "Timur",
  south: "Selatan",
  west: "Barat",
  unknown: "Belum ditentukan",
}
const SIZE: Record<string, string> = { small: "Kecil", standard: "Standar", large: "Luas" }

const num = (n?: number): string =>
  n == null ? "-" : new Intl.NumberFormat("id-ID").format(n)
const idr = (n: number): string =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n)

export function briefToPrintHtml(brief: Brief, project?: Project): string {
  const s = brief.site
  const title = project?.name ?? "Brief desain"
  const location = s.city ?? project?.city ?? ""

  const rows = brief.spaceProgram
    .map(
      (i) =>
        `<tr><td>${esc(ROOM_TYPES[i.roomType]?.label ?? i.roomType)}${
          i.required ? "" : " <span class='muted'>(opsional)</span>"
        }</td><td>${num(i.quantity)}</td><td>${i.preferredFloor ?? "-"}</td><td>${
          i.sizePreference ? SIZE[i.sizePreference] : "Standar"
        }</td><td>${esc(i.notes ?? "-")}</td></tr>`
    )
    .join("")

  const prio = brief.priorities.length
    ? brief.priorities.map((p) => `<span class="chip">${esc(PRIORITIES[p] ?? p)}</span>`).join(" ")
    : "<span class='muted'>—</span>"

  const list = (arr: string[]) =>
    arr.length
      ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
      : "<p class='muted'>—</p>"

  const risks = brief.risks.length
    ? brief.risks
        .map(
          (r) =>
            `<div class="risk risk-${esc(r.level)}"><strong>${esc(
              r.title
            )}</strong><div>${esc(r.message)}</div></div>`
        )
        .join("")
    : "<p class='muted'>Tidak ada catatan risiko khusus.</p>"

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Brief — ${esc(title)}</title>
<style>
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #18181b; margin: 0; line-height: 1.5; font-size: 12px; }
  header { border-bottom: 2px solid #18181b; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0; }
  .sub { color: #52525b; font-size: 12px; margin-top: 2px; }
  section { margin-bottom: 16px; page-break-inside: avoid; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #3f3f46; border-bottom: 1px solid #e4e4e7; padding-bottom: 4px; margin: 0 0 8px; }
  p { margin: 0 0 6px; }
  .muted { color: #71717a; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .grid > div { border: 1px solid #e4e4e7; border-radius: 6px; padding: 6px 8px; }
  .grid span { display: block; color: #71717a; font-size: 10px; }
  .grid b { font-size: 12px; }
  .chip { display: inline-block; background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 999px; padding: 2px 8px; font-size: 11px; margin: 0 2px 4px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; border-bottom: 1px solid #e4e4e7; padding: 5px 6px; vertical-align: top; }
  th { color: #52525b; font-weight: 600; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .risk { border: 1px solid #e4e4e7; border-left-width: 3px; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; }
  .risk-danger { border-left-color: #dc2626; }
  .risk-warning { border-left-color: #d97706; }
  .risk-info { border-left-color: #2563eb; }
  footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 10px; }
</style></head>
<body>
  <header><h1>Brief Desain</h1><div class="sub">${esc(title)}${location ? " · " + esc(location) : ""}</div></header>

  <section><h2>Ringkasan</h2><p>${esc(brief.summary)}</p></section>

  <section><h2>Data tanah</h2>
    <div class="grid">
      <div><span>Lebar</span><b>${num(s.widthM)} m</b></div>
      <div><span>Panjang</span><b>${num(s.depthM)} m</b></div>
      <div><span>Luas</span><b>${num(s.areaM2)} m²</b></div>
      <div><span>Orientasi depan</span><b>${ORIENTATION[s.frontOrientation ?? "unknown"] ?? "-"}</b></div>
      <div><span>Sisi menempel</span><b>${s.sidesAttached != null ? num(s.sidesAttached) + " sisi" : "-"}</b></div>
      <div><span>Lebar jalan depan</span><b>${s.frontRoadWidthM != null ? num(s.frontRoadWidthM) + " m" : "-"}</b></div>
    </div>
    ${s.notes ? `<p class="muted">${esc(s.notes)}</p>` : ""}
  </section>

  <section><h2>Bangunan</h2>
    <div class="grid">
      <div><span>Lantai</span><b>${num(brief.building.floors)}${brief.building.rooftop ? " + rooftop" : ""}</b></div>
      <div><span>Finishing</span><b>${esc(FINISHING_LEVELS[brief.building.finishingLevel]?.label ?? brief.building.finishingLevel)}</b></div>
      <div><span>Budget</span><b>${idr(brief.building.budget.minIDR)} – ${idr(brief.building.budget.maxIDR)}</b></div>
    </div>
  </section>

  <section><h2>Prioritas</h2><p>${prio}</p></section>

  <section><h2>Program ruang</h2>
    <table><thead><tr><th>Ruang</th><th>Jumlah</th><th>Lantai</th><th>Ukuran</th><th>Catatan</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </section>

  <section><h2>Asumsi</h2>${list(brief.assumptions)}</section>
  <section><h2>Batasan</h2>${list(brief.constraints)}</section>
  <section><h2>Catatan risiko</h2>${risks}</section>

  <footer>Dibuat dengan Baruma · ${esc(title)}</footer>
</body></html>`
}

export function printBrief(brief: Brief, project?: Project): void {
  printHtmlDocument(briefToPrintHtml(brief, project))
}
