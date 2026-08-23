"use client"

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { data } from "@/lib/data"
import { duplicateProject } from "./duplicate-project"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"
import type { BriefChatTurn } from "@/lib/data/source"
import type {
  AssistantMessage,
  AssistantMessageStatus,
  ProjectAgentRequest,
  SendAssistantMessageInput,
} from "@/lib/assistant/actions"
import type { SavedInterior } from "@/lib/schemas/interior"
import type { SaveLayoutInput } from "@/lib/schemas/layout"
import type {
  BOQItem,
  Brief,
  FinishingLevel,
  PlanRow,
  ReviewChecklistItem,
  ReviewRole,
} from "@/types"
import type { CreateProjectInput } from "@/lib/schemas/project"
import type { CreateTemplateInput, UpdateTemplateInput } from "@/lib/schemas/templates"
import { queryKeys } from "./keys"

/* ----- user ----- */

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.user,
    queryFn: data.getCurrentUser,
    staleTime: 5 * 60_000,
  })
}

export function useUpdateProfileName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => data.updateProfile({ name }),
    onSuccess: (user) => {
      qc.setQueryData(queryKeys.user, user)
    },
  })
}

/* ----- plans (billing) ----- */

/** Active, sorted plans — single source of truth for pricing (landing + billing). */
export function usePlans() {
  return useQuery({
    queryKey: queryKeys.plans,
    queryFn: data.getPlans,
    staleTime: 5 * 60_000,
  })
}

/* ----- projects ----- */

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: data.listProjects,
  })
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => data.getProject(projectId),
    enabled: !!projectId,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) => data.createProject(input),
    onSuccess: ({ project, brief }) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects })
      qc.setQueryData(queryKeys.project(project.id), project)
      qc.setQueryData(queryKeys.brief(project.id), brief)
    },
  })
}

/** Clone a curated template into a brand-new owned project — the "Gunakan
 *  template ini" CTA on the public gallery/detail pages and dashboard cards. */
export function useCreateProjectFromTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => data.createProjectFromTemplate(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}

export function useDuplicateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => duplicateProject(projectId),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects })
      qc.setQueryData(queryKeys.project(project.id), project)
    },
  })
}

export function useRenameProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      data.updateProject(projectId, { name }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects })
      qc.setQueryData(queryKeys.project(project.id), project)
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => data.deleteProject(projectId),
    onSuccess: (_data, projectId) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects })
      qc.removeQueries({ queryKey: queryKeys.project(projectId) })
      qc.removeQueries({ queryKey: queryKeys.brief(projectId) })
      qc.removeQueries({ queryKey: queryKeys.interior(projectId) })
      qc.removeQueries({ queryKey: queryKeys.layout(projectId) })
    },
  })
}

/* ----- brief ----- */

export function useBrief(projectId: string) {
  return useQuery({
    queryKey: queryKeys.brief(projectId),
    queryFn: () => data.getBrief(projectId),
    enabled: !!projectId,
  })
}

export function useUpdateBrief(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Brief>) => data.updateBrief(projectId, patch),
    onSuccess: (brief) => {
      qc.setQueryData(queryKeys.brief(projectId), brief)
      qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
    },
  })
}

export function useBriefAssistant(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      question,
      history,
    }: {
      question: string
      history: BriefChatTurn[]
    }) => data.askBriefAssistant(projectId, question, history),
    // Kredit terpakai per pertanyaan — saldo di sidebar (useCurrentUser,
    // staleTime 5 menit) tak boleh basi setelah aksi ber-kredit (WS-D §5).
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.user }),
  })
}

export function useAssistantMessages(projectId: string) {
  return useQuery({
    queryKey: queryKeys.assistant(projectId),
    queryFn: () => data.listAssistantMessages(projectId),
    enabled: !!projectId,
  })
}

export function useSendAssistantMessage(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SendAssistantMessageInput) => data.sendAssistantMessage(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assistant(projectId) }),
  })
}

