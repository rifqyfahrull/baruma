import type { AnalyticsEvent } from "@/lib/analytics"
import {
  FACADE_COMPOSER_TEMPLATE_IDS,
  FACADE_COMPOSER_TEMPLATES,
  type FacadeComposerTemplateId,
} from "@/lib/exterior/facade-templates"
import {
  certificationScenes,
  type CertificationSceneId,
} from "@/lib/exterior/certification-scenes"

export type ExteriorCustomerJourneyId =
  | "template_to_presentation"
  | "ai_assisted_reference_build"

export type ExteriorReleaseGateId =
  | "native_template_available"
  | "semantic_editable_elements"
  | "ai_capability_parity"
  | "drawing_rab_parity"
  | "presentation_budget"
  | "visual_regression"
  | "rollout_telemetry"

export type ExteriorAiEvalId =
  | "frontage_from_brief"
  | "partial_gable_roof"
  | "portal_without_gate_loss"
  | "reject_out_of_site"
  | "preserve_unrelated_rooms_interiors"
  | "custom_model_rab_exclusion"

export type ExteriorCustomerJourney = {
  id: ExteriorCustomerJourneyId
  label: string
  targetSceneId: CertificationSceneId
  templateId: FacadeComposerTemplateId
  steps: readonly string[]
  gates: readonly ExteriorReleaseGateId[]
  telemetry: readonly AnalyticsEvent[]
}

export type ExteriorAiEvalCase = {
  id: ExteriorAiEvalId
  prompt: string
  expected: string
  requiredActions: readonly string[]
}

export type ExteriorReleaseCertification = {
  requiredTemplates: readonly FacadeComposerTemplateId[]
  journeys: readonly ExteriorCustomerJourney[]
  aiEvals: readonly ExteriorAiEvalCase[]
  requiredTelemetry: readonly AnalyticsEvent[]
  requiredCommands: readonly string[]
}

export type ExteriorReleaseCertificationResult = {
  passed: boolean
  issues: string[]
}

export const EXTERIOR_RELEASE_GATES: Record<ExteriorReleaseGateId, string> = {
  native_template_available: "Native semantic template exists and can be applied in one undoable transaction.",
  semantic_editable_elements: "Generated frontage remains editable as layout.exteriorElements/facadeElements, not baked GLB.",
  ai_capability_parity: "Unified AI action schema/apply path covers exterior, roof, facade, and cost-policy mutations.",
  drawing_rab_parity: "Gambar Kerja and RAB carry stable source IDs for native exterior/roof objects.",
  presentation_budget: "Certification scenes stay within draw-call/triangle/texture budgets.",
  visual_regression: "Presentation canvas matches certification visual baselines.",
  rollout_telemetry: "Key exterior adoption/certification events are typed analytics events.",
}

export function exteriorCustomerJourneys(): readonly ExteriorCustomerJourney[] {
  return [
    {
      id: "template_to_presentation",
      label: "Customer starts from a native facade template and reaches presentation/RAB/drawings.",
      targetSceneId: "scene-a-modern-concrete",
      templateId: "modern_concrete_vertical",
      steps: [
        "Pilih template Modern Concrete Vertical",
        "Edit portal/panel/gate native di 2D Editor",
        "Review validation feedback dan RAB exclusion warnings",
        "Buka Preview 3D mode Presentasi",
        "Generate Gambar Kerja + RAB dengan source IDs stabil",
      ],
      gates: [
        "native_template_available",
        "semantic_editable_elements",
        "drawing_rab_parity",
        "presentation_budget",
        "visual_regression",
        "rollout_telemetry",
      ],
      telemetry: [
        "exterior_template_applied",
        "preview_3d_opened",
        "rab_opened",
        "exterior_certification_gate_passed",
      ],
    },
    {
      id: "ai_assisted_reference_build",
      label: "Customer asks AI to build the brick/gable reference while preserving interior/floorplan state.",
      targetSceneId: "scene-b-brick-gable",
      templateId: "brick_gable_roster",
      steps: [
        "Minta AI membuat frontage bata + roster + atap pelana parsial",
        "Apply proposal via unified action path",
        "Pastikan gate/rooms/interior tidak hilang",
        "Audit roof-zone, landscape clearance, drawing, RAB, dan visual baseline",
      ],
      gates: [
        "native_template_available",
        "semantic_editable_elements",
        "ai_capability_parity",
        "drawing_rab_parity",
        "presentation_budget",
        "visual_regression",
        "rollout_telemetry",
      ],
      telemetry: [
        "exterior_template_applied",
        "exterior_edited",
        "preview_3d_opened",
        "exterior_certification_gate_passed",
      ],
    },
  ]
}

