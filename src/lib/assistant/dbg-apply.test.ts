// @vitest-environment node
import { it, expect } from "vitest"
import { buildInitialFloorplan } from "@/lib/server/initial-floorplan"
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic"
import { simulateFloorplanActions } from "@/lib/server/editor-assistant"

const project: any = { id: "proj-modern-tropis-1", name: "R", floors: 1, rooftop: false, site: { widthM: 12, depthM: 18, areaM2: 216 } }
const brief: any = { projectId: "p", spaceProgram: [
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
] }
const EMPTY: any = { site: { widthM: 12, depthM: 18 }, floors: [], selectedFloorId: null, selectedRoomId: null, rooms: [], openings: [] }

it("diagnose fix-family matched", () => {
  const build = buildInitialFloorplan("buatkan denah 2 lantai, sesuai brief", EMPTY, project, brief)
  const rooms = simulateFloorplanActions(build.actions, EMPTY)
  let seq = 0
  const openings = build.actions.filter((a:any)=>a.type==="addOpening").map((a:any)=>({ id:`op-${seq++}`, roomId:a.roomId, side:a.side, type:a.openingType, positionM:a.positionM }))
  const floors = [...new Set(rooms.map((r:any)=>r.floorId))].map((id:any)=>{ const lv=Number(/^floor-(\d+)$/.exec(id)?.[1] ?? 1); return { id, name:`Lantai ${lv}`, level:lv } })
  const scene: any = { ...EMPTY, floors, selectedFloorId: floors[0]?.id ?? null, rooms, openings }
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
