"use client"

import * as React from "react"

/**
 * Breakpoint `lg` Tailwind (1024px). Layar lebih sempit dari ini (tablet &
 * mobile) dianggap "narrow" → toolbar kolom menciutkan kontrol sekunder ke
 * tombol More (⋯), konsisten dengan drawer mobile (`lg:hidden`).
 */
const LG_BREAKPOINT_PX = 1024

/**
 * True saat viewport lebih sempit dari breakpoint `lg` (1024px).
 * Berbasis lebar (bukan tinggi) karena viewport tablet itu tinggi — ambang
 * tinggi gagal memicu mode kompak di pengguna nyata. SSR-safe (layout effect),
 * responsive terhadap resize. Deterministik di test: jsdom innerWidth = 1024
 * ⇒ lg ⇒ false (kontrol inline tetap tampil).
 */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = React.useState(false)
  React.useLayoutEffect(() => {
    if (typeof window === "undefined") return
    const update = () => setNarrow(window.innerWidth < LG_BREAKPOINT_PX)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return narrow
}
