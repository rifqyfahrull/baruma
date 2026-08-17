import type {
  ExteriorBoxElement,
  ExteriorAssetElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorGableFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
} from "@/types"
import { segmentLength, stairRiserM, stairStepCount, stairTreadM } from "@/lib/exterior/geometry"
import type { Prim } from "@/lib/three/build-model"
import {
  patternBarOffsets,
  resolveBarDepthM,
  resolveBarWidthM,
  resolveOrientation,
  resolvePitchM,
  wantsFrame,
} from "@/lib/three/component-pattern"

export type ExteriorPrimitiveContext = {
  centerX: number
  centerZ: number
  floorBaseY: ReadonlyMap<string, number>
}

const MIN_M = 0.001
const SLATTED_SEGMENT_KINDS = new Set<ExteriorSegmentElement["kind"]>([
  "fence",
  "sliding_gate",
  "swing_gate",
  "pedestrian_gate",
])
const SLAT_TARGET_SPACING_M = 0.28
const MAX_SLATS_PER_SEGMENT = 80

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > MIN_M
}

function baseY(element: ExteriorElement, context: ExteriorPrimitiveContext): number {
  const floorY = element.floorId ? (context.floorBaseY.get(element.floorId) ?? 0) : 0
  const zM = "zM" in element && Number.isFinite(element.zM) ? (element.zM ?? 0) : 0
  return floorY + zM
}

function metadata(element: ExteriorElement): Prim["exteriorElement"] {
  return {
    id: element.id,
    kind: element.kind,
    model: element.model,
    material: element.material,
  }
}

function segmentPrimitive(
  element: ExteriorSegmentElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  const length = segmentLength(element.start, element.end)
  const thickness = element.thicknessM ?? 0.08
  if (!finitePositive(length) || !finitePositive(element.heightM) || !finitePositive(thickness)) return []
  const angle = Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x)
  return [{
    id: `ext-${element.id}`,
    kind: "exterior",
    floorId: element.floorId ?? null,
    exteriorElement: metadata(element),
    rotationY: -angle,
    pos: [
      (element.start.x + element.end.x) / 2 - context.centerX,
      baseY(element, context) + element.heightM / 2,
      (element.start.y + element.end.y) / 2 - context.centerZ,
    ],
    args: [length, element.heightM, thickness],
  }]
}

function slattedSegmentPrimitives(
  element: ExteriorSegmentElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  if (!SLATTED_SEGMENT_KINDS.has(element.kind) || element.model?.modelUrl) {
    return segmentPrimitive(element, context)
  }

  const length = segmentLength(element.start, element.end)
  const thickness = element.thicknessM ?? 0.08
  if (!finitePositive(length) || !finitePositive(element.heightM) || !finitePositive(thickness)) return []

  const angle = Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x)
  const ux = (element.end.x - element.start.x) / length
  const uz = (element.end.y - element.start.y) / length
  const centerX = (element.start.x + element.end.x) / 2
  const centerZ = (element.start.y + element.end.y) / 2
  const y0 = baseY(element, context)
  const owner = metadata(element)
  const rotationY = -angle

  const atLocalX = (localX: number, y: number, args: [number, number, number], suffix: string): Prim => ({
    id: `ext-${element.id}-${suffix}`,
    kind: "exterior",
    floorId: element.floorId ?? null,
    exteriorElement: owner,
    rotationY,
    pos: [
      centerX + ux * localX - context.centerX,
      y0 + y,
      centerZ + uz * localX - context.centerZ,
    ],
    args,
  })

  const railH = Math.min(0.12, Math.max(0.06, element.heightM * 0.08))
  const postW = Math.min(0.18, Math.max(0.08, thickness * 1.8))
  const slatH = Math.max(railH, element.heightM - railH * 0.6)
  const slatCenterY = element.heightM / 2
  const railDepth = Math.max(thickness, thickness * 1.15)
  const prims: Prim[] = [
    atLocalX(0, element.heightM * 0.82, [length, railH, railDepth], "rail-top"),
    atLocalX(0, element.heightM * 0.18, [length, railH, railDepth], "rail-bottom"),
    atLocalX(-length / 2 + postW / 2, element.heightM / 2, [postW, element.heightM, railDepth], "post-start"),
    atLocalX(length / 2 - postW / 2, element.heightM / 2, [postW, element.heightM, railDepth], "post-end"),
  ]

  // Pola jeruji KUSTOM (pitch/lebar/rhythm) — dipakai gerbang jeruji rapat
  // prototipe tropis. Absen `pattern` (SELURUH kunci) = jalur numerik lama
  // (spasi adaptif ~SLAT_TARGET_SPACING_M) byte-identik dgn sebelum W-ini.
  const pattern = element.pattern
  if (pattern) {
    const pitch = resolvePitchM(pattern, SLAT_TARGET_SPACING_M)
    const barW = resolveBarWidthM(pattern, Math.min(0.08, Math.max(0.04, pitch * 0.35)))
    const barD = resolveBarDepthM(pattern, thickness)
    const offsets = patternBarOffsets(length, pitch, pattern.rhythm).slice(0, MAX_SLATS_PER_SEGMENT)
    offsets.forEach((localX, index) => {
      prims.push(atLocalX(localX, slatCenterY, [barW, slatH, barD], `slat-${String(index).padStart(2, "0")}`))
    })
    return prims
  }

  const slatCount = Math.max(2, Math.min(MAX_SLATS_PER_SEGMENT, Math.round(length / SLAT_TARGET_SPACING_M)))
  const slatSpacing = length / slatCount
  const slatW = Math.min(0.08, Math.max(0.04, slatSpacing * 0.35))

  for (let index = 0; index < slatCount; index += 1) {
    const localX = -length / 2 + slatSpacing * (index + 0.5)
    prims.push(atLocalX(localX, slatCenterY, [slatW, slatH, thickness], `slat-${String(index).padStart(2, "0")}`))
  }

  return prims
}

