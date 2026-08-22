"use client"

import * as React from "react"
import { Download, Images, Loader2 } from "lucide-react"

import type { Project } from "@/types"
import { usePreviewStore } from "@/stores/preview-store"
import {
  PHOTO_SHOTS,
  photoFilename,
  type PhotoShot,
} from "@/lib/three/photo-package"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type CapturedPhoto = { shot: PhotoShot; dataUrl: string }

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename
  a.click()
}

/**
 * Paket Foto Presentasi: sekali klik memutar scene melalui beberapa sudut &
 * suasana (siang/senja), memotret tiap frame lewat `captureFrame` (Screenshot
 * Bridge me-render ulang → aman di frameloop "demand"), lalu menampilkan galeri
 * yang bisa diunduh. State preview dipulihkan setelah selesai.
 */
export function PhotoPackage({
  project,
  trigger = "icon",
}: {
  project: Project
  /**
   * "icon" (default): tombol ikon bundar + Tooltip — dipakai lepas di rail.
   * "row" (§Fase 4): baris flyout lebar-penuh berlabel — dipakai di dalam
   * Popover Kamera (`view-toolbar.tsx`). testid `photo-package-open`
   * dipertahankan di kedua varian.
   */
  trigger?: "icon" | "row"
}) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [photos, setPhotos] = React.useState<CapturedPhoto[]>([])

  const generate = React.useCallback(async () => {
    const store = usePreviewStore.getState()
    if (!store.captureFrame) return
    setBusy(true)
    setPhotos([])
    setProgress(0)

    // Simpan state agar bisa dipulihkan.
    const saved = {
      viewPreset: store.viewPreset,
      realistic: store.realistic,
      nightMode: store.nightMode,
      sunStudyEnabled: store.sunStudy.enabled,
    }
    // Studi matahari mengunci azimut/elevasi — matikan agar preset lighting
    // paket foto (siang/senja) berlaku murni.
    if (saved.sunStudyEnabled) store.setSunStudyEnabled(false)

    const captured: CapturedPhoto[] = []
    try {
      for (let i = 0; i < PHOTO_SHOTS.length; i++) {
        const shot = PHOTO_SHOTS[i]
        const s = usePreviewStore.getState()
        if (shot.lighting === "senja") {
          s.setNightMode(true)
        } else {
          s.setNightMode(false)
          s.setRealistic(true)
        }
        s.requestView(shot.view)
        // Tunggu React commit (props three diperbarui) + CameraRig snap + settle.
        await nextFrame()
        await nextFrame()
        await sleep(400)
        const dataUrl = usePreviewStore.getState().captureFrame?.()
        if (dataUrl) captured.push({ shot, dataUrl })
        setProgress(i + 1)
      }
    } finally {
      // Pulihkan state semula.
      const s = usePreviewStore.getState()
      s.setNightMode(saved.nightMode)
      s.setRealistic(saved.realistic)
      if (saved.sunStudyEnabled) s.setSunStudyEnabled(true)
      s.requestView(saved.viewPreset)
      setPhotos(captured)
      setBusy(false)
    }
  }, [])

  const downloadAll = React.useCallback(() => {
    photos.forEach((p, i) => {
      // Jeda kecil antar unduhan agar browser tidak memblokir batch.
      setTimeout(() => triggerDownload(p.dataUrl, photoFilename(project.name, p.shot.id)), i * 350)
    })
  }, [photos, project.name])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "row" ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            data-testid="photo-package-open"
          >
            <Images className="size-3.5" />
            Paket Foto Presentasi
          </Button>
        </DialogTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Paket foto presentasi" data-testid="photo-package-open">
                <Images />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Paket foto presentasi</TooltipContent>
        </Tooltip>
      )}

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paket Foto Presentasi</DialogTitle>
          <DialogDescription>
            Membuat beberapa foto 3D dari sudut & suasana berbeda (siang & senja)
            sekaligus — siap dibagikan ke klien atau kontraktor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button onClick={generate} disabled={busy} data-testid="photo-package-generate">
              {busy ? (
                <>
                  <Loader2 className="animate-spin" /> Membuat… ({progress}/{PHOTO_SHOTS.length})
                </>
              ) : photos.length > 0 ? (
                "Buat ulang"
              ) : (
                <>
                  <Images /> Buat paket foto
                </>
              )}
            </Button>
            {photos.length > 0 && !busy && (
              <Button variant="outline" onClick={downloadAll} data-testid="photo-package-download-all">
                <Download /> Unduh semua ({photos.length})
              </Button>
            )}
          </div>

          {photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3" data-testid="photo-package-gallery">
              {photos.map((p) => (
                <figure key={p.shot.id} className="space-y-1.5 rounded-lg border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.dataUrl}
                    alt={p.shot.label}
                    className="aspect-video w-full rounded-md object-cover"
                  />
                  <figcaption className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{p.shot.label}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => triggerDownload(p.dataUrl, photoFilename(project.name, p.shot.id))}
                    >
                      <Download className="size-3.5" /> Unduh
                    </Button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-muted/50 p-3 text-center text-xs text-muted-foreground">
              {busy
                ? "Scene sedang diputar untuk memotret tiap sudut…"
                : "Klik \"Buat paket foto\" — scene akan diputar sebentar melalui tiap sudut, lalu hasilnya tampil di sini."}
            </p>
          )}
          <p className="text-[11px] leading-tight text-muted-foreground">
            Resolusi mengikuti layar. Untuk kualitas terbaik, perbesar jendela
            preview lebih dulu, lalu buat paket foto.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
