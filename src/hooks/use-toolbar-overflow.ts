"use client"

import * as React from "react"

// Jarak aman ke tepi bawah viewport.
const BOTTOM_GUTTER_PX = 16

/**
 * True saat konten toolbar (diukur langsung dari DOM via `ref`) SECARA NYATA
 * melebihi tinggi viewport yang tersisa di bawah posisi toolbar. Berbeda dari
 * breakpoint lebar tetap (`useNarrowViewport`): ini mengukur node asli lewat
 * `ResizeObserver`, jadi otomatis tetap benar saat toolbar bertambah panjang
 * (mis. tombol baru ditambahkan) tanpa perlu menghitung ulang konstanta
 * piksel manual — sumber bug sebelumnya (toolbar meluber di desktop lebar
 * tapi window pendek, karena compact hanya dipicu oleh lebar sempit).
 *
 * Histeresis: begitu compact aktif, cabang "expanded" tak lagi dirender
 * sehingga tak bisa diukur ulang langsung — tinggi penuh terakhir yang
 * terukur disimpan di ref dan dipakai untuk menentukan kapan boleh kembali
 * non-compact (mencegah toggle bolak-balik).
 *
 * `forceCompact`: saat true (mis. dari `useNarrowViewport`), DOM sudah
 * diciutkan oleh alasan LAIN — pengukuran di-skip agar ukuran "compact" itu
 * tidak keliru tersimpan sebagai baseline "expanded".
 */
export function useToolbarOverflow(
  ref: React.RefObject<HTMLElement | null>,
  forceCompact: boolean
): boolean {
  const [heightCompact, setHeightCompact] = React.useState(false)
  const expandedHeightRef = React.useRef(0)

  React.useLayoutEffect(() => {
    if (typeof window === "undefined") return
    const el = ref.current
    if (!el) return

    const measure = () => {
      if (forceCompact) return
      const node = ref.current
      if (!node) return
      const available =
        window.innerHeight - node.getBoundingClientRect().top - BOTTOM_GUTTER_PX
      setHeightCompact((prev) => {
        if (!prev) {
          expandedHeightRef.current = node.scrollHeight
          return node.scrollHeight > available
        }
        return expandedHeightRef.current > available
      })
    }

    measure()
    window.addEventListener("resize", measure)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => {
      window.removeEventListener("resize", measure)
      ro?.disconnect()
    }
  }, [ref, forceCompact])

  return heightCompact
}