function boxPrimitive(
  element: ExteriorBoxElement | ExteriorAssetElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  if (![element.widthM, element.depthM, element.heightM].every(finitePositive)) return []
  return [{
    id: `ext-${element.id}`,
    kind: "exterior",
    floorId: element.floorId ?? null,
    exteriorElement: metadata(element),
    rotationY: -((element.rotationDeg ?? 0) * Math.PI) / 180,
    pos: [
      element.x - context.centerX,
      baseY(element, context) + element.heightM / 2,
      element.y - context.centerZ,
    ],
    args: [element.widthM, element.heightM, element.depthM],
  }]
}

const CHIMNEY_CAP_OVERHANG_M = 0.12
const CHIMNEY_CAP_THICKNESS_M = 0.08

/**
 * CEROBONG (kind "chimney" — box element): badan box parametrik sama seperti
 * `column`, ditambah CAP/topi penutup tipis menonjol di puncak (ciri visual
 * cerobong, low-poly) — box tipis +0,12 m tiap sisi dari badan (widthM/
 * depthM), tebal 0,08 m, duduk tepat di atas `heightM` badan. Prim `kind`
 * tetap "exterior" sama seperti box lain (tidak menambah `PrimKind` baru).
 */
function chimneyPrimitives(
  element: ExteriorBoxElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  const body = boxPrimitive(element, context)
  if (body.length === 0) return []
  const cap: Prim = {
    id: `ext-${element.id}-cap`,
    kind: "exterior",
    floorId: element.floorId ?? null,
    exteriorElement: metadata(element),
    rotationY: -((element.rotationDeg ?? 0) * Math.PI) / 180,
    pos: [
      element.x - context.centerX,
      baseY(element, context) + element.heightM + CHIMNEY_CAP_THICKNESS_M / 2,
      element.y - context.centerZ,
    ],
    args: [
      element.widthM + CHIMNEY_CAP_OVERHANG_M * 2,
      CHIMNEY_CAP_THICKNESS_M,
      element.depthM + CHIMNEY_CAP_OVERHANG_M * 2,
    ],
  }
  return [...body, cap]
}

const PERGOLA_DEFAULT_PITCH_M = 0.4
const PERGOLA_DEFAULT_BAR_WIDTH_M = 0.08
const PERGOLA_DEFAULT_BAR_DEPTH_M = 0.08
const PERGOLA_POST_SIZE_M = 0.12

