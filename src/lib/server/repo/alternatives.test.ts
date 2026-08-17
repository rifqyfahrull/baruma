// @vitest-environment node
/**
 * Unit tests for alternatives repo queries.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
})

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

import { getAlternatives } from "./alternatives"
import * as db from "@/lib/server/db"

describe("getAlternatives", () => {
  it("uses stable ORDER BY created_at, alternative_id", async () => {
    vi.mocked(db.query).mockClear()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    await getAlternatives("proj-123")

    const calls = vi.mocked(db.query).mock.calls
    const [sqlQuery] = calls[calls.length - 1] as [string, unknown[]]
    expect(sqlQuery).toContain("ORDER BY created_at, alternative_id")
    expect(sqlQuery).not.toMatch(/ORDER BY created_at\s*(ASC|DESC)?\s*$/)
  })

  it("returns mapped payloads from result rows", async () => {
    const fakePayload = {
      id: "alt-1",
      projectId: "proj-123",
      name: "Alt One",
      type: "hemat_biaya",
      score: 80,
      thumbnail: "compact",
      description: "desc",
      keyFeatures: [],
      pros: [],
      cons: [],
      estimatedCost: { minIDR: 100, maxIDR: 200 },
      readiness: "concept_ready",
      risks: [],
      areaM2: 60,
      roomCount: 3,
      floors: 1,
    }
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ alternative_id: "alt-1", payload: fakePayload }],
      rowCount: 1,
    } as never)

    const result = await getAlternatives("proj-123")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("alt-1")
  })
})
