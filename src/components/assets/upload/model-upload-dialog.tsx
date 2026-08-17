"use client"

import * as React from "react"
import { Upload, X, FileWarning, CheckCircle2, Loader2 } from "lucide-react"
import type { SlotType } from "@/types"
import { slotRequirementsText, VALIDATION_PROFILES } from "@/lib/interior/validation-profiles"
import { analyzeGlbFile, validateBboxForSlot } from "@/lib/three/glb-analyzer"
import { useRequestUploadUrl, useCreateIngestionJob, useIngestionJob, useUpdateAssetMetadata, useAttachAssetToSlot } from "@/lib/api/hooks"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"

type Step =
  | "requirements"
  | "uploading"
  | "validating"
  | "needs_scale"
  | "needs_metadata"
  | "material_mode"
  | "confirm"
  | "success"
  | "error"

export type UploadDialogProps = {
  open: boolean
  onClose: () => void
  projectId: string
  roomId?: string
  /** Tanpa slotId = mode LIBRARY: upload masuk My Library saja (tidak ada
   *  langkah attach ke slot) — pemasangan ke ruang diurus pemanggil via
   *  onUploadComplete. */
  slotId?: string
  slotType?: SlotType
  onUploadComplete?: (
    assetId: string,
    modelUrl: string,
    meta?: {
      name: string
      category: string
      widthM: number
      depthM: number
      heightM: number
      /** Harga level aset (Rp) dari input opsional user — diwariskan ke
       *  penempatan furniture; null = "belum dihargai" di budget/RAB. */
      priceIDR?: number | null
    }
  ) => void
}

