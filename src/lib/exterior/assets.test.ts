import { describe, expect, it } from "vitest";

import {
  coerceExteriorModelPerformance,
  exteriorModelContract,
  exteriorModelPerformanceWarnings,
  resolveExteriorAssetModel,
} from "./assets";

describe("exterior model asset semantics", () => {
  it("defaults legacy model refs to a deterministic axis/fit contract", () => {
    expect(exteriorModelContract({ modelUrl: "/facade.glb" })).toEqual({
      fitMode: "fit_envelope",
      upAxis: "y",
      frontAxis: "z+",
    });
  });

  it("keeps explicit axis and fit metadata", () => {
    expect(
      exteriorModelContract({
        modelUrl: "/facade.glb",
        fitMode: "use_real_size",
        upAxis: "z",
        frontAxis: "x-",
      }),
    ).toEqual({
      fitMode: "use_real_size",
      upAxis: "z",
      frontAxis: "x-",
    });
  });

  it("coerces common performance_json aliases", () => {
    expect(
      coerceExteriorModelPerformance({
        estimatedTriangleCount: 510_000,
        meshes: 42,
        drawCalls: 330,
        textureMemoryBytes: 12_345,
        file_size_bytes: 25_000_000,
      }),
    ).toEqual({
      triangleCount: 510_000,
      meshCount: 42,
      drawCallCount: 330,
      textureBytes: 12_345,
      fileSizeBytes: 25_000_000,
    });
  });

  it("warns when custom GLB metadata exceeds preview budgets", () => {
    const warnings = exteriorModelPerformanceWarnings({
      modelUrl: "/oversized.glb",
      performance: {
        triangleCount: 900_000,
        drawCallCount: 420,
        fileSizeBytes: 30 * 1024 * 1024,
      },
    });

    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("Triangle");
    expect(warnings[1]).toContain("Draw call");
    expect(warnings[2]).toContain("20 MB");
  });

  it("re-resolves modelAssetId from the authorized asset library snapshot", () => {
    const resolution = resolveExteriorAssetModel(
      {
        modelAssetId: "asset-1",
        modelUrl: "/stale.glb",
        fitMode: "fit_envelope",
      },
      [
        {
          id: "asset-1",
          modelUrl: "/fresh.glb",
          performance: { estimatedTriangleCount: 510_000 },
        },
      ],
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.model.modelUrl).toBe("/fresh.glb");
    expect(resolution.model.performance?.triangleCount).toBe(510_000);
    expect(resolution.warnings[0]).toContain("Triangle");
  });

  it("does not trust stale model URLs for missing/private asset ids", () => {
    const resolution = resolveExteriorAssetModel(
      { modelAssetId: "asset-private", modelUrl: "/old-private.glb" },
      [],
    );

    expect(resolution.status).toBe("missing_or_private");
    expect(resolution.model.modelUrl).toBeNull();
    expect(resolution.warnings[0]).toContain("tidak ditemukan");
  });

  it("marks direct URLs as unverifiable", () => {
    const resolution = resolveExteriorAssetModel({ modelUrl: "/direct.glb" }, []);

    expect(resolution.status).toBe("url_only");
    expect(resolution.model.modelUrl).toBe("/direct.glb");
    expect(resolution.warnings[0]).toContain("URL langsung");
  });
});
