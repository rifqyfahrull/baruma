/**
 * Katalog cladding fasad — material MUKA LUAR dinding, dipilih per dinding
 * (klik dinding di preview 3D). Terpisah dari material interior ruang: satu
 * dinding bisa bata ekspos di luar dan cat polos di dalam, seperti praktik
 * arsitektur nyata (referensi: fasad modern batu alam + kayu + marmer).
 *
 * `visual` memakai MaterialVisualOverride yang sama dengan sistem material
 * interior — foto tekstur dari bank asset (/textures/tex-*.jpg, warna
 * near-white agar foto tidak tertutup tint) atau warna solid + roughness
 * untuk batu/beton yang belum punya foto.
 */
import type { MaterialVisualOverride } from "@/lib/three/surface"

export type FacadeCladding = {
  id: string
  label: string
  /** Warna chip di UI picker (mewakili tampilan material). */
  swatch: string
  visual: MaterialVisualOverride
}

export const FACADE_CLADDINGS: FacadeCladding[] = [
  {
    id: "batu_alam_gelap",
    label: "Batu alam gelap",
    swatch: "#3b3f41",
    visual: { color: "#3b3f41", texture: null, roughness: 0.95, metalness: 0 },
  },
  {
    id: "batu_andesit",
    label: "Batu andesit",
    swatch: "#6b6f6d",
    visual: { color: "#6b6f6d", texture: null, roughness: 0.9, metalness: 0 },
  },
  {
    id: "marmer_krem",
    label: "Marmer krem",
    swatch: "#e6ddc9",
    visual: { color: "#f5f0e6", mapUrl: "/textures/tex-marmer-travertine.jpg", mapRepeat: 2, roughness: 0.3, metalness: 0.05 },
  },
  {
    id: "marmer_carrara",
    label: "Marmer carrara",
    swatch: "#e9e9e7",
    visual: { color: "#f7f7f5", mapUrl: "/textures/tex-marmer-carrara.jpg", mapRepeat: 2, roughness: 0.22, metalness: 0.05 },
  },
  {
    id: "granit_hitam",
    label: "Granit hitam",
    swatch: "#23262a",
    visual: { color: "#23262a", texture: null, roughness: 0.35, metalness: 0.1 },
  },
  {
    id: "beton_ekspos",
    label: "Beton ekspos",
    swatch: "#b5b4ae",
    visual: { color: "#b5b4ae", texture: null, roughness: 0.92, metalness: 0 },
  },
  {
    id: "kayu_cladding",
    label: "Kayu cladding",
    swatch: "#8a5f3c",
    visual: { color: "#f2e9df", mapUrl: "/textures/tex-kayu-rosewood.jpg", mapRepeat: 3, roughness: 0.7 },
  },
  {
    id: "kayu_alder",
    label: "Kayu alder",
    swatch: "#b58a5e",
    visual: { color: "#f5efe6", mapUrl: "/textures/tex-kayu-alder.jpg", mapRepeat: 3, roughness: 0.7 },
  },
  {
    id: "kayu_terang",
    label: "Kayu terang",
    swatch: "#c9a878",
    visual: { color: "#f5efe6", mapUrl: "/textures/tex-kayu-hetre.jpg", mapRepeat: 3, roughness: 0.7 },
  },
  {
    id: "bata_ekspos",
    label: "Bata ekspos",
    swatch: "#9e5540",
    visual: { color: "#f3ece6", mapUrl: "/textures/tex-bata-merah.jpg", mapRepeat: 3, roughness: 0.85 },
  },
  {
    id: "bata_putih",
    label: "Bata putih",
    swatch: "#e8e4dd",
    visual: { color: "#f7f4ef", mapUrl: "/textures/tex-bata-putih.jpg", mapRepeat: 3, roughness: 0.85 },
  },
  {
    // Taman vertikal / green wall — bidang dinding hijau (ref: fasad tropis
    // dengan green wall). Warna-only (tanpa tekstur) agar tak butuh aset baru;
    // roughness tinggi + sedikit variasi hijau daun.
    id: "taman_vertikal",
    label: "Taman vertikal (green wall)",
    swatch: "#4f7a3a",
    visual: { color: "#4f7a3a", texture: null, roughness: 0.95, metalness: 0 },
  },
]

export function facadeCladdingById(id: string | undefined | null): FacadeCladding | null {
  if (!id) return null
  return FACADE_CLADDINGS.find((c) => c.id === id) ?? null
}
