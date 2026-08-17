import type {
  AdminSubscriptionRow,
  AdminUserRow,
  Alternative,
  BOQItem,
  Brief,
  ComponentPreset,
  DesignLayout,
  FinishingLevel,
  PlanRow,
  Project,
  RAB,
  Review,
  ReviewChecklistItem,
  ReviewRole,
  User,
} from "@/types"
import type { CreateProjectInput } from "@/lib/schemas/project"
import type { FeatureCapabilities } from "@/lib/features"
import type { SavedInterior } from "@/lib/schemas/interior"
import type { LayoutDocument, SaveLayoutInput } from "@/lib/schemas/layout"
import type { TemplateDetail, TemplateSummary } from "@/types/templates"
import type { CreateTemplateInput, UpdateTemplateInput } from "@/lib/schemas/templates"
import type {
  AssistantMessage,
  AssistantMessageStatus,
  ProjectAgentRequest,
  SendAssistantMessageInput,
} from "@/lib/assistant/actions"

/** A single turn in the brief AI-assistant conversation. */
export interface BriefChatTurn {
  role: "user" | "assistant"
  content: string
}

/**
 * The data contract shared by the in-memory mock and the real HTTP backend.
 * Swap implementations via env (NEXT_PUBLIC_DATA_SOURCE / NEXT_PUBLIC_API_URL)
 * without touching the TanStack Query hooks. See docs/API.md for endpoints.
 */
export interface DataSource {
  getCurrentUser(): Promise<User>
  /** Ganti nama tampilan (profile page). */
  updateProfile(patch: { name: string }): Promise<User>

  /** Active, sorted plans — the single source of truth for pricing (landing + billing). */
  getPlans(): Promise<PlanRow[]>

  listProjects(): Promise<Project[]>
  getProject(id: string): Promise<Project | null>
  createProject(
    input: CreateProjectInput
  ): Promise<{ project: Project; brief: Brief }>
  deleteProject(id: string): Promise<void>
  /** Ganti nama project. */
  updateProject(id: string, patch: { name: string }): Promise<Project>

  /**
   * Capability set rollout fitur eksterior (roadmap §21) — di-resolve server
   * dari role + projectId + konfigurasi env. Client hanya memakai hasilnya
   * untuk gating creation UI; data existing tetap dirender walau flag off.
   */
  getProjectCapabilities(id: string): Promise<FeatureCapabilities | null>

  getBrief(projectId: string): Promise<Brief | null>
  updateBrief(projectId: string, patch: Partial<Brief>): Promise<Brief>
  askBriefAssistant(
    projectId: string,
    question: string,
    history: BriefChatTurn[]
  ): Promise<{ answer: string }>

  listAssistantMessages(projectId: string): Promise<AssistantMessage[]>
  sendAssistantMessage(
    projectId: string,
    input: SendAssistantMessageInput,
    onProgress?: (message: string) => void
  ): Promise<AssistantMessage>
  setAssistantMessageStatus(
    projectId: string,
    messageId: string,
    status: AssistantMessageStatus
  ): Promise<void>
  sendProjectAgentMessage(
    projectId: string,
    input: ProjectAgentRequest,
    onProgress?: (message: string) => void
  ): Promise<AssistantMessage>

  generateAlternatives(projectId: string): Promise<Alternative[]>
  getAlternatives(projectId: string): Promise<Alternative[]>
  selectAlternative(projectId: string, alternativeId: string): Promise<Project>

  getRAB(projectId: string, finishing?: FinishingLevel): Promise<RAB | null>
  saveRAB(projectId: string, input: { items: BOQItem[]; areaM2: number; assumptions: string[] }): Promise<RAB>
  resetRAB(projectId: string): Promise<RAB>

  getLayout(projectId: string): Promise<DesignLayout | null>
  getLayoutDocument(projectId: string): Promise<LayoutDocument | null>
  saveLayout(projectId: string, input: SaveLayoutInput): Promise<LayoutDocument>

  getInterior(projectId: string): Promise<SavedInterior | null>
  saveInterior(projectId: string, payload: SavedInterior): Promise<SavedInterior>

  getReview(projectId: string): Promise<Review | null>
  addComment(projectId: string, body: string): Promise<Review>
  toggleCommentResolved(projectId: string, commentId: string): Promise<Review>
  setChecklistStatus(
    projectId: string,
    role: ReviewRole,
    status: ReviewChecklistItem["status"]
  ): Promise<Review>
  toggleWarningResolved(projectId: string, warningId: string): Promise<Review>

  // ── asset management (furnimesh model ingestion) ──

  /** Request a signed PUT URL for direct upload to object storage. */
  requestUploadUrl(input: {
    projectId: string
    filename: string
    contentType: string
    fileSizeBytes: number
  }): Promise<{ uploadUrl: string; fileUrl: string; expiresIn: number }>

