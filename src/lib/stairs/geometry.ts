/**
 * Sumber TUNGGAL derivasi tangga interior (Room type:"tangga").
 * Dipakai: 3D (build-model), denah (layout-sheet), potongan (section),
 * RAB (mock/rab), dan validasi kenyamanan (Task 2). JANGAN duplikasi rumus
 * riser/step di file lain lagi — investigasi 2026-07-15 menemukan tiga
 * konstanta riser berbeda karena duplikasi.
 *
 * Modul ini SENGAJA tidak mengimpor build-model (pemakainya) — totalRiseM
 * (umumnya WALL_H + SLAB_T) selalu dipasok pemanggil.
 */

import type { Room } from "@/types"
import { round2 } from "@/lib/geometry"

export type StairDir = "n" | "s" | "w" | "e"

export type InteriorStairSpec = {
  dir: StairDir
  horizontalRun: boolean
  runLenM: number
  widthM: number
  totalRiseM: number
  steps: number
  riserM: number
  treadM: number
}

/** Target riser interior — nilai historis build-model/layout-sheet. */
export const INTERIOR_RISER_TARGET_M = 0.18

/** Rentang kenyamanan SNI/praktik (satu-satunya tempat angka ini boleh hidup). */
export const STAIR_RISER_COMFORT_M: [number, number] = [0.15, 0.19]
export const STAIR_TREAD_COMFORT_M: [number, number] = [0.25, 0.3]
export const STAIR_2R_PLUS_T_M: [number, number] = [0.6, 0.65]
export const STAIR_MIN_WIDTH_M = 0.8

export function interiorStairSpec(
  room: Pick<Room, "width" | "depth" | "stairDirection" | "stairRiserM">,
  totalRiseM: number,
): InteriorStairSpec {
  const dir: StairDir =
    room.stairDirection ?? (room.width >= room.depth ? "e" : "s")
  const horizontalRun = dir === "w" || dir === "e"
  const runLenM = horizontalRun ? room.width : room.depth
  const widthM = horizontalRun ? room.depth : room.width
  // Override user hanya dipakai bila wajar; selain itu target historis 0.18.
  const target =
    typeof room.stairRiserM === "number" &&
    Number.isFinite(room.stairRiserM) &&
    room.stairRiserM > 0.05 &&
    room.stairRiserM < 0.5
      ? room.stairRiserM
      : INTERIOR_RISER_TARGET_M
  const steps = Math.max(3, Math.round(totalRiseM / target))
  return {
    dir,
    horizontalRun,
    runLenM,
    widthM,
    totalRiseM,
    steps,
    riserM: totalRiseM / steps,
    treadM: runLenM / steps,
  }
}

export type StairComfortIssue = { level: "warning" | "danger"; message: string }

/** Aturan kenyamanan SNI/praktik — pesan dalam istilah tukang (injakan/tanjakan). */
export function stairComfortIssues(spec: InteriorStairSpec): StairComfortIssue[] {
  const issues: StairComfortIssue[] = []
  const cm = (m: number) => Math.round(m * 100)
  if (spec.riserM < STAIR_RISER_COMFORT_M[0] || spec.riserM > STAIR_RISER_COMFORT_M[1]) {
    issues.push({
      level: "warning",
      message: `Tinggi tanjakan ${cm(spec.riserM)} cm di luar rentang nyaman 15–19 cm.`,
    })
  }
  if (spec.treadM < STAIR_TREAD_COMFORT_M[0] || spec.treadM > STAIR_TREAD_COMFORT_M[1]) {
    issues.push({
      level: "warning",
      message: `Lebar injakan ${cm(spec.treadM)} cm di luar rentang nyaman 25–30 cm — panjangkan ruang tangga atau ubah riser.`,
    })
  }
  const ratio = 2 * spec.riserM + spec.treadM
  if (ratio < STAIR_2R_PLUS_T_M[0] || ratio > STAIR_2R_PLUS_T_M[1]) {
    issues.push({
      level: "warning",
      message: `Rumus kenyamanan 2R+T = ${cm(ratio)} cm (ideal 60–65 cm).`,
    })
  }
  if (spec.widthM < STAIR_MIN_WIDTH_M) {
    issues.push({
      level: "danger",
      message: `Lebar tangga ${cm(spec.widthM)} cm — minimal 80 cm agar layak dilewati.`,
    })
  }
  return issues
}