export function useSendProjectAgentMessage(projectId: string) {
  const qc = useQueryClient()
  const setProgressMessage = useProjectAgentUiStore((state) => state.setProgressMessage)
  return useMutation({
    mutationFn: (input: ProjectAgentRequest) =>
      data.sendProjectAgentMessage(projectId, input, (message) => setProgressMessage(message)),
    onMutate: async (input) => {
      const key = queryKeys.assistant(projectId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<AssistantMessage[]>(key) ?? []
      const surfaceMode = input.surface === "editor"
        ? "floorplan"
        : input.surface === "preview-3d" || input.surface === "furniture" || input.surface === "materials"
          ? "interior"
          : "brief"
      const mode = input.requestedMode === "auto" ? surfaceMode : input.requestedMode
      const optimistic: AssistantMessage = {
        id: `optimistic-${input.clientRequestId}`,
        projectId,
        mode,
        surface: input.surface,
        turnId: input.clientRequestId,
        clientRequestId: input.clientRequestId,
        requestState: "pending",
        role: "user",
        content: input.instruction,
        createdAt: new Date().toISOString(),
      }
      qc.setQueryData<AssistantMessage[]>(key, [...previous, optimistic])
      return { previous, key }
    },
    onError: (_error, _input, context) => {
      if (context) qc.setQueryData(context.key, context.previous)
    },
    onSuccess: (message, input, context) => {
      const key = context?.key ?? queryKeys.assistant(projectId)
      qc.setQueryData<AssistantMessage[]>(key, (current = []) => [
        ...current.map((item) => item.clientRequestId === input.clientRequestId && item.role === "user"
          ? { ...item, requestState: "completed" as const }
          : item),
        ...(current.some((item) => item.id === message.id) ? [] : [message]),
      ])
    },
    onSettled: () => {
      setProgressMessage(null)
      qc.invalidateQueries({ queryKey: queryKeys.assistant(projectId) })
      // Setiap pesan ke AI Agent memakai 1 kredit — refresh saldo sidebar
      // (WS-D §5, keluhan "saldo sidebar bisa basi 5 menit").
      qc.invalidateQueries({ queryKey: queryKeys.user })
    },
  })
}

export function useSetAssistantStatus(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { messageId: string; status: AssistantMessageStatus }) =>
      data.setAssistantMessageStatus(projectId, vars.messageId, vars.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assistant(projectId) }),
  })
}

/* ----- alternatives ----- */

export function useAlternatives(projectId: string) {
  return useQuery({
    queryKey: queryKeys.alternatives(projectId),
    queryFn: () => data.getAlternatives(projectId),
    enabled: !!projectId,
  })
}

export function useGenerateAlternatives(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => data.generateAlternatives(projectId),
    onSuccess: (alts) => {
      qc.setQueryData(queryKeys.alternatives(projectId), alts)
      qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.projects })
      // Regenerate memakai 1 kredit — refresh saldo sidebar (WS-D §5).
      qc.invalidateQueries({ queryKey: queryKeys.user })
      // The backend enriches the narrative via LLM in the background (~40s).
      // Refetch a few times to pick up the AI-enriched copy without a reload.
      for (const ms of [15_000, 40_000, 70_000, 105_000]) {
        setTimeout(() => {
          qc.invalidateQueries({ queryKey: queryKeys.alternatives(projectId) })
        }, ms)
      }
    },
  })
}

export function useSelectAlternative(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (alternativeId: string) =>
      data.selectAlternative(projectId, alternativeId),
    onSuccess: (project) => {
      qc.setQueryData(queryKeys.project(projectId), project)
      qc.invalidateQueries({ queryKey: queryKeys.projects })
    },
  })
}

/* ----- rab ----- */

export function useRAB(projectId: string, finishing?: FinishingLevel) {
  return useQuery({
    queryKey: queryKeys.rab(projectId, finishing),
    queryFn: () => data.getRAB(projectId, finishing),
    enabled: !!projectId,
    placeholderData: keepPreviousData,
  })
}

