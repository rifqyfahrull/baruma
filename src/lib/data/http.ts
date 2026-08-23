import type {
  AdminSubscriptionRow,
  AdminUserRow,
  AiRenderJob,
  Alternative,
  BOQItem,
  Brief,
  DesignLayout,
  PlanRow,
  Project,
  RAB,
  Review,
  User,
} from "@/types"
import type { DataSource } from "./source"
import type { FeatureCapabilities } from "@/lib/features"
import type { SavedInterior } from "@/lib/schemas/interior"
import { normalizeLayoutDocument, type LayoutDocument, type SaveLayoutInput } from "@/lib/schemas/layout"
import type { AssistantMessage } from "@/lib/assistant/actions"
import { getPhantomToken } from "@/lib/auth/phantom-session"
import type { TemplateDetail, TemplateSummary } from "@/types/templates"
import type { CreateTemplateInput, UpdateTemplateInput } from "@/lib/schemas/templates"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

/**
 * Thrown by `req()` on a non-2xx response (other than 404, which resolves to
 * null). Carries the HTTP status and, when the body is JSON shaped like
 * `{error, message?}` (the convention used by billing enforcement — see
 * src/lib/server/response.ts's `errCode`), the parsed `code` and full `body`
 * too — so callers (e.g. src/lib/api/plan-error.ts) can react to specific
 * error codes instead of only a generic status-in-message string. Still a
 * plain `Error` subclass (`instanceof Error` holds, same `.message` format),
 * so existing generic `catch { toast.error(...) }` call sites are unaffected.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public body?: unknown
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * Gzips a JSON string via the native `CompressionStream` API (no `pako`
 * dependency). Only called when `CompressionStream` exists on `globalThis` —
 * callers must feature-detect first and fall back to a plain body otherwise
 * (SSR, older browsers, jsdom/node test environments without the Streams
 * polyfill).
 */
async function gzipJson(json: string): Promise<ArrayBuffer> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))
  return await new Response(stream).arrayBuffer()
}

/**
 * Authenticated fetch to the API. Returns null on 404.
 *
 * Auth is the shared Supabase session cookie (`.tampil.dev`). These routes are
 * same-origin (NEXT_PUBLIC_API_URL is this app's own /api/v1), so the browser
 * attaches the cookie automatically — `credentials: "same-origin"` makes that
 * explicit. `requireUser` (auth-server.ts) reads that cookie server-side.
 *
 * `opts.gzip` (default false): when true and the request has a body, attempts
 * to gzip it with `CompressionStream` and send `Content-Encoding: gzip`
 * (see `src/app/api/v1/projects/[id]/layout/route.ts`'s `readJsonBody`,
 * which transparently decompresses it). Opt-in per call site — only the
 * layout autosave PUT uses it (G2a: request bodies are ~90-130 KB there) —
 * so every other endpoint keeps sending plain JSON unchanged. Falls back to
 * a plain JSON body whenever `CompressionStream` is unavailable or
 * compression throws, so this is always backward compatible.
 */
