// @vitest-environment node
/**
 * Unit test untuk repo render-polish-cache.ts — cache hasil LLM polish per
 * hash(SceneFacts) (lihat db/migrations/0043_ai_render_scene_intel.sql).
 * `query` di-mock; tak butuh DATABASE_URL (pola renders.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => query(...a) }))

import { getPolishCache, setPolishCache } from "./render-polish-cache"

function lastSql(): string {
  return String(query.mock.calls.at(-1)?.[0] ?? "")
}
function lastParams(): unknown[] {
  return (query.mock.calls.at(-1)?.[1] ?? []) as unknown[]
}

beforeEach(() => {
  query.mockReset()
})

describe("getPolishCache", () => {
  it("miss -> null", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const desc = await getPolishCache("hash-tak-ada")
    expect(desc).toBeNull()
    expect(lastSql()).toMatch(/SELECT description FROM render_polish_cache WHERE facts_hash = \$1/)
    expect(lastParams()).toEqual(["hash-tak-ada"])
  })

  it("hit -> mengembalikan description", async () => {
    query.mockResolvedValueOnce({ rows: [{ description: "Ruang tamu modern, pencahayaan hangat." }] })
    const desc = await getPolishCache("hash-abc")
    expect(desc).toBe("Ruang tamu modern, pencahayaan hangat.")
  })
})

describe("setPolishCache", () => {
  it("INSERT ... ON CONFLICT (facts_hash) DO NOTHING", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await setPolishCache("hash-abc", "Ruang tamu modern, pencahayaan hangat.")

    expect(lastSql()).toMatch(/INSERT INTO render_polish_cache/)
    expect(lastSql()).toMatch(/ON CONFLICT \(facts_hash\) DO NOTHING/)
    expect(lastParams()).toEqual(["hash-abc", "Ruang tamu modern, pencahayaan hangat."])
  })

  it("set lalu get (mock berurutan) -> description konsisten", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await setPolishCache("hash-xyz", "Fasad tropis, atap pelana.")

    query.mockResolvedValueOnce({ rows: [{ description: "Fasad tropis, atap pelana." }] })
    const desc = await getPolishCache("hash-xyz")
    expect(desc).toBe("Fasad tropis, atap pelana.")
  })
})
