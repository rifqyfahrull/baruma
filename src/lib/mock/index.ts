/**
 * Mocked backend (PRD §14). An in-memory service that mimics the future API:
 * latency, mutation, generated alternatives. State lives in module scope so it
 * persists across navigations within a browser session. Replace these functions
 * with real `fetch` calls when the backend is ready — the signatures stay.
 */
import { nanoid } from "nanoid"

import type {
  AdminSubscriptionRow,
  AdminUserRow,
  AiRenderJob,
  AiRenderModeId,
  Alternative,
  BOQItem,
  Brief,
  Comment,
  ComponentPreset,
  DesignLayout,
  FinishingLevel,
  Plan,
  PlanRow,
  Project,
  RAB,
  ReadinessStatus,
  Review,
  ReviewChecklistItem,
  ReviewRole,
  User,
} from "@/types"
import type { CreateProjectInput } from "@/lib/schemas/project"
import {
  DEFAULT_FEATURE_CAPABILITIES,
  type FeatureCapabilities,
} from "@/lib/features"
import type { SavedInterior } from "@/lib/schemas/interior"
import type { LayoutDocument, SaveLayoutInput } from "@/lib/schemas/layout"
import { FINISHING_LEVELS } from "@/lib/constants"
import { buildBriefFields } from "@/lib/brief/build-brief"
import type { BriefChatTurn } from "@/lib/data/source"
import type {
  AssistantAction,
  AssistantMessage,
  AssistantMessageStatus,
  FloorplanScene,
  InteriorScene,
  ProjectAgentRequest,
  SendAssistantMessageInput,
} from "@/lib/assistant/actions"
import { describeAction, parseScene } from "@/lib/assistant/actions"
import { PHANTOM_HASH_PARAM } from "@/lib/auth/phantom-session"
import { certificationScenes } from "@/lib/exterior/certification-scenes"
import { showcaseScenes } from "@/lib/exterior/showcase-scenes"
import type { TemplateDetail, TemplateSummary } from "@/types/templates"
import type { CreateTemplateInput, UpdateTemplateInput } from "@/lib/schemas/templates"
// DEFAULT_PLANS is a pure TS data module (only a type-only import from
// @/types) — safe to pull into the client bundle despite living under
// lib/server/repo, which otherwise holds DB-only code.
import { DEFAULT_PLANS } from "@/lib/server/repo/plan-defaults"
import {
  DEMO_PROJECT_ID,
  seedAlternatives,
  seedBriefs,
  seedProjects,
  seedUser,
} from "./seed"
import { generateLayout } from "./layout"
import { generateRAB } from "./rab"
import { generateReview } from "./review"
import { summarizeRab } from "@/lib/rab/summarize"

/* ----- seed: templates ----- */

/**
 * Second template's source brief. Not part of `seedBriefs` (that only has one
 * entry, for DEMO_PROJECT_ID) — just enough spaceProgram for `generateLayout`
 * to produce a small, valid 2-floor DesignLayout for "proj-minimalis-6x15".
 */
