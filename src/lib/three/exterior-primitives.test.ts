import { describe, expect, it } from "vitest"

import {
  defaultModelRef,
  makeAssetElement,
  makeBoxElement,
  makeFrameElement,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "@/lib/exterior/factories"
import { exteriorElementPrimitives } from "./exterior-primitives"

const context = {
  centerX: 5,
  centerZ: 10,
  floorBaseY: new Map([["f2", 3.1]]),
}

describe("exteriorElementPrimitives", () => {
  it("maps a solid boundary segment into one stable semantic box", () => {
    const wall = makeSegmentElement("boundary_wall", { x: 1, y: 2 }, { x: 4, y: 6 }, {
      id: "wall-1",
      heightM: 1.8,
      thicknessM: 0.1,
    })
    const [prim] = exteriorElementPrimitives([wall], context)

    expect(prim.id).toBe("ext-wall-1")
    expect(prim.args).toEqual([5, 1.8, 0.1])
    expect(prim.pos).toEqual([-2.5, 0.9, -6])
    expect(prim.rotationY).toBeCloseTo(-Math.atan2(4, 3), 6)
    expect(prim.exteriorElement).toMatchObject({ id: "wall-1", kind: "boundary_wall" })
  })

  it("derives deterministic slats for native fence and gate frontage", () => {
    const gate = makeSegmentElement("sliding_gate", { x: 1, y: 2 }, { x: 4, y: 6 }, {
      id: "gate-1",
      heightM: 1.8,
      thicknessM: 0.1,
    })
    const prims = exteriorElementPrimitives([gate], context)

    expect(prims.map((prim) => prim.id).slice(0, 4)).toEqual([
      "ext-gate-1-rail-top",
      "ext-gate-1-rail-bottom",
      "ext-gate-1-post-start",
      "ext-gate-1-post-end",
    ])
    expect(prims).toHaveLength(22)
    expect(prims.filter((prim) => prim.id.includes("-slat-"))).toHaveLength(18)
    expect(prims.every((prim) => prim.exteriorElement?.id === "gate-1")).toBe(true)
    expect(prims.every((prim) => prim.exteriorElement?.kind === "sliding_gate")).toBe(true)
    expect(prims[0].rotationY).toBeCloseTo(-Math.atan2(4, 3), 6)
  })

  it("keeps custom GLB fence/gate as a single envelope fallback", () => {
    const gate = {
      ...makeSegmentElement("sliding_gate", { x: 1, y: 2 }, { x: 4, y: 6 }, {
      id: "custom-gate",
      heightM: 1.8,
      thicknessM: 0.1,
      }),
      model: { modelUrl: "/custom-gate.glb" },
    }
    const prims = exteriorElementPrimitives([gate], context)

    expect(prims).toHaveLength(1)
    expect(prims[0]).toMatchObject({
      id: "ext-custom-gate",
      args: [5, 1.8, 0.1],
      exteriorElement: {
        id: "custom-gate",
        kind: "sliding_gate",
        model: { modelUrl: "/custom-gate.glb" },
      },
    })
  })

  it("uses the owner-floor elevation and explicit z offset", () => {
    const panel = makeBoxElement("facade_panel", 5, 10, {
      id: "panel-1",
      floorId: "f2",
      zM: 0.4,
      widthM: 1,
      depthM: 0.2,
      heightM: 4,
    })
    const [prim] = exteriorElementPrimitives([panel], context)

    expect(prim.pos).toEqual([0, 5.5, 0])
    expect(prim.floorId).toBe("f2")
  })

  it("derives a portal as three members with one semantic owner", () => {
    const portal = makeFrameElement(5, 10, {
      id: "portal-1",
      widthM: 5,
      heightM: 3,
      memberSizeM: 0.3,
    })
    const prims = exteriorElementPrimitives([portal], context)

    expect(prims.map((prim) => prim.id)).toEqual([
      "ext-portal-1-left",
      "ext-portal-1-right",
      "ext-portal-1-top",
    ])
    expect(prims.every((prim) => prim.exteriorElement?.id === "portal-1")).toBe(true)
  })

  it("derives deterministic stair steps from the shared riser helper", () => {
    const stair = makeStairElement(1, 2, {
      id: "stair-1",
      widthM: 1.2,
      lengthM: 1.8,
      riseM: 0.9,
      direction: "e",
    })
    const prims = exteriorElementPrimitives([stair], context)

    const stepPrims = prims.filter((p) => p.id.includes("-step-"))
    expect(stepPrims).toHaveLength(5)
    expect(stepPrims[0].args[2]).toBe(1.2)
    expect(stepPrims.at(-1)?.pos[1]).toBeCloseTo(0.45, 6)
    // riseM 0.9 >= 0.6 → railing ikut dirender (Gelombang 2)
    expect(prims.some((p) => p.id.includes("-rail-"))).toBe(true)
  })

  it("keeps exact polygon points for driveway rendering", () => {
    const driveway = makeSurfaceElement("driveway", [
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 6 },
    ], { id: "drive-1" })
    const [prim] = exteriorElementPrimitives([driveway], context)

    expect(prim.surfacePoints).toEqual([
      [-4, -8],
      [-1, -8],
      [-1, -4],
    ])
  })

  it("maps semantic asset kinds to envelope fallback primitives with model metadata", () => {
    const tree = makeAssetElement(
      "tree",
      6,
      12,
      defaultModelRef({ modelAssetId: "asset-tree", modelUrl: "/tree.glb" }),
      { id: "tree-1", widthM: 1.4, depthM: 1.4, heightM: 3.2, rotationDeg: 15 }
    )
    const vehicle = makeAssetElement(
      "vehicle",
      4,
      12,
      defaultModelRef({ modelAssetId: "asset-car", modelUrl: "/car.glb" }),
      { id: "car-1", widthM: 2, depthM: 4, heightM: 1.5 }
    )
    const prims = exteriorElementPrimitives([tree, vehicle], context)

    expect(prims).toHaveLength(2)
    expect(prims[0]).toMatchObject({
      id: "ext-tree-1",
      kind: "exterior",
      args: [1.4, 3.2, 1.4],
      exteriorElement: {
        id: "tree-1",
        kind: "tree",
        model: { modelAssetId: "asset-tree", modelUrl: "/tree.glb" },
      },
    })
    expect(prims[0].rotationY).toBeCloseTo(-(15 * Math.PI) / 180, 6)
    expect(prims[1].exteriorElement).toMatchObject({ id: "car-1", kind: "vehicle" })
  })

  it("skips hidden and non-finite geometry instead of poisoning the scene", () => {
    const hidden = makeBoxElement("canopy", 5, 10, { id: "hidden", hidden: true })
    const invalid = makeBoxElement("column", 5, 10, { id: "invalid", widthM: Number.NaN })

    expect(exteriorElementPrimitives([hidden, invalid], context)).toEqual([])
  })
})

