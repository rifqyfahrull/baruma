/**
 * Owner-only share-link management for one project (WS-D §2). Public
 * consumption of the resulting token happens at `GET /s/[token]` (a page,
 * not an API route) and `POST /api/v1/share/[token]/comments`.
 */
import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import {
  createOrReuseShareLink,
  getActiveShareLink,
  revokeShareLinks,
} from "@/lib/server/repo/share-links"
import { ok, err, handleError } from "@/lib/server/response"

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://baruma.tampil.dev"
}

function shareUrl(token: string): string {
  return `${appUrl().replace(/\/$/, "")}/s/${token}`
}

/** Current active link, or `{url: null}` if none has been created yet. */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const link = await getActiveShareLink(id)
    return ok({ url: link ? shareUrl(link.token) : null })
  } catch (e) {
    return handleError(e)
  }
}

/** Create (or reuse the existing active) share link for this project. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const link = await createOrReuseShareLink(id)
    return ok({ url: shareUrl(link.token) })
  } catch (e) {
    return handleError(e)
  }
}

/** "Nonaktifkan tautan" — revokes the project's active link(s). */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    await revokeShareLinks(id)
    return ok({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
