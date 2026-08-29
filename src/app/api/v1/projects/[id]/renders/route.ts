import { after } from "next/server"
import { z } from "zod"

import { requireUser, requireAdmin } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getLayoutPayload } from "@/lib/server/repo/layouts"
import {
  createRenderJob,
  getRenderJob,
  updateRenderJob,
  listRenderJobs,
  findCachedRender,
} from "@/lib/server/repo/renders"
import { spendCreditsOnce } from "@/lib/server/repo/credits"
import { requirePlanFeature, getEntitlements } from "@/lib/server/entitlements"
import { createSignedGetUrl } from "@/lib/server/storage"
import {
  aiRenderEnabled,
  getRenderProvider,
  usesMockOverride,
  RENDER_PRESETS,
  compilePrompt,
  compilePromptV2,
  compilePromptInterior,
  analyzeScene,
  analyzeRoom,
  projectSeed,
  RENDER_CREDIT_COST,
} from "@/lib/server/ai-render"
import type { CameraPose, RoomFacts } from "@/lib/server/ai-render"
import type { DesignLayout } from "@/types"
import { polishScene } from "@/lib/server/ai-render/polish"
import { sanitizeStyleNotes } from "@/lib/server/ai-render/style-notes"
import { finalizeRenderJob, failRenderJob } from "@/lib/server/ai-render/finalize"
import { renderJobView } from "@/lib/server/ai-render/view"
import { ok, err, errCode, handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"
import {
  featureFlagConfigsFromEnv,
  resolveFeatureFlag,
} from "@/lib/features"

// Submit fal (mode presisi) inline cukup cepat (queue POST) tapi gemini
// (mode cepat) berjalan di after() bisa makan waktu; 120s meniru
// alternatives/generate (satu-satunya route lain yang memakai after() utk
// pekerjaan LLM/eksternal).
export const maxDuration = 120

// Pose kamera three.js dikirim klien bersama capture (Fase A Scene
// Intelligence — lihat CameraPose di ai-render/analyze.ts). Opsional: jika
// absen, route jatuh ke jalur legacy (sceneMeta -> compilePrompt).
const poseSchema = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  target: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  fov: z.number().min(10).max(120),
})

const bodySchema = z.object({
  mode: z.enum(["cepat", "presisi"]),
  preset: z.string().min(1),
  shotId: z.string().min(1),
  // Idempotency key dibuat klien (nanoid) — dipakai ganda: kunci
  // spendCreditsOnce DAN (sanitized) sebagai id job, lihat komentar di dekat
  // `jobId` di bawah.
  clientRequestId: z.string().min(8).max(128),
  inputKeys: z.object({
    beauty: z.string().min(1),
    depth: z.string().min(1).optional(),
  }),
  paramsHash: z.string().min(1),
  pose: poseSchema.optional(),
  // Opsional sejak Fase A: bila `pose` ada & layout proyek tersimpan, prompt
  // v2 (analyzeScene+compilePromptV2) dipakai TANPA butuh sceneMeta. Tetap
  // dipertahankan sbg fallback (pose absen, atau layout belum tersimpan).
  sceneMeta: z
    .object({
      facadeMaterials: z.array(z.string()),
      roofType: z.string().min(1),
      floors: z.number().int().positive(),
      landscape: z.string().optional(),
    })
    .optional(),
  // Fase B (Task 3) — render interior per ruang. Absen = "exterior" (jalur
  // Fase A tak berubah). `roomId` opsional: bila absen, ruang dideteksi dari
  // `pose` (posisi kamera world → site → rect ruang mana yang memuatnya, lihat
  // analyzeRoom di ./ai-render/analyze-room.ts).
  target: z.enum(["exterior", "interior"]).optional(),
  roomId: z.string().min(1).optional(),
  // Task 3 (spec 2026-08-29 §4 Server) — "catatan gaya" bebas dari dialog
  // Render AI (manual atau prefill dari chat Asisten). Disanitasi via
  // `sanitizeStyleNotes` sebelum dipakai (lihat di bawah) — nilai mentah di
  // sini TIDAK PERNAH langsung disisipkan ke prompt/DB.
  styleNotes: z.string().max(240).optional(),
})

const VALID_PRESET_IDS = new Set(RENDER_PRESETS.map((p) => p.id))

