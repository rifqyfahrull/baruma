import { z } from "zod";
import { DEFAULT_FLOOR_TO_FLOOR_M } from "@/lib/geometry/vertical";

import type { DesignLayout } from "@/types";

// v3 (Fase D ARSITEKTUR_MODERN): Floor.heightM resmi = FLOOR-TO-FLOOR yang
// DIBACA 3D. Data v<3 tak pernah punya UI tinggi lantai (nilai 3.0/3.2 murni
// noise generator, sementara 3D selalu menampilkan 2.95) → dinormalisasi ke
// 2.95 saat load supaya visual semua proyek existing TIDAK berubah
// (keputusan migrasi plan; gambar kerja/RAB kini mengikuti apa yang selama
// ini dilihat user di 3D). Rooftop (0.3 = tebal dak) dibiarkan.
export const LAYOUT_SCHEMA_VERSION = 3;

const pointSchema = z.object({ x: z.number(), y: z.number() });

const materialSurfaceSchema = z.object({
  materialId: z.string().optional(),
  color: z.string().optional(),
  finish: z.string().optional(),
});

/** ComponentPatternSpec (persisted) — lihat types/exterior.ts utk kontrak lengkap. */
const componentPatternSchema = z.object({
  orientation: z.enum(["v", "h", "grid", "cross"]).optional(),
  pitchM: z.number().optional(),
  barWidthM: z.number().optional(),
  barDepthM: z.number().optional(),
  rhythm: z.array(z.number()).optional(),
  frame: z.boolean().optional(),
  inset: z.boolean().optional(),
});

