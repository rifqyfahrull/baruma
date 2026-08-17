import { describe, it, expect } from "vitest"

import {
  EXTERIOR_FEATURE_FLAGS,
  DEFAULT_FEATURE_CAPABILITIES,
  stableRolloutBucket,
  resolveFeatureFlag,
  resolveFeatureCapabilities,
  featureFlagConfigsFromEnv,
} from "./features"

describe("stableRolloutBucket", () => {
  it("is deterministic for the same flag + project", () => {
    expect(stableRolloutBucket("exterior_elements_v1", "proj-1")).toBe(
      stableRolloutBucket("exterior_elements_v1", "proj-1")
    )
  })

  it("stays within [0, 100) and spreads across projects", () => {
    const buckets = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const bucket = stableRolloutBucket("roof_zones_v1", `proj-${i}`)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(100)
      buckets.add(bucket)
    }
    // 200 project berbeda harus menyebar ke banyak cohort, bukan satu nilai.
    expect(buckets.size).toBeGreaterThan(10)
  })

  it("gives independent cohorts per flag for the same project", () => {
    const perFlag = EXTERIOR_FEATURE_FLAGS.map((flag) =>
      stableRolloutBucket(flag, "proj-cohort")
    )
    // Tidak semua flag boleh dipaksa satu bucket identik (hash memakai flag).
    expect(new Set(perFlag).size).toBeGreaterThan(1)
  })
})

describe("resolveFeatureFlag", () => {
  it("kill switch (enabled=false) wins over admin and rollout", () => {
    expect(
      resolveFeatureFlag(
        "exterior_elements_v1",
        "proj-1",
        { enabled: false, rolloutPercent: 100 },
        { isAdmin: true }
      )
    ).toBe(false)
  })

  it("admin/internal is always on when the flag is enabled", () => {
    expect(
      resolveFeatureFlag(
        "exterior_elements_v1",
        "proj-1",
        { enabled: true, rolloutPercent: 0 },
        { isAdmin: true }
      )
    ).toBe(true)
  })

  it("rollout percent buckets by stable hash of flag + projectId", () => {
    const bucket = stableRolloutBucket("presentation_mode_v1", "proj-42")
    expect(
      resolveFeatureFlag("presentation_mode_v1", "proj-42", {
        enabled: true,
        rolloutPercent: bucket,
      })
    ).toBe(false)
    expect(
      resolveFeatureFlag("presentation_mode_v1", "proj-42", {
        enabled: true,
        rolloutPercent: bucket + 1,
      })
    ).toBe(true)
  })

  it("rollout 100 enables every project", () => {
    for (let i = 0; i < 50; i++) {
      expect(
        resolveFeatureFlag("roof_zones_v1", `proj-${i}`, {
          enabled: true,
          rolloutPercent: 100,
        })
      ).toBe(true)
    }
  })
})

describe("featureFlagConfigsFromEnv", () => {
  it("defaults to enabled at 100% rollout (kill-switch semantics)", () => {
    const configs = featureFlagConfigsFromEnv({})
    for (const flag of EXTERIOR_FEATURE_FLAGS) {
      expect(configs[flag]).toEqual({ enabled: true, rolloutPercent: 100 })
    }
  })

  it("reads enabled boolean and rollout percent per flag", () => {
    const configs = featureFlagConfigsFromEnv({
      FEATURE_ROOF_ZONES_V1: "false",
      FEATURE_EXTERIOR_ELEMENTS_V1_ROLLOUT: "25",
    })
    expect(configs.roof_zones_v1.enabled).toBe(false)
    expect(configs.exterior_elements_v1).toEqual({
      enabled: true,
      rolloutPercent: 25,
    })
  })

  it("clamps malformed rollout values back to the safe default", () => {
    const configs = featureFlagConfigsFromEnv({
      FEATURE_PRESENTATION_MODE_V1_ROLLOUT: "abc",
      FEATURE_ROOF_ZONES_V1_ROLLOUT: "250",
    })
    expect(configs.presentation_mode_v1.rolloutPercent).toBe(100)
    expect(configs.roof_zones_v1.rolloutPercent).toBe(100)
  })
})

describe("resolveFeatureCapabilities", () => {
  it("returns a typed capability set covering every flag", () => {
    const capabilities = resolveFeatureCapabilities(
      "proj-1",
      featureFlagConfigsFromEnv({}),
      { isAdmin: false }
    )
    expect(Object.keys(capabilities).sort()).toEqual(
      [...EXTERIOR_FEATURE_FLAGS].sort()
    )
    for (const flag of EXTERIOR_FEATURE_FLAGS) {
      expect(capabilities[flag]).toBe(true)
    }
  })

  it("default capability constant enables everything (matches env default)", () => {
    for (const flag of EXTERIOR_FEATURE_FLAGS) {
      expect(DEFAULT_FEATURE_CAPABILITIES[flag]).toBe(true)
    }
  })
})
