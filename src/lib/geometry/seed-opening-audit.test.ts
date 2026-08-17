import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

import { parseOpeningWall, type Side } from "@/lib/geometry"
import {
  OPENING_EDGE_MARGIN_M,
  findOpeningConflicts,
  openingWorldSegment,
  wallJunctions,
  type RectRoom,
} from "./opening-plan"

/**
 * Audit SELURUH denah yang di-seed lewat migration SQL terhadap aturan
 * domain-knowledge-pintu.md §1 (clearance >= 15 cm dari dinding tegak lurus).
 *
 * Fixture test bukan satu-satunya sumber denah: rumah referensi & scene demo
 * masuk ke DB lewat migration, dan denah cacat di sana ikut tampil di
 * produksi. Test ini membaca file migration apa adanya, jadi denah baru yang
 * ditambahkan nanti otomatis ikut terjaga tanpa perlu mendaftarkannya.
 */

interface SeedRoom extends RectRoom {
  name?: string
}
interface SeedOpening {
  id: string
  wallId: string
  type: string
  positionM: number
  widthM?: number
}
interface SeedLayout {
  id?: string
  projectId?: string
  rooms: SeedRoom[]
  openings: SeedOpening[]
}

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations")

/** Objek JSON ber-`rooms`+`openings` yang tertanam di dalam teks SQL. */
function extractLayouts(sql: string): SeedLayout[] {
  const out: SeedLayout[] = []
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== "{") continue
    let depth = 0
    for (let j = i; j < sql.length; j++) {
      if (sql[j] === "{") depth++
      else if (sql[j] === "}") {
        depth--
        if (depth === 0) {
          const slice = sql.slice(i, j + 1)
          if (slice.includes('"rooms"') && slice.includes('"openings"')) {
            try {
              const parsed = JSON.parse(slice) as SeedLayout
              if (Array.isArray(parsed.rooms) && Array.isArray(parsed.openings) && parsed.openings.length) {
                out.push(parsed)
              }
            } catch {
              // Bukan JSON utuh (mis. mengandung placeholder SQL) — lewati.
            }
          }
          i = j
          break
        }
      }
    }
  }
  return out
}

