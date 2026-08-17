import { describe, it, expect } from "vitest"

import { isDesignAuditIntent, formatAuditReply, summarizeAuditForPrompt } from "./audit-intent"
import type { DesignAudit } from "./design-audit"

describe("isDesignAuditIntent", () => {
  it("matches standards-evaluation questions", () => {
    for (const q of [
      "apakah rumah saya sudah sesuai standar?",
      "tolong audit denah ini",
      "cek standar SNI dong",
      "apakah desain ini sudah baik?",
      "beri nilai desain rumah saya",
      "apa yang kurang dari rumah ini",
    ]) {
      expect(isDesignAuditIntent(q), q).toBe(true)
    }
  })

  it("does NOT match ordinary edit instructions", () => {
    for (const q of [
      "pindahkan kamar mandi ke lantai 2",
      "perbaiki tata letak lantai 1 yang bertumpuk",
      "tambah jendela di kamar tidur",
      "geser dapur ke kanan",
    ]) {
      expect(isDesignAuditIntent(q), q).toBe(false)
    }
  })
})

describe("formatAuditReply", () => {
  const audit: DesignAudit = {
    score: 72,
    summary: "Desain cukup baik, tapi ada 2 hal yang sebaiknya diperbaiki.",
    counts: { critical: 0, warning: 2, advisory: 1 },
    byCategory: [],
    findings: [
      {
        id: "ruang-area:kt1",
        category: "ruang",
        severity: "warning",
        title: "Kamar utama lebih kecil dari standar (7.5 m² < 9 m²)",
        detail: "Kamar tidur yang layak huni minimal 9 m².",
        standard: "SNI 03-1733-2004",
        fix: "Perbesar kamar utama hingga 9 m².",
        objectId: "kt1",
      },
      {
        id: "cahaya:dapur",
        category: "cahaya",
        severity: "advisory",
        title: "Jendela dapur kurang luas",
        detail: "Butuh bukaan ≥ 10% luas lantai.",
        standard: "SNI 03-6572-2001",
        fix: "Lebarkan jendela dapur.",
      },
    ],
  }

  it("leads with score + summary and includes fixes + standards", () => {
    const reply = formatAuditReply(audit)
    expect(reply).toMatch(/Skor desain: 72\/100/)
    expect(reply).toContain("SNI 03-1733-2004")
    expect(reply).toContain("Perbesar kamar utama")
    expect(reply).toMatch(/2 perlu diperbaiki/)
  })

  it("caps the number of findings shown and notes the remainder", () => {
    const many: DesignAudit = {
      ...audit,
      findings: Array.from({ length: 12 }, (_, i) => ({
        ...audit.findings[0],
        id: `f${i}`,
        title: `Temuan ${i}`,
      })),
    }
    const reply = formatAuditReply(many, 5)
    expect(reply).toMatch(/7 temuan lain/)
  })

  it("says all-clear when there are no findings", () => {
    const clean: DesignAudit = { score: 100, summary: "Bagus!", counts: { critical: 0, warning: 0, advisory: 0 }, byCategory: [], findings: [] }
    expect(formatAuditReply(clean)).toMatch(/Tidak ada masalah/)
  })
})

describe("summarizeAuditForPrompt", () => {
  const auditWith = (findings: DesignAudit["findings"], score = 64): DesignAudit => ({
    score, summary: "x", counts: { critical: 0, warning: findings.length, advisory: 0 }, byCategory: [], findings,
  })

  it("produces a compact plain-text list with score + standards (no markdown noise)", () => {
    const s = summarizeAuditForPrompt(auditWith([
      { id: "ruang-area:kt", category: "ruang", severity: "warning", title: "Kamar kecil", detail: "d", standard: "SNI 03-1733-2004", fix: "f" },
    ]))
    expect(s).toContain("skor 64/100")
    expect(s).toContain("Kamar kecil (SNI 03-1733-2004)")
    expect(s).not.toContain("**") // no markdown
    expect(s).toContain("perbaiki semua")
  })

  it("reports an all-clear when there are no findings", () => {
    expect(summarizeAuditForPrompt(auditWith([], 100))).toMatch(/Tidak ada pelanggaran/)
  })
})
