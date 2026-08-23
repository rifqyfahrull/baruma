// @vitest-environment node
import { describe, expect, it } from "vitest"
import { backupKeyFor, dateStamp, keysToDelete } from "../../../scripts/backup-db-lib.mjs"

describe("dateStamp", () => {
  it("formats a Date as YYYY-MM-DD (UTC)", () => {
    expect(dateStamp(new Date("2026-08-23T15:04:05Z"))).toBe("2026-08-23")
  })
})

describe("backupKeyFor", () => {
  it("builds the backups/db/<date>.dump.gz key", () => {
    expect(backupKeyFor(new Date("2026-08-23T00:00:00Z"))).toBe(
      "backups/db/2026-08-23.dump.gz"
    )
  })
})

describe("keysToDelete", () => {
  const now = new Date("2026-08-23T00:00:00Z")

  it("returns keys older than the retention window", () => {
    const objects = [
      { key: "backups/db/2026-08-01.dump.gz", lastModified: new Date("2026-08-01T00:00:00Z") }, // 22 hari lalu
      { key: "backups/db/2026-08-20.dump.gz", lastModified: new Date("2026-08-20T00:00:00Z") }, // 3 hari lalu
    ]
    expect(keysToDelete(objects, now, 14)).toEqual(["backups/db/2026-08-01.dump.gz"])
  })

  it("keeps a backup exactly at the retention boundary (not yet older)", () => {
    const boundary = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const objects = [{ key: "backups/db/boundary.dump.gz", lastModified: boundary }]
    expect(keysToDelete(objects, now, 14)).toEqual([])
  })

  it("deletes a backup one millisecond past the retention boundary", () => {
    const justPast = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000 - 1)
    const objects = [{ key: "backups/db/just-past.dump.gz", lastModified: justPast }]
    expect(keysToDelete(objects, now, 14)).toEqual(["backups/db/just-past.dump.gz"])
  })

  it("ignores objects outside the backups/db/ prefix", () => {
    const objects = [
      { key: "uploads/some-user/file.glb", lastModified: new Date("2020-01-01T00:00:00Z") },
    ]
    expect(keysToDelete(objects, now, 14)).toEqual([])
  })

  it("ignores non-.dump.gz objects even inside the prefix (defensive)", () => {
    const objects = [
      { key: "backups/db/README.txt", lastModified: new Date("2020-01-01T00:00:00Z") },
    ]
    expect(keysToDelete(objects, now, 14)).toEqual([])
  })

  it("returns an empty array when nothing is old enough", () => {
    const objects = [
      { key: "backups/db/2026-08-22.dump.gz", lastModified: new Date("2026-08-22T00:00:00Z") },
    ]
    expect(keysToDelete(objects, now, 14)).toEqual([])
  })
})
