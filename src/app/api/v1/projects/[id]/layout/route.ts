import { gunzipSync } from "node:zlib"
import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getBriefPayload } from "@/lib/server/repo/briefs"
import {
  getLayoutDocument,
  insertLayoutIfAbsent,
  updateLayoutAtRevision,
} from "@/lib/server/repo/layouts"
import { ok, err, handleError } from "@/lib/server/response"
import { generateLayout } from "@/lib/mock/layout"
import { normalizeDesignLayout, saveLayoutInputSchema } from "@/lib/schemas/layout"

// Compressed body cap: rejected before/while buffering, well above any real
// autosave payload's gzip size, tight enough to bound memory for the buffer
// itself regardless of what it inflates to.
const MAX_GZIP_BODY_BYTES = 5 * 1024 * 1024 // 5 MB
// Decompressed output cap, enforced by zlib itself (see below) — bounds a
// zip-bomb payload (e.g. a few KB of gzip that would inflate to gigabytes)
// to a fixed, small amount of inflate work instead of unbounded allocation.
const MAX_DECOMPRESSED_BYTES = 15 * 1024 * 1024 // 15 MB

/** Marker error so readJsonBody's caller can return 413 instead of 400. */
class PayloadTooLargeError extends Error {
  constructor(message = "Payload too large") {
    super(message)
    this.name = "PayloadTooLargeError"
  }
}

/**
 * Reads the request body as JSON, transparently decompressing gzip payloads.
 *
 * The autosave client (src/lib/data/http.ts) gzips PUT bodies with the
 * native CompressionStream API when available, marking them with
 * `Content-Encoding: gzip`. Older/no-gzip clients (and every other caller)
 * keep sending plain JSON, so absence of that header falls through to the
 * existing `request.json()` path — full backward compatibility, no version
 * negotiation needed.
 *
 * Zip-bomb guard: a tiny gzip payload can inflate to gigabytes, which would
 * otherwise block the event loop and risk OOM. Two checks:
 *  1. The *compressed* body is rejected above `MAX_GZIP_BODY_BYTES` — first
 *     cheaply via `Content-Length` (skips buffering an oversized body at
 *     all), then again against the actual buffered size as a fallback for
 *     the rare case `Content-Length` is absent or understated.
 *  2. The *decompressed* output is capped via zlib's own `maxOutputLength`,
 *     which makes `gunzipSync` throw (`ERR_BUFFER_TOO_LARGE`) once inflated
 *     output would exceed the bound, instead of allocating past it.
 *
 * Stays synchronous (rather than `promisify(gunzip)`): once (2) bounds the
 * worst case to ~15 MB of inflate work — on the order of milliseconds, not
 * something that meaningfully blocks the event loop — the async version buys
 * negligible benefit for the added complexity of an extra promise/error
 * shape, so sync is the smaller, lower-risk change here.
 *
 * Throws PayloadTooLargeError when either size cap is hit (→ 413), or
 * SyntaxError/a zlib error on malformed input (→ 400 via the same catch
 * site as before) — callers translate both into a clean response rather
 * than letting either throw as an unhandled 500.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  const encoding = request.headers.get("content-encoding")
  if (encoding && encoding.toLowerCase().includes("gzip")) {
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_GZIP_BODY_BYTES) {
      throw new PayloadTooLargeError()
    }
    const buf = Buffer.from(await request.arrayBuffer())
    if (buf.byteLength > MAX_GZIP_BODY_BYTES) {
      throw new PayloadTooLargeError()
    }
    let decompressed: Buffer
    try {
      decompressed = gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE") {
        throw new PayloadTooLargeError()
      }
      throw e
    }
    return JSON.parse(decompressed.toString("utf-8"))
  }
  return request.json()
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    let document = await getLayoutDocument(id)
    if (!document) {
      const brief = await getBriefPayload(id)
      if (!brief) return err(404, "Brief not found")
      const layout = generateLayout(project, brief)
      document = await insertLayoutIfAbsent(
        id,
        project.currentVersionId ?? `ver-${id}`,
        layout
      )
    }
    return ok(document)
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

    let raw: unknown
    try {
      raw = await readJsonBody(request)
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        return err(413, "Layout payload too large")
      }
      return err(400, "Invalid layout payload")
    }
    const parsed = saveLayoutInputSchema.safeParse(raw)
    if (!parsed.success) return err(400, "Invalid layout payload")
    const layout = normalizeDesignLayout(parsed.data.layout)

    const saved = await updateLayoutAtRevision(
      id,
      layout.versionId ?? project.currentVersionId ?? `ver-${id}`,
      layout,
      parsed.data.expectedRevision
    )
    if (!saved) return err(409, "Layout was changed elsewhere. Reload before saving.")
    return ok(saved)
  } catch (e) {
    return handleError(e)
  }
}
