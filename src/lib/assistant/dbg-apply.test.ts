// @vitest-environment node
import { it, expect } from "vitest"
import { buildInitialFloorplan } from "@/lib/server/initial-floorplan"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import { simulateFloorplanActions } from "@/lib/server/editor-assistant"
import type { FloorplanAction } from "@/lib/assistant/actions"

type LooseProject = Parameters<typeof buildInitialFloorplan>[2]
type LooseBrief = Parameters<typeof buildInitialFloorplan>[3]
type LooseScene = Parameters<typeof handleFloorplanInstruction>[1]

// Fixtures duck-typed pada bidang yang dibutuhkan buildInitialFloorplan saja
// (bukan Project/Brief/FloorplanScene lengkap) — diagnostik konsol saja,
// lihat expect() di bawah.
const project = { id: "proj-modern-tropis-1", name: "R", floors: 1, rooftop: false, site: { widthM: 12, depthM: 18, areaM2: 216 } } as unknown as LooseProject
const brief = { projectId: "p", spaceProgram: [
  { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1 },
  { id: "sp-2", roomType: "ruang_tamu", name: "Ruang Tamu", required: true, quantity: 1 },
  { id: "sp-3", roomType: "ruang_keluarga", name: "Ruang Keluarga", required: true, quantity: 1 },
  { id: "sp-4", roomType: "dapur", name: "Dapur", required: true, quantity: 1 },
  { id: "sp-5", roomType: "ruang_makan", name: "Ruang Makan", required: true, quantity: 1 },
  { id: "sp-6", roomType: "kamar_tidur", name: "Kamar tidur 1", required: true, quantity: 1 },
  { id: "sp-7", roomType: "kamar_tidur", name: "Kamar tidur 2", required: true, quantity: 1 },
  { id: "sp-8", roomType: "kamar_tidur", name: "Kamar tidur 3", required: true, quantity: 1 },
  { id: "sp-9", roomType: "kamar_mandi", name: "Kamar mandi 1", required: true, quantity: 1 },
  { id: "sp-10", roomType: "kamar_mandi", name: "Kamar mandi 2", required: true, quantity: 1 },
  { id: "sp-11", roomType: "laundry", name: "Laundry", required: true, quantity: 1 },
  { id: "sp-12", roomType: "taman", name: "Taman Depan", required: true, quantity: 1 },
] } as unknown as LooseBrief
const EMPTY = { site: { widthM: 12, depthM: 18 }, floors: [], selectedFloorId: null, selectedRoomId: null, rooms: [], openings: [] } as unknown as LooseScene

it("diagnose fix-family matched", () => {
  const build = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", EMPTY, project, brief)
  const rooms = simulateFloorplanActions(build.actions, EMPTY)
  let seq = 0
  const openings = build.actions
    .filter((a): a is Extract<FloorplanAction, { type: "addOpening" }> => a.type === "addOpening")
    .map((a) => ({ id: `op-${seq++}`, roomId: a.roomId, side: a.side, type: a.openingType, positionM: a.positionM }))
  const floors = [...new Set(rooms.map((r) => r.floorId))].map((id) => {
    const lv = Number(/^floor-(\d+)$/.exec(id)?.[1] ?? 1)
    return { id, name: `Lantai ${lv}`, level: lv }
  })
  const scene = { ...EMPTY, floors, selectedFloorId: floors[0]?.id ?? null, rooms, openings } as unknown as LooseScene
  const asks = [
    "perbaiki semua yang bermasalah sesuai standar",
    "ruang tamu kurang cahaya, tambahkan jendela",
    "kamar mandi 1 terlalu sempit",
    "rumahnya dari depan ke belakang harus bisa dilewati, perbaiki akses",
    "ruang keluarga dan dapur alirannya kurang, bukakan dinding di antaranya",
    "Hapus ruang Carport",
    "tambahkan kamar mandi di lantai 1",
    "Tambahkan jendela di ruang makan",
  ]
  for (const k of asks) {
    const res = handleFloorplanInstruction(k, scene)
    console.log(`${res.matched ? "MATCH" : "escalate"} | ${k} | actions=${res.actions ? res.actions.length : 0}`)
  }
  expect(true).toBe(true)
})
