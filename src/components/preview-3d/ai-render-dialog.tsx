"use client"

import * as React from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { Download, History, Image as ImageIcon, Loader2, Lock, Sparkles } from "lucide-react"
import { nanoid } from "nanoid"
import { toast } from "sonner"

import type { AiRenderJob, AiRenderModeId, DesignLayout, Project } from "@/types"
import { usePreviewStore } from "@/stores/preview-store"
import { useEditorStore } from "@/stores/editor-store"
import { useProjectCapabilities } from "@/hooks/use-project-capabilities"
import {
  useCreateRender,
  useCurrentUser,
  useProjectRenders,
  useRenderJob,
  uploadRenderInput,
} from "@/lib/api/hooks"
import { queryKeys } from "@/lib/api/keys"
import { handlePlanError } from "@/lib/api/plan-error"
import { ApiError } from "@/lib/data/http"
import { PHOTO_SHOTS, type PhotoLighting } from "@/lib/three/photo-package"
import { poseKey, renderParamsHash, type CapturedPose } from "@/lib/three/render-capture"
import { RENDER_PRESETS, projectSeed, type RenderPreset } from "@/lib/server/ai-render/prompt"
import { RENDER_CREDIT_COST } from "@/lib/server/ai-render/pricing"
import type { ViewPreset } from "@/stores/preview-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const STATUS_LABEL: Record<string, string> = {
  queued: "Mengantre…",
  submitted: "Mengirim ke provider…",
  processing: "Merender…",
  succeeded: "Selesai",
  failed: "Gagal",
}

type Phase = "pilih" | "capturing" | "uploading" | "proses"

function extractServerMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  const body = error.body as { message?: unknown } | undefined
  return typeof body?.message === "string" ? body.message : null
}

/**
 * Bidikan bebas "Sudut saat ini" — capture apa adanya (view/lighting TIDAK
 * diubah), berdampingan dengan `PHOTO_SHOTS` (bidikan preset). `view`/
 * `lighting` sengaja absen di sini: nilainya diturunkan saat capture dari
 * pose kamera aktual (`poseKey`), bukan preset tetap — lihat pemakaian di
 * `handleSubmit`.
 */
const CURRENT_ANGLE_SHOT_ID = "sudut-ini"
type ShotOption = { id: string; label: string; view?: ViewPreset; lighting?: PhotoLighting }
const CURRENT_ANGLE_SHOT: ShotOption = { id: CURRENT_ANGLE_SHOT_ID, label: "Sudut saat ini" }
const EXTERIOR_SHOT_OPTIONS: ShotOption[] = [...PHOTO_SHOTS, CURRENT_ANGLE_SHOT]
/**
 * Bidikan untuk target Interior — kamera SELALU dipindah lewat
 * `requestInteriorView` (bukan `shot.view`, yang absen di sini sengaja),
 * jadi hanya suasana (lighting) yang relevan. Memakai label bidikan
 * eksterior (mis. "Tampak Depan — Siang") di sini menyesatkan karena
 * penempatan kamera diabaikan — lihat `handleSubmit`.
 */
const INTERIOR_SHOTS: ShotOption[] = [
  { id: "interior-siang", label: "Siang", lighting: "siang" },
  { id: "interior-senja", label: "Senja", lighting: "senja" },
]
const INTERIOR_SHOT_OPTIONS: ShotOption[] = [...INTERIOR_SHOTS, CURRENT_ANGLE_SHOT]

async function downloadRenderOutput(url: string): Promise<void> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objectUrl
    a.download = "baruma-render.png"
    a.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    toast.error("Gagal mengunduh hasil render.")
  }
}

