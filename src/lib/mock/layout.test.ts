import { describe, it, expect } from "vitest"

import { generateLayout } from "./layout"
import { auditDesign } from "@/lib/audit/design-audit"
import { sampleBrief, sampleProject } from "@/test-utils/fixtures"
import type { Brief, Project } from "@/types"

/**
 * BUKTI INTEGRASI: generateLayout() sekarang menghasilkan denah yang
 * TERSAMBUNG, bukan cuma "unit test fungsi murninya lulus".
 *
 * Akar masalah yang ditutup: generator hanya membuat jendela (tak pernah
 * pintu), jadi SETIAP denah baru dari brief pengguna lahir cacat — 53 ruang
 * terputus ditemukan di 15 denah produksi, semuanya dari generator ini.
 * Menambal seed data (34-fix-missing-doors.mjs) tak berguna selama akar ini
 * belum diperbaiki. Tes ini memakai auditDesign() yang sama dengan yang
 * dipakai pengguna — bukan pemeriksaan ad-hoc.
 */
function accessFindings(project: Project, brief: Brief) {
  const layout = generateLayout(project, brief)
  const audit = auditDesign({ project, layout, brief })
  return audit.findings.filter(
    (f) => f.id.startsWith("sirkulasi-akses:") || f.id.startsWith("sirkulasi-terputus:"),
  )
}

