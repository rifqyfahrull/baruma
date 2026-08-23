/**
 * `POST /api/v1/projects/from-template` — clone a curated template's brief +
 * layout into a brand-new project owned by the caller (WS-D §1). Powers the
 * "Gunakan template ini" CTA on the public gallery/detail pages and the
 * dashboard's "Template saran" cards.
 */
import { z } from "zod"
import { nanoid } from "nanoid"
import { requireUser } from "@/lib/server/auth-server"
import { getTemplateBySlug } from "@/lib/server/repo/templates"
import { createProject, listProjectsByOwner } from "@/lib/server/repo/projects"
import { upsertBrief } from "@/lib/server/repo/briefs"
import { insertLayoutIfAbsent } from "@/lib/server/repo/layouts"
import { getEntitlements } from "@/lib/server/entitlements"
import { ok, err, errCode, handleError } from "@/lib/server/response"
import type { Brief } from "@/types"

const schema = z.object({ slug: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const raw = await request.json()
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid input")
    }

    const template = await getTemplateBySlug(parsed.data.slug, { activeOnly: true })
    if (!template) return err(404, "Template tidak ditemukan")

    // Plan quota gate — same check as POST /api/v1/projects. `maxProjects`
    // may be `null` (unlimited, WS-B "Project tanpa batas") from a parallel
    // change to Entitlements — written tolerant of both shapes.
    const entitlements = await getEntitlements(userId)
    const max = entitlements.maxProjects as number | null
    if (max != null) {
      const existing = await listProjectsByOwner(userId)
      if (existing.length >= max) {
        return errCode(
          403,
          "plan_limit_projects",
          "Batas jumlah proyek pada plan Anda sudah tercapai. Upgrade plan untuk menambah proyek."
        )
      }
    }

    const id = `proj-${nanoid(8)}`
    const project = await createProject({
      id,
      ownerId: userId,
      name: `${template.name} (salinan)`,
      status: "editing",
      readiness: "concept_ready",
      projectType: "new",
      location: template.city,
      city: template.city,
      province: template.province,
      style: template.style,
      thumbnail: template.thumbnail,
      floors: template.floors,
      rooftop: template.rooftop,
      site: template.site,
    })

    if (template.brief) {
      const brief: Brief = { ...template.brief, projectId: project.id }
      await upsertBrief(project.id, brief)
    }
    await insertLayoutIfAbsent(project.id, `ver-${project.id}`, template.layout)

    return ok({ projectId: project.id })
  } catch (e) {
    return handleError(e)
  }
}
