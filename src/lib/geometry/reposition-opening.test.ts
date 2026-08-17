import { describe, expect, it } from "vitest"

import { repositionOpeningToNeighbor } from "./reposition-opening"
import { neighborServedByOpening, openingWorldSegment, type RectRoom } from "./opening-plan"

/**
 * Memperbaiki bukaan warisan yang MENUMPANG titik pertemuan tembok, dengan
 * mempertahankan lebar aslinya.
 *
 * Pelajaran dari migration 0025 yang salah arah: `fitOpeningToWall` mencari
 * bidang solid TERDEKAT, tapi tidak memeriksa apakah bidang itu menghadap
 * ruang yang bisa dimasuki. Akibatnya pintu Taman belakang digeser ke bidang
 * yang di seberangnya TIDAK ADA RUANG APA PUN, dan pintu Balkon dipaksa masuk
 * bidang yang menghadap Void (bukan lantai pijak) sambil menyempit 30%.
 *
 * Yang benar: taruh bukaan DI DALAM bentang ruang tetangga yang dilayaninya,
 * lebar utuh — persis yang dilakukan `freeDoorPosition` untuk bukaan baru.
 */

// KASUS NYATA proj-asset-rumah-tipe-60: dinding utara Taman belakang (5 m).
// Di seberangnya HANYA Dapur, mulai x=1,8 sampai ujung; x 0–1,8 bukan ruang
// apa pun. Pintu 2,4 m di pos 1,35 (segmen 0,15–2,55) cuma 0,75 m yang
// benar-benar menghadap Dapur.
const taman: RectRoom = { id: "taman", floorId: "f1", x: 3, y: 9, width: 5, depth: 3 }
const dapur: RectRoom = { id: "dapur", floorId: "f1", x: 4.8, y: 6.6, width: 3.2, depth: 2.4 }
const kmandi: RectRoom = { id: "kmandi", floorId: "f1", x: 3, y: 6.6, width: 1.8, depth: 2.2 }
const TIPE60 = [taman, dapur, kmandi]

describe("repositionOpeningToNeighbor — pertahankan lebar, pindah ke bentang tetangga", () => {
  it("KASUS tipe-60: pintu taman tetap 2,4 m dan masuk penuh ke bentang Dapur", () => {
    const out = repositionOpeningToNeighbor({
      host: taman, side: "n", positionM: 1.35, widthM: 2.4, rooms: TIPE60, openings: [],
    })
    expect(out).not.toBeNull()
    // Lebar TIDAK dikorbankan.
    expect(out!.widthM).toBeCloseTo(2.4, 3)
    // Seluruh bentang pintu berada di dalam bentang Dapur (koordinat host 1,8–5).
    const seg = openingWorldSegment(taman, "n", out!.positionM, out!.widthM)
    expect(seg.a).toBeGreaterThanOrEqual(taman.x + 1.8 - 1e-6)
    expect(seg.b).toBeLessThanOrEqual(taman.x + 5 + 1e-6)
    // Dan benar-benar melayani Dapur.
    expect(neighborServedByOpening(taman, "n", out!.positionM, out!.widthM, TIPE60)?.id).toBe("dapur")
  })

  it("memilih tetangga yang paling banyak dilayani bukaan saat ini", () => {
    // Segmen 0,15–2,55 menyentuh Dapur (1,8+) lebih dari apa pun di sisi itu.
    const out = repositionOpeningToNeighbor({
      host: taman, side: "n", positionM: 1.35, widthM: 2.4, rooms: TIPE60, openings: [],
    })
    expect(neighborServedByOpening(taman, "n", out!.positionM, out!.widthM, TIPE60)?.id).toBe("dapur")
  })

  it("tidak menggeser bukaan yang sudah sah", () => {
    // Pos 3,4 → segmen 2,2–4,6, sudah di dalam bentang Dapur.
    const out = repositionOpeningToNeighbor({
      host: taman, side: "n", positionM: 3.4, widthM: 2.4, rooms: TIPE60, openings: [],
    })
    expect(out).toBeNull()
  })

  it("null bila bentang tetangga tak cukup untuk lebar aslinya (perlu tinjauan manusia)", () => {
    // Tetangga sempit: bentang 1 m, pintu 2,4 m mustahil dipertahankan.
    const sempit: RectRoom = { id: "sempit", floorId: "f1", x: 3, y: 6.6, width: 1, depth: 2.4 }
    const out = repositionOpeningToNeighbor({
      host: taman, side: "n", positionM: 0.5, widthM: 2.4, rooms: [taman, sempit], openings: [],
    })
    expect(out).toBeNull()
  })

  it("tidak menaruh bukaan di bentang ruang yang tak bisa dipijak (void/kolam)", () => {
    // KASUS Rumah Qyfa Balkon:s — seberangnya Void 0–0,97 lalu Laundry 0,97+.
    // Bukaan harus mendarat di Laundry, bukan dipaksa masuk Void.
    const balkon: RectRoom = { id: "balkon", floorId: "f2", x: 0, y: 0, width: 4.46, depth: 2 }
    const voidRoom = { id: "void", floorId: "f2", x: 0, y: 2, width: 0.97, depth: 2, type: "void" }
    const laundry = { id: "laundry", floorId: "f2", x: 0.97, y: 2, width: 3.49, depth: 2, type: "laundry" }
    const out = repositionOpeningToNeighbor({
      host: balkon, side: "s", positionM: 0.63, widthM: 0.96,
      rooms: [balkon, voidRoom, laundry], openings: [],
    })
    expect(out).not.toBeNull()
    expect(out!.widthM).toBeCloseTo(0.96, 3)
    expect(neighborServedByOpening(balkon, "s", out!.positionM, out!.widthM, [balkon, voidRoom, laundry])?.id)
      .toBe("laundry")
  })

  it("menghindari tabrakan dengan bukaan lain di dinding yang sama", () => {
    const blocker = { id: "b", roomId: "taman", side: "n" as const, positionM: 3.4, widthM: 1.2, type: "window" }
    const out = repositionOpeningToNeighbor({
      host: taman, side: "n", positionM: 1.35, widthM: 1.2, rooms: TIPE60, openings: [blocker],
    })
    if (out) {
      const seg = openingWorldSegment(taman, "n", out.positionM, out.widthM)
      const blockerSeg = openingWorldSegment(taman, "n", 3.4, 1.2)
      const overlap = Math.min(seg.b, blockerSeg.b) - Math.max(seg.a, blockerSeg.a)
      expect(overlap).toBeLessThanOrEqual(0)
    }
  })
})