export function ModelUploadDialog({
  open,
  onClose,
  projectId,
  roomId,
  slotId,
  slotType = "generic",
  onUploadComplete,
}: UploadDialogProps) {
  const [step, setStep] = React.useState<Step>("requirements")
  const [file, setFile] = React.useState<File | null>(null)
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [dimensions, setDimensions] = React.useState({ widthM: 1.2, depthM: 0.08, heightM: 0.7 })
  const [licenseConfirmed, setLicenseConfirmed] = React.useState(false)
  // Harga level aset (Rp) — opsional; string agar input kosong tetap kosong.
  const [priceInput, setPriceInput] = React.useState("")
  const [materialMode, setMaterialMode] = React.useState<"keep_original" | "match_project_style" | "customize">("match_project_style")
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [assetId, setAssetId] = React.useState<string | null>(null)
  const [fileUrl, setFileUrl] = React.useState<string | null>(null)

  const requestUploadUrl = useRequestUploadUrl()
  const createJob = useCreateIngestionJob()
  const { data: jobStatus } = useIngestionJob(jobId)
  const updateMetadata = useUpdateAssetMetadata()
  const attachAsset = useAttachAssetToSlot()

  const req = slotRequirementsText(slotType)
  const profile = VALIDATION_PROFILES[slotType]

  const reset = () => {
    setStep("requirements")
    setFile(null)
    setProgress(0)
    setError(null)
    setDimensions({ widthM: 1.2, depthM: 0.08, heightM: 0.7 })
    setLicenseConfirmed(false)
    setPriceInput("")
    setMaterialMode("match_project_style")
    setJobId(null)
    setAssetId(null)
    setFileUrl(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFile = (f: File) => {
    if (!f.name.endsWith(".glb")) { setError("Hanya file GLB yang didukung"); return }
    if (f.size > 100 * 1024 * 1024) { setError("Ukuran file maksimal 100MB"); return }
    setFile(f)
    setError(null)
    startUpload(f)
  }

  const startUpload = async (f: File) => {
    setStep("uploading")
    setProgress(10)
    setError(null)

    try {
      // 1. Request signed upload URL
      setProgress(20)
      const signed = await requestUploadUrl.mutateAsync({
        projectId,
        filename: f.name,
        contentType: "model/gltf-binary",
        fileSizeBytes: f.size,
      })
      if (!signed) throw new Error("Endpoint upload tidak tersedia di server")
      const { uploadUrl, fileUrl: url } = signed
      setFileUrl(url)
      setProgress(40)

      // 2. Upload file to R2/S3 via signed URL
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "model/gltf-binary" },
        body: f,
      })
      if (!uploadRes.ok) throw new Error("Gagal mengupload file ke storage")
      setProgress(60)

      // 3. Client-side GLB analysis
      setStep("validating")
      setProgress(65)
      const analysis = await analyzeGlbFile(f)
      if (!analysis.loaded) {
        // analysis.error is the raw three.js loader message (English parser
        // jargon like `Unexpected token 'd' … is not valid JSON`) — keep it
        // in the console for debugging, never show it to the user.
        if (analysis.error) console.warn("GLB analysis failed:", analysis.error)
        setError("File GLB tidak bisa dibaca — mungkin corrupt atau bukan format GLB.")
        setStep("error")
        return
      }
      setProgress(80)

      // 4. Create ingestion job on server
      const job = await createJob.mutateAsync({
        projectId,
        roomId,
        slotId,
        expectedCategory: slotType,
        fileUrl: url,
        originalFilename: f.name,
        sourceName: "furnimesh",
      })
      setJobId(job.jobId)
      setAssetId(job.assetId)

      // 5. Save analysis results as metadata
      if (analysis.boundingBox) {
        await updateMetadata.mutateAsync({
          assetId: job.assetId,
          patch: {
            raw_bounding_box_json: analysis.boundingBox,
            performance_json: analysis.performance,
            material_analysis_json: { materialNames: analysis.materialNames },
          } as Record<string, unknown>,
        })
      }

      // 6. Validate bbox against slot profile
      if (analysis.boundingBox) {
        const bbox = analysis.boundingBox
        // Default to 1 unit = 1 meter if user hasn't provided real scale yet
        const dims = { widthM: bbox.width, depthM: bbox.depth, heightM: bbox.height }
        setDimensions(dims)

        const validation = validateBboxForSlot(bbox, profile.recommended)
        if (validation.warnings.length > 0 || validation.confidence < 75) {
          // Needs user input for scale
          setStep("needs_scale")
        } else {
          setStep("material_mode")
        }
      } else {
        setStep("needs_scale")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memproses upload")
      setStep("error")
    }
  }

  // Poll job status for real-time progress updates
  React.useEffect(() => {
    if (!jobStatus || !jobId) return
    const timer = setTimeout(() => {
      // Update progress from server
      setProgress(jobStatus.progress)
      // Handle status transitions
      if (jobStatus.status === "ready" || jobStatus.status === "attached") {
        setStep("material_mode")
      } else if (jobStatus.status === "failed" || jobStatus.status === "rejected") {
        setError("Validasi model gagal. Silakan coba file lain.")
        setStep("error")
      } else if (jobStatus.status === "needs_scale" && step === "validating") {
        setStep("needs_scale")
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [jobStatus, jobId, step])

  const parsedPriceIDR = (() => {
    const v = Number(priceInput.replace(/[^\d]/g, ""))
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  })()

  const handleAttach = async () => {
    if (!assetId) return
    setStep("success")
    try {
      await updateMetadata.mutateAsync({
        assetId,
        patch: {
          width_m: dimensions.widthM,
          depth_m: dimensions.depthM,
          height_m: dimensions.heightM,
          license_confirmation: licenseConfirmed,
          material_mode: materialMode,
          // Harga level aset — tersimpan di user_assets.price_idr sehingga
          // penempatan berikutnya dari My Library ikut berharga.
          ...(parsedPriceIDR != null ? { price_idr: parsedPriceIDR } : {}),
        } as Record<string, unknown>,
      })
      if (slotId) {
        await attachAsset.mutateAsync({
          projectId,
          slotId,
          assetId,
          fitMode: "fit_to_slot_width",
          materialMode,
        })
      }
      onUploadComplete?.(assetId, fileUrl ?? "", {
        name: file?.name.replace(/\.glb$/i, "") ?? "Model kustom",
        category: slotType,
        widthM: dimensions.widthM,
        depthM: dimensions.depthM,
        heightM: dimensions.heightM,
        priceIDR: parsedPriceIDR,
      })
    } catch {
      setError("Gagal memasang model ke slot")
      setStep("error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            Upload Model untuk {req.label}
          </DialogTitle>
          <DialogDescription>
            Slot ini mengharapkan model {req.label.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone */}
        {step === "requirements" && (
          <div className="space-y-4">
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
            >
              <Upload className="mb-2 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Drop file .glb di sini</p>
              <p className="mt-1 text-xs text-muted-foreground">atau</p>
              <label className="mt-2 cursor-pointer">
                <Button variant="outline" size="sm" asChild><span>Pilih file</span></Button>
                <input type="file" accept=".glb" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </label>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
              <p className="font-medium">Persyaratan:</p>
              <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                <li>Format: {req.format}</li>
                <li>Ukuran file: maks 100MB</li>
                <li>Ekspektasi ukuran: {req.expectedSize}</li>
                {req.tips.map((tip, i) => <li key={i}>{tip}</li>)}
              </ul>
            </div>
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <FileWarning className="size-4" />{error}
              </div>
            )}
          </div>
        )}

        {/* Uploading / Validating */}
        {(step === "uploading" || step === "validating") && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm font-medium">
                {step === "uploading" ? "Mengupload & menganalisis model..." : "Memvalidasi model..."}
              </span>
            </div>
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">{file?.name}</p>
          </div>
        )}

        {/* Needs Scale */}
        {step === "needs_scale" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              <CheckCircle2 className="size-4" />Model valid. Masukkan ukuran sebenarnya (meter).
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium">Lebar (m)</label>
                <input type="number" step="0.01" min="0.01" value={dimensions.widthM}
                  onChange={(e) => setDimensions((d) => ({ ...d, widthM: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">Kedalaman (m)</label>
                <input type="number" step="0.01" min="0.01" value={dimensions.depthM}
                  onChange={(e) => setDimensions((d) => ({ ...d, depthM: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">Tinggi (m)</label>
                <input type="number" step="0.01" min="0.01" value={dimensions.heightM}
                  onChange={(e) => setDimensions((d) => ({ ...d, heightM: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Ekspektasi slot: {req.expectedSize}</p>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="license" checked={licenseConfirmed}
                onChange={(e) => setLicenseConfirmed(e.target.checked)} className="size-4" />
              <label htmlFor="license" className="text-xs">Saya memiliki hak untuk menggunakan model ini</label>
            </div>
            <Button className="w-full" disabled={!licenseConfirmed} onClick={() => setStep("material_mode")}>
              Lanjut ke Material
            </Button>
          </div>
        )}

        {/* Material Mode */}
        {step === "material_mode" && (
          <div className="space-y-4">
            <p className="text-sm font-medium">Pilih mode material:</p>
            {([
              { value: "keep_original" as const, label: "Pertahankan Original", desc: "Gunakan warna & tekstur bawaan model" },
              { value: "match_project_style" as const, label: "Sesuaikan Style Project", desc: "Otomatis mapping material ke Design DNA project" },
              { value: "customize" as const, label: "Kustom Manual", desc: "Pilih sendiri mapping material" },
            ]).map((opt) => (
              <button key={opt.value} type="button" onClick={() => setMaterialMode(opt.value)}
                className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${materialMode === opt.value ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
                <p className="font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </button>
            ))}
            <Button className="w-full" onClick={() => setStep("confirm")}>Lanjut ke Konfirmasi</Button>
          </div>
        )}

        {/* Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="asset-price" className="text-xs font-medium">
                Perkiraan harga (Rp) — opsional
              </label>
              <input
                id="asset-price"
                type="text"
                inputMode="numeric"
                placeholder="cth. 2500000"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Dipakai estimasi budget/RAB. Kosongkan bila belum tahu — item
                akan ditandai &quot;belum dihargai&quot;, bukan dihitung Rp 0.
              </p>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <p className="font-medium">Ringkasan:</p>
              <p className="text-xs text-muted-foreground">Slot: {req.label} · {dimensions.widthM}×{dimensions.depthM}×{dimensions.heightM}m</p>
              <p className="text-xs text-muted-foreground">Material: {materialMode === "keep_original" ? "Original" : materialMode === "match_project_style" ? "Sesuaikan style" : "Kustom"}</p>
              <p className="text-xs text-muted-foreground">Lisensi: {licenseConfirmed ? "Dikonfirmasi" : "Belum"}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("requirements")}>Batal</Button>
              <Button className="flex-1" onClick={handleAttach} disabled={attachAsset.isPending}>
                {attachAsset.isPending ? <Loader2 className="size-4 animate-spin" /> : "Pasang Model"}
              </Button>
            </div>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-12 text-green-500" />
            <p className="font-semibold">Model berhasil dipasang!</p>
            <p className="text-sm text-muted-foreground">Placeholder telah diganti. Model tersimpan di My Library.</p>
            <Button className="w-full" onClick={handleClose}>Selesai</Button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <FileWarning className="size-4" />{error || "Gagal memproses model."}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Tutup</Button>
              <Button className="flex-1" onClick={() => { setError(null); setStep("requirements") }}>Coba Lagi</Button>
            </div>
          </div>
        )}

        {step !== "uploading" && step !== "validating" && (
          <button type="button" onClick={handleClose} className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
            <X className="size-4" />
          </button>
        )}
      </DialogContent>
    </Dialog>
  )
}
