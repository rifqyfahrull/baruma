/**
 * Arah mata angin untuk kompas UI.
 *
 * Konvensi dunia (selaras solar.ts): utara = −z, timur = +x, selatan = +z,
 * barat = −x. Denah 2D dipetakan plan-y → dunia-z (house-model: z = y − cz),
 * sehingga ATAS kanvas 2D = utara — kompas 2D statis (rotasi 0).
 *
 * Kompas 3D berputar mengikuti azimut kamera: saat kamera tepat di selatan
 * (+z) menghadap origin, utara berada "lurus ke depan" di layar → jarum U
 * menunjuk ke atas (rotasi 0). Rotasi CSS positif = searah jarum jam, sama
 * dengan theta OrbitControls (atan2(x, z) dari target) — dibuktikan di test.
 */

/** Rotasi jarum kompas (derajat, CW) dari posisi kamera relatif target orbit.
 *  dx/dz = camera.position − target pada bidang xz. */
export function cameraAzimuthDeg(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0
  return (Math.atan2(dx, dz) * 180) / Math.PI
}
