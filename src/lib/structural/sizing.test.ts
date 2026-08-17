import { describe, it, expect } from "vitest"

import { sizeColumn, sizeBeam, SLOOF } from "@/lib/structural/sizing"

describe("structural sizing — sizeColumn (kolom persegi, mm)", () => {
  it("Pu 261.6 kN → 200 mm (Ag=261600/8.25=31709 → √178 → roundUp50 200)", () => {
    expect(sizeColumn(261.6)).toEqual({ side: 200, agReq: 31709 })
  })

  it("Pu 1000 kN → 350 mm (Ag=1000000/8.25=121212 → √348.2 → roundUp50 350)", () => {
    expect(sizeColumn(1000)).toEqual({ side: 350, agReq: 121212 })
  })

  it("Pu 50 kN → 150 mm minimum (Ag=6060 → √77.8 → roundUp50 100 → max(150,100))", () => {
    expect(sizeColumn(50)).toEqual({ side: 150, agReq: 6061 })
  })

  it("non-finite / non-positive Pu → 150 mm minimum (safe, no NaN)", () => {
    expect(sizeColumn(Number.NaN)).toEqual({ side: 150, agReq: 0 })
    expect(sizeColumn(0)).toEqual({ side: 150, agReq: 0 })
    expect(sizeColumn(-100)).toEqual({ side: 150, agReq: 0 })
  })
})

describe("structural sizing — sizeBeam (balok b×h, mm)", () => {
  it("span 4.0 m → b200 h350 (h=roundUp50(333.3)=350, b=roundUp50(175)=200)", () => {
    expect(sizeBeam(4.0)).toEqual({ b: 200, h: 350 })
  })

  it("span 3.0 m → b150 h300 (h floors at 300, b=roundUp50(300/2=150)=150)", () => {
    expect(sizeBeam(3.0)).toEqual({ b: 150, h: 300 })
  })

  it("span 6.0 m → b250 h500 (h=roundUp50(500)=500, b=roundUp50(250)=250)", () => {
    expect(sizeBeam(6.0)).toEqual({ b: 250, h: 500 })
  })

  it("non-finite / non-positive span → minimum 150×300 beam", () => {
    expect(sizeBeam(Number.NaN)).toEqual({ b: 150, h: 300 })
    expect(sizeBeam(0)).toEqual({ b: 150, h: 300 })
  })
})

describe("structural sizing — SLOOF (sloof/tie beam tetap)", () => {
  it("is a fixed 150×200 mm section", () => {
    expect(SLOOF).toEqual({ b: 150, h: 200 })
  })
})
