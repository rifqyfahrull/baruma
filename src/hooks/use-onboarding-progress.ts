"use client"

/**
 * Progres onboarding ringan (WS-E §2) — dipakai oleh
 * `src/components/dashboard/onboarding-checklist.tsx` untuk menentukan 2 dari
 * 4 langkahnya yang TIDAK punya sinyal langsung dari data server: "Lihat
 * preview 3D" dan "Cek estimasi RAB" adalah kunjungan halaman, bukan state
 * project (2 langkah lain — "Buat project pertama" dan "Pilih alternatif
 * layout" — diturunkan langsung dari `useProjects()` di komponen checklist,
 * lihat `project.length > 0` dan `currentVersionId` di sana).
 *
 * Pola: satu hook kecil MEMILIKI localStorage read/write, dipanggil dari DUA
 * tempat terpisah:
 * 1. `markOnboardingSeen("preview3d" | "rab")` — satu baris `useEffect` di
 *    halaman preview-3d/rab (file yang sudah disentuh banyak workstream lain,
 *    jadi sengaja dibuat sesempit mungkin di sana).
 * 2. `useOnboardingSeen()` / `useOnboardingDismissed()` — dibaca reaktif oleh
 *    komponen checklist di dashboard.
 *
 * localStorage TIDAK memicu event "storage" di tab yang sama menulisnya —
 * cukup di sini karena checklist mount ulang tiap kali dashboard dibuka
 * (navigasi dari halaman preview-3d/rab balik ke dashboard = mount baru).
 */

import * as React from "react"

export type OnboardingMilestone = "preview3d" | "rab"

const SEEN_KEY = "baruma:onboarding:seen"
const DISMISSED_KEY = "baruma:onboarding:dismissed"

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage tak tersedia (privat/quota) — checklist tetap render,
    // hanya progresnya tidak persisten. Bukan kegagalan fatal.
  }
}

function readSeen(): Set<OnboardingMilestone> {
  const raw = safeGet(SEEN_KEY)
  if (!raw) return new Set()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((v): v is OnboardingMilestone => v === "preview3d" || v === "rab")
    )
  } catch {
    return new Set()
  }
}

/** Tandai satu milestone sudah dilihat. Aman dipanggil di server (no-op),
 *  idempotent, dan tidak butuh state React di lokasi pemanggilan — pas untuk
 *  satu baris `useEffect(() => markOnboardingSeen("preview3d"), [])`. */
export function markOnboardingSeen(milestone: OnboardingMilestone): void {
  const seen = readSeen()
  if (seen.has(milestone)) return
  seen.add(milestone)
  safeSet(SEEN_KEY, JSON.stringify([...seen]))
}

/** Dibaca sekali saat mount oleh komponen checklist — lihat catatan di atas
 *  soal kenapa storage-event listener tidak diperlukan di sini. */
export function useOnboardingSeen(): Set<OnboardingMilestone> {
  const [seen] = React.useState<Set<OnboardingMilestone>>(() => readSeen())
  return seen
}

/** Status dismiss checklist (tombol tutup) — persist di localStorage. */
export function useOnboardingDismissed(): [boolean, () => void] {
  const [dismissed, setDismissed] = React.useState(() => safeGet(DISMISSED_KEY) === "1")

  const dismiss = React.useCallback(() => {
    safeSet(DISMISSED_KEY, "1")
    setDismissed(true)
  }, [])

  return [dismissed, dismiss]
}
