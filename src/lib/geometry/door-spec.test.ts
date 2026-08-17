import { describe, it, expect } from "vitest"

import { doorSpecFor } from "./door-spec"

/**
 * Aturan diambil LANGSUNG dari domain-knowledge/domain-knowledge-pintu.md §2
 * ("Tabel Cepat: Jenis & Ukuran Pintu per Fungsi Ruang") dan §3.
 *
 * Sebelum ini generator memasang 0,9 m hinged_door untuk SEMUA ruang
 * (connect-rooms.ts DOOR_W = 0.9, tanpa field kind), dan jalur LLM memilih
 * kind tanpa kriteria apa pun — keluhan produksi "agent masih belum pintar
 * memilih jenis pintu yang efisien".
 */
describe("doorSpecFor — kamar mandi (keselamatan)", () => {
  it("kamar mandi kecil dapat pintu geser (nol ruang ayun), bukan swing ke dalam", () => {
    // §3.1: kamar mandi < 3 m² → sliding/pocket door paling disarankan.
    const spec = doorSpecFor("kamar_mandi", { areaM2: 2.4 })
    expect(spec.kind).toBe("pocket_door")
    expect(spec.widthM).toBeCloseTo(0.7, 2)
  })

  it("kamar mandi luas boleh swing, tapi WAJIB membuka keluar", () => {
    // §1 & §3.1: jangan pernah swing-ke-dalam murni di ruang basah — tubuh
    // yang jatuh di dalam akan mengganjal daun pintu.
    const spec = doorSpecFor("kamar_mandi", { areaM2: 5 })
    expect(spec.swing).toBe("keluar")
  })

  it("tidak pernah menghasilkan swing ke dalam untuk ruang basah, ukuran apa pun", () => {
    for (const areaM2 of [1.5, 2.4, 3, 4, 6, 9]) {
      const spec = doorSpecFor("kamar_mandi", { areaM2 })
      expect(spec.swing).not.toBe("ke_dalam")
    }
  })
})

describe("doorSpecFor — ruang privat & servis", () => {
  it("kamar tidur: swing 0,8 m membuka KE DALAM kamar (jaga sirkulasi koridor)", () => {
    // §3.2
    const spec = doorSpecFor("kamar_tidur", { areaM2: 12 })
    expect(spec.kind).toBe("hinged_door")
    expect(spec.widthM).toBeCloseTo(0.8, 2)
    expect(spec.swing).toBe("ke_dalam")
  })

  it("gudang/pantry: pintu sempit, cukup 0,7 m", () => {
    // §2 baris gudang/ruang servis/pantry: 60–70 cm
    const spec = doorSpecFor("gudang", { areaM2: 3 })
    expect(spec.widthM).toBeLessThanOrEqual(0.7 + 1e-9)
  })
})

describe("doorSpecFor — ruang sosial (tanpa daun pintu)", () => {
  it("dapur ke ruang makan default TANPA pintu (open passage)", () => {
    // §2 & §3.3: rumah modern minimalis → open; tren broken-plan.
    const spec = doorSpecFor("dapur", { areaM2: 9, neighborType: "ruang_makan" })
    expect(spec.kind).toBe("open_passage")
  })

  it("ruang tamu ke koridor: bukaan lebar tanpa daun", () => {
    // §2: ruang sosial utama, minim sekat, bukaan 150–300 cm.
    const spec = doorSpecFor("ruang_tamu", { areaM2: 16, neighborType: "koridor" })
    expect(spec.kind).toBe("open_passage")
    expect(spec.widthM).toBeGreaterThanOrEqual(1.2)
  })
})

describe("doorSpecFor — akses luar", () => {
  it("balkon/teras dari dalam: sliding, hemat ruang ayun", () => {
    // §2 baris balkon/teras
    const spec = doorSpecFor("ruang_keluarga", { areaM2: 18, neighborType: "balkon" })
    expect(spec.kind).toBe("sliding_glass_door")
  })

  it("carport dapat pintu garasi", () => {
    const spec = doorSpecFor("carport", { areaM2: 15 })
    expect(spec.kind).toBe("garage_door")
  })

  it("pintu utama minimal 0,8 m (aksesibilitas), default 0,9 m", () => {
    // §2 + §4: lebar bukaan bersih >= 80 cm.
    const spec = doorSpecFor("ruang_tamu", { areaM2: 16, isMainEntrance: true })
    expect(spec.widthM).toBeGreaterThanOrEqual(0.9 - 1e-9)
  })
})

describe("doorSpecFor — kontrak umum", () => {
  it("lebar yang dihasilkan selalu >= 0,6 m dan <= 2,7 m (rentang katalog)", () => {
    const types = ["kamar_tidur", "kamar_mandi", "dapur", "gudang", "ruang_tamu", "carport", "koridor"]
    for (const t of types) {
      const spec = doorSpecFor(t, { areaM2: 8 })
      expect(spec.widthM).toBeGreaterThanOrEqual(0.6)
      expect(spec.widthM).toBeLessThanOrEqual(2.7)
    }
  })

  it("tipe ruang tak dikenal jatuh ke pintu ayun standar, bukan crash", () => {
    const spec = doorSpecFor("ruang_ajaib_yang_belum_ada", { areaM2: 10 })
    expect(spec.kind).toBe("hinged_door")
    expect(spec.widthM).toBeGreaterThanOrEqual(0.8)
  })
})
