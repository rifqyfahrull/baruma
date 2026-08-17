import { describe, expect, it } from "vitest"

import { FACADE_COMPOSER_TEMPLATE_IDS } from "./facade-templates"
import { certificationScenes } from "./certification-scenes"
import {
  certifyExteriorRelease,
  exteriorAiEvalSet,
  exteriorCustomerJourneys,
  exteriorReleaseCertification,
} from "./release-certification"

describe("exterior release certification", () => {
  it("passes the executable release checklist for the current exterior roadmap", () => {
    expect(certifyExteriorRelease()).toEqual({ passed: true, issues: [] })
  })

  it("covers every shipped native facade template in release scope", () => {
    const plan = exteriorReleaseCertification()

    expect(plan.requiredTemplates).toEqual(FACADE_COMPOSER_TEMPLATE_IDS)
    for (const templateId of FACADE_COMPOSER_TEMPLATE_IDS) {
      expect(plan.requiredTemplates).toContain(templateId)
    }
  })

  it("locks the two customer journeys to the two certification scenes", () => {
    const sceneIds = certificationScenes().map((scene) => scene.id)
    const journeys = exteriorCustomerJourneys()

    expect(journeys.map((journey) => journey.targetSceneId).sort()).toEqual(sceneIds.sort())
    expect(journeys.every((journey) => journey.gates.includes("visual_regression"))).toBe(true)
    expect(journeys.every((journey) => journey.telemetry.includes("exterior_template_applied"))).toBe(true)
  })

  it("keeps the exterior AI eval set complete and action-backed", () => {
    const evals = exteriorAiEvalSet()

    expect(evals.map((item) => item.id).sort()).toEqual([
      "custom_model_rab_exclusion",
      "frontage_from_brief",
      "partial_gable_roof",
      "portal_without_gate_loss",
      "preserve_unrelated_rooms_interiors",
      "reject_out_of_site",
    ])
    expect(evals.every((item) => item.requiredActions.length > 0)).toBe(true)
    expect(evals.flatMap((item) => item.requiredActions)).toContain("applyFacadeTemplate")
    expect(evals.flatMap((item) => item.requiredActions)).toContain("addRoofZone")
  })
})
