import { describe, it, expect } from "vitest"

import {
  findOpeningConflicts,
  freeDoorPosition,
  neighborServedByOpening,
  openingWorldSegment,
  sharedWallSpan,
  type RectRoom,
} from "./opening-plan"

/**
 * GEOMETRI PRODUKSI ASLI (proyek "Rumah Tropis Modern - Carport Batu Alam"):
 * dinding utara Ruang Tamu berbatasan dengan DUA ruang — Dapur (x 6.97–8.44)
 * dan Ruang Makan (x 8.49–11.72). Agent memilih Dapur tapi menaruh pintu di
 * titik tengah dinding penuh (x 8.90–9.80) → jatuh di depan Ruang Makan,
 * menabrak pintu yang sudah ada (terdaftar atas wallId Ruang Makan), dan
 * koneksi ke Dapur tidak pernah terjadi. Fixture ini menyalin angka aslinya.
 */
const tamu: RectRoom = { id: "tamu", floorId: "f1", x: 6.97, y: 13.15, width: 4.75, depth: 4.57 }
const dapur: RectRoom = { id: "dapur", floorId: "f1", x: 5.48, y: 8.24, width: 2.96, depth: 4.85 }
const makan: RectRoom = { id: "makan", floorId: "f1", x: 8.49, y: 8.24, width: 3.23, depth: 4.85 }
const ROOMS = [tamu, dapur, makan]
// Pintu sedia milik Ruang Makan di dinding selatannya (dunia x 9.66–10.56).
const makanDoor = { id: "d-makan", roomId: "makan", side: "s" as const, positionM: 1.62, widthM: 0.9, type: "door" }

describe("openingWorldSegment", () => {
  it("menghitung segmen dunia dari positionM (titik tengah)", () => {
    const seg = openingWorldSegment(makan, "s", 1.62, 0.9)
    expect(seg.axis).toBe("x")
    expect(seg.line).toBeCloseTo(13.09, 2)
    expect(seg.a).toBeCloseTo(9.66, 2)
    expect(seg.b).toBeCloseTo(10.56, 2)
  })
})

describe("neighborServedByOpening — resolusi per-segmen", () => {
  it("pintu di tengah dinding penuh Tamu (kasus produksi) melayani MAKAN, bukan Dapur", () => {
    // positionM 2.375 = titik tengah dinding utara tamu → dunia x 8.90–9.80
    const nb = neighborServedByOpening(tamu, "n", 2.375, 0.9, ROOMS)
    expect(nb?.id).toBe("makan")
  })

  it("pintu di bentang Dapur benar-benar melayani Dapur", () => {
    // dunia x ~7.2–8.1 → positionM = 7.65 - 6.97 = 0.68
    const nb = neighborServedByOpening(tamu, "n", 0.68, 0.9, ROOMS)
    expect(nb?.id).toBe("dapur")
  })

  it("pintu di dinding tanpa tetangga → null (dinding luar)", () => {
    const nb = neighborServedByOpening(tamu, "s", 2.0, 0.9, ROOMS)
    expect(nb).toBeNull()
  })
})

describe("findOpeningConflicts — tabrakan lintas-sisi", () => {
  it("mendeteksi tabrakan dgn pintu yang terdaftar atas wallId ruang SEBERANG (kasus produksi)", () => {
    // Usulan agent yang asli: tamu:n positionM 2.375 (dunia 8.90–9.80) vs
    // pintu makan:s (dunia 9.66–10.56) — beririsan/berdempetan.
    const conflicts = findOpeningConflicts(tamu, "n", 2.375, 0.9, [makanDoor], ROOMS)
    expect(conflicts.map((c) => c.id)).toContain("d-makan")
  })

  it("tidak menandai bukaan di dinding lain sbg konflik", () => {
    const conflicts = findOpeningConflicts(tamu, "e", 2.0, 0.9, [makanDoor], ROOMS)
    expect(conflicts).toHaveLength(0)
  })
})

describe("sharedWallSpan", () => {
  it("bentang bersama tamu–dapur di sisi utara = irisan x kedua ruang", () => {
    const span = sharedWallSpan(tamu, "n", dapur)
    expect(span).not.toBeNull()
    expect(span!.lo).toBeCloseTo(6.97, 2)
    expect(span!.hi).toBeCloseTo(8.44, 2)
  })

  it("null utk ruang yang tak berimpit dinding", () => {
    const jauh: RectRoom = { id: "x", floorId: "f1", x: 0, y: 0, width: 2, depth: 2 }
    expect(sharedWallSpan(tamu, "n", jauh)).toBeNull()
  })
})

describe("freeDoorPosition — inti perbaikan kasus produksi", () => {
  it("pintu tamu→Dapur ditaruh DI DALAM bentang Dapur & bebas tabrakan", () => {
    const p = freeDoorPosition(tamu, "n", dapur, 0.9, [makanDoor], ROOMS)
    expect(p).not.toBeNull()
    // dunia: harus di dalam 6.97–8.44 (bentang dapur)
    const seg = openingWorldSegment(tamu, "n", p!, 0.9)
    expect(seg.a).toBeGreaterThanOrEqual(6.97 - 0.01)
    expect(seg.b).toBeLessThanOrEqual(8.44 + 0.01)
    // dan benar-benar melayani dapur
    expect(neighborServedByOpening(tamu, "n", p!, 0.9, ROOMS)?.id).toBe("dapur")
    // dan tidak menabrak pintu makan
    expect(findOpeningConflicts(tamu, "n", p!, 0.9, [makanDoor], ROOMS)).toHaveLength(0)
  })

  it("null bila bentang bersama sudah penuh bukaan", () => {
    // Penuhi seluruh bentang dapur (lebar 1.47m) dgn satu bukaan besar.
    const blocker = { id: "b", roomId: "tamu", side: "n" as const, positionM: 0.74, widthM: 1.6, type: "window" }
    const p = freeDoorPosition(tamu, "n", dapur, 0.9, [blocker], ROOMS)
    expect(p).toBeNull()
  })

  it("null bila diminta tetangga yang tak berbagi dinding di sisi itu", () => {
    const p = freeDoorPosition(tamu, "s", dapur, 0.9, [], ROOMS)
    expect(p).toBeNull()
  })
})

