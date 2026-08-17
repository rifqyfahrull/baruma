// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  buildMessages,
  findDestructiveDeletionFeedback,
  findFloorplanActionFeedback,
  findFloorplanViolations,
  humanizeViolations,
  reconcileFloorplanOverlaps,
  sanitizeActions,
  simulateFloorplanActions,
  simulateSanitation,
  summarizeFloorplanIssues,
} from "./editor-assistant"
import { describeAction } from "@/lib/assistant/actions"
import type {
  FloorplanAction,
  FloorplanScene,
  InteriorAction,
  InteriorScene,
} from "@/lib/assistant/actions"

const fpScene: FloorplanScene = {
  site: { widthM: 10, depthM: 12 },
  floors: [
    { id: "f1", name: "Lantai 1", level: 1 },
    { id: "f2", name: "Lantai 2", level: 2 },
  ],
  selectedFloorId: "f1",
  selectedRoomId: "r1",
  rooms: [
    { id: "r1", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
  ],
  openings: [],
}

/** Scene 2 lantai, 4 ruang lantai 1 + 1 ruang lantai 2 — untuk guard
 *  anti-destruktif (insiden produksi 2026-08-01: deleteRoom ×10 semua ruang
 *  lantai 1 saat user minta "kerjakan lantai 2"). */
const multiFloorScene: FloorplanScene = {
  site: { widthM: 10, depthM: 12 },
  floors: [
    { id: "f1", name: "Lantai 1", level: 1 },
    { id: "f2", name: "Lantai 2", level: 2 },
  ],
  selectedFloorId: "f1",
  selectedRoomId: null,
  rooms: [
    { id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
    { id: "r2", name: "Dapur", type: "dapur", floorId: "f1", x: 3, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
    { id: "r3", name: "Taman", type: "taman", floorId: "f1", x: 0, y: 3, width: 3, depth: 3, areaM2: 9, locked: false },
    { id: "r4", name: "Gudang", type: "gudang", floorId: "f1", x: 3, y: 3, width: 3, depth: 3, areaM2: 9, locked: false },
    { id: "r5", name: "Kamar Utama", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
  ],
  openings: [],
}

const intScene: InteriorScene = {
  style: "modern_tropical",
  selectedRoomId: "r1",
  rooms: [
    {
      roomId: "r1",
      name: "Ruang Tamu",
      type: "ruang_tamu",
      widthM: 4,
      depthM: 3,
      furniture: [
        { id: "f1", furnitureId: "sofa-3-seat", name: "Sofa", category: "seating", x: 1, y: 1, rotationDeg: 0 },
      ],
    },
  ],
}

describe("buildMessages (floorplan)", () => {
  it("frames open-plan layout criticism as actionable architectural intent", () => {
    const messages = buildMessages(
      "floorplan",
      fpScene,
      "ruang ini menghalangi area clean, lebih elok kalau ruang utama disambungkan",
      []
    )
    const system = messages[0]?.content ?? ""

    expect(system).toContain("TERJEMAHKAN ke intent arsitektural")
    expect(system).toContain("ruang servis yang memotong sumbu visual/sirkulasi")
    expect(system).toContain("samakan zoneId ruang utama")
    expect(system).toContain("Jangan membalas seolah user harus memberi perintah mekanis")
    expect(system).toContain("ISU VALIDASI AKTIF")
  })

  it("menyertakan aturan anti-destruktif (menutup insiden deleteRoom massal)", () => {
    const messages = buildMessages("floorplan", fpScene, "kerjakan lantai 2", [])
    const system = messages[0]?.content ?? ""
    expect(system).toContain("DILARANG MENGHAPUS DESAIN YANG TIDAK DIMINTA")
    expect(system).toContain("PINDAHKAN dengan updateRoom.floorId")
    expect(system).toContain("WAJIB menyertakan floorId")
  })
})

/**
 * GUARD ANTI-DESTRUKTIF — menutup insiden produksi 2026-08-01
 * (proj-modern-tropis-1): "kerjakan lantai 2" → deleteRoom ×10 semua ruang
 * lantai 1, status applied, design_layouts jadi 0 ruang. Guard konektivitas
 * tidak menangkap (semua ruang terhapus → tidak ada yang terputus).
 */
describe("findDestructiveDeletionFeedback — guard anti-destruktif", () => {
  it("menolak deleteRoom yang menghapus ≥50% ruang satu lantai (skenario insiden)", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      ["r1", "r2", "r3"].map((roomId) => ({ type: "deleteRoom", roomId })),
      "tolong kerjakan lantai 2"
    )
    expect(feedback.some((f) => f.includes("mayoritas/semua ruang"))).toBe(true)
  })

  it("menolak deleteRoom SEMUA ruang lantai 1 walau instruksi tidak menyebut lantai", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      ["r1", "r2", "r3", "r4"].map((roomId) => ({ type: "deleteRoom", roomId })),
      "rombak denahnya"
    )
    expect(feedback.some((f) => f.includes("mayoritas/semua ruang"))).toBe(true)
  })

  it("menolak deleteRoom di lantai BERBEDA dari lantai yang diminta instruksi", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      [{ type: "deleteRoom", roomId: "r1" }], // Ruang Tamu di lantai 1
      "kerjakan lantai 2"
    )
    expect(feedback.some((f) => f.includes("lantai LAIN"))).toBe(true)
  })

  it("mengizinkan deleteRoom tunggal yang memang diminta user", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      [{ type: "deleteRoom", roomId: "r3" }], // Taman
      "hapus taman di lantai 1"
    )
    expect(feedback).toEqual([])
  })

  it("mengizinkan deleteRoom 2 ruang yang diminta (bukan mayoritas lantai)", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      [
        { type: "deleteRoom", roomId: "r3" },
        { type: "deleteRoom", roomId: "r4" },
      ],
      "hapus taman dan gudang"
    )
    expect(feedback).toEqual([])
  })

  it("menolak addRoom tanpa floorId saat instruksi menyebut lantai tujuan (akar insiden)", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      [{ type: "addRoom", roomType: "kamar_tidur", x: 1, y: 1, width: 3, depth: 3 }],
      "kerjakan lantai 2"
    )
    expect(feedback.some((f) => f.includes("floorId"))).toBe(true)
  })

  it("mengizinkan addRoom dengan floorId yang benar", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      [{ type: "addRoom", roomType: "kamar_tidur", floorId: "f2", x: 1, y: 1, width: 3, depth: 3 }],
      "kerjakan lantai 2"
    )
    expect(feedback).toEqual([])
  })

  it("mengizinkan addRoom tanpa floorId bila instruksi tidak menyebut lantai", () => {
    const feedback = findDestructiveDeletionFeedback(
      multiFloorScene,
      [{ type: "addRoom", roomType: "kamar_tidur", x: 1, y: 1, width: 3, depth: 3 }],
      "tambah kamar tidur"
    )
    expect(feedback).toEqual([])
  })
})

describe("buildMessages — plannerNote dari Agent Utama (opsi B 2-agent)", () => {
  it("menyuntikkan blok RENCANA ARSITEK UTAMA ke prompt floorplan", () => {
    const messages = buildMessages(
      "floorplan",
      fpScene,
      "kerjakan lantai 2",
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "1. Buat koridor 1 m di tengah. 2. Tambah pintu dari tiap kamar ke koridor."
    )
    const system = messages[0]?.content ?? ""
    expect(system).toContain("RENCANA ARSITEK UTAMA")
    expect(system).toContain("1. Buat koridor 1 m di tengah. 2. Tambah pintu dari tiap kamar ke koridor.")
  })

  it("tanpa plannerNote prompt persis seperti sebelumnya (tanpa blok rencana)", () => {
    const messages = buildMessages("floorplan", fpScene, "kerjakan lantai 2", [])
    const system = messages[0]?.content ?? ""
    expect(system).not.toContain("RENCANA ARSITEK UTAMA")
  })

  it("mode interior mengabaikan plannerNote (rencana hanya untuk denah)", () => {
    const messages = buildMessages(
      "interior",
      intScene,
      "tata sofa",
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "rencana yang tidak boleh bocor ke interior"
    )
    const system = messages[0]?.content ?? ""
    expect(system).not.toContain("RENCANA ARSITEK UTAMA")
    expect(system).not.toContain("rencana yang tidak boleh bocor ke interior")
  })
})

/**
 * REGRESI 2026-08-02 — proj-modern-tropis-1: denah kosong + brief 12 ruang.
 * Executor ikut membalas "saya perlu informasi lebih detail" tanpa satu pun
 * aksi, padahal seluruh daftar ruang ada di BRIEF PROYEK dalam prompt yang
 * sama. Prompt harus menyuruh bangun dari nol, bukan menagih data.
 */
describe("buildMessages — denah kosong wajib dibangun, bukan ditanyakan", () => {
  const emptyScene: FloorplanScene = {
    site: { widthM: 12, depthM: 18 },
    floors: [],
    selectedFloorId: null,
    selectedRoomId: null,
    rooms: [],
    openings: [],
  }
  const brief = {
    summary: "Brief disusun berdasarkan denah eksisting (1 lantai, 12 ruang, ~199m²).",
    site: { widthM: 12, depthM: 18 },
    building: { floors: 2, rooftop: false },
    priorities: ["terasa_lega"],
    spaceProgram: [
      { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1 },
      { id: "sp-6", roomType: "kamar_tidur", name: "Kamar tidur 1", required: true, quantity: 1 },
    ],
    constraints: [],
    risks: [],
  } as never

  const systemFor = (scene: FloorplanScene) =>
    buildMessages("floorplan", scene, "buatkan denah 2 lantai, sesuai brief", [], undefined, undefined, undefined, brief)[0]
      ?.content ?? ""

  it("melarang balasan tanpa aksi ketika program ruang tersedia", () => {
    const system = systemFor(emptyScene)
    expect(system).toContain("MEMBANGUN DARI NOL")
    expect(system).toContain("DILARANG membalas tanpa aksi")
  })

  it("menegaskan program ruang di BRIEF adalah sumber daftar ruang", () => {
    const system = systemFor(emptyScene)
    expect(system).toMatch(/spaceProgram di BRIEF/i)
    // Daftar ruangnya memang ikut terkirim — jadi menagihnya ke user itu salah.
    expect(system).toContain("Carport")
    expect(system).toContain("Kamar tidur 1")
  })

  it("aturan bangun-dari-nol tidak muncul saat denah sudah berisi ruang", () => {
    const system = systemFor(fpScene)
    expect(system).not.toContain("MEMBANGUN DARI NOL")
  })
})

