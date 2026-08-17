/**
 * Generates a review snapshot from the project, brief, and layout (PRD §10.10):
 * aggregated warnings (structural/spatial/cost/legal), a professional-review
 * checklist, an AI summary, and a seed comment.
 */
import type {
  Brief,
  Comment,
  DesignLayout,
  Project,
  Review,
  ReviewChecklistItem,
  RiskWarning,
} from "@/types"
import { FINISHING_LEVELS } from "@/lib/constants"
import { formatIDRCompact } from "@/lib/format"
import { poolSafetyIssues } from "@/lib/water/pool-safety"

export function generateReview(
  project: Project,
  brief: Brief,
  layout: DesignLayout
): Review {
  const warnings: RiskWarning[] = []

  // From the brief (structural / spatial).
  for (const r of brief.risks) warnings.push({ ...r })

  // Spatial issues from the live layout validation.
  for (const issue of layout.validation.issues) {
    if (issue.level === "info" || issue.category !== "spatial") continue
    warnings.push({
      id: `val-${issue.id}`,
      level: issue.level,
      category: "spatial",
      title: "Tata ruang",
      message: issue.message,
    })
  }

  // Cost vs budget.
  const builtArea =
    layout.rooms.reduce((s, r) => s + r.areaM2, 0) ||
    project.site.areaM2 * project.floors
  const perM2 = FINISHING_LEVELS[brief.building.finishingLevel].perM2IDR
  const mid = builtArea * perM2
  const maxBudget = brief.building.budget.maxIDR
  if (maxBudget > 0 && mid > maxBudget) {
    warnings.push({
      id: "cost-budget",
      level: "warning",
      category: "cost",
      title: "Estimasi di atas budget",
      message: `Perkiraan ~${formatIDRCompact(
        mid
      )} melebihi batas atas budget (${formatIDRCompact(
        maxBudget
      )}). Pertimbangkan turunkan finishing atau kurangi fitur.`,
    })
  }

  // Legal / permits.
  warnings.push({
    id: "legal-pbg",
    level: "info",
    category: "legal",
    title: "Perizinan (PBG)",
    message:
      "Urus Persetujuan Bangunan Gedung (PBG) dan cek garis sempadan sebelum membangun.",
  })

  // Keselamatan & beban kolam (KL-6): kolam di lantai atas/dak + pagar anak.
  for (const issue of poolSafetyIssues(layout, brief)) {
    warnings.push({
      id: `pool-safety-${issue.poolId}-${issue.level}`,
      level: issue.level,
      category: "structural",
      title: issue.title,
      message: issue.message,
    })
  }

  const hasPool = layout.rooms.some((r) => r.type === "kolam")
  const needsStruct = project.floors >= 3 || hasPool

  const checklist: ReviewChecklistItem[] = [
    { role: "arsitek", label: "Tinjau denah, sirkulasi & estetika", status: "pending" },
    {
      role: "engineer_struktur",
      label: "Tinjau struktur & beban",
      status: needsStruct ? "pending" : "not_required",
    },
    { role: "mep", label: "Tinjau MEP / plumbing", status: "pending" },
    { role: "kontraktor", label: "Tinjau biaya & metode pelaksanaan", status: "pending" },
    { role: "pbg_legal", label: "Cek perizinan & sempadan", status: "pending" },
  ]

  const warnCount = warnings.filter((w) => w.level !== "info").length
  const aiSummary =
    `Konsep ${project.floors} lantai${hasPool ? " dengan kolam" : ""} di lahan ` +
    `${project.site.widthM}×${project.site.depthM} m. ` +
    (warnCount > 0
      ? `Ada ${warnCount} hal yang perlu perhatian${
          needsStruct ? ", terutama review struktur" : ""
        }. `
      : "Tidak ada peringatan besar. ") +
    "Bawa paket ini ke arsitek/kontraktor untuk dilanjutkan."

  const comments: Comment[] = [
    {
      id: "c-ai",
      author: "Asisten AI",
      body: needsStruct
        ? "Struktur bertingkat dan kolam menambah beban — pastikan ditinjau engineer struktur sebelum lanjut."
        : "Layout terlihat seimbang. Lanjutkan diskusi dengan kontraktor.",
      createdAt: "2026-06-18T09:10:00.000Z",
      resolved: false,
    },
  ]

  return {
    projectId: project.id,
    versionId: project.currentVersionId ?? `ver-${project.id}`,
    aiSummary,
    checklist,
    comments,
    warnings,
    resolvedWarningIds: [],
  }
}
