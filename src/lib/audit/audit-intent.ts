/**
 * Intent detection + plain-Indonesian formatting for the design audit, so the
 * editor assistant can answer "apakah rumah saya sesuai standar?" with the
 * grounded report (no LLM, no credits) instead of trying to turn it into edit
 * actions. Pure + testable.
 */
import type { AuditFinding, DesignAudit } from "./design-audit"

const AUDIT_PATTERNS: RegExp[] = [
  /\baudit\b/,
  /\bcek\b.*\bstandar/,
  /\bperiksa\b.*\bstandar/,
  /sesuai\s+standar/,
  /sesuai\s+sni/,
  /\bstandar\s+(sni|konstruksi|bangunan)/,
  /apakah\s+(rumah|desain|denah)\s+.*(baik|layak|benar|sesuai)/,
  /(nilai|skor|evaluasi|review)\s+(desain|denah|rumah)/,
  /apa\s+yang\s+(salah|kurang)\s+(dari|dengan|di)\s+(rumah|desain|denah)/,
]

/** True when the user is asking for a standards evaluation rather than an edit. */
export function isDesignAuditIntent(text: string): boolean {
  const t = text.toLowerCase()
  return AUDIT_PATTERNS.some((re) => re.test(t))
}

const SEVERITY_ICON = { critical: "🔴", warning: "🟡", advisory: "🔵" } as const

/** Render the audit as a compact Bahasa-Indonesia chat reply: score, verdict,
 *  then the top findings grouped by severity, each with its fix. */
export function formatAuditReply(audit: DesignAudit, maxFindings = 8): string {
  const lines: string[] = []
  lines.push(`**Skor desain: ${audit.score}/100.** ${audit.summary}`)

  if (audit.findings.length === 0) {
    lines.push("\nTidak ada masalah pada aspek yang saya periksa (ukuran ruang, cahaya, sirkulasi, struktur, sanitasi, regulasi).")
    return lines.join("\n")
  }

  const shown = audit.findings.slice(0, maxFindings)
  lines.push("")
  for (const f of shown) {
    lines.push(formatFinding(f))
  }
  const remaining = audit.findings.length - shown.length
  if (remaining > 0) {
    lines.push(`\n_…dan ${remaining} temuan lain._`)
  }

  // Point at the fixes I can apply directly (phase 2). Daylight + misplaced
  // soakwell are the ones I auto-fix today; others are guided.
  const hints: string[] = []
  if (audit.findings.some((f) => f.id.startsWith("ruang-area:"))) {
    hints.push('"perbaiki ukuran ruang" (perbesar ke minimum SNI)')
  }
  if (audit.findings.some((f) => f.category === "cahaya")) {
    hints.push('"perbaiki cahaya" (tambah jendela otomatis)')
  }
  if (audit.findings.some((f) => f.category === "sanitasi" && f.severity === "critical")) {
    hints.push('"perbaiki sanitasi" (pindahkan sumur resapan ke tanah terbuka)')
  }
  // Lead the layperson to the one-shot fix, then the per-category options.
  const fixHint = hints.length
    ? ` Bisa saya perbaiki otomatis — ketik "perbaiki semua" untuk sekaligus, atau per bagian: ${hints.join(", ")}.`
    : ""

  lines.push(
    `\nRingkasan: ${audit.counts.critical} penting, ${audit.counts.warning} perlu diperbaiki, ${audit.counts.advisory} saran.${fixHint}`,
  )
  return lines.join("\n")
}

function formatFinding(f: AuditFinding): string {
  const icon = SEVERITY_ICON[f.severity]
  const std = f.standard ? ` _(${f.standard})_` : ""
  const fix = f.fix ? `\n   → ${f.fix}` : ""
  return `${icon} **${f.title}**${std}\n   ${f.detail}${fix}`
}

/**
 * Compact plain-text audit summary for injection into an LLM system prompt
 * (no markdown/emoji noise) — grounds the assistant in the actual standards
 * status so it answers "apakah desain saya bagus?" from facts, not vibes.
 * Returns "" when there is nothing to report.
 */
export function summarizeAuditForPrompt(audit: DesignAudit, maxFindings = 8): string {
  if (audit.findings.length === 0) {
    return `Skor kelayakan standar denah saat ini: ${audit.score}/100. Tidak ada pelanggaran standar pada aspek yang diperiksa (ukuran ruang, cahaya, sirkulasi, struktur, sanitasi, regulasi).`
  }
  const lines = audit.findings
    .slice(0, maxFindings)
    .map((f) => `- ${f.title}${f.standard ? ` (${f.standard})` : ""}`)
  const more = audit.findings.length - Math.min(maxFindings, audit.findings.length)
  return (
    `Hasil audit standar denah (deterministik, bukan tebakan) — skor ${audit.score}/100, ` +
    `${audit.counts.critical} masalah penting, ${audit.counts.warning} perlu diperbaiki, ${audit.counts.advisory} saran:\n` +
    lines.join("\n") +
    (more > 0 ? `\n- …dan ${more} temuan lain` : "") +
    `\nPemilik rumah bisa memperbaiki sebagian besar otomatis di Editor Denah (ketik "perbaiki semua" pada Asisten Denah).`
  )
}
