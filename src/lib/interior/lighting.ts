/** Pure helpers for interior lighting fixtures: pricing, construction, and 3D light mapping. */
import { nanoid } from "nanoid"

import type { LightingFixture, PriceRange, Room } from "@/types"

type LightType = LightingFixture["type"]
type ColorTemp = LightingFixture["colorTemperature"]

export const LIGHT_LABELS: Record<LightingFixture["type"], string> = {
  downlight: "Downlight",
  pendant: "Lampu gantung",
  wall_lamp: "Lampu dinding",
  indirect: "Lampu tidak langsung",
  task: "Lampu kerja",
  outdoor: "Lampu luar",
}

export const LIGHT_COLORS: Record<ColorTemp, string> = {
  warm: "#ffd9a8",
  neutral: "#fff2e0",
  cool: "#cfe0ff",
}

const PER_UNIT: Record<LightType, PriceRange> = {
  downlight: { low: 180_000, mid: 350_000, high: 900_000 },
  pendant: { low: 350_000, mid: 900_000, high: 2_800_000 },
  wall_lamp: { low: 150_000, mid: 300_000, high: 700_000 },
  indirect: { low: 250_000, mid: 600_000, high: 1_500_000 },
  task: { low: 120_000, mid: 250_000, high: 600_000 },
  outdoor: { low: 200_000, mid: 450_000, high: 1_200_000 },
}

const HEIGHT_M: Record<LightType, number> = {
  downlight: 2.6, pendant: 2.4, indirect: 2.6, wall_lamp: 1.8, task: 0.75, outdoor: 2.2,
}

const BASE_INTENSITY: Record<LightType, number> = {
  downlight: 6, pendant: 8, indirect: 5, wall_lamp: 4, task: 3, outdoor: 7,
}

export function lightPriceFor(type: LightType, qty: number): PriceRange {
  const u = PER_UNIT[type]
  const n = Math.max(1, Math.round(qty))
  return { low: u.low * n, mid: u.mid * n, high: u.high * n }
}

export function makeLight(type: LightType, room: Room, colorTemperature: ColorTemp = "warm"): LightingFixture {
  return {
    id: `light-${nanoid(8)}`,
    roomId: room.id,
    type,
    x: room.width / 2,
    y: room.depth / 2,
    heightM: HEIGHT_M[type],
    colorTemperature,
    qty: 1,
    priceRange: lightPriceFor(type, 1),
  }
}

export type LightDesc = {
  kind: "spot" | "point"
  color: string
  intensity: number
  position: [number, number, number]
  target?: [number, number, number]
  castShadow: boolean
}

export function fixtureToLight(f: LightingFixture, room: Room): LightDesc {
  const kind: LightDesc["kind"] =
    f.type === "downlight" || f.type === "task" || f.type === "outdoor" ? "spot" : "point"
  // center room at origin (scene coords); three.js Y is up, plan y maps to scene z
  const px = f.x - room.width / 2
  const pz = f.y - room.depth / 2
  const intensity = BASE_INTENSITY[f.type] * Math.max(1, Math.round(f.qty))
  return {
    kind,
    color: LIGHT_COLORS[f.colorTemperature],
    intensity,
    position: [px, f.heightM, pz],
    target: kind === "spot" ? [px, 0, pz] : undefined,
    castShadow: f.type === "downlight" || f.type === "pendant",
  }
}