export function useSaveRAB(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { items: BOQItem[]; areaM2: number; assumptions: string[] }) =>
      data.saveRAB(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rab", projectId] })
    },
  })
}

export function useResetRAB(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => data.resetRAB(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rab", projectId] })
    },
  })
}

/* ----- layout (2D editor) ----- */

export function useLayout(projectId: string, opts?: { fresh?: boolean }) {
  return useQuery({
    queryKey: queryKeys.layout(projectId),
    queryFn: () => data.getLayoutDocument(projectId),
    enabled: !!projectId,
    // editor: editing is local; refetch would clobber the draft → never auto-refetch.
    // preview (fresh): pull the server's latest on open/refresh/focus (cross-device).
    staleTime: opts?.fresh ? 0 : Infinity,
    refetchOnMount: opts?.fresh ? "always" : false,
    refetchOnWindowFocus: opts?.fresh ? true : false,
  })
}

export function useSaveLayout(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveLayoutInput) => data.saveLayout(projectId, input),
    onSuccess: (document) => {
      qc.setQueryData(queryKeys.layout(projectId), document)
      qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
    },
  })
}

/* ----- interior ----- */

export function useInterior(projectId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.interior(projectId),
    queryFn: () => data.getInterior(projectId),
    enabled: !!projectId && (opts?.enabled ?? true),
    staleTime: Infinity, // editing is local; refetch would clobber the draft
  })
}

export function useSaveInterior(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SavedInterior) => data.saveInterior(projectId, payload),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.interior(projectId), saved)
    },
  })
}

/* ----- review ----- */

export function useReview(projectId: string) {
  return useQuery({
    queryKey: queryKeys.review(projectId),
    queryFn: () => data.getReview(projectId),
    enabled: !!projectId,
  })
}

export function useAddComment(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => data.addComment(projectId, body),
    onSuccess: (review) => qc.setQueryData(queryKeys.review(projectId), review),
  })
}

export function useToggleComment(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      data.toggleCommentResolved(projectId, commentId),
    onSuccess: (review) => qc.setQueryData(queryKeys.review(projectId), review),
  })
}

export function useSetChecklist(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { role: ReviewRole; status: ReviewChecklistItem["status"] }) =>
      data.setChecklistStatus(projectId, vars.role, vars.status),
    onSuccess: (review) => qc.setQueryData(queryKeys.review(projectId), review),
  })
}

export function useToggleWarning(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (warningId: string) =>
      data.toggleWarningResolved(projectId, warningId),
    onSuccess: (review) => qc.setQueryData(queryKeys.review(projectId), review),
  })
}

/* ----- share links ----- */

/** Current active public share link for a project, if any (`null` = none created yet). */
export function useShareLink(projectId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.shareLink(projectId),
    queryFn: () => data.getShareLink(projectId),
    enabled: !!projectId && (opts?.enabled ?? true),
  })
}

export function useCreateShareLink(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => data.createShareLink(projectId),
    onSuccess: (result) => qc.setQueryData(queryKeys.shareLink(projectId), result),
  })
}

/** "Nonaktifkan tautan". */
export function useRevokeShareLink(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => data.revokeShareLink(projectId),
    onSuccess: () => qc.setQueryData(queryKeys.shareLink(projectId), { url: null }),
  })
}

/* ----- assets (furnimesh model ingestion) ----- */

export function useRequestUploadUrl() {
  return useMutation({
    mutationFn: (input: {
      projectId: string
      filename: string
      contentType: string
      fileSizeBytes: number
    }) => data.requestUploadUrl(input),
  })
}

export function useCreateIngestionJob() {
  return useMutation({
    mutationFn: (input: {
      projectId: string
      roomId?: string
      slotId?: string
      expectedCategory: string
      fileUrl: string
      originalFilename: string
      sourceName?: string
      sourceUrl?: string
    }) => data.createIngestionJob(input),
  })
}

export function useIngestionJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.ingestionJob(jobId ?? ""),
    queryFn: () => data.getIngestionJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status || status === "ready" || status === "attached" || status === "failed" || status === "rejected") {
        return false
      }
      return 2000
    },
  })
}

