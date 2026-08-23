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

/**
 * Unsupported formats. Only IFC remains — DXF (hand-rolled ASCII writer,
 * `src/lib/exports/dxf.ts`) and ZIP All (`src/lib/exports/zip-all.ts`,
 * JSZip) are now real. IFC needs a proper BIM pipeline (web-ifc, G2) — its
 * export card renders a "Segera hadir" state instead (`EXPORT_META.ifc.
 * comingSoon`), so this throw is never reachable from the UI for it either.
 */
const UNSUPPORTED: ExportFormat[] = ["ifc"]

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

/** Per-format filename override — everything else falls back to the
 *  generic `{slug}-{format}.{ext}` pattern below. */
const FILENAME_OVERRIDE: Partial<Record<ExportFormat, (slugName: string) => string>> = {
  dxf: (s) => `denah-${s}.dxf`,
  zip_all: (s) => `baruma-${s}.zip`,
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
  opts: {
    interiorPlan?: InteriorPlan
    /** Free plan (`!entitlements.exportPdf`) → watermark generated PDFs. */
    watermark?: boolean
    /** `usePreviewStore.getState().captureFrame?.()`, grabbed by the caller
     *  ONLY when a 3D canvas happens to be mounted — fed to the Contractor
     *  Pack's optional 3D thumbnail page (omitted when absent). */
    thumbnailDataUrl?: string
    /** Staged progress for multi-file builders (currently zip_all only). */
    onProgress?: (pct: number) => void
  } = {}
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
    const [project, brief, rab, layout] = await Promise.all([
      data.getProject(projectId),
      data.getBrief(projectId),
      data.getRAB(projectId),
      data.getLayout(projectId),
    ])
    if (!project || !brief) throw new Error("Data belum lengkap untuk export ini.")
    const { buildContractorPackPdf } = await import("./contractor-pack")
    blob = await buildContractorPackPdf(project, brief, rab, {
      layout: layout ?? undefined,
      thumbnailDataUrl: opts.thumbnailDataUrl,
      watermark: opts.watermark,
    })
  } else if (format === "interior_pack") {
    const [project, layout] = await Promise.all([
      data.getProject(projectId),
      data.getLayout(projectId),
    ])
    if (!project || !layout) throw new Error("Data belum lengkap untuk export ini.")
    const { buildInteriorPackPdf } = await import("@/lib/interior/export")
    blob = await buildInteriorPackPdf(project, layout, opts.interiorPlan, {
      watermark: opts.watermark,
    })
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
    blob = await buildDrawingsPdf(project, layout, interiorPlan.rooms, {
      watermark: opts.watermark,
    })
  } else if (format === "dxf") {
    const [project, layout] = await Promise.all([
      data.getProject(projectId),
      data.getLayout(projectId),
    ])
    if (!project || !layout) throw new Error("Data belum lengkap untuk export ini.")
    const { buildDxfBlob } = await import("./dxf")
    blob = buildDxfBlob(layout)
  } else if (format === "zip_all") {
    const [project, brief, rab, layout, savedInterior] = await Promise.all([
      data.getProject(projectId),
      data.getBrief(projectId),
      data.getRAB(projectId),
      data.getLayout(projectId),
      data.getInterior(projectId),
    ])
    if (!project || !brief || !layout) throw new Error("Data belum lengkap untuk export ini.")
    const interiorPlan = savedInterior
      ? applySavedInterior(layout, savedInterior, { projectId })
      : generateInteriorPlan(layout, {
          projectId,
          style: interiorStyleFromHouseStyle(project.style),
        })
    const { buildZipAllBlob } = await import("./zip-all")
    blob = await buildZipAllBlob(project, brief, rab, layout, interiorPlan.rooms, {
      watermark: opts.watermark,
      thumbnailDataUrl: opts.thumbnailDataUrl,
      onProgress: opts.onProgress,
    })
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
  const filename = FILENAME_OVERRIDE[format]?.(slug(name)) ?? `${slug(name)}-${format}.${EXT[format]}`

  return { blob, filename, sizeLabel: sizeLabel(blob.size) }
}
