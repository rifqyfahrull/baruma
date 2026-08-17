// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/server/llm", () => ({ chatText: vi.fn() }))

import { planFloorplanTurn } from "./floorplan-planner"
import * as llm from "@/lib/server/llm"
import type { FloorplanScene } from "@/lib/assistant/actions"

const scene: FloorplanScene = {
  site: { widthM: 10, depthM: 12 },
  floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
  selectedFloorId: "f1",
  selectedRoomId: null,
  rooms: [
    { id: "r1", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
  ],
  openings: [],
}

/**
 * AGENT UTAMA (baruma-assistant) di jalur floorplan — opsi B arsitektur
 * 2-agent. Menutup temuan log agent-lab: baruma-assistant tidak pernah
 * terpanggil di editor (227 entri log = 100% baruma-floorplan-actions).
 * Kontrak: gagal → null → pipeline jalan tanpa rencana, TIDAK throw.
 */
describe("planFloorplanTurn — Agent Utama menyusun rencana", () => {
  beforeEach(() => {
    vi.mocked(llm.chatText).mockReset()
  })

  it("meminta rencana ke baruma-assistant dengan instruksi & konteks denah ringkas", async () => {
    vi.mocked(llm.chatText).mockResolvedValue("1. Pindahkan Dapur ke timur. 2. Tambah pintu ke koridor.")
    const plan = await planFloorplanTurn({
      instruction: "rombak bagian dapur",
      scene,
      brief: { summary: "Rumah keluarga" } as never,
    })

    expect(plan).toBe("1. Pindahkan Dapur ke timur. 2. Tambah pintu ke koridor.")
    const [messages] = vi.mocked(llm.chatText).mock.calls[0] as never as Array<
      Array<{ role: string; content: string }>
    >
    const system = messages[0]?.content ?? ""
    const user = messages[1]?.content ?? ""

    // Agent ini arsitek PERENCANA, bukan eksekutor — tidak boleh mengarang aksi.
    expect(system).toContain("ARSITEK UTAMA")
    expect(system).toContain("TANPA JSON")
    expect(system).toContain("JANGAN mengarang id ruang")
    // Konteks berisi instruksi + denah ringkas (nama ruang, lahan, brief).
    expect(user).toContain("rombak bagian dapur")
    expect(user).toContain("Kamar Tidur")
    expect(user).toContain("Lahan: 10×12 m")
    expect(user).toContain("Rumah keluarga")
  })

  it("mengembalikan null ketika layanan gagal (resilience — pipeline tetap jalan)", async () => {
    vi.mocked(llm.chatText).mockResolvedValue(null)
    expect(await planFloorplanTurn({ instruction: "x", scene })).toBeNull()
  })

  it("mengembalikan null ketika chatText throw (tidak pernah melempar ke pemanggil)", async () => {
    vi.mocked(llm.chatText).mockRejectedValue(new Error("upstream down"))
    expect(await planFloorplanTurn({ instruction: "x", scene })).toBeNull()
  })

  it("memangkas rencana yang melebihi 1200 karakter", async () => {
    vi.mocked(llm.chatText).mockResolvedValue("x".repeat(2000))
    const plan = await planFloorplanTurn({ instruction: "x", scene })
    expect(plan?.length).toBe(1200)
  })

  it("tanpa brief: konteks tetap terbentuk dan memuat fallback '—'", async () => {
    vi.mocked(llm.chatText).mockResolvedValue("rencana")
    await planFloorplanTurn({ instruction: "x", scene })
    const [messages] = vi.mocked(llm.chatText).mock.calls[0] as never as Array<
      Array<{ role: string; content: string }>
    >
    expect(messages[1]?.content ?? "").toContain("BRIEF (ringkas): —")
  })
})

/**
 * REGRESI PRODUKSI 2026-08-02 — proj-modern-tropis-1.
 *
 * Denah proyek itu KOSONG (rooms: [], floors: []) sementara brief-nya berisi 12
 * ruang lengkap dengan nama. `compactBrief` lama hanya mengirim summary +
 * priorities, jadi Planner cuma menerima kalimat summary "…1 lantai, 12 ruang,
 * ~199m²" tanpa daftar ruangnya. Akibatnya Planner menuntut ke pengguna:
 * "mohon kirim nama dan ukuran 12 ruang eksisting" — meminta data yang SUDAH
 * dipegang sistem, dan pipeline berakhir tanpa satu pun aksi.
 */
const emptyScene: FloorplanScene = {
  site: { widthM: 12, depthM: 18 },
  floors: [],
  selectedFloorId: null,
  selectedRoomId: null,
  rooms: [],
  openings: [],
}

const briefWithProgram = {
  summary: "Brief disusun berdasarkan denah eksisting (1 lantai, 12 ruang, total ~199m²).",
  priorities: ["terasa_lega", "ventilasi"],
  building: { floors: 2, rooftop: false },
  spaceProgram: [
    { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1 },
    { id: "sp-6", roomType: "kamar_tidur", name: "Kamar tidur 1", required: true, quantity: 1 },
    { id: "sp-11", roomType: "laundry", name: "Laundry", required: true, quantity: 1 },
  ],
} as never

describe("planFloorplanTurn — program ruang brief wajib sampai ke Planner", () => {
  beforeEach(() => {
    vi.mocked(llm.chatText).mockReset()
    vi.mocked(llm.chatText).mockResolvedValue("rencana")
  })

  const contextOf = async (args: Parameters<typeof planFloorplanTurn>[0]) => {
    await planFloorplanTurn(args)
    const [messages] = vi.mocked(llm.chatText).mock.calls[0] as never as Array<
      Array<{ role: string; content: string }>
    >
    return { system: messages[0]?.content ?? "", user: messages[1]?.content ?? "" }
  }

  it("mengirim NAMA setiap ruang di spaceProgram, bukan hanya jumlahnya", async () => {
    const { user } = await contextOf({
      instruction: "buatkan denah 2 lantai, sesuai brief",
      scene: emptyScene,
      brief: briefWithProgram,
    })
    expect(user).toContain("Carport")
    expect(user).toContain("Kamar tidur 1")
    expect(user).toContain("Laundry")
  })

  it("menyatakan denah masih kosong secara eksplisit agar summary brief tak disalahartikan", async () => {
    const { user } = await contextOf({
      instruction: "buatkan denah 2 lantai, sesuai brief",
      scene: emptyScene,
      brief: briefWithProgram,
    })
    expect(user).toMatch(/belum ada ruang|denah masih kosong/i)
  })

  it("melarang Planner meminta daftar ruang yang sudah tersedia", async () => {
    const { system } = await contextOf({
      instruction: "buatkan denah 2 lantai, sesuai brief",
      scene: emptyScene,
      brief: briefWithProgram,
    })
    expect(system).toContain("DILARANG meminta pengguna")
    expect(system).toMatch(/PROGRAM RUANG/)
  })

  it("hanya membolehkan klarifikasi bila denah DAN program ruang sama-sama kosong", async () => {
    const { system } = await contextOf({
      instruction: "buatkan denah",
      scene: emptyScene,
      brief: { summary: "x", priorities: [], spaceProgram: [] } as never,
    })
    expect(system).toMatch(/satu-satunya kondisi/i)
  })
})
