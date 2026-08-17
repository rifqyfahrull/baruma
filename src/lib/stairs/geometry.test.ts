import { describe, expect, it } from "vitest"

import { interiorStairSpec, INTERIOR_RISER_TARGET_M, stairComfortIssues, stairProfilePoints, interiorStairQuantities, interiorStairLayout, interiorStairQuantitiesFromLayout } from "./geometry"

describe("interiorStairSpec", () => {
  // Nilai HARUS identik dengan rumus lama build-model.ts:588-594:
  // dir = stairDirection ?? (w>=d ? "e" : "s"); steps = max(3, round(rise/0.18)).
  it("deriva default: sisi terpanjang jadi arah run, riser target 0.18", () => {
    const spec = interiorStairSpec({ width: 2.5, depth: 2.5 }, 3.15)
    expect(spec.dir).toBe("e") // w >= d → "e"
    expect(spec.horizontalRun).toBe(true)
    expect(spec.runLenM).toBe(2.5)
    expect(spec.widthM).toBe(2.5)
    expect(spec.steps).toBe(18) // round(3.15/0.18) = 17.5 → 18
    expect(spec.riserM).toBeCloseTo(3.15 / 18, 5)
    expect(spec.treadM).toBeCloseTo(2.5 / 18, 5)
  })

  it("menghormati stairDirection eksplisit dan menukar run/width", () => {
    const spec = interiorStairSpec({ width: 3, depth: 1.2, stairDirection: "n" }, 3.15)
    expect(spec.dir).toBe("n")
    expect(spec.horizontalRun).toBe(false)
    expect(spec.runLenM).toBe(1.2)
    expect(spec.widthM).toBe(3)
  })

  it("minimal 3 anak untuk rise sangat pendek", () => {
    expect(interiorStairSpec({ width: 2, depth: 2 }, 0.3).steps).toBe(3)
  })

  it("konstanta target riser = 0.18 (sinkron build-model & layout-sheet)", () => {
    expect(INTERIOR_RISER_TARGET_M).toBe(0.18)
  })
})

describe("stairRiserM override + stairComfortIssues", () => {
  it("override riser mengubah jumlah anak (round, min 3)", () => {
    const spec = interiorStairSpec({ width: 2.5, depth: 2.5, stairRiserM: 0.15 }, 3.15)
    expect(spec.steps).toBe(21) // round(3.15/0.15)
    expect(spec.riserM).toBeCloseTo(0.15, 5)
  })

  it("override tak wajar (<=0/NaN) diabaikan → default 0.18", () => {
    expect(interiorStairSpec({ width: 2.5, depth: 2.5, stairRiserM: 0 }, 3.15).steps).toBe(18)
    expect(interiorStairSpec({ width: 2.5, depth: 2.5, stairRiserM: Number.NaN }, 3.15).steps).toBe(18)
  })

  it("tangga nyaman → tanpa issue", () => {
    // 3.06 m / 18 anak = riser 0.17; run 4.9 → tread ~0.272; 2R+T = 0.612
    const spec = interiorStairSpec({ width: 4.9, depth: 1.0, stairDirection: "e" }, 3.06)
    expect(stairComfortIssues(spec)).toEqual([])
  })

  it("tread terlalu pendek & 2R+T di luar rentang → warning; lebar <0.8 → danger", () => {
    // run 2.5 / 18 anak = tread 0.139 (< 0.25) dan width 0.7 (< 0.8)
    const spec = interiorStairSpec({ width: 2.5, depth: 0.7, stairDirection: "e" }, 3.15)
    const issues = stairComfortIssues(spec)
    expect(issues.some((i) => i.level === "warning" && i.message.includes("injakan"))).toBe(true)
    expect(issues.some((i) => i.level === "warning" && i.message.includes("2R+T"))).toBe(true)
    expect(issues.some((i) => i.level === "danger" && i.message.includes("Lebar"))).toBe(true)
  })
})

