import { describe, it, expect } from "vitest"

import { orderUnitsByAdjacency } from "./layout"

// Minimal Unit builder (the exported type is internal; shape matches).
const u = (type: string, name = type) =>
  ({ type, name, vent: false, light: false, floor: 1 }) as never

describe("orderUnitsByAdjacency", () => {
  it("clusters public → service → wet → circulation → private → outdoor", () => {
    const input = [
      u("kamar_tidur", "KT1"),
      u("taman"),
      u("dapur"),
      u("ruang_tamu"),
      u("kamar_mandi"),
      u("tangga"),
      u("ruang_keluarga"),
    ]
    const out = orderUnitsByAdjacency(input).map((x) => (x as { type: string }).type)
    expect(out).toEqual([
      "ruang_tamu",
      "ruang_keluarga",
      "dapur",
      "kamar_mandi",
      "tangga",
      "kamar_tidur",
      "taman",
    ])
  })

  it("is stable — multiples of one type keep their input sequence", () => {
    const input = [
      u("kamar_tidur", "KT1"),
      u("kamar_tidur", "KT2"),
      u("kamar_tidur", "KT3"),
    ]
    expect(orderUnitsByAdjacency(input).map((x) => (x as { name: string }).name)).toEqual([
      "KT1",
      "KT2",
      "KT3",
    ])
  })

  it("keeps dapur adjacent to ruang makan and laundry (kitchen work triangle)", () => {
    const input = [u("laundry"), u("kamar_tidur"), u("dapur"), u("ruang_makan")]
    const out = orderUnitsByAdjacency(input).map((x) => (x as { type: string }).type)
    const iMakan = out.indexOf("ruang_makan")
    const iDapur = out.indexOf("dapur")
    const iLaundry = out.indexOf("laundry")
    expect(iMakan).toBeLessThan(iDapur)
    expect(iDapur).toBeLessThan(iLaundry)
  })

  it("does not add or drop units", () => {
    const input = [u("void"), u("carport"), u("musholla")]
    expect(orderUnitsByAdjacency(input)).toHaveLength(3)
  })
})
