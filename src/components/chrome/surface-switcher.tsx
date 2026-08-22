"use client"

/**
 * `SurfaceSwitcher` — segmented [2D|3D] kecil dipakai bersama oleh kedua pill
 * bar lantai (`editor/floor-switcher.tsx` & `preview-3d/floor-toggle-bar.tsx`).
 * Permukaan aktif diturunkan dari `usePathname()` (bukan store) supaya selalu
 * sinkron dengan URL — termasuk lewat navigasi back/forward browser. Komponen
 * ini sengaja "bodoh": tidak tahu apa pun soal store editor/preview, hanya
 * navigasi antar rute proyek.
 */

import * as React from "react"
import { useParams, usePathname, useRouter } from "next/navigation"

import { Pill } from "@/components/chrome/pill"

export type SurfaceSwitcherProps = {
  /** Opsional — bila tidak diberikan, diturunkan dari param rute `[projectId]`. */
  projectId?: string
}

type Surface = "2d" | "3d"

function surfaceFromPathname(pathname: string | null): Surface {
  return pathname?.includes("/preview-3d") ? "3d" : "2d"
}

export function SurfaceSwitcher({ projectId: projectIdProp }: SurfaceSwitcherProps) {
  const pathname = usePathname()
  const router = useRouter()
  const params = useParams<{ projectId?: string | string[] }>()
  const paramProjectId = Array.isArray(params?.projectId)
    ? params.projectId[0]
    : params?.projectId
  const projectId = projectIdProp ?? paramProjectId

  // Tanpa projectId (mis. pratinjau denah template publik) tidak ada rute
  // proyek untuk dituju — jangan render kontrol yang tak bisa apa-apa.
  if (!projectId) return null

  const surface = surfaceFromPathname(pathname)

  const go = (target: Surface) => {
    if (target === surface) return
    router.push(
      target === "2d"
        ? `/app/projects/${projectId}/editor`
        : `/app/projects/${projectId}/preview-3d`,
    )
  }

  return (
    <div data-testid="surface-switcher" className="flex items-center gap-1">
      <Pill
        data-testid="surface-switcher-2d"
        pressed={surface === "2d"}
        exclusive
        label="Buka editor 2D"
        onClick={() => go("2d")}
      >
        2D
      </Pill>
      <Pill
        data-testid="surface-switcher-3d"
        pressed={surface === "3d"}
        exclusive
        label="Buka preview 3D"
        onClick={() => go("3d")}
      >
        3D
      </Pill>
    </div>
  )
}