describe("stairProfilePoints", () => {
  it("menghasilkan 2*steps+1 titik zig-zag riser/tread", () => {
    const spec = interiorStairSpec({ width: 2.7, depth: 1.0, stairDirection: "e" }, 0.54)
    // 0.54/0.18 = 3 anak; tread = 0.9
    const pts = stairProfilePoints(spec, 10, 0, true)
    expect(pts).toHaveLength(7)
    expect(pts[0]).toEqual({ h: 10, y: 0 })
    expect(pts[1]).toEqual({ h: 10, y: 0.18 }) // riser 1
    expect(pts[2]).toEqual({ h: 10.9, y: 0.18 }) // tread 1
    expect(pts[6]).toEqual({ h: 12.7, y: 0.54 }) // puncak = h+runLen
  })

  it("ascending=false berjalan ke arah h negatif", () => {
    const spec = interiorStairSpec({ width: 2.7, depth: 1.0, stairDirection: "e" }, 0.54)
    const pts = stairProfilePoints(spec, 10, 0, false)
    expect(pts[6].h).toBeCloseTo(10 - 2.7, 5)
  })
})

describe("interiorStairQuantities", () => {
  it("hand calculation: run 2.7, width 1.0, rise 0.54 (3 anak)", () => {
    const spec = interiorStairSpec({ width: 2.7, depth: 1.0, stairDirection: "e" }, 0.54)
    const q = interiorStairQuantities(spec)
    const slope = Math.sqrt(2.7 ** 2 + 0.54 ** 2) // 2.7535
    // pelat: slope × 1.0 × 0.12 = 0.3304 ; anak: 3 × 0.5×0.18×0.9×1.0 = 0.243
    expect(q.concreteM3).toBeCloseTo(slope * 0.12 + 0.243, 3)
    // finish: 3 × (0.9+0.18) × 1.0 = 3.24
    expect(q.finishM2).toBeCloseTo(3.24, 3)
    expect(q.railingM).toBeCloseTo(2 * slope, 3)
  })
})

describe("interiorStairLayout — bentuk L/U dengan bordes", () => {
  const base = { x: 1, y: 1, width: 3, depth: 2.5 }

  it("lurus/absent → satu segmen run identik dengan interiorStairSpec", () => {
    const layout = interiorStairLayout({ ...base }, 3.15)
    const spec = interiorStairSpec({ ...base }, 3.15)
    expect(layout.shape).toBe("lurus")
    expect(layout.degraded).toBe(false)
    expect(layout.segments).toHaveLength(1)
    expect(layout.segments[0]).toMatchObject({
      kind: "run", x: 1, y: 1, width: 3, depth: 2.5,
      dir: spec.dir, steps: spec.steps, elevStartM: 0,
    })
    expect(layout.segments[0].elevEndM).toBeCloseTo(3.15, 5)
    expect(layout.totalSteps).toBe(spec.steps)
  })

  it("L, dir e, belok kanan: run1 strip utara → bordes tenggara → run2 ke selatan", () => {
    const layout = interiorStairLayout(
      { ...base, stairDirection: "e", stairShape: "L", stairTurn: "kanan" }, 3.15)
    expect(layout.shape).toBe("L")
    expect(layout.laneM).toBeCloseTo(1.25, 5)
    const [run1, landing, run2] = layout.segments
    expect(run1).toMatchObject({ kind: "run", dir: "e" })
    expect(run1.x).toBeCloseTo(1, 5);     expect(run1.width).toBeCloseTo(1.75, 5)
    expect(run1.y).toBeCloseTo(1, 5);     expect(run1.depth).toBeCloseTo(1.25, 5)
    expect(landing).toMatchObject({ kind: "landing", dir: "s" })
    expect(landing.x).toBeCloseTo(2.75, 5); expect(landing.width).toBeCloseTo(1.25, 5)
    expect(landing.y).toBeCloseTo(1, 5);    expect(landing.depth).toBeCloseTo(1.25, 5)
    expect(run2).toMatchObject({ kind: "run", dir: "s" })
    expect(run2.y).toBeCloseTo(2.25, 5);  expect(run2.depth).toBeCloseTo(1.25, 5)
    expect(layout.totalSteps).toBe(18)
    expect(run1.steps).toBe(11)
    expect(run2.steps).toBe(7)
    expect(landing.elevStartM).toBeCloseTo(11 * (3.15 / 18), 2)
    expect(run2.firstStepNo).toBe(12)
    expect(run2.elevEndM).toBeCloseTo(3.15, 5)
  })

  it("L belok kiri = cermin: run1 strip selatan, run2 ke utara", () => {
    const layout = interiorStairLayout(
      { ...base, stairDirection: "e", stairShape: "L", stairTurn: "kiri" }, 3.15)
    const [run1, , run2] = layout.segments
    expect(run1.y).toBeCloseTo(2.25, 5)
    expect(run2.dir).toBe("n")
    expect(run2.y).toBeCloseTo(1, 5)
  })

  it("U, dir e, belok kanan: dua run sejajar berlawanan arah + bordes selebar 2 lane", () => {
    const layout = interiorStairLayout(
      { ...base, stairDirection: "e", stairShape: "U", stairTurn: "kanan" }, 3.15)
    const [run1, landing, run2] = layout.segments
    expect(run1.dir).toBe("e")
    expect(run2.dir).toBe("w")
    expect(run1.width).toBeCloseTo(1.75, 5)
    expect(run2.width).toBeCloseTo(1.75, 5)
    expect(landing.width).toBeCloseTo(1.25, 5)
    expect(landing.depth).toBeCloseTo(2.5, 5)
    expect(run1.steps! + run2.steps!).toBe(layout.totalSteps)
  })

  it("ruang terlalu kecil untuk L → degradasi ke lurus tanpa crash", () => {
    const layout = interiorStairLayout(
      { x: 0, y: 0, width: 1.0, depth: 1.0, stairShape: "L" }, 3.15)
    expect(layout.shape).toBe("lurus")
    expect(layout.degraded).toBe(true)
    expect(layout.segments).toHaveLength(1)
  })
})

