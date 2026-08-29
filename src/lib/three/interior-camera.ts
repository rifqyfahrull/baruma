/**
 * Helper MURNI utk pose kamera interior AI-render/preview (Fase C —
 * `docs/superpowers/specs/2026-08-29-ai-render-split-level-mezzanine-design.md`
 * §camera-rig.tsx). Formula dipindah UTUH dari efek `interiorViewNonce` di
 * `src/components/preview-3d/camera-rig.tsx` (Fase B) lalu diperkaya dgn
 * kesadaran `Room.levelOffsetM` (split-level) dan clamp plafon rendah
 * (mezzanine) — tanpa import three.js di level modul (lihat gaya
 * `render-capture.ts`) supaya bisa diunit-test tanpa jsdom/WebGL.
 */

import type { FloorElevation } from "@/lib/geometry/vertical"
import { SLAB_T, WALL_H } from "@/lib/geometry/vertical"

import type { Room } from "@/types"

/** Jarak antar-lantai di mode exploded-view (m). SUMBER: `EXPLODE_GAP` di
 *  `src/lib/three/build-model.ts` — disalin (bukan diimpor) supaya modul ini
 *  tetap bebas dari rantai import three.js (`build-model.ts` menyeret
 *  `exterior-primitives`, `pool`, `facade-bands`, dll). Jaga nilai ini sama
 *  dgn sumbernya bila diubah. */
const EXPLODE_GAP = 2.6

export type InteriorCameraPose = {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * Pose kamera "berdiri di dalam ruang" — mata di dekat satu sudut (35% dari
 * pusat ke sudut, half-diagonal) melihat ke pusat ruang. Split-level
 * (`room.levelOffsetM`) menggeser platform; plafon rendah (mezzanine,
 * `elev.wallHM`) meng-clamp tinggi mata agar tak menembus plafon.
 *
 * @param room ruang target (koordinat lokal lantai: x/y/width/depth).
 * @param elev entri `floorElevations` utk `room.floorId` — absen (lantai tak
 *   dikenal, defensif) → baseY 0, wallHM fallback `WALL_H`.
 * @param site dimensi lot (m) — utk konversi koordinat lokal → world (offset
 *   pusat site, konvensi sama dgn `house-model.tsx`/`camera-rig.tsx`).
 * @param exploded true → geser vertikal sebesar `index × EXPLODE_GAP`
 *   (mode "meledak" preview 3D) diterapkan ke posisi DAN target.
 */
export function interiorCameraPose(
  room: Room,
  elev: FloorElevation | undefined,
  site: { widthM: number; depthM: number },
  exploded: boolean
): InteriorCameraPose {
  const baseY = elev ? elev.baseY + elev.index * (exploded ? EXPLODE_GAP : 0) : 0
  const cx = room.x + room.width / 2 - site.widthM / 2
  const cz = room.y + room.depth / 2 - site.depthM / 2
  // Half-diagonal vector of the room's rectangle — camera sits near one
  // corner (35% of the way from center) so it looks across the room instead
  // of straight into a wall.
  const dx = room.width / 2
  const dz = room.depth / 2

  const platformY = baseY + SLAB_T + (room.levelOffsetM ?? 0)
  // Lantai rooftop punya wallHM 0 (bukan undefined) — ruang terbuka
  // (rooftop_lounge) tetap difoto eye-level normal, bukan 0.8 m (temuan I1
  // final review MEZZ). ≤0 → fallback WALL_H, konsisten dgn analyze-room.
  const wallHM = elev !== undefined && elev.wallHM > 0 ? elev.wallHM : WALL_H
  // Clamp plafon: 1.5 m di atas platform secara normal, tapi tak lebih tinggi
  // dari (tinggi dinding − 0.3 m) utk mezzanine rendah; lantai 0.8 m di atas
  // platform (deterministik) supaya wallHM sangat kecil tak menghasilkan mata
  // negatif/absurd relatif platform.
  const eyeOffset = Math.max(0.8, Math.min(1.5, wallHM - 0.3))
  const targetOffset = Math.min(1.3, eyeOffset - 0.1)

  return {
    position: [cx - dx * 0.35, platformY + eyeOffset, cz - dz * 0.35],
    target: [cx, platformY + targetOffset, cz],
  }
}
