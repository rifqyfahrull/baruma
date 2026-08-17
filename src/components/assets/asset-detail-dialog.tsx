"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Check, ExternalLink, Loader2, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { useUpdateAssetMetadata } from "@/lib/api/hooks"
import { Input } from "@/components/ui/input"

import { isWebGLAvailable } from "@/lib/three/webgl-support"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type AssetDetail = {
  id: string
  name: string
  category: string
  status: string
  modelUrl?: string
  sourceName?: string
  fileSizeBytes?: number
  widthM?: number
  depthM?: number
  heightM?: number
  /** false/undefined = katalog global read-only → sembunyikan aksi rename. */
  editable?: boolean
}

function formatBytes(bytes?: number) {
  if (!bytes) return "-"
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Canvas 3D dialog dimuat lazy — three/drei baru diunduh saat dialog detail
// dibuka, bukan di bundle awal halaman.
const AssetDetailCanvas = dynamic(
  () => import("./asset-preview-canvas").then((m) => m.AssetDetailCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Memuat preview 3D…
      </div>
    ),
  }
)

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  )
}

/**
 * Full-size inspector for a stored GLB asset: a large orbit/zoom-able 3D
 * viewer plus the asset's metadata. One instance lives at the page level (a
 * single extra WebGL context, regardless of how many cards exist).
 */
export function AssetDetailDialog({
  asset,
  statusLabel,
  onClose,
  onRenamed,
}: {
  asset: AssetDetail | null
  statusLabel?: string
  onClose: () => void
  /** Called with the new name after a successful rename (update caller state). */
  onRenamed?: (assetId: string, name: string) => void
}) {
  const updateMetadata = useUpdateAssetMetadata()
  const [editingName, setEditingName] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setEditingName(false)
      setNameDraft(asset?.name ?? "")
    }, 0)
    return () => clearTimeout(timer)
  }, [asset?.id, asset?.name])

  const saveName = () => {
    if (!asset) return
    const name = nameDraft.trim()
    if (!name || name === asset.name) {
      setEditingName(false)
      return
    }
    updateMetadata.mutate(
      { assetId: asset.id, patch: { name } },
      {
        onSuccess: () => {
          toast.success("Nama asset diperbarui")
          setEditingName(false)
          onRenamed?.(asset.id, name)
        },
        onError: () => toast.error("Gagal mengganti nama"),
      }
    )
  }
  const dims = asset
    ? {
        w: asset.widthM && asset.widthM > 0 ? asset.widthM : 1,
        d: asset.depthM && asset.depthM > 0 ? asset.depthM : 1,
        h: asset.heightM && asset.heightM > 0 ? asset.heightM : 1,
      }
    : { w: 1, d: 1, h: 1 }

  return (
    <Dialog open={!!asset} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl">
        {asset && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {editingName ? (
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName()
                        if (e.key === "Escape") setEditingName(false)
                      }}
                      autoFocus
                      className="h-8"
                    />
                    <Button size="icon" variant="default" className="size-8 shrink-0" onClick={saveName} disabled={updateMetadata.isPending} aria-label="Simpan nama">
                      {updateMetadata.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setEditingName(false)} aria-label="Batal">
                      <X />
                    </Button>
                  </span>
                ) : (
                  <>
                    <span className="truncate">{asset.name}</span>
                    {/* Aset GLOBAL (katalog Baruma) read-only — rename hanya utk
                        aset milik user sendiri. */}
                    {asset.editable ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        onClick={() => { setNameDraft(asset.name); setEditingName(true) }}
                        aria-label="Ganti nama asset"
                        title="Ganti nama"
                      >
                        <Pencil />
                      </Button>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-[10px]">Katalog global</Badge>
                    )}
                  </>
                )}
                <Badge variant={asset.status === "ready" ? "default" : "secondary"}>
                  {statusLabel ?? asset.status}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {asset.sourceName ?? asset.category} — putar dengan drag, zoom dengan scroll.
              </DialogDescription>
            </DialogHeader>

            <div className="h-[26rem] w-full overflow-hidden rounded-lg border bg-muted/40">
              {asset.modelUrl && isWebGLAvailable() ? (
                <AssetDetailCanvas url={asset.modelUrl} dims={dims} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {asset.modelUrl
                    ? "Preview 3D tidak tersedia — browser/perangkat ini tidak mendukung WebGL."
                    : "Model belum tersedia di storage."}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Meta label="Kategori" value={asset.category} />
              <Meta
                label="Dimensi"
                value={
                  asset.widthM && asset.depthM && asset.heightM
                    ? `${asset.widthM} × ${asset.depthM} × ${asset.heightM} m`
                    : "-"
                }
              />
              <Meta label="Ukuran file" value={formatBytes(asset.fileSizeBytes)} />
              <Meta label="Asset ID" value={<span className="font-mono text-xs">{asset.id}</span>} />
            </div>

            {asset.modelUrl && (
              <Button asChild variant="outline" size="sm" className="w-fit">
                <a href={asset.modelUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Buka file model
                </a>
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
