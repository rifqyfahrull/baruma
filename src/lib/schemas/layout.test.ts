import { describe, expect, it } from "vitest"

import { makeLayout } from "@/test-utils/fixtures"
import { normalizeDesignLayout, normalizeLayoutDocument, saveLayoutInputSchema } from "./layout"

describe("layout schema", () => {
  it("normalizes legacy layouts to schemaVersion 3", () => {
    const parsed = normalizeDesignLayout(makeLayout())
    expect(parsed.schemaVersion).toBe(3)
  })

  it("is idempotent and preserves unknown forward-compatible fields", () => {
    const legacy = {
      ...makeLayout(),
      schemaVersion: 1,
      experimentalFutureField: { kept: true },
    }
    const once = normalizeDesignLayout(legacy)
    const twice = normalizeDesignLayout(once)

    expect(twice).toEqual(once)
    expect((twice as typeof twice & { experimentalFutureField?: { kept: boolean } }).experimentalFutureField).toEqual({ kept: true })
    expect(twice.schemaVersion).toBe(3)
  })

  it("accepts semantic exterior elements but keeps them non-structural by default", () => {
    const layout = {
      ...makeLayout(),
      exteriorElements: [
        {
          id: "ext-1",
          kind: "driveway",
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 4 },
          ],
        },
      ],
    }
    const parsed = normalizeDesignLayout(layout)
    expect(parsed.exteriorElements?.[0].structuralRole).toBe("non_structural")
  })

  it("accepts layout v2 exterior material, model contract, scatter, and roof-zone fields", () => {
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [
        {
          id: "ext-garden",
          kind: "garden_bed",
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 0, y: 2 },
          ],
          scatterSeed: 42,
          material: {
            materialId: "tanah_taman",
            surfaces: {
              top: { materialId: "tanah_taman" },
              side: { color: "#6b4a2b" },
            },
          },
        },
        {
          id: "ext-tree",
          kind: "tree",
          x: 1,
          y: 1,
          widthM: 1,
          depthM: 1,
          heightM: 3,
          model: {
            modelAssetId: "asset-tree",
            modelUrl: "/api/v1/assets/file/tree.glb",
            fitMode: "fit_envelope",
            upAxis: "y",
            frontAxis: "z+",
            performance: {
              triangleCount: 12_000,
              meshCount: 4,
              drawCallCount: 4,
              textureBytes: 2048,
              fileSizeBytes: 4096,
            },
          },
        },
      ],
      roofZones: [
        {
          id: "rz-1",
          floorId: "floor-1",
          type: "pelana",
          x: 3,
          y: 3,
          widthM: 4,
          depthM: 5,
          slopeDeg: 30,
          overhangM: 0.5,
          materialId: "genteng_beton",
          lowSide: "s",
        },
      ],
    })

    expect(parsed.exteriorElements?.[0]).toMatchObject({
      id: "ext-garden",
      kind: "garden_bed",
      scatterSeed: 42,
      material: { surfaces: { side: { color: "#6b4a2b" } } },
    })
    expect(parsed.exteriorElements?.[1]).toMatchObject({
      id: "ext-tree",
      kind: "tree",
      model: {
        fitMode: "fit_envelope",
        upAxis: "y",
        frontAxis: "z+",
        performance: { triangleCount: 12_000 },
      },
    })
    expect(parsed.roofZones?.[0]).toMatchObject({ id: "rz-1", type: "pelana" })
  })

  it("keeps a segment WITHOUT rotationDeg/pattern byte-identical (no injected defaults)", () => {
    const segment = {
      id: "ext-fence-1",
      kind: "fence" as const,
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      heightM: 1.8,
      thicknessM: 0.05,
      structuralRole: "non_structural" as const,
    }
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [segment],
    })
    const out = parsed.exteriorElements?.[0]
    expect(out).toEqual(segment)
    expect(out).not.toHaveProperty("rotationDeg")
    expect(out).not.toHaveProperty("pattern")
  })

  it("round-trips segment rotationDeg + fence pattern (pitch/lebar/rhythm) instead of stripping them", () => {
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [
        {
          id: "ext-fence-2",
          kind: "sliding_gate",
          start: { x: 0, y: 0 },
          end: { x: 4, y: 0 },
          heightM: 1.8,
          thicknessM: 0.05,
          rotationDeg: 45,
          pattern: { pitchM: 0.12, barWidthM: 0.04, rhythm: [3, 1] },
        },
      ],
    })
    expect(parsed.exteriorElements?.[0]).toMatchObject({
      id: "ext-fence-2",
      rotationDeg: 45,
      pattern: { pitchM: 0.12, barWidthM: 0.04, rhythm: [3, 1] },
    })
  })

  it("round-trips a box element's anchor x/y byte-identically (Bug 1 — Posisi X/Y field persistence)", () => {
    const column = {
      id: "ext-col-pos",
      kind: "column" as const,
      x: 5.5,
      y: 7.25,
      widthM: 0.3,
      depthM: 0.3,
      heightM: 3,
      structuralRole: "non_structural" as const,
    }
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [column],
    })
    expect(parsed.exteriorElements?.[0]).toEqual(column)
  })

  it("round-trips a chimney box element (kind chimney) byte-identically", () => {
    const chimney = {
      id: "ext-chimney-1",
      kind: "chimney" as const,
      x: 3.2,
      y: 8.4,
      widthM: 0.6,
      depthM: 0.6,
      heightM: 1.6,
      structuralRole: "non_structural" as const,
    }
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [chimney],
    })
    expect(parsed.exteriorElements?.[0]).toEqual(chimney)
  })

  it("round-trips a balkon room's edgeBowM (tepi melengkung) — divalidasi zod eksplisit, bukan cuma passthrough", () => {
    const base = makeLayout()
    const parsed = normalizeDesignLayout({
      ...base,
      rooms: [
        { ...base.rooms[0], type: "balkon", edgeBowM: 0.6 },
        base.rooms[1],
      ],
    })
    expect(parsed.rooms[0].edgeBowM).toBe(0.6)
    // Absen (jalur lama) tetap tak punya field sama sekali — bukan 0 tersisip.
    expect(parsed.rooms[1].edgeBowM).toBeUndefined()
  })

  it("round-trips a segment's start/end (moved by the Posisi X/Y field or a canvas drag) byte-identically", () => {
    const fence = {
      id: "ext-fence-pos",
      kind: "fence" as const,
      start: { x: 1.5, y: 0.25 },
      end: { x: 5.5, y: 0.25 },
      heightM: 1.8,
      structuralRole: "non_structural" as const,
    }
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [fence],
    })
    expect(parsed.exteriorElements?.[0]).toEqual(fence)
  })

  it("round-trips ComponentPatternSpec.inset (nat beton/reveal) pada elemen eksterior — divalidasi zod eksplisit, bukan passthrough", () => {
    const fence = {
      id: "ext-fence-inset",
      kind: "fence" as const,
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      heightM: 1.8,
      structuralRole: "non_structural" as const,
      pattern: {
        orientation: "h" as const,
        pitchM: 0.8,
        barWidthM: 0.02,
        barDepthM: 0.012,
        inset: true,
      },
    }
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      exteriorElements: [fence],
    })
    expect(parsed.exteriorElements?.[0]).toEqual(fence)
  })

  it("round-trips FacadeElement.colorHex byte-identik (facadeElements tak punya schema eksplisit — lewat passthrough root)", () => {
    const fe = {
      id: "fe-fluted-1",
      wallId: "r1:n",
      floorId: "floor-1",
      kind: "louver_band" as const,
      positionM: 1.5,
      widthM: 3,
      sillHeightM: 0,
      heightM: 3.05,
      finish: "kayu" as const,
      colorHex: "#6f4e37",
      pattern: { orientation: "v" as const, pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
    }
    const parsed = normalizeDesignLayout({
      ...makeLayout(),
      facadeElements: [fe],
    } as never)
    expect((parsed as never as { facadeElements: typeof fe[] }).facadeElements?.[0]).toEqual(fe)
  })

  it("rejects invalid exterior element shapes before persistence", () => {
    expect(() =>
      normalizeDesignLayout({
        ...makeLayout(),
        exteriorElements: [
          {
            id: "bad-garden",
            kind: "garden_bed",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        ],
      })
    ).toThrow()
  })

  it("normalizes layout documents without dropping revision", () => {
    const doc = normalizeLayoutDocument({ layout: makeLayout(), revision: 3 })
    expect(doc.revision).toBe(3)
    expect(doc.layout.schemaVersion).toBe(3)
  })

  it("requires expectedRevision for save payloads", () => {
    expect(saveLayoutInputSchema.safeParse(makeLayout()).success).toBe(false)
    expect(
      saveLayoutInputSchema.safeParse({ layout: makeLayout(), expectedRevision: 1 }).success
    ).toBe(true)
  })
})

describe("normalizeDesignLayout — migrasi v3 (tinggi lantai)", () => {
  const raw = (schemaVersion?: number, heightM = 3.2) => ({
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "f1", level: 1, name: "L1", heightM },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [], walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  })

  it("v<3: heightM lantai reguler dinormalisasi ke 2.95 (rooftop dibiarkan); versi jadi 3", () => {
    const out = normalizeDesignLayout(raw(2, 3.2))
    expect(out.schemaVersion).toBe(3)
    expect(out.floors[0].heightM).toBeCloseTo(2.95, 9)
    expect(out.floors[1].heightM).toBe(0.3)
    // Tanpa schemaVersion (v1 implisit) juga dinormalisasi.
    expect(normalizeDesignLayout(raw(undefined, 3)).floors[0].heightM).toBeCloseTo(2.95, 9)
  })

  it("v3: heightM DIPERTAHANKAN (nilai yang di-author user lewat UI tinggi lantai)", () => {
    const out = normalizeDesignLayout(raw(3, 3.6))
    expect(out.floors[0].heightM).toBe(3.6)
  })
})