const templateMinimalisBrief: Brief = {
  projectId: "proj-minimalis-6x15",
  summary:
    "Rumah minimalis 2 lantai di lahan 6×15 m, Bekasi. Efisien dan fungsional untuk keluarga muda.",
  site: {
    widthM: 6,
    depthM: 15,
    areaM2: 90,
    city: "Bekasi",
    province: "Jawa Barat",
    frontOrientation: "south",
    sidesAttached: 2,
    frontRoadWidthM: 5,
  },
  building: {
    floors: 2,
    rooftop: false,
    budget: { minIDR: 450_000_000, maxIDR: 650_000_000 },
    finishingLevel: "menengah",
  },
  priorities: ["hemat_biaya"],
  spaceProgram: [
    { id: "t2-sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1, preferredFloor: 1 },
    { id: "t2-sp-2", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
    { id: "t2-sp-3", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
    { id: "t2-sp-4", roomType: "ruang_makan", name: "Ruang makan", required: true, quantity: 1, preferredFloor: 1 },
    { id: "t2-sp-5", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 2 },
    { id: "t2-sp-6", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 3, preferredFloor: 2 },
  ],
  assumptions: ["Tanah relatif datar dan kering."],
  constraints: ["Lahan memanjang 6×15 m dengan 2 sisi menempel tetangga."],
  risks: [],
}

/**
 * Two small, static templates so mock mode (NEXT_PUBLIC_DATA_SOURCE !== "http")
 * has something to show in /app/admin's Templates tab and (once built) the
 * public template picker — mirrors db/migrations/0037_seed_templates.sql on
 * the real backend. Layouts reuse `generateLayout` against existing seed
 * projects/briefs rather than hand-rolling DesignLayout geometry.
 */
function buildSeedTemplates(): TemplateDetail[] {
  const demoProject = seedProjects.find((p) => p.id === DEMO_PROJECT_ID)!
  const demoBrief = seedBriefs[DEMO_PROJECT_ID]
  const minimalisProject = seedProjects.find((p) => p.id === "proj-minimalis-6x15")!

  return [
    {
      id: "tmpl-demo-8x8",
      slug: "rumah-8x8-modern-tropis",
      name: "Rumah 8×8 Modern Tropis",
      description:
        "Rumah 3 lantai + rooftop dengan void tengah dan plunge pool — cocok untuk lahan sempit yang ingin tetap terasa lega dan terang.",
      style: demoProject.style,
      city: demoProject.city,
      province: demoProject.province,
      floors: demoProject.floors,
      rooftop: demoProject.rooftop,
      thumbnail: demoProject.thumbnail,
      site: demoProject.site,
      sortOrder: 1,
      active: true,
      sourceProjectId: DEMO_PROJECT_ID,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      layout: generateLayout(demoProject, demoBrief),
      brief: structuredClone(demoBrief),
      interior: null,
    },
    {
      id: "tmpl-minimalis-6x15",
      slug: "rumah-minimalis-6x15",
      name: "Rumah Minimalis 6×15",
      description: null,
      style: minimalisProject.style,
      city: minimalisProject.city,
      province: minimalisProject.province,
      floors: minimalisProject.floors,
      rooftop: minimalisProject.rooftop,
      thumbnail: minimalisProject.thumbnail,
      site: minimalisProject.site,
      sortOrder: 2,
      active: true,
      sourceProjectId: "proj-minimalis-6x15",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      layout: generateLayout(minimalisProject, templateMinimalisBrief),
      brief: null,
      interior: null,
    },
  ]
}

/* ----- seed: component presets (Studio Komponen) ----- */

/**
 * Preset pola komponen contoh — cukup variatif untuk menunjukkan tiap
 * keluarga (kisi/roster/pagar/gerbang/pergola) sudah punya starting point
 * yang enak dipakai, bukan mengetik pitch/lebar dari nol tiap kali.
 */
const SEED_COMPONENT_PRESETS: ComponentPreset[] = [
  {
    id: "preset-kisi-kubisme-18",
    name: "Kisi Kubisme 18 bilah",
    family: "kisi",
    pattern: { orientation: "v", pitchM: 0.083, barWidthM: 0.05, barDepthM: 0.12 },
    finish: "aluminium_gelap",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "preset-jeruji-rapat-tropis",
    name: "Jeruji Rapat Tropis",
    family: "pagar",
    pattern: { orientation: "v", pitchM: 0.12, barWidthM: 0.04, barDepthM: 0.04 },
    finish: "kayu",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "preset-pergola-anyam-40",
    name: "Pergola Anyam 40cm",
    family: "pergola",
    pattern: { orientation: "cross", pitchM: 0.4, barWidthM: 0.08, barDepthM: 0.08, frame: true },
    finish: "kayu",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "preset-roster-grid-klasik",
    name: "Roster Grid Klasik",
    family: "roster",
    pattern: { orientation: "grid", pitchM: 0.25, barWidthM: 0.08, barDepthM: 0.15, frame: true },
    finish: "terakota",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "preset-panel-sirip-fluted",
    name: "Panel Sirip (Fluted)",
    family: "kisi",
    pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
    finish: "kayu",
    createdAt: "2026-08-15T00:00:00.000Z",
  },
  {
    id: "preset-nat-beton-reveal",
    name: "Nat Beton / Reveal Line",
    family: "kisi",
    pattern: {
      orientation: "grid",
      pitchM: 0.9,
      barWidthM: 0.02,
      barDepthM: 0.012,
      inset: true,
    },
    finish: "aluminium_gelap",
    createdAt: "2026-08-16T00:00:00.000Z",
  },
]

/* ----- in-memory state ----- */

const db = {
  user: structuredClone(seedUser) as User,
  // Showcase scene ikut daftar project dashboard (layout pre-built-nya
  // di-resolve ensureLayout via prebuilt-scene lookup, bukan generateLayout).
  projects: [
    ...structuredClone(seedProjects),
    ...showcaseScenes().map((scene) => structuredClone(scene.project)),
  ] as Project[],
  briefs: structuredClone(seedBriefs) as Record<string, Brief>,
  alternatives: structuredClone(seedAlternatives) as Record<string, Alternative[]>,
  layouts: {} as Record<string, DesignLayout>,
  layoutRevisions: {} as Record<string, number>,
  interiors: {} as Record<string, SavedInterior>,
  reviews: {} as Record<string, Review>,
  // Revisi layout (db.layoutRevisions) yang dipakai saat review ter-cache di
  // atas dibuat — dibandingkan di ensureReview untuk tahu kapan warnings/
  // aiSummary perlu diregenerasi tanpa membuang comments/checklist/
  // resolvedWarningIds milik user.
  reviewRevisions: {} as Record<string, number>,
  rab: {} as Record<string, RAB>,
  // Admin backoffice (Task 8) reads/writes this same array — mutations made
  // via the admin Plans tab persist for the rest of the mock session and are
  // immediately visible to getPlans()/usePlans() below, mirroring how the
  // real repo's in-memory fallback (src/lib/server/repo/plans.ts) works.
  plans: structuredClone(DEFAULT_PLANS) as PlanRow[],
  templates: buildSeedTemplates() as TemplateDetail[],
  componentPresets: structuredClone(SEED_COMPONENT_PRESETS) as ComponentPreset[],
  // Public share links (WS-D §2) — one active link per project, in-memory
  // only (client mock, per browser tab). Real persistence lives server-side
  // in src/lib/server/repo/share-links.ts; `/s/[token]` itself is a server
  // component that never reads this mock store.
  shareLinks: {} as Record<string, { token: string; revoked: boolean }>,
}

const assistantThreads: Record<string, AssistantMessage[]> = {}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function nowISO() {
  return new Date().toISOString()
}

function certificationSceneForProject(projectId: string) {
  return (
    certificationScenes().find((scene) => scene.project.id === projectId) ??
    showcaseScenes().find((scene) => scene.project.id === projectId) ??
    null
  )
}

/* ----- helpers ----- */

function computeReadiness(opts: {
  floors: number
  hasPool: boolean
  rooftop: boolean
}): ReadinessStatus {
  if (opts.floors >= 3 || opts.hasPool) return "engineer_review_required"
  if (opts.floors === 2 || opts.rooftop) return "contractor_discussion_ready"
  return "concept_ready"
}

function roomCount(brief: Brief): number {
  return brief.spaceProgram.reduce((sum, r) => sum + r.quantity, 0)
}

/* ----- service: user ----- */

export async function getCurrentUser(): Promise<User> {
  await delay(120)
  // Mirrors the real /api/v1/me route's DB-driven enrichment: attach the
  // entitlements of the user's current plan so dev/e2e (mock mode) gets the
  // same User shape as production. Mock user is never an admin by default.
  const matchingPlan = DEFAULT_PLANS.find((p) => p.id === db.user.plan)
  const phantomToken =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("baruma:phantom-token")
      : null
  const phantomUser = phantomToken?.startsWith("mock:")
    ? db.user
    : null
  return {
    ...structuredClone(db.user),
    ...(phantomUser ? structuredClone(phantomUser) : {}),
    entitlements: matchingPlan?.entitlements ?? null,
    role: "user",
  }
}

export async function updateProfile(patch: { name: string }): Promise<User> {
  await delay(200)
  db.user.name = patch.name
  return getCurrentUser()
}

/* ----- service: plans (billing) ----- */

function sortPlans(rows: PlanRow[]): PlanRow[] {
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.priceIdr - b.priceIdr)
}

/** Active plans sorted for display — mirrors GET /api/v1/plans exactly. */
export async function getPlans(): Promise<PlanRow[]> {
  await delay(150)
  return sortPlans(structuredClone(db.plans).filter((p) => p.active))
}

/* ----- service: admin backoffice (Task 8) ----- */

/** ALL plans (active + inactive) — mirrors GET /api/v1/admin/plans. */
export async function getAdminPlans(): Promise<PlanRow[]> {
  await delay(150)
  return sortPlans(structuredClone(db.plans))
}

/** Create or update a plan in the shared mock plans store (see `db.plans` above). */
export async function updatePlan(row: PlanRow): Promise<PlanRow> {
  await delay(200)
  const cloned = structuredClone(row)
  const idx = db.plans.findIndex((p) => p.id === cloned.id)
  if (idx === -1) db.plans.push(cloned)
  else db.plans[idx] = cloned
  return structuredClone(cloned)
}

/**
 * Mock mode models a single demo user, not a real multi-tenant subscriptions
 * table — there is nothing meaningful to list here. Returning `[]` mirrors a
 * genuinely-empty production Transaksi tab rather than fabricating rows.
 */
export async function getAdminSubscriptions(): Promise<AdminSubscriptionRow[]> {
  await delay(150)
  return []
}

/** Mock mode's only "profile" is the demo user itself. */
export async function getAdminUsers(): Promise<AdminUserRow[]> {
  await delay(150)
  return [
    {
      id: db.user.id,
      name: db.user.name,
      email: db.user.email,
      plan: db.user.plan,
      role: db.user.role ?? "user",
      creditsUsed: db.user.creditsUsed,
      creditsTotal: db.user.creditsTotal,
    },
  ]
}

export async function updateUserRole(
  profileId: string,
  role: "user" | "admin"
): Promise<void> {
  await delay(150)
  if (db.user.id === profileId) db.user.role = role
}

export async function updateUserPlan(profileId: string, plan: string): Promise<void> {
  await delay(150)
  if (db.user.id === profileId) db.user.plan = plan as Plan
}

/** `_reason` isn't recorded anywhere in mock mode (no credits_ledger equivalent). */
export async function adjustUserCredits(
  profileId: string,
  deltaTotal: number,
  reason: string
): Promise<void> {
  void reason
  await delay(150)
  if (db.user.id === profileId) {
    db.user.creditsTotal = Math.max(
      db.user.creditsUsed,
      db.user.creditsTotal + deltaTotal
    )
  }
}

export async function createPhantomLogin(profileId: string): Promise<{
  url: string
  expiresAt: string
}> {
  await delay(150)
  const user = db.user.id === profileId ? db.user : null
  if (!user) throw new Error("Profil tidak ditemukan")
  const hash = new URLSearchParams({
    [PHANTOM_HASH_PARAM]: `mock:${profileId}`,
    phantom_profile_id: user.id,
    phantom_profile_name: user.name,
    phantom_profile_email: user.email,
  })
  return {
    url: `/app/dashboard#${hash.toString()}`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }
}

/* ----- service: projects ----- */

export async function listProjects(): Promise<Project[]> {
  await delay(350)
  return structuredClone(db.projects).sort(
    (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
  )
}

export async function getProject(id: string): Promise<Project | null> {
  await delay(220)
  return structuredClone(
    db.projects.find((p) => p.id === id) ?? certificationSceneForProject(id)?.project ?? null
  )
}

export async function updateProject(
  id: string,
  patch: { name: string }
): Promise<Project> {
  await delay(300)
  const project = db.projects.find((p) => p.id === id)
  if (!project) throw new Error("Project tidak ditemukan")
  project.name = patch.name
  touchProject(id)
  return structuredClone(project)
}

export async function deleteProject(id: string): Promise<void> {
  await delay(350)
  const idx = db.projects.findIndex((p) => p.id === id)
  if (idx === -1) throw new Error("Project tidak ditemukan")
  db.projects.splice(idx, 1)
  delete db.briefs[id]
  delete db.alternatives[id]
  delete db.layouts[id]
  delete db.interiors[id]
  delete db.reviews[id]
  delete db.reviewRevisions[id]
  delete db.rab[id]
  delete db.shareLinks[id]
}

/**
 * Mock DB-less dev/e2e: semua capability rollout eksterior aktif — paritas
 * dengan default env produksi (enabled 100%, lihat src/lib/features.ts).
 */
export async function getProjectCapabilities(): Promise<FeatureCapabilities> {
  await delay(60)
  return { ...DEFAULT_FEATURE_CAPABILITIES }
}

export async function createProject(
  input: CreateProjectInput
): Promise<{ project: Project; brief: Brief }> {
  await delay(700)

  const areaM2 = round1(input.widthM * input.depthM)
  const hasPool = input.rooms.some((r) => r.roomType === "kolam")
  const readiness = computeReadiness({
    floors: input.floors,
    hasPool,
    rooftop: input.rooftop,
  })

  const id = `proj-${nanoid(8)}`
  const ts = nowISO()

  const project: Project = {
    id,
    name: input.name,
    status: "brief",
    readiness,
    location: input.city,
    city: input.city,
    style: input.style,
    projectType: input.projectType,
    thumbnail: hasPool ? "courtyard" : input.floors >= 3 ? "vertical" : "family",
    site: {
      widthM: input.widthM,
      depthM: input.depthM,
      areaM2,
      city: input.city,
      frontOrientation: input.frontOrientation,
      sidesAttached: input.sidesAttached,
      frontRoadWidthM: input.frontRoadWidthM,
      notes: input.siteNotes,
      regulation: input.regulation,
    },
    floors: input.floors,
    rooftop: input.rooftop,
    createdAt: ts,
    updatedAt: ts,
  }

  const brief: Brief = {
    projectId: id,
    ...buildBriefFields(input),
  }

  db.projects.unshift(project)
  db.briefs[id] = brief
  return { project: structuredClone(project), brief: structuredClone(brief) }
}

/**
 * Clone a curated template's brief + layout into a brand-new owned project —
 * mirrors `POST /api/v1/projects/from-template`. No quota gate here (the
 * mock db doesn't model plan entitlements at all — see createProject above).
 */
export async function createProjectFromTemplate(slug: string): Promise<{ projectId: string }> {
  await delay(500)
  const template = db.templates.find((t) => t.slug === slug && t.active)
  if (!template) throw new Error(`Template tidak ditemukan: ${slug}`)

  const id = `proj-${nanoid(8)}`
  const ts = nowISO()
  const project: Project = {
    id,
    name: `${template.name} (salinan)`,
    status: "editing",
    readiness: "concept_ready",
    location: template.city,
    city: template.city,
    province: template.province,
    style: template.style,
    projectType: "new",
    thumbnail: template.thumbnail,
    site: structuredClone(template.site),
    floors: template.floors,
    rooftop: template.rooftop,
    createdAt: ts,
    updatedAt: ts,
  }
  db.projects.unshift(project)
  if (template.brief) db.briefs[id] = { ...structuredClone(template.brief), projectId: id }
  db.layouts[id] = structuredClone(template.layout)

  return { projectId: id }
}

/* ----- service: brief ----- */

export async function getBrief(projectId: string): Promise<Brief | null> {
  await delay(260)
  return structuredClone(db.briefs[projectId] ?? null)
}

export async function updateBrief(
  projectId: string,
  patch: Partial<Brief>
): Promise<Brief> {
  await delay(300)
  const current = db.briefs[projectId]
  if (!current) throw new Error("Brief tidak ditemukan")
  db.briefs[projectId] = { ...current, ...patch }
  // Project.site is what the audit engine reads (not Brief.site) — keep it in
  // sync whenever the brief's site (incl. regulation override) is edited.
  // Without this, editing "Aturan tata ruang" post-create would silently not
  // affect the audit until the project is re-created.
  if (patch.site) {
    const project = db.projects.find((p) => p.id === projectId)
    if (project) project.site = { ...project.site, ...patch.site }
  }
  touchProject(projectId)
  return structuredClone(db.briefs[projectId])
}

export async function askBriefAssistant(
  projectId: string,
  question: string,
  history: BriefChatTurn[]
): Promise<{ answer: string }> {
  void history
  await delay(500)
  const brief = db.briefs[projectId]
  if (!brief) throw new Error("Brief tidak ditemukan")
  const rooms = brief.spaceProgram.filter((r) => r.roomType !== "carport").length
  return {
    answer:
      `(Mode demo) Pertanyaanmu: "${question}". Berdasarkan brief ini — ` +
      `${brief.building.floors} lantai di lahan ${brief.site.widthM}×${brief.site.depthM} m ` +
      `dengan ${rooms} jenis ruang — ini jawaban contoh. Konfigurasikan agent ` +
      `baruma-assistant di Agent Lab untuk jawaban AI sungguhan.`,
  }
}

export async function listAssistantMessages(projectId: string): Promise<AssistantMessage[]> {
  await delay(150)
  return structuredClone(assistantThreads[projectId] ?? [])
}

export async function sendAssistantMessage(
  projectId: string,
  input: SendAssistantMessageInput
): Promise<AssistantMessage> {
  await delay(500)
  const thread = assistantThreads[projectId] ?? (assistantThreads[projectId] = [])
  thread.push({
    id: `msg-${nanoid(12)}`, projectId, mode: input.mode, role: "user",
    content: input.instruction, createdAt: nowISO(),
  })

  // Demo: one safe sample action from the scene (mirrors the real flow shape).
  const actions: AssistantAction[] = []
  if (input.mode === "floorplan") {
    const s = input.scene as FloorplanScene
    const room = s.rooms.find((r) => r.id === s.selectedRoomId) ?? s.rooms[0]
    if (room) actions.push({ type: "updateRoom", roomId: room.id, patch: { requiresNaturalLight: true } })
  } else {
    const s = input.scene as InteriorScene
    const room = s.rooms.find((r) => r.roomId === s.selectedRoomId) ?? s.rooms[0]
    if (room) actions.push({ type: "addFurniture", roomId: room.roomId, furnitureId: "coffee-table" })
  }
  const assistant: AssistantMessage = {
    id: `msg-${nanoid(12)}`, projectId, mode: input.mode, role: "assistant",
    content: `(Mode demo) Perintahmu: "${input.instruction}". Aktifkan backend + LLM untuk asisten sungguhan.`,
    actions: actions.length ? actions : undefined,
    actionLabels: actions.length ? actions.map((a) => describeAction(a, input.scene)) : undefined,
    status: actions.length ? "proposed" : null,
    createdAt: nowISO(),
  }
  thread.push(assistant)
  return structuredClone(assistant)
}

export async function sendProjectAgentMessage(
  projectId: string,
  input: ProjectAgentRequest
): Promise<AssistantMessage> {
  const thread = assistantThreads[projectId] ?? (assistantThreads[projectId] = [])
  const duplicate = thread.find(
    (message) => message.role === "assistant" && message.clientRequestId === input.clientRequestId
  )
  if (duplicate) return structuredClone(duplicate)

  const surfaceDefault = input.surface === "editor"
    ? "floorplan"
    : input.surface === "preview-3d" || input.surface === "furniture" || input.surface === "materials"
      ? "interior"
      : "brief"
  const mode = input.requestedMode === "auto" ? surfaceDefault : input.requestedMode
  const turnId = `turn-${nanoid(12)}`
  thread.push({
    id: `msg-${nanoid(12)}`,
    projectId,
    mode,
    surface: input.surface,
    turnId,
    clientRequestId: input.clientRequestId,
    requestState: "completed",
    role: "user",
    content: input.instruction,
    createdAt: nowISO(),
  })

  let actions: AssistantAction[] = []
  let scene: FloorplanScene | InteriorScene | null = null
  if (mode !== "brief" && input.liveScene?.mode === mode) {
    scene = parseScene(mode, input.liveScene.payload) as FloorplanScene | InteriorScene | null
  }
  if (mode === "floorplan" && scene) {
    const floorplan = scene as FloorplanScene
    const room = floorplan.rooms.find((candidate) => candidate.id === floorplan.selectedRoomId)
      ?? floorplan.rooms[0]
    if (room) actions = [{ type: "updateRoom", roomId: room.id, patch: { requiresNaturalLight: true } }]
  } else if (mode === "interior" && scene) {
    const interior = scene as InteriorScene
    const room = interior.rooms.find((candidate) => candidate.roomId === interior.selectedRoomId)
      ?? interior.rooms[0]
    if (room) actions = [{ type: "addFurniture", roomId: room.roomId, furnitureId: "coffee-table" }]
  }

  const assistant: AssistantMessage = {
    id: `msg-${nanoid(12)}`,
    projectId,
    mode,
    surface: input.surface,
    turnId,
    clientRequestId: input.clientRequestId,
    role: "assistant",
    content: mode === "brief"
      ? `(Mode demo) Saya menjawab pertanyaan proyek dalam thread unified: "${input.instruction}".`
      : scene
        ? `(Mode demo) Usulan ${mode === "floorplan" ? "Denah" : "Interior"} sudah dibuat.`
        : `Buka halaman ${mode === "floorplan" ? "Editor" : "Preview 3D"} agar konteks live tersedia.`,
    actions: actions.length ? actions : undefined,
    actionLabels: actions.length && scene ? actions.map((action) => describeAction(action, scene!)) : undefined,
    status: actions.length ? "proposed" : null,
    createdAt: nowISO(),
  }
  thread.push(assistant)
  return structuredClone(assistant)
}

export async function setAssistantMessageStatus(
  projectId: string,
  messageId: string,
  status: AssistantMessageStatus
): Promise<void> {
  await delay(100)
  const m = assistantThreads[projectId]?.find((x) => x.id === messageId)
  if (m) m.status = status
}

/* ----- service: alternatives ----- */

export async function generateAlternatives(
  projectId: string
): Promise<Alternative[]> {
  await delay(1600)
  const brief = db.briefs[projectId]
  if (!brief) throw new Error("Brief tidak ditemukan")

  const alts = db.alternatives[projectId] ?? buildAlternatives(projectId, brief)
  db.alternatives[projectId] = alts
  setStatus(projectId, "alternatives")
  return structuredClone(alts)
}

export async function getAlternatives(
  projectId: string
): Promise<Alternative[]> {
  await delay(300)
  return structuredClone(db.alternatives[projectId] ?? [])
}

export async function selectAlternative(
  projectId: string,
  alternativeId: string
): Promise<Project> {
  await delay(600)
  const alts = db.alternatives[projectId] ?? []
  const alt = alts.find((a) => a.id === alternativeId)
  if (!alt) throw new Error("Alternatif tidak ditemukan")
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) throw new Error("Project tidak ditemukan")

  project.currentVersionId = `ver-${nanoid(6)}`
  project.status = "editing"
  project.readiness = alt.readiness
  project.thumbnail = alt.thumbnail
  project.updatedAt = nowISO()
  return structuredClone(project)
}

/* ----- service: layout (2D editor) ----- */

function ensureLayout(projectId: string): DesignLayout | null {
  if (db.layouts[projectId]) return db.layouts[projectId]
  const certificationScene = certificationSceneForProject(projectId)
  if (certificationScene) {
    db.layouts[projectId] = structuredClone(certificationScene.layout)
    db.layoutRevisions[projectId] = 1
    return db.layouts[projectId]
  }
  const project = db.projects.find((p) => p.id === projectId)
  const brief = db.briefs[projectId]
  if (!project || !brief) return null
  const layout = generateLayout(project, brief)
  db.layouts[projectId] = layout
  db.layoutRevisions[projectId] = 1
  return layout
}

export async function getLayout(projectId: string): Promise<DesignLayout | null> {
  return (await getLayoutDocument(projectId))?.layout ?? null
}

export async function getLayoutDocument(projectId: string): Promise<LayoutDocument | null> {
  await delay(450)
  const layout = ensureLayout(projectId)
  if (!layout) return null
  return {
    layout: structuredClone({ ...layout, schemaVersion: 2 }),
    revision: db.layoutRevisions[projectId] ?? 1,
  }
}

export async function saveLayout(
  projectId: string,
  input: SaveLayoutInput
): Promise<LayoutDocument> {
  await delay(350)
  const currentRevision = db.layoutRevisions[projectId] ?? 1
  if (input.expectedRevision !== currentRevision) {
    throw new Error("Layout was changed elsewhere. Reload before saving.")
  }
  db.layouts[projectId] = structuredClone({ ...input.layout, schemaVersion: 2 })
  db.layoutRevisions[projectId] = currentRevision + 1
  touchProject(projectId)
  return {
    layout: structuredClone(db.layouts[projectId]),
    revision: db.layoutRevisions[projectId],
  }
}

/* ----- service: interior ----- */

export async function getInterior(projectId: string): Promise<SavedInterior | null> {
  await delay(300)
  return db.interiors[projectId] ? structuredClone(db.interiors[projectId]) : null
}

export async function saveInterior(
  projectId: string,
  payload: SavedInterior
): Promise<SavedInterior> {
  await delay(250)
  db.interiors[projectId] = structuredClone(payload)
  return structuredClone(db.interiors[projectId])
}

/* ----- service: RAB / BOQ ----- */

export async function getRAB(
  projectId: string,
  finishing?: FinishingLevel
): Promise<RAB | null> {
  await delay(500)
  // Return persisted manual RAB if it exists
  if (db.rab[projectId]) return structuredClone(db.rab[projectId])
  const project = db.projects.find((p) => p.id === projectId)
  const brief = db.briefs[projectId]
  const layout = ensureLayout(projectId)
  if (!project || !brief || !layout) return null
  return structuredClone(generateRAB(project, brief, layout, finishing))
}

export async function saveRAB(
  projectId: string,
  input: { items: BOQItem[]; areaM2: number; assumptions: string[] }
): Promise<RAB> {
  await delay(350)
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) throw new Error("Project tidak ditemukan")
  const { items, summary } = summarizeRab(input.items, input.areaM2)
  const rab: RAB = {
    projectId,
    versionId: project.currentVersionId ?? `ver-${projectId}`,
    areaM2: input.areaM2,
    summary,
    items,
    assumptions: input.assumptions,
    manual: true,
  }
  db.rab[projectId] = rab
  return structuredClone(rab)
}

export async function resetRAB(projectId: string): Promise<RAB> {
  await delay(350)
  delete db.rab[projectId]
  const project = db.projects.find((p) => p.id === projectId)
  const brief = db.briefs[projectId]
  const layout = ensureLayout(projectId)
  if (!project || !brief || !layout) throw new Error("Project tidak ditemukan")
  return structuredClone(generateRAB(project, brief, layout))
}

/* ----- service: review (PRD §10.10) ----- */

function ensureReview(projectId: string): Review | null {
  const cached = db.reviews[projectId]
  const layoutRevision = db.layoutRevisions[projectId] ?? 1

  // Review masih segar (dibuat dari revisi layout yang sama) — tidak perlu
  // regenerasi. Ini juga menjaga perilaku lama: akses pertama tetap generate.
  if (cached && db.reviewRevisions[projectId] === layoutRevision) return cached

  const project = db.projects.find((p) => p.id === projectId)
  const brief = db.briefs[projectId]
  const layout = ensureLayout(projectId)
  if (!project || !brief || !layout) return null

  const review = generateReview(project, brief, layout)
  if (cached) {
    // Layout berubah (mis. lewat saveLayout) sejak review terakhir dibuat:
    // pakai warnings/aiSummary/checklist BARU (turunan dari layout terkini),
    // tapi pertahankan state milik user — comments & status checklist yang
    // sudah diisi tidak boleh hilang tiap autosave.
    review.comments = cached.comments
    review.checklist = cached.checklist
    // Warning lama yang sudah ditandai selesai tapi kini tidak lagi muncul
    // (mis. overlap yang sudah diperbaiki) disaring — tidak ada gunanya
    // menyimpan id warning yang sudah tidak ada di daftar terbaru.
    const currentWarningIds = new Set(review.warnings.map((w) => w.id))
    review.resolvedWarningIds = cached.resolvedWarningIds.filter((id) =>
      currentWarningIds.has(id)
    )
  }
  db.reviews[projectId] = review
  db.reviewRevisions[projectId] = layoutRevision
  return review
}

export async function getReview(projectId: string): Promise<Review | null> {
  await delay(400)
  const review = ensureReview(projectId)
  return review ? structuredClone(review) : null
}

export async function addComment(
  projectId: string,
  body: string,
  author = "Kamu"
): Promise<Review> {
  await delay(250)
  const review = ensureReview(projectId)
  if (!review) throw new Error("Review tidak ditemukan")
  const comment: Comment = {
    id: `c-${nanoid(6)}`,
    author,
    body,
    createdAt: nowISO(),
    resolved: false,
  }
  review.comments = [...review.comments, comment]
  touchProject(projectId)
  return structuredClone(review)
}

export async function toggleCommentResolved(
  projectId: string,
  commentId: string
): Promise<Review> {
  await delay(150)
  const review = ensureReview(projectId)
  if (!review) throw new Error("Review tidak ditemukan")
  const c = review.comments.find((x) => x.id === commentId)
  if (c) c.resolved = !c.resolved
  return structuredClone(review)
}

export async function setChecklistStatus(
  projectId: string,
  role: ReviewRole,
  status: ReviewChecklistItem["status"]
): Promise<Review> {
  await delay(150)
  const review = ensureReview(projectId)
  if (!review) throw new Error("Review tidak ditemukan")
  const item = review.checklist.find((x) => x.role === role)
  if (item) item.status = status
  touchProject(projectId)
  return structuredClone(review)
}

export async function toggleWarningResolved(
  projectId: string,
  warningId: string
): Promise<Review> {
  await delay(150)
  const review = ensureReview(projectId)
  if (!review) throw new Error("Review tidak ditemukan")
  const set = new Set(review.resolvedWarningIds)
  if (set.has(warningId)) set.delete(warningId)
  else set.add(warningId)
  review.resolvedWarningIds = [...set]
  return structuredClone(review)
}

/* ----- service: share links ----- */

function mockShareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://baruma.tampil.dev"
  return `${origin}/s/${token}`
}