describe("interiorStairQuantitiesFromLayout", () => {
  it("lurus = identik dengan interiorStairQuantities", () => {
    const room = { x: 1, y: 1, width: 2.7, depth: 1.0, stairDirection: "e" as const }
    const layout = interiorStairLayout(room, 0.54)
    const legacy = interiorStairQuantities(interiorStairSpec(room, 0.54))
    const q = interiorStairQuantitiesFromLayout(layout)
    expect(q.concreteM3).toBeCloseTo(legacy.concreteM3, 5)
    expect(q.finishM2).toBeCloseTo(legacy.finishM2, 5)
    expect(q.railingM).toBeCloseTo(legacy.railingM, 5)
  })

  it("bentuk L menambah pelat bordes dan menjumlah dua run; railing 2 sisi tiap run + keliling bordes", () => {
    const room = { x: 1, y: 1, width: 3, depth: 2.5, stairDirection: "e" as const,
      stairShape: "L" as const, stairTurn: "kanan" as const }
    const l = interiorStairLayout(room, 3.15)
    const q = interiorStairQuantitiesFromLayout(l)
    const [run1, landing, run2] = l.segments
    const lane = l.laneM
    const rise1 = run1.elevEndM - run1.elevStartM
    const rise2 = run2.elevEndM - run2.elevStartM
    const slope1 = Math.sqrt(run1.runLenM! ** 2 + rise1 ** 2)
    const slope2 = Math.sqrt(run2.runLenM! ** 2 + rise2 ** 2)
    const expectSlab = (slope1 + slope2) * lane * 0.12 + landing.width * landing.depth * 0.12
    const expectSteps =
      run1.steps! * 0.5 * (rise1 / run1.steps!) * run1.treadM! * lane +
      run2.steps! * 0.5 * (rise2 / run2.steps!) * run2.treadM! * lane
    expect(q.concreteM3).toBeCloseTo(expectSlab + expectSteps, 4)
    const expectRailing = 2 * (slope1 + slope2) + 2 * (landing.width + landing.depth)
    expect(q.railingM).toBeCloseTo(expectRailing, 4)
  })
})
