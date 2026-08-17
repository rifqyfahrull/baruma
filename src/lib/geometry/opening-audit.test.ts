import { describe, it, expect } from "vitest"

import layout from "@/lib/three/__fixtures__/rumah-qyfa-layout.json"
import { OPENING_EDGE_MARGIN_M, findOpeningConflicts, openingWorldSegment, wallJunctions, type RectRoom } from "./opening-plan"
import { parseOpeningWall } from "@/lib/geometry"

/**
 * Audit denah PRODUKSI NYATA (fixture "Rumah Qyfa") terhadap aturan
 * domain-knowledge-pintu.md §1:
 *   "Sisakan clearance minimal 10–15 cm dari engsel pintu ke dinding/sudut
 *    terdekat agar daun pintu bisa membuka penuh 90°."
 *   "Kusen pintu idealnya tidak diletakkan persis di sudut ruangan."
 *
 * Ini test DATA, bukan test fungsi: menjaga agar denah yang di-commit tidak
 * pernah lagi berisi bukaan yang kusennya menempel di ujung dinding atau
 * MENUMPANG titik pertemuan tembok (separuh daun di ruang tetangga).
 */

interface FixtureRoom extends RectRoom {
  name?: string
}
interface FixtureOpening {
  id: string
  wallId: string
  type: string
  positionM: number
  widthM?: number
}

const rooms = (layout.rooms ?? []) as FixtureRoom[]
const openings = (layout.openings ?? []) as FixtureOpening[]
const byId = new Map(rooms.map((r) => [r.id, r]))
const edgeLen = (r: RectRoom, s: string) => (s === "n" || s === "s" ? r.width : r.depth)

/** Bukaan fixture → geometri terpakai, atau null bila wallId tak terpetakan. */
function resolve(o: FixtureOpening) {
  const parsed = parseOpeningWall(o.wallId)
  if (!parsed) return null
  const host = byId.get(parsed.roomId)
  if (!host) return null
  const widthM = o.widthM ?? 0.9
  const peers = rooms.filter((r) => r.floorId === host.floorId)
  return {
    host,
    side: parsed.side,
    widthM,
    len: edgeLen(host, parsed.side),
    seg: openingWorldSegment(host, parsed.side, o.positionM, widthM),
    junctions: wallJunctions(host, parsed.side, peers),
    label: `${host.name ?? host.id}:${parsed.side} (${o.type} pos=${o.positionM} w=${widthM})`,
  }
}

describe("denah produksi Rumah Qyfa — clearance bukaan", () => {
  it("fixture memang berisi ruang & bukaan (test ini tidak boleh lolos karena kosong)", () => {
    expect(rooms.length).toBeGreaterThan(0)
    expect(openings.length).toBeGreaterThan(0)
    expect(openings.filter((o) => resolve(o) !== null).length).toBeGreaterThan(0)
  })

  it("tidak ada bukaan yang kusennya menempel di ujung dinding", () => {
    // Fixture ini sempat menyimpan 4 bukaan warisan generator lama yang
    // melanggar ambang 15 cm (Void:s hanya 3 cm — kusen praktis menempel di
    // sudut). Posisinya sudah dikoreksi ke titik sah TERDEKAT, memakai
    // geometri ruang yang sama, tanpa mengubah ukuran/jenis bukaan:
    //
    //   Void:s           pintu 0,5 m   0,60 → 0,44  (dinding cuma 0,88 m)
    //   Dapur:n          jendela 1,2 m 0,69 → 0,75
    //   Ruang Keluarga:s pintu 1,0 m   0,60 → 0,65
    //   Kamar 2:w        jendela 0,6 m 2,50 → 2,45
    const offenders: string[] = []
    for (const o of openings) {
      const r = resolve(o)
      if (!r) continue
      const origin = r.side === "n" || r.side === "s" ? r.host.x : r.host.y
      const start = r.seg.a - origin
      const end = r.len - (r.seg.b - origin)
      if (start < OPENING_EDGE_MARGIN_M - 1e-6 || end < OPENING_EDGE_MARGIN_M - 1e-6) {
        offenders.push(`${r.label} sisa ujung ${start.toFixed(2)}m / ${end.toFixed(2)}m`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("tidak ada bukaan yang MENUMPANG titik pertemuan tembok", () => {
    // Separuh daun di ruang tetangga, separuh di dinding lain — mustahil
    // dibangun. Ini kelas cacat yang paling kasat mata di denah.
    const offenders: string[] = []
    for (const o of openings) {
      const r = resolve(o)
      if (!r) continue
      const origin = r.side === "n" || r.side === "s" ? r.host.x : r.host.y
      const a = r.seg.a - origin
      const b = r.seg.b - origin
      const straddled = r.junctions.filter((j) => j > a + 1e-6 && j < b - 1e-6)
      if (straddled.length) offenders.push(`${r.label} menumpang junction ${straddled.join(", ")}`)
    }
    expect(offenders).toEqual([])
  })

  it("tidak ada dua bukaan yang saling bertabrakan di dinding yang sama", () => {
    // findOpeningConflicts memeriksa dalam KOORDINAT DUNIA, sehingga bukaan
    // yang terdaftar atas wallId ruang seberang pun ikut terlihat.
    const refs = openings.flatMap((o) => {
      const parsed = parseOpeningWall(o.wallId)
      return parsed
        ? [{ id: o.id, roomId: parsed.roomId, side: parsed.side, positionM: o.positionM, widthM: o.widthM ?? 0.9, type: o.type }]
        : []
    })
    const offenders: string[] = []
    for (const ref of refs) {
      const host = byId.get(ref.roomId)
      if (!host) continue
      const peers = rooms.filter((r) => r.floorId === host.floorId)
      const others = refs.filter((x) => x.id !== ref.id)
      const hits = findOpeningConflicts(host, ref.side, ref.positionM, ref.widthM, others, peers)
      for (const h of hits) offenders.push(`${ref.id} <-> ${h.id}`)
    }
    expect(offenders).toEqual([])
  })
})