/** Mirrors GET /api/v1/projects/[id]/share — current active link, if any. */
export async function getShareLink(projectId: string): Promise<{ url: string | null }> {
  await delay(150)
  const link = db.shareLinks[projectId]
  return { url: link && !link.revoked ? mockShareUrl(link.token) : null }
}

/** Mirrors POST /api/v1/projects/[id]/share — idempotent per project. */
export async function createShareLink(projectId: string): Promise<{ url: string }> {
  await delay(300)
  const existing = db.shareLinks[projectId]
  if (existing && !existing.revoked) return { url: mockShareUrl(existing.token) }
  const token = nanoid(21)
  db.shareLinks[projectId] = { token, revoked: false }
  return { url: mockShareUrl(token) }
}

/** Mirrors DELETE /api/v1/projects/[id]/share — "Nonaktifkan tautan". */
export async function revokeShareLink(projectId: string): Promise<void> {
  await delay(200)
  const existing = db.shareLinks[projectId]
  if (existing) existing.revoked = true
}

/* ----- internal builders ----- */

function buildAlternatives(projectId: string, brief: Brief): Alternative[] {
  const builtArea = round1(
    brief.site.areaM2 * brief.building.floors * 0.85
  )
  const perM2 = FINISHING_LEVELS[brief.building.finishingLevel].perM2IDR
  const rooms = roomCount(brief)
  const hasPool = brief.spaceProgram.some((s) => s.roomType === "kolam")
  const readiness = computeReadiness({
    floors: brief.building.floors,
    hasPool,
    rooftop: brief.building.rooftop,
  })
  const base = builtArea * perM2

  const make = (
    idSuffix: string,
    name: string,
    type: Alternative["type"],
    score: number,
    costFactor: number,
    thumbnail: Alternative["thumbnail"],
    description: string,
    keyFeatures: string[],
    pros: string[],
    cons: string[]
  ): Alternative => ({
    id: `alt-${idSuffix}`,
    projectId,
    name,
    type,
    score,
    thumbnail,
    description,
    keyFeatures,
    pros,
    cons,
    estimatedCost: {
      minIDR: Math.round((base * costFactor * 0.92) / 1_000_000) * 1_000_000,
      maxIDR: Math.round((base * costFactor * 1.12) / 1_000_000) * 1_000_000,
    },
    readiness,
    risks: brief.risks
      .filter((r) => r.level !== "info")
      .slice(0, 2)
      .map((r) => ({ level: r.level, label: r.title })),
    areaM2: builtArea,
    roomCount: rooms,
    floors: brief.building.floors,
  })

  return [
    make(
      "lega",
      "Terasa Lega",
      "terasa_lega",
      87,
      1.05,
      "courtyard",
      "Memprioritaskan kesan lapang dan cahaya dengan void/bukaan strategis.",
      ["Void untuk cahaya", "Ruang publik menyatu", "Sirkulasi udara baik"],
      ["Terasa paling lega", "Cahaya alami maksimal"],
      ["Void mengurangi luas lantai"]
    ),
    make(
      "keluarga",
      "Keluarga Besar",
      "keluarga_besar",
      83,
      1.0,
      "family",
      "Memaksimalkan jumlah kamar dan ruang kumpul untuk keluarga besar.",
      ["Area kumpul luas", "Kamar maksimal", "Dapur + ruang makan menyatu"],
      ["Kapasitas besar", "Fleksibel"],
      ["Kamar relatif kompak"]
    ),
    make(
      "hemat",
      "Hemat Biaya",
      "hemat_biaya",
      79,
      0.9,
      "vertical",
      "Tata ruang efisien dan struktur sederhana untuk menekan biaya.",
      ["Struktur sederhana", "Luas lantai maksimal", "Mudah dibangun"],
      ["Paling hemat", "Cepat dibangun"],
      ["Kurang dramatis"]
    ),
  ]
}

