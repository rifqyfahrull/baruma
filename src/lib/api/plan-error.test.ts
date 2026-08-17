/**
 * Unit tests for src/lib/api/plan-error.ts — recognizes the 3 billing
 * enforcement error codes and shows an upsell toast; ignores anything else.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { toast } from "sonner"
import { ApiError } from "@/lib/data/http"
import { handlePlanError } from "./plan-error"

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
})

describe("handlePlanError", () => {
  it.each([
    ["insufficient_credits", 402],
    ["plan_limit_projects", 403],
    ["plan_feature_locked", 403],
  ] as const)("recognizes %s (%d) and shows an upsell toast, returning true", (code, status) => {
    const error = new ApiError(`API POST /x → ${status}`, status, code, {
      error: code,
      message: "Pesan dari server.",
    })
    expect(handlePlanError(error)).toBe(true)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Pesan dari server.", expect.any(Object))
  })

  it("falls back to a default Indonesian message when the body has none", () => {
    const error = new ApiError("API POST /x → 402", 402, "insufficient_credits", {})
    expect(handlePlanError(error)).toBe(true)
    expect(toast.error).toHaveBeenCalledWith(
      "Kredit AI Anda telah habis.",
      expect.any(Object)
    )
  })

  it("includes an upgrade-plan action pointing at /app/billing", () => {
    const error = new ApiError("API POST /x → 403", 403, "plan_feature_locked", {})
    handlePlanError(error)
    const [, opts] = vi.mocked(toast.error).mock.calls[0]
    expect(opts).toMatchObject({ action: { label: expect.stringMatching(/upgrade/i) } })
  })

  it("returns false for an unrelated error code (e.g. admin-only 403), no toast", () => {
    const error = new ApiError("API GET /x → 403", 403, "some_other_code", {})
    expect(handlePlanError(error)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("returns false for an ApiError with no code at all", () => {
    const error = new ApiError("API GET /x → 500", 500, undefined, undefined)
    expect(handlePlanError(error)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("returns false for a plain Error / non-ApiError values", () => {
    expect(handlePlanError(new Error("boom"))).toBe(false)
    expect(handlePlanError("boom")).toBe(false)
    expect(handlePlanError(null)).toBe(false)
    expect(handlePlanError(undefined)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