describe("sanitizeActions (floorplan)", () => {
  it("keeps valid actions, drops unknown ids, and clamps numbers", () => {
    const raw = [
      { type: "updateRoom", roomId: "r1", patch: { width: 999, depth: 4 } },
      { type: "updateRoom", roomId: "ghost", patch: { name: "X" } }, // unknown room → dropped
      { type: "addOpening", roomId: "r1", side: "n", positionM: 999, openingType: "window" },
      { type: "deleteRoom", roomId: "r1" },
      { type: "bogus" }, // invalid → dropped
    ]
    const out = sanitizeActions("floorplan", raw, fpScene) as FloorplanAction[]
    expect(out).toHaveLength(3)

    const upd = out.find((a) => a.type === "updateRoom")
    expect(upd).toBeDefined()
    if (upd?.type === "updateRoom") {
      expect(upd.patch.width).toBe(10) // clamped to site width
      expect(upd.patch.depth).toBe(4)
    }

    const op = out.find((a) => a.type === "addOpening")
    if (op?.type === "addOpening") {
      // Dulu 3 (= panjang dinding utara), yang berarti segmen dunia 2,4–3,6
      // untuk jendela 1,2 m: menjorok 0,6 m KELUAR dinding. Kini ditarik ke
      // bidang solid dengan sisa >= 0,15 m dari ujung (2,25 → 1,65–2,85).
      expect(op.positionM).toBe(2.25)
    }

    expect(out.some((a) => a.type === "deleteRoom")).toBe(true)
  })

  it("drops updateRoom whose patch ends up empty", () => {
    const out = sanitizeActions("floorplan", [{ type: "updateRoom", roomId: "r1", patch: {} }], fpScene)
    expect(out).toHaveLength(0)
  })

  /**
   * Keluhan produksi: "agent masih sering membuat posisi bukaan pintunya
   * persis pas di titik pertemuan/sudut tembok, bukan di tengah bidang dinding
   * yang solid".
   *
   * Jalur deterministik memakai freeDoorPosition (margin 0,15 m dari ujung &
   * titik pertemuan tembok), tapi jalur LLM hanya meng-clamp ke [0, edge] —
   * sehingga positionM: 0 dari LLM diterima apa adanya. Aturannya sendiri
   * sudah tertulis di domain-knowledge-pintu.md §1: kusen tidak boleh < 15 cm
   * dari dinding tegak lurus, atau daun pintu mentok.
   */
  it("menarik pintu yang diminta LLM di sudut (positionM 0) menjauh dari ujung dinding", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addOpening", roomId: "r1", side: "n", positionM: 0, openingType: "door" }],
      fpScene
    ) as FloorplanAction[]

    const op = out.find((a) => a.type === "addOpening")
    expect(op).toBeDefined()
    if (op?.type === "addOpening") {
      // Pintu 0,9 m di dinding 3 m: kusen harus mundur >= 0,15 m dari ujung,
      // jadi titik tengah minimal 0,45 + 0,15 = 0,6 m.
      expect(op.positionM).toBeGreaterThanOrEqual(0.6 - 1e-9)
      expect(op.positionM).toBeLessThanOrEqual(3 - 0.6 + 1e-9)
    }
  })

  it("menarik pintu yang diminta LLM di ujung jauh dinding ke dalam bidang solid", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addOpening", roomId: "r1", side: "w", positionM: 999, openingType: "door" }],
      fpScene
    ) as FloorplanAction[]

    const op = out.find((a) => a.type === "addOpening")
    expect(op).toBeDefined()
    if (op?.type === "addOpening") {
      expect(op.positionM).toBeLessThanOrEqual(3 - 0.6 + 1e-9)
      expect(op.positionM).toBeGreaterThanOrEqual(0.6 - 1e-9)
    }
  })

  it("keeps zoneId and snaps levelOffsetM", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateRoom", roomId: "r1", patch: { zoneId: "zona-1", levelOffsetM: -0.16 } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateRoom") {
      expect(out[0].patch.zoneId).toBe("zona-1")
      expect(out[0].patch.levelOffsetM).toBe(-0.18) // snapped to a riser multiple
    }
  })

  it("keeps a valid floor move and strips an unknown floorId", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateRoom", roomId: "r1", patch: { floorId: "f2" } }, // valid floor → kept
        { type: "updateRoom", roomId: "r1", patch: { floorId: "f9", name: "X" } }, // bad floor stripped, name kept
      ],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    if (out[0].type === "updateRoom") expect(out[0].patch.floorId).toBe("f2")
    if (out[1].type === "updateRoom") {
      expect(out[1].patch.floorId).toBeUndefined()
      expect(out[1].patch.name).toBe("X")
    }
  })

  it("accepts the new editor-parity actions and validates ids", () => {
    const sceneWithOpening: FloorplanScene = {
      ...fpScene,
      openings: [{ id: "op1", roomId: "r1", side: "n", type: "window", positionM: 1 }],
    }
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "addRoom", roomType: "kamar_mandi" },                 // x/y default-filled
        { type: "addFloor" },
        { type: "removeFloor", floorId: "f2" },                       // valid floor
        { type: "removeFloor", floorId: "ghost" },                    // dropped
        { type: "updateOpening", openingId: "op1", patch: { positionM: 2 } },
        { type: "updateOpening", openingId: "nope", patch: { positionM: 2 } }, // dropped
        { type: "deleteOpening", openingId: "op1" },
      ],
      sceneWithOpening
    ) as FloorplanAction[]
    const kinds = out.map((a) => a.type)
    expect(kinds).toEqual(["addRoom", "addFloor", "removeFloor", "updateOpening", "deleteOpening"])
    const add = out[0]
    if (add.type === "addRoom") { expect(add.x).toBeTypeOf("number"); expect(add.y).toBeTypeOf("number") }
  })
})

describe("sanitizeActions (floorplan updateFloor — kantilever offsetM)", () => {
  it("passes a within-bounds offsetM through untouched", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateFloor", floorId: "f1", patch: { offsetM: { dx: 1.2, dy: -0.6 } } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    const action = out[0]
    if (action.type === "updateFloor") {
      expect(action.patch.offsetM).toEqual({ dx: 1.2, dy: -0.6 })
    } else {
      throw new Error("expected updateFloor action")
    }
  })

  it("rejects offsetM beyond ±1.5 m per axis (CANTILEVER_MAX_M) — dropped by zod, not applied", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateFloor", floorId: "f1", patch: { offsetM: { dx: 5, dy: -5 } } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(0)
  })

  it("drops the action for an unknown floor id", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateFloor", floorId: "ghost", patch: { offsetM: { dx: 0.5, dy: 0.5 } } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(0)
  })

  it("drops the action when the patch ends up empty", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateFloor", floorId: "f1", patch: {} }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(0)
  })
})

describe("sanitizeActions (floorplan setRoof)", () => {
  it("clamps slopeDeg and overhangM to the UI bounds", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { slopeDeg: 50, overhangM: 2 } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "setRoof") {
      expect(out[0].patch.slopeDeg).toBe(40)
      expect(out[0].patch.overhangM).toBe(1)
    }
  })

  it("passes through valid type/material enums untouched", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { type: "pelana", material: "metal" } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "setRoof") {
      expect(out[0].patch).toEqual({ type: "pelana", material: "metal" })
    }
  })

  it("drops invalid enum values via zod", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { type: "flat", material: "genteng_beton" } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(0)
  })

  it("drops setRoof whose patch ends up empty", () => {
    const out = sanitizeActions("floorplan", [{ type: "setRoof", patch: {} }], fpScene)
    expect(out).toHaveLength(0)
  })
})

describe("describeAction (setRoof)", () => {
  it("composes a Bahasa description from the provided patch fields", () => {
    const action: FloorplanAction = { type: "setRoof", patch: { type: "pelana", slopeDeg: 30 } }
    expect(describeAction(action, fpScene)).toBe("Ubah atap → pelana 30°")
  })

  it("includes overhang and material label when present", () => {
    const action: FloorplanAction = {
      type: "setRoof",
      patch: { overhangM: 0.8, material: "genteng_keramik" },
    }
    expect(describeAction(action, fpScene)).toBe("Ubah atap → overhang 0.8 m Genteng Keramik")
  })

  it("falls back to a bare label for an empty patch", () => {
    const action: FloorplanAction = { type: "setRoof", patch: {} }
    expect(describeAction(action, fpScene)).toBe("Ubah atap")
  })
})

