import { describe, expect, it } from "vitest"
import { wantsAssetSuggestions } from "./asset-search"

describe("wantsAssetSuggestions for 3D Model Recommendations", () => {
  it("detects asset recommendation requests with pilihkan / selaras / cocok", () => {
    expect(
      wantsAssetSuggestions(
        "tolong pilihkan model 3d jendela yang pas dan selaras untuk jendela depan ruang tamu",
      ),
    ).toBe(true)
    expect(
      wantsAssetSuggestions("model pintu mana yang cocok untuk garasi?"),
    ).toBe(true)
    expect(
      wantsAssetSuggestions("carikan model sofa L untuk ruang keluarga"),
    ).toBe(true)
  })

  it("does not match generic design questions", () => {
    expect(
      wantsAssetSuggestions("kenapa kamar tidur sebaiknya di lantai 2?"),
    ).toBe(false)
  })
})
