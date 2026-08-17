import { describe, expect, it } from "vitest"

import { planCorridorFor } from "./corridor-plan"
import type { RectRoom } from "./opening-plan"

/**
 * KEMAMPUAN YANG HILANG: merancang KORIDOR.
 *
 * Pratinjau perbaikan pada 16 denah produksi: 15 pintu bisa ditambah otomatis,
 * tapi **30 ruang butuh koridor** — dua kali lebih banyak. Solver penyambung
 * pintu sengaja menolak menembus kamar orang untuk mencapai kamar lain (aturan
 * kepantasan yang benar), jadi diagnosisnya tepat: denahnya yang salah, bukan
 * pintunya yang kurang.
 *
 * Masalahnya, "buat koridor" selama ini SOLUSI YANG MUSTAHIL DIEKSEKUSI:
 * `koridor` dirujuk sebagai ruang sirkulasi di connect-rooms.ts, deterministic.ts,
 * dan door-spec.ts — tapi TIDAK ADA di `RoomType`, sehingga `roomTypeSchema`
 * (zod) menolak addRoom bertipe koridor. Agent disuruh melakukan hal yang
 * secara teknis tidak mungkin.
 *
 * Modul ini menghitung PETAK koridor: di mana, seukuran apa, agar ruang-ruang
 * terkurung punya jalur kaki dari area sirkulasi — tanpa menembus kamar orang.
 *
 * Lebar 0,9–1,2 m mengikuti aturan sirkulasi di prompt & praktik lapangan.
 */

const CORRIDOR_MIN_W = 0.9

/**
 * KASUS NYATA proj-asset-rumah-2-lantai lantai 2: lima ruang berjejer di sisi
 * timur tanpa jalur, hanya bertetangga satu sama lain (semua privat).
 * Ruang keluarga di barat adalah satu-satunya area sirkulasi.
 */
const keluarga: RectRoom = { id: "keluarga", floorId: "f2", x: 0, y: 0, width: 4, depth: 9 }
const kamar2: RectRoom = { id: "kamar2", floorId: "f2", x: 5.5, y: 0, width: 3, depth: 3 }
const kamar3: RectRoom = { id: "kamar3", floorId: "f2", x: 5.5, y: 3, width: 3, depth: 3 }
const kamar4: RectRoom = { id: "kamar4", floorId: "f2", x: 5.5, y: 6, width: 3, depth: 3 }

describe("planCorridorFor — merancang jalur kaki, bukan menambal pintu", () => {
  it("mengusulkan koridor di celah antara area sirkulasi dan ruang terkurung", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
      site: { widthM: 10, depthM: 12 },
    })
    expect(plan).not.toBeNull()
    // Koridor menempati celah x 4–5,5 (lebar 1,5 m tersedia).
    expect(plan!.room.width).toBeGreaterThanOrEqual(CORRIDOR_MIN_W)
    expect(plan!.room.floorId).toBe("f2")
    // Harus membentang cukup untuk menyentuh ketiga kamar (y 0–9).
    expect(plan!.room.depth).toBeGreaterThanOrEqual(6)
  })

  it("koridor yang diusulkan BERSINGGUNGAN dinding dengan tiap ruang terkurung", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
      site: { widthM: 10, depthM: 12 },
    })
    expect(plan).not.toBeNull()
    const c = plan!.room
    const touches = (r: RectRoom) => {
      const xOverlap = Math.min(c.x + c.width, r.x + r.width) - Math.max(c.x, r.x)
      const yOverlap = Math.min(c.y + c.depth, r.y + r.depth) - Math.max(c.y, r.y)
      const vAdj = Math.abs(c.x + c.width - r.x) <= 0.15 || Math.abs(r.x + r.width - c.x) <= 0.15
      const hAdj = Math.abs(c.y + c.depth - r.y) <= 0.15 || Math.abs(r.y + r.depth - c.y) <= 0.15
      return (vAdj && yOverlap > 0.6) || (hAdj && xOverlap > 0.6)
    }
    for (const r of [kamar2, kamar3, kamar4]) {
      expect(touches(r), `koridor harus menyentuh ${r.id}`).toBe(true)
    }
    // dan menyentuh area sirkulasi juga
    expect(touches(keluarga)).toBe(true)
  })

  it("tidak menabrak ruang mana pun", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
      site: { widthM: 10, depthM: 12 },
    })
    const c = plan!.room
    for (const r of [keluarga, kamar2, kamar3, kamar4]) {
      const xo = Math.min(c.x + c.width, r.x + r.width) - Math.max(c.x, r.x)
      const yo = Math.min(c.y + c.depth, r.y + r.depth) - Math.max(c.y, r.y)
      expect(xo > 0.01 && yo > 0.01, `koridor menabrak ${r.id}`).toBe(false)
    }
  })

  it("tetap di dalam batas lahan", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
      site: { widthM: 10, depthM: 12 },
    })
    const c = plan!.room
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.y).toBeGreaterThanOrEqual(0)
    expect(c.x + c.width).toBeLessThanOrEqual(10 + 1e-6)
    expect(c.y + c.depth).toBeLessThanOrEqual(12 + 1e-6)
  })

  it("null bila tidak ada celah selebar koridor minimum", () => {
    // Kamar menempel langsung ke ruang keluarga — tak ada celah 0,9 m.
    const rapat: RectRoom = { id: "rapat", floorId: "f2", x: 4, y: 0, width: 3, depth: 3 }
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, rapat],
      isolatedIds: ["rapat"],
      circulationIds: ["keluarga"],
      site: { widthM: 7, depthM: 9 },
    })
    expect(plan).toBeNull()
  })

  it("null bila tidak ada ruang terkurung (jangan mengarang koridor)", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2],
      isolatedIds: [],
      circulationIds: ["keluarga"],
      site: { widthM: 10, depthM: 12 },
    })
    expect(plan).toBeNull()
  })

  it("menyertakan alasan yang bisa dibaca user", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
      site: { widthM: 10, depthM: 12 },
    })
    expect(plan!.reason).toMatch(/koridor|akses|sirkulasi/i)
  })
})

