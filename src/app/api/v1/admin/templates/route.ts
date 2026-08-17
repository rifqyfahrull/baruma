/**
 * Admin backoffice: templates list + create. Every handler re-checks admin via
 * `requireAdmin` (DB-fresh — see src/lib/server/auth-server.ts).
 */
import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/server/auth-server"
import {
  createTemplateFromProject,
  listTemplates,
  TemplateSourceNotFoundError,
} from "@/lib/server/repo/templates"
import { createTemplateSchema } from "@/lib/schemas/templates"
import { ok, err, handleError } from "@/lib/server/response"

// Admin edits must always be visible immediately on re-fetch — never let a
// build/runtime cache freeze this route (mirrors /api/v1/templates/route.ts).
export const dynamic = "force-dynamic"

/** GET — ALL templates (active + inactive) so admins can see/reactivate hidden ones. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const templates = await listTemplates(false)
    return ok(templates)
  } catch (e) {
    return handleError(e)
  }
}

/** POST — snapshot a project into a new (or re-seeded) template. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const body = await request.json().catch(() => null)
    const parsed = createTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Input tidak valid")
    }
    const { projectId, slug, name, description, sortOrder } = parsed.data
    const template = await createTemplateFromProject(projectId, {
      slug,
      name,
      description,
      sortOrder,
    })
    // New template — make it show up on the public gallery/home right away
    // instead of waiting out the `revalidate = 300` ISR window.
    revalidatePath("/templates")
    revalidatePath("/")
    revalidatePath(`/templates/${template.slug}`)
    return ok(template, 201)
  } catch (e) {
    if (e instanceof TemplateSourceNotFoundError) {
      return err(404, e.message)
    }
    return handleError(e)
  }
}
