// @vitest-environment node
/**
 * Credits repo — memory-fallback semantics (no DATABASE_URL). Each test uses
 * its own profile id: the memory map seeds lazily at { used: 0, total: 10 }.
 *
 * A second section below (DB mode) mocks @/lib/server/db to verify the
 * balance UPDATE + ledger INSERT run inside one BEGIN/COMMIT/ROLLBACK
 * transaction — see the top-of-file comment in ./credits.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"

vi.mock("@/lib/server/db", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))

import {
  adjustCredits,
  getCredits,
  grantPeriodCredits,
  refundCredits,
  refundCreditsOnce,
  spendCredits,
  spendCreditsOnce,
} from "./credits"
import * as db from "@/lib/server/db"

beforeAll(() => {
  delete process.env.DATABASE_URL
})

describe("spendCredits (memory fallback)", () => {
  it("decrements the balance and returns ok", async () => {
    expect(await spendCredits("u-spend", 3, "generate")).toBe("ok")
    expect(await getCredits("u-spend")).toEqual({ used: 3, total: 10 })
  })

  it("returns insufficient (and leaves the balance untouched) when exceeding", async () => {
    expect(await spendCredits("u-insuf", 8, "generate")).toBe("ok")
    expect(await spendCredits("u-insuf", 3, "generate")).toBe("insufficient")
    expect(await getCredits("u-insuf")).toEqual({ used: 8, total: 10 })
  })

  it("allows spending exactly up to the total, then refuses", async () => {
    expect(await spendCredits("u-edge", 10, "generate")).toBe("ok")
    expect(await spendCredits("u-edge", 1, "generate")).toBe("insufficient")
    expect(await getCredits("u-edge")).toEqual({ used: 10, total: 10 })
  })
})

describe("idempotent Project Agent credits (memory fallback)", () => {
  it("charges and refunds a client request at most once", async () => {
    expect(await spendCreditsOnce("u-agent", 1, "project_agent", "req-12345678")).toBe("ok")
    expect(await spendCreditsOnce("u-agent", 1, "project_agent", "req-12345678")).toBe("already_spent")
    expect(await getCredits("u-agent")).toEqual({ used: 1, total: 10 })

    expect(await refundCreditsOnce("u-agent", 1, "project_agent_refund", "req-12345678")).toBe("ok")
    expect(await refundCreditsOnce("u-agent", 1, "project_agent_refund", "req-12345678")).toBe("already_refunded")
    expect(await getCredits("u-agent")).toEqual({ used: 0, total: 10 })
  })
})

describe("refundCredits (memory fallback)", () => {
  it("gives credits back after a spend", async () => {
    await spendCredits("u-refund", 4, "generate", "proj-1")
    await refundCredits("u-refund", 2, "refund", "proj-1")
    expect(await getCredits("u-refund")).toEqual({ used: 2, total: 10 })
  })

  it("clamps usage at 0 when refunding more than was spent", async () => {
    await spendCredits("u-clamp", 1, "generate")
    await refundCredits("u-clamp", 5, "refund")
    expect(await getCredits("u-clamp")).toEqual({ used: 0, total: 10 })
  })
})

describe("grantPeriodCredits (memory fallback)", () => {
  it("resets usage to 0 and sets the new period total", async () => {
    await spendCredits("u-grant", 6, "generate")
    await grantPeriodCredits("u-grant", 100, "period_grant")
    expect(await getCredits("u-grant")).toEqual({ used: 0, total: 100 })
  })
})

describe("adjustCredits (memory fallback)", () => {
  it("adds to the total", async () => {
    await adjustCredits("u-adjust", 20, "admin_adjust")
    expect(await getCredits("u-adjust")).toEqual({ used: 0, total: 30 })
  })

  it("clamps the total at the current usage when subtracting too much", async () => {
    await spendCredits("u-adjust-clamp", 5, "generate")
    await adjustCredits("u-adjust-clamp", -100, "admin_adjust")
    expect(await getCredits("u-adjust-clamp")).toEqual({ used: 5, total: 5 })
  })
})

/* ── DB mode: balance UPDATE + ledger INSERT as one transaction ───────────── */

/**
 * First SQL keyword of a query call (BEGIN / UPDATE / INSERT / COMMIT /
 * ROLLBACK) — enough to assert transaction shape without pinning exact SQL.
 */
function keywordOf(sql: string): string {
  return sql.trim().split(/\s+/)[0].toUpperCase()
}

/**
 * A fake PoolClient. `updateRowCount` controls whether the balance UPDATE
 * "hits" (>0, simulating a real row change) or affects 0 rows (insufficient
 * credits). `failInsert` makes the ledger INSERT reject, to exercise the
 * rollback path.
 */