describe("sanitizeActions (floorplan roof zones)", () => {
  const scene: FloorplanScene = {
    ...fpScene,
    roofZones: [
      {
        id: "rz-1",
        type: "datar",
        x: 5,
        y: 5,
        widthM: 3,
        depthM: 3,
        slopeDeg: 0,
        overhangM: 0.2,
        materialId: "genteng_beton",
      },
    ],
  }

  it("passes addRoofZone with bounds-clamped geometry and drops irrelevant lowSide", () => {
    const out = sanitizeActions(
      "floorplan",
      [{
        type: "addRoofZone",
        zone: {
          type: "pelana",
          x: 99,
          y: -5,
          widthM: 20,
          depthM: 2,
          slopeDeg: 80,
          overhangM: 2,
          materialId: "metal",
          lowSide: "e",
        },
      }],
      scene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "addRoofZone") {
      expect(out[0].zone).toMatchObject({
        type: "pelana",
        x: 5,
        y: 1,
        widthM: 10,
        depthM: 2,
        slopeDeg: 60,
        overhangM: 1,
        materialId: "metal",
      })
      expect(out[0].zone.lowSide).toBeUndefined()
    }
  })

  it("allows update/remove only for existing roof-zone ids", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateRoofZone", id: "rz-1", patch: { slopeDeg: 70, materialId: "aspal" } },
        { type: "removeRoofZone", id: "rz-1" },
        { type: "updateRoofZone", id: "missing", patch: { slopeDeg: 20 } },
        { type: "removeRoofZone", id: "missing" },
      ],
      scene
    ) as FloorplanAction[]
    expect(out.map((a) => a.type)).toEqual(["updateRoofZone", "removeRoofZone"])
    if (out[0].type === "updateRoofZone") {
      expect(out[0].patch).toEqual({ slopeDeg: 60, materialId: "aspal" })
    }
  })
})

describe("sanitizeActions (floorplan rooftop area)", () => {
  it("passes a valid setRooftopArea through unchanged", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRooftopArea", area: { x: 1, y: 1, width: 3, depth: 2 } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "setRooftopArea") {
      expect(out[0].area).toEqual({ x: 1, y: 1, width: 3, depth: 2 })
    }
  })

  it("passes clearRooftopArea through", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "clearRooftopArea" }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("clearRooftopArea")
  })

  it("drops a malformed setRooftopArea (missing area / negative width) via zod", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setRooftopArea" }, // missing area → dropped
        { type: "setRooftopArea", area: { x: 0, y: 0, width: -2, depth: 2 } }, // negative width → dropped
      ],
      fpScene
    )
    expect(out).toHaveLength(0)
  })
})

describe("describeAction (rooftop area)", () => {
  it("composes Bahasa descriptions for set/clear", () => {
    expect(
      describeAction({ type: "setRooftopArea", area: { x: 1, y: 1, width: 4, depth: 3 } }, fpScene)
    ).toBe("Atur area deck rooftop (4×3 m)")
    expect(describeAction({ type: "clearRooftopArea" }, fpScene)).toBe(
      "Deck rooftop penuh (hapus area parsial)"
    )
  })
})

describe("buildMessages (rooftop area)", () => {
  it("floorplan prompt documents the rooftop-area actions", () => {
    const msgs = buildMessages("floorplan", fpScene, "atur deck rooftop", [])
    expect(msgs[0].content).toContain("setRooftopArea")
    expect(msgs[0].content).toContain("clearRooftopArea")
  })
})

describe("sanitizeActions (floorplan setSoilBearing)", () => {
  it("clamps soilBearingKPa to [50, 400]", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setSoilBearing", soilBearingKPa: 500 },
        { type: "setSoilBearing", soilBearingKPa: 10 },
      ],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    if (out[0].type === "setSoilBearing") expect(out[0].soilBearingKPa).toBe(400)
    if (out[1].type === "setSoilBearing") expect(out[1].soilBearingKPa).toBe(50)
  })

  it("keeps an in-range value untouched", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setSoilBearing", soilBearingKPa: 180 }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "setSoilBearing") expect(out[0].soilBearingKPa).toBe(180)
  })

  it("drops a non-numeric soilBearingKPa via zod", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setSoilBearing", soilBearingKPa: "banyak" }],
      fpScene
    )
    expect(out).toHaveLength(0)
  })
})

describe("describeAction (setSoilBearing)", () => {
  it("composes a Bahasa description with the kPa value", () => {
    expect(
      describeAction({ type: "setSoilBearing", soilBearingKPa: 200 }, fpScene)
    ).toBe("Set daya dukung tanah → 200 kPa")
  })
})

const fpSceneElec: FloorplanScene = {
  ...fpScene,
  electrical: [
    { id: "e1", type: "stopkontak", roomId: "r1", x: 1, y: 1 },
    { id: "e2", type: "saklar_tunggal", roomId: "r1", x: 0.5, y: 0.5 },
  ],
}

describe("sanitizeActions (floorplan electrical)", () => {
  it("accepts addElectricalPoint on a real room and clamps x/y to the lot", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addElectricalPoint", roomId: "r1", pointType: "stopkontak", x: 99, y: -5 }],
      fpSceneElec
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "addElectricalPoint") {
      expect(out[0].x).toBe(10) // clamped to site width
      expect(out[0].y).toBe(0) // clamped up to 0
      expect(out[0].pointType).toBe("stopkontak")
    }
  })

  it("drops addElectricalPoint with an unknown roomId", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addElectricalPoint", roomId: "ghost", pointType: "stopkontak", x: 1, y: 1 }],
      fpSceneElec
    )
    expect(out).toHaveLength(0)
  })

  it("drops addElectricalPoint with an invalid pointType enum", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addElectricalPoint", roomId: "r1", pointType: "laser", x: 1, y: 1 }],
      fpSceneElec
    )
    expect(out).toHaveLength(0)
  })

  it("moveElectricalPoint validates the id and clamps x/y", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "moveElectricalPoint", id: "e1", x: 99, y: 99 },
        { type: "moveElectricalPoint", id: "ghost", x: 1, y: 1 }, // unknown id → dropped
      ],
      fpSceneElec
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "moveElectricalPoint") {
      expect(out[0].id).toBe("e1")
      expect(out[0].x).toBe(10) // clamped to site width
      expect(out[0].y).toBe(12) // clamped to site depth
    }
  })

  it("updateElectricalPoint validates id, enum, and strips an unknown roomId", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateElectricalPoint", id: "e1", patch: { type: "data", roomId: "ghost" } },
        { type: "updateElectricalPoint", id: "ghost", patch: { type: "data" } }, // unknown id → dropped
      ],
      fpSceneElec
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateElectricalPoint") {
      expect(out[0].patch.type).toBe("data")
      expect(out[0].patch.roomId).toBeUndefined() // unknown room stripped
    }
  })

  it("drops updateElectricalPoint whose patch empties out or has an invalid enum", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateElectricalPoint", id: "e1", patch: { roomId: "ghost" } }, // roomId stripped → empty → dropped
        { type: "updateElectricalPoint", id: "e1", patch: { type: "nope" } }, // invalid enum → zod drop
      ],
      fpSceneElec
    )
    expect(out).toHaveLength(0)
  })

  it("removeElectricalPoint validates the id", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "removeElectricalPoint", id: "e2" },
        { type: "removeElectricalPoint", id: "ghost" }, // unknown id → dropped
      ],
      fpSceneElec
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "removeElectricalPoint") expect(out[0].id).toBe("e2")
  })

  it("autoGenerateElectrical passes through; an unknown floorId is dropped", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "autoGenerateElectrical" }, // all floors
        { type: "autoGenerateElectrical", floorId: "f1" }, // valid floor
        { type: "autoGenerateElectrical", floorId: "ghost" }, // dropped
      ],
      fpSceneElec
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    expect(out.every((a) => a.type === "autoGenerateElectrical")).toBe(true)
  })
})

describe("describeAction (electrical)", () => {
  it("describes each of the 5 electrical actions in Bahasa", () => {
    expect(
      describeAction({ type: "addElectricalPoint", roomId: "r1", pointType: "stopkontak", x: 1, y: 1 }, fpSceneElec)
    ).toBe("Tambah titik listrik: Stopkontak")
    expect(describeAction({ type: "moveElectricalPoint", id: "e1", x: 1, y: 1 }, fpSceneElec)).toBe(
      "Pindahkan titik listrik"
    )
    expect(
      describeAction({ type: "updateElectricalPoint", id: "e1", patch: { type: "stopkontak_daya" } }, fpSceneElec)
    ).toBe("Ubah titik listrik: tipe → Stopkontak Daya")
    expect(describeAction({ type: "removeElectricalPoint", id: "e1" }, fpSceneElec)).toBe("Hapus titik listrik")
    expect(describeAction({ type: "autoGenerateElectrical" }, fpSceneElec)).toBe("Auto-generate titik listrik")
  })
})

describe("buildMessages (electrical)", () => {
  it("floorplan prompt documents the electrical actions", () => {
    const msgs = buildMessages("floorplan", fpScene, "tambah stopkontak", [])
    expect(msgs[0].content).toContain("addElectricalPoint")
    expect(msgs[0].content).toContain("autoGenerateElectrical")
  })
})

/* ----- Water + sanitation (SP5) ----- */

