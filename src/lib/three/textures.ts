/**
 * Procedural PBR textures (PRD §10.7, SP6 Global Constraints B).
 *
 * Every map is drawn on a small 2D `<canvas>` at import-time-free/lazy cost — NO
 * external image assets, NO drei Environment/HDRI. Maps are near-neutral grayscale
 * so that a `meshStandardMaterial.map` MODULATES the flat preset color (T11) while
 * still adding surface variation. Each generator is memoized at module level: the
 * first call creates + caches the `CanvasTexture`, later calls return the same ref.
 *
 * SSR / test safety: when there is no DOM (`typeof document === "undefined"`) or the
 * jsdom canvas has no 2D context, the generators return `null` and cache nothing, so
 * importing this module in node/vitest never throws. Real texture pixels are exercised
 * by the browser (T11) and the Playwright e2e gate (T12).
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three"

/** Surface a preset/material can request a procedural map for. */
export type TextureKind =
  | "wall"
  | "floor"
  | "roof"
  | "glass"
  | "brick"
  | "wood"
  | "concrete"
  | "stripes"
  | "wainscot"
  | "diamond"

/** Small is fine — these are tiled, cheap, procedural patterns. */
const SIZE = 256

type Draw = (ctx: CanvasRenderingContext2D, size: number) => void

/** Deterministic PRNG (mulberry32) so a given map is byte-stable across runs. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draws `draw` on a fresh canvas and wraps it in a repeating `CanvasTexture`.
 * Returns `null` when no canvas 2D context is available (SSR / bare jsdom).
 */
function createTexture(draw: Draw, repeat: number): CanvasTexture | null {
  if (typeof document === "undefined") return null
  const canvas = document.createElement("canvas")
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  draw(ctx, SIZE)

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = 4
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** Plaster wall: near-white base with fine light/dark speckle. */
function drawWall(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#ececec"
  ctx.fillRect(0, 0, size, size)
  const rng = makeRng(1)
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size
    const y = rng() * size
    const shade = rng() < 0.5 ? 40 : 235
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.03 + rng() * 0.05).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
}

/** Floor tiles: a grid of slightly-varied cells separated by grout lines. */
function drawFloor(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#e9e9e9"
  ctx.fillRect(0, 0, size, size)
  const tiles = 4
  const step = size / tiles
  const rng = makeRng(7)
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const g = 224 + Math.floor(rng() * 22)
      ctx.fillStyle = `rgb(${g},${g},${g})`
      ctx.fillRect(tx * step + 1, ty * step + 1, step - 2, step - 2)
    }
  }
  ctx.strokeStyle = "rgba(120,120,120,0.5)"
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i <= tiles; i++) {
    const p = i * step
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
  }
  ctx.stroke()
}

/** Roof genteng: horizontal rows of tile ridges, staggered per row. */
function drawRoof(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#d9d9d9"
  ctx.fillRect(0, 0, size, size)
  const rows = 8
  const step = size / rows
  const rng = makeRng(13)
  for (let r = 0; r < rows; r++) {
    const y = r * step
    const g = 200 + Math.floor(rng() * 30)
    ctx.fillStyle = `rgb(${g},${g},${g})`
    ctx.fillRect(0, y, size, step - 1)
    // shadow gutter under each row of tiles
    ctx.fillStyle = "rgba(90,90,90,0.55)"
    ctx.fillRect(0, y + step - 2, size, 2)
    // vertical tile seams, staggered every other row
    ctx.fillStyle = "rgba(110,110,110,0.4)"
    const offset = (r % 2) * (step / 2)
    for (let x = offset; x < size; x += step) {
      ctx.fillRect(x, y, 1, step - 2)
    }
  }
}

/** Glass: smooth near-white sheet with faint diagonal reflective streaks. */
function drawGlass(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#eef2f4"
  ctx.fillRect(0, 0, size, size)
  ctx.save()
  ctx.strokeStyle = "rgba(255,255,255,0.25)"
  ctx.lineWidth = 6
  ctx.beginPath()
  for (let i = -size; i < size * 2; i += 48) {
    ctx.moveTo(i, 0)
    ctx.lineTo(i + size, size)
  }
  ctx.stroke()
  ctx.restore()
}

