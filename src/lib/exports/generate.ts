/**
 * Central generate function: fetches data, calls the right builder, and returns
 * a Blob + filename + human-readable size label.
 */
import type { ExportFormat, InteriorPlan } from "@/types"
import { data } from "@/lib/data"
import { rabToXlsxBlob } from "@/lib/rab/export-rab"
import {
  applySavedInterior,
  generateInteriorPlan,
  interiorStyleFromHouseStyle,
} from "@/lib/interior/plan"

// Builder PDF/GLB di-load lazy per format — jspdf, jspdf-autotable, dan
// three/GLTFExporter (~950 KB total) hanya diunduh saat user benar-benar
// mengklik export, bukan di bundle awal halaman /exports.
// (Pola yang sama dengan rabToXlsxBlob yang meng-import() xlsx internal.)

/** Unsupported formats that require a CAD pipeline. */
const UNSUPPORTED: ExportFormat[] = ["dxf", "ifc", "zip_all"]

const EXT: Record<ExportFormat, string> = {
  contractor_pack: "pdf",
  interior_pack: "pdf",
  drawings_pack: "pdf",
  dxf: "dxf",
  ifc: "ifc",
  glb: "glb",
  rab_excel: "xlsx",
  zip_all: "zip",
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project"
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`
  return `${bytes} B`
}

export async function generateExport(
  projectId: string,
  format: ExportFormat,
  opts: { interiorPlan?: InteriorPlan } = {}
): Promise<{ blob: Blob; filename: string; sizeLabel: string }> {
  if (UNSUPPORTED.includes(format)) {
    throw new Error("Format ini belum tersedia (butuh pipeline CAD).")
  }

  let blob: Blob

  if (format === "rab_excel") {
    const [project, rab] = await Promise.all([
      data.getProject(projectId),
      data.getRAB(projectId),
    ])
    if (!project || !rab) throw new Error("Data belum lengkap untuk export ini.")
    blob = await rabToXlsxBlob(rab, project)
  } else if (format === "contractor_pack") {
    const [project, brief, rab] = await Promise.all([
      data.getProject(projectId),
      data.getBrief(projectId),
      data.getRAB(projectId),
    ])
    if (!project || !brief) throw new Error("Data belum lengkap untuk export ini.")
    const { buildContractorPackPdf } = await import("./contractor-pack")
    blob = await buildContractorPackPdf(project, brief, rab)
  } else if (format === "interior_pack") {
    const [project, layout] = await Promise.all([
      data.getProject(projectId),
      data.getLayout(projectId),
    ])
    if (!project || !layout) throw new Error("Data belum lengkap untuk export ini.")
    const { buildInteriorPackPdf } = await import("@/lib/interior/export")
    blob = await buildInteriorPackPdf(project, layout, opts.interiorPlan)
  } else if (format === "drawings_pack") {
    const [project, layout, savedInterior] = await Promise.all([
      data.getProject(projectId),
      data.getLayout(projectId),
      data.getInterior(projectId),
    ])
    if (!project || !layout) throw new Error("Data belum lengkap untuk export ini.")
    // Same pure saved-vs-generated resolution as the /drawings page, so the
    // PDF's Pola Lantai / Rencana Plafon sheets match the screen exactly.
    const interiorPlan = savedInterior
      ? applySavedInterior(layout, savedInterior, { projectId })
      : generateInteriorPlan(layout, {
          projectId,
          style: interiorStyleFromHouseStyle(project.style),
        })
    const { buildDrawingsPdf } = await import("./drawings-pack")
    blob = await buildDrawingsPdf(project, layout, interiorPlan.rooms)
  } else {
    // glb
    const [project, layout] = await Promise.all([
      data.getProject(projectId),
      data.getLayout(projectId),
    ])
    if (!project || !layout) throw new Error("Data belum lengkap untuk export ini.")
    const { buildGlbBlob } = await import("./glb")
    blob = await buildGlbBlob(layout, project)
  }

  const project = await data.getProject(projectId)
  const name = project?.name ?? projectId
  const filename = `${slug(name)}-${format}.${EXT[format]}`

  return { blob, filename, sizeLabel: sizeLabel(blob.size) }
}