/**
 * REGRESI NYATA: perancang ini lolos 7 test tapi menghasilkan NOL koridor pada
 * 16 denah produksi. Sebabnya `site` ternyata `undefined` di SEMUA payload
 * (0/16 punya field itu) — kandidat koridor dibangun dari `site.widthM`, jadi
 * semuanya gugur oleh cek batas lahan yang membandingkan dengan NaN.
 *
 * Test-test di atas lolos karena fixture-nya MENYEDIAKAN site. Pelajaran:
 * uji terhadap bentuk data nyata, bukan terhadap asumsi.
 */
describe("planCorridorFor — bekerja tanpa `site` (bentuk data produksi)", () => {
  it("tetap mengusulkan koridor ketika site tidak ada", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
    })
    expect(plan).not.toBeNull()
    expect(plan!.room.width).toBeGreaterThanOrEqual(CORRIDOR_MIN_W)
  })

  it("KASUS proj-asset-rumah-3-kamar: Kamar 2 terkurung, koridor menyambungkannya", () => {
    // Geometri asli dari DB (site memang tidak ada di payload).
    const rooms: RectRoom[] = [
      { id: "tamu", floorId: "f1", x: 3.2, y: 0, width: 5.8, depth: 3.4 },
      { id: "keluarga", floorId: "f1", x: 3.2, y: 3.4, width: 5.8, depth: 4 },
      { id: "utama", floorId: "f1", x: 0, y: 5, width: 3.2, depth: 3.5 },
      { id: "kamar2", floorId: "f1", x: 0, y: 8.5, width: 3.2, depth: 3.2 },
      { id: "kamar3", floorId: "f1", x: 3.2, y: 7.4, width: 3, depth: 3.2 },
    ]
    const plan = planCorridorFor({
      floorId: "f1",
      rooms,
      isolatedIds: ["kamar2"],
      circulationIds: ["tamu", "keluarga"],
    })
    // Boleh null bila memang tak ada celah — tapi bila ada, harus sah.
    if (plan) {
      expect(plan.room.width).toBeGreaterThanOrEqual(CORRIDOR_MIN_W)
      for (const r of rooms) {
        const xo = Math.min(plan.room.x + plan.room.width, r.x + r.width) - Math.max(plan.room.x, r.x)
        const yo = Math.min(plan.room.y + plan.room.depth, r.y + r.depth) - Math.max(plan.room.y, r.y)
        expect(xo > 0.01 && yo > 0.01, `koridor menabrak ${r.id}`).toBe(false)
      }
    }
  })

  it("tanpa site, koridor tidak keluar dari bounding box ruang yang ada", () => {
    const plan = planCorridorFor({
      floorId: "f2",
      rooms: [keluarga, kamar2, kamar3, kamar4],
      isolatedIds: ["kamar2", "kamar3", "kamar4"],
      circulationIds: ["keluarga"],
    })
    expect(plan).not.toBeNull()
    const maxX = Math.max(...[keluarga, kamar2, kamar3, kamar4].map((r) => r.x + r.width))
    const maxY = Math.max(...[keluarga, kamar2, kamar3, kamar4].map((r) => r.y + r.depth))
    expect(plan!.room.x).toBeGreaterThanOrEqual(0)
    expect(plan!.room.y).toBeGreaterThanOrEqual(0)
    expect(plan!.room.x + plan!.room.width).toBeLessThanOrEqual(maxX + 1e-6)
    expect(plan!.room.y + plan!.room.depth).toBeLessThanOrEqual(maxY + 1e-6)
  })
})
