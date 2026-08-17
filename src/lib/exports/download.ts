import type { ExportFormat } from "@/types"
import { COPY, EXPORT_META } from "@/lib/constants"

const EXT: Record<ExportFormat, string> = {
  contractor_pack: "pdf",
  interior_pack: "pdf",
  drawings_pack: "pdf",
  dxf: "dxf",
  ifc: "ifc",
  glb: "glb",
  rab_excel: "csv",
  zip_all: "zip",
}

function slug(name: string) {
  return name.replace(/\s+/g, "-").toLowerCase()
}

/** Downloads a placeholder file so the export flow feels real (PRD §10.9). */
export function downloadMockExport(projectName: string, format: ExportFormat) {
  const meta = EXPORT_META[format]
  const content = [
    `Baruma — ${meta.title}`,
    `Project: ${projectName}`,
    "",
    meta.description,
    "",
    `Untuk: ${meta.audience}`,
    `Dibuka dengan: ${meta.opensWith}`,
    `Batasan: ${meta.limitation}`,
    "",
    COPY.draftNotice,
    "",
    "(File contoh/mock untuk demo. File asli akan dihasilkan oleh backend.)",
  ].join("\n")

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${slug(projectName)}-${format}.${EXT[format]}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
