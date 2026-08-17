import type { ModelRef } from "@/types";

export type ExteriorAssetLibraryItem = {
  id: string;
  modelUrl?: string | null;
  widthM?: number;
  depthM?: number;
  heightM?: number;
  performance?: unknown;
};

export type ExteriorAssetResolution =
  | {
      status: "none";
      model: undefined;
      warnings: string[];
    }
  | {
      status: "url_only";
      model: ModelRef;
      warnings: string[];
    }
  | {
      status: "resolved";
      model: ModelRef;
      asset: ExteriorAssetLibraryItem;
      warnings: string[];
    }
  | {
      status: "missing_or_private";
      model: ModelRef;
      warnings: string[];
    };

export type ExteriorModelContract = {
  fitMode: NonNullable<ModelRef["fitMode"]>;
  upAxis: NonNullable<ModelRef["upAxis"]>;
  frontAxis: NonNullable<ModelRef["frontAxis"]>;
};

export type ExteriorModelPerformance = NonNullable<ModelRef["performance"]>;

export const DEFAULT_EXTERIOR_MODEL_CONTRACT: ExteriorModelContract = {
  fitMode: "fit_envelope",
  upAxis: "y",
  frontAxis: "z+",
};

export const EXTERIOR_MODEL_PERFORMANCE_BUDGET = {
  triangleCount: 400_000,
  drawCallCount: 300,
  fileSizeBytes: 20 * 1024 * 1024,
} as const;

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finitePositive(obj[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function exteriorModelContract(model?: ModelRef | null): ExteriorModelContract {
  return {
    fitMode: model?.fitMode ?? DEFAULT_EXTERIOR_MODEL_CONTRACT.fitMode,
    upAxis: model?.upAxis ?? DEFAULT_EXTERIOR_MODEL_CONTRACT.upAxis,
    frontAxis: model?.frontAxis ?? DEFAULT_EXTERIOR_MODEL_CONTRACT.frontAxis,
  };
}

/**
 * Accepts the current `ModelRef.performance` shape plus common aliases emitted
 * by GLB analyzers / `user_assets.performance_json`. Unknown fields are ignored
 * so metadata snapshots can evolve without breaking old layouts.
 */
export function coerceExteriorModelPerformance(
  raw: unknown,
): ExteriorModelPerformance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const performance: ExteriorModelPerformance = {};

  const triangleCount = readNumber(obj, [
    "triangleCount",
    "triangles",
    "estimatedTriangleCount",
  ]);
  const meshCount = readNumber(obj, ["meshCount", "meshes"]);
  const drawCallCount = readNumber(obj, ["drawCallCount", "drawCalls"]);
  const textureBytes = readNumber(obj, [
    "textureBytes",
    "textureMemoryBytes",
    "estimatedTextureBytes",
  ]);
  const fileSizeBytes = readNumber(obj, ["fileSizeBytes", "file_size_bytes"]);

  if (triangleCount !== undefined) performance.triangleCount = triangleCount;
  if (meshCount !== undefined) performance.meshCount = meshCount;
  if (drawCallCount !== undefined) performance.drawCallCount = drawCallCount;
  if (textureBytes !== undefined) performance.textureBytes = textureBytes;
  if (fileSizeBytes !== undefined) performance.fileSizeBytes = fileSizeBytes;

  return Object.keys(performance).length ? performance : undefined;
}

export function exteriorModelPerformanceWarnings(
  model?: ModelRef | null,
): string[] {
  const performance = coerceExteriorModelPerformance(model?.performance);
  if (!performance) return [];

  const warnings: string[] = [];
  if (
    performance.triangleCount &&
    performance.triangleCount > EXTERIOR_MODEL_PERFORMANCE_BUDGET.triangleCount
  ) {
    warnings.push(
      `Triangle ${Math.round(performance.triangleCount).toLocaleString("id-ID")} melebihi budget mobile ${EXTERIOR_MODEL_PERFORMANCE_BUDGET.triangleCount.toLocaleString("id-ID")}.`,
    );
  }
  if (
    performance.drawCallCount &&
    performance.drawCallCount > EXTERIOR_MODEL_PERFORMANCE_BUDGET.drawCallCount
  ) {
    warnings.push(
      `Draw call ${Math.round(performance.drawCallCount).toLocaleString("id-ID")} melebihi budget ${EXTERIOR_MODEL_PERFORMANCE_BUDGET.drawCallCount}.`,
    );
  }
  if (
    performance.fileSizeBytes &&
    performance.fileSizeBytes > EXTERIOR_MODEL_PERFORMANCE_BUDGET.fileSizeBytes
  ) {
    warnings.push(
      `Ukuran GLB ${Math.round(performance.fileSizeBytes / 1024 / 1024).toLocaleString("id-ID")} MB melebihi budget 20 MB.`,
    );
  }
  return warnings;
}

/**
 * Re-resolve a stored exterior model against the already-authorized asset list.
 * Callers should pass rows returned by `/assets/my-library`, which is scoped by
 * `requireUser` and includes owned + public catalog assets only. If an asset id
 * is not present here, the model is treated as missing/private instead of
 * trusting a stale URL in the layout.
 */
export function resolveExteriorAssetModel(
  model: ModelRef | undefined | null,
  assets: readonly ExteriorAssetLibraryItem[],
): ExteriorAssetResolution {
  if (!model?.modelAssetId && !model?.modelUrl) {
    return { status: "none", model: undefined, warnings: [] };
  }

  if (!model.modelAssetId) {
    return {
      status: "url_only",
      model,
      warnings: [
        "Model memakai URL langsung; ownership dan metadata performa tidak bisa diverifikasi dari asset library.",
      ],
    };
  }

  const asset = assets.find((item) => item.id === model.modelAssetId);
  if (!asset?.modelUrl) {
    return {
      status: "missing_or_private",
      model: { ...model, modelUrl: null },
      warnings: [
        `Asset ${model.modelAssetId} tidak ditemukan di library authorized; kemungkinan private, terhapus, atau belum selesai ingest.`,
      ],
    };
  }

  const performance =
    coerceExteriorModelPerformance(asset.performance) ??
    coerceExteriorModelPerformance(model.performance);
  const resolvedModel: ModelRef = {
    ...model,
    modelUrl: asset.modelUrl,
    performance,
  };
  const warnings = exteriorModelPerformanceWarnings(resolvedModel);

  return {
    status: "resolved",
    model: resolvedModel,
    asset,
    warnings,
  };
}
