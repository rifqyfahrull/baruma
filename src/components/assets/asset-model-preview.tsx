"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Box } from "lucide-react"

import { isWebGLAvailable } from "@/lib/three/webgl-support"

// three/@react-three hanya dimuat saat ada kartu dengan model GLB yang benar-
// benar terlihat di viewport — wrapper ini sendiri bebas dependensi 3D supaya
// editor 2D & asset library tidak menanggung ~1 MB three di bundle awal.
const AssetPreviewCanvas = dynamic(
  () => import("./asset-preview-canvas").then((m) => m.AssetPreviewCanvas),
  { ssr: false, loading: () => <Box className="size-8 text-muted-foreground" /> }
)

/**
 * Rotating 3D preview of a stored GLB asset for the Asset Library cards.
 *
 * The Canvas mounts ONLY while the card is near the viewport (IntersectionObserver)
 * and unmounts when scrolled away — browsers cap concurrent WebGL contexts at
 * ~8–16, and the library renders dozens of cards; without this gate the later
 * canvases would silently fail with context-loss. Off-screen (or model-less)
 * cards show the old static box icon.
 */
export function AssetModelPreview({
  url,
  thumbnailUrl,
  widthM,
  depthM,
  heightM,
  className,
  spin = true,
}: {
  url?: string
  /** Thumbnail WebP pra-render (PRD §17). Bila ada, ditampilkan sebagai <img>
   *  (murah) alih-alih render GLB WebGL — penting untuk katalog puluhan ribu.
   *  Fallback ke render GLB live bila absen. */
  thumbnailUrl?: string
  widthM?: number
  depthM?: number
  heightM?: number
  /** Override tile sizing (default `h-28` full-width card tile). */
  className?: string
  /**
   * false = frame STATIS (frameloop "demand", tanpa autoRotate) — untuk daftar
   * panjang seperti picker My Library: N kanvas berputar terus membebani GPU
   * dan bersaing dengan canvas 3D utama. Default true (kartu library besar).
   */
  spin?: boolean
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "120px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const dims = {
    w: widthM && widthM > 0 ? widthM : 1,
    d: depthM && depthM > 0 ? depthM : 1,
    h: heightM && heightM > 0 ? heightM : 1,
  }

  return (
    <div
      ref={ref}
      data-testid="asset-model-preview"
      className={className ?? "flex h-28 items-center justify-center overflow-hidden rounded-md border bg-muted/40"}
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt="Preview asset"
          loading="lazy"
          className="h-full w-full object-contain"
        />
      ) : url && visible && isWebGLAvailable() ? (
        <AssetPreviewCanvas url={url} dims={dims} spin={spin} />
      ) : (
        <Box className="size-8 text-muted-foreground" />
      )}
    </div>
  )
}