function makeMockClient(updateRowCount: number, opts?: { failInsert?: boolean }) {
  const query = vi.fn(async (sql: string) => {
    const kw = keywordOf(sql)
    if (kw === "UPDATE") {
      return { rows: updateRowCount > 0 ? [{ id: "p-1" }] : [], rowCount: updateRowCount }
    }
    if (kw === "INSERT") {
      if (opts?.failInsert) throw new Error("ledger insert failed")
      return { rows: [], rowCount: 1 }
    }
    // BEGIN / COMMIT / ROLLBACK — result unused by the caller.
    return { rows: [], rowCount: 0 }
  })
  const release = vi.fn()
  return { query, release }
}

function callKeywords(client: { query: ReturnType<typeof vi.fn> }): string[] {
  return client.query.mock.calls.map((args) => keywordOf(args[0] as string))
}

describe("spendCredits (DB mode, transaction)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
  })

  afterEach(() => {
    delete process.env.DATABASE_URL
    vi.mocked(db.getClient).mockReset()
    vi.mocked(db.query).mockReset()
  })

  it("success: BEGIN -> UPDATE -> ledger INSERT -> COMMIT, then releases the client", async () => {
    const client = makeMockClient(1)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    const result = await spendCredits("p-1", 3, "generate")

    expect(result).toBe("ok")
    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "INSERT", "COMMIT"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("insufficient: BEGIN -> UPDATE (0 rows) -> COMMIT, no ledger insert, no ROLLBACK", async () => {
    const client = makeMockClient(0)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    const result = await spendCredits("p-1", 999, "generate")

    // Insufficient credits is not a failure: the transaction commits its
    // no-op cleanly rather than rolling back, and no ledger row is written
    // since there is nothing to explain.
    expect(result).toBe("insufficient")
    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "COMMIT"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("rolls back the whole transaction when the ledger insert throws, and rejects", async () => {
    const client = makeMockClient(1, { failInsert: true })
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    // The promise must reject (a genuine failure, safe for the caller to
    // retry) rather than silently resolving "ok" with a half-done write.
    await expect(spendCredits("p-1", 3, "generate")).rejects.toThrow("ledger insert failed")

    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "INSERT", "ROLLBACK"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe("refundCredits / grantPeriodCredits / adjustCredits (DB mode, transaction)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
  })

  afterEach(() => {
    delete process.env.DATABASE_URL
    vi.mocked(db.getClient).mockReset()
    vi.mocked(db.query).mockReset()
  })

  it("refundCredits: BEGIN -> UPDATE -> ledger INSERT -> COMMIT", async () => {
    const client = makeMockClient(1)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    await refundCredits("p-1", 2, "refund", "proj-1")

    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "INSERT", "COMMIT"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("grantPeriodCredits: BEGIN -> UPDATE -> ledger INSERT -> COMMIT", async () => {
    const client = makeMockClient(1)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    await grantPeriodCredits("p-1", 100, "period_grant")

    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "INSERT", "COMMIT"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("adjustCredits: BEGIN -> UPDATE -> ledger INSERT -> COMMIT", async () => {
    const client = makeMockClient(1)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    await adjustCredits("p-1", 20, "admin_adjust")

    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "INSERT", "COMMIT"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it("adjustCredits: threads the optional refId through to the ledger INSERT (I3 — admin's free-text note)", async () => {
    const client = makeMockClient(1)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    await adjustCredits("p-1", 20, "admin_adjust", "Bonus promo Lebaran")

    const insertCall = client.query.mock.calls.find(
      (args) => keywordOf(args[0] as string) === "INSERT"
    )
    expect(insertCall?.[1]).toEqual([
      "p-1",
      20,
      "admin_adjust",
      "Bonus promo Lebaran",
    ])
  })

  it("rolls back and rejects when the ledger insert throws (refundCredits as representative)", async () => {
    const client = makeMockClient(1, { failInsert: true })
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    await expect(refundCredits("p-1", 2, "refund")).rejects.toThrow("ledger insert failed")

    expect(callKeywords(client)).toEqual(["BEGIN", "UPDATE", "INSERT", "ROLLBACK"])
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe("idempotent Project Agent credits (DB mode)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
  })

  afterEach(() => {
    delete process.env.DATABASE_URL
    vi.mocked(db.getClient).mockReset()
  })

  it("inserts the unique ledger reservation before changing the balance", async () => {
    const client = makeMockClient(1)
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    expect(await spendCreditsOnce("p-1", 1, "project_agent", "req-12345678")).toBe("ok")
    expect(callKeywords(client)).toEqual(["BEGIN", "INSERT", "UPDATE", "COMMIT"])
  })

  it("treats a duplicate ledger ref as already spent without another UPDATE", async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: [],
      rowCount: keywordOf(sql) === "INSERT" ? 0 : 1,
    }))
    const client = { query, release: vi.fn() }
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    expect(await spendCreditsOnce("p-1", 1, "project_agent", "req-duplicate")).toBe("already_spent")
    expect(callKeywords(client)).toEqual(["BEGIN", "INSERT", "COMMIT"])
  })
})
