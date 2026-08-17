"use client"

import type { Archetype } from "@/lib/three/furniture-models"

export type Part = { size: [number, number, number]; pos: [number, number, number]; rounded?: boolean }

export function proceduralPartBoxes(
  archetype: Archetype,
  dims: { w: number; d: number; h: number }
): Part[] {
  const { w, d, h } = dims

  switch (archetype) {
    case "seating": {
      // Seat slab
      const seatH = h * 0.45
      const seatY = seatH / 2
      // Backrest — at rear, stays within z footprint
      const backH = h * 0.55
      const backD = d * 0.16
      const backY = seatH + backH / 2
      const backZ = -d / 2 + backD / 2
      // Two armrests
      const armW = w * 0.12
      const armH = h * 0.5
      const armY = armH / 2
      const armX = w / 2 - armW / 2
      // Seat cushion on top of seat
      const cushH = h * 0.12
      const cushY = seatH + cushH / 2
      return [
        { size: [w, seatH, d], pos: [0, seatY, 0] },
        { size: [w, backH, backD], pos: [0, backY, backZ] },
        { size: [armW, armH, d], pos: [armX, armY, 0] },
        { size: [armW, armH, d], pos: [-armX, armY, 0] },
        { size: [w * 0.9, cushH, d * 0.85], pos: [0, cushY, 0] },
      ]
    }

    case "bed": {
      // Frame
      const frameH = h * 0.35
      const frameY = frameH / 2
      // Mattress on frame
      const mattH = h * 0.3
      const mattY = frameH + mattH / 2
      // Two pillows near head (z = -d/2 front)
      const pillowH = h * 0.12
      const pillowY = frameH + mattH + pillowH / 2
      const pillowD = d * 0.18
      const pillowZ = -d / 2 + pillowD / 2 + d * 0.05
      const pillowX = w * 0.22
      return [
        { size: [w, frameH, d], pos: [0, frameY, 0] },
        { size: [w * 0.96, mattH, d * 0.96], pos: [0, mattY, 0] },
        { size: [w * 0.4, pillowH, pillowD], pos: [pillowX, pillowY, pillowZ] },
        { size: [w * 0.4, pillowH, pillowD], pos: [-pillowX, pillowY, pillowZ] },
      ]
    }

    case "table": {
      // Top slab
      const topH = h * 0.1
      const topY = h - topH / 2
      // Four legs
      const legW = w * 0.06
      const legD = d * 0.06
      const legH = h * 0.9
      const legY = legH / 2
      const legX = w / 2 - legW / 2 - w * 0.01
      const legZ = d / 2 - legD / 2 - d * 0.01
      return [
        { size: [w, topH, d], pos: [0, topY, 0] },
        { size: [legW, legH, legD], pos: [legX, legY, legZ] },
        { size: [legW, legH, legD], pos: [-legX, legY, legZ] },
        { size: [legW, legH, legD], pos: [legX, legY, -legZ] },
        { size: [legW, legH, legD], pos: [-legX, legY, -legZ] },
      ]
    }

    case "wardrobe":
    case "cabinet": {
      // Main body
      const bodyY = h / 2
      // Door seam — thin vertical strip slightly proud (within tolerance 0.05)
      const seamZ = d / 2
      // Handles near seam, recessed so they stay inside the z footprint
      const handleZ = d / 2 - 0.01
      return [
        { size: [w, h, d], pos: [0, bodyY, 0] },
        { size: [w * 0.02, h * 0.92, 0.005], pos: [0, bodyY, seamZ] },
        { size: [w * 0.03, h * 0.12, d * 0.04], pos: [w * 0.18, h * 0.5, handleZ] },
        { size: [w * 0.03, h * 0.12, d * 0.04], pos: [-w * 0.18, h * 0.5, handleZ] },
      ]
    }

    case "appliance": {
      // Body
      const bodyY = h / 2
      // Front panel proud but within tolerance
      const panelZ = d / 2
      return [
        { size: [w, h, d], pos: [0, bodyY, 0] },
        { size: [w * 0.9, h * 0.5, 0.01], pos: [0, bodyY, panelZ] },
      ]
    }

    case "kitchen": {
      // Base counter
      const baseH = h * 0.4
      const baseY = baseH / 2
      // Upper cabinets — shallower, upper half
      const upH = h * 0.3
      const upD = d * 0.5
      const upY = h - upH / 2
      const upZ = -d / 2 + upD / 2
      // Thin backsplash
      const splashH = h * 0.3
      const splashY = baseH + splashH / 2
      const splashZ = -d / 2
      return [
        { size: [w, baseH, d], pos: [0, baseY, 0] },
        { size: [w, upH, upD], pos: [0, upY, upZ] },
        { size: [w, splashH, 0.02], pos: [0, splashY, splashZ] },
      ]
    }

    case "bathroom": {
      // Generic body + front panel (like appliance)
      const bodyY = h / 2
      const panelZ = d / 2
      return [
        { size: [w, h, d], pos: [0, bodyY, 0] },
        { size: [w * 0.9, h * 0.5, 0.01], pos: [0, bodyY, panelZ] },
      ]
    }

    case "decor_flat": {
      const fh = Math.max(h, 0.02)
      return [
        { size: [w, fh, d], pos: [0, fh / 2, 0] },
      ]
    }

    case "generic":
    default: {
      return [
        { size: [w, h, d], pos: [0, h / 2, 0], rounded: true },
      ]
    }
  }
}

export function ProceduralFurniture({
  archetype,
  dims,
  color,
}: {
  archetype: Archetype
  dims: { w: number; d: number; h: number }
  color: string
}) {
  const parts = proceduralPartBoxes(archetype, dims)
  return (
    <group>
      {parts.map((p, i) => (
        <mesh key={i} position={p.pos} castShadow receiveShadow>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={color} roughness={0.85} metalness={archetype === "appliance" ? 0.3 : 0} />
        </mesh>
      ))}
    </group>
  )
}