/**
 * PERGOLA (kind "pergola" — box element, box kind lain lihat `boxPrimitive`):
 * kisi silang 2 arah horizontal di elevasi `heightM` dari dasar — BUKAN box
 * tunggal seperti kind lain. `pattern` (ComponentPatternSpec) opsional:
 * `orientation` default "cross" (balok arah X PENUH widthM + balok arah Z
 * PENUH depthM, "kisi anyaman 2 arah"); "v" = balok arah Z saja (dispasi
 * sepanjang X, ala rafter utara-selatan); "h" = balok arah X saja (dispasi
 * sepanjang Z); "grid" = sama seperti "cross". Tanpa pattern → pitch 0,4 m,
 * penampang balok 0,08×0,08 m (lihat `PERGOLA_DEFAULT_*`). Balok arah Z
 * ditumpuk SATU lapis (`barD`) di atas balok arah X (low-poly, bukan
 * anyaman over/under sungguhan) supaya tak z-fighting.
 *
 * `posts` (absen/true) = 4 kolom penyangga 0,12×0,12 m di sudut footprint,
 * dari dasar sampai `heightM`. `posts:false` = tanpa kolom. `pattern.frame`
 * = 4 balok tepi mengelilingi footprint di lapisan paling atas.
 *
 * Custom GLB (`model.modelUrl`) → SATU box envelope (hindari model
 * terduplikasi per balok), pola sama dengan `slattedSegmentPrimitives`.
 */
function pergolaPrimitives(
  element: ExteriorBoxElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  if (![element.widthM, element.depthM, element.heightM].every(finitePositive)) return []
  if (element.model?.modelUrl) return boxPrimitive(element, context)

  const owner = metadata(element)
  const y0 = baseY(element, context)
  const centerX = element.x - context.centerX
  const centerZ = element.y - context.centerZ
  const rotationY = -((element.rotationDeg ?? 0) * Math.PI) / 180
  const floorId = element.floorId ?? null

  const pattern = element.pattern
  const pitch = resolvePitchM(pattern, PERGOLA_DEFAULT_PITCH_M)
  const barW = resolveBarWidthM(pattern, PERGOLA_DEFAULT_BAR_WIDTH_M)
  const barD = resolveBarDepthM(pattern, PERGOLA_DEFAULT_BAR_DEPTH_M)
  const orientation = resolveOrientation(pattern, "cross")
  const showAlongX = orientation === "h" || orientation === "grid" || orientation === "cross"
  const showAlongZ = orientation === "v" || orientation === "grid" || orientation === "cross"

  const rotateOffset = (localX: number, localZ: number): [number, number] => [
    localX * Math.cos(rotationY) - localZ * Math.sin(rotationY),
    localX * Math.sin(rotationY) + localZ * Math.cos(rotationY),
  ]

  const member = (
    suffix: string,
    localX: number,
    localZ: number,
    y: number,
    args: [number, number, number],
  ): Prim => {
    const [dx, dz] = rotateOffset(localX, localZ)
    return {
      id: `ext-${element.id}-${suffix}`,
      kind: "exterior",
      floorId,
      exteriorElement: owner,
      rotationY,
      pos: [centerX + dx, y, centerZ + dz],
      args,
    }
  }

  const prims: Prim[] = []

  // Balok arah X (sejajar lebar, penuh widthM) — dispasi sepanjang depthM,
  // lapisan BAWAH (langsung di atas kolom).
  if (showAlongX) {
    const offsets = patternBarOffsets(element.depthM, pitch, pattern?.rhythm)
    offsets.forEach((z, i) => {
      prims.push(member(`bx${i}`, 0, z, y0 + element.heightM + barD / 2, [element.widthM, barD, barW]))
    })
  }
  // Balok arah Z (sejajar dalam, penuh depthM) — dispasi sepanjang widthM,
  // lapisan ATAS (bertumpuk 1× barD di atas balok arah X).
  if (showAlongZ) {
    const offsets = patternBarOffsets(element.widthM, pitch, pattern?.rhythm)
    offsets.forEach((x, i) => {
      prims.push(member(`bz${i}`, x, 0, y0 + element.heightM + barD * 1.5, [barW, barD, element.depthM]))
    })
  }

  // Bingkai keliling (pattern.frame=true) — 4 balok tepi mengelilingi
  // footprint, lapisan PALING ATAS (di atas kedua lapis balok kisi).
  if (wantsFrame(pattern)) {
    const yFrame = y0 + element.heightM + barD * 2.5
    const hw = element.widthM / 2
    const hd = element.depthM / 2
    prims.push(member("frame-n", 0, -hd, yFrame, [element.widthM + barW, barD, barW]))
    prims.push(member("frame-s", 0, hd, yFrame, [element.widthM + barW, barD, barW]))
    prims.push(member("frame-w", -hw, 0, yFrame, [barW, barD, element.depthM + barW]))
    prims.push(member("frame-e", hw, 0, yFrame, [barW, barD, element.depthM + barW]))
  }

  // 4 kolom penyangga sudut (default true; posts:false = tanpa kolom).
  if (element.posts !== false) {
    const halfW = element.widthM / 2 - PERGOLA_POST_SIZE_M / 2
    const halfD = element.depthM / 2 - PERGOLA_POST_SIZE_M / 2
    if (halfW > 0 && halfD > 0) {
      const corners: Array<[string, number, number]> = [
        ["nw", -halfW, -halfD],
        ["ne", halfW, -halfD],
        ["sw", -halfW, halfD],
        ["se", halfW, halfD],
      ]
      for (const [tag, lx, lz] of corners) {
        prims.push(
          member(`post-${tag}`, lx, lz, y0 + element.heightM / 2, [
            PERGOLA_POST_SIZE_M,
            element.heightM,
            PERGOLA_POST_SIZE_M,
          ]),
        )
      }
    }
  }

  return prims
}

