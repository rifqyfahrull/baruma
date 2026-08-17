import { describe, expect, it } from "vitest"
import { proceduralPartBoxes } from "@/components/preview-3d/furniture-procedural"
import type { Archetype } from "@/lib/three/furniture-models"

const dims = { w: 2, d: 1, h: 0.8 }
const archetypes: Archetype[] = ["seating","bed","table","wardrobe","cabinet","appliance","kitchen","bathroom","decor_flat","generic"]

function bounds(parts: ReturnType<typeof proceduralPartBoxes>) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity
  for (const p of parts) {
    minX=Math.min(minX,p.pos[0]-p.size[0]/2); maxX=Math.max(maxX,p.pos[0]+p.size[0]/2)
    minY=Math.min(minY,p.pos[1]-p.size[1]/2); maxY=Math.max(maxY,p.pos[1]+p.size[1]/2)
    minZ=Math.min(minZ,p.pos[2]-p.size[2]/2); maxZ=Math.max(maxZ,p.pos[2]+p.size[2]/2)
  }
  return { minX,maxX,minY,maxY,minZ,maxZ }
}

describe("proceduralPartBoxes", () => {
  it("every archetype produces at least one part and stays within the footprint + on the floor", () => {
    for (const a of archetypes) {
      const parts = proceduralPartBoxes(a, dims)
      expect(parts.length).toBeGreaterThan(0)
      const b = bounds(parts)
      // within footprint (small tolerance for proud seams)
      expect(b.minX).toBeGreaterThanOrEqual(-dims.w/2 - 0.05)
      expect(b.maxX).toBeLessThanOrEqual(dims.w/2 + 0.05)
      expect(b.minZ).toBeGreaterThanOrEqual(-dims.d/2 - 0.05)
      expect(b.maxZ).toBeLessThanOrEqual(dims.d/2 + 0.05)
      // base on/above floor, top within height
      expect(b.minY).toBeGreaterThanOrEqual(-0.001)
      expect(b.maxY).toBeLessThanOrEqual(dims.h + 0.05)
    }
  })
})