/** Exposed brick: staggered courses with light mortar lines. */
function drawBrick(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#d7d0c8"
  ctx.fillRect(0, 0, size, size)
  const rows = 8
  const rowH = size / rows
  const brickW = size / 4
  const rng = makeRng(19)
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickW / 2)
    for (let x = -offset; x < size; x += brickW) {
      const red = 150 + Math.floor(rng() * 35)
      const green = 72 + Math.floor(rng() * 22)
      const blue = 48 + Math.floor(rng() * 18)
      ctx.fillStyle = `rgb(${red},${green},${blue})`
      ctx.fillRect(x + 2, r * rowH + 2, brickW - 4, rowH - 4)
    }
  }
}

/** Wood planks: long board seams plus subtle grain strokes. */
function drawWood(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#d3a36e"
  ctx.fillRect(0, 0, size, size)
  const planks = 5
  const plankH = size / planks
  const rng = makeRng(23)
  for (let i = 0; i < planks; i++) {
    const y = i * plankH
    const tone = 170 + Math.floor(rng() * 32)
    ctx.fillStyle = `rgb(${tone},${Math.max(100, tone - 58)},${Math.max(55, tone - 105)})`
    ctx.fillRect(0, y + 1, size, plankH - 2)
    ctx.strokeStyle = "rgba(75,45,22,0.24)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let g = 0; g < 7; g++) {
      const yy = y + 5 + rng() * Math.max(2, plankH - 10)
      ctx.moveTo(0, yy)
      ctx.bezierCurveTo(size * 0.28, yy + rng() * 8 - 4, size * 0.68, yy + rng() * 8 - 4, size, yy)
    }
    ctx.stroke()
  }
}

/** Concrete / limewash: seamless cloudy mineral variation. */
function drawConcrete(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#d2d0ca"
  ctx.fillRect(0, 0, size, size)
  const rng = makeRng(29)
  for (let i = 0; i < 1800; i++) {
    const shade = 110 + Math.floor(rng() * 120)
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.025 + rng() * 0.06).toFixed(3)})`
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2)
  }
}

/** Wallpaper garis vertikal: alternating light/dark bands + fine speckle. */
function drawStripes(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#e9e5dc"
  ctx.fillRect(0, 0, size, size)
  const bands = 8
  const bandW = size / bands
  for (let b = 0; b < bands; b++) {
    if (b % 2 === 0) continue
    ctx.fillStyle = "rgba(120,120,120,0.22)"
    ctx.fillRect(b * bandW, 0, bandW, size)
  }
  const rng = makeRng(31)
  for (let i = 0; i < 900; i++) {
    const shade = rng() < 0.5 ? 90 : 230
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(0.02 + rng() * 0.04).toFixed(3)})`
    ctx.fillRect(rng() * size, rng() * size, 1, 1)
  }
}

/** Panel wainscot klasik: rectangular raised-panel frames on a plaster base. */
function drawWainscot(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#eae6de"
  ctx.fillRect(0, 0, size, size)
  const cols = 2
  const rows = 2
  const cw = size / cols
  const rh = size / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw
      const y = r * rh
      // outer frame shadow + inner raised panel highlight
      ctx.strokeStyle = "rgba(90,90,90,0.45)"
      ctx.lineWidth = 3
      ctx.strokeRect(x + cw * 0.14, y + rh * 0.14, cw * 0.72, rh * 0.72)
      ctx.strokeStyle = "rgba(255,255,255,0.6)"
      ctx.lineWidth = 2
      ctx.strokeRect(x + cw * 0.2, y + rh * 0.2, cw * 0.6, rh * 0.6)
    }
  }
}