export type StairShape = "lurus" | "L" | "U"
export type StairTurn = "kiri" | "kanan"

export type StairSegment = {
  kind: "run" | "landing"
  /** Rect plan-space (meter, koordinat tapak seperti Room). */
  x: number
  y: number
  width: number
  depth: number
  /** Arah naik segmen run; untuk landing = arah keluar (run berikutnya). */
  dir: StairDir
  /** Elevasi dasar & puncak segmen relatif lantai (m). Landing: sama. */
  elevStartM: number
  elevEndM: number
  steps?: number
  treadM?: number
  runLenM?: number
  /** Nomor anak pertama segmen (1-based) — penomoran menerus antar run. */
  firstStepNo?: number
}

export type InteriorStairLayout = {
  shape: StairShape
  degraded: boolean
  segments: StairSegment[]
  totalSteps: number
  riserM: number
  laneM: number
}

/** Run minimum agar bentuk L/U masuk akal; di bawah ini degradasi ke lurus. */
const MIN_RUN_M = 0.6

/** Vektor arah plan-space (y bertambah ke selatan — konvensi sideVec denah). */
const DIR_VEC: Record<StairDir, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
  e: { x: 1, y: 0 },
}
const DIR_OF_VEC = (v: { x: number; y: number }): StairDir =>
  v.x === 1 ? "e" : v.x === -1 ? "w" : v.y === 1 ? "s" : "n"

/**
 * Frame lokal tangga: a = jarak searah jalan (dir), b = jarak ke KANAN arah
 * jalan. Satu jalur matematika untuk 4 arah — rect lokal dipetakan balik ke
 * plan lewat dua sudut. `mirror` (belok kiri) mencerminkan sumbu b.
 */
function stairFrame(
  room: Pick<Room, "x" | "y" | "width" | "depth">,
  dir: StairDir,
  mirror: boolean,
) {
  const u = DIR_VEC[dir]
  const r = { x: -u.y, y: u.x } // kanan dari arah jalan
  const LA = u.x !== 0 ? room.width : room.depth
  const LB = u.x !== 0 ? room.depth : room.width
  const ox = room.x + (u.x < 0 || r.x < 0 ? room.width : 0)
  const oy = room.y + (u.y < 0 || r.y < 0 ? room.depth : 0)
  const toPlanPoint = (a: number, bRaw: number) => {
    const b = mirror ? LB - bRaw : bRaw
    return { x: ox + u.x * a + r.x * b, y: oy + u.y * a + r.y * b }
  }
  /** Rect lokal [a0,a1]×[b0,b1] → rect plan {x,y,width,depth}. */
  const toPlanRect = (a0: number, a1: number, b0: number, b1: number) => {
    const p = toPlanPoint(a0, b0)
    const q = toPlanPoint(a1, b1)
    return {
      x: round2(Math.min(p.x, q.x)),
      y: round2(Math.min(p.y, q.y)),
      width: round2(Math.abs(p.x - q.x)),
      depth: round2(Math.abs(p.y - q.y)),
    }
  }
  /** Arah plan dari arah lokal (+a = dir; +b = kanan; mirror membalik b). */
  const planDir = (local: "a+" | "a-" | "b+" | "b-"): StairDir => {
    if (local === "a+") return dir
    if (local === "a-") return DIR_OF_VEC({ x: -u.x, y: -u.y })
    const sign = (local === "b+") !== mirror ? 1 : -1
    return DIR_OF_VEC({ x: r.x * sign, y: r.y * sign })
  }
  return { LA, LB, toPlanRect, planDir }
}

