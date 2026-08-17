import { z } from "zod"

import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getBriefPayload } from "@/lib/server/repo/briefs"
import { getLayoutPayload, insertLayoutIfAbsent } from "@/lib/server/repo/layouts"
import { getRABPayload, upsertRAB, deleteRAB } from "@/lib/server/repo/rab"
import { ok, err, handleError } from "@/lib/server/response"
import { generateRAB } from "@/lib/mock/rab"
import { generateLayout } from "@/lib/mock/layout"
import { summarizeRab } from "@/lib/rab/summarize"
import type { FinishingLevel } from "@/types"

const boqItemSchema = z.object({
  id: z.string(),
  category: z.string(),
  item: z.string(),
  volume: z.number().min(0),
  unit: z.string(),
  unitPriceIDR: z.number().min(0),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z.string().optional(),
  sourceElementIds: z.array(z.string()).optional(),
})

const putBodySchema = z.object({
  items: z.array(boqItemSchema),
  areaM2: z.number().min(0),
  assumptions: z.array(z.string()),
})

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    // Return persisted manual RAB if it exists
    const persisted = await getRABPayload(id)
    if (persisted) return ok({ ...persisted, manual: true })

    const brief = await getBriefPayload(id)
    if (!brief) return err(404, "Brief not found")

    const url = new URL(request.url)
    const finishingParam = url.searchParams.get("finishing") as FinishingLevel | null

    let layout = await getLayoutPayload(id)
    if (!layout) {
      layout = generateLayout(project, brief)
      layout = (await insertLayoutIfAbsent(id, project.currentVersionId ?? `ver-${id}`, layout)).layout
    }

    const rab = generateRAB(project, brief, layout, finishingParam ?? undefined)
    return ok(rab)
  } catch (e) {
    return handleError(e)
  }
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const body = await request.json()
    const parsed = putBodySchema.safeParse(body)
    if (!parsed.success) return err(400, parsed.error.message)

    const { items, areaM2, assumptions } = parsed.data

    // Cast category strings to CostCategory — Zod validates shape, types trust the caller
    const { items: recomputedItems, summary } = summarizeRab(
      items as import("@/types").BOQItem[],
      areaM2
    )

    const rab: import("@/types").RAB = {
      projectId: id,
      versionId: project.currentVersionId ?? `ver-${id}`,
      areaM2,
      summary,
      items: recomputedItems,
      assumptions,
      manual: true,
    }

    const saved = await upsertRAB(id, rab)
    return ok({ ...saved, manual: true })
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    await deleteRAB(id)

    const brief = await getBriefPayload(id)
    if (!brief) return err(404, "Brief not found")

    let layout = await getLayoutPayload(id)
    if (!layout) {
      layout = generateLayout(project, brief)
      layout = (await insertLayoutIfAbsent(id, project.currentVersionId ?? `ver-${id}`, layout)).layout
    }

    const rab = generateRAB(project, brief, layout)
    return ok(rab)
  } catch (e) {
    return handleError(e)
  }
}