describe("fence/gate pattern (jeruji kustom, W: pagar panjang+rotasi+pola)", () => {
  it("tanpa pattern: spasi bilah adaptif lama TIDAK berubah (byte-identik)", () => {
    const gate = makeSegmentElement("sliding_gate", { x: 0, y: 0 }, { x: 5, y: 0 }, {
      id: "gate-legacy",
      heightM: 1.8,
      thicknessM: 0.1,
    })
    const prims = exteriorElementPrimitives([gate], context)
    expect(prims.filter((p) => p.id.includes("-slat-"))).toHaveLength(18)
  })

  it("pattern.pitchM eksplisit: jumlah jeruji = floor(panjang/pitch), sesuai patternBarOffsets", () => {
    const gate = {
      ...makeSegmentElement("sliding_gate", { x: 0, y: 0 }, { x: 4, y: 0 }, {
        id: "gate-pattern",
        heightM: 1.8,
        thicknessM: 0.1,
      }),
      pattern: { pitchM: 0.5 },
    }
    const prims = exteriorElementPrimitives([gate], context)
    const slats = prims.filter((p) => p.id.includes("-slat-"))
    expect(slats).toHaveLength(8) // 4 / 0.5
  })

  it("pattern.barWidthM eksplisit dipakai sebagai lebar jeruji", () => {
    const gate = {
      ...makeSegmentElement("pedestrian_gate", { x: 0, y: 0 }, { x: 2, y: 0 }, {
        id: "gate-barwidth",
        heightM: 1.8,
        thicknessM: 0.1,
      }),
      pattern: { pitchM: 0.4, barWidthM: 0.03 },
    }
    const prims = exteriorElementPrimitives([gate], context)
    const slats = prims.filter((p) => p.id.includes("-slat-"))
    expect(slats.length).toBeGreaterThan(0)
    expect(slats.every((p) => p.args[0] === 0.03)).toBe(true)
  })

  it("pattern absen pada boundary_wall (solid) — tak pernah merender jeruji", () => {
    const wall = {
      ...makeSegmentElement("boundary_wall", { x: 0, y: 0 }, { x: 4, y: 0 }, {
        id: "wall-pattern",
        heightM: 1.8,
        thicknessM: 0.2,
      }),
      pattern: { pitchM: 0.2 },
    }
    const prims = exteriorElementPrimitives([wall], context)
    expect(prims).toHaveLength(1)
    expect(prims[0].id).toBe("ext-wall-pattern")
  })
})