  /** Create an ingestion job after successful upload to object storage. */
  createIngestionJob(input: {
    projectId: string
    /** Optional: library-mode upload (tanpa attach ke slot). */
    roomId?: string
    slotId?: string
    expectedCategory: string
    fileUrl: string
    originalFilename: string
    sourceName?: string
    sourceUrl?: string
  }): Promise<{ jobId: string; assetId: string; status: string }>

  /** Poll ingestion job status. */
  getIngestionJob(jobId: string): Promise<{
    jobId: string
    assetId: string
    status: string
    progress: number
    validationResult?: unknown
    requiredUserInputs?: string[]
  } | null>

  /** Update asset metadata (scale, tags, license, etc.). */
  updateAssetMetadata(assetId: string, patch: {
    name?: string
    category?: string
    widthM?: number
    depthM?: number
    heightM?: number
    styleTags?: string[]
    colorTags?: string[]
    materialTags?: string[]
    licenseConfirmation?: boolean
    licenseNote?: string
    materialMap?: Record<string, string>
  }): Promise<unknown>

  /** Attach an asset to a slot within a project. */
  attachAssetToSlot(input: {
    projectId: string
    slotId: string
    assetId: string
    fitMode?: string
    materialMode?: string
    materialMap?: Record<string, string>
  }): Promise<{
    slotId: string
    assetId: string
    consistencyScore: number
    warnings: string[]
  }>

  /** Detach asset from a slot, restoring the placeholder. */
  detachAssetFromSlot(projectId: string, slotId: string): Promise<{
    slotId: string
    status: string
  }>

  /** List user's asset library — paginasi & search server-side. `total` =
   *  jumlah aset yang cocok (untuk "muat lebih" & angka total). */
  listMyAssets(params?: {
    category?: string
    search?: string
    limit?: number
    offset?: number
  }): Promise<{
    total: number
    items: Array<{
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
      /** Harga level aset (Rp, user_assets.price_idr) — diwariskan ke
       *  penempatan furniture; absent = "belum dihargai" di budget/RAB. */
      priceIDR?: number | null
      performance?: unknown
      status: string
      /** Aset milik user (bisa di-rename); false = katalog global read-only. */
      editable?: boolean
    }>
  }>

  // ── admin backoffice (Task 8) ──

  /** ALL plans (active + inactive) — Plans tab. */
  getAdminPlans(): Promise<PlanRow[]>
  /** Create or update a plan; drives /pricing + /app/billing on invalidation. */
  updatePlan(row: PlanRow): Promise<PlanRow>
  /** Read-only subscriptions listing — Transaksi tab. */
  getAdminSubscriptions(): Promise<AdminSubscriptionRow[]>
  /** All profiles — Users tab. */
  getAdminUsers(): Promise<AdminUserRow[]>
  updateUserRole(profileId: string, role: "user" | "admin"): Promise<void>
  updateUserPlan(profileId: string, plan: string): Promise<void>
  /** Admin credit adjustment (delta may be negative), with a required reason. */
  adjustUserCredits(
    profileId: string,
    deltaTotal: number,
    reason: string
  ): Promise<void>
  createPhantomLogin(profileId: string): Promise<{
    url: string
    expiresAt: string
  }>

  // ── templates (curated ready-made designs) ──

  /** Active, sorted templates — public "start from a template" picker. */
  getTemplates(): Promise<TemplateSummary[]>
  /** Full design payload for one active template. Throws (404-shaped) when
   *  missing or inactive — unlike `getProject`, callers here don't expect a
   *  null-is-fine optional resource. */
  getTemplate(slug: string): Promise<TemplateDetail>

  /** ALL templates (active + inactive) — admin Templates tab. */
  getAdminTemplates(): Promise<TemplateSummary[]>
  /** Snapshot a project into a new (or re-seeded) template. Throws when
   *  `projectId` doesn't resolve to a project. */
  createTemplate(input: CreateTemplateInput): Promise<TemplateDetail>
  /** Meta edits and/or `{resync: true}` to re-snapshot from the source project. */
  updateTemplate(id: string, patch: UpdateTemplateInput): Promise<TemplateSummary>
  deleteTemplate(id: string): Promise<void>

  // ── component presets (Studio Komponen — pola kisi/roster/pagar/gerbang/pergola) ──

  /** Preset milik user, terbaru dulu. */
  listComponentPresets(): Promise<ComponentPreset[]>
  /** Simpan preset baru (tanpa `id`) atau perbarui yang ada (dengan `id`). */
  saveComponentPreset(
    input: Omit<ComponentPreset, "id" | "createdAt"> & { id?: string }
  ): Promise<ComponentPreset>
  deleteComponentPreset(id: string): Promise<void>
}
