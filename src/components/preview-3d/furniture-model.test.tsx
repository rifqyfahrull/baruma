import { describe, expect, it } from "vitest"
import { FurnitureModel } from "./furniture-model"

describe("FurnitureModel module", () => {
  it("exports a component without throwing on import", () => {
    expect(typeof FurnitureModel).toBe("function")
  })
})
