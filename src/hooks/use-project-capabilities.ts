"use client"

import { useQuery } from "@tanstack/react-query"

import { data } from "@/lib/data"
import {
  DEFAULT_FEATURE_CAPABILITIES,
  type FeatureCapabilities,
} from "@/lib/features"

/**
 * Capability set rollout fitur eksterior untuk gating creation UI (roadmap
 * §21). Server yang me-resolve (role + projectId + env); hook ini hanya
 * membaca. Saat loading/tanpa projectId memakai default all-enabled — sama
 * dengan default env produksi — supaya toolbar tidak flicker; flag berfungsi
 * sebagai kill-switch, bukan gerbang pra-rilis.
 */
export function useProjectCapabilities(
  projectId: string | undefined
): FeatureCapabilities {
  const { data: capabilities } = useQuery({
    queryKey: ["project-capabilities", projectId],
    queryFn: () => data.getProjectCapabilities(projectId!),
    enabled: !!projectId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  return capabilities ?? DEFAULT_FEATURE_CAPABILITIES
}
