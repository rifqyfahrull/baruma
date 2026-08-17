import { describe, it, expect } from "vitest"
import { buildModel } from "./build-model"
import type { DesignLayout, Project } from "@/types"
import qyfa from "./__fixtures__/rumah-qyfa-layout.json"

// Regresi z-fighting pada layout DUNIA-NYATA (prod "Rumah Qyfa"): denah gambar
// tangan dengan gap 5–6 cm antar ruang + inflasi ujung dinding `+t`
// menghasilkan ratusan pasang bidang koplanar yang tumpang-tindih (probe
// 2026-07-11: 244 pasang). Dua box z-fight ketika muka ber-NORMAL SAMA berada
// di bidang yang sama (min–min / max–max per sumbu) DAN persegi mukanya
// beririsan. assignDepthRanks harus memberi depthRank BERBEDA pada setiap
// pasangan seperti itu — renderer memetakan rank → glPolygonOffset.

type Box = { min: number[]; max: number[] }

const PLANE_EPS = 0.003
const MIN_OVERLAP = 0.005

const overlap1D = (a: Box, b: Box, axis: number) =>
  Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis])

describe("buildModel — depth ranks memutus semua seri koplanar (Rumah Qyfa prod)", () => {
  it("every coplanar overlapping same-normal face pair gets distinct depthRank", () => {
    const layout = qyfa as unknown as DesignLayout
    const project = { rooftop: false, name: "Rumah Qyfa" } as unknown as Project
    const { prims } = buildModel(layout, { widthM: 8, depthM: 8 }, project, {
      exploded: false,
      showRoof: true,
      showFurniture: false,
    })

    const boxes: Box[] = prims.map((p) => ({
      min: p.pos.map((c, i) => c - p.args[i] / 2),
      max: p.pos.map((c, i) => c + p.args[i] / 2),
    }))

    let conflictPairs = 0
    const unresolved: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        for (let axis = 0; axis < 3; axis++) {
          const rest = [0, 1, 2].filter((x) => x !== axis)
          if (overlap1D(boxes[i], boxes[j], rest[0]) < MIN_OVERLAP) continue
          if (overlap1D(boxes[i], boxes[j], rest[1]) < MIN_OVERLAP) continue
          const coplanar =
            Math.abs(boxes[i].min[axis] - boxes[j].min[axis]) <= PLANE_EPS ||
            Math.abs(boxes[i].max[axis] - boxes[j].max[axis]) <= PLANE_EPS
          if (!coplanar) continue
          conflictPairs++
          if ((prims[i].depthRank ?? 0) === (prims[j].depthRank ?? 0)) {
            unresolved.push(`${prims[i].id} <-> ${prims[j].id} (axis ${"xyz"[axis]})`)
          }
          break
        }
      }
    }

    // Sanity: fixture ini MEMANG penuh konflik — kalau 0, detektornya rusak.
    expect(conflictPairs).toBeGreaterThan(50)
    expect(unresolved).toEqual([])
  })

  it("spatial bucketing tetap menyelesaikan SEMUA pasangan koplanar pada model besar sintetis (>300 prim, 2 lantai, tangga, split-level)", () => {
    // Sanity korektness utk optimasi assignDepthRanks (grid sel ~4 m): detektor
    // brute-force O(n²) di test ini adalah ground truth — setiap pasangan muka
    // se-normal yang koplanar & beririsan HARUS berbeda rank, termasuk pasangan
    // LINTAS LANTAI (puncak anak tangga rata dengan muka atas slab lantai 2).
    type Room = DesignLayout["rooms"][number]
    const rooms: Room[] = []
    for (const [fi, floorId] of (["f1", "f2"] as const).entries()) {
      for (let gx = 0; gx < 6; gx++) {
        for (let gy = 0; gy < 5; gy++) {
          if (fi === 0 && gx === 0 && gy === 0) continue // sel tangga
          rooms.push({
            id: `r-${floorId}-${gx}-${gy}`,
            floorId,
            name: "R",
            type: "kamar_tidur",
            x: gx * 3, y: gy * 3, width: 3, depth: 3, areaM2: 9,
            ...(fi === 0 && (gx + gy) % 3 === 0 ? { levelOffsetM: 0.18 } : {}),
          } as Room)
        }
      }
    }
    rooms.push({
      id: "tg", floorId: "f1", name: "Tangga", type: "tangga",
      x: 0, y: 0, width: 3, depth: 3, areaM2: 9, stairDirection: "s",
    } as Room)

    const layout = {
      id: "l", projectId: "p", versionId: "v",
      floors: [
        { id: "f1", level: 1, name: "Lantai 1", heightM: 2.95 },
        { id: "f2", level: 2, name: "Lantai 2", heightM: 2.95 },
      ],
      rooms,
      walls: [],
      openings: [
        { id: "o1", floorId: "f1", wallId: "r-f1-2-0:n", type: "window", positionM: 1.5, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
        { id: "o2", floorId: "f1", wallId: "r-f1-2-1:w", type: "door", positionM: 1.5, widthM: 0.9, heightM: 2.1 },
        { id: "o3", floorId: "f2", wallId: "r-f2-1-1:s", type: "window", positionM: 1.5, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
      ],
      stairs: [], pools: [],
      validation: { passed: true, issues: [] },
    } as unknown as DesignLayout
    const project = { rooftop: false, name: "Sintetis" } as unknown as Project

    const { prims } = buildModel(layout, { widthM: 18, depthM: 15 }, project, {
      exploded: false,
      showRoof: true,
      showFurniture: true,
    })
    expect(prims.length).toBeGreaterThan(300) // perf-sanity: kasus yang dulu O(n²) mahal

    const boxes: Box[] = prims.map((p) => ({
      min: p.pos.map((c, i) => c - p.args[i] / 2),
      max: p.pos.map((c, i) => c + p.args[i] / 2),
    }))
    let conflictPairs = 0
    // Pasangan LINTAS LANTAI (mis. muka ATAS dinding lantai-1 rata dengan muka
    // BAWAH slab lantai-2) — bucketing per-floorId akan melewatkannya; grid 3D
    // tidak boleh. Model harus punya ≥1 pasangan begini DAN semuanya teratasi.
    let crossFloorPairs = 0
    const unresolved: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        for (let axis = 0; axis < 3; axis++) {
          const rest = [0, 1, 2].filter((x) => x !== axis)
          if (overlap1D(boxes[i], boxes[j], rest[0]) < MIN_OVERLAP) continue
          if (overlap1D(boxes[i], boxes[j], rest[1]) < MIN_OVERLAP) continue
          const coplanar =
            Math.abs(boxes[i].min[axis] - boxes[j].min[axis]) <= PLANE_EPS ||
            Math.abs(boxes[i].max[axis] - boxes[j].max[axis]) <= PLANE_EPS
          if (!coplanar) continue
          conflictPairs++
          if (prims[i].floorId !== prims[j].floorId) crossFloorPairs++
          if ((prims[i].depthRank ?? 0) === (prims[j].depthRank ?? 0)) {
            unresolved.push(`${prims[i].id} <-> ${prims[j].id} (axis ${"xyz"[axis]})`)
          }
          break
        }
      }
    }
    expect(conflictPairs).toBeGreaterThan(100)
    expect(crossFloorPairs).toBeGreaterThan(0) // model benar-benar menguji resolusi lintas-lantai
    expect(unresolved).toEqual([])
  })

  it("prims without conflicts carry no depthRank (no gratuitous polygon offset)", () => {
    const layout = qyfa as unknown as DesignLayout
    const project = { rooftop: false, name: "Rumah Qyfa" } as unknown as Project
    const { prims } = buildModel(layout, { widthM: 8, depthM: 8 }, project, {
      exploded: false,
      showRoof: true,
      showFurniture: false,
    })
    // Klaster konflik kecil → rank tetap kecil; offset besar bisa salah-urut
    // permukaan yang benar-benar berjarak.
    for (const p of prims) expect(p.depthRank ?? 0).toBeLessThanOrEqual(8)
    expect(prims.some((p) => (p.depthRank ?? 0) === 0)).toBe(true)
  })
})