function setStatus(projectId: string, status: Project["status"]) {
  const p = db.projects.find((x) => x.id === projectId)
  if (p) {
    p.status = status
    p.updatedAt = nowISO()
  }
}

function touchProject(projectId: string) {
  const p = db.projects.find((x) => x.id === projectId)
  if (p) p.updatedAt = nowISO()
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

/* ----- service: assets (furnimesh model ingestion) ----- */

const mockAssets = {} as Record<string, Array<{
  id: string
  name: string
  category: string
  modelUrl?: string
  thumbnailUrl?: string
  sourceName?: string
  sourceUrl?: string
  fileSizeBytes?: number
  widthM?: number
  depthM?: number
  heightM?: number
  /** Harga level aset (Rp) — paritas `user_assets.price_idr`; diwariskan ke
   *  setiap penempatan furniture. Absent = "belum dihargai" di budget/RAB. */
  priceIDR?: number
  status: string
}>>

const mockJobs = {} as Record<string, {
  jobId: string
  assetId: string
  status: string
  progress: number
  validationResult?: unknown
  requiredUserInputs?: string[]
}>

export async function requestUploadUrl(input: {
  projectId: string
  filename: string
  contentType: string
  fileSizeBytes: number
}): Promise<{ uploadUrl: string; fileUrl: string; expiresIn: number }> {
  await delay(200)
  if (!input.filename.endsWith(".glb")) {
    throw new Error("Hanya file GLB yang didukung")
  }
  if (input.fileSizeBytes > 100 * 1024 * 1024) {
    throw new Error("Ukuran file maksimal 100MB")
  }
  const id = nanoid(12)
  return {
    uploadUrl: `https://mock-storage.example.com/upload/${id}/${input.filename}`,
    fileUrl: `mock://assets/${id}/${input.filename}`,
    expiresIn: 900,
  }
}

export async function createIngestionJob(input: {
  projectId: string
  roomId?: string
  slotId?: string
  expectedCategory: string
  fileUrl: string
  originalFilename: string
  sourceName?: string
  sourceUrl?: string
}): Promise<{ jobId: string; assetId: string; status: string }> {
  await delay(400)
  const jobId = `job-${nanoid(8)}`
  const assetId = `asset-${nanoid(8)}`
  mockJobs[jobId] = {
    jobId,
    assetId,
    status: "uploaded",
    progress: 10,
    requiredUserInputs: ["width_m", "depth_m", "height_m", "license_confirmation"],
  }
  const bucket = (mockAssets[input.projectId] ??= [])
  bucket.unshift({
    id: assetId,
    name: input.originalFilename.replace(/\.glb$/i, ""),
    category: input.expectedCategory,
    modelUrl: input.fileUrl,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    status: "uploaded",
  })
  return { jobId, assetId, status: "uploaded" }
}

export async function getIngestionJob(jobId: string) {
  await delay(200)
  const job = mockJobs[jobId]
  if (!job) return null
  // Simulate progress
  job.progress = Math.min(100, job.progress + 25)
  if (job.progress >= 50 && job.status === "uploaded") {
    job.status = "analyzing_model"
  }
  if (job.progress >= 80 && job.status === "analyzing_model") {
    job.status = "needs_scale"
  }
  return structuredClone(job)
}

export async function updateAssetMetadata(assetId: string, patch: Record<string, unknown>) {
  await delay(250)
  // Persist harga level aset ke library mock (paritas kolom price_idr) supaya
  // penempatan berikutnya dari My Library mewarisi harga yang sudah diisi.
  if ("price_idr" in patch) {
    const v = patch.price_idr
    const price = typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
    for (const bucket of Object.values(mockAssets)) {
      const asset = bucket.find((a) => a.id === assetId)
      if (asset) asset.priceIDR = price
    }
  }
  return { assetId, ...patch, updatedAt: nowISO() }
}

export async function attachAssetToSlot(input: {
  projectId: string
  slotId: string
  assetId: string
  fitMode?: string
  materialMode?: string
  materialMap?: Record<string, string>
}) {
  await delay(500)
  return {
    slotId: input.slotId,
    assetId: input.assetId,
    consistencyScore: 88,
    warnings: [] as string[],
  }
}

export async function detachAssetFromSlot(projectId: string, slotId: string) {
  await delay(300)
  return { slotId, status: "placeholder" }
}

/**
 * Aset KATALOG GLOBAL (paritas mock utk `user_assets.is_public` di DB nyata:
 * migration 0011/0012 — bank aset SKP → GLB yang tampil untuk SEMUA user).
 * modelUrl memakai GLB katalog lokal agar preview 3D kartu tetap hidup di
 * mode mock/e2e tanpa object storage.
 */
const mockGlobalAssets = [
  { id: "asset-glb-w2-people-1", name: "People 1", category: "generic", modelUrl: "/models/bed.glb", sourceName: "Baruma Asset Bank", widthM: 0.6, depthM: 0.5, heightM: 1.75, status: "uploaded" },
  { id: "asset-glb-w2-tanaman-2", name: "Tanaman 2", category: "generic", modelUrl: "/models/coffee-table-wood.glb", sourceName: "Baruma Asset Bank", widthM: 1.2, depthM: 1.2, heightM: 2.1, status: "uploaded" },
  { id: "asset-glb-w3-sofa-itali-1", name: "Sofa Itali 1", category: "sofa", modelUrl: "/models/dining-table-edo.glb", sourceName: "Baruma Asset Bank", widthM: 2.4, depthM: 1.0, heightM: 0.85, priceIDR: 7_500_000, status: "uploaded" },
  { id: "asset-glb-w3-jam-dinding-1", name: "Jam Dinding 1", category: "generic", modelUrl: "/models/bed-queen-b19.glb", sourceName: "Baruma Asset Bank", widthM: 0.4, depthM: 0.05, heightM: 0.4, priceIDR: 350_000, status: "uploaded" },
  { id: "asset-glb-w4-rumput-tanaman-2", name: "Rumput Tanaman 2", category: "generic", modelUrl: "/models/coffee-table-wood.glb", sourceName: "Baruma Asset Bank", widthM: 2.14, depthM: 2.17, heightM: 0.15, status: "uploaded" },
  { id: "asset-glb-w4-kasur-1", name: "Kasur 1", category: "generic", modelUrl: "/models/bed-queen-b19.glb", sourceName: "Baruma Asset Bank", widthM: 1.8, depthM: 2.0, heightM: 0.55, priceIDR: 4_500_000, status: "uploaded" },
  { id: "asset-glb-w4-wall-panel-1", name: "Wall Panel 1", category: "generic", modelUrl: "/models/coffee-table-wood.glb", sourceName: "Baruma Asset Bank", widthM: 1.2, depthM: 0.05, heightM: 2.6, performance: { estimatedTriangleCount: 48_000, drawCalls: 12 }, status: "uploaded" },
]

export async function listMyAssets(params?: {
  category?: string
  search?: string
  limit?: number
  offset?: number
}) {
  await delay(350)
  // Aset user = editable; katalog global (Baruma Asset Bank) = read-only.
  const own = Object.values(mockAssets).flat().map((a) => ({ ...a, editable: true }))
  const global = mockGlobalAssets.map((a) => ({ ...a, editable: false }))
  let filtered = [...own, ...global]
  if (params?.category) {
    filtered = filtered.filter((a) => a.category === params.category)
  }
  if (params?.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase()
    filtered = filtered.filter((a) =>
      [a.name, a.category, a.sourceName].some((v) => v?.toLowerCase().includes(q)),
    )
  }
  const total = filtered.length
  const offset = Math.max(0, Math.floor(params?.offset ?? 0))
  const limit = Math.min(Math.max(1, Math.floor(params?.limit ?? 30)), 100)
  return { total, items: filtered.slice(offset, offset + limit) }
}

/* ----- service: AI Image Renderer (Fase 8 — docs/plan-integrasi-ai-renderer-2026-08.md) ----- */

/**
 * Placeholder hasil render mode mock — SVG gradien inline (data URI). Mock
 * tak punya object storage nyata utk membaca kembali PNG beauty/depth yang
 * "diupload" klien (uploadUrl mock cuma host palsu, lihat
 * `requestRenderUploadUrl`), jadi hasil render selalu placeholder statis ini
 * — cukup utk demo alur UI (progress → hasil → unduh) tanpa provider AI nyata.
 */
const MOCK_RENDER_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#bfdbfe"/>' +
    "</linearGradient></defs>" +
    '<rect width="960" height="540" fill="url(#g)"/>' +
    '<text x="480" y="270" font-family="sans-serif" font-size="28" fill="#1e3a8a" text-anchor="middle">' +
    "Visualisasi AI (mock)</text></svg>"
)}`

const mockRenders: Record<string, AiRenderJob[]> = {}
// paramsHash -> job — cermin `findCachedRender` (mock single-user, jadi global
// sudah cukup merepresentasikan "milik user ini").
const mockRenderCache: Record<string, AiRenderJob> = {}

export async function requestRenderUploadUrl(input: {
  projectId: string
  filename: string
  contentType: string
}): Promise<{ key: string; uploadUrl: string }> {
  await delay(150)
  const key = `renders/mock-user/${input.projectId}/${Date.now()}-${input.filename}`
  // Host palsu — sama pola dgn requestUploadUrl (assets); e2e mengintersep
  // PUT ke sini via page.route agar tidak menyentuh jaringan nyata.
  return { key, uploadUrl: `https://mock-storage.example.com/upload/${key}` }
}

