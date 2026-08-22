"use client"

/**
 * Mode fokus (Fase 5 — rename & unifikasi dari `preview-store.cleanMode`,
 * dulu toggle 3D-only "mode bersih"). Dipakai BERSAMA oleh kedua permukaan
 * (rail 2D `editor-toolbar.tsx`, rail 3D `view-toolbar.tsx`, `ProjectBar`,
 * dan badan halaman 3D `preview-3d-view.tsx`) — satu hook, satu state
 * (`ui-store.fokusMode`), sama seperti kontrak rail Fase 4.
 *
 * Efek yang di-port dari `preview-3d-view.tsx` (dulu lokal 3D-only):
 * 1. Sinkron sidebar kiri — tutup saat masuk fokus, buka saat keluar
 *    (di-skip di run pertama supaya preferensi sidebar user tak dipaksa
 *    saat mount biasa; mobile diabaikan karena sidebar sudah overlay).
 * 2. Reset saat unmount — pindah halaman ketika fokus aktif memulihkan
 *    ProjectBar/sidebar, bukan membiarkan fokus "bocor" ke halaman lain.
 *
 * Baru di Fase 5 — keluar via Escape: TIDAK memasang capture-phase atau
 * mengoordinasikan urutan listener dengan handler Escape milik halaman
 * (mis. batal pending placement di 2D, clearSelection di 3D). Alih-alih,
 * pengecekan `event.defaultPrevented` DITUNDA satu tick lewat
 * `setTimeout(…, 0)`: semua listener keydown SINKRON lain (termasuk yang
 * didaftarkan setelah listener ini) selalu selesai dulu — jadi handler
 * halaman yang membatalkan sesuatu (dan memanggil `preventDefault()`)
 * SELALU sempat menang, terlepas dari urutan pendaftaran listener. Escape
 * "kosong" (tak ada yang dibatalkan) baru keluar dari fokus. Diabaikan saat
 * fokus keyboard ada di field teks/kontenteditable atau ada dialog terbuka
 * (mis. AlertDialog `useConfirm`) — Escape di situ milik dialog itu.
 */

import * as React from "react"

import { useUIStore } from "@/stores/ui-store"
import { useSidebar } from "@/components/ui/sidebar"

export function useFokusMode(): { fokusMode: boolean; toggle: () => void } {
  const fokusMode = useUIStore((s) => s.fokusMode)
  const setFokusMode = useUIStore((s) => s.setFokusMode)
  const { setOpen: setSidebarOpen, isMobile: sidebarIsMobile } = useSidebar()

  const initRef = React.useRef(false)
  const setSidebarOpenRef = React.useRef(setSidebarOpen)
  React.useEffect(() => {
    setSidebarOpenRef.current = setSidebarOpen
  }, [setSidebarOpen])

  // Sinkron sidebar — skip run pertama (lihat komentar di atas).
  React.useEffect(() => {
    if (!initRef.current) {
      initRef.current = true
      if (!fokusMode) return
    }
    if (!sidebarIsMobile) setSidebarOpenRef.current(!fokusMode)
  }, [fokusMode, sidebarIsMobile])

  // Keluar halaman saat fokus aktif → pulihkan ProjectBar/sidebar.
  React.useEffect(
    () => () => {
      if (useUIStore.getState().fokusMode) {
        useUIStore.getState().setFokusMode(false)
        setSidebarOpenRef.current(true)
      }
    },
    []
  )

  // Escape keluar dari fokus — lihat catatan penundaan di komentar atas.
  React.useEffect(() => {
    if (!fokusMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return
      window.setTimeout(() => {
        if (e.defaultPrevented) return
        if (document.querySelector('[role="dialog"]')) return
        if (useUIStore.getState().fokusMode) useUIStore.getState().setFokusMode(false)
      }, 0)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fokusMode])

  const toggle = React.useCallback(() => {
    setFokusMode(!useUIStore.getState().fokusMode)
  }, [setFokusMode])

  return { fokusMode, toggle }
}
