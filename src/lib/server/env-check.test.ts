import { describe, expect, it, vi } from "vitest"
import { assertProductionEnv, validateProductionEnv, type EnvLike } from "./env-check"

function fullEnv(overrides: Partial<EnvLike> = {}): EnvLike {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@host:5432/db",
    BARUMA_JWT_SECRET: "a-very-long-secret-key-at-least-32-chars",
    AUTH_SECRET: "another-very-long-secret-key-32chars",
    NEXT_PUBLIC_DATA_SOURCE: "http",
    ...overrides,
  }
}

describe("validateProductionEnv", () => {
  it("returns no errors when every required var is set and data source is http", () => {
    expect(validateProductionEnv(fullEnv())).toEqual([])
  })

  it("flags a missing DATABASE_URL", () => {
    const errors = validateProductionEnv(fullEnv({ DATABASE_URL: undefined }))
    expect(errors.some((e) => e.includes("DATABASE_URL"))).toBe(true)
  })

  it("flags an empty-string BARUMA_JWT_SECRET (not just undefined)", () => {
    const errors = validateProductionEnv(fullEnv({ BARUMA_JWT_SECRET: "" }))
    expect(errors.some((e) => e.includes("BARUMA_JWT_SECRET"))).toBe(true)
  })

  it("flags a whitespace-only AUTH_SECRET", () => {
    const errors = validateProductionEnv(fullEnv({ AUTH_SECRET: "   " }))
    expect(errors.some((e) => e.includes("AUTH_SECRET"))).toBe(true)
  })

  it("flags NEXT_PUBLIC_DATA_SOURCE=mock even when every secret is present", () => {
    const errors = validateProductionEnv(fullEnv({ NEXT_PUBLIC_DATA_SOURCE: "mock" }))
    expect(errors.some((e) => e.includes("mock"))).toBe(true)
  })

  it("collects every violation at once, not just the first", () => {
    const errors = validateProductionEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_DATA_SOURCE: "mock",
    })
    expect(errors.length).toBeGreaterThanOrEqual(4) // 3 secrets + mock
  })
})

describe("assertProductionEnv", () => {
  it("throws with a clear Indonesian message listing missing vars when NODE_ENV=production and env is invalid", () => {
    expect(() =>
      assertProductionEnv({ NODE_ENV: "production" })
    ).toThrowError(/DATABASE_URL/)
  })

  it("does not throw when NODE_ENV=production and env is fully valid", () => {
    expect(() => assertProductionEnv(fullEnv())).not.toThrow()
  })

  it("never throws outside production — warns instead", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => assertProductionEnv({ NODE_ENV: "development" })).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("stays silent in dev when the env would actually be valid for production", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    assertProductionEnv(fullEnv({ NODE_ENV: "development" }))
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
