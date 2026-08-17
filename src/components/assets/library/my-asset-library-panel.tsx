"use client"

import * as React from "react"
import Image from "next/image"
import { Search, Filter, CheckCircle2, AlertTriangle } from "lucide-react"
import { useMyAssets } from "@/lib/api/hooks"
import { AssetModelPreview } from "@/components/assets/asset-model-preview"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatIDRCompact } from "@/lib/format"
import { cn } from "@/lib/utils"

export type AssetItem = {
  id: string
  name: string
  category: string
  modelUrl?: string
  thumbnailUrl?: string
  sourceName?: string
  fileSizeBytes?: number
  widthM?: number
  depthM?: number
  heightM?: number
  /** Harga level aset (Rp) — diwariskan ke penempatan furniture (budget/RAB).
   *  Absent = penempatan berstatus "belum dihargai" sampai diisi. */
  priceIDR?: number | null
  status: string
  /** false = katalog global read-only (tak bisa di-rename user). */
  editable?: boolean
}

const CATEGORIES = [
  { value: "", label: "Semua" },
  { value: "facade", label: "Fasad" },
  { value: "gate", label: "Gerbang" },
  { value: "fence", label: "Pagar" },
  { value: "door", label: "Pintu" },
  { value: "window", label: "Jendela" },
  { value: "arch_element", label: "Elemen Arsitektur" },
  { value: "kitchen", label: "Dapur" },
  { value: "sofa", label: "Sofa" },
  { value: "coffee_table", label: "Meja" },
  { value: "bedroom", label: "Kamar Tidur" },
  { value: "sanitary", label: "Sanitair" },
  { value: "lighting", label: "Lampu" },
  { value: "decor", label: "Dekorasi" },
  { value: "building_reference", label: "Bangunan" },
  { value: "tv", label: "TV" },
  { value: "generic", label: "Lainnya" },
]

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ready: { label: "Siap", variant: "default" },
  attached: { label: "Terpasang", variant: "secondary" },
  needs_scale: { label: "Butuh Ukuran", variant: "outline" },
  needs_metadata: { label: "Butuh Data", variant: "outline" },
  validating: { label: "Validasi", variant: "secondary" },
  uploaded: { label: "Diupload", variant: "secondary" },
  failed: { label: "Gagal", variant: "destructive" },
  rejected: { label: "Ditolak", variant: "destructive" },
}

export function MyAssetLibraryPanel({
  onSelect,
  selectedAssetId,
  initialCategory = "",
}: {
  onSelect?: (asset: AssetItem) => void
  selectedAssetId?: string | null
  /** Preset filter kategori saat panel dibuka (mis. "gate" untuk elemen
   *  gerbang). Kosong = semua. */
  initialCategory?: string
}) {
  const [category, setCategory] = React.useState(initialCategory)
  const [search, setSearch] = React.useState("")
  // Debounce: tiap keystroke JANGAN langsung mengubah daftar — kartu yang
  // keluar/masuk hasil filter me-mount/unmount <Canvas> preview (konteks
  // WebGL), dan pembuatan konteks baru bisa menggusur konteks canvas 3D
  // utama (context loss → scene rumah re-render dari nol). Satu perubahan
  // daftar per jeda ketik, bukan per huruf.
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // Paginasi & search SERVER-SIDE (katalog puluhan ribu aset).
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMyAssets(category || undefined, debouncedSearch.trim() || undefined)

  const items = React.useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  )
  const total = data?.pages[0]?.total ?? 0
  const visibleItems = items

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b p-4">
        <h2 className="text-sm font-semibold">My Library</h2>
        <p className="text-xs text-muted-foreground">Model 3D yang sudah diupload</p>
      </div>

      {/* Filters */}
      <div className="space-y-3 border-b p-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => (
            <Badge
              key={cat.value}
              variant={category === cat.value ? "default" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Asset list — min-h-0 wajib agar flex-1 benar-benar membatasi tinggi
          (tanpa ini daftar tumbuh melebihi sheet dan scroll internal mati). */}
      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-xs text-muted-foreground">Memuat...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Filter className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Belum ada model</p>
            <p className="text-xs text-muted-foreground">
              Upload model 3D dari placeholder furniture di editor interior.
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {visibleItems.map((item) => {
              const status = STATUS_MAP[item.status] ?? { label: item.status, variant: "outline" as const }
              return (
                <Card
                  key={item.id}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/50",
                    selectedAssetId === item.id && "border-primary bg-primary/5"
                  )}
                  onClick={() => onSelect?.(item)}
                >
                  <CardContent className="flex items-start gap-3 p-3">
                    {/* 3D model preview (viewport-gated Canvas; kecil + berputar) */}
                    <div className="size-16 shrink-0">
                      {item.modelUrl ? (
                        <AssetModelPreview
                          url={item.modelUrl}
                          widthM={item.widthM}
                          depthM={item.depthM}
                          heightM={item.heightM}
                          spin={false}
                          className="flex size-16 items-center justify-center overflow-hidden rounded-md border bg-muted/40"
                        />
                      ) : item.thumbnailUrl ? (
                        <Image
                          src={item.thumbnailUrl}
                          alt={item.name}
                          width={64}
                          height={64}
                          unoptimized
                          className="size-full rounded-md object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                          {item.category === "tv"
                            ? "TV"
                            : item.category === "sofa"
                              ? "SF"
                              : item.category === "building_reference"
                                ? "BG"
                                : "MD"}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {item.category}
                        </Badge>
                        <Badge variant={status.variant} className="text-[10px]">
                          {status.label}
                        </Badge>
                      </div>
                      {item.widthM != null && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {item.widthM}×{item.depthM}×{item.heightM}m
                        </p>
                      )}
                      {item.priceIDR != null && item.priceIDR > 0 && (
                        <p className="mt-0.5 text-[11px] font-medium tabular-nums">
                          {formatIDRCompact(item.priceIDR)}
                        </p>
                      )}
                      {item.sourceName && (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {item.sourceName}
                        </p>
                      )}
                    </div>

                    {item.status === "ready" && (
                      <CheckCircle2 className="mt-1 size-4 shrink-0 text-green-500" />
                    )}
                    {item.status === "failed" && (
                      <AlertTriangle className="mt-1 size-4 shrink-0 text-destructive" />
                    )}
                  </CardContent>
                </Card>
              )
            })}
            {hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage
                  ? "Memuat…"
                  : `Muat lebih banyak (${total - items.length} lagi)`}
              </Button>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 border-t p-3">
        <p className="text-center text-[11px] text-muted-foreground">
          {items.length === total
            ? `${total} model`
            : `${items.length} dari ${total} model`}
        </p>
      </div>
    </div>
  )
}
