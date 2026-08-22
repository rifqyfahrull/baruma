/**
 * Feature flags rollout eksterior (roadmap §21) — resolver pure tunggal.
 *
 * Komponen TIDAK membaca `process.env` langsung: server me-resolve capability
 * set dari konfigurasi env + role admin, lalu mengirim `FeatureCapabilities`
 * typed ke client (GET /projects/[id]/capabilities). Client hanya memakai
 * hasil resolve untuk menampilkan/menyembunyikan creation UI — data existing
 * tetap diterima dan dirender walau flag off (rollback tidak menghapus data).
 *
 * Semantik:
 * - Default env kosong = enabled 100% (fitur sudah rilis; flag berfungsi
 *   sebagai kill-switch/dial-down rollback, bukan gerbang pra-rilis).
 * - `enabled=false` mematikan untuk semua orang, termasuk admin (kill switch).
 * - Admin/internal selalu on selama flag enabled, mengabaikan persentase.
 * - Persentase rollout memakai stable hash `flag + projectId` sehingga
 *   project tidak berpindah cohort antar request/deploy.
 */

export const EXTERIOR_FEATURE_FLAGS = [
  "exterior_elements_v1",
  "roof_zones_v1",
  "presentation_mode_v1",
  // AI Image Renderer (Fase 9 — docs/plan-integrasi-ai-renderer-2026-08.md).
  // Sama seperti flag lain: hanya menyembunyikan UI PEMBUATAN render baru;
  // galeri render lama tetap tampil walau flag dimatikan (rollback tak
  // menghapus data). Kill switch = FEATURE_AI_RENDER_V1=false.
  "ai_render_v1",
] as const

export type ExteriorFeatureFlag = (typeof EXTERIOR_FEATURE_FLAGS)[number]

export type FeatureFlagConfig = {
  enabled: boolean
  /** 0..100 — persen project (per stable hash) yang mendapat fitur. */
  rolloutPercent: number
}

export type FeatureFlagConfigs = Record<ExteriorFeatureFlag, FeatureFlagConfig>

/** Capability set typed yang dikirim server ke client. */
export type FeatureCapabilities = Record<ExteriorFeatureFlag, boolean>

export const DEFAULT_FEATURE_CAPABILITIES: FeatureCapabilities = {
  exterior_elements_v1: true,
  roof_zones_v1: true,
  presentation_mode_v1: true,
  ai_render_v1: true,
}

/**
 * Bucket cohort 0..99 deterministik dari `flag:projectId` (FNV-1a 32-bit).
 * Hash menyertakan flag agar cohort tiap flag independen — menaikkan rollout
 * satu flag tidak menggeser cohort flag lain.
 */
export function stableRolloutBucket(flag: string, projectId: string): number {
  const key = `${flag}:${projectId}`
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 100
}

export function resolveFeatureFlag(
  flag: ExteriorFeatureFlag,
  projectId: string,
  config: FeatureFlagConfig,
  opts: { isAdmin?: boolean } = {}
): boolean {
  if (!config.enabled) return false
  if (opts.isAdmin) return true
  const percent = clampPercent(config.rolloutPercent)
  return stableRolloutBucket(flag, projectId) < percent
}

export function resolveFeatureCapabilities(
  projectId: string,
  configs: FeatureFlagConfigs,
  opts: { isAdmin?: boolean } = {}
): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities
  for (const flag of EXTERIOR_FEATURE_FLAGS) {
    capabilities[flag] = resolveFeatureFlag(flag, projectId, configs[flag], opts)
  }
  return capabilities
}

/**
 * Konfigurasi minimum per flag dari environment:
 * `FEATURE_<FLAG>` ("false" mematikan) dan `FEATURE_<FLAG>_ROLLOUT` (0..100).
 * Nilai malformed/di luar range jatuh ke default aman (enabled, 100%).
 */
export function featureFlagConfigsFromEnv(
  env: Record<string, string | undefined>
): FeatureFlagConfigs {
  const configs = {} as FeatureFlagConfigs
  for (const flag of EXTERIOR_FEATURE_FLAGS) {
    const prefix = `FEATURE_${flag.toUpperCase()}`
    const enabledRaw = env[prefix]?.trim().toLowerCase()
    const rolloutRaw = env[`${prefix}_ROLLOUT`]
    const rolloutParsed = rolloutRaw === undefined ? 100 : Number(rolloutRaw)
    configs[flag] = {
      enabled: enabledRaw !== "false" && enabledRaw !== "0",
      rolloutPercent:
        Number.isFinite(rolloutParsed) && rolloutParsed >= 0 && rolloutParsed <= 100
          ? rolloutParsed
          : 100,
    }
  }
  return configs
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}