const fpSceneWater: FloorplanScene = {
  ...fpScene,
  water: [
    { id: "w1", type: "kloset", roomId: "r1", x: 1, y: 1 },
    { id: "w2", type: "wastafel", roomId: "r1", x: 0.5, y: 0.5 },
  ],
  sanitation: {
    septicTank: { id: "s-sep", x: 2, y: 10, widthM: 1.2, lengthM: 2.4, depthM: 1.8, capacity: 4.32 },
    soakwell: { id: "s-soak", x: 7, y: 10, widthM: 1.4, lengthM: 1.4, depthM: 2, capacity: 3.52 },
    controlBoxes: [
      { id: "s-box0", x: 3, y: 11, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
      { id: "s-box1", x: 6, y: 11, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
    ],
  },
}

describe("sanitizeActions (floorplan water)", () => {
  it("accepts addWaterPoint on a real room and clamps x/y to the lot", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addWaterPoint", roomId: "r1", waterType: "kloset", x: 99, y: -5 }],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "addWaterPoint") {
      expect(out[0].x).toBe(10) // clamped to site width
      expect(out[0].y).toBe(0) // clamped up to 0
      expect(out[0].waterType).toBe("kloset")
    }
  })

  it("drops addWaterPoint with an unknown roomId", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addWaterPoint", roomId: "ghost", waterType: "kloset", x: 1, y: 1 }],
      fpSceneWater
    )
    expect(out).toHaveLength(0)
  })

  it("drops addWaterPoint with an invalid waterType enum", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addWaterPoint", roomId: "r1", waterType: "jacuzzi", x: 1, y: 1 }],
      fpSceneWater
    )
    expect(out).toHaveLength(0)
  })

  it("moveWaterPoint validates the id and clamps x/y", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "moveWaterPoint", id: "w1", x: 99, y: 99 },
        { type: "moveWaterPoint", id: "ghost", x: 1, y: 1 }, // unknown id → dropped
      ],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "moveWaterPoint") {
      expect(out[0].id).toBe("w1")
      expect(out[0].x).toBe(10) // clamped to site width
      expect(out[0].y).toBe(12) // clamped to site depth
    }
  })

  it("updateWaterPoint validates id, enum, and strips an unknown roomId", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateWaterPoint", id: "w1", patch: { type: "shower", roomId: "ghost" } },
        { type: "updateWaterPoint", id: "ghost", patch: { type: "shower" } }, // unknown id → dropped
      ],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateWaterPoint") {
      expect(out[0].patch.type).toBe("shower")
      expect(out[0].patch.roomId).toBeUndefined() // unknown room stripped
    }
  })

  it("drops updateWaterPoint whose patch empties out or has an invalid enum", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateWaterPoint", id: "w1", patch: { roomId: "ghost" } }, // roomId stripped → empty → dropped
        { type: "updateWaterPoint", id: "w1", patch: { type: "nope" } }, // invalid enum → zod drop
      ],
      fpSceneWater
    )
    expect(out).toHaveLength(0)
  })

  it("removeWaterPoint validates the id", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "removeWaterPoint", id: "w2" },
        { type: "removeWaterPoint", id: "ghost" }, // unknown id → dropped
      ],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "removeWaterPoint") expect(out[0].id).toBe("w2")
  })

  it("autoGenerateWater passes through; an unknown floorId is dropped", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "autoGenerateWater" }, // all floors
        { type: "autoGenerateWater", floorId: "f1" }, // valid floor
        { type: "autoGenerateWater", floorId: "ghost" }, // dropped
      ],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    expect(out.every((a) => a.type === "autoGenerateWater")).toBe(true)
  })
})

describe("sanitizeActions (floorplan sanitation)", () => {
  it("moveSanitationObject validates septicTank presence and clamps to the lot", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "moveSanitationObject", kind: "septicTank", x: 99, y: -5 }],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "moveSanitationObject") {
      expect(out[0].kind).toBe("septicTank")
      expect(out[0].x).toBe(10) // clamped to site width
      expect(out[0].y).toBe(0) // clamped up to 0
    }
  })

  it("moveSanitationObject accepts a controlBox with an in-range ref and clamps", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "moveSanitationObject", kind: "controlBox", ref: 1, x: 99, y: 99 }],
      fpSceneWater
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "moveSanitationObject") {
      expect(out[0].kind).toBe("controlBox")
      expect(out[0].ref).toBe(1)
      expect(out[0].x).toBe(10) // clamped to site width
      expect(out[0].y).toBe(12) // clamped to site depth
    }
  })

  it("drops moveSanitationObject when the object is missing", () => {
    // fpScene has no sanitation bag at all
    const out = sanitizeActions(
      "floorplan",
      [{ type: "moveSanitationObject", kind: "septicTank", x: 1, y: 1 }],
      fpScene
    )
    expect(out).toHaveLength(0)
  })

  it("drops moveSanitationObject controlBox with an out-of-range ref", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "moveSanitationObject", kind: "controlBox", ref: 5, x: 1, y: 1 }, // out of range → dropped
        { type: "moveSanitationObject", kind: "controlBox", x: 1, y: 1 }, // missing ref → dropped
      ],
      fpSceneWater
    )
    expect(out).toHaveLength(0)
  })

  it("autoSizeSanitation always passes through", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "autoSizeSanitation" }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("autoSizeSanitation")
  })
})

describe("describeAction (water + sanitation)", () => {
  it("describes each of the 7 water/sanitation actions in Bahasa", () => {
    expect(
      describeAction({ type: "addWaterPoint", roomId: "r1", waterType: "kloset", x: 1, y: 1 }, fpSceneWater)
    ).toBe("Tambah titik air: Kloset")
    expect(describeAction({ type: "moveWaterPoint", id: "w1", x: 1, y: 1 }, fpSceneWater)).toBe(
      "Pindahkan titik air"
    )
    expect(
      describeAction({ type: "updateWaterPoint", id: "w1", patch: { type: "shower" } }, fpSceneWater)
    ).toBe("Ubah titik air: tipe → Shower")
    expect(describeAction({ type: "removeWaterPoint", id: "w1" }, fpSceneWater)).toBe("Hapus titik air")
    expect(describeAction({ type: "autoGenerateWater" }, fpSceneWater)).toBe("Auto-generate titik air")
    expect(
      describeAction({ type: "moveSanitationObject", kind: "septicTank", x: 1, y: 1 }, fpSceneWater)
    ).toBe("Pindahkan objek sanitasi")
    expect(describeAction({ type: "autoSizeSanitation" }, fpSceneWater)).toBe("Auto-size sanitasi (SNI)")
  })
})

describe("buildMessages (water)", () => {
  it("floorplan prompt documents the water + sanitation actions", () => {
    const msgs = buildMessages("floorplan", fpScene, "tambah titik air", [])
    expect(msgs[0].content).toContain("addWaterPoint")
    expect(msgs[0].content).toContain("autoGenerateWater")
    expect(msgs[0].content).toContain("moveSanitationObject")
    expect(msgs[0].content).toContain("autoSizeSanitation")
  })
})

describe("sanitizeActions (interior)", () => {
  it("validates catalog ids, furniture instances, and style enum", () => {
    const raw = [
      { type: "addFurniture", roomId: "r1", furnitureId: "sofa-3-seat" }, // valid catalog id
      { type: "addFurniture", roomId: "r1", furnitureId: "nonexistent" }, // not in catalog → dropped
      { type: "moveFurniture", roomId: "r1", furnitureId: "f1", x: 2, y: 2 }, // instance exists
      { type: "moveFurniture", roomId: "r1", furnitureId: "ghost", x: 0, y: 0 }, // no such instance → dropped
      { type: "removeFurniture", roomId: "ghost", furnitureId: "f1" }, // unknown room → dropped
      { type: "setStyle", style: "japandi" }, // valid enum
      { type: "setStyle", style: "not_a_style" }, // invalid enum → dropped
      { type: "resetRoom", roomId: "r1" },
    ]
    const out = sanitizeActions("interior", raw, intScene) as InteriorAction[]
    const kinds = out.map((a) => a.type).sort()
    expect(kinds).toEqual(["addFurniture", "moveFurniture", "resetRoom", "setStyle"].sort())

    const style = out.find((a) => a.type === "setStyle")
    if (style?.type === "setStyle") expect(style.style).toBe("japandi")
  })
})