export async function createRender(
  projectId: string,
  input: {
    mode: AiRenderModeId
    preset: string
    shotId: string
    clientRequestId: string
    inputKeys: { beauty: string; depth?: string }
    paramsHash: string
    // Pose kamera — mode mock mengabaikannya (tidak ada analyzeScene di
    // sini), tetap diterima utk paritas kontrak DataSource.
    pose: { position: [number, number, number]; target: [number, number, number]; fov: number }
    target?: "exterior" | "interior"
    roomId?: string
    styleNotes?: string
  }
): Promise<{ job: AiRenderJob; cached: boolean }> {
  await delay(600)

  const cachedJob = mockRenderCache[input.paramsHash]
  if (cachedJob) return { job: structuredClone(cachedJob), cached: true }

  // Mock TIDAK menegakkan billing/plan (paritas createProject dkk di file
  // ini — enforcement kredit/plan hanya diuji lewat route.test.ts server,
  // bukan mode mock). Kredit tetap dipotong utk paritas visual sidebar.
  const cost = input.mode === "presisi" ? 2 : 1
  db.user.creditsUsed = Math.min(db.user.creditsTotal, db.user.creditsUsed + cost)

  const job: AiRenderJob = {
    id: `rnd-${nanoid(10)}`,
    status: "succeeded",
    mode: input.mode,
    preset: input.preset,
    shotId: input.shotId,
    // Paritas server (renderJobView): target default eksterior, roomId hanya
    // ikut utk render interior per ruang — dipakai badge galeri riwayat.
    target: input.target ?? "exterior",
    ...(input.roomId ? { roomId: input.roomId } : {}),
    // Paritas server (spec 2026-08-29 ai-render-chat-style-notes): mock
    // menyalin styleNotes apa adanya (server-lah yang sanitasi) — cukup utk
    // paritas kontrak/galeri, mock tak menyusun prompt sungguhan.
    ...(input.styleNotes ? { styleNotes: input.styleNotes } : {}),
    watermarked: db.user.plan === "free",
    outputUrl: MOCK_RENDER_PLACEHOLDER,
    createdAt: nowISO(),
  }
  const bucket = (mockRenders[projectId] ??= [])
  bucket.unshift(job)
  mockRenderCache[input.paramsHash] = job
  return { job: structuredClone(job), cached: false }
}