describe("generateLayout — akses & konektivitas (bukti perbaikan akar)", () => {
  it("rumah 1 lantai kecil (tipe 36 khas, ruang tamu/keluarga jadi sirkulasi): nol temuan", () => {
    const project: Project = {
      ...sampleProject,
      floors: 1,
      rooftop: false,
      site: { widthM: 6, depthM: 12, areaM2: 72 },
    }
    const brief: Brief = {
      ...sampleBrief,
      site: { widthM: 6, depthM: 12, areaM2: 72 },
      building: { floors: 1, rooftop: false, budget: sampleBrief.building.budget, finishingLevel: "menengah" },
      spaceProgram: [
        { id: "sp1", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp2", roomType: "ruang_keluarga", name: "Ruang keluarga", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp3", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp4", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 2, preferredFloor: 1 },
        { id: "sp5", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp6", roomType: "carport", name: "Carport", required: true, quantity: 1, preferredFloor: 1 },
      ],
    }
    const findings = accessFindings(project, brief)
    expect(findings).toEqual([])
  })

  it("brief standar 2-lantai + rooftop: ruang tamu lantai dasar tersambung; TIDAK lagi salah ditandai (bug mainComponent lintas-lantai)", () => {
    // sampleBrief: floor-1 = 1 ruang tamu saja; floor-2 = 2 kamar tidur + 1
    // kamar mandi TANPA ruang sirkulasi. Sebelum perbaikan analyzeRoomConnectivity
    // (mainComponent dulu satu angka GLOBAL lintas semua lantai), ruang tamu
    // ikut tertandai "terputus" hanya karena gugus 2-ruang di lantai atas
    // (kt+km, via pintu en-suite) kebetulan lebih besar dari gugus 1-ruang di
    // lantai dasar — padahal keduanya di lantai BERBEDA dan lantai tak
    // terhubung lewat pintu (tangga di luar cakupan graf ini).
    const findings = accessFindings(sampleProject, sampleBrief)
    expect(findings.some((f) => f.id.includes("ruang-tamu") || f.title.includes("Ruang tamu"))).toBe(false)

    // Dulu kt2 terisolasi karena lantai 2 tak punya ruang sirkulasi & pintu
    // apa pun akan menembus kamar orang — dibilang "keterbatasan space-program".
    // Kini generator MENAMBAH KORIDOR otomatis saat lantai hanya berisi ruang
    // privat, jadi kt2 tersambung. Ini perbaikan nyata, bukan regresi —
    // ekspektasi "harus ada 1 terisolasi" sudah usang.
    expect(findings).toEqual([])
  })

  it("openings memuat pintu (bukan jendela saja seperti sebelum perbaikan)", () => {
    const layout = generateLayout(sampleProject, sampleBrief)
    expect(layout.openings.some((o) => o.type === "door")).toBe(true)
  })

  it("rumah 2 lantai dgn ruang keluarga di tiap lantai: kamar tidur atas tetap tersambung", () => {
    const project: Project = { ...sampleProject, floors: 2, rooftop: false, site: { widthM: 8, depthM: 10, areaM2: 80 } }
    const brief: Brief = {
      ...sampleBrief,
      site: project.site,
      building: { floors: 2, rooftop: false, budget: sampleBrief.building.budget, finishingLevel: "menengah" },
      spaceProgram: [
        { id: "sp1", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp2", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
        // Ruang keluarga di lantai 2 = anchor sirkulasi utk kamar-kamar upstairs.
        { id: "sp3", roomType: "ruang_keluarga", name: "Ruang keluarga", required: true, quantity: 1, preferredFloor: 2 },
        { id: "sp4", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 3, preferredFloor: 2 },
        { id: "sp5", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 2, preferredFloor: 2 },
        { id: "sp6", roomType: "carport", name: "Carport", required: true, quantity: 1, preferredFloor: 1 },
      ],
    }
    const findings = accessFindings(project, brief)
    // Dgn ruang sirkulasi tersedia di lantai atas, seharusnya jauh lebih
    // sedikit (idealnya nol) dibanding skenario TANPA ruang sirkulasi sama
    // sekali (lihat kasus 3-lantai-tanpa-sirkulasi yg sengaja tak diuji "0"
    // di sini krn itu keterbatasan space-program, bukan target fungsi ini).
    expect(findings.length).toBeLessThanOrEqual(1)
  })
})

/**
 * AKAR MASALAH HULU: treemap mengisi 100% footprint, jadi generator secara
 * STRUKTURAL tak bisa menghasilkan koridor — tak ada celah untuk disisipi.
 * Inilah kenapa 15/16 denah produksi punya ruang terkurung: bukan kebetulan,
 * tapi konsekuensi matematis packFloor (squarifiedTreemap mengisi penuh).
 *
 * KEMAJUAN yang SUDAH dicapai sesi ini: `koridor` akhirnya terdaftar di
 * RoomType (sebelumnya zod menolak addRoom bertipe koridor — agent disuruh
 * melakukan hal yang mustahil). Jadi agent SEKARANG bisa membuat koridor via
 * aksi, dan connectivity-repair.ts mengusulkannya secara deterministik.
 *
 * BELUM dicapai: generator otomatis mengalokasikan koridor saat melahirkan
 * denah. Percobaan strip-koridor di packFloor membuat koridor muncul tapi
 * generateConnectingDoors belum menyambungkan salah satu kamar (butuh debug
 * geometri sharedWallSpan yang tertunda gangguan tooling). Dilewati sementara,
 * BUKAN diselesaikan dengan tebakan — sesuai feedback_testing.md: jangan
 * menandai selesai apa yang belum terverifikasi.
 */
/**
 * TANGGA — cacat yang lolos senyap sampai 2026-08-02.
 *
 * `generateLayout` tidak pernah membuat ruang `tangga`, dan `spaceProgram` dari
 * brief pengguna juga tak memuatnya (pemilik rumah tidak berpikir "tangga" saat
 * menyebut kebutuhan ruang — ia menyebut kamar, dapur, carport). Akibatnya
 * SETIAP denah 2 lantai lahir tanpa akses vertikal: penghuni tak bisa naik.
 *
 * Kenapa tak ada yang menangkapnya: `analyzeRoomConnectivity` sengaja tidak
 * melintasi lantai (tangga di luar cakupan grafnya), jadi validator memeriksa
 * tiap lantai secara terpisah dan keduanya tampak sehat. Cacat ini hanya
 * terlihat kalau pertanyaannya diajukan: "bagaimana penghuni naik?"
 *
 * Ditemukan saat melatih agent pada brief nyata proj-modern-tropis-1 — hasilnya
 * 13 ruang di 2 lantai, nol tangga.
 */
describe("generateLayout — akses vertikal (tangga)", () => {
  const briefFor = (floors: number, rooftop = false): Brief => ({
    ...sampleBrief,
    site: { widthM: 10, depthM: 14, areaM2: 140 },
    building: { floors, rooftop, budget: sampleBrief.building.budget, finishingLevel: "menengah" },
    spaceProgram: [
      { id: "sp1", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp2", roomType: "ruang_keluarga", name: "Ruang keluarga", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp3", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp4", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 3, preferredFloor: 2 },
      { id: "sp5", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 2, preferredFloor: 2 },
    ],
  })

  it("rumah 1 lantai TIDAK diberi tangga (tak ada tujuan)", () => {
    const project: Project = { ...sampleProject, floors: 1, rooftop: false, site: { widthM: 10, depthM: 14, areaM2: 140 } }
    const layout = generateLayout(project, briefFor(1))
    expect(layout.rooms.filter((r) => r.type === "tangga")).toEqual([])
  })

  it("rumah 2 lantai punya tangga di lantai dasar", () => {
    const project: Project = { ...sampleProject, floors: 2, rooftop: false, site: { widthM: 10, depthM: 14, areaM2: 140 } }
    const layout = generateLayout(project, briefFor(2))
    const stairs = layout.rooms.filter((r) => r.type === "tangga")
    expect(stairs).toHaveLength(1)
    expect(stairs[0].floorId).toBe("floor-1")
  })

  it("rumah 3 lantai punya tangga di setiap lantai kecuali yang teratas", () => {
    const project: Project = { ...sampleProject, floors: 3, rooftop: false, site: { widthM: 10, depthM: 14, areaM2: 140 } }
    const layout = generateLayout(project, briefFor(3))
    const floorsWithStair = new Set(layout.rooms.filter((r) => r.type === "tangga").map((r) => r.floorId))
    expect(floorsWithStair).toEqual(new Set(["floor-1", "floor-2"]))
  })

  it("rooftop juga butuh akses: lantai teratas reguler dapat tangga", () => {
    const project: Project = { ...sampleProject, floors: 2, rooftop: true, site: { widthM: 10, depthM: 14, areaM2: 140 } }
    const layout = generateLayout(project, briefFor(2, true))
    const floorsWithStair = new Set(layout.rooms.filter((r) => r.type === "tangga").map((r) => r.floorId))
    expect(floorsWithStair).toEqual(new Set(["floor-1", "floor-2"]))
  })

  it("tangga tidak diduplikasi bila brief sudah memintanya", () => {
    const project: Project = { ...sampleProject, floors: 2, rooftop: false, site: { widthM: 10, depthM: 14, areaM2: 140 } }
    const brief = briefFor(2)
    brief.spaceProgram = [
      ...brief.spaceProgram,
      { id: "sp9", roomType: "tangga", name: "Tangga", required: true, quantity: 1, preferredFloor: 1 },
    ]
    expect(generateLayout(project, brief).rooms.filter((r) => r.type === "tangga")).toHaveLength(1)
  })

  it("tangga tersambung dari dalam rumah, bukan ruang mati", () => {
    const project: Project = { ...sampleProject, floors: 2, rooftop: false, site: { widthM: 10, depthM: 14, areaM2: 140 } }
    const brief = briefFor(2)
    const layout = generateLayout(project, brief)
    const stair = layout.rooms.find((r) => r.type === "tangga")!
    const hasDoor = layout.openings.some(
      (o) => o.type === "door" && o.wallId.startsWith(`${stair.id}:`)
    )
    expect(hasDoor, "tangga tanpa pintu = ruang mati").toBe(true)
    expect(accessFindings(project, brief)).toEqual([])
  })
})

/**
 * PROPORSI RUANG — cacat kualitas yang terukur (2026-08-02).
 *
 * Diukur pada brief nyata proj-modern-tropis-1 (lahan 12×18 m, 2 lantai):
 *   Kamar mandi 10,44 × 2,15 m = 22 m², rasio 4,9
 *   Kamar tidur 10,44 × 3,57 m = 37 m², rasio 2,9
 *   Koridor     0,94 × 17,44 m,           rasio 18,6
 *
 * Kamar mandi 22 m² selebar rumah bukan kamar mandi — itu lorong. Penyebabnya
 * `packFloor`: pada lantai berkoridor, tiap slice dibuat membentang PENUH lebar
 * sisa agar sisi baratnya menempel koridor, tanpa batas atas luas. Ruang kecil
 * (kamar mandi, laundry) ikut ditarik selebar rumah.
 *
 * Efek berantainya nyata, bukan estetika saja: ruang selebar rumah tak bisa
 * dipindah ke lantai lain (tak ada petak sebesar itu yang bersentuhan dinding),
 * sehingga penyuntingan lanjutan mentok — lihat agent-followup.e2e.test.ts.
 */
describe("generateLayout — proporsi ruang wajar", () => {
  const project: Project = {
    ...sampleProject,
    floors: 2,
    rooftop: false,
    site: { widthM: 12, depthM: 18, areaM2: 216 },
  }
  const brief: Brief = {
    ...sampleBrief,
    site: project.site,
    building: { floors: 2, rooftop: false, budget: sampleBrief.building.budget, finishingLevel: "menengah" },
    spaceProgram: [
      { id: "sp1", roomType: "ruang_tamu", name: "Ruang Tamu", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp2", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp3", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 3, preferredFloor: 2 },
      { id: "sp4", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 2, preferredFloor: 2 },
      { id: "sp5", roomType: "laundry", name: "Laundry", required: true, quantity: 1, preferredFloor: 2 },
    ],
  }

  it("kamar mandi tidak dibuat selebar rumah (maksimal 3× luas wajarnya)", () => {
    const layout = generateLayout(project, brief)
    for (const km of layout.rooms.filter((r) => r.type === "kamar_mandi")) {
      // ROOM_TYPES.kamar_mandi.defaultAreaM2 = 4 → batas longgar 12 m².
      expect(km.areaM2, `${km.name} ${km.width}×${km.depth}`).toBeLessThanOrEqual(12)
    }
  })

  it("tidak ada ruang huni yang memanjang seperti lorong (rasio sisi ≤ 3)", () => {
    const layout = generateLayout(project, brief)
    const huni = layout.rooms.filter(
      (r) => r.type === "kamar_tidur" || r.type === "kamar_mandi" || r.type === "laundry"
    )
    expect(huni.length).toBeGreaterThan(0)
    for (const r of huni) {
      const rasio = Math.max(r.width, r.depth) / Math.min(r.width, r.depth)
      expect(rasio, `${r.name} ${r.width}×${r.depth}`).toBeLessThanOrEqual(3)
    }
  })

  it("kamar tidur tetap layak huni, tidak dikecilkan berlebihan", () => {
    const layout = generateLayout(project, brief)
    for (const kt of layout.rooms.filter((r) => r.type === "kamar_tidur")) {
      expect(kt.areaM2, `${kt.name} terlalu kecil`).toBeGreaterThanOrEqual(7)
      expect(Math.min(kt.width, kt.depth), `${kt.name} terlalu sempit`).toBeGreaterThanOrEqual(2)
    }
  })

  it("proporsi diperbaiki TANPA mengorbankan akses: nol ruang terkurung", () => {
    expect(accessFindings(project, brief)).toEqual([])
  })
})

describe("generateLayout — koridor sebagai ruang sirkulasi struktural", () => {
  it("lantai atas berisi 3 kamar tidur: generator mengalokasikan koridor & menyambungkan", () => {
    const project: Project = { ...sampleProject, floors: 2, rooftop: false, site: { widthM: 7, depthM: 9, areaM2: 63 } }
    const brief: Brief = {
      ...sampleBrief,
      site: project.site,
      building: { floors: 2, rooftop: false, budget: sampleBrief.building.budget, finishingLevel: "menengah" },
      spaceProgram: [
        { id: "sp1", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp2", roomType: "ruang_keluarga", name: "Ruang keluarga", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp3", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
        { id: "sp4", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 3, preferredFloor: 2 },
        { id: "sp5", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 1, preferredFloor: 2 },
        { id: "sp6", roomType: "carport", name: "Carport", required: true, quantity: 1, preferredFloor: 1 },
      ],
    }
    const layout = generateLayout(project, brief)
    expect(layout.rooms.find((r) => r.floorId === "floor-2" && r.type === "koridor")).toBeDefined()
    expect(accessFindings(project, brief)).toEqual([])
  })
})

