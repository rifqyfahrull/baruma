"use client"

import * as React from "react"
import Link from "next/link"
import { Database, ExternalLink, Filter, Library, Search, Upload } from "lucide-react"

import { useMyAssets } from "@/lib/api/hooks"
import { AssetModelPreview } from "@/components/assets/asset-model-preview"
import { AssetDetailDialog, type AssetDetail } from "@/components/assets/asset-detail-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const CATEGORIES = [
  { value: "", label: "Semua" },
  // Arsitektur / eksterior (katalog Objaverse)
  { value: "facade", label: "Fasad" },
  { value: "gate", label: "Gerbang" },
  { value: "fence", label: "Pagar" },
  { value: "door", label: "Pintu" },
  { value: "window", label: "Jendela" },
  { value: "arch_element", label: "Elemen Arsitektur" },
  // Interior / furnitur
  { value: "kitchen", label: "Dapur" },
  { value: "sofa", label: "Sofa" },
  { value: "coffee_table", label: "Meja" },
  { value: "bedroom", label: "Kamar Tidur" },
  { value: "sanitary", label: "Sanitair" },
  { value: "lighting", label: "Lampu" },
  { value: "decor", label: "Dekorasi" },
  // Lain-lain
  { value: "building_reference", label: "Bangunan" },
  { value: "tv", label: "TV" },
  { value: "generic", label: "Lainnya" },
]

const STATUS_LABEL: Record<string, string> = {
  ready: "Siap",
  uploaded: "Diupload",
  validating: "Validasi",
  needs_scale: "Butuh ukuran",
  needs_metadata: "Butuh data",
  attached: "Terpasang",
  failed: "Gagal",
  rejected: "Ditolak",
}

function formatBytes(bytes?: number) {
  if (!bytes) return "-"
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function AssetLibraryPage() {
  const [category, setCategory] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [detailAsset, setDetailAsset] = React.useState<AssetDetail | null>(null)

  // Debounce pencarian: tiap ketikan JANGAN langsung memicu fetch — dan kartu
  // yang keluar/masuk hasil me-mount/unmount <Canvas> preview (konteks WebGL),
  // mahal. Satu fetch per jeda ketik.
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // Paginasi & search SERVER-SIDE (katalog puluhan ribu aset). useInfiniteQuery
  // memuat per-halaman; "Muat lebih banyak" fetch halaman berikutnya.
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMyAssets(category || undefined, debouncedSearch.trim() || undefined)

  const items = React.useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  )
  const total = data?.pages[0]?.total ?? 0

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Asset Library"
        description="Koleksi model 3D yang tersimpan di storage dan siap dipakai di proyek Baruma."
        actions={
          <Button asChild>
            <Link href="/app/guides/furnimesh">
              <Upload />
              Panduan Upload
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>
              {category || debouncedSearch.trim() ? "Asset cocok filter" : "Total asset"}
            </CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl tabular-nums">
              <Library className="size-6 text-primary" />
              {isLoading ? <Skeleton className="h-8 w-12" /> : total.toLocaleString("id-ID")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sedang ditampilkan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl tabular-nums">
              <Database className="size-6 text-primary" />
              {isLoading ? <Skeleton className="h-8 w-12" /> : items.length.toLocaleString("id-ID")}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari asset, kategori, atau sumber..."
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((item) => (
              <Button
                key={item.value || "all"}
                type="button"
                variant={category === item.value ? "default" : "outline"}
                size="sm"
                onClick={() => setCategory(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Filter className="size-10 text-muted-foreground" />
            <div>
              <h2 className="font-semibold">Belum ada asset yang cocok</h2>
              <p className="text-sm text-muted-foreground">
                Ubah filter atau impor model 3D ke storage.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{item.name}</CardTitle>
                    <CardDescription className="truncate">
                      {item.sourceName ?? item.category}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={item.status === "ready" ? "default" : "secondary"}
                    className={cn(item.status === "failed" && "bg-destructive text-destructive-foreground")}
                  >
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <button
                  type="button"
                  onClick={() => setDetailAsset(item)}
                  className="block w-full cursor-zoom-in rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Lihat detail ${item.name}`}
                >
                  <AssetModelPreview
                    url={item.modelUrl}
                    thumbnailUrl={item.thumbnailUrl}
                    widthM={item.widthM}
                    depthM={item.depthM}
                    heightM={item.heightM}
                    spin={false}
                  />
                </button>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Kategori</p>
                    <p className="truncate font-medium">{item.category}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ukuran file</p>
                    <p className="font-medium">{formatBytes(item.fileSizeBytes)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dimensi</p>
                    <p className="font-medium">
                      {item.widthM && item.depthM && item.heightM
                        ? `${item.widthM} x ${item.depthM} x ${item.heightM} m`
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Asset ID</p>
                    <p className="truncate font-mono text-xs">{item.id}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="flex-1"
                    onClick={() => setDetailAsset(item)}
                  >
                    <Search />
                    Lihat Detail
                  </Button>
                  {item.modelUrl && (
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <a href={item.modelUrl} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        Buka model
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage
              ? "Memuat…"
              : `Muat lebih banyak (${(total - items.length).toLocaleString("id-ID")} lagi)`}
          </Button>
        </div>
      )}

      <AssetDetailDialog
        asset={detailAsset}
        statusLabel={detailAsset ? STATUS_LABEL[detailAsset.status] ?? detailAsset.status : undefined}
        onClose={() => setDetailAsset(null)}
        onRenamed={(id, name) =>
          setDetailAsset((cur) => (cur && cur.id === id ? { ...cur, name } : cur))
        }
      />
    </div>
  )
}
