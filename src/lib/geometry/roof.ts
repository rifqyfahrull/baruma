/**
 * Pembaca `layout.roof` defensif — SATU sumber kebenaran untuk 3D
 * (build-model.ts), gambar kerja (elevation/section/roof-detail), dan RAB.
 * Murni data: tanpa three.js, tanpa store — aman diimpor dari mana saja.
 *
 * API simpan mempersistkan parameter atap TANPA validasi zod, jadi nilai
 * korup/di luar rentang tidak boleh merusak matematika `tan()` hilir.
 * Konvensi clamp (paritas Global Constraints SP3):
 *   - slopeDeg  → [15, 40]; khusus "miring" (skillion, lazim landai) min 5°.
 *   - overhangM → [0, 1].
 *   - lowSide   → default "s".
 *   - fascia    → heightM di-clamp [0.1, 0.8]; color non-string → "#3c4245".
 */
import type { DesignLayout, RoofSpec } from "@/types"
import { clamp } from "@/lib/geometry"

/**
 * Default atap datar — cermin `DEFAULT_ROOF` di `src/stores/editor-store.ts`.
 * Diduplikasi (bukan diimpor) karena modul store menarik zustand; jaga kedua
 * literal tetap sinkron secara manual.
 */
export const DATAR_DEFAULTS: RoofSpec = {
  type: "datar",
  slopeDeg: 30,
  overhangM: 0.5,
  material: "genteng_beton",
}

export function effectiveRoof(layout: DesignLayout): RoofSpec {
  const r = layout.roof
  const type = r?.type ?? DATAR_DEFAULTS.type
  return {
    type,
    // Skillion (miring) lazim landai (5–15°) — izinkan min 5°; tipe lain tetap [15,40].
    slopeDeg: clamp(r?.slopeDeg ?? DATAR_DEFAULTS.slopeDeg, type === "miring" ? 5 : 15, 40),
    overhangM: clamp(r?.overhangM ?? DATAR_DEFAULTS.overhangM, 0, 1),
    material: r?.material ?? DATAR_DEFAULTS.material,
    lowSide: r?.lowSide ?? "s",
    ...(r?.fascia
      ? {
          fascia: {
            heightM: clamp(r.fascia.heightM ?? 0.35, 0.1, 0.8),
            color: typeof r.fascia.color === "string" ? r.fascia.color : "#3c4245",
          },
        }
      : {}),
    // W1: gable asimetris & sopi-sopi hanya bermakna utk pelana — diteruskan
    // apa adanya (clamp per-bentang dilakukan konsumen geometri); tanpa ini
    // normalisasi diam-diam membuang keduanya di jalur atap global.
    ...(type === "pelana" && r?.ridgeOffsetM
      ? { ridgeOffsetM: r.ridgeOffsetM }
      : {}),
    ...(type === "pelana" && r?.gableEnds && Object.keys(r.gableEnds).length > 0
      ? { gableEnds: { ...r.gableEnds } }
      : {}),
  }
}
