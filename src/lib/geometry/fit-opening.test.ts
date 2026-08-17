import { describe, expect, it } from "vitest"

import { OPENING_EDGE_MARGIN_M } from "./opening-plan"
import { fitOpeningToWall } from "./fit-opening"

/**
 * Menutup akar 21 pelanggaran berulang di DB produksi (lihat
 * docs/AUDIT_BUKAAN_2026-08.md). Template aset memakai pola
 * `positionM = min(1.2, dim/2)` + `widthM = min(W, dim)`, yang saat dinding
 * lebih sempit dari W menghasilkan bukaan SELEBAR PENUH dinding dengan sisa 0
 * di kedua sisi — mis. rumah-mungil: jendela 2,4 m di dinding 2,4 m.
 *
 * Aturan: domain-knowledge-pintu.md §1 — clearance >= 15 cm dari dinding
 * tegak lurus, atau daun pintu mentok.
 */
describe("fitOpeningToWall — muat bukaan pada dinding dengan clearance", () => {
  it("dinding lapang: pakai lebar yang diminta, ditaruh di tengah", () => {
    const fit = fitOpeningToWall({ wallLenM: 6, desiredWidthM: 2.4 })
    expect(fit).not.toBeNull()
    expect(fit!.widthM).toBeCloseTo(2.4, 3)
    expect(fit!.positionM).toBeCloseTo(3, 3)
  })

  it("KASUS rumah-mungil: dinding 2,4 m tak boleh diisi bukaan 2,4 m", () => {
    // Dulu: width = min(2.4, 2.4) = 2.4, pos = min(1.2, 1.2) = 1.2
    //       -> segmen 0–2,4, sisa 0 di KEDUA sisi.
    const fit = fitOpeningToWall({ wallLenM: 2.4, desiredWidthM: 2.4 })
    expect(fit).not.toBeNull()
    // Lebar menyusut agar clearance 15 cm dua sisi tetap ada.
    expect(fit!.widthM).toBeLessThanOrEqual(2.4 - 2 * OPENING_EDGE_MARGIN_M + 1e-9)
    const start = fit!.positionM - fit!.widthM / 2
    const end = 2.4 - (fit!.positionM + fit!.widthM / 2)
    expect(start).toBeGreaterThanOrEqual(OPENING_EDGE_MARGIN_M - 1e-9)
    expect(end).toBeGreaterThanOrEqual(OPENING_EDGE_MARGIN_M - 1e-9)
  })

  it("selalu menyisakan clearance di kedua sisi, untuk rentang dinding apa pun", () => {
    for (const wallLenM of [1.2, 1.5, 1.8, 2.4, 3, 3.3, 5, 7.5, 11]) {
      for (const desiredWidthM of [0.6, 0.9, 1.2, 1.8, 2.4]) {
        const fit = fitOpeningToWall({ wallLenM, desiredWidthM })
        if (!fit) continue
        const start = fit.positionM - fit.widthM / 2
        const end = wallLenM - (fit.positionM + fit.widthM / 2)
        expect(start, `dinding ${wallLenM} lebar ${desiredWidthM}`).toBeGreaterThanOrEqual(
          OPENING_EDGE_MARGIN_M - 1e-9
        )
        expect(end, `dinding ${wallLenM} lebar ${desiredWidthM}`).toBeGreaterThanOrEqual(
          OPENING_EDGE_MARGIN_M - 1e-9
        )
        expect(fit.widthM).toBeGreaterThan(0)
      }
    }
  })

  it("null bila dinding terlalu pendek untuk lebar minimum + clearance", () => {
    // 0,6 m minimum + 2×0,15 = 0,9 m. Dinding 0,64 m (kasus Void:s) tak layak.
    expect(fitOpeningToWall({ wallLenM: 0.64, desiredWidthM: 0.6, minWidthM: 0.6 })).toBeNull()
  })

  it("tidak melebarkan bukaan melebihi yang diminta di dinding lapang", () => {
    const fit = fitOpeningToWall({ wallLenM: 11, desiredWidthM: 0.9 })
    expect(fit!.widthM).toBeCloseTo(0.9, 3)
  })

  it("KASUS pintu utama: pintu 0,9 m tidak lagi mendarat di sisa 5 cm", () => {
    // Dulu positionM 0,5 hardcoded -> sisa 0,05 m di 12 proyek aset.
    for (const wallLenM of [3.3, 5, 5.8, 6, 7.5, 8, 8.5]) {
      const fit = fitOpeningToWall({ wallLenM, desiredWidthM: 0.9 })
      expect(fit).not.toBeNull()
      const start = fit!.positionM - fit!.widthM / 2
      expect(start).toBeGreaterThanOrEqual(OPENING_EDGE_MARGIN_M - 1e-9)
    }
  })

  it("menghormati posisi yang diinginkan bila masih sah", () => {
    const fit = fitOpeningToWall({ wallLenM: 6, desiredWidthM: 0.9, preferredPositionM: 1.5 })
    expect(fit!.positionM).toBeCloseTo(1.5, 3)
  })

  it("menarik posisi yang diinginkan ke titik sah terdekat, bukan menolak", () => {
    const fit = fitOpeningToWall({ wallLenM: 6, desiredWidthM: 0.9, preferredPositionM: 0 })
    expect(fit).not.toBeNull()
    expect(fit!.positionM).toBeCloseTo(0.45 + OPENING_EDGE_MARGIN_M, 3)
  })

  it("membulatkan ke 2 desimal (cm) agar data denah bersih", () => {
    const fit = fitOpeningToWall({ wallLenM: 2.86, desiredWidthM: 2.4 })
    expect(fit!.widthM).toBe(Number(fit!.widthM.toFixed(2)))
    expect(fit!.positionM).toBe(Number(fit!.positionM.toFixed(2)))
  })
})

