import type { ExteriorElementKind, FacadeElement, FacadeElementKind } from "@/types";

/**
 * SATU kamus label elemen eksterior — dipakai 2D editor DAN 3D preview
 * (dulu dua kamus terpisah dengan string berbeda untuk kind yang sama:
 * "Tembok batas" vs "Dinding batas" — objek yang sama berganti nama saat
 * user pindah halaman; lihat docs/UNIFIKASI_UI_EDITOR.md §2.1).
 * Pemenang per-string dipilih dari varian yang paling deskriptif/lazim.
 */
export const EXTERIOR_KIND_LABELS: Record<ExteriorElementKind, string> = {
  boundary_wall: "Tembok batas",
  fence: "Pagar",
  sliding_gate: "Gerbang geser",
  swing_gate: "Gerbang ayun",
  pedestrian_gate: "Pintu pejalan kaki",
  solid_wall: "Dinding bebas",
  facade_panel: "Panel fasad",
  column: "Kolom aksen",
  chimney: "Cerobong",
  beam: "Balok aksen",
  slab: "Slab bebas",
  canopy: "Kanopi",
  overhang_slab: "Pelat menjorok (overhang)",
  planter: "Planter",
  pergola: "Pergola",
  portal_frame: "Portal",
  gable_frame: "Bingkai gable",
  exterior_stair: "Tangga luar",
  driveway: "Driveway",
  walkway: "Walkway",
  terrace_surface: "Teras",
  garden_bed: "Taman / planting bed",
  asset: "Aset eksterior",
  plant: "Tanaman",
  tree: "Pohon",
  exterior_decor: "Dekor eksterior",
  vehicle: "Kendaraan",
};

/** @deprecated Alias kompat — pakai EXTERIOR_KIND_LABELS. Dihapus di fase P3 unifikasi. */
export const EDITOR_EXTERIOR_KIND_LABELS = EXTERIOR_KIND_LABELS;
/** @deprecated Alias kompat — pakai EXTERIOR_KIND_LABELS. Dihapus di fase P3 unifikasi. */
export const PREVIEW_EXTERIOR_KIND_LABELS = EXTERIOR_KIND_LABELS;

/**
 * Pemetaan kind elemen eksterior → kategori aset My Library (katalog Objaverse)
 * untuk mem-PRESET filter picker saat "Ganti model 3D" — mis. pilih pintu
 * gerbang → picker langsung menampilkan kategori "gate". null = tanpa preset
 * (tampilkan semua). Kategori memakai nilai kolom user_assets.category.
 */
export const EXTERIOR_KIND_ASSET_CATEGORY: Partial<Record<ExteriorElementKind, string>> = {
  sliding_gate: "gate",
  swing_gate: "gate",
  pedestrian_gate: "gate",
  boundary_wall: "fence",
  fence: "fence",
  portal_frame: "arch_element",
  gable_frame: "arch_element",
  canopy: "arch_element",
  overhang_slab: "arch_element",
  column: "arch_element",
  chimney: "arch_element",
  beam: "arch_element",
  facade_panel: "facade",
  exterior_stair: "arch_element",
  pergola: "arch_element",
  planter: "decor",
  exterior_decor: "decor",
};

/** Label kind `FacadeElement` bawaan (dipakai picker "Tambah" & fallback label kartu). */
export const FACADE_ELEMENT_KIND_LABELS: Record<FacadeElementKind, string> = {
  louver_band: "Louver (sirip vertikal)",
  slat_horizontal: "Slat horizontal",
  roster_screen: "Roster / krawangan",
};

/**
 * Label kartu inspector untuk satu `FacadeElement` — mendeteksi preset 1-klik
 * ("Panel sirip (fluted)" / "Nat beton / reveal line") dari `pattern`,
 * bukan dari `kind` mentah. Ketiganya (Louver bawaan, fluted, reveal line)
 * SAMA-SAMA `kind: "louver_band"` (lihat `addFlutedFacadePanel` &
 * `addRevealLineFacadePanel` di editor-store.ts) — tanpa deteksi ini kartu
 * SELALU menampilkan "Louver (sirip vertikal)" walau elemen dipasang lewat
 * preset lain. Fungsi murni: hanya baca `el`, tidak butuh host wall.
 */
export function facadeElementPresetLabel(el: Pick<FacadeElement, "kind" | "pattern" | "sillHeightM">): string {
  const p = el.pattern;
  if (p?.inset) return "Nat beton / reveal line";
  // Fluted: bilah rapat vertikal menutupi PENUH dari lantai (sillHeightM 0)
  // — signature numerik addFlutedFacadePanel (pitch 0.07 jauh lebih rapat
  // dari default manual 0.25).
  if (p?.orientation === "v" && (p.pitchM ?? Infinity) <= 0.1 && el.sillHeightM === 0) {
    return "Panel sirip (fluted)";
  }
  return FACADE_ELEMENT_KIND_LABELS[el.kind ?? "louver_band"];
}
