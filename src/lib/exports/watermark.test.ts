// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import type { jsPDF } from "jspdf"

import { applyDraftWatermark, DEFAULT_WATERMARK_TEXT } from "./watermark"

/** Minimal fake jsPDF — only the surface `applyDraftWatermark` touches. */
function makeFakeDoc(pageCount = 1) {
  const calls: { setPage: number[]; text: unknown[][] } = { setPage: [], text: [] }
  const doc = {
    internal: {
      pageSize: { getWidth: () => 420, getHeight: () => 297 },
    },
    getNumberOfPages: () => pageCount,
    setPage: vi.fn((n: number) => calls.setPage.push(n)),
    saveGraphicsState: vi.fn(),
    restoreGraphicsState: vi.fn(),
    setGState: vi.fn(),
    GState: vi.fn((opts: unknown) => opts),
    setTextColor: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    text: vi.fn((...args: unknown[]) => calls.text.push(args)),
  }
  return { doc: doc as unknown as jsPDF, calls }
}

describe("applyDraftWatermark", () => {
  it("visits every existing page via setPage", () => {
    const { doc, calls } = makeFakeDoc(3)
    applyDraftWatermark(doc)
    expect(calls.setPage).toEqual([1, 2, 3])
  })

  it("draws the default text tiled diagonally on each page, translucent", () => {
    const { doc, calls } = makeFakeDoc(1)
    applyDraftWatermark(doc)

    expect(calls.text.length).toBeGreaterThan(1) // tiled, not a single stamp
    for (const [text, , , opts] of calls.text) {
      expect(text).toBe(DEFAULT_WATERMARK_TEXT)
      expect((opts as { angle: number }).angle).toBeGreaterThan(0)
      expect((opts as { align: string }).align).toBe("center")
    }

    expect(doc.setGState).toHaveBeenCalledWith(expect.objectContaining({ opacity: expect.any(Number) }))
    expect((doc.GState as unknown as { mock: { calls: [{ opacity: number }][] } }).mock.calls[0][0].opacity).toBeLessThan(1)
  })

  it("accepts a custom watermark text", () => {
    const { doc, calls } = makeFakeDoc(1)
    applyDraftWatermark(doc, "CUSTOM DRAFT")
    expect(calls.text.every(([text]) => text === "CUSTOM DRAFT")).toBe(true)
  })

  it("wraps drawing in save/restore graphics state per page", () => {
    const { doc } = makeFakeDoc(2)
    applyDraftWatermark(doc)
    expect(doc.saveGraphicsState).toHaveBeenCalledTimes(2)
    expect(doc.restoreGraphicsState).toHaveBeenCalledTimes(2)
  })
})