/**
 * REGRESI NYATA dari migration 0024: menggeser bukaan menjauh dari ujung
 * dinding bisa MENDORONGNYA MENUMPANG titik pertemuan tembok di tengah bidang.
 *
 * Kasus asli (proj-asset-rumah-tipe-60, "Taman belakang:n", dinding 5 m):
 * di seberangnya Kamar mandi x 3,0–4,8 lalu Dapur x 4,8–8,0 → junction pada
 * koordinat dinding host 1,8. Pintu 2,4 m digeser dari pos 1,2 (segmen 0–2,4)
 * ke pos 1,35 (segmen 0,15–2,55) — 1,8 tetap DI DALAM segmen, jadi daun pintu
 * menembus dinding pemisah kamar mandi/dapur.
 *
 * `fitOpeningToWall` hanya sadar ujung dinding; `junctionsM` membuatnya sadar
 * pertemuan tembok juga — sejalan dengan yang sudah dilakukan
 * `freeDoorPosition` (opening-plan.ts).
 */
describe("fitOpeningToWall — sadar titik pertemuan tembok", () => {
  it("KASUS tipe-60: tidak menggeser pintu ke posisi yang menumpang junction", () => {
    const fit = fitOpeningToWall({
      wallLenM: 5,
      desiredWidthM: 2.4,
      preferredPositionM: 1.2,
      junctionsM: [1.8],
    })
    expect(fit).not.toBeNull()
    const a = fit!.positionM - fit!.widthM / 2
    const b = fit!.positionM + fit!.widthM / 2
    // 1,8 tidak boleh berada di dalam bentang bukaan.
    expect(a >= 1.8 - 1e-6 || b <= 1.8 + 1e-6).toBe(true)
  })

  it("menjaga clearance dari junction, bukan sekadar tidak menumpanginya", () => {
    const fit = fitOpeningToWall({
      wallLenM: 6,
      desiredWidthM: 0.9,
      preferredPositionM: 3,
      junctionsM: [3.2],
    })
    expect(fit).not.toBeNull()
    const b = fit!.positionM + fit!.widthM / 2
    // Kusen mundur >= 0,15 m dari pertemuan tembok.
    expect(3.2 - b).toBeGreaterThanOrEqual(OPENING_EDGE_MARGIN_M - 1e-6)
  })

  it("menyusutkan lebar bila itu satu-satunya cara memuat antar dua junction", () => {
    // Bidang solid antara junction 2,0 dan 3,4 hanya 1,4 m; pintu 1,2 m butuh
    // 1,2 + 2×0,15 = 1,5 m. Lebar harus menyusut agar muat.
    const fit = fitOpeningToWall({
      wallLenM: 6,
      desiredWidthM: 1.2,
      preferredPositionM: 2.7,
      junctionsM: [2.0, 3.4],
    })
    if (fit) {
      const a = fit.positionM - fit.widthM / 2
      const b = fit.positionM + fit.widthM / 2
      for (const j of [2.0, 3.4]) {
        expect(j > a - 1e-6 && j < b + 1e-6).toBe(false)
      }
    }
  })

  it("null bila tak ada bidang solid yang cukup di antara pertemuan tembok", () => {
    // Junction tiap 0,5 m — tak ada bidang solid selebar 0,6 m + clearance.
    const fit = fitOpeningToWall({
      wallLenM: 3,
      desiredWidthM: 0.9,
      minWidthM: 0.6,
      junctionsM: [0.5, 1.0, 1.5, 2.0, 2.5],
    })
    expect(fit).toBeNull()
  })

  it("tanpa junctionsM perilakunya tidak berubah (kompatibel ke belakang)", () => {
    const withOut = fitOpeningToWall({ wallLenM: 6, desiredWidthM: 2.4 })
    const withEmpty = fitOpeningToWall({ wallLenM: 6, desiredWidthM: 2.4, junctionsM: [] })
    expect(withEmpty).toEqual(withOut)
  })
})
