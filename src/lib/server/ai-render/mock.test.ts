// @vitest-environment node
import { describe, expect, it } from "vitest"

import { mockRenderProvider } from "./mock"

describe("mockRenderProvider", () => {
  it("submit() resolves synchronously with a valid PNG signature", async () => {
    const result = await mockRenderProvider.submit({
      prompt: "irrelevant for mock",
      seed: 1,
      beautyUrl: "https://example.test/beauty.png",
    })

    expect(result).not.toBeNull()
    expect(result?.kind).toBe("done")
    if (result?.kind === "done") {
      // Signature PNG: \x89 P N G \r \n \x1a \n
      expect(Array.from(result.imageBytes.slice(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
    }
  })
})
