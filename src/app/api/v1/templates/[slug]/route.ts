/**
 * Public template detail endpoint — no auth required. Returns the full
 * design payload (layout/brief/interior) for a single active template.
 */
import { getTemplateBySlug } from "@/lib/server/repo/templates"
import { ok, err, handleError } from "@/lib/server/response"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> }
): Promise<Response> {
  try {
    const { slug } = await ctx.params
    const template = await getTemplateBySlug(slug, { activeOnly: true })
    if (!template) return err(404, "Template not found")
    return ok(template)
  } catch (e) {
    return handleError(e)
  }
}
