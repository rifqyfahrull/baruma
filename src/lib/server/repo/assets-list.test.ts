// @vitest-environment node
/**
 * Unit test untuk listUserAssets — paginasi + search server-side.
 * Memverifikasi SQL yang dibangun (WHERE/params/LIMIT/OFFSET) & bentuk return
 * {rows, total}. Query di-mock; fokus pada logika penyusunan query.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => query(...a) }))

import { listUserAssets } from "./assets"

beforeEach(() => {
  query.mockReset()
  query.mockResolvedValue({ rows: [] })
})

function lastSql(): string {
  return String(query.mock.calls.at(-1)?.[0] ?? "")
}
function lastParams(): unknown[] {
  return (query.mock.calls.at(-1)?.[1] ?? []) as unknown[]
}

describe("listUserAssets — paginasi & search", () => {
  it("tanpa filter: LIMIT/OFFSET default, hanya param userId+limit+offset", async () => {
    await listUserAssets("user-1", {})
    const sql = lastSql()
    expect(sql).toMatch(/ua\.user_id = \$1 OR ua\.is_public = true/)
    expect(sql).toMatch(/limit \$/i)
    expect(sql).toMatch(/offset \$/i)
    expect(sql).toMatch(/count\(\*\) over\(\)/i)
    // enrichment: join asset_knowledge utk description + keyword search
    expect(sql).toMatch(/left join asset_knowledge/i)
    // params: userId, limit, offset
    expect(lastParams()[0]).toBe("user-1")
  })

  it("dengan category: menambah klausa category = $ dan param-nya", async () => {
    await listUserAssets("user-1", { category: "gate" })
    expect(lastSql()).toMatch(/category = \$/i)
    expect(lastParams()).toContain("gate")
  })

  it("dengan search: ILIKE ANY dgn ekspansi sinonim (sofa → juga couch)", async () => {
    await listUserAssets("user-1", { search: "sofa" })
    const sql = lastSql()
    expect(sql).toMatch(/ilike any/i)
    // ikut mencari di keywords/description enrichment
    expect(sql).toMatch(/ak\.keywords ilike any/i)
    expect(sql).toMatch(/ak\.description_id ilike any/i)
    // param search = array pola %term% hasil ekspansi sinonim
    const arrParam = lastParams().find((p) => Array.isArray(p)) as string[] | undefined
    expect(arrParam).toBeTruthy()
    expect(arrParam).toContain("%sofa%")
    expect(arrParam).toContain("%couch%")
  })

  it("search ID → EN: 'pagar' memperluas ke '%fence%'", async () => {
    await listUserAssets("user-1", { search: "pagar" })
    const arrParam = lastParams().find((p) => Array.isArray(p)) as string[] | undefined
    expect(arrParam).toContain("%pagar%")
    expect(arrParam).toContain("%fence%")
  })

  it("limit di-clamp ke maksimum (>100 -> 100)", async () => {
    await listUserAssets("user-1", { limit: 9999 })
    const params = lastParams()
    // salah satu param numeric harus <= 100 (limit ter-clamp)
    expect(params.some((p) => p === 100)).toBe(true)
  })

  it("mengembalikan {rows, total} dari count(*) over()", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: "a1", total_count: "42" },
        { id: "a2", total_count: "42" },
      ],
    })
    const res = await listUserAssets("user-1", {})
    expect(res.total).toBe(42)
    expect(res.rows).toHaveLength(2)
    // total_count TIDAK bocor ke tiap row
    expect("total_count" in res.rows[0]).toBe(false)
  })

  it("total 0 saat tidak ada baris", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await listUserAssets("user-1", {})
    expect(res.total).toBe(0)
    expect(res.rows).toEqual([])
  })
})