/** Motif geometris: diamond lattice accent (aksen dinding). */
function drawDiamond(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = "#e7e2d8"
  ctx.fillRect(0, 0, size, size)
  const step = size / 4
  ctx.strokeStyle = "rgba(105,105,105,0.4)"
  ctx.lineWidth = 2.5
  ctx.beginPath()
  for (let i = -size; i <= size * 2; i += step) {
    ctx.moveTo(i, 0)
    ctx.lineTo(i + size, size)
    ctx.moveTo(i + size, 0)
    ctx.lineTo(i, size)
  }
  ctx.stroke()
  // node dots at lattice crossings
  ctx.fillStyle = "rgba(90,90,90,0.35)"
  for (let y = 0; y <= size; y += step) {
    for (let x = 0; x <= size; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

let wallTexture: CanvasTexture | null = null
let floorTexture: CanvasTexture | null = null
let roofTexture: CanvasTexture | null = null
let glassTexture: CanvasTexture | null = null
let brickTexture: CanvasTexture | null = null
let woodTexture: CanvasTexture | null = null
let concreteTexture: CanvasTexture | null = null
let stripesTexture: CanvasTexture | null = null
let wainscotTexture: CanvasTexture | null = null
let diamondTexture: CanvasTexture | null = null

/** Plaster wall map. Memoized; `null` when no canvas env. */
export function makeWallTexture(): CanvasTexture | null {
  if (!wallTexture) wallTexture = createTexture(drawWall, 3)
  return wallTexture
}

/** Tiled floor map. Memoized; `null` when no canvas env. */
export function makeFloorTexture(): CanvasTexture | null {
  if (!floorTexture) floorTexture = createTexture(drawFloor, 4)
  return floorTexture
}

/** Roof genteng map. Memoized; `null` when no canvas env. */
export function makeRoofTexture(): CanvasTexture | null {
  if (!roofTexture) roofTexture = createTexture(drawRoof, 4)
  return roofTexture
}

/** Reflective glass map. Memoized; `null` when no canvas env. */
export function makeGlassTexture(): CanvasTexture | null {
  if (!glassTexture) glassTexture = createTexture(drawGlass, 1)
  return glassTexture
}

/** Exposed brick map. Memoized; `null` when no canvas env. */
export function makeBrickTexture(): CanvasTexture | null {
  if (!brickTexture) brickTexture = createTexture(drawBrick, 3)
  return brickTexture
}

/** Wood plank map. Memoized; `null` when no canvas env. */
export function makeWoodTexture(): CanvasTexture | null {
  if (!woodTexture) woodTexture = createTexture(drawWood, 2)
  return woodTexture
}

/** Concrete/limewash map. Memoized; `null` when no canvas env. */
export function makeConcreteTexture(): CanvasTexture | null {
  if (!concreteTexture) concreteTexture = createTexture(drawConcrete, 3)
  return concreteTexture
}

/** Wallpaper garis vertikal. Memoized; `null` when no canvas env. */
export function makeStripesTexture(): CanvasTexture | null {
  if (!stripesTexture) stripesTexture = createTexture(drawStripes, 2)
  return stripesTexture
}

/** Panel wainscot klasik. Memoized; `null` when no canvas env. */
export function makeWainscotTexture(): CanvasTexture | null {
  if (!wainscotTexture) wainscotTexture = createTexture(drawWainscot, 2)
  return wainscotTexture
}

/** Motif geometris diamond. Memoized; `null` when no canvas env. */
export function makeDiamondTexture(): CanvasTexture | null {
  if (!diamondTexture) diamondTexture = createTexture(drawDiamond, 3)
  return diamondTexture
}

/** Maps a preset surface to its procedural generator (used by T11). */
export function textureFor(kind: TextureKind): CanvasTexture | null {
  switch (kind) {
    case "wall":
      return makeWallTexture()
    case "floor":
      return makeFloorTexture()
    case "roof":
      return makeRoofTexture()
    case "glass":
      return makeGlassTexture()
    case "brick":
      return makeBrickTexture()
    case "wood":
      return makeWoodTexture()
    case "concrete":
      return makeConcreteTexture()
    case "stripes":
      return makeStripesTexture()
    case "wainscot":
      return makeWainscotTexture()
    case "diamond":
      return makeDiamondTexture()
  }
}