export function useUpdateAssetMetadata() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ assetId, patch }: {
      assetId: string
      patch: Parameters<typeof data.updateAssetMetadata>[1]
    }) => data.updateAssetMetadata(assetId, patch),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.asset(vars.assetId) })
      qc.invalidateQueries({ queryKey: queryKeys.myAssets() })
    },
  })
}

export function useAttachAssetToSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof data.attachAssetToSlot>[0]) =>
      data.attachAssetToSlot(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.interior(vars.projectId) })
    },
  })
}

export function useDetachAssetFromSlot(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slotId: string) => data.detachAssetFromSlot(projectId, slotId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.interior(projectId) })
    },
  })
}

const MY_ASSETS_PAGE = 30

/** My Library dgn paginasi & search SERVER-SIDE (katalog puluhan ribu). Pakai
 *  useInfiniteQuery: tiap halaman 30 aset; `fetchNextPage` memuat berikutnya
 *  selama total belum tercapai. `search`/`category` masuk query key. */
export function useMyAssets(category?: string, search?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.myAssets(category, search),
    queryFn: ({ pageParam }) =>
      data.listMyAssets({ category, search, limit: MY_ASSETS_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    staleTime: 30_000,
  })
}

/* ----- admin backoffice (Task 8) ----- */

/** ALL plans (active + inactive) — Plans tab. */
export function useAdminPlans() {
  return useQuery({
    queryKey: queryKeys.adminPlans,
    queryFn: data.getAdminPlans,
  })
}

export function useUpdatePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (row: PlanRow) => data.updatePlan(row),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminPlans })
      // Keep this same session's /app/billing (usePlans) in sync immediately;
      // /pricing is a `force-dynamic` server component so it picks up the
      // change on its own next render without needing invalidation here.
      qc.invalidateQueries({ queryKey: queryKeys.plans })
    },
  })
}

/** Read-only subscriptions listing — Transaksi tab. */
export function useAdminSubscriptions() {
  return useQuery({
    queryKey: queryKeys.adminSubscriptions,
    queryFn: data.getAdminSubscriptions,
  })
}

/** All profiles — Users tab. */
export function useAdminUsers() {
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: data.getAdminUsers,
  })
}

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { profileId: string; role: "user" | "admin" }) =>
      data.updateUserRole(vars.profileId, vars.role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  })
}

export function useUpdateUserPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { profileId: string; plan: string }) =>
      data.updateUserPlan(vars.profileId, vars.plan),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  })
}

/** Admin credit adjustment (delta may be negative), with a required reason. */
export function useAdjustUserCredits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { profileId: string; deltaTotal: number; reason: string }) =>
      data.adjustUserCredits(vars.profileId, vars.deltaTotal, vars.reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  })
}

/** Create a short-lived phantom login URL for an admin-selected profile. */
export function useCreatePhantomLogin() {
  return useMutation({
    mutationFn: (profileId: string) => data.createPhantomLogin(profileId),
  })
}

/* ----- templates (curated ready-made designs) ----- */

/** Active, sorted templates — public "start from a template" picker. */
export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: data.getTemplates,
    staleTime: 5 * 60_000,
  })
}

/** Full design payload for one active template. */
export function useTemplate(slug: string) {
  return useQuery({
    queryKey: queryKeys.template(slug),
    queryFn: () => data.getTemplate(slug),
    enabled: !!slug,
  })
}

/** ALL templates (active + inactive) — admin Templates tab. */
export function useAdminTemplates() {
  return useQuery({
    queryKey: queryKeys.adminTemplates,
    queryFn: data.getAdminTemplates,
  })
}

/** Snapshot a project into a new (or re-seeded) template. */
export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTemplateInput) => data.createTemplate(input),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.adminTemplates })
      qc.invalidateQueries({ queryKey: queryKeys.templates })
      qc.invalidateQueries({ queryKey: queryKeys.template(created.slug) })
    },
  })
}