export async function listRenders(projectId: string): Promise<AiRenderJob[]> {
  await delay(200)
  return structuredClone(mockRenders[projectId] ?? [])
}

export async function getRender(
  projectId: string,
  renderId: string
): Promise<AiRenderJob | null> {
  await delay(150)
  const job = (mockRenders[projectId] ?? []).find((j) => j.id === renderId)
  return job ? structuredClone(job) : null
}

/* ----- service: templates ----- */

function toTemplateSummary(row: TemplateDetail): TemplateSummary {
  const { layout: _layout, brief: _brief, interior: _interior, ...summary } = row
  return summary
}

function sortMockTemplates<T extends TemplateSummary>(rows: T[]): T[] {
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/** Active, sorted templates — mirrors GET /api/v1/templates. */
export async function getTemplates(): Promise<TemplateSummary[]> {
  await delay(200)
  const rows = db.templates.filter((t) => t.active).map(toTemplateSummary)
  return structuredClone(sortMockTemplates(rows))
}

/**
 * Full design payload for one ACTIVE template — mirrors
 * `getTemplateBySlug(slug, {activeOnly: true})`. Unlike `getProject`, a
 * missing/inactive template throws instead of resolving to null (matches
 * the httpSource contract, which converts the route's 404 into an ApiError).
 */
export async function getTemplate(slug: string): Promise<TemplateDetail> {
  await delay(250)
  const found = db.templates.find((t) => t.slug === slug && t.active)
  if (!found) throw new Error(`Template tidak ditemukan: ${slug}`)
  return structuredClone(found)
}

/** ALL templates (active + inactive) — mirrors GET /api/v1/admin/templates. */
export async function getAdminTemplates(): Promise<TemplateSummary[]> {
  await delay(200)
  return structuredClone(sortMockTemplates(db.templates.map(toTemplateSummary)))
}

/**
 * Snapshot a project into a new (or re-seeded) template — mirrors
 * createTemplateFromProject (POST /api/v1/admin/templates), including its
 * upsert-by-derived-id behaviour (`tmpl-${slug}`).
 */
export async function createTemplate(input: CreateTemplateInput): Promise<TemplateDetail> {
  await delay(400)
  const project = db.projects.find((p) => p.id === input.projectId)
  const layout = project ? ensureLayout(project.id) : null
  if (!project || !layout) {
    throw new Error("Proyek tidak ditemukan")
  }
  const brief = db.briefs[project.id] ?? null
  const interior = db.interiors[project.id] ?? null
  const id = `tmpl-${input.slug}`
  const ts = nowISO()
  const existingIdx = db.templates.findIndex((t) => t.id === id)

  const row: TemplateDetail = {
    id,
    slug: input.slug,
    name: input.name ?? project.name,
    description: input.description ?? brief?.summary ?? null,
    style: project.style,
    city: project.city,
    province: project.province,
    floors: project.floors,
    rooftop: project.rooftop,
    thumbnail: project.thumbnail,
    site: project.site,
    sortOrder: input.sortOrder ?? 0,
    active: true,
    sourceProjectId: project.id,
    createdAt: existingIdx === -1 ? ts : db.templates[existingIdx].createdAt,
    updatedAt: ts,
    layout: structuredClone(layout),
    brief: brief ? structuredClone(brief) : null,
    interior: interior ? structuredClone(interior) : null,
  }

  if (existingIdx === -1) db.templates.push(row)
  else db.templates[existingIdx] = row

  return structuredClone(row)
}

/**
 * Meta edits and/or `{resync: true}` — mirrors PATCH /api/v1/admin/templates/[id]
 * (updateTemplateMeta / resyncTemplateFromSource).
 */
export async function updateTemplate(
  id: string,
  patch: UpdateTemplateInput
): Promise<TemplateSummary> {
  await delay(300)
  const idx = db.templates.findIndex((t) => t.id === id)
  if (idx === -1) throw new Error("Template tidak ditemukan")
  const current = db.templates[idx]

  if (patch.resync) {
    const project = current.sourceProjectId
      ? db.projects.find((p) => p.id === current.sourceProjectId)
      : undefined
    const layout = project ? ensureLayout(project.id) : null
    if (!project || !layout) {
      // No source project to resync from (mirrors the DB-less repo fallback,
      // which no-ops instead of erroring) — return the row unchanged.
      return structuredClone(toTemplateSummary(current))
    }
    const brief = db.briefs[project.id] ?? null
    const interior = db.interiors[project.id] ?? null
    db.templates[idx] = {
      ...current,
      style: project.style,
      city: project.city,
      province: project.province,
      floors: project.floors,
      rooftop: project.rooftop,
      thumbnail: project.thumbnail,
      site: project.site,
      layout: structuredClone(layout),
      brief: brief ? structuredClone(brief) : null,
      interior: interior ? structuredClone(interior) : null,
      updatedAt: nowISO(),
    }
    return structuredClone(toTemplateSummary(db.templates[idx]))
  }

  db.templates[idx] = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    updatedAt: nowISO(),
  }
  return structuredClone(toTemplateSummary(db.templates[idx]))
}