/** `rnd-` + clientRequestId disanitasi jadi karakter aman-kolom-id. Dipakai
 *  sebagai primary key job SUPAYA retry dgn clientRequestId sama (respons
 *  pertama hilang di jaringan, klien retry) bisa langsung `getRenderJob` job
 *  yang sama alih-alih membuat baris baru / kehilangan hasil kredit yang
 *  sudah terpotong (tabel render_jobs tak punya kolom client_request_id
 *  terpisah — id job INI yang menjadi kunci join-nya). */
function jobIdFromClientRequestId(clientRequestId: string): string {
  const safe = clientRequestId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64)
  return `rnd-${safe}`
}

function appBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://baruma.tampil.dev"
  return url.replace(/\/$/, "")
}

function webhookUrlFor(jobId: string): string {
  const token = process.env.AI_RENDER_WEBHOOK_SECRET ?? ""
  const url = new URL(`${appBaseUrl()}/api/webhooks/ai-render`)
  url.searchParams.set("token", token)
  url.searchParams.set("jobId", jobId)
  return url.toString()
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id: projectId } = await ctx.params
    const project = await getOwnedProject(projectId, userId)
    if (!project) return err(404, "Project not found")

    const rateLimited = rateLimitGuard(request, {
      scope: "ai-render",
      limit: 10,
      windowMs: 60_000,
    })
    if (rateLimited) return rateLimited

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return err(400, "Invalid JSON body")
    }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? "Invalid input")
    const { mode, preset, shotId, clientRequestId, inputKeys, paramsHash, pose, sceneMeta, target, roomId, styleNotes } =
      parsed.data
    const isInterior = target === "interior"
    // Sanitasi sekali di sini — dipakai apa adanya oleh kedua jalur prompt
    // (v2 eksterior & interior) DAN createRenderJob di bawah; undefined-safe
    // (lihat sanitizeStyleNotes) sehingga jalur tanpa styleNotes byte-identik
    // dgn sebelum fitur ini.
    const cleanNotes = sanitizeStyleNotes(styleNotes)

    // Interior WAJIB pose kamera (dipakai analyzeRoom utk deteksi ruang bila
    // roomId absen, DAN utk cameraPose yang disimpan ke job) — dicek SEBELUM
    // guard umum "pose atau sceneMeta" di bawah supaya pesannya spesifik,
    // terlepas apakah sceneMeta ikut terkirim atau tidak.
    if (isInterior && !pose) {
      return err(400, "Render interior butuh pose kamera")
    }

    if (!pose && !sceneMeta) return err(400, "Butuh pose atau sceneMeta")

    if (!VALID_PRESET_IDS.has(preset)) return err(400, "Preset tidak dikenal")

    // Anti-SSRF/anti-pinjam-key: input HANYA boleh dari prefix milik user &
    // proyek ini (klien mengunggahnya lewat renders/upload-url sebelum POST
    // ini) — menolak key user/proyek lain yang "kebetulan" disisipkan.
    const expectedPrefix = `renders/${userId}/${projectId}/`
    if (!inputKeys.beauty.startsWith(expectedPrefix)) {
      return err(400, "inputKeys.beauty tidak valid")
    }
    if (inputKeys.depth !== undefined && !inputKeys.depth.startsWith(expectedPrefix)) {
      return err(400, "inputKeys.depth tidak valid")
    }

    if (!aiRenderEnabled()) {
      return errCode(503, "ai_render_not_configured", "Fitur AI Render belum dikonfigurasi.")
    }

    // Flag ai_render_v1 — hanya menggerbangi PEMBUATAN render baru (sama
    // semantiknya dgn exterior_elements_v1/roof_zones_v1: rollback tak
    // menghapus galeri render lama, itu tetap dibaca lewat GET tanpa gate).
    let isAdmin = false
    try {
      await requireAdmin(request)
      isAdmin = true
    } catch {
      isAdmin = false
    }
    const flagEnabled = resolveFeatureFlag(
      "ai_render_v1",
      projectId,
      featureFlagConfigsFromEnv(process.env).ai_render_v1,
      { isAdmin }
    )
    if (!flagEnabled) {
      return errCode(403, "feature_disabled", "Fitur AI Render belum aktif untuk proyek ini.")
    }

    if (mode === "presisi") {
      // Throws PlanFeatureLockedError -> 403 plan_feature_locked (handleError).
      await requirePlanFeature(userId, "aiRenderHd")
      if (!inputKeys.depth) {
        return err(400, "Mode presisi butuh inputKeys.depth")
      }
    }

    // Cache hit: render sukses dgn params sama milik user ini -> pakai ulang,
    // TANPA potong kredit lagi.
    const cached = await findCachedRender(userId, paramsHash)
    if (cached) {
      return ok({ job: renderJobView(cached), cached: true }, 200)
    }

    // Muat layout SEBELUM potong kredit: kalau layout absen & tak ada
    // sceneMeta, 400-nya harus terjadi sebelum spendCreditsOnce supaya tak
    // ada kredit yatim (400 ini tak pernah membuat job row, jadi tak ada yg
    // bisa dipakai retry utk refund via getRenderJob).
    let layout: DesignLayout | null = null
    if (pose) {
      layout = await getLayoutPayload(projectId)
      if (!layout && !sceneMeta) {
        return err(400, "Layout proyek belum tersimpan")
      }
    }

    // Interior (Fase B): butuh layout TERLEPAS dari sceneMeta (tak ada
    // fallback sceneMeta utk interior) — lalu resolve ruang (roomId
    // eksplisit atau deteksi dari pose) SEBELUM potong kredit, sama disiplin
    // dgn guard layout di atas (400 di sini tak pernah membuat job row).
    let roomFacts: RoomFacts | null = null
    if (isInterior) {
      if (!layout) {
        return err(400, "Layout proyek belum tersimpan")
      }
      roomFacts = analyzeRoom(layout, project.site, { roomId, pose })
      if (!roomFacts) {
        return err(400, "Ruangan tidak ditemukan")
      }
    }

    const jobId = jobIdFromClientRequestId(clientRequestId)
    const cost = RENDER_CREDIT_COST[mode]

    const spend = await spendCreditsOnce(userId, cost, "ai_render", clientRequestId)
    if (spend === "insufficient") {
      return errCode(
        402,
        "insufficient_credits",
        "Kredit AI Anda telah habis. Upgrade plan untuk melanjutkan."
      )
    }
    if (spend === "already_spent") {
      // Retry dgn clientRequestId sama: kredit sudah terpotong sebelumnya.
      // Kalau job-nya sudah ada -> balas job itu (idempoten, TANPA potong
      // ulang). Kalau belum ada (proses crash antara ledger insert & job
      // insert pada request sebelumnya) -> lanjut ke bawah, buat job-nya
      // sekarang dgn id yang sama (kredit TIDAK dipotong lagi di sini).
      const existing = await getRenderJob(jobId, userId)
      if (existing) {
        return ok({ job: renderJobView(existing), cached: false }, 200)
      }
    }

    const ent = await getEntitlements(userId)
    const watermarked = !ent.aiRenderHd

    // Jalur prompt: pose (Fase A Scene Intelligence) -> analyzeScene ->
    // polishScene (LLM opsional, never-throw) -> compilePromptV2; jatuh ke
    // compilePrompt lama bila pose absen ATAU layout proyek belum tersimpan
    // (fallback aman utk proyek lama / capture sebelum migrasi klien).
    let prompt: string
    let cameraPose: CameraPose | undefined
    if (isInterior) {
      // Guard pra-spend di atas menjamin roomFacts non-null & pose ada di
      // sini (isInterior hanya true setelah kedua hal itu tervalidasi).
      const polished = await polishScene(roomFacts!)
      prompt = compilePromptInterior(roomFacts!, preset, polished, cleanNotes)
      cameraPose = pose
    } else if (pose) {
      if (layout) {
        const facts = analyzeScene(layout, project.site, pose)
        const polished = await polishScene(facts)
        prompt = compilePromptV2(facts, preset, polished, cleanNotes)
        cameraPose = pose
      } else {
        // Guard di atas (sebelum spendCreditsOnce) menjamin sceneMeta ada
        // di sini kalau layout null.
        prompt = compilePrompt(sceneMeta!, preset) // layout belum tersimpan — fallback lama
      }
    } else {
      prompt = compilePrompt(sceneMeta!, preset) // guard di atas menjamin ada
    }

    const seed = projectSeed(projectId)
    const providerName = usesMockOverride() ? "mock" : mode === "cepat" ? "gemini" : "fal"

    const job = await createRenderJob(jobId, userId, {
      projectId,
      mode,
      preset,
      shotId,
      seed,
      creditsSpent: cost,
      provider: providerName,
      paramsHash,
      inputKeys,
      watermarked,
      cameraPose,
      // Hanya diisi utk interior — eksterior tetap bergantung DEFAULT DB
      // (lihat komentar opts.target di repo/renders.ts).
      ...(isInterior ? { target: "interior", roomId: roomFacts!.roomId } : {}),
      // Kolom dinamis (pola sama dgn target/roomId di atas) — repo hanya
      // menyisipkannya ke INSERT saat !== undefined, jadi jalur tanpa
      // styleNotes tak menyentuh kolom style_notes sama sekali.
      styleNotes: cleanNotes,
    })

    const provider = getRenderProvider(mode)
    if (!provider) {
      await failRenderJob(job, "Provider render belum dikonfigurasi untuk mode ini")
      return errCode(502, "render_failed", "Provider render belum dikonfigurasi.")
    }

    let beautyUrl: string
    let depthUrl: string | undefined
    try {
      beautyUrl = await createSignedGetUrl(inputKeys.beauty)
      depthUrl = inputKeys.depth ? await createSignedGetUrl(inputKeys.depth) : undefined
    } catch (e) {
      console.error("[renders/POST] gagal menyiapkan signed URL input:", e)
      await failRenderJob(job, "Gagal menyiapkan input render")
      return errCode(502, "render_failed", "Gagal menyiapkan input render.")
    }

    // fal (queue POST cepat) & mock (resolve instan) diproses inline —
    // determinisme test/E2E butuh hasil akhir sudah ada saat respons balik.
    // gemini asli (mode cepat, 2-5 detik) WAJIB after() (pola
    // alternatives/generate) supaya request HTTP tak menggantung.
    const runInline = mode === "presisi" || usesMockOverride()

    if (runInline) {
      const submitResult = await provider.submit({
        prompt,
        seed,
        beautyUrl,
        depthUrl,
        webhookUrl: mode === "presisi" ? webhookUrlFor(job.id) : undefined,
      })

      if (submitResult === null) {
        await failRenderJob(job, "Provider gagal memproses render")
        return errCode(502, "render_failed", "Render gagal diproses provider.")
      }
      if (submitResult.kind === "async") {
        const submitted = await updateRenderJob(
          job.id,
          { status: "submitted", providerRequestId: submitResult.providerRequestId },
          { fromStatuses: ["queued"] }
        )
        return ok({ job: renderJobView(submitted ?? job), cached: false }, 201)
      }
      // kind === "done" (mock/fallback sinkron)
      const finalized = await finalizeRenderJob(job, { imageBytes: submitResult.imageBytes })
      return ok({ job: renderJobView(finalized ?? job), cached: false }, 201)
    }

    // mode cepat + gemini asli -> balas 201 dulu, submit+finalize di
    // background (pola alternatives/generate's enrichAlternatives).
    after(async () => {
      try {
        const submitResult = await provider.submit({ prompt, seed, beautyUrl, depthUrl })
        if (submitResult === null) {
          await failRenderJob(job, "Provider gagal memproses render")
          return
        }
        if (submitResult.kind === "done") {
          await finalizeRenderJob(job, { imageBytes: submitResult.imageBytes })
        } else {
          await updateRenderJob(
            job.id,
            { status: "submitted", providerRequestId: submitResult.providerRequestId },
            { fromStatuses: ["queued"] }
          )
        }
      } catch (e) {
        console.error("[renders/POST/after]", e instanceof Error ? e.message : e)
        await failRenderJob(job, e instanceof Error ? e.message : "Gagal memproses render")
      }
    })

    return ok({ job: renderJobView(job), cached: false }, 201)
  } catch (e) {
    return handleError(e)
  }
}

/** Galeri render per proyek — dibaca terlepas dari status flag ai_render_v1
 *  (flag hanya menggerbangi UI PEMBUATAN, bukan data yang sudah ada). */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { id: projectId } = await ctx.params
    const project = await getOwnedProject(projectId, userId)
    if (!project) return err(404, "Project not found")

    const jobs = await listRenderJobs(projectId, userId)
    return ok(jobs.map(renderJobView))
  } catch (e) {
    return handleError(e)
  }
}