const exteriorCommon = {
  id: z.string(),
  floorId: z.string().optional(),
  label: z.string().optional(),
  structuralRole: z
    .enum(["non_structural", "secondary_unverified"])
    .default("non_structural"),
  material: z
    .object({
      materialId: z.string().optional(),
      color: z.string().optional(),
      finish: z.string().optional(),
      surfaces: z
        .object({
          top: materialSurfaceSchema.optional(),
          side: materialSurfaceSchema.optional(),
          underside: materialSurfaceSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  costing: z
    .object({
      rateId: z.string().optional(),
      includeInRab: z.boolean().optional(),
    })
    .optional(),
  model: z
    .object({
      modelAssetId: z.string().nullable().optional(),
      modelUrl: z.string().nullable().optional(),
      fitMode: z.enum(["fit_envelope", "use_real_size"]).optional(),
      upAxis: z.enum(["y", "z"]).optional(),
      frontAxis: z.enum(["z+", "z-", "x+", "x-"]).optional(),
      performance: z
        .object({
          triangleCount: z.number().optional(),
          meshCount: z.number().optional(),
          drawCallCount: z.number().optional(),
          textureBytes: z.number().optional(),
          fileSizeBytes: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
};

const exteriorElementSchema = z.discriminatedUnion("kind", [
  z.object({
    ...exteriorCommon,
    kind: z.enum([
      "boundary_wall",
      "fence",
      "sliding_gate",
      "swing_gate",
      "pedestrian_gate",
    ]),
    start: pointSchema,
    end: pointSchema,
    heightM: z.number(),
    thicknessM: z.number().optional(),
    rotationDeg: z.number().optional(),
    // Hanya kind fence/gate (bukan boundary_wall, selalu solid).
    pattern: componentPatternSchema.optional(),
  }),
  z.object({
    ...exteriorCommon,
    kind: z.enum([
      "solid_wall",
      "facade_panel",
      "column",
      "chimney",
      "beam",
      "slab",
      "canopy",
      "overhang_slab",
      "planter",
      "pergola",
    ]),
    x: z.number(),
    y: z.number(),
    zM: z.number().optional(),
    widthM: z.number(),
    depthM: z.number(),
    heightM: z.number(),
    rotationDeg: z.number().optional(),
    // Hanya kind "pergola".
    pattern: componentPatternSchema.optional(),
    posts: z.boolean().optional(),
  }),
  z.object({
    ...exteriorCommon,
    kind: z.literal("portal_frame"),
    x: z.number(),
    y: z.number(),
    widthM: z.number(),
    heightM: z.number(),
    depthM: z.number().optional(),
    memberSizeM: z.number(),
    rotationDeg: z.number().optional(),
  }),
  z.object({
    ...exteriorCommon,
    kind: z.literal("gable_frame"),
    x: z.number(),
    y: z.number(),
    zM: z.number().optional(),
    widthM: z.number(),
    heightM: z.number(),
    eaveLeftM: z.number(),
    eaveRightM: z.number(),
    apexOffsetM: z.number().optional(),
    depthM: z.number().optional(),
    memberSizeM: z.number(),
    rotationDeg: z.number().optional(),
  }),
  z.object({
    ...exteriorCommon,
    kind: z.literal("exterior_stair"),
    x: z.number(),
    y: z.number(),
    widthM: z.number(),
    lengthM: z.number(),
    riseM: z.number(),
    direction: z.enum(["n", "s", "w", "e"]),
  }),
  z.object({
    ...exteriorCommon,
    kind: z.enum(["driveway", "walkway", "terrace_surface", "garden_bed"]),
    points: z.array(pointSchema).min(3),
    thicknessM: z.number().optional(),
    scatterSeed: z.number().optional(),
  }),
  z.object({
    ...exteriorCommon,
    kind: z.enum(["asset", "plant", "tree", "exterior_decor", "vehicle"]),
    x: z.number(),
    y: z.number(),
    zM: z.number().optional(),
    widthM: z.number(),
    depthM: z.number(),
    heightM: z.number(),
    rotationDeg: z.number().optional(),
  }),
]);

const roofZoneSchema = z.object({
  id: z.string(),
  floorId: z.string().optional(),
  type: z.enum(["datar", "pelana", "limasan", "miring"]),
  x: z.number(),
  y: z.number(),
  widthM: z.number(),
  depthM: z.number(),
  slopeDeg: z.number(),
  overhangM: z.number(),
  overhangSides: z
    .object({
      n: z.number().optional(),
      s: z.number().optional(),
      w: z.number().optional(),
      e: z.number().optional(),
    })
    .optional(),
  materialId: z.string().optional(),
  lowSide: z.enum(["n", "s", "w", "e"]).optional(),
  // Gable asimetris (pelana): geser bubungan dari tengah (m).
  ridgeOffsetM: z.number().optional(),
  // Sopi-sopi (pelana): isi dinding/kaca ujung bubungan per sisi.
  gableEnds: z
    .object({
      n: z.enum(["wall", "glass"]).optional(),
      s: z.enum(["wall", "glass"]).optional(),
      w: z.enum(["wall", "glass"]).optional(),
      e: z.enum(["wall", "glass"]).optional(),
    })
    .optional(),
});

const skylightSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  kind: z.enum(["fixed", "operable"]),
});

export const designLayoutSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    id: z.string(),
    projectId: z.string(),
    versionId: z.string(),
    floors: z.array(
      z
        .object({
          id: z.string(),
          level: z.number(),
          name: z.string(),
          heightM: z.number(),
          kind: z.enum(["regular", "mezzanine", "rooftop"]).optional(),
          baseOffsetM: z.number().optional(),
          offsetM: z.object({ dx: z.number(), dy: z.number() }).optional(),
        })
        .passthrough(),
    ),
    rooms: z.array(
      z
        .object({
          id: z.string(),
          floorId: z.string(),
          name: z.string(),
          type: z.string(),
          x: z.number(),
          y: z.number(),
          width: z.number(),
          depth: z.number(),
          areaM2: z.number(),
          carportCanopyMode: z.enum(["automatic", "none"]).optional(),
          stairDirection: z.enum(["n", "s", "w", "e"]).optional(),
          stairRiserM: z.number().nullable().optional(),
          stairShape: z.enum(["lurus", "L", "U"]).nullable().optional(),
          stairTurn: z.enum(["kiri", "kanan"]).nullable().optional(),
          poolShallowM: z.number().nullable().optional(),
          poolDeepM: z.number().nullable().optional(),
          poolEntrySide: z.enum(["n", "s", "w", "e"]).nullable().optional(),
          poolCirculationType: z.enum(["skimmer", "overflow"]).nullable().optional(),
          poolHasJets: z.boolean().nullable().optional(),
          poolHeater: z.boolean().nullable().optional(),
          poolSaltChlorinator: z.boolean().nullable().optional(),
          openToSky: z.boolean().optional(),
          openToSkyRect: z
            .object({ x: z.number(), y: z.number(), width: z.number(), depth: z.number() })
            .optional(),
          /** Balkon: tonjolan busur (m) tepi depan; 0/absen = lurus. */
          edgeBowM: z.number().optional(),
        })
        .passthrough(),
    ),
    walls: z.array(z.unknown()).default([]),
    openings: z.array(z.unknown()).default([]),
    stairs: z.array(z.unknown()).default([]),
    pools: z.array(z.unknown()).default([]),
    exteriorElements: z.array(exteriorElementSchema).optional(),
    roofZones: z.array(roofZoneSchema).optional(),
    skylights: z.array(skylightSchema).optional(),
    validation: z
      .object({
        passed: z.boolean(),
        issues: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

export const layoutDocumentSchema = z.object({
  layout: designLayoutSchema,
  revision: z.number().int().positive(),
});

export const saveLayoutInputSchema = z.object({
  layout: designLayoutSchema,
  expectedRevision: z.number().int().positive(),
});

export type LayoutDocument = {
  layout: DesignLayout;
  revision: number;
};

export type SaveLayoutInput = {
  layout: DesignLayout;
  expectedRevision: number;
};

export function normalizeDesignLayout(input: unknown): DesignLayout {
  const parsed = designLayoutSchema.parse(input);
  const fromVersion = parsed.schemaVersion ?? 1;
  const floors = (fromVersion < 3
    ? parsed.floors.map((f) =>
        f.id === "floor-rooftop"
          ? f
          : { ...f, heightM: DEFAULT_FLOOR_TO_FLOOR_M },
      )
    : parsed.floors
  ).map((f) =>
    // Normalisasi kind: magic string id "floor-rooftop" → kind "rooftop"
    // (id lama tetap — konsumen pindah ke helper floors.ts bertahap).
    f.id === "floor-rooftop" && f.kind !== "rooftop"
      ? { ...f, kind: "rooftop" as const }
      : f,
  );
  return {
    ...parsed,
    floors,
    schemaVersion: LAYOUT_SCHEMA_VERSION,
  } as unknown as DesignLayout;
}

export function normalizeLayoutDocument(input: unknown): LayoutDocument {
  const parsed = layoutDocumentSchema.parse(input);
  return {
    layout: normalizeDesignLayout(parsed.layout),
    revision: parsed.revision,
  };
}
