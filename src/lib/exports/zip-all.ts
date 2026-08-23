/**
 * "ZIP All Files" export: bundles the Contractor Pack, Gambar Kerja
 * (drawings pack), Interior Pack, and RAB Excel — all built in-memory — into
 * one `baruma-{slug}.zip` via JSZip. GLB is intentionally excluded (kept
 * `includeGlb: false` by default): a 3D model can be tens of MB and most
 * "share everything with the contractor" use-cases don't need it bundled.
 */
import JSZip from "jszip"

import type { Brief, DesignLayout, Project, RAB, RoomInteriorPlan } from "@/types"

export type ZipAllOpts = {
  /** Free plan (`!entitlements.exportPdf`) → watermarks every bundled PDF. */
  watermark?: boolean
  /** 3D canvas capture, threaded into the Contractor Pack page if present. */
  thumbnailDataUrl?: string
  /** Reports 0–100 as each file finishes — mirrors the export-store job's
   *  staged progress (contractor → drawings → interior → RAB → zip). */
  onProgress?: (pct: number) => void
  /** Off by default — see module doc. */
  includeGlb?: boolean
}

export async function buildZipAllBlob(
  project: Project,
  brief: Brief,
  rab: RAB | null,
  layout: DesignLayout,
  interiors: RoomInteriorPlan[],
  opts: ZipAllOpts = {}
): Promise<Blob> {
  const zip = new JSZip()
  const report = opts.onProgress ?? (() => {})

  report(5)
  const { buildContractorPackPdf } = await import("./contractor-pack")
  zip.file(
    "contractor-pack.pdf",
    await buildContractorPackPdf(project, brief, rab, {
      layout,
      thumbnailDataUrl: opts.thumbnailDataUrl,
      watermark: opts.watermark,
    })
  )

  report(35)
  const { buildDrawingsPdf } = await import("./drawings-pack")
  zip.file(
    "gambar-kerja.pdf",
    await buildDrawingsPdf(project, layout, interiors, { watermark: opts.watermark })
  )

  report(60)
  const { buildInteriorPackPdf } = await import("@/lib/interior/export")
  zip.file(
    "interior-pack.pdf",
    await buildInteriorPackPdf(project, layout, undefined, { watermark: opts.watermark })
  )

  report(80)
  if (rab) {
    const { rabToXlsxBlob } = await import("@/lib/rab/export-rab")
    zip.file("rab.xlsx", await rabToXlsxBlob(rab, project))
  }

  if (opts.includeGlb) {
    report(90)
    const { buildGlbBlob } = await import("./glb")
    zip.file("model-3d.glb", await buildGlbBlob(layout, project))
  }

  report(95)
  const blob = await zip.generateAsync({ type: "blob" })
  report(100)
  return blob
}