/** Mirrors DELETE /api/v1/admin/templates/[id]. */
export async function deleteTemplate(id: string): Promise<void> {
  await delay(250)
  const idx = db.templates.findIndex((t) => t.id === id)
  if (idx === -1) throw new Error("Template tidak ditemukan")
  db.templates.splice(idx, 1)
}

/* ----- service: component presets (Studio Komponen) ----- */

/** Terbaru dulu — preset baru saja disimpan langsung terlihat di puncak daftar. */
export async function listComponentPresets(): Promise<ComponentPreset[]> {
  await delay(150)
  return structuredClone(
    [...db.componentPresets].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  )
}

export async function saveComponentPreset(
  input: Omit<ComponentPreset, "id" | "createdAt"> & { id?: string }
): Promise<ComponentPreset> {
  await delay(250)
  const preset: ComponentPreset = {
    id: input.id ?? `preset-${nanoid(10)}`,
    name: input.name,
    family: input.family,
    pattern: structuredClone(input.pattern),
    finish: input.finish,
    createdAt: nowISO(),
  }
  const idx = db.componentPresets.findIndex((p) => p.id === preset.id)
  if (idx === -1) db.componentPresets.unshift(preset)
  else db.componentPresets[idx] = preset
  return structuredClone(preset)
}

export async function deleteComponentPreset(id: string): Promise<void> {
  await delay(150)
  const idx = db.componentPresets.findIndex((p) => p.id === id)
  if (idx === -1) throw new Error("Preset tidak ditemukan")
  db.componentPresets.splice(idx, 1)
}

export { DEMO_PROJECT_ID }