describe("pergola (kind box, kisi silang 2 arah)", () => {
  it("tanpa pattern: default pitch 0,4 m masuk akal — balok 2 arah + 4 kolom", () => {
    const pergola = makeBoxElement("pergola", 5, 10, {
      id: "pgl-1", widthM: 4, depthM: 3, heightM: 2.4,
    })
    const prims = exteriorElementPrimitives([pergola], context)

    const beamsX = prims.filter((p) => p.id.startsWith("ext-pgl-1-bx"))
    const beamsZ = prims.filter((p) => p.id.startsWith("ext-pgl-1-bz"))
    const posts = prims.filter((p) => p.id.startsWith("ext-pgl-1-post-"))
    expect(beamsX.length).toBeGreaterThan(0)
    expect(beamsZ.length).toBeGreaterThan(0)
    expect(posts).toHaveLength(4)
    expect(posts.every((p) => p.args[0] === 0.12 && p.args[2] === 0.12 && p.args[1] === 2.4)).toBe(true)
    expect(prims.every((p) => p.exteriorElement?.id === "pgl-1" && p.exteriorElement?.kind === "pergola")).toBe(true)
    // Tanpa frame → tak ada balok tepi.
    expect(prims.some((p) => p.id.includes("-frame-"))).toBe(false)
  })

  it("pattern.pitchM eksplisit: jumlah balok X/Z sesuai floor(span/pitch)", () => {
    const pergola = makeBoxElement("pergola", 5, 10, {
      id: "pgl-2", widthM: 4, depthM: 2, heightM: 2.4,
      pattern: { pitchM: 0.5 },
    })
    const prims = exteriorElementPrimitives([pergola], context)
    const beamsX = prims.filter((p) => p.id.startsWith("ext-pgl-2-bx")) // dispasi sepanjang depthM=2
    const beamsZ = prims.filter((p) => p.id.startsWith("ext-pgl-2-bz")) // dispasi sepanjang widthM=4
    expect(beamsX).toHaveLength(4) // 2 / 0.5
    expect(beamsZ).toHaveLength(8) // 4 / 0.5
    expect(beamsX.every((p) => p.args[0] === 4)).toBe(true) // panjang penuh widthM
    expect(beamsZ.every((p) => p.args[2] === 2)).toBe(true) // panjang penuh depthM
  })

  it("posts:false — tanpa kolom penyangga", () => {
    const pergola = makeBoxElement("pergola", 5, 10, {
      id: "pgl-3", widthM: 3, depthM: 3, heightM: 2.4, posts: false,
    })
    const prims = exteriorElementPrimitives([pergola], context)
    expect(prims.some((p) => p.id.includes("-post-"))).toBe(false)
  })

  it("orientation v: hanya balok arah Z (dispasi sepanjang X), tanpa balok arah X", () => {
    const pergola = makeBoxElement("pergola", 5, 10, {
      id: "pgl-4", widthM: 3, depthM: 3, heightM: 2.4,
      pattern: { orientation: "v", pitchM: 0.5 },
    })
    const prims = exteriorElementPrimitives([pergola], context)
    expect(prims.some((p) => p.id.startsWith("ext-pgl-4-bz"))).toBe(true)
    expect(prims.some((p) => p.id.startsWith("ext-pgl-4-bx"))).toBe(false)
  })

  it("pattern.frame: menambah 4 balok tepi (frame-n/s/w/e)", () => {
    const pergola = makeBoxElement("pergola", 5, 10, {
      id: "pgl-5", widthM: 3, depthM: 3, heightM: 2.4,
      pattern: { pitchM: 0.5, frame: true },
    })
    const prims = exteriorElementPrimitives([pergola], context)
    expect(prims.some((p) => p.id === "ext-pgl-5-frame-n")).toBe(true)
    expect(prims.some((p) => p.id === "ext-pgl-5-frame-s")).toBe(true)
    expect(prims.some((p) => p.id === "ext-pgl-5-frame-w")).toBe(true)
    expect(prims.some((p) => p.id === "ext-pgl-5-frame-e")).toBe(true)
  })

  it("custom GLB (model.modelUrl): satu envelope box, bukan balok berulang", () => {
    const pergola = {
      ...makeBoxElement("pergola", 5, 10, { id: "pgl-6", widthM: 3, depthM: 3, heightM: 2.4 }),
      model: { modelUrl: "/pergola.glb" },
    }
    const prims = exteriorElementPrimitives([pergola], context)
    expect(prims).toHaveLength(1)
    expect(prims[0].id).toBe("ext-pgl-6")
    expect(prims[0].args).toEqual([3, 2.4, 3])
  })

  it("skips non-finite geometry (widthM/depthM/heightM tak valid)", () => {
    const invalid = makeBoxElement("pergola", 5, 10, { id: "pgl-invalid", widthM: Number.NaN })
    expect(exteriorElementPrimitives([invalid], context)).toEqual([])
  })
})

