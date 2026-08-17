import { describe, it, expect } from "vitest"
import { DATAR_DEFAULTS, effectiveRoof } from "./roof"
import type { DesignLayout, RoofSpec } from "@/types"

// Kunci perilaku modul bersama `effectiveRoof` — dulu duplikat identik di
// build-model.ts dan elevation.ts; kini SATU sumber. Semua clamp di sini
// adalah kontrak lama yang tidak boleh bergeser.

const layoutWith = (roof?: RoofSpec): DesignLayout =>
  ({
    id: "l", projectId: "p", versionId: "v",
    floors: [], rooms: [], walls: [], openings: [], stairs: [], pools: [],
    ...(roof ? { roof } : {}),
    validation: { passed: true, issues: [] },
  }) as unknown as DesignLayout

describe("effectiveRoof (modul murni bersama)", () => {
  it("tanpa layout.roof: jatuh ke DATAR_DEFAULTS + lowSide 's'", () => {
    expect(effectiveRoof(layoutWith())).toEqual({ ...DATAR_DEFAULTS, lowSide: "s" })
  })

  it("slopeDeg di-clamp [15,40] utk tipe biasa; min 5 utk miring (skillion landai)", () => {
    const pelana = effectiveRoof(layoutWith({ type: "pelana", slopeDeg: 3, overhangM: 0.5, material: "genteng_beton" }))
    expect(pelana.slopeDeg).toBe(15)
    const miring = effectiveRoof(layoutWith({ type: "miring", slopeDeg: 5, overhangM: 0.5, material: "metal" }))
    expect(miring.slopeDeg).toBe(5)
    const over = effectiveRoof(layoutWith({ type: "limasan", slopeDeg: 999, overhangM: 0.5, material: "genteng_beton" }))
    expect(over.slopeDeg).toBe(40)
  })

  it("overhangM di-clamp [0,1]; lowSide default 's' bila absen", () => {
    const r = effectiveRoof(layoutWith({ type: "pelana", slopeDeg: 30, overhangM: 5, material: "genteng_beton" }))
    expect(r.overhangM).toBe(1)
    expect(r.lowSide).toBe("s")
    const lo = effectiveRoof(layoutWith({ type: "miring", slopeDeg: 10, overhangM: -2, material: "metal", lowSide: "e" }))
    expect(lo.overhangM).toBe(0)
    expect(lo.lowSide).toBe("e")
  })

  it("fascia: heightM di-clamp [0.1,0.8], color non-string → #3c4245; tanpa fascia → tanpa key", () => {
    const big = effectiveRoof(layoutWith({
      type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
      fascia: { heightM: 9, color: 123 as unknown as string },
    }))
    expect(big.fascia).toEqual({ heightM: 0.8, color: "#3c4245" })
    const ok = effectiveRoof(layoutWith({
      type: "datar", slopeDeg: 30, overhangM: 0.5, material: "genteng_beton",
      fascia: { heightM: 0.05, color: "#1d2022" },
    }))
    expect(ok.fascia).toEqual({ heightM: 0.1, color: "#1d2022" })
    expect(effectiveRoof(layoutWith(DATAR_DEFAULTS)).fascia).toBeUndefined()
  })
})
