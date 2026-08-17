import { describe, expect, it } from "vitest"

import {
  DEFAULT_FLOOR_TO_FLOOR_M,
  SLAB_T,
  WALL_H,
  floorElevations,
  stairRiseM,
  totalStackHeightM,
} from "./vertical"
import type { Floor } from "@/types"

const f = (id: string, level: number, heightM: number): Floor => ({
  id, level, name: id, heightM,
})

describe("floorElevations — tabel elevasi tunggal", () => {
  it("prefix-sum floor-to-floor; wallHM = f2f − SLAB_T", () => {
    const elev = floorElevations([f("f1", 1, 2.95), f("f2", 2, 3.5)])
    const f1 = elev.get("f1")!
    expect(f1.index).toBe(0)
    expect(f1.baseY).toBe(0)
    expect(f1.wallHM).toBe(WALL_H) // nilai 2.95 ternormalisasi → dinding EXACT WALL_H
    const f2 = elev.get("f2")!
    expect(f2.baseY).toBeCloseTo(2.95, 9)
    expect(f2.floorToFloorM).toBe(3.5)
    expect(f2.wallHM).toBe(3.35)
  })

  it("rooftop = puncak tumpukan reguler (index stacking, wallHM 0), terlepas posisi array", () => {
    const elev = floorElevations([
      f("f1", 1, 2.95),
      f("floor-rooftop", 3, 0.3),
      f("f2", 2, 2.95),
    ])
    expect(elev.get("f2")!.baseY).toBeCloseTo(2.95, 9)
    const rt = elev.get("floor-rooftop")!
    expect(rt.index).toBe(2)
    expect(rt.baseY).toBeCloseTo(5.9, 9)
    expect(rt.floorToFloorM).toBe(0.3)
    expect(rt.wallHM).toBe(0)
  })

  it("heightM tak valid → fallback default 2.95 (defensif)", () => {
    const elev = floorElevations([f("f1", 1, 0), f("f2", 2, NaN)])
    expect(elev.get("f1")!.floorToFloorM).toBe(DEFAULT_FLOOR_TO_FLOOR_M)
    expect(elev.get("f2")!.baseY).toBe(DEFAULT_FLOOR_TO_FLOOR_M)
  })

  it("kompat historis: data ternormalisasi 2.95 mereproduksi rumus lama index×(WALL_H+SLAB_T)", () => {
    const floors = [f("f1", 1, 2.95), f("f2", 2, 2.95), f("f3", 3, 2.95)]
    const elev = floorElevations(floors)
    for (const [i, fl] of floors.entries()) {
      expect(elev.get(fl.id)!.baseY).toBeCloseTo(i * (WALL_H + SLAB_T), 9)
      expect(elev.get(fl.id)!.wallHM).toBeCloseTo(WALL_H, 9)
    }
  })

  it("stairRiseM & totalStackHeightM", () => {
    const floors = [f("f1", 1, 2.95), f("f2", 2, 3.2)]
    const elev = floorElevations(floors)
    expect(stairRiseM(elev, "f1")).toBe(DEFAULT_FLOOR_TO_FLOOR_M)
    expect(stairRiseM(elev, "tak-ada")).toBe(DEFAULT_FLOOR_TO_FLOOR_M)
    expect(totalStackHeightM(floors)).toBeCloseTo(2.95 + 3.2, 9)
  })
})

describe("floorElevations — mezzanine (Fase E5)", () => {
  it("mezzanine tidak menambah tumpukan; baseY = induk + baseOffsetM (default ½ f2f induk)", () => {
    const floors: Floor[] = [
      f("f1", 1, 2.95),
      { id: "mezz-1", level: 1.5, name: "Mezzanine", heightM: 2.2, kind: "mezzanine", baseOffsetM: 1.5 },
      f("f2", 2, 2.95),
    ]
    const elev = floorElevations(floors)
    // f2 TIDAK naik karena mezzanine (tumpukan reguler utuh).
    expect(elev.get("f2")!.baseY).toBeCloseTo(2.95, 9)
    const mz = elev.get("mezz-1")!
    expect(mz.baseY).toBeCloseTo(1.5, 9)
    expect(mz.index).toBe(0) // gap explode menempel lantai induk
    expect(mz.wallHM).toBeCloseTo(2.05, 9)

    // Tanpa baseOffsetM → default ½ floor-to-floor induk.
    const auto = floorElevations([
      f("f1", 1, 2.95),
      { id: "mezz-1", level: 1.5, name: "M", heightM: 2.2, kind: "mezzanine" },
    ])
    expect(auto.get("mezz-1")!.baseY).toBeCloseTo(1.48, 2)
  })
})