describe("sanitizeActions (interior lighting)", () => {
  const intSceneWithLighting: InteriorScene = {
    style: "modern_tropical",
    selectedRoomId: "r1",
    rooms: [
      {
        roomId: "r1",
        name: "Ruang Tamu",
        type: "ruang_tamu",
        widthM: 4,
        depthM: 3,
        furniture: [
          { id: "f1", furnitureId: "sofa-3-seat", name: "Sofa", category: "seating", x: 1, y: 1, rotationDeg: 0 },
        ],
        lighting: [
          { id: "l1", roomId: "r1", type: "pendant", x: 2, y: 1.5, heightM: 2.5, colorTemperature: "warm", qty: 1 },
        ],
      },
    ],
  }

  it("keeps valid light actions, drops ghost roomId/lightId, enforces enums", () => {
    const raw = [
      { type: "addLight", roomId: "r1", lightType: "downlight" }, // valid
      { type: "addLight", roomId: "ghost", lightType: "pendant" }, // unknown room → dropped
      { type: "addLight", roomId: "r1", lightType: "laser_beam" }, // invalid enum → dropped
      { type: "moveLight", roomId: "r1", lightId: "l1", x: 1, y: 1 }, // valid instance
      { type: "moveLight", roomId: "r1", lightId: "ghost_l", x: 1, y: 1 }, // no such instance → dropped
      { type: "updateLight", roomId: "r1", lightId: "l1", patch: { colorTemperature: "cool", qty: 3 } }, // valid
      { type: "updateLight", roomId: "r1", lightId: "ghost_l", patch: { qty: 2 } }, // ghost lightId → dropped
      { type: "removeLight", roomId: "r1", lightId: "l1" }, // valid
      { type: "removeLight", roomId: "ghost", lightId: "l1" }, // unknown room → dropped
    ]
    const out = sanitizeActions("interior", raw, intSceneWithLighting) as InteriorAction[]
    const kinds = out.map((a) => a.type)
    expect(kinds).toEqual(["addLight", "moveLight", "updateLight", "removeLight"])
  })

  it("clamps x/y of moveLight to room dimensions", () => {
    const raw = [{ type: "moveLight", roomId: "r1", lightId: "l1", x: 99, y: -5 }]
    const out = sanitizeActions("interior", raw, intSceneWithLighting) as InteriorAction[]
    expect(out).toHaveLength(1)
    const a = out[0]
    if (a.type === "moveLight") {
      expect(a.x).toBeLessThanOrEqual(4)
      expect(a.y).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("buildMessages", () => {
  it("floorplan prompt grounds on the scene + room-type catalog", () => {
    const msgs = buildMessages("floorplan", fpScene, "perbesar kamar", [])
    expect(msgs[0].role).toBe("system")
    expect(msgs[0].content).toContain("DENAH")
    expect(msgs[0].content).toContain("kamar_tidur") // RoomType catalog
    expect(msgs[0].content).toContain("r1") // scene room id
    expect(msgs[0].content).toContain("Lantai 1") // floors are injected
    expect(msgs[0].content).toContain("floorId") // cross-floor move documented
    expect(msgs.at(-1)).toEqual({ role: "user", content: "perbesar kamar" })
  })

  it("floorplan prompt documents the setRoof action", () => {
    const msgs = buildMessages("floorplan", fpScene, "ubah atap", [])
    expect(msgs[0].content).toContain("setRoof")
    expect(msgs[0].content).toContain("pelana")
  })

  it("floorplan prompt documents the setSoilBearing action", () => {
    const msgs = buildMessages("floorplan", fpScene, "set daya dukung tanah", [])
    expect(msgs[0].content).toContain("setSoilBearing")
  })

  it("interior prompt injects the furniture catalog + styles + scene", () => {
    const msgs = buildMessages("interior", intScene, "tambah sofa", [])
    expect(msgs[0].content).toContain("sofa-3-seat") // furniture catalog
    expect(msgs[0].content).toContain("japandi") // available styles
    expect(msgs[0].content).toContain("RUANG")
    expect(msgs.at(-1)).toEqual({ role: "user", content: "tambah sofa" })
  })

  it("trims history to the last 8 turns", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn ${i}`,
    }))
    const msgs = buildMessages("floorplan", fpScene, "halo", history)
    // system + 8 history + user
    expect(msgs).toHaveLength(10)
  })
})

describe("floorplan validation loop helpers", () => {
  it("simulateFloorplanActions applies updates and deletes", () => {
    const moved = simulateFloorplanActions(
      [{ type: "updateRoom", roomId: "r1", patch: { x: 5, width: 4, depth: 2 } }],
      fpScene
    )
    expect(moved.find((r) => r.id === "r1")).toMatchObject({ x: 5, width: 4, depth: 2, areaM2: 8 })

    const deleted = simulateFloorplanActions([{ type: "deleteRoom", roomId: "r1" }], fpScene)
    expect(deleted.find((r) => r.id === "r1")).toBeUndefined()
  })

  it("flags overlapping rooms on the same floor", () => {
    const rooms = [
      { id: "a", name: "A", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
      { id: "b", name: "B", type: "dapur", floorId: "f1", x: 2, y: 2, width: 4, depth: 4, areaM2: 16 },
    ]
    expect(
      findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }).some((s) => s.includes("tumpang-tindih"))
    ).toBe(true)
  })

  it("flags rooms outside the lot", () => {
    const rooms = [
      { id: "a", name: "A", type: "ruang_tamu", floorId: "f1", x: 8, y: 0, width: 4, depth: 4, areaM2: 16 },
    ]
    expect(
      findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }).some((s) => s.includes("keluar lahan"))
    ).toBe(true)
  })

  it("returns [] for a valid, non-overlapping layout", () => {
    const rooms = [
      { id: "a", name: "A", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
      { id: "b", name: "B", type: "dapur", floorId: "f1", x: 3, y: 0, width: 3, depth: 3, areaM2: 9 },
    ]
    expect(findFloorplanViolations(rooms, { widthM: 10, depthM: 10 })).toEqual([])
  })

  it("does not flag overlaps across different floors", () => {
    const rooms = [
      { id: "a", name: "A", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
      { id: "b", name: "B", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
    ]
    expect(findFloorplanViolations(rooms, { widthM: 10, depthM: 10 })).toEqual([])
  })

  describe("sanitation obstacles (the reported bug: a room 'fixed' onto the soakwell)", () => {
    const floors = [{ id: "f1", name: "Lantai 1", level: 1 }]
    const sanitation = {
      // Center (5,5), 2x2 footprint -> occupies x:[4,6], y:[4,6].
      soakwell: { id: "s1", x: 5, y: 5, widthM: 2, lengthM: 2, depthM: 2 },
    }

    it("flags a ground-floor room overlapping the soakwell", () => {
      const rooms = [
        { id: "a", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.85, y: 4, width: 3.15, depth: 1.61, areaM2: 5.1 },
      ]
      const violations = findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }, sanitation, floors)
      expect(violations.some((s) => s.includes("Kamar Mandi 1") && s.includes("sumur resapan"))).toBe(true)
    })

    it("does not flag a room that avoids the soakwell", () => {
      const rooms = [
        { id: "a", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 0, y: 0, width: 2, depth: 2, areaM2: 4 },
      ]
      const violations = findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }, sanitation, floors)
      expect(violations).toEqual([])
    })

    it("does NOT reject a soakwell under a taman (open ground — exactly where it belongs)", () => {
      const rooms = [
        { id: "a", name: "Taman Belakang", type: "taman", floorId: "f1", x: 4, y: 4, width: 3, depth: 3, areaM2: 9 },
      ]
      const violations = findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }, sanitation, floors)
      expect(violations).toEqual([])
    })

    it("does NOT reject septic tank / control boxes under rooms (editor warning/info, not a hard violation)", () => {
      // On a fully-built lot the septic may already sit under a room the
      // assistant cannot move — rejecting every proposal for that would make
      // the assistant permanently unable to help (the reported 3-attempt
      // failure). Only the soakwell (danger) hard-fails.
      const tightSanitation = {
        septicTank: { id: "sp1", x: 5, y: 5, widthM: 1, lengthM: 2, depthM: 1.8 },
        controlBoxes: [{ id: "b1", x: 2, y: 2, widthM: 0.4, lengthM: 0.4, depthM: 0.5 }],
      }
      const rooms = [
        { id: "a", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 10, depth: 10, areaM2: 100 },
      ]
      const violations = findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }, tightSanitation, floors)
      expect(violations).toEqual([])
    })

    it("does not flag an upper-floor room at the same (x,y) as ground-level sanitation", () => {
      const upperFloors = [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ]
      const rooms = [
        { id: "a", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f2", x: 4.85, y: 4, width: 3.15, depth: 1.61, areaM2: 5.1 },
      ]
      const violations = findFloorplanViolations(rooms, { widthM: 10, depthM: 10 }, sanitation, upperFloors)
      expect(violations).toEqual([])
    })

    it("is a no-op when sanitation/floors aren't supplied (backward compatible)", () => {
      const rooms = [
        { id: "a", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.85, y: 4, width: 3.15, depth: 1.61, areaM2: 5.1 },
      ]
      expect(findFloorplanViolations(rooms, { widthM: 10, depthM: 10 })).toEqual([])
    })
  })
})

describe("floorplan proposal feedback", () => {
  it("rejects a proposal that creates a new small-room warning", () => {
    const feedback = findFloorplanActionFeedback(
      fpScene,
      [{ type: "updateRoom", roomId: "r1", patch: { width: 1.5, depth: 2 } }],
      "rapikan kamar tidur"
    )

    expect(feedback.some((item) => item.includes("peringatan baru") && item.includes("cukup kecil"))).toBe(true)
  })

  it("requires a mentioned warning to be resolved", () => {
    const scene: FloorplanScene = {
      ...fpScene,
      selectedRoomId: "r1",
      rooms: [
        { ...fpScene.rooms[0], width: 1.8, depth: 1.4, areaM2: 2.52 },
      ],
    }

    expect(summarizeFloorplanIssues(scene).some((issue) => issue.id === "small:r1")).toBe(true)
    const feedback = findFloorplanActionFeedback(
      scene,
      [{ type: "updateRoom", roomId: "r1", patch: { x: 1 } }],
      "Aksi yang saya inginkan: bantu perbaiki peringatan ini dengan perubahan denah yang aman. Peringatan: Kamar Tidur cukup kecil (2.52 m²)."
    )

    expect(feedback.some((item) => item.includes("peringatan belum terselesaikan"))).toBe(true)
  })

  it("accepts a proposal that resolves the mentioned small-room warning", () => {
    const scene: FloorplanScene = {
      ...fpScene,
      selectedRoomId: "r1",
      rooms: [
        { ...fpScene.rooms[0], width: 1.8, depth: 1.4, areaM2: 2.52 },
      ],
    }

    const feedback = findFloorplanActionFeedback(
      scene,
      [{ type: "updateRoom", roomId: "r1", patch: { width: 2, depth: 2 } }],
      "Peringatan: Kamar Tidur cukup kecil (2.52 m²). bantu perbaiki peringatan ini"
    )

    expect(feedback).toEqual([])
  })
})

describe("simulateSanitation", () => {
  const sceneWithSanitation: FloorplanScene = {
    ...fpScene,
    sanitation: {
      septicTank: { id: "sp1", x: 2, y: 2, widthM: 1, lengthM: 2, depthM: 1.8 },
      soakwell: { id: "sw1", x: 8, y: 2, widthM: 1.4, lengthM: 1.4, depthM: 2 },
      controlBoxes: [{ id: "cb1", x: 5, y: 2, widthM: 0.4, lengthM: 0.4, depthM: 0.5 }],
    },
  }

  it("applies a moveSanitationObject to the matching object and leaves the rest untouched", () => {
    const result = simulateSanitation(
      [{ type: "moveSanitationObject", kind: "soakwell", x: 9, y: 9 }],
      sceneWithSanitation
    )
    expect(result?.soakwell).toMatchObject({ id: "sw1", x: 9, y: 9 })
    expect(result?.septicTank).toEqual(sceneWithSanitation.sanitation!.septicTank)
  })

  it("applies a moveSanitationObject to a control box by ref index", () => {
    const result = simulateSanitation(
      [{ type: "moveSanitationObject", kind: "controlBox", ref: 0, x: 1, y: 1 }],
      sceneWithSanitation
    )
    expect(result?.controlBoxes?.[0]).toMatchObject({ id: "cb1", x: 1, y: 1 })
  })

  it("ignores non-sanitation actions and returns the sanitation bag unchanged", () => {
    const result = simulateSanitation(
      [{ type: "updateRoom", roomId: "r1", patch: { x: 1 } }],
      sceneWithSanitation
    )
    expect(result).toEqual(sceneWithSanitation.sanitation)
  })

  it("returns undefined when the scene has no sanitation bag", () => {
    expect(simulateSanitation([], fpScene)).toBeUndefined()
  })

  it("does not mutate the original scene", () => {
    const before = JSON.stringify(sceneWithSanitation.sanitation)
    simulateSanitation([{ type: "moveSanitationObject", kind: "soakwell", x: 9, y: 9 }], sceneWithSanitation)
    expect(JSON.stringify(sceneWithSanitation.sanitation)).toBe(before)
  })
})

import { buildContextFromMessages } from "./editor-assistant"
import type { AssistantMessage } from "@/lib/assistant/actions"

const msg = (over: Partial<AssistantMessage>): AssistantMessage => ({
  id: "m", projectId: "p", mode: "floorplan", role: "user",
  content: "hai", createdAt: "2026-06-29T00:00:00Z", ...over,
})

/* ----- Fasad, atap miring/fascia, lampu eksterior, rooftop (paritas editor 2026-07) ----- */

const fpSceneFacade: FloorplanScene = {
  ...fpScene,
  openings: [
    { id: "op1", roomId: "r1", side: "n", type: "window", positionM: 1, kind: "sliding_window", widthM: 1.2, heightM: 1.2 },
  ],
  roof: { type: "miring", slopeDeg: 12, overhangM: 0.5, material: "metal", lowSide: "s" },
  facadeElements: [
    { id: "fe1", wallId: "r1:n", positionM: 1.5, widthM: 2.8, sillHeightM: 0.3, heightM: 2.2, finish: "kayu" },
  ],
  exteriorLamps: [{ id: "lamp1", kind: "wall", x: 1, y: 0, mountH: 2, side: "n" }],
}

describe("sanitizeActions (floorplan setRoof — miring/lowSide/fascia)", () => {
  it("allows a 5° skillion slope when the patch sets type miring", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { type: "miring", slopeDeg: 5 } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "setRoof") expect(out[0].patch.slopeDeg).toBe(5)
  })

  it("clamps a too-shallow skillion slope up to 5°", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { type: "miring", slopeDeg: 2 } }],
      fpScene
    ) as FloorplanAction[]
    if (out[0].type === "setRoof") expect(out[0].patch.slopeDeg).toBe(5)
  })

  it("keeps a shallow slope when the CURRENT scene roof is already miring", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { slopeDeg: 8 } }],
      fpSceneFacade
    ) as FloorplanAction[]
    if (out[0].type === "setRoof") expect(out[0].patch.slopeDeg).toBe(8)
  })

  it("still clamps to 15° minimum for non-skillion roofs", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "setRoof", patch: { type: "pelana", slopeDeg: 8 } }],
      fpScene
    ) as FloorplanAction[]
    if (out[0].type === "setRoof") expect(out[0].patch.slopeDeg).toBe(15)
  })

  it("keeps lowSide for a miring roof and drops it for other types", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setRoof", patch: { type: "miring", lowSide: "w" } },
        { type: "setRoof", patch: { type: "pelana", lowSide: "w" } },
        { type: "setRoof", patch: { lowSide: "e" } }, // scene roof miring → kept
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(3)
    if (out[0].type === "setRoof") expect(out[0].patch.lowSide).toBe("w")
    if (out[1].type === "setRoof") expect(out[1].patch.lowSide).toBeUndefined()
    if (out[2].type === "setRoof") expect(out[2].patch.lowSide).toBe("e")
  })

  it("accepts a valid fascia, accepts fascia:null (matikan lis), rejects wild values via zod", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setRoof", patch: { fascia: { heightM: 0.35, color: "#2b2b2b" } } },
        { type: "setRoof", patch: { fascia: null } },
        { type: "setRoof", patch: { fascia: { heightM: 50, color: "#2b2b2b" } } }, // out of 0.1-0.8 → dropped
        { type: "setRoof", patch: { fascia: { heightM: 0.3, color: "hitam" } } }, // not hex → dropped
      ],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    if (out[0].type === "setRoof") expect(out[0].patch.fascia).toEqual({ heightM: 0.35, color: "#2b2b2b" })
    if (out[1].type === "setRoof") expect(out[1].patch.fascia).toBeNull()
  })
})

describe("sanitizeActions (floorplan updateRoom — railing & tangga)", () => {
  it("keeps railingStyle/stairDirection and a null railingModelUrl (lepas GLB)", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateRoom", roomId: "r1", patch: { railingStyle: "kaca", stairDirection: "e", railingModelUrl: null } }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateRoom") {
      expect(out[0].patch.railingStyle).toBe("kaca")
      expect(out[0].patch.stairDirection).toBe("e")
      expect(out[0].patch.railingModelUrl).toBeNull()
    }
  })

  it("drops invalid railingStyle/stairDirection enums via zod", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateRoom", roomId: "r1", patch: { railingStyle: "emas" } },
        { type: "updateRoom", roomId: "r1", patch: { stairDirection: "atas" } },
      ],
      fpScene
    )
    expect(out).toHaveLength(0)
  })
})

describe("sanitizeActions (floorplan updateOpening — kind/frameColor/model/sill)", () => {
  it("keeps kind and strips a conflicting openingType (kind wins)", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "updateOpening", openingId: "op1", patch: { kind: "garage_door", openingType: "window" } }],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateOpening") {
      expect(out[0].patch.kind).toBe("garage_door")
      expect(out[0].patch.openingType).toBeUndefined()
    }
  })

  it("clamps sillHeightM/headHeightM and keeps frameColor + modelUrl:null", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        {
          type: "updateOpening",
          openingId: "op1",
          patch: { sillHeightM: 9, headHeightM: 9, frameColor: "#3c4245", modelUrl: null },
        },
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateOpening") {
      expect(out[0].patch.sillHeightM).toBe(3)
      expect(out[0].patch.headHeightM).toBe(4)
      expect(out[0].patch.frameColor).toBe("#3c4245")
      expect(out[0].patch.modelUrl).toBeNull()
    }
  })

  it("drops invalid kind/frameColor via zod and drops an emptied patch", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateOpening", openingId: "op1", patch: { kind: "portal_ajaib" } },
        { type: "updateOpening", openingId: "op1", patch: { frameColor: "merah" } },
        { type: "updateOpening", openingId: "op1", patch: {} },
      ],
      fpSceneFacade
    )
    expect(out).toHaveLength(0)
  })
})

describe("sanitizeActions (floorplan addOpening dengan kind)", () => {
  it("derives openingType from the kind meta when they conflict (garage_door → door)", () => {
    const out = sanitizeActions(
      "floorplan",
      [{ type: "addOpening", roomId: "r1", side: "n", positionM: 1, openingType: "window", kind: "garage_door" }],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "addOpening") {
      expect(out[0].kind).toBe("garage_door")
      expect(out[0].openingType).toBe("door")
    }
  })
})

describe("sanitizeActions (floorplan setWallCladding)", () => {
  it("keeps a valid cladding on an existing wall, incl. face inner and null (kembali polos)", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setWallCladding", wallId: "r1:e", claddingId: "bata_putih", face: "inner" },
        { type: "setWallCladding", wallId: "r1:n", claddingId: null },
      ],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    if (out[0].type === "setWallCladding") {
      expect(out[0].claddingId).toBe("bata_putih")
      expect(out[0].face).toBe("inner")
    }
    if (out[1].type === "setWallCladding") expect(out[1].claddingId).toBeNull()
  })

  it("drops ghost rooms, malformed wall ids, and non-catalog cladding ids", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setWallCladding", wallId: "ghost:n", claddingId: "bata_putih" }, // ghost room
        { type: "setWallCladding", wallId: "r1:x", claddingId: "bata_putih" }, // bad side
        { type: "setWallCladding", wallId: "r1:n", claddingId: "emas_murni" }, // not in catalog → zod
      ],
      fpScene
    )
    expect(out).toHaveLength(0)
  })
})

describe("sanitizeActions (floorplan louver band)", () => {
  it("validates the host wall for addFacadeElement", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "addFacadeElement", wallId: "r1:s" },
        { type: "addFacadeElement", wallId: "ghost:n" }, // dropped
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("addFacadeElement")
  })

  it("updateFacadeElement clamps width/position to the host wall and keeps finish", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateFacadeElement", id: "fe1", patch: { widthM: 99, positionM: 99, finish: "aluminium_gelap" } },
        { type: "updateFacadeElement", id: "ghost", patch: { widthM: 2 } }, // unknown id → dropped
        { type: "updateFacadeElement", id: "fe1", patch: { positionM: -1 } }, // negatif → zod drop
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateFacadeElement") {
      expect(out[0].patch.widthM).toBe(3) // clamped to the r1 north edge (width 3)
      expect(out[0].patch.positionM).toBe(3)
      expect(out[0].patch.finish).toBe("aluminium_gelap")
    }
  })

  it("removeFacadeElement validates the id", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "removeFacadeElement", id: "fe1" },
        { type: "removeFacadeElement", id: "ghost" },
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "removeFacadeElement") expect(out[0].id).toBe("fe1")
  })
})

describe("sanitizeActions (floorplan lampu eksterior)", () => {
  it("addWallLamp validates the host wall", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "addWallLamp", wallId: "r1:w" },
        { type: "addWallLamp", wallId: "ghost:n" }, // dropped
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("addWallLamp")
  })

  it("updateLamp validates the id against effective lamps and clamps intensity/watt/mountH", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "updateLamp", id: "lamp1", patch: { intensity: 5, watt: 500, mountH: 9, color: "#ffc98a" } },
        { type: "updateLamp", id: "ghost", patch: { watt: 7 } }, // unknown id → dropped
        { type: "updateLamp", id: "lamp1", patch: { color: "kuning" } }, // not hex → zod drop
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "updateLamp") {
      expect(out[0].patch.intensity).toBe(2)
      expect(out[0].patch.watt).toBe(100)
      expect(out[0].patch.mountH).toBe(4)
      expect(out[0].patch.color).toBe("#ffc98a")
    }
  })

  it("removeLamp validates the id", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "removeLamp", id: "lamp1" },
        { type: "removeLamp", id: "ghost" },
      ],
      fpSceneFacade
    ) as FloorplanAction[]
    expect(out).toHaveLength(1)
    if (out[0].type === "removeLamp") expect(out[0].id).toBe("lamp1")
  })
})

describe("sanitizeActions (floorplan exterior semantic elements)", () => {
  const scene: FloorplanScene = {
    ...fpSceneFacade,
    exteriorElements: [
      {
        id: "portal-1",
        kind: "portal_frame",
        x: 4,
        y: 1,
        widthM: 5,
        heightM: 3,
        memberSizeM: 0.3,
      },
    ],
  }

  it("clamps add geometry to the site and drops degenerate segments", () => {
    const out = sanitizeActions("floorplan", [
      {
        type: "addExteriorElement",
        element: {
          kind: "facade_panel",
          x: 99,
          y: -2,
          widthM: 99,
          depthM: 0.2,
          heightM: 7,
        },
      },
      {
        type: "addExteriorElement",
        element: {
          kind: "fence",
          start: { x: 1, y: 1 },
          end: { x: 1.05, y: 1 },
          heightM: 2,
        },
      },
    ], scene) as FloorplanAction[]

    expect(out).toHaveLength(1)
    if (out[0].type === "addExteriorElement" && "x" in out[0].element) {
      expect(out[0].element.x).toBe(10)
      expect(out[0].element.y).toBe(0)
      expect(out[0].element.widthM).toBe(10)
    }
  })

  it("rejects self-intersecting polygons and ghost update/remove ids", () => {
    const out = sanitizeActions("floorplan", [
      {
        type: "addExteriorElement",
        element: {
          kind: "driveway",
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 3 },
            { x: 0, y: 3 },
            { x: 3, y: 0 },
          ],
        },
      },
      { type: "updateExteriorElement", id: "ghost", patch: { widthM: 2 } },
      { type: "removeExteriorElement", id: "ghost" },
      { type: "removeExteriorElement", id: "portal-1" },
    ], scene) as FloorplanAction[]

    expect(out).toEqual([{ type: "removeExteriorElement", id: "portal-1" }])
  })

  it("drops fields that do not belong to the existing discriminator", () => {
    const out = sanitizeActions("floorplan", [
      {
        type: "updateExteriorElement",
        id: "portal-1",
        patch: {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      },
    ], scene)

    expect(out).toEqual([])
  })
})

describe("sanitizeActions (floorplan setRooftop)", () => {
  it("passes both enable and disable through", () => {
    const out = sanitizeActions(
      "floorplan",
      [
        { type: "setRooftop", enabled: true },
        { type: "setRooftop", enabled: false },
        { type: "setRooftop", enabled: "ya" }, // non-boolean → zod drop
      ],
      fpScene
    ) as FloorplanAction[]
    expect(out).toHaveLength(2)
    if (out[0].type === "setRooftop") expect(out[0].enabled).toBe(true)
    if (out[1].type === "setRooftop") expect(out[1].enabled).toBe(false)
  })
})

describe("sanitizeActions (interior updateLight watt)", () => {
  const scene: InteriorScene = {
    style: "modern_tropical",
    selectedRoomId: "r1",
    rooms: [
      {
        roomId: "r1", name: "Kamar", type: "kamar_tidur", widthM: 4, depthM: 3, furniture: [],
        lighting: [
          { id: "l1", roomId: "r1", type: "downlight", x: 2, y: 1.5, heightM: 2.8, colorTemperature: "warm", qty: 2, watt: 9 },
        ],
      },
    ],
  }

  it("keeps a sane watt and clamps an excessive one to 200", () => {
    const out = sanitizeActions(
      "interior",
      [
        { type: "updateLight", roomId: "r1", lightId: "l1", patch: { watt: 12 } },
        { type: "updateLight", roomId: "r1", lightId: "l1", patch: { watt: 5000 } },
      ],
      scene
    ) as InteriorAction[]
    expect(out).toHaveLength(2)
    if (out[0].type === "updateLight") expect(out[0].patch.watt).toBe(12)
    if (out[1].type === "updateLight") expect(out[1].patch.watt).toBe(200)
  })

  it("drops a non-positive watt via zod", () => {
    const out = sanitizeActions(
      "interior",
      [{ type: "updateLight", roomId: "r1", lightId: "l1", patch: { watt: -5 } }],
      scene
    )
    expect(out).toHaveLength(0)
  })
})

describe("describeAction (fasad & atap baru)", () => {
  it("describes a skillion + fascia-off roof patch", () => {
    expect(
      describeAction({ type: "setRoof", patch: { type: "miring", lowSide: "s", fascia: null } }, fpScene)
    ).toBe("Ubah atap → miring sisi rendah bawah lis fascia dimatikan")
  })

  it("describes fascia-on with its height", () => {
    expect(
      describeAction({ type: "setRoof", patch: { fascia: { heightM: 0.4, color: "#222222" } } }, fpScene)
    ).toBe("Ubah atap → lis fascia 0.4 m")
  })

  it("describes wall cladding with the catalog label and the room name", () => {
    expect(
      describeAction({ type: "setWallCladding", wallId: "r1:n", claddingId: "bata_putih" }, fpScene)
    ).toBe("Cladding Bata putih di dinding Kamar Tidur sisi atas")
    expect(
      describeAction({ type: "setWallCladding", wallId: "r1:e", claddingId: "batu_andesit", face: "inner" }, fpScene)
    ).toBe("Cladding Batu andesit di dinding Kamar Tidur sisi kanan (muka dalam)")
    expect(
      describeAction({ type: "setWallCladding", wallId: "r1:n", claddingId: null }, fpScene)
    ).toBe("Hapus cladding dinding Kamar Tidur sisi atas")
  })

  it("describes louver band + exterior lamp actions", () => {
    expect(describeAction({ type: "addFacadeElement", wallId: "r1:n" }, fpScene)).toBe(
      "Tambah louver band di dinding Kamar Tidur sisi atas"
    )
    expect(
      describeAction({ type: "updateFacadeElement", id: "fe1", patch: { finish: "putih" } }, fpSceneFacade)
    ).toBe("Ubah louver band: finish → putih")
    expect(describeAction({ type: "removeFacadeElement", id: "fe1" }, fpSceneFacade)).toBe("Hapus louver band")
    expect(describeAction({ type: "addWallLamp", wallId: "r1:w" }, fpScene)).toBe(
      "Tambah lampu dinding eksterior di Kamar Tidur sisi kiri"
    )
    expect(
      describeAction({ type: "updateLamp", id: "lamp1", patch: { color: "#ffc98a", watt: 9 } }, fpSceneFacade)
    ).toBe("Ubah lampu eksterior: warna #ffc98a, 9 W")
    expect(describeAction({ type: "removeLamp", id: "lamp1" }, fpSceneFacade)).toBe("Hapus lampu eksterior")
  })

  it("describes setRooftop, garage-door openings, and railing patches", () => {
    expect(describeAction({ type: "setRooftop", enabled: true }, fpScene)).toBe("Aktifkan lantai rooftop (dak)")
    expect(describeAction({ type: "setRooftop", enabled: false }, fpScene)).toBe("Hapus lantai rooftop")
    expect(
      describeAction(
        { type: "addOpening", roomId: "r1", side: "n", positionM: 1, openingType: "door", kind: "garage_door" },
        fpScene
      )
    ).toBe("Tambah Pintu garasi (sectional) di Kamar Tidur")
    expect(
      describeAction(
        { type: "updateOpening", openingId: "op1", patch: { kind: "garage_door", frameColor: "#3c4245" } },
        fpSceneFacade
      )
    ).toBe("Ubah bukaan (pintu/jendela): jenis → Pintu garasi (sectional), kusen #3c4245")
    expect(
      describeAction(
        { type: "updateRoom", roomId: "r1", patch: { railingStyle: "kaca", railingModelUrl: null } },
        fpScene
      )
    ).toBe("Ubah Kamar Tidur: railing → kaca, lepas model railing")
  })
})

describe("buildMessages (fasad, atap miring, lampu, rooftop, SIKAP)", () => {
  it("floorplan prompt documents the new facade/roof/lamp/rooftop actions + catalogs", () => {
    const msgs = buildMessages("floorplan", fpSceneFacade, "pasang cladding batu", [])
    const system = msgs[0].content
    expect(system).toContain("setWallCladding")
    expect(system).toContain("addFacadeElement")
    expect(system).toContain("addWallLamp")
    expect(system).toContain("updateLamp")
    expect(system).toContain('"setRooftop"')
    expect(system).toContain("miring")
    expect(system).toContain("lowSide")
    expect(system).toContain("fascia:null")
    expect(system).toContain("garage_door")
    expect(system).toContain("batu_alam_gelap") // cladding catalog injected
    expect(system).toContain("railingStyle")
    expect(system).toContain("stairDirection")
  })

  it("floorplan sceneJSON now grounds water points, roof, facade & lamps", () => {
    const scene: FloorplanScene = {
      ...fpSceneFacade,
      water: [{ id: "w9", type: "kloset", roomId: "r1", x: 1, y: 1 }],
      facade: { "r1:n": "bata_putih" },
    }
    const system = buildMessages("floorplan", scene, "cek", [])[0].content
    expect(system).toContain('"w9"') // water ids finally reach the model (audit C2)
    expect(system).toContain('"miring"') // roof state grounded
    expect(system).toContain('"lamp1"') // effective exterior lamps grounded
    expect(system).toContain('"fe1"') // louver band ids grounded
    expect(system).toContain('"bata_putih"') // current cladding map grounded
    expect(system).toContain("rooftopEnabled")
  })

  it("both prompts carry the SIKAP rules (akui-salah sekali + perbaiki, jangan klaim sudah berubah)", () => {
    const fp = buildMessages("floorplan", fpScene, "halo", [])[0].content
    const int = buildMessages("interior", intScene, "halo", [])[0].content
    for (const sys of [fp, int]) {
      expect(sys).toContain("SIKAP:")
      expect(sys).toContain("JANGAN meminta maaf berulang-ulang")
      expect(sys).toContain("actions korektif")
      expect(sys).toContain("Jangan mengklaim sudah mengubah")
    }
  })

  it("interior prompt documents updateLight.watt", () => {
    const system = buildMessages("interior", intScene, "ubah lampu", [])[0].content
    expect(system).toContain('"watt"?')
  })

  it("kedua mode menyuntikkan PENGETAHUAN DESAIN bila catatan diberikan", () => {
    const note = "• Kamar tidur utama (room)\n  - layout_principles: posisi tempat tidur tidak langsung menghadap pintu"
    for (const mode of ["floorplan", "interior"] as const) {
      const scene = mode === "floorplan" ? fpScene : intScene
      const system = buildMessages(mode, scene, "rapikan", [], note)[0].content
      expect(system).toContain("PENGETAHUAN DESAIN")
      expect(system).toContain("tidak langsung menghadap pintu")
      // pagar anti-karangan ikut terbawa
      expect(system).toContain("jangan mengarang prinsip di luar ini")
    }
  })

  it("tanpa catatan, prompt kedua mode persis seperti sebelumnya (backward compatible)", () => {
    for (const mode of ["floorplan", "interior"] as const) {
      const scene = mode === "floorplan" ? fpScene : intScene
      expect(buildMessages(mode, scene, "rapikan", [])[0].content).not.toContain("PENGETAHUAN DESAIN")
    }
  })
})

describe("buildContextFromMessages", () => {
  it("maps role+content and annotates applied tool calls", () => {
    const turns = buildContextFromMessages([
      msg({ role: "user", content: "tambah jendela" }),
      msg({ role: "assistant", content: "Oke", status: "applied", actionLabels: ["Tambah jendela di Ruang Tamu"] }),
      msg({ role: "assistant", content: "Usulan", status: "proposed", actionLabels: ["X"] }),
    ])
    expect(turns[0]).toEqual({ role: "user", content: "tambah jendela" })
    expect(turns[1].content).toContain("[diterapkan: Tambah jendela di Ruang Tamu]")
    expect(turns[2].content).toBe("Usulan") // not applied → no annotation
  })

  it("trims to the last maxTurns", () => {
    const many = Array.from({ length: 30 }, (_, i) => msg({ content: `t${i}` }))
    expect(buildContextFromMessages(many, 16)).toHaveLength(16)
  })
})

const overlapScene: FloorplanScene = {
  site: { widthM: 10, depthM: 10 },
  floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
  selectedFloorId: "f1",
  selectedRoomId: null,
  rooms: [
    { id: "void1", name: "Void", type: "void", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
    { id: "kt", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f1", x: 5, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
  ],
  openings: [],
}

describe("reconcileFloorplanOverlaps", () => {
  it("merges a deterministic fix into the action list and clears the violation", () => {
    // Proposal moves void1 so its right edge lands 1m into kt (void1 becomes
    // 2..6, kt stays 5..9 → 1m x-axis overlap) — resolvable by shrinking
    // void1 (no standard, unlimited slack).
    const overlapping: FloorplanAction[] = [
      { type: "updateRoom", roomId: "void1", patch: { x: 2 } },
    ]

    const result = reconcileFloorplanOverlaps(overlapScene, overlapping, "geser void")

    expect(result.remainingViolations).toEqual([])
    // Original proposal action is preserved, plus a corrective patch for void1.
    expect(result.actions).toContainEqual({ type: "updateRoom", roomId: "void1", patch: { x: 2 } })
    const corrective = result.actions.filter(
      (a) => a.type === "updateRoom" && a.roomId === "void1" && "width" in (a.patch ?? {}),
    )
    expect(corrective.length).toBe(1)
  })

  it("returns the original violations untouched when the overlap is too large to reconcile", () => {
    const bigOverlap: FloorplanAction[] = [
      { type: "updateRoom", roomId: "kt", patch: { x: 0 } }, // kt 0..4 vs void1 0..4 → fully overlapping, both same standard-less/standard
    ]
    const result = reconcileFloorplanOverlaps(overlapScene, bigOverlap, "tumpuk penuh")

    expect(result.remainingViolations.length).toBeGreaterThan(0)
    expect(result.remainingViolations[0]).toContain("tumpang-tindih")
  })

  it("does not falsely certify success when the reconciler's fix targets a synthetic addRoom id", () => {
    // The proposal adds a new "void" room (id will be synthetic "new-2",
    // simulateFloorplanActions's `new-${rooms.length}` scheme) that overlaps
    // "kt" (kamar_tidur, x5-9,y0-4) by 0.5m on the y-axis — small enough for
    // the reconciler to "fix" by shrinking the synthetic room (it has no
    // ROOM_STANDARDS, so it sorts first as the preferred mover). That fix is
    // a real, geometrically-valid patch — but it targets "new-2", an id that
    // exists ONLY inside this simulation, never in the real scene.rooms (the
    // real client assigns a random id on addRoom). Once sanitizeActions runs
    // the merged list against the REAL scene, that patch must be dropped —
    // so re-validation correctly still finds the original, unfixed overlap
    // instead of falsely reporting the layout as clean.
    const addRoomOverlap: FloorplanAction[] = [
      { type: "addRoom", roomType: "void", x: 5, y: 3.5, width: 4, depth: 6 },
    ]

    const result = reconcileFloorplanOverlaps(overlapScene, addRoomOverlap, "tambah void")

    expect(result.remainingViolations.length).toBeGreaterThan(0)
    // No corrective patch should remain targeting the synthetic-only id.
    expect(
      result.actions.some((a) => a.type === "updateRoom" && a.roomId === "new-2"),
    ).toBe(false)
  })
})

describe("humanizeViolations", () => {
  it("strips x/y coordinate parentheticals but keeps room names and surrounding text", () => {
    const content = humanizeViolations([
      '"Kamar Mandi 1" (x:4.85, y:9.17, 2.87×2.55m) & "Workspace" (x:3.28, y:6.55, 4.44×3.42m) tumpang-tindih',
    ])
    expect(content).not.toContain("x:4.85")
    expect(content).not.toContain("y:9.17")
    const parsed = JSON.parse(content)
    expect(parsed.reply).toContain("Kamar Mandi 1")
    expect(parsed.reply).toContain("Workspace")
    expect(parsed.reply).toContain("tumpang-tindih")
  })

  it("offers room names as needs_clarify suggestion chips", () => {
    const content = humanizeViolations([
      '"Kamar Mandi 1" (x:4.85, y:9.17, 2.87×2.55m) & "Workspace" (x:3.28, y:6.55, 4.44×3.42m) tumpang-tindih',
    ])
    const parsed = JSON.parse(content)
    expect(parsed.needs_clarify[0].suggestions).toEqual(["Kamar Mandi 1", "Workspace"])
  })

  it("keeps non-coordinate context verbatim (sanitation-overlap messages have no parens)", () => {
    const content = humanizeViolations(['"Kamar Mandi 1" bertumpuk dengan sumur resapan'])
    expect(content).toContain("belum berhasil")
    expect(content).toContain("sumur resapan")
  })

  it("falls back to plain text (no clarify chips) when no room name is quotable", () => {
    const content = humanizeViolations(["ruang tidak cukup untuk sirkulasi"])
    expect(content).toContain("belum berhasil")
    expect(() => JSON.parse(content)).toThrow()
  })

  it("never leaks raw x/y coordinates even when driven by real findFloorplanViolations output", () => {
    // Two genuinely overlapping rooms (adapted from overlapScene's fixture
    // shape) — drive the humanizer from the ACTUAL violation-string
    // generator instead of a hand-written string, so a future change to
    // findFloorplanViolations's message format that reintroduces a
    // coordinate leak would be caught here.
    const overlappingRooms = [
      { id: "void1", name: "Void", type: "void", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
      { id: "kt", name: "Kamar Tidur", type: "kamar_tidur", floorId: "f1", x: 2, y: 2, width: 4, depth: 4, areaM2: 16, locked: false },
    ]
    const violations = findFloorplanViolations(overlappingRooms, overlapScene.site, undefined, overlapScene.floors)
    expect(violations.length).toBeGreaterThan(0) // sanity: the fixture really does overlap

    const result = humanizeViolations(violations)

    expect(result).not.toMatch(/\b[xy]:/)
  })
})
