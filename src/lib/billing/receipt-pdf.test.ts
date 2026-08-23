// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

vi.mock("jspdf", () => {
  function jsPDF(this: Record<string, unknown>) {
    this.setFontSize = vi.fn()
    this.setFont = vi.fn()
    this.setDrawColor = vi.fn()
    this.setTextColor = vi.fn()
    this.line = vi.fn()
    this.text = vi.fn()
    this.output = vi
      .fn()
      .mockReturnValue(new Blob(["fake-pdf"], { type: "application/pdf" }))
  }
  return { jsPDF }
})

import { buildReceiptPdf, receiptFilename } from "./receipt-pdf"
import type { TransactionRow } from "@/types"

function fakeRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "sub-1",
    planName: "Pro",
    priceIdr: 149000,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    providerOrderId: "brm-abc12345-1700000000000",
    ...overrides,
  }
}

describe("buildReceiptPdf", () => {
  it("returns a Blob without throwing", async () => {
    const blob = await buildReceiptPdf(fakeRow())
    expect(blob).toBeInstanceOf(Blob)
  })
})

describe("receiptFilename", () => {
  it("uses the provider order id, sanitized", () => {
    expect(receiptFilename(fakeRow())).toBe(
      "kuitansi-baruma-brm-abc12345-1700000000000.pdf"
    )
  })

  it("falls back to the row id when providerOrderId is null", () => {
    expect(receiptFilename(fakeRow({ providerOrderId: null, id: "sub-xyz" }))).toBe(
      "kuitansi-baruma-sub-xyz.pdf"
    )
  })
})