describe("chimney (kind box, badan + cap penutup)", () => {
  it("menghasilkan badan box + cap lebih lebar di puncak badan", () => {
    const chimney = makeBoxElement("chimney", 5, 10, {
      id: "chm-1",
      widthM: 0.6,
      depthM: 0.6,
      heightM: 1.6,
    })
    const prims = exteriorElementPrimitives([chimney], context)

    expect(prims).toHaveLength(2)
    const [body, cap] = prims
    expect(body.id).toBe("ext-chm-1")
    expect(body.args).toEqual([0.6, 1.6, 0.6])
    expect(body.exteriorElement).toMatchObject({ id: "chm-1", kind: "chimney" })

    expect(cap.id).toBe("ext-chm-1-cap")
    expect(cap.exteriorElement).toMatchObject({ id: "chm-1", kind: "chimney" })
    // Cap lebih lebar dari badan di kedua sumbu horizontal.
    expect(cap.args[0]).toBeGreaterThan(body.args[0])
    expect(cap.args[2]).toBeGreaterThan(body.args[2])
    // Cap duduk di puncak badan: dasar cap (posY - tebal/2) >= puncak badan (posY body + heightM/2).
    const capBaseY = cap.pos[1] - cap.args[1] / 2
    const bodyTopY = body.pos[1] + body.args[1] / 2
    expect(capBaseY).toBeCloseTo(bodyTopY, 6)
  })

  it("skips hidden/non-finite geometry seperti box lain", () => {
    const invalid = makeBoxElement("chimney", 5, 10, { id: "chm-invalid", widthM: Number.NaN })
    expect(exteriorElementPrimitives([invalid], context)).toEqual([])
  })
})

describe("exterior stair railing (Gelombang 2)", () => {
  it("riseM >= 0.6 merender handrail dua sisi + post", () => {
    const el = makeStairElement(2, 2) // default rise 3 → railing wajib
    const prims = exteriorElementPrimitives([el], context)
    expect(prims.some((p) => p.id.includes("-rail-a-"))).toBe(true)
    expect(prims.some((p) => p.id.includes("-rail-b-"))).toBe(true)
    expect(prims.some((p) => p.id.includes("-railpost-"))).toBe(true)
  })

  it("undakan pendek (riseM < 0.6) tanpa railing", () => {
    const el = makeStairElement(2, 2, { riseM: 0.35, lengthM: 1 })
    const prims = exteriorElementPrimitives([el], context)
    expect(prims.some((p) => p.id.includes("-rail-"))).toBe(false)
  })
})
