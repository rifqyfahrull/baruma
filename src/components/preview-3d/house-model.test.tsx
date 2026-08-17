import { cleanup, render } from "@testing-library/react"
import type * as React from "react"
import { BoxGeometry, Mesh, Object3D } from "three"
import { afterEach, describe, it, expect, vi } from "vitest"

const dreiMock = vi.hoisted(() => ({
  useGLTF: vi.fn(),
}))

vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children: React.ReactNode }) => children,
  useGLTF: Object.assign(dreiMock.useGLTF, { preload: vi.fn() }),
}))

import {
  ExteriorPrimitiveMesh,
  lampAim,
  sceneFurnitureHeight,
  WALL_LAMP_BODY_ARGS,
  wallLampFixturePosition,
} from "./house-model"
import type { PlacedFurniture } from "@/types"
import { WALL_T, type Prim } from "@/lib/three/build-model"
import type { PrimMaterial } from "@/lib/three/surface"

const item = (over: Partial<PlacedFurniture>): PlacedFurniture => ({
  id: "f1", furnitureId: "custom-x", roomId: "r1", name: "X", category: "decor",
  x: 0, y: 0, rotationDeg: 0, widthM: 1.74, depthM: 4.1, heightM: 1.86,
  locked: false, priceRange: { low: 0, mid: 0, high: 0 },
  ...over,
})

const exteriorPrim = (over: Partial<Prim> = {}): Prim => ({
  id: "prim-ext-1",
  kind: "exterior",
  floorId: "floor-1",
  pos: [1, 0.75, 2],
  args: [2, 1.5, 0.25],
  rotationY: Math.PI / 4,
  exteriorElement: {
    id: "ext-custom-facade",
    kind: "facade_panel",
    model: { modelUrl: "/api/v1/assets/file/missing.glb" },
  },
  ...over,
})

const primMat: PrimMaterial = {
  color: "#9ca3af",
  map: null,
  roughness: 0.7,
  metalness: 0.1,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  dreiMock.useGLTF.mockReset()
})

describe("sceneFurnitureHeight — dekorasi pipih vs model 3D kustom", () => {
  it("decor TANPA model → pipih 0.04 (karpet dsb.)", () => {
    expect(sceneFurnitureHeight(item({ category: "decor" }))).toBe(0.04)
    expect(sceneFurnitureHeight(item({ furnitureId: "rug-large", category: "table" as PlacedFurniture["category"] }))).toBe(0.04)
  })

  it("decor DENGAN GLB (aset kustom, mis. mobil) → tinggi asli, bukan 4 cm", () => {
    // Regresi Rumah Qyfa: Avanza (generic→decor) menyusut jadi 9 cm karena
    // fit GLB memakai skala minimum semua sumbu dan tinggi dipaksa 0.04.
    expect(sceneFurnitureHeight(item({ modelUrl: "/api/v1/assets/file/x.glb" }))).toBe(1.86)
    expect(sceneFurnitureHeight(item({ modelAssetId: "asset-1" }))).toBe(1.86)
  })

  it("tinggi tetap di-clamp [0.08, 2.4]", () => {
    expect(sceneFurnitureHeight(item({ modelAssetId: "a", heightM: 5 }))).toBe(2.4)
    expect(sceneFurnitureHeight(item({ category: "table" as PlacedFurniture["category"], heightM: 0.01 }))).toBe(0.08)
  })
})

