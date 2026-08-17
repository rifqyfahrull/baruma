/**
 * Admin backoffice: single template — update meta / resync from source / delete.
 * Every handler re-checks admin via `requireAdmin` (DB-fresh).
 */
import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/server/auth-server"
import {
  deleteTemplate,
  getTemplateSlugById,
  resyncTemplateFromSource,
  updateTemplateMeta,
} from "@/lib/server/repo/templates"
import { updateTemplateSchema } from "@/lib/schemas/templates"
import { ok, err, handleError } from "@/lib/server/response"

/** Revalidate the public ISR pages a template mutation can affect. */
function revalidateTemplatePages(slugs: Array<string | null | undefined>): void {
  revalidatePath("/templates")
  revalidatePath("/")
  for (const slug of new Set(slugs.filter((s): s is string => !!s))) {
    revalidatePath(`/templates/${slug}`)
  }
}

export const dynamic = "force-dynamic"

/** PATCH — meta edits (name/slug/description/sortOrder/active) and/or a resync. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    await requireAdmin(request)
    const { id } = await ctx.params

    const body = await request.json().catch(() => null)
    const parsed = updateTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Input tidak valid")
    }
    const { resync, ...metaPatch } = parsed.data
    // Old slug — needed so a slug-changing edit revalidates the page at its
    // PREVIOUS url too (that path would otherwise keep serving stale ISR
    // output, e.g. a 200 for a template that has since moved).
    const oldSlug = await getTemplateSlugById(id)

    if (resync) {
      const resynced = await resyncTemplateFromSource(id)
      if (!resynced) return err(404, "Template not found")
      revalidateTemplatePages([oldSlug, resynced.slug])
      return ok(resynced)
    }

    const updated = await updateTemplateMeta(id, metaPatch)
    if (!updated) return err(404, "Template not found")
    revalidateTemplatePages([oldSlug, updated.slug])
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}

/** DELETE — remove a template. */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    await requireAdmin(request)
    const { id } = await ctx.params
    // Grab the slug before the row is gone — deleteTemplate only returns a
    // bool, and we need the (now-stale) detail path to be revalidated too.
    const slug = await getTemplateSlugById(id)
    const deleted = await deleteTemplate(id)
    if (!deleted) return err(404, "Template not found")
    revalidateTemplatePages([slug])
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