/** BINGKAI GABLE (W4): satu prim `exterior` ber-payload `gableFrame` —
 * renderer & GLB memakai buildGableFrameGeometry (outline pelana asimetris),
 * bukan box. Origin prim = tengah-dasar bingkai (paritas wall_gable). */
function gableFramePrimitives(
  element: ExteriorGableFrameElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  const depth = element.depthM ?? 0.5
  if (
    ![element.widthM, element.heightM, element.eaveLeftM, element.eaveRightM, element.memberSizeM, depth].every(finitePositive) ||
    element.memberSizeM * 4 >= element.widthM ||
    Math.max(element.eaveLeftM, element.eaveRightM) >= element.heightM
  ) return []

  const theta = -((element.rotationDeg ?? 0) * Math.PI) / 180
  return [{
    id: `ext-${element.id}-frame`,
    kind: "exterior",
    floorId: element.floorId ?? null,
    exteriorElement: metadata(element),
    rotationY: theta,
    pos: [element.x - context.centerX, baseY(element, context), element.y - context.centerZ],
    args: [element.widthM, element.heightM, depth],
    gableFrame: {
      eaveLeftM: element.eaveLeftM,
      eaveRightM: element.eaveRightM,
      apexOffsetM: element.apexOffsetM ?? 0,
      memberM: element.memberSizeM,
    },
  }]
}

function framePrimitives(
  element: ExteriorFrameElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  const depth = element.depthM ?? 0.3
  if (
    ![element.widthM, element.heightM, element.memberSizeM, depth].every(finitePositive) ||
    element.memberSizeM * 2 >= Math.min(element.widthM, element.heightM)
  ) return []

  const theta = -((element.rotationDeg ?? 0) * Math.PI) / 180
  const centerX = element.x - context.centerX
  const centerZ = element.y - context.centerZ
  const y0 = baseY(element, context)
  const rotateOffset = (localX: number): [number, number] => [
    localX * Math.cos(theta),
    -localX * Math.sin(theta),
  ]
  const member = (
    suffix: string,
    localX: number,
    y: number,
    width: number,
    height: number,
  ): Prim => {
    const [dx, dz] = rotateOffset(localX)
    return {
      id: `ext-${element.id}-${suffix}`,
      kind: "exterior",
      floorId: element.floorId ?? null,
      exteriorElement: metadata(element),
      rotationY: theta,
      pos: [centerX + dx, y0 + y, centerZ + dz],
      args: [width, height, depth],
    }
  }

  const sideX = element.widthM / 2 - element.memberSizeM / 2
  return [
    member("left", -sideX, element.heightM / 2, element.memberSizeM, element.heightM),
    member("right", sideX, element.heightM / 2, element.memberSizeM, element.heightM),
    member(
      "top",
      0,
      element.heightM - element.memberSizeM / 2,
      Math.max(element.memberSizeM, element.widthM - element.memberSizeM * 2),
      element.memberSizeM,
    ),
  ]
}