/**
 * Layout segmen tangga: lurus (delegasi interiorStairSpec), L (run + bordes
 * kotak + run tegak lurus), U (dua run sejajar balik arah + bordes 2 lane).
 * Ruang terlalu kecil → degradasi aman ke lurus (degraded: true), tanpa error.
 */
export function interiorStairLayout(
  room: Pick<
    Room,
    "x" | "y" | "width" | "depth" | "stairDirection" | "stairRiserM" | "stairShape" | "stairTurn"
  >,
  totalRiseM: number,
): InteriorStairLayout {
  const spec = interiorStairSpec(room, totalRiseM)
  const shape: StairShape = room.stairShape ?? "lurus"

  const straight = (degraded: boolean): InteriorStairLayout => ({
    shape: "lurus",
    degraded,
    segments: [
      {
        kind: "run",
        x: room.x,
        y: room.y,
        width: room.width,
        depth: room.depth,
        dir: spec.dir,
        elevStartM: 0,
        elevEndM: totalRiseM,
        steps: spec.steps,
        treadM: spec.treadM,
        runLenM: spec.runLenM,
        firstStepNo: 1,
      },
    ],
    totalSteps: spec.steps,
    riserM: spec.riserM,
    laneM: spec.widthM,
  })
  if (shape === "lurus") return straight(false)

  const mirror = (room.stairTurn ?? "kanan") === "kiri"
  const frame = stairFrame(room, spec.dir, mirror)
  const { LA, LB } = frame
  const lane =
    shape === "U"
      ? Math.min(Math.max(round2(LB / 2), 0.6), 1.6)
      : Math.min(Math.max(round2(Math.min(LA, LB) / 2), 0.6), 1.6)
  const runLen = LA - lane
  if (runLen < MIN_RUN_M || (shape === "U" && 2 * lane > LB + 1e-6)) {
    return straight(true)
  }

  const len2 = shape === "L" ? LB - lane : runLen
  if (len2 < MIN_RUN_M) return straight(true)

  const totalSteps = spec.steps
  const riserM = totalRiseM / totalSteps
  const steps1 = Math.min(
    Math.max(Math.round((totalSteps * runLen) / (runLen + len2)), 1),
    totalSteps - 1,
  )
  const steps2 = totalSteps - steps1
  const elevLanding = steps1 * riserM

  // Rect lokal: run1 di b∈[0,lane] (sisi berlawanan belok — mirror menangani
  // kiri/kanan), bordes di ujung-A, run2 sesuai bentuk.
  const run1Rect = frame.toPlanRect(0, runLen, 0, lane)
  const landingRect =
    shape === "L"
      ? frame.toPlanRect(runLen, LA, 0, lane)
      : frame.toPlanRect(runLen, LA, 0, 2 * lane)
  const run2Rect =
    shape === "L"
      ? frame.toPlanRect(runLen, LA, lane, LB)
      : frame.toPlanRect(0, runLen, lane, 2 * lane)
  const run2Dir = shape === "L" ? frame.planDir("b+") : frame.planDir("a-")

  return {
    shape,
    degraded: false,
    segments: [
      {
        kind: "run",
        ...run1Rect,
        dir: spec.dir,
        elevStartM: 0,
        elevEndM: round2(elevLanding),
        steps: steps1,
        treadM: runLen / steps1,
        runLenM: runLen,
        firstStepNo: 1,
      },
      {
        kind: "landing",
        ...landingRect,
        dir: run2Dir,
        elevStartM: round2(elevLanding),
        elevEndM: round2(elevLanding),
      },
      {
        kind: "run",
        ...run2Rect,
        dir: run2Dir,
        elevStartM: round2(elevLanding),
        elevEndM: totalRiseM,
        steps: steps2,
        treadM: len2 / steps2,
        runLenM: len2,
        firstStepNo: steps1 + 1,
      },
    ],
    totalSteps,
    riserM,
    laneM: lane,
  }
}

export type StairProfilePt = { h: number; y: number }

/** Ketebalan pelat miring tangga beton (praktik umum 12 cm). */
export const STAIR_SLAB_T_M = 0.12