/**
 * TITIK PERTEMUAN DINDING (junction) — keluhan produksi: "posisi bukaan
 * pintunya persis pas di titik pertemuan/sudut tembok, bukan di tengah bidang
 * dinding yang solid".
 *
 * Aturan yang ditegakkan di sini berasal dari domain-knowledge-pintu.md:
 *   §1 "Sisakan clearance minimal 10–15 cm dari engsel pintu ke dinding/sudut
 *       terdekat agar daun pintu bisa membuka penuh 90°."
 *   §1 "Kusen pintu idealnya tidak diletakkan persis di sudut ruangan
 *       (< 15 cm dari dinding tegak lurus) — daun pintu akan mentok."
 *
 * `marginM` selama ini hanya dijaga di UJUNG dinding host, tidak di batas
 * bentang bersama — padahal batas bentang bersama ITULAH titik pertemuan
 * tembok, tempat dinding sekat tetangga menempel tegak lurus.
 *
 * Dinding utara `aula` (x 0–8) dibagi TIGA tetangga co-planar:
 *   kiri 0–3 | sempit 3–4 | kanan 4–8
 * sehingga ada junction di x=3 dan x=4.
 */
const aula: RectRoom = { id: "aula", floorId: "f1", x: 0, y: 5, width: 8, depth: 4 }
const kiri: RectRoom = { id: "kiri", floorId: "f1", x: 0, y: 1, width: 3, depth: 4 }
const sempit: RectRoom = { id: "sempit", floorId: "f1", x: 3, y: 1, width: 1, depth: 4 }
const kanan: RectRoom = { id: "kanan", floorId: "f1", x: 4, y: 1, width: 4, depth: 4 }

describe("freeDoorPosition — clearance dari titik pertemuan tembok", () => {
  it("menolak bentang bersama yang terlalu sempit utk pintu + clearance 15 cm dua sisi", () => {
    // Bentang aula–sempit hanya 1,0 m. Pintu 0,9 m butuh 0,9 + 2×0,15 = 1,2 m
    // agar daun bisa membuka penuh tanpa mentok dinding tegak lurus di x=3
    // dan x=4. Jadi dinding ini MEMANG tak layak — jujur lebih baik daripada
    // pintu yang kusennya menempel di pertemuan tembok.
    const p = freeDoorPosition(aula, "n", sempit, 0.9, [], [aula, kiri, sempit, kanan])
    expect(p).toBeNull()
  })

  it("pintu menjaga >= 15 cm dari KEDUA titik pertemuan saat bentang cukup", () => {
    // Bentang 1,5 m (x 3–4,5) — cukup untuk 0,9 + 2×0,15 = 1,2 m.
    const sedang: RectRoom = { id: "sedang", floorId: "f1", x: 3, y: 1, width: 1.5, depth: 4 }
    const kananGeser: RectRoom = { id: "kanan", floorId: "f1", x: 4.5, y: 1, width: 3.5, depth: 4 }
    const rooms = [aula, kiri, sedang, kananGeser]

    const p = freeDoorPosition(aula, "n", sedang, 0.9, [], rooms)
    expect(p).not.toBeNull()

    const seg = openingWorldSegment(aula, "n", p!, 0.9)
    // junction di x=3 dan x=4,5 — kusen harus mundur >= 0,15 m dari keduanya.
    expect(seg.a - 3).toBeGreaterThanOrEqual(0.15 - 0.001)
    expect(4.5 - seg.b).toBeGreaterThanOrEqual(0.15 - 0.001)
    // dan tetap benar-benar melayani ruang yang dimaksud
    expect(neighborServedByOpening(aula, "n", p!, 0.9, rooms)?.id).toBe("sedang")
  })

  it("pintu luar (tanpa tetangga dituju) tidak menumpang titik pertemuan tembok", () => {
    // Dinding utara aula: separuh (x 0–4,2) bertetangga, sisanya dinding luar.
    // Titik tengah dinding penuh = 4,0 → segmen 3,55–4,45 MENUMPANG junction
    // x=4,2: setengah daun pintu di dalam ruang tetangga, setengah di luar.
    const separuh: RectRoom = { id: "separuh", floorId: "f1", x: 0, y: 1, width: 4.2, depth: 4 }
    const rooms = [aula, separuh]

    const p = freeDoorPosition(aula, "n", null, 0.9, [], rooms)
    if (p != null) {
      const seg = openingWorldSegment(aula, "n", p, 0.9)
      const straddles = seg.a < 4.2 - 0.001 && seg.b > 4.2 + 0.001
      expect(straddles).toBe(false)
    }
  })
})