function stairPrimitives(
  element: ExteriorStairElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  const steps = stairStepCount(element)
  const tread = stairTreadM(element)
  const riser = stairRiserM(element)
  if (steps <= 0 || !finitePositive(tread) || !finitePositive(riser) || !finitePositive(element.widthM)) return []
  const vector = {
    n: { x: 0, z: 1 },
    s: { x: 0, z: -1 },
    e: { x: 1, z: 0 },
    w: { x: -1, z: 0 },
  }[element.direction]
  const alongX = vector.x !== 0
  const y0 = baseY(element, context)
  const prims: Prim[] = Array.from({ length: steps }, (_, index) => {
    const height = riser * (index + 1)
    const distance = tread * (index + 0.5)
    return {
      id: `ext-${element.id}-step-${index}`,
      kind: "exterior" as const,
      floorId: element.floorId ?? null,
      exteriorElement: metadata(element),
      pos: [
        element.x + vector.x * distance - context.centerX,
        y0 + height / 2,
        element.y + vector.z * distance - context.centerZ,
      ] as [number, number, number],
      args: (alongX
        ? [tread, height, element.widthM]
        : [element.widthM, height, tread]) as [number, number, number],
    }
  })
  // Handrail 0,9 m dua sisi bila total naik >= 0.6 m (3-4 anak) — paritas
  // dengan tangga interior; undakan taman pendek tidak butuh railing.
  if (element.riseM >= 0.6) {
    for (let index = 0; index < steps; index++) {
      const height = riser * (index + 1)
      const distance = tread * (index + 0.5)
      const railY = y0 + height + 0.9
      for (const [tag, edge] of [["a", 0.04], ["b", element.widthM - 0.04]] as const) {
        const px = alongX
          ? element.x + vector.x * distance
          : element.x - element.widthM / 2 + edge
        const pz = alongX
          ? element.y - element.widthM / 2 + edge
          : element.y + vector.z * distance
        prims.push({
          id: `ext-${element.id}-rail-${tag}-${index}`,
          kind: "exterior" as const,
          floorId: element.floorId ?? null,
          exteriorElement: metadata(element),
          pos: [px - context.centerX, railY, pz - context.centerZ],
          args: alongX ? [tread + 0.02, 0.05, 0.05] : [0.05, 0.05, tread + 0.02],
        })
        if (index % 3 === 0) {
          prims.push({
            id: `ext-${element.id}-railpost-${tag}-${index}`,
            kind: "exterior" as const,
            floorId: element.floorId ?? null,
            exteriorElement: metadata(element),
            pos: [px - context.centerX, y0 + height + 0.45, pz - context.centerZ],
            args: [0.04, 0.9, 0.04],
          })
        }
      }
    }
  }
  return prims
}

function surfacePrimitive(
  element: ExteriorSurfaceElement,
  context: ExteriorPrimitiveContext,
): Prim[] {
  if (element.points.length < 3) return []
  const points = element.points.map((point) => [
    point.x - context.centerX,
    point.y - context.centerZ,
  ] as [number, number])
  if (points.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) return []
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return [{
    id: `ext-${element.id}`,
    kind: "exterior",
    floorId: element.floorId ?? null,
    exteriorElement: metadata(element),
    surfacePoints: points,
    pos: [0, baseY(element, context) + (element.thicknessM ?? 0.02) + 0.005, 0],
    args: [Math.max(MIN_M, maxX - minX), Math.max(MIN_M, element.thicknessM ?? 0.02), Math.max(MIN_M, maxZ - minZ)],
  }]
}

export function exteriorElementPrimitives(
  elements: readonly ExteriorElement[],
  context: ExteriorPrimitiveContext,
): Prim[] {
  const primitives: Prim[] = []
  for (const element of elements) {
    if (element.hidden || !element.id) continue
    switch (element.kind) {
      case "boundary_wall":
      case "fence":
      case "sliding_gate":
      case "swing_gate":
      case "pedestrian_gate":
        primitives.push(...slattedSegmentPrimitives(element, context))
        break
      case "solid_wall":
      case "facade_panel":
      case "column":
      case "beam":
      case "slab":
      case "canopy":
      case "overhang_slab":
      case "planter":
      case "asset":
      case "plant":
      case "tree":
      case "exterior_decor":
      case "vehicle":
        primitives.push(...boxPrimitive(element, context))
        break
      case "pergola":
        primitives.push(...pergolaPrimitives(element, context))
        break
      case "chimney":
        primitives.push(...chimneyPrimitives(element, context))
        break
      case "portal_frame":
        primitives.push(...framePrimitives(element, context))
        break
      case "gable_frame":
        primitives.push(...gableFramePrimitives(element, context))
        break
      case "exterior_stair":
        primitives.push(...stairPrimitives(element, context))
        break
      case "driveway":
      case "walkway":
      case "terrace_surface":
      case "garden_bed":
        primitives.push(...surfacePrimitive(element, context))
        break
    }
  }
  return primitives
}