export type InteriorStairQuantities = {
  /** Volume beton: pelat miring 12 cm + prisma tiap anak. */
  concreteM3: number
  /** Luas finishing (injakan+tanjakan) × lebar × jumlah anak. */
  finishM2: number
  /** Panjang railing: 2 sisi × panjang miring. */
  railingM: number
}

/**
 * Kuantitas layout-aware: lurus = delegasi interiorStairQuantities; L/U =
 * jumlah pelat miring per run + prisma anak + pelat bordes. Railing L/U =
 * 2× panjang miring tiap run + keliling tiap bordes — konsisten dengan 3D
 * (build-model.ts menggambar railing di KEDUA sisi lateral tiap run + keliling
 * bordes, tanpa mengecek status dinding — lihat komentar di sana).
 */
export function interiorStairQuantitiesFromLayout(
  layout: InteriorStairLayout,
): InteriorStairQuantities {
  if (layout.shape === "lurus") {
    const seg = layout.segments[0]
    const spec: InteriorStairSpec = {
      dir: seg.dir,
      horizontalRun: seg.dir === "w" || seg.dir === "e",
      runLenM: seg.runLenM!,
      widthM: layout.laneM,
      totalRiseM: seg.elevEndM,
      steps: seg.steps!,
      riserM: seg.elevEndM / seg.steps!,
      treadM: seg.treadM!,
    }
    return interiorStairQuantities(spec)
  }
  let concreteM3 = 0
  let finishM2 = 0
  let railingM = 0
  for (const seg of layout.segments) {
    if (seg.kind === "landing") {
      concreteM3 += seg.width * seg.depth * STAIR_SLAB_T_M
      finishM2 += seg.width * seg.depth
      railingM += 2 * (seg.width + seg.depth)
      continue
    }
    const rise = seg.elevEndM - seg.elevStartM
    const slope = Math.sqrt(seg.runLenM! ** 2 + rise ** 2)
    const riser = rise / seg.steps!
    concreteM3 += slope * layout.laneM * STAIR_SLAB_T_M
    concreteM3 += seg.steps! * 0.5 * riser * seg.treadM! * layout.laneM
    finishM2 += seg.steps! * (seg.treadM! + riser) * layout.laneM
    railingM += 2 * slope
  }
  return { concreteM3, finishM2, railingM }
}

export function interiorStairQuantities(spec: InteriorStairSpec): InteriorStairQuantities {
  const slopeLen = Math.sqrt(spec.runLenM ** 2 + spec.totalRiseM ** 2)
  const slabM3 = slopeLen * spec.widthM * STAIR_SLAB_T_M
  // Tiap anak = prisma segitiga riser×tread/2 sepanjang lebar.
  const stepsM3 = spec.steps * 0.5 * spec.riserM * spec.treadM * spec.widthM
  return {
    concreteM3: slabM3 + stepsM3,
    finishM2: spec.steps * (spec.treadM + spec.riserM) * spec.widthM,
    railingM: 2 * slopeLen,
  }
}

/**
 * Titik profil potongan tangga (zig-zag riser→tread). `h` adalah sumbu
 * mendatar pada gambar (y dunia untuk potongan axis "x", x dunia untuk axis
 * "y"); `y` adalah tinggi (vertikal). `ascending=false` memutar arah run
 * ke h negatif (mis. tangga turun ke utara/barat).
 */
export function stairProfilePoints(
  spec: InteriorStairSpec,
  hStart: number,
  baseY: number,
  ascending: boolean,
): StairProfilePt[] {
  const dirSign = ascending ? 1 : -1
  const pts: StairProfilePt[] = [{ h: round2(hStart), y: round2(baseY) }]
  let h = hStart
  let y = baseY
  for (let s = 0; s < spec.steps; s++) {
    y = round2(baseY + spec.riserM * (s + 1))
    pts.push({ h: round2(h), y })
    h = hStart + dirSign * spec.treadM * (s + 1)
    pts.push({ h: round2(h), y })
  }
  return pts
}