/**
 * Dialog utama fitur Render AI (Fase 8 — docs/plan-integrasi-ai-renderer-
 * 2026-08.md). Dua tab: "Buat Baru" (pilih mode/preset/bidikan → capture →
 * upload → submit → poll → hasil) dan "Riwayat Render" (galeri
 * `useProjectRenders`).
 *
 * Flag `ai_render_v1` digerbangi DI SINI (bukan di pemanggil) — komponen
 * mengembalikan null saat nonaktif, meniru pola widget mandiri
 * (`PhotoPackage`/`ExportCard`). Catatan trade-off: semantik flag di seluruh
 * repo adalah "hanya menyembunyikan UI PEMBUATAN, data lama tetap tampil"
 * (lihat `src/lib/features.ts`) — tapi karena satu-satunya jalan ke galeri
 * render lama JUGA lewat dialog ini (tab "Riwayat Render"), mematikan flag
 * ikut menyembunyikan riwayat dari UI. Data itu sendiri tetap ada & tetap
 * terbaca via `GET .../renders` tanpa gate server (lihat komentar di
 * route.ts). Diterima sebagai trade-off v1 demi satu entry point sederhana.
 */
export function AiRenderDialog({
  project,
  layout,
}: {
  project: Project
  /** Sumber daftar ruangan untuk target render "Interior" (grup per lantai
   *  di `<select>`) — dipakai lagi sejak Fase B. */
  layout: DesignLayout
}) {
  const capabilities = useProjectCapabilities(project.id)
  const qc = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<"buat" | "riwayat">("buat")
  const [mode, setMode] = React.useState<AiRenderModeId>("cepat")
  const [preset, setPreset] = React.useState<string>(RENDER_PRESETS[0].id)
  const [shotId, setShotId] = React.useState<string>(EXTERIOR_SHOT_OPTIONS[0].id)
  const [target, setTarget] = React.useState<"exterior" | "interior">("exterior")
  const [roomId, setRoomId] = React.useState<string | null>(null)
  /** Catatan gaya (spec 2026-08-29 ai-render-chat-style-notes) — bisa diisi
   *  manual di sini ATAU via pre-fill dari chat AI Agent (lihat efek nonce
   *  di bawah). `styleNotesFromPrefill` mengendalikan chip "dari Asisten" —
   *  hilang begitu user MENGEDIT teksnya sendiri. */
  const [styleNotes, setStyleNotes] = React.useState("")
  const [styleNotesFromPrefill, setStyleNotesFromPrefill] = React.useState(false)
  const [phase, setPhase] = React.useState<Phase>("pilih")
  const [renderId, setRenderId] = React.useState<string | null>(null)
  const [cachedHit, setCachedHit] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [historyPreview, setHistoryPreview] = React.useState<AiRenderJob | null>(null)

  const { data: user } = useCurrentUser()
  const entitlements = user?.entitlements
  // Missing/null entitlements defaults to LOCKED, never to free access —
  // sama seperti gate export-card.tsx.
  const presisiLocked = !entitlements?.aiRenderHd
  const remainingCredits = user ? Math.max(0, user.creditsTotal - user.creditsUsed) : null

  const createRender = useCreateRender(project.id)
  const { data: job } = useRenderJob(project.id, renderId)
  const rendersQuery = useProjectRenders(project.id)

  const busy = phase !== "pilih"
  const cost = RENDER_CREDIT_COST[mode]

  // Reset alur "Buat Baru" tiap dialog ditutup — di handler onOpenChange
  // (bukan useEffect) supaya tidak memicu render tambahan cascading. Tab
  // "Riwayat" punya query sendiri, tidak perlu direset.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) return
    setPhase("pilih")
    setRenderId(null)
    setCachedHit(false)
    setSubmitError(null)
    setHistoryPreview(null)
    setTarget("exterior")
    setRoomId(null)
    setShotId(EXTERIOR_SHOT_OPTIONS[0].id)
    setStyleNotes("")
    setStyleNotesFromPrefill(false)
  }

  // Pre-fill dari chat AI Agent (spec 2026-08-29 ai-render-chat-style-notes):
  // panel Asisten mengintersep aksi `aiRender` dan memanggil
  // `requestAiRenderPrefill`, membumkan `aiRenderPrefill.nonce` — efek ini
  // membuka dialog SENDIRI + mengisi field, meniru pola nonce
  // viewNonce/focusNonce/interiorViewNonce (camera-rig.tsx): subscribe hanya
  // ke nonce (bukan seluruh objek) lalu baca payload via getState() di dalam
  // efek, supaya efek TIDAK re-run tiap render biasa. Berjalan juga saat
  // MOUNT (dialog belum pernah dibuka sebelumnya, mis. user baru pindah dari
  // /editor ke /preview-3d) — nonce yang dibaca saat itu sudah > 0 bila
  // prefill sempat diminta sebelum komponen ini mount.
  const aiRenderPrefillNonce = usePreviewStore((s) => s.aiRenderPrefill?.nonce)
  React.useEffect(() => {
    const prefill = usePreviewStore.getState().aiRenderPrefill
    if (!prefill) return
    setOpen(true)
    setTarget(prefill.target)
    const nextOptions = prefill.target === "interior" ? INTERIOR_SHOT_OPTIONS : EXTERIOR_SHOT_OPTIONS
    setShotId((prev) => (nextOptions.some((o) => o.id === prev) ? prev : nextOptions[0].id))
    // roomId tak valid (ruang sudah dihapus/berganti sejak chat) → biarkan
    // tak terseleksi, JANGAN tulis id basi.
    if (prefill.roomId && layout.rooms.some((r) => r.id === prefill.roomId)) {
      setRoomId(prefill.roomId)
    }
    // presetId tak valid → biarkan preset aktif (jangan timpa dgn nilai basi).
    if (prefill.presetId && RENDER_PRESETS.some((p) => p.id === prefill.presetId)) {
      setPreset(prefill.presetId)
    }
    if (prefill.styleNotes) {
      setStyleNotes(prefill.styleNotes)
      setStyleNotesFromPrefill(true)
    }
    // KONSUMSI SEKALI: bersihkan prefill setelah dipakai — tanpa ini, setiap
    // remount /preview-3d (navigasi editor↔preview) membuka ulang dialog
    // tanpa diminta sampai full reload (temuan I1 final review CHAT-R).
    usePreviewStore.setState({ aiRenderPrefill: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRenderPrefillNonce])

  if (!capabilities.ai_render_v1) return null

  // Daftar chip bidikan berbeda per target — Interior tak pernah memakai
  // `shot.view` (kamera dipindah via `requestInteriorView`), jadi label
  // sudut eksterior ("Tampak Depan", dst.) di sana menyesatkan.
  const shotOptions = target === "interior" ? INTERIOR_SHOT_OPTIONS : EXTERIOR_SHOT_OPTIONS

  function handleTargetChange(next: "exterior" | "interior") {
    setTarget(next)
    const nextOptions = next === "interior" ? INTERIOR_SHOT_OPTIONS : EXTERIOR_SHOT_OPTIONS
    setShotId((prev) => (nextOptions.some((o) => o.id === prev) ? prev : nextOptions[0].id))
  }

  const isCurrentAngleShot = shotId === CURRENT_ANGLE_SHOT_ID
  // Ruang yang bisa jadi target render interior — semua tipe ruangan KECUALI
  // yang bukan "ruang" dalam pengertian interior (taman/kolam ada di luar,
  // void bukan ruang sama sekali).
  const interiorRooms = layout.rooms.filter(
    (r) => r.type !== "taman" && r.type !== "kolam" && r.type !== "void"
  )
  const interiorRoomMissing = target === "interior" && !isCurrentAngleShot && !roomId
  // Label galeri: job interior menyimpan roomId hasil resolusi server —
  // nama ruangannya di-join dari layout klien (SEMUA rooms, bukan cuma
  // interiorRooms: ruangan bisa berganti tipe setelah render dibuat).
  const roomNameById = new Map(layout.rooms.map((r) => [r.id, r.name]))

  async function handleSubmit() {
    setSubmitError(null)
    if (mode === "presisi" && presisiLocked) return // submit sudah disabled; jaga-jaga
    if (interiorRoomMissing) return // submit sudah disabled; jaga-jaga

    const store = usePreviewStore.getState()
    if (!store.captureRenderInputs) {
      toast.error("Preview 3D belum siap — coba lagi sebentar.")
      return
    }
    const shot = shotOptions.find((s) => s.id === shotId) ?? shotOptions[0]
    const isCurrentAngle = shot.id === CURRENT_ANGLE_SHOT_ID
    // Target interior lewat bidikan preset (bukan "Sudut saat ini") butuh
    // ruang terpilih — server mendeteksi sendiri utk "Sudut saat ini".
    const targetRoomId = target === "interior" && !isCurrentAngle ? roomId : null

    setPhase("capturing")
    // Orkestrasi identik photo-package.tsx: simpan state, terapkan sudut/
    // suasana bidikan, settle 2×rAF + 400ms, capture, PULIHKAN di finally
    // (harus tetap jalan meski captureRenderInputs throw). "Sudut saat ini"
    // TIDAK menerapkan sudut/suasana apa pun — capture apa adanya — tapi
    // TETAP mematikan sunStudy (bayangan studi matahari bergerak antar
    // frame, mengganggu capture) & memulihkannya di finally seperti bidikan
    // lain.
    const saved = {
      viewPreset: store.viewPreset,
      realistic: store.realistic,
      nightMode: store.nightMode,
      sunStudyEnabled: store.sunStudy.enabled,
      showFurniture: store.showFurniture,
      exploded: store.exploded,
    }
    if (saved.sunStudyEnabled) store.setSunStudyEnabled(false)
    // Exploded menggeser world-y tiap lantai di KLIEN saja (EXPLODE_GAP);
    // server (floorElevations) tak tahu explode, jadi pose dari mode exploded
    // membuat deteksi ruang "Sudut saat ini" interior salah lantai. Matikan
    // selama capture (juga merapikan hasil eksterior), pulihkan di finally.
    if (saved.exploded) store.setExploded(false)
    // Interior tanpa furnitur terlihat kosong/tidak meyakinkan — paksa
    // tampil selama capture interior, pulihkan nilai lama di finally.
    if (targetRoomId) store.setShowFurniture(true)

    let captured: { beauty: string; depth: string; pose: CapturedPose } | null = null
    try {
      const s = usePreviewStore.getState()
      if (!isCurrentAngle) {
        if (shot.lighting === "senja") {
          s.setNightMode(true)
        } else {
          s.setNightMode(false)
          s.setRealistic(true)
        }
        if (targetRoomId) {
          s.requestInteriorView(targetRoomId)
        } else {
          s.requestView(shot.view as ViewPreset)
        }
      }
      await nextFrame()
      await nextFrame()
      await sleep(400)
      captured = (await usePreviewStore.getState().captureRenderInputs?.()) ?? null
    } catch (e) {
      console.error("[ai-render-dialog] captureRenderInputs gagal:", e)
      captured = null
    } finally {
      const s = usePreviewStore.getState()
      // "Sudut saat ini" tak pernah menyentuh nightMode/realistic/viewPreset
      // di atas — memulihkannya di sini jadi tak perlu (nilainya sudah sama
      // dgn `saved`) DAN tak diinginkan (requestView membumkan viewNonce,
      // memicu CameraRig "terbang" ke sudut yang sama — noop visual tapi
      // bukan noop di sisi state/efek). Ini berlaku juga utk interior:
      // penempatan interior MEMINDAHKAN kamera (beda dari "Sudut saat ini"),
      // jadi requestView(saved.viewPreset) di sini justru BENAR — mengembalikan
      // kamera ke sudut eksterior semula setelah dipakai untuk capture interior.
      if (!isCurrentAngle) {
        s.setNightMode(saved.nightMode)
        s.setRealistic(saved.realistic)
        s.requestView(saved.viewPreset)
      }
      if (targetRoomId) s.setShowFurniture(saved.showFurniture)
      if (saved.sunStudyEnabled) s.setSunStudyEnabled(true)
      if (saved.exploded) s.setExploded(true)
    }

    if (!captured) {
      // Gagal di tahap capture -> TIDAK PERNAH memotong kredit (belum
      // menyentuh createRender.mutate sama sekali).
      setPhase("pilih")
      toast.error("Gagal mengambil gambar dari preview 3D. Coba lagi.")
      return
    }

    setPhase("uploading")
    let beautyKey: string
    let depthKey: string | undefined
    try {
      beautyKey = await uploadRenderInput(project.id, captured.beauty, `${shot.id}-beauty.png`)
      if (mode === "presisi") {
        depthKey = await uploadRenderInput(project.id, captured.depth, `${shot.id}-depth.png`)
      }
    } catch (e) {
      setPhase("pilih")
      toast.error(e instanceof Error ? e.message : "Gagal mengupload gambar render.")
      return
    }

    // layoutRevision: pakai `useEditorStore.layoutRevision` (revisi tersimpan
    // terakhir, di-bump oleh `markSaved` setiap autosave layout sukses — lihat
    // src/stores/editor-store.ts) — sinyal ini SUDAH ada di store & berubah
    // persis saat desain berubah (tersimpan), jadi paling representatif utk
    // cache key params_hash tanpa perlu request tambahan. Keterbatasan yang
    // diterima: edit lokal yang BELUM ter-autosave tidak mengubah angka ini,
    // sehingga render bisa memakai cache lama — dapat diterima karena
    // autosave men-debounce singkat dan hasil render bukan gambar kerja
    // presisi (lihat label kejujuran di hasil).
    const layoutRevision = useEditorStore.getState().layoutRevision ?? 0
    const seed = projectSeed(project.id)
    // "Sudut saat ini": tak ada view preset tetap utk dihash — pakai
    // poseKey (kuantisasi 0.1 m/0.5°) supaya cache params_hash tetap hit
    // walau kamera bergeser di bawah ambang jitter, dan lighting dicap
    // "apa-adanya" (bukan "siang"/"senja" — TIDAK diubah saat capture).
    // Render interior butuh `view` yang membedakan RUANG (bukan cuma sudut
    // eksterior) di params_hash — dua ruang berbeda dgn shotId/preset sama
    // TIDAK boleh saling bertabrakan di cache. Selected-room: kunci ke
    // roomId. "Sudut saat ini" interior: kunci ke poseKey (server mendeteksi
    // ruang dari pose, jadi pose-nya sendiri yang membedakan ruang/sudut).
    const view =
      target === "interior"
        ? `interior:${isCurrentAngle ? poseKey(captured.pose) : targetRoomId}`
        : isCurrentAngle
          ? poseKey(captured.pose)
          : (shot.view as string)
    // Catatan gaya (spec 2026-08-29 ai-render-chat-style-notes): hanya
    // diikutkan (ke hash MAUPUN payload) bila non-kosong setelah trim —
    // absen → params_hash byte-identik dgn skema lama, tak ada field
    // `styleNotes` di body (kompat cache/kontrak lama).
    const styleNotesTrimmed = styleNotes.trim()
    const paramsHash = renderParamsHash({
      layoutRevision,
      view,
      lighting: isCurrentAngle ? "apa-adanya" : (shot.lighting as string),
      preset,
      seed,
      mode,
      ...(styleNotesTrimmed ? { styleNotes: styleNotesTrimmed } : {}),
    })

    setPhase("proses")
    createRender.mutate(
      {
        mode,
        preset,
        shotId: shot.id,
        clientRequestId: nanoid(),
        inputKeys: depthKey ? { beauty: beautyKey, depth: depthKey } : { beauty: beautyKey },
        paramsHash,
        pose: captured.pose,
        target,
        ...(targetRoomId ? { roomId: targetRoomId } : {}),
        ...(styleNotesTrimmed ? { styleNotes: styleNotesTrimmed } : {}),
      },
      {
        onSuccess: (result) => {
          qc.setQueryData(queryKeys.render(project.id, result.job.id), result.job)
          setRenderId(result.job.id)
          setCachedHit(result.cached)
          if (result.cached) toast.success("Render diambil dari cache — tanpa kredit.")
        },
        onError: (error) => {
          setPhase("pilih")
          // handlePlanError menangani 402 insufficient_credits & 403
          // plan_feature_locked (toast + tombol Upgrade) — kalau BUKAN salah
          // satu itu (mis. 503 ai_render_not_configured, 502 render_failed,
          // 403 feature_disabled), tampilkan pesan server di panel error.
          if (handlePlanError(error)) return
          setSubmitError(
            extractServerMessage(error) ??
              "Render gagal diproses. Kredit otomatis dikembalikan bila sempat terpotong."
          )
        },
      }
    )
  }

  const showResult = phase === "proses" && !!renderId

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Render AI"
              data-testid="ai-render-open"
            >
              <Sparkles />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Render AI</TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Render AI</DialogTitle>
          <DialogDescription>
            Ubah preview 3D jadi visualisasi bergaya foto — pilih mode, suasana, dan
            sudut, lalu render.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "buat" | "riwayat")}>
          <TabsList>
            <TabsTrigger value="buat" data-testid="ai-render-tab-buat">
              Buat Baru
            </TabsTrigger>
            <TabsTrigger value="riwayat" data-testid="ai-render-tab-riwayat">
              <History className="size-3.5" /> Riwayat Render
            </TabsTrigger>
          </TabsList>

          <TabsContent value="buat" className="space-y-4">
            {!showResult ? (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">Mode render</p>
                  <div className="grid grid-cols-2 gap-2">
                    <ModeCard
                      label="Cepat"
                      description="Draft — 2-5 detik, ada watermark di plan Free."
                      cost={RENDER_CREDIT_COST.cepat}
                      active={mode === "cepat"}
                      locked={false}
                      onClick={() => setMode("cepat")}
                      testId="ai-render-mode-cepat"
                    />
                    <ModeCard
                      label="Presisi"
                      description="HD, pakai depth pass — lebih akurat ke bentuk bangunan."
                      cost={RENDER_CREDIT_COST.presisi}
                      active={mode === "presisi"}
                      locked={presisiLocked}
                      onClick={() => setMode("presisi")}
                      testId="ai-render-mode-presisi"
                    />
                  </div>
                  {mode === "presisi" && presisiLocked && (
                    <p
                      className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground"
                      data-testid="ai-render-locked-presisi"
                    >
                      Mode Presisi (HD, tanpa watermark) tersedia di plan Pro ke atas.{" "}
                      <Link href="/app/billing" className="font-medium text-primary underline">
                        Upgrade ke Pro
                      </Link>
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">Target render</p>
                  <div className="grid grid-cols-2 gap-2">
                    <TargetCard
                      label="Eksterior"
                      description="Tampak luar rumah dari sudut pilihan."
                      active={target === "exterior"}
                      onClick={() => handleTargetChange("exterior")}
                      testId="ai-render-target-eksterior"
                    />
                    <TargetCard
                      label="Interior"
                      description="Tampak dalam satu ruangan, kamera di dalamnya."
                      active={target === "interior"}
                      onClick={() => handleTargetChange("interior")}
                      testId="ai-render-target-interior"
                    />
                  </div>
                  {target === "interior" && (
                    <select
                      data-testid="ai-render-interior-room"
                      value={roomId ?? ""}
                      onChange={(e) => setRoomId(e.target.value || null)}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="" disabled>
                        Pilih ruangan…
                      </option>
                      {layout.floors.map((floor) => {
                        const rooms = interiorRooms.filter((r) => r.floorId === floor.id)
                        if (rooms.length === 0) return null
                        return (
                          <optgroup key={floor.id} label={floor.name}>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} — {floor.name}
                              </option>
                            ))}
                          </optgroup>
                        )
                      })}
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">Suasana</p>
                  <RadioGroup
                    value={preset}
                    onValueChange={setPreset}
                    className="grid grid-cols-2 gap-2"
                  >
                    {RENDER_PRESETS.map((p) => (
                      <PresetCard key={p.id} preset={p} active={preset === p.id} />
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold">Catatan gaya (opsional)</p>
                    {styleNotesFromPrefill && (
                      <Badge
                        variant="secondary"
                        className="text-[10px]"
                        data-testid="ai-render-style-notes-chip"
                      >
                        dari Asisten
                      </Badge>
                    )}
                  </div>
                  <textarea
                    data-testid="ai-render-style-notes"
                    value={styleNotes}
                    onChange={(e) => {
                      setStyleNotes(e.target.value.slice(0, 240))
                      setStyleNotesFromPrefill(false)
                    }}
                    maxLength={240}
                    rows={2}
                    placeholder="mis. suasana hangat sore hari, tambahkan orang berjalan di taman"
                    className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs"
                  />
                  <p
                    className="text-right text-[10px] text-muted-foreground"
                    data-testid="ai-render-style-notes-counter"
                  >
                    {styleNotes.length}/240
                  </p>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">Sudut pandang</p>
                  <div className="flex flex-wrap gap-1.5">
                    {shotOptions.map((shot) => (
                      <button
                        key={shot.id}
                        type="button"
                        data-testid={`ai-render-shot-${shot.id}`}
                        aria-pressed={shotId === shot.id}
                        onClick={() => setShotId(shot.id)}
                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                          shotId === shot.id
                            ? "border-primary bg-primary/10 font-medium"
                            : "hover:bg-muted"
                        }`}
                      >
                        {shot.label}
                      </button>
                    ))}
                  </div>
                </div>

                {submitError && (
                  <div
                    className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
                    data-testid="ai-render-error"
                  >
                    {submitError}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="ai-render-credits-remaining"
                  >
                    {remainingCredits != null ? `Sisa kredit: ${remainingCredits}` : "Memuat kredit…"}
                  </p>
                  <Button
                    onClick={handleSubmit}
                    disabled={busy || (mode === "presisi" && presisiLocked) || interiorRoomMissing}
                    data-testid="ai-render-submit"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="animate-spin" />{" "}
                        {phase === "capturing"
                          ? "Mengambil gambar…"
                          : phase === "uploading"
                            ? "Mengunggah…"
                            : "Memproses…"}
                      </>
                    ) : (
                      `Render — ${cost} kredit`
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <RenderProgress
                job={job}
                cachedHit={cachedHit}
                onReset={() => {
                  setPhase("pilih")
                  setRenderId(null)
                  setCachedHit(false)
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="riwayat">
            <RenderGallery
              jobs={rendersQuery.data ?? []}
              loading={rendersQuery.isLoading}
              selected={historyPreview}
              onSelect={setHistoryPreview}
              roomNameById={roomNameById}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function ModeCard({
  label,
  description,
  cost,
  active,
  locked,
  onClick,
  testId,
}: {
  label: string
  description: string
  cost: number
  active: boolean
  locked: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border p-3 text-left text-sm transition-colors ${
        active ? "border-primary bg-primary/10" : "hover:bg-muted"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        {locked ? (
          <Badge variant="secondary" className="gap-1">
            <Lock className="size-3" /> Pro
          </Badge>
        ) : (
          <Badge variant="outline">{cost} kredit</Badge>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
    </button>
  )
}

/** Segmented control Eksterior|Interior — mirror `ModeCard` (tanpa
 *  cost/lock, yang tak relevan di sini). */
function TargetCard({
  label,
  description,
  active,
  onClick,
  testId,
}: {
  label: string
  description: string
  active: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border p-3 text-left text-sm transition-colors ${
        active ? "border-primary bg-primary/10" : "hover:bg-muted"
      }`}
    >
      <span className="font-medium">{label}</span>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
    </button>
  )
}

function PresetCard({ preset, active }: { preset: RenderPreset; active: boolean }) {
  const inputId = `ai-render-preset-${preset.id}`
  return (
    <label
      htmlFor={inputId}
      data-testid={inputId}
      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors ${
        active ? "border-primary bg-primary/10" : "hover:bg-muted"
      }`}
    >
      <RadioGroupItem id={inputId} value={preset.id} />
      <span className="font-medium">{preset.label}</span>
    </label>
  )
}

function RenderProgress({
  job,
  cachedHit,
  onReset,
}: {
  job: AiRenderJob | null | undefined
  cachedHit: boolean
  onReset: () => void
}) {
  if (!job) {
    return (
      <div
        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        data-testid="ai-render-progress"
      >
        <Loader2 className="size-4 animate-spin" /> Menyiapkan render…
      </div>
    )
  }

  if (job.status === "failed") {
    return (
      <div className="space-y-3 py-4">
        <div
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="ai-render-error"
        >
          {job.errorMessage ?? "Render gagal diproses."}
          <p className="mt-1 text-[11px] text-destructive/80">Kredit otomatis dikembalikan.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          Coba lagi
        </Button>
      </div>
    )
  }

  if (job.status === "succeeded" && job.outputUrl) {
    return (
      <div className="space-y-3 py-2">
        {cachedHit && (
          <p className="text-[11px] text-muted-foreground" data-testid="ai-render-cached-note">
            dari cache — tanpa kredit
          </p>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={job.outputUrl}
          alt="Hasil render AI"
          data-testid="ai-render-result-image"
          className="aspect-video w-full rounded-lg border object-cover"
        />
        <p className="text-[11px] text-muted-foreground">
          Visualisasi konsep — bukan gambar kerja
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="ai-render-download"
            onClick={() => downloadRenderOutput(job.outputUrl!)}
          >
            <Download className="size-3.5" /> Unduh
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            Render lagi
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
      data-testid="ai-render-progress"
    >
      <Loader2 className="size-4 animate-spin" /> {STATUS_LABEL[job.status] ?? "Memproses…"}
    </div>
  )
}

/** Label badge target utk satu job galeri — hanya render interior yang
 *  diberi badge ("Interior · {nama ruangan}"); eksterior dibiarkan polos
 *  supaya galeri tak riuh (status badge saja sudah ada). */
function interiorLabel(
  job: AiRenderJob,
  roomNameById: Map<string, string>
): string | null {
  if (job.target !== "interior") return null
  const roomName = job.roomId ? roomNameById.get(job.roomId) : undefined
  return roomName ? `Interior · ${roomName}` : "Interior"
}

function RenderGallery({
  jobs,
  loading,
  selected,
  onSelect,
  roomNameById,
}: {
  jobs: AiRenderJob[]
  loading: boolean
  selected: AiRenderJob | null
  onSelect: (job: AiRenderJob | null) => void
  roomNameById: Map<string, string>
}) {
  if (loading) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Memuat riwayat…</p>
  }
  if (jobs.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        Belum ada render. Buat yang pertama di tab &quot;Buat Baru&quot;.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2" data-testid="ai-render-gallery">
        {jobs.map((j) => (
          <button
            key={j.id}
            type="button"
            data-testid={`ai-render-gallery-item-${j.id}`}
            onClick={() => onSelect(j)}
            className={`relative overflow-hidden rounded-md border ${
              selected?.id === j.id ? "border-primary" : ""
            }`}
          >
            {j.outputUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={j.outputUrl} alt="" className="aspect-video w-full object-cover" />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-muted">
                <ImageIcon className="size-4 text-muted-foreground" />
              </div>
            )}
            {interiorLabel(j, roomNameById) && (
              <span className="absolute top-1 left-1">
                <Badge variant="outline" className="bg-background/80 text-[10px]">
                  {interiorLabel(j, roomNameById)}
                </Badge>
              </span>
            )}
            <span className="absolute right-1 bottom-1">
              <Badge
                variant={
                  j.status === "succeeded"
                    ? "secondary"
                    : j.status === "failed"
                      ? "destructive"
                      : "outline"
                }
                className="text-[10px]"
              >
                {STATUS_LABEL[j.status] ?? j.status}
              </Badge>
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="space-y-2 rounded-lg border p-2">
          {selected.outputUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.outputUrl}
              alt="Hasil render"
              className="aspect-video w-full rounded-md object-cover"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {selected.errorMessage ?? "Belum ada hasil."}
            </p>
          )}
          {selected.outputUrl && (
            <Button
              size="sm"
              variant="outline"
              data-testid="ai-render-history-download"
              onClick={() => downloadRenderOutput(selected.outputUrl!)}
            >
              <Download className="size-3.5" /> Unduh
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
