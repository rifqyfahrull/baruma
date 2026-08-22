// @vitest-environment node
import { describe, expect, it } from "vitest"

import { RENDER_CREDIT_COST, renderCreditCost } from "./pricing"

describe("RENDER_CREDIT_COST", () => {
  it("locks the credit price per mode (Fase 7 pricing.ts)", () => {
    expect(RENDER_CREDIT_COST).toEqual({ cepat: 1, presisi: 2, paketFoto: 6 })
  })

  it("renderCreditCost reads the same constant", () => {
    expect(renderCreditCost("cepat")).toBe(1)
    expect(renderCreditCost("presisi")).toBe(2)
    expect(renderCreditCost("paketFoto")).toBe(6)
  })
})