/** Meta edits and/or `{resync: true}` to re-snapshot from the source project. */
export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateTemplateInput }) =>
      data.updateTemplate(vars.id, vars.patch),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: queryKeys.adminTemplates })
      qc.invalidateQueries({ queryKey: queryKeys.templates })
      qc.invalidateQueries({ queryKey: queryKeys.template(updated.slug) })
    },
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => data.deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminTemplates })
      qc.invalidateQueries({ queryKey: queryKeys.templates })
    },
  })
}

/* ----- component presets (Studio Komponen — pola kisi/roster/pagar/gerbang/pergola) ----- */

/** Preset milik user, terbaru dulu — daftar "Preset Saya" di Studio Komponen. */
export function useComponentPresets() {
  return useQuery({
    queryKey: queryKeys.componentPresets,
    queryFn: data.listComponentPresets,
    staleTime: 30_000,
  })
}

export function useSaveComponentPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof data.saveComponentPreset>[0]) =>
      data.saveComponentPreset(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.componentPresets }),
  })
}

export function useDeleteComponentPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => data.deleteComponentPreset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.componentPresets }),
  })
}

/* ----- AI Image Renderer (Fase 8 — docs/plan-integrasi-ai-renderer-2026-08.md) ----- */

/** Galeri render per proyek ("Riwayat Render" di dalam dialog). */
export function useProjectRenders(projectId: string) {
  return useQuery({
    queryKey: queryKeys.renders(projectId),
    queryFn: () => data.listRenders(projectId),
    enabled: !!projectId,
  })
}

/**
 * Polling detail satu job — `refetchInterval` self-terminating persis
 * `useIngestionJob` (~line 433): berhenti begitu status final (succeeded/
 * failed), selain itu 2000ms. `enabled` hanya saat `renderId` terisi (mis.
 * setelah `useCreateRender` sukses).
 */
export function useRenderJob(projectId: string, renderId: string | null) {
  return useQuery({
    queryKey: queryKeys.render(projectId, renderId ?? ""),
    queryFn: () => data.getRender(projectId, renderId!),
    enabled: !!projectId && !!renderId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status || status === "succeeded" || status === "failed") return false
      return 2000
    },
  })
}

/**
 * Buat job render AI. Sukses → invalidasi galeri render + `useCurrentUser`
 * (kredit berubah, sidebar ter-update otomatis lewat invalidasi itu).
 * Penanganan error 402/403 (`handlePlanError`) SENGAJA ditaruh di komponen
 * pemanggil (pola `project-agent-panel.tsx`: `if (!handlePlanError(e))
 * toast.error(...)`), bukan di sini — supaya hanya ada SATU jalur toast
 * (menghindari toast dobel bila hook & komponen sama-sama memanggilnya).
 */
export function useCreateRender(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof data.createRender>[1]) =>
      data.createRender(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.renders(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.user })
    },
  })
}

/** Data URL PNG (`captureRenderInputs()`) → Blob, siap di-PUT ke signed URL. */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

/**
 * Upload dua-langkah input render (beauty/depth PNG): minta signed URL lalu
 * PUT byte-nya — pola sama dgn leg upload `ModelUploadDialog.startUpload`
 * (model-upload-dialog.tsx), hanya beda payload (PNG data URL, bukan File
 * GLB). Fungsi biasa (bukan hook) — dipanggil di dalam orkestrasi submit
 * `ai-render-dialog.tsx`, bukan lifecycle React.
 */
export async function uploadRenderInput(
  projectId: string,
  dataUrl: string,
  filename: string
): Promise<string> {
  const signed = await data.requestRenderUploadUrl({
    projectId,
    filename,
    contentType: "image/png",
  })
  if (!signed) throw new Error("Endpoint upload render tidak tersedia di server")
  const blob = await dataUrlToBlob(dataUrl)
  const res = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: blob,
  })
  if (!res.ok) throw new Error("Gagal mengupload input render ke storage")
  return signed.key
}
