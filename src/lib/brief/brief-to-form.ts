/**
 * Pre-fill a wizard form (CreateProjectInput) from an existing Brief + Project,
 * for the "edit brief" flow. Inverse of buildBriefFields: the carport item is
 * collapsed back into the `carport` boolean (it's re-added on save), and
 * project-level fields (name/style/type) come from the Project so the rebuilt
 * summary stays correct even though the edit wizard doesn't expose them.
 */
import type { Brief, Project, SpaceProgramItem } from "@/types"
import { roomTypeEnum, type CreateProjectInput } from "@/lib/schemas/project"

type FormRoomType = CreateProjectInput["rooms"][number]["roomType"]

export function briefToFormValues(brief: Brief, project: Project): CreateProjectInput {
  const carport = brief.spaceProgram.some((i) => i.roomType === "carport")
  return {
    name: project.name,
    city: brief.site.city ?? project.city ?? "",
    projectType: project.projectType,
    style: project.style ?? "modern_tropis",
    widthM: brief.site.widthM,
    depthM: brief.site.depthM,
    frontOrientation: brief.site.frontOrientation ?? "unknown",
    sidesAttached: brief.site.sidesAttached ?? 0,
    frontRoadWidthM: brief.site.frontRoadWidthM,
    carport,
    siteNotes: brief.site.notes ?? "",
    // Site.regulation allows explicit `null` (cleared field); the wizard's
    // zod shape only knows `number | undefined`, so normalize null → undefined.
    regulation: brief.site.regulation
      ? {
          maxKdb: brief.site.regulation.maxKdb ?? undefined,
          maxKlb: brief.site.regulation.maxKlb ?? undefined,
          gsbM: brief.site.regulation.gsbM ?? undefined,
          minKdh: brief.site.regulation.minKdh ?? undefined,
        }
      : undefined,
    floors: brief.building.floors,
    rooftop: brief.building.rooftop,
    budgetMinIDR: brief.building.budget.minIDR,
    budgetMaxIDR: brief.building.budget.maxIDR,
    finishingLevel: brief.building.finishingLevel,
    priorities: brief.priorities,
    rooms: brief.spaceProgram
      // keep only user-selectable room types (drop carport/void/tangga, which
      // are derived structural items re-added on save)
      .filter(
        (i): i is SpaceProgramItem & { roomType: FormRoomType } =>
          (roomTypeEnum.options as readonly string[]).includes(i.roomType)
      )
      .map((i) => ({
        roomType: i.roomType,
        name: i.name,
        required: i.required,
        quantity: i.quantity,
        preferredFloor: i.preferredFloor,
        sizePreference: i.sizePreference,
        notes: i.notes,
      })),
  }
}