const layouts: Array<{ file: string; layout: SeedLayout }> = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .flatMap((file) =>
    extractLayouts(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")).map((layout) => ({ file, layout }))
  )

const edgeLen = (r: RectRoom, s: Side) => (s === "n" || s === "s" ? r.width : r.depth)

/**
 * UTANG DATA — menunggu keputusan setelah pemeriksaan DB produksi.
 *
 * Denah di bawah lahir dari generator SEBELUM margin ditegakkan di batas
 * bentang bersama & titik pertemuan tembok. Migration-nya SUDAH teraplikasi di
 * DB, jadi memperbaiki file .sql saja tidak mengubah data yang hidup —
 * perlu migration koreksi terpisah (butuh otorisasi owner).
 *
 * Kenapa dikunci, bukan diperbaiki sekarang: menggeser bukaan yang "menumpang
 * pertemuan tembok" akan MEMINDAHKAN bukaan itu ke ruang lain — artinya
 * mengubah ruang mana yang mendapat cahaya. Itu keputusan desain untuk rumah
 * referensi, bukan koreksi mekanis seperti margin sudut.
 *
 * Daftar ini dikunci PERSIS: berkurang (data diperbaiki) atau bertambah
 * (regresi generator) → test gagal dan memaksa peninjauan.
 */
const KNOWN_LEGACY_STRADDLE = [
  "0013_seed_villa_modern.sql Kamar Utama:s (op-7gqgtW) menumpang 6.1, 6.16",
  "0015_seed_k3_houses.sql Ruang tamu:s (op-IKHUDL) menumpang 1.21, 1.27",
  "0015_seed_k3_houses.sql Ruang tamu:s (op-UmPLMe) menumpang 0.81, 0.87",
  "0015_seed_k3_houses.sql Kamar tidur 1:s (op-dOMLEZ) menumpang 2, 2.06",
  "0015_seed_k3_houses.sql Ruang keluarga:s (op-6zByA1) menumpang 2.23, 2.29",
  "0021_seed_two_reference_houses.sql Kamar tidur 3:s (op-mEGFdw) menumpang 2.94, 2.99",
]

/** Bukaan yang saling bertabrakan di dinding yang sama — cacat murni (tidak
 *  mengubah ruang mana yang dapat cahaya bila digeser), tapi tetap menunggu
 *  migration koreksi karena datanya sudah hidup di DB. */
const KNOWN_LEGACY_CONFLICT = [
  "0020_rumah_qyfa_scene_a.sql a-d-living <-> a-w-living",
  "0022_fix_two_reference_houses.sql a-door-entry <-> op-LTxsTr",
]

describe("denah seed migration — clearance bukaan", () => {
  it("menemukan denah untuk diaudit (test tidak boleh lolos karena kosong)", () => {
    expect(layouts.length).toBeGreaterThan(0)
  })

  it("tidak ada bukaan yang kusennya menempel di ujung dinding", () => {
    const offenders: string[] = []
    for (const { file, layout } of layouts) {
      const byId = new Map(layout.rooms.map((r) => [r.id, r]))
      for (const o of layout.openings) {
        const parsed = parseOpeningWall(o.wallId)
        if (!parsed) continue
        const host = byId.get(parsed.roomId)
        if (!host) continue
        const widthM = o.widthM ?? 0.9
        const len = edgeLen(host, parsed.side)
        const start = o.positionM - widthM / 2
        const end = len - (o.positionM + widthM / 2)
        if (start < OPENING_EDGE_MARGIN_M - 1e-6 || end < OPENING_EDGE_MARGIN_M - 1e-6) {
          offenders.push(
            `${file} ${host.name ?? host.id}:${parsed.side} (${o.id}) sisa ${start.toFixed(2)}m / ${end.toFixed(2)}m`
          )
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("tidak ada bukaan yang MENUMPANG titik pertemuan tembok", () => {
    const offenders: string[] = []
    for (const { file, layout } of layouts) {
      const byId = new Map(layout.rooms.map((r) => [r.id, r]))
      for (const o of layout.openings) {
        const parsed = parseOpeningWall(o.wallId)
        if (!parsed) continue
        const host = byId.get(parsed.roomId)
        if (!host) continue
        const widthM = o.widthM ?? 0.9
        const peers = layout.rooms.filter((r) => r.floorId === host.floorId)
        const seg = openingWorldSegment(host, parsed.side, o.positionM, widthM)
        const origin = parsed.side === "n" || parsed.side === "s" ? host.x : host.y
        const a = seg.a - origin
        const b = seg.b - origin
        const straddled = wallJunctions(host, parsed.side, peers).filter((j) => j > a + 1e-6 && j < b - 1e-6)
        if (straddled.length) {
          offenders.push(`${file} ${host.name ?? host.id}:${parsed.side} (${o.id}) menumpang ${straddled.join(", ")}`)
        }
      }
    }
    expect(offenders.sort()).toEqual([...KNOWN_LEGACY_STRADDLE].sort())
  })

  it("tidak ada dua bukaan yang saling bertabrakan di dinding yang sama", () => {
    const offenders: string[] = []
    for (const { file, layout } of layouts) {
      const byId = new Map(layout.rooms.map((r) => [r.id, r]))
      const refs = layout.openings.flatMap((o) => {
        const parsed = parseOpeningWall(o.wallId)
        return parsed
          ? [
              {
                id: o.id,
                roomId: parsed.roomId,
                side: parsed.side,
                positionM: o.positionM,
                widthM: o.widthM ?? 0.9,
                type: o.type,
              },
            ]
          : []
      })
      const seen = new Set<string>()
      for (const ref of refs) {
        const host = byId.get(ref.roomId)
        if (!host) continue
        const peers = layout.rooms.filter((r) => r.floorId === host.floorId)
        const hits = findOpeningConflicts(
          host,
          ref.side,
          ref.positionM,
          ref.widthM,
          refs.filter((x) => x.id !== ref.id),
          peers
        )
        for (const h of hits) {
          const key = [ref.id, h.id].sort().join(" <-> ")
          if (seen.has(key)) continue
          seen.add(key)
          offenders.push(`${file} ${key}`)
        }
      }
    }
    expect(offenders.sort()).toEqual([...KNOWN_LEGACY_CONFLICT].sort())
  })
})
