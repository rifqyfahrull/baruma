/**
 * Paket Foto Presentasi — definisi bidikan untuk render multi-sudut sekali klik.
 *
 * Murni data + helper (tanpa three.js / DOM) supaya bisa diuji. Orkestrasi
 * capture (mengubah state preview-store lalu memanggil captureFrame per bidikan)
 * ada di komponen `PhotoPackage`.
 */
import type { ViewPreset } from "@/stores/preview-store"

export type PhotoLighting = "siang" | "senja"

export type PhotoShot = {
  id: string
  label: string
  view: ViewPreset
  lighting: PhotoLighting
}

/**
 * Set bidikan standar: sudut iso & depan siang (untuk brosur/kontraktor),
 * satu suasana senja (nilai jual visual), dan tampak atas untuk gambaran
 * denah 3D. Cukup untuk paket presentasi klien tanpa membebani.
 */
export const PHOTO_SHOTS: PhotoShot[] = [
  { id: "iso-siang", label: "Perspektif — Siang", view: "iso", lighting: "siang" },
  { id: "depan-siang", label: "Tampak Depan — Siang", view: "front", lighting: "siang" },
  { id: "iso-senja", label: "Perspektif — Senja", view: "iso", lighting: "senja" },
  { id: "atas-siang", label: "Denah 3D (Atas) — Siang", view: "top", lighting: "siang" },
]

/** Slug nama proyek untuk nama file (huruf kecil, spasi → strip). */
export function slugifyProjectName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "proyek"
  )
}

/** Nama file PNG untuk satu bidikan. */
export function photoFilename(projectName: string, shotId: string): string {
  return `${slugifyProjectName(projectName)}-${shotId}.png`
}