async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { gzip?: boolean }
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  const phantomToken = getPhantomToken()
  if (phantomToken) headers.authorization = `Bearer ${phantomToken}`

  let requestBody: BodyInit | undefined =
    body !== undefined ? JSON.stringify(body) : undefined

  if (opts?.gzip && requestBody !== undefined && typeof CompressionStream !== "undefined") {
    try {
      requestBody = await gzipJson(requestBody)
      headers["content-encoding"] = "gzip"
    } catch {
      // Compression failed for some reason (e.g. Blob/stream unsupported in
      // this environment despite CompressionStream existing) — fall back to
      // the plain JSON body already in `requestBody`.
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: requestBody,
  })
  if (res.status === 404) return null as T
  if (!res.ok) {
    const parsedBody = (await res.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null
    throw new ApiError(
      `API ${method} ${path} → ${res.status}`,
      res.status,
      parsedBody?.error,
      parsedBody ?? undefined
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

async function reqSSE<T>(
  method: string,
  path: string,
  body?: unknown,
  onProgress?: (message: string) => void,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "accept": "text/event-stream",
  }
  const phantomToken = getPhantomToken()
  if (phantomToken) headers.authorization = `Bearer ${phantomToken}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return null as T
  if (!res.ok) {
    const parsedBody = (await res.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null
    throw new ApiError(
      `API ${method} ${path} → ${res.status}`,
      res.status,
      parsedBody?.error,
      parsedBody ?? undefined
    )
  }

  if (!res.body) throw new Error("No body in SSE response")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let finalResult: T | null = null
  // `error`-type frames are detected inside the same try/catch that ignores
  // malformed JSON chunks, so a thrown Error there would be immediately
  // swallowed by its own catch — callers never saw the real message, only
  // the generic "SSE completed without result" fallback below. Record it
  // here instead and (re)throw once the read loop is done.
  let streamError: Error | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6)
        if (dataStr === "[DONE]") continue
        try {
          const parsed = JSON.parse(dataStr)
          if (parsed.type === "result") {
            finalResult = parsed.data
          } else if (parsed.type === "progress" && typeof parsed.message === "string") {
            onProgress?.(parsed.message)
          } else if (parsed.type === "error") {
            streamError = new Error(parsed.error)
          }
        } catch (e) {
          // Ignore invalid JSON chunks (like empty pings)
        }
      }
    }
  }

  if (streamError) throw streamError
  if (!finalResult) throw new Error("SSE completed without result")
  return finalResult
}

export const httpSource: DataSource = {
  getCurrentUser: () => req<User>("GET", "/me"),
  updateProfile: (patch) => req<User>("PATCH", "/me", patch),

  getPlans: async () => (await req<{ plans: PlanRow[] }>("GET", "/plans")).plans,

  listProjects: () => req<Project[]>("GET", "/projects"),
  getProject: (id) => req<Project | null>("GET", `/projects/${id}`),
  createProject: (input) =>
    req<{ project: Project; brief: Brief }>("POST", "/projects", input),
  createProjectFromTemplate: (slug) =>
    req<{ projectId: string }>("POST", "/projects/from-template", { slug }),
  deleteProject: (id) =>
    req<void>("DELETE", `/projects/${id}`),
  updateProject: (id, patch) =>
    req<Project>("PATCH", `/projects/${id}`, patch),
  getProjectCapabilities: (id) =>
    req<FeatureCapabilities | null>("GET", `/projects/${id}/capabilities`),

  getBrief: (id) => req<Brief | null>("GET", `/projects/${id}/brief`),
  updateBrief: (id, patch) =>
    req<Brief>("PATCH", `/projects/${id}/brief`, patch),
  askBriefAssistant: (id, question, history) =>
    req<{ answer: string }>("POST", `/projects/${id}/brief/assistant`, {
      question,
      history,
    }),

  listAssistantMessages: async (id) =>
    (await req<{ messages: AssistantMessage[] }>("GET", `/projects/${id}/agent`))
      ?.messages ?? [],
  sendProjectAgentMessage: async (id, input, onProgress) =>
    (await reqSSE<{ message: AssistantMessage }>("POST", `/projects/${id}/agent`, input, onProgress)).message,
  sendAssistantMessage: async (id, input, onProgress) =>
    (await reqSSE<{ message: AssistantMessage }>("POST", `/projects/${id}/editor/assistant`, input, onProgress))
      .message,
  setAssistantMessageStatus: (id, messageId, status) =>
    req<void>("PATCH", `/projects/${id}/agent/${messageId}`, { status }),

  generateAlternatives: (id) =>
    req<Alternative[]>("POST", `/projects/${id}/alternatives/generate`),
  getAlternatives: (id) =>
    req<Alternative[]>("GET", `/projects/${id}/alternatives`),
  selectAlternative: (id, altId) =>
    req<Project>("POST", `/projects/${id}/alternatives/${altId}/select`),

  getRAB: (id, finishing) =>
    req<RAB | null>(
      "GET",
      `/projects/${id}/rab${finishing ? `?finishing=${finishing}` : ""}`
    ),

  saveRAB: (id, input: { items: BOQItem[]; areaM2: number; assumptions: string[] }) =>
    req<RAB>("PUT", `/projects/${id}/rab`, input),

  resetRAB: (id) => req<RAB>("DELETE", `/projects/${id}/rab`),

  getLayoutDocument: async (id) => {
    const raw = await req<LayoutDocument | DesignLayout | null>("GET", `/projects/${id}/layout`)
    if (!raw) return null
    if ("layout" in raw && "revision" in raw) return normalizeLayoutDocument(raw)
    return normalizeLayoutDocument({ layout: raw, revision: 1 })
  },
  getLayout: async (id) => (await httpSource.getLayoutDocument(id))?.layout ?? null,
  saveLayout: async (id, input: SaveLayoutInput) =>
    normalizeLayoutDocument(
      await req<LayoutDocument>("PUT", `/projects/${id}/layout`, input, { gzip: true })
    ),

  getInterior: (id) =>
    req<SavedInterior | null>("GET", `/projects/${id}/interior`),
  saveInterior: (id, payload) =>
    req<SavedInterior>("PUT", `/projects/${id}/interior`, payload),

  getReview: (id) => req<Review | null>("GET", `/projects/${id}/review`),
  addComment: (id, body) =>
    req<Review>("POST", `/projects/${id}/review/comments`, { body }),
  toggleCommentResolved: (id, cid) =>
    req<Review>("PATCH", `/projects/${id}/review/comments/${cid}/toggle`),
  setChecklistStatus: (id, role, status) =>
    req<Review>("PATCH", `/projects/${id}/review/checklist`, { role, status }),
  toggleWarningResolved: (id, wid) =>
    req<Review>("PATCH", `/projects/${id}/review/warnings/${wid}/toggle`),

  // ── share links ──
  getShareLink: (id) => req<{ url: string | null }>("GET", `/projects/${id}/share`),
  createShareLink: (id) => req<{ url: string }>("POST", `/projects/${id}/share`),
  revokeShareLink: (id) => req<void>("DELETE", `/projects/${id}/share`),

  // ── assets ──
  // NOTE: paths are relative to BASE (NEXT_PUBLIC_API_URL already ends with
  // /api/v1) — a hardcoded /api/v1 here double-prefixes and 404s in production.
  requestUploadUrl: (input) =>
    req("POST", "/assets/upload-url", input),
  createIngestionJob: (input) =>
    req("POST", "/assets/ingestion-jobs", input),
  getIngestionJob: (jobId) =>
    req("GET", `/assets/ingestion-jobs/${jobId}`),
  updateAssetMetadata: (assetId, patch) =>
    req("PATCH", `/assets/${assetId}/metadata`, patch),
  attachAssetToSlot: (input) =>
    req("POST", `/projects/${input.projectId}/slots/${input.slotId}/attach-asset`, input),
  detachAssetFromSlot: (projectId, slotId) =>
    req("DELETE", `/projects/${projectId}/slots/${slotId}/asset`),
  listMyAssets: (params) => {
    const qs = new URLSearchParams()
    if (params?.category) qs.set("category", params.category)
    if (params?.search) qs.set("search", params.search)
    if (params?.limit != null) qs.set("limit", String(params.limit))
    if (params?.offset != null) qs.set("offset", String(params.offset))
    const q = qs.toString()
    return req("GET", `/assets/my-library${q ? `?${q}` : ""}`)
  },

  // ── AI Image Renderer (Fase 8 — docs/plan-integrasi-ai-renderer-2026-08.md) ──
  requestRenderUploadUrl: (input) =>
    req("POST", `/projects/${input.projectId}/renders/upload-url`, {
      filename: input.filename,
      contentType: input.contentType,
    }),
  createRender: (projectId, input) =>
    req("POST", `/projects/${projectId}/renders`, input),
  listRenders: async (projectId) =>
    (await req<AiRenderJob[] | null>("GET", `/projects/${projectId}/renders`)) ?? [],
  getRender: (projectId, renderId) =>
    req("GET", `/projects/${projectId}/renders/${renderId}`),

  // ── admin backoffice (Task 8) ──
  // NOTE: same BASE-relative convention as the rest of this file — these
  // paths correspond to this app's own /api/v1/admin/* route handlers.
  getAdminPlans: () => req<PlanRow[]>("GET", "/admin/plans"),
  updatePlan: (row) => req<PlanRow>("PUT", "/admin/plans", row),
  getAdminSubscriptions: () =>
    req<AdminSubscriptionRow[]>("GET", "/admin/subscriptions"),
  getAdminUsers: () => req<AdminUserRow[]>("GET", "/admin/users"),
  updateUserRole: (profileId, role) =>
    req<void>("PATCH", "/admin/users", { profileId, role }),
  updateUserPlan: (profileId, plan) =>
    req<void>("PATCH", "/admin/users", { profileId, plan }),
  adjustUserCredits: (profileId, deltaTotal, reason) =>
    req<void>("POST", "/admin/users/credits", { profileId, deltaTotal, reason }),
  createPhantomLogin: (profileId) =>
    req<{ url: string; expiresAt: string }>("POST", "/admin/users/phantom-login", { profileId }),

  // ── templates ──
  getTemplates: async () =>
    (await req<{ templates: TemplateSummary[] }>("GET", "/templates")).templates,
  getTemplate: async (slug) => {
    // `req` resolves 404 to `null` (the "optional resource" convention used
    // by e.g. getProject) — templates want a thrown error instead, so we
    // convert that null back into an ApiError here.
    const found = await req<TemplateDetail | null>("GET", `/templates/${slug}`)
    if (!found) {
      throw new ApiError(`Template ${slug} not found`, 404)
    }
    return found
  },
  getAdminTemplates: () => req<TemplateSummary[]>("GET", "/admin/templates"),
  createTemplate: async (input: CreateTemplateInput) => {
    const created = await req<TemplateDetail | null>("POST", "/admin/templates", input)
    if (!created) {
      // POST replies 404 when `projectId` doesn't resolve to a project.
      throw new ApiError("Proyek tidak ditemukan", 404)
    }
    return created
  },
  updateTemplate: async (id, patch: UpdateTemplateInput) => {
    const updated = await req<TemplateSummary | null>("PATCH", `/admin/templates/${id}`, patch)
    if (!updated) {
      throw new ApiError(`Template ${id} not found`, 404)
    }
    return updated
  },
  deleteTemplate: (id) => req<void>("DELETE", `/admin/templates/${id}`),

  // ── component presets (Studio Komponen) ──
  // TODO(migrasi backend): belum ada tabel/route component_presets di API
  // nyata — mock-source (in-memory) sudah lengkap (lihat lib/mock/index.ts);
  // sambungkan ke `/component-presets` begitu migration db dibuat.
  listComponentPresets: () => {
    throw new ApiError("Preset komponen belum didukung di backend", 501)
  },
  saveComponentPreset: () => {
    throw new ApiError("Preset komponen belum didukung di backend", 501)
  },
  deleteComponentPreset: () => {
    throw new ApiError("Preset komponen belum didukung di backend", 501)
  },
}