describe("ExteriorPrimitiveMesh — custom GLB frontage fallback", () => {
  it("renders the envelope box when the exterior element has no model URL", () => {
    const { container } = render(
      <ExteriorPrimitiveMesh
        prim={exteriorPrim({ exteriorElement: { id: "ext-box", kind: "portal_frame" } })}
        mat={primMat}
        selected={false}
        onSelect={() => {}}
        setCursor={() => {}}
      />,
    )

    expect(container.querySelector("boxgeometry")).toBeTruthy()
    expect(dreiMock.useGLTF).not.toHaveBeenCalled()
  })

  it("keeps a clickable envelope fallback when the custom GLB cannot load", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    dreiMock.useGLTF.mockImplementation(() => {
      throw new Error("missing GLB")
    })

    const { container } = render(
      <ExteriorPrimitiveMesh
        prim={exteriorPrim()}
        mat={primMat}
        selected
        onSelect={() => {}}
        setCursor={() => {}}
      />,
    )

    expect(dreiMock.useGLTF).toHaveBeenCalledWith("/api/v1/assets/file/missing.glb", "/draco/")
    expect(container.querySelector("boxgeometry")).toBeTruthy()
    expect(errorSpy).toHaveBeenCalled()
  })

  it("fits a loaded custom GLB inside the exterior envelope instead of losing semantic selection", () => {
    const scene = new Object3D()
    scene.add(new Mesh(new BoxGeometry(1, 1, 1)))
    dreiMock.useGLTF.mockReturnValue({ scene })

    const { container } = render(
      <ExteriorPrimitiveMesh
        prim={exteriorPrim()}
        mat={primMat}
        selected={false}
        onSelect={() => {}}
        setCursor={() => {}}
      />,
    )

    expect(dreiMock.useGLTF).toHaveBeenCalledWith("/api/v1/assets/file/missing.glb", "/draco/")
    expect(container.querySelector("primitive")).toBeTruthy()
    expect(container.querySelector("group")).toBeTruthy()
  })
})

describe("lampAim — kerucut cahaya lampu eksterior tidak menembus dinding", () => {
  it("lampu dinding: (sudut sumbu dari normal) + (setengah bukaan) < 90° untuk semua sisi", () => {
    // Jaminan geometris: seluruh kerucut spot berada di sisi LUAR bidang
    // dinding — regresi "lampu di luar, cahayanya masuk ke dalam ruangan".
    const OUT: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }
    for (const side of ["n", "s", "w", "e"] as const) {
      const { aim, angle } = lampAim("wall", side)
      const [ox, oz] = OUT[side]
      const outward = aim[0] * ox + aim[2] * oz // komponen searah normal keluar
      expect(outward).toBeGreaterThan(0)
      const axisLen = Math.hypot(aim[0], aim[1], aim[2])
      const axisFromNormal = Math.acos(outward / axisLen)
      expect(axisFromNormal + angle).toBeLessThan(Math.PI / 2)
    }
  })

  it("kanopi & bollard mengarah lurus ke bawah", () => {
    expect(lampAim("canopy").aim).toEqual([0, -2, 0])
    expect(lampAim("bollard").aim).toEqual([0, -1, 0])
  })
})

describe("wallLampFixturePosition — BUG B: fixture lampu dinding tak boleh terkubur di dinding", () => {
  it("muka-dalam box fixture berada DI LUAR muka luar dinding (WALL_T/2) di semua sisi", () => {
    // Regresi: standoff lama (0,1 m dari centerline) < WALL_T/2 (0,06) +
    // separuh kedalaman box (0,045) → muka-dalam box masih 0,5 cm terkubur di
    // volume dinding, hampir tak terlihat di render 3D.
    const wallCenter: [number, number, number] = [0, 1, 0]
    for (const side of ["n", "s", "w", "e"] as const) {
      const [x, , z] = wallLampFixturePosition(wallCenter, side, 2.0)
      const outward = side === "n" ? -z : side === "s" ? z : side === "w" ? -x : x
      const nearFaceFromCenterline = outward - WALL_LAMP_BODY_ARGS[2] / 2
      expect(nearFaceFromCenterline).toBeGreaterThan(WALL_T / 2)
    }
  })

  it("tinggi fixture = tinggi dasar dinding + mountH", () => {
    const [, y] = wallLampFixturePosition([0, 0.5, 0], "s", 2.0)
    expect(y).toBeCloseTo(2.5, 5)
  })

  it("default side 's' bila lamp.side absent (konsisten dgn LampAim)", () => {
    const withSide = wallLampFixturePosition([0, 0, 0], "s", 1)
    const withoutSide = wallLampFixturePosition([0, 0, 0], undefined, 1)
    expect(withoutSide).toEqual(withSide)
  })
})