export function exteriorAiEvalSet(): readonly ExteriorAiEvalCase[] {
  return [
    {
      id: "frontage_from_brief",
      prompt: "Buat tampak depan modern beton vertikal dengan portal, canopy, gate, driveway, dan planter.",
      expected: "Creates native portal_frame/facade_panel/canopy/sliding_gate/driveway elements with stable IDs.",
      requiredActions: ["applyFacadeTemplate", "addExteriorElement"],
    },
    {
      id: "partial_gable_roof",
      prompt: "Tambahkan atap pelana hanya di massa kiri dan dak datar di carport kanan.",
      expected: "Uses explicit roofZones instead of mutating the legacy global roof only.",
      requiredActions: ["addRoofZone", "updateRoofZone"],
    },
    {
      id: "portal_without_gate_loss",
      prompt: "Perbesar portal carport, tapi jangan hapus gate dan walkway yang sudah ada.",
      expected: "Updates the portal owner only and preserves unrelated exterior elements.",
      requiredActions: ["updateExteriorElement"],
    },
    {
      id: "reject_out_of_site",
      prompt: "Buat pagar 30 meter keluar tapak 8 meter.",
      expected: "Rejects/clamps unsafe geometry and reports an out-of-site validation issue.",
      requiredActions: ["addExteriorElement"],
    },
    {
      id: "preserve_unrelated_rooms_interiors",
      prompt: "Ubah fasad menjadi brick gable roster tanpa mengubah kamar dan interior ruang tamu.",
      expected: "Applies facade/exterior actions without deleting rooms, openings, or interior furniture.",
      requiredActions: ["applyFacadeTemplate"],
    },
    {
      id: "custom_model_rab_exclusion",
      prompt: "Ganti panel fasad dengan custom GLB dan jelaskan dampaknya ke RAB.",
      expected: "Keeps custom model excluded from automatic RAB until explicit catalog/manual costing exists.",
      requiredActions: ["updateExteriorElement"],
    },
  ]
}

export function exteriorReleaseCertification(): ExteriorReleaseCertification {
  return {
    requiredTemplates: FACADE_COMPOSER_TEMPLATE_IDS,
    journeys: exteriorCustomerJourneys(),
    aiEvals: exteriorAiEvalSet(),
    requiredTelemetry: [
      "exterior_template_applied",
      "exterior_edited",
      "preview_3d_opened",
      "rab_opened",
      "exterior_certification_gate_passed",
    ],
    requiredCommands: [
      "rtk tsc --noEmit",
      "rtk pnpm lint",
      "rtk vitest run src/lib/exterior/release-certification.test.ts src/lib/exterior/facade-templates.test.ts src/lib/exterior/certification-scenes.test.ts",
      "rtk pnpm run test:e2e:certification",
    ],
  }
}

export function certifyExteriorRelease(): ExteriorReleaseCertificationResult {
  const plan = exteriorReleaseCertification()
  const issues: string[] = []
  const templateIds = new Set(FACADE_COMPOSER_TEMPLATES.map((template) => template.id))
  const sceneIds = new Set(certificationScenes().map((scene) => scene.id))
  const evalIds = new Set(plan.aiEvals.map((item) => item.id))

  for (const templateId of plan.requiredTemplates) {
    if (!templateIds.has(templateId)) issues.push(`Missing facade template: ${templateId}`)
  }

  for (const journey of plan.journeys) {
    if (!sceneIds.has(journey.targetSceneId)) issues.push(`Missing certification scene: ${journey.targetSceneId}`)
    if (!templateIds.has(journey.templateId)) issues.push(`Journey ${journey.id} references unknown template ${journey.templateId}`)
    if (journey.steps.length < 4) issues.push(`Journey ${journey.id} is too shallow for customer handoff`)
    if (!journey.gates.includes("visual_regression")) issues.push(`Journey ${journey.id} does not require visual regression`)
    if (!journey.telemetry.includes("exterior_template_applied")) issues.push(`Journey ${journey.id} lacks template telemetry`)
  }

  for (const id of [
    "frontage_from_brief",
    "partial_gable_roof",
    "portal_without_gate_loss",
    "reject_out_of_site",
    "preserve_unrelated_rooms_interiors",
    "custom_model_rab_exclusion",
  ] as const satisfies readonly ExteriorAiEvalId[]) {
    if (!evalIds.has(id)) issues.push(`Missing AI eval: ${id}`)
  }

  for (const event of plan.requiredTelemetry) {
    if (!plan.journeys.some((journey) => journey.telemetry.includes(event))) {
      issues.push(`Required telemetry is not exercised by a journey: ${event}`)
    }
  }

  return { passed: issues.length === 0, issues }
}
