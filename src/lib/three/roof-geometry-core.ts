/**
 * Pure BufferGeometry builders for the three sloped roof PrimKinds
 * ("roof_gable" | "roof_hip" | "roof_skillion"). build-model.ts emits these as
 * plain box bounds `[width, rise, depth]` (Global Constraints: ridge runs along
 * the LONGER of width/depth); this module is the one place that interprets
 * those bounds as an actual sloped roof shape.
 *
 * Kept free of React/"use client" so both the r3f components
 * (src/components/preview-3d/roof-geometry.tsx) and node-side consumers such as
 * the GLB exporter (src/lib/exports/glb.ts) can share the exact same geometry.
 */
import * as THREE from "three"

/** Reverses the winding of every triangle in a flat index list (a-b-c -> a-c-b). */
function reverseWinding(indices: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < indices.length; i += 3) {
    out.push(indices[i], indices[i + 2], indices[i + 1])
  }
  return out
}

/**
 * World-metres-per-UV-unit for the sloped-roof faces. The shared genteng
 * CanvasTexture (src/lib/three/textures.ts) already sets `texture.repeat = 4`,
 * which multiplies these UVs, so dividing world distances by 6 tiles the genteng
 * pattern ~once per 1.5 m of roof (6 = 1.5 m × the texture's 4× repeat). Result:
 * several tile courses across every face — isotropic (u/v share the divisor so
 * cells stay square) — instead of the flat UV(0,0) tint of a UV-less geometry.
 */
const ROOF_UV_DIVISOR = 6

/**
 * Planar UVs for a roof built from the canonical `[u, y, w]` layout (ridge along
 * the u axis, cross-slope along w, apex at y = +H / eave at y = -H). Maps u ->
 * distance along the ridge/eave and v -> distance UP the slope (so the genteng
 * courses run horizontally). Shares the vertex count/order of `position`, so it
 * attaches to the same indexed buffer without touching positions or normals.
 */
function planarRoofUVs(
  canonical: [number, number, number][],
  H: number,
  slopeLength: number,
): Float32Array {
  const uv = new Float32Array(canonical.length * 2)
  const denom = 2 * H // eave (y = -H) -> ridge (y = +H)
  canonical.forEach(([u, y], i) => {
    const frac = denom > 0 ? (y + H) / denom : 0 // 0 at the eave, 1 at the ridge
    uv[i * 2] = u / ROOF_UV_DIVISOR
    uv[i * 2 + 1] = (frac * slopeLength) / ROOF_UV_DIVISOR
  })
  return uv
}

/**
 * Triangular prism (pelana/gable roof): ridge is a full-length edge running
 * along the longer of width/depth, apex height = rise. 6 vertices — 2
 * triangular end caps + 3 rectangular sides (2 slopes + base), 8 faces.
 *
 * `ridgeOffset` (m, default 0 = simetris): menggeser bubungan dari tengah
 * sepanjang sumbu TEGAK-LURUS ridge (gable asimetris — dua kemiringan beda).
 * Positif = ke arah +x/+z dunia (sumbu w kanonik). Di-clamp aman < S.
 *
 * `openEnds` (default keduanya tertutup): membuka end-cap segitiga pada ujung
 * bubungan — dipakai saat ujung tsb diisi sopi-sopi (`wall_gable`), yang kalau
 * tidak akan tersembunyi di balik cap warna atap. `neg` = ujung sisi sumbu
 * negatif (w saat ridge along x, n saat along z), `pos` = kebalikannya.
 */
export function buildGableGeometry(
  width: number,
  rise: number,
  depth: number,
  ridgeOffset = 0,
  openEnds?: { neg?: boolean; pos?: boolean },
): THREE.BufferGeometry {
  const H = rise / 2
  const ridgeAlongX = width >= depth
  const L = (ridgeAlongX ? width : depth) / 2 // half-length along the ridge
  const S = (ridgeAlongX ? depth : width) / 2 // half-width across the slope
  // Bubungan tak boleh melewati tepi (degenerate): sisakan 0.05 m.
  const ro = Math.max(-(S - 0.05), Math.min(S - 0.05, ridgeOffset))

  // Canonical layout: ridge along the "u" axis, cross-slope along "w" axis.
  const canonical: [number, number, number][] = [
    [-L, -H, -S], // 0 base corner, ridge-end A
    [-L, -H, S], // 1 base corner, ridge-end A
    [-L, H, ro], // 2 apex, ridge-end A
    [L, -H, -S], // 3 base corner, ridge-end B
    [L, -H, S], // 4 base corner, ridge-end B
    [L, H, ro], // 5 apex, ridge-end B
  ]

  const positions = new Float32Array(canonical.length * 3)
  canonical.forEach(([u, y, w], i) => {
    // ridgeAlongX: u -> x, w -> z. Otherwise (ridge along z): w -> x, u -> z.
    positions[i * 3] = ridgeAlongX ? u : w
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = ridgeAlongX ? w : u
  })

  const baseIndices = [
    ...(openEnds?.neg ? [] : [0, 1, 2]), // end cap A (ujung -L)
    ...(openEnds?.pos ? [] : [3, 5, 4]), // end cap B (ujung +L)
    0, 3, 1, 3, 4, 1, // base
    0, 5, 3, 0, 2, 5, // slope, -S side
    1, 4, 5, 1, 5, 2, // slope, +S side
  ]
  // Swapping x/z axes is a reflection: reverse winding to keep normals outward.
  const indices = ridgeAlongX ? baseIndices : reverseWinding(baseIndices)

  // Slope run: rerata kedua sisi (vertex apex dipakai bersama oleh dua bidang;
  // saat ro=0 rerata = hypot(S, rise) persis — jalur lama byte-identik).
  const slopeLen = (Math.hypot(S + ro, rise) + Math.hypot(S - ro, rise)) / 2
  const uv = planarRoofUVs(canonical, H, slopeLen)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * SOPI-SOPI (gable-end infill wall): dinding pengisi antara puncak dinding
 * dan sisi bawah atap pelana pada UJUNG bubungan. Bentuk = poligon 5 titik
 * (trapesium+segitiga): dasar selebar bentang DINDING (tanpa tritisan), sisi
 * naik ke ketinggian atap di bidang dinding (≠0 saat overhang>0), lalu miring
 * ke apex (sadar ridgeOffset). Prisma tipis setebal `thickness`.
 *
 * Kanonik: penampang di bidang s–y (s = sumbu lintang kemiringan), tebal
 * sepanjang sumbu ridge. `ridgeAlongX` memetakan s→z & tebal→x (ridge di x),
 * atau s→x & tebal→z. Origin = tengah dasar (y=0 di puncak dinding).
 */
export function buildGableEndGeometry(
  span: number,
  rise: number,
  overhang: number,
  ridgeOffset: number,
  thickness: number,
  ridgeAlongX: boolean,
): THREE.BufferGeometry {
  const S = span / 2
  const Sp = S + Math.max(0, overhang)
  const ro = Math.max(-(S - 0.05), Math.min(S - 0.05, ridgeOffset))
  // Ketinggian atap pada bidang dinding (±S) — 0 saat tanpa tritisan.
  const hL = rise * ((Sp - S) / (Sp + ro))
  const hR = rise * ((Sp - S) / (Sp - ro))
  const t = thickness / 2

  // Penampang 5 titik, CCW dilihat dari +tebal.
  const profile: Array<[number, number]> = [
    [-S, 0],
    [S, 0],
    [S, hR],
    [ro, rise],
    [-S, hL],
  ]
  // Dua muka (±t) + dinding tepi. Fan-triangulasi dari titik 0 (konveks).
  const positions: number[] = []
  const push = (s: number, y: number, k: number) => {
    if (ridgeAlongX) positions.push(k, y, s)
    else positions.push(s, y, k)
  }
  for (const [s, y] of profile) push(s, y, t)
  for (const [s, y] of profile) push(s, y, -t)

  const idx: number[] = []
  // muka +t (0..4) CCW; muka −t (5..9) dibalik.
  for (let i = 1; i < 4; i++) idx.push(0, i, i + 1)
  for (let i = 1; i < 4; i++) idx.push(5, 5 + i + 1, 5 + i)
  // dinding tepi antar profil.
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5
    idx.push(i, 5 + i, 5 + j)
    idx.push(i, 5 + j, j)
  }
  // Pemetaan ridgeAlongX menukar sumbu (refleksi) → balik winding.
  const indices = ridgeAlongX ? reverseWinding(idx) : idx

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Hip roof (limasan): rectangular base, ridge segment along the longer
 * dimension shortened by half the shorter dimension at each end
 * (ridgeLen = long - short). Degenerates to a single apex point — a true
 * "limas" pyramid — when the footprint is square (long === short). 4 base
 * corners + 2 ridge points (6 vertex slots, 2 coincide when ridgeLen is 0), 8 faces.
 */
export function buildHipGeometry(width: number, rise: number, depth: number): THREE.BufferGeometry {
  const H = rise / 2
  const ridgeAlongX = width >= depth
  const L = (ridgeAlongX ? width : depth) / 2
  const S = (ridgeAlongX ? depth : width) / 2
  const rh = L - S // ridge half-length; 0 when the base is square

  const canonical: [number, number, number][] = [
    [-L, -H, -S], // 0 base corner
    [L, -H, -S], // 1 base corner
    [L, -H, S], // 2 base corner
    [-L, -H, S], // 3 base corner
    [-rh, H, 0], // 4 ridge end A
    [rh, H, 0], // 5 ridge end B
  ]

  const positions = new Float32Array(canonical.length * 3)
  canonical.forEach(([u, y, w], i) => {
    positions[i * 3] = ridgeAlongX ? u : w
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = ridgeAlongX ? w : u
  })

  const baseIndices = [
    0, 1, 2, 0, 2, 3, // base
    0, 3, 4, // end at -L
    1, 5, 2, // end at +L
    0, 5, 1, 0, 4, 5, // side at -S
    3, 2, 5, 3, 5, 4, // side at +S
  ]
  const indices = ridgeAlongX ? baseIndices : reverseWinding(baseIndices)

  // Main slopes rise from the eave (±S) to the ridge over the full `rise`.
  const uv = planarRoofUVs(canonical, H, Math.hypot(S, rise))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Skillion / atap miring satu arah (type "miring"): wedge — bidang atap tunggal
 * menurun ke `lowSide`. Base rect di y=-H, tepi TINGGI di y=+H pada sisi
 * berlawanan `lowSide`. 6 vertex: 4 sudut base + 2 sudut atas sisi tinggi.
 * Muka: bawah, bidang miring (rect), muka vertikal sisi tinggi, 2 segitiga
 * samping.
 */
export function buildSkillionGeometry(
  width: number,
  rise: number,
  depth: number,
  lowSide: "n" | "s" | "w" | "e",
): THREE.BufferGeometry {
  const H = rise / 2
  const alongZ = lowSide === "n" || lowSide === "s"
  const L = (alongZ ? width : depth) / 2 // separuh lebar MELINTANG kemiringan
  const S = (alongZ ? depth : width) / 2 // separuh bentang SEARAH kemiringan

  // Kanonik: kemiringan sepanjang sumbu w; -S = sisi TINGGI, +S = sisi RENDAH.
  const canonical: [number, number, number][] = [
    [-L, -H, -S], // 0 base, sisi tinggi
    [L, -H, -S], // 1 base, sisi tinggi
    [L, -H, S], // 2 base, sisi rendah
    [-L, -H, S], // 3 base, sisi rendah
    [-L, H, -S], // 4 puncak, sisi tinggi
    [L, H, -S], // 5 puncak, sisi tinggi
  ]

  // Pemetaan kanonik → dunia per lowSide. "s": w→+z (turun ke selatan) — identitas.
  // "n": w dicermin (1 refleksi), "e": tukar sumbu (1 refleksi), "w": tukar+cermin
  // (2 refleksi = rotasi). Refleksi ganjil membalik orientasi → winding dibalik.
  const mapVert = ([u, y, w]: [number, number, number]): [number, number, number] =>
    lowSide === "s" ? [u, y, w]
    : lowSide === "n" ? [u, y, -w]
    : lowSide === "e" ? [w, y, u]
    : [-w, y, u]
  const reflectionOdd = lowSide === "n" || lowSide === "e"

  const positions = new Float32Array(canonical.length * 3)
  canonical.forEach((v, i) => {
    const [x, y, z] = mapVert(v)
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
  })

  const baseIndices = [
    0, 1, 2, 0, 2, 3, // bawah
    0, 4, 5, 0, 5, 1, // muka vertikal sisi tinggi
    3, 2, 5, 3, 5, 4, // bidang miring
    0, 3, 4, // segitiga -L
    1, 5, 2, // segitiga +L
  ]
  const indices = reflectionOdd ? reverseWinding(baseIndices) : baseIndices

  const uv = planarRoofUVs(canonical, H, Math.hypot(2 * S, rise))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * BINGKAI GABLE (W4, ref prototipe scandi-tropis): outline pelana ASIMETRIS
 * yang berdiri di bidang fasad — poligon 10-titik (pentagon luar tanpa chord
 * dasar, kaki kiri/kanan bisa beda tinggi) di-extrude setebal `depth`.
 *
 * Origin lokal: TENGAH-DASAR (x=0 di tengah bentang, y=0 di dasar kaki),
 * bidang profil XY, extrude sepanjang Z (−depth/2..+depth/2). Rotasi plan
 * ditangani prim (`rotationY`) — builder ini murni profil.
 *
 * `apexOffset` (+ ke arah +x lokal) di-clamp menyisakan 2×member dari kaki.
 */
export function buildGableFrameGeometry(
  width: number,
  apexH: number,
  eaveL: number,
  eaveR: number,
  apexOffset: number,
  member: number,
  depth: number,
): THREE.BufferGeometry {
  const W = width / 2
  const m = Math.max(0.05, Math.min(member, width / 4))
  const ro = Math.max(-(W - 2 * m), Math.min(W - 2 * m, apexOffset))
  const eL = Math.min(eaveL, apexH - 0.05)
  const eR = Math.min(eaveR, apexH - 0.05)

  // Drop tepi-dalam: kaki menipis `m` horizontal; rake menipis vertikal
  // proporsional agar tebal rake ≈ m tegak-lurus bidang miring.
  const runL = Math.max(0.1, ro + W)
  const runR = Math.max(0.1, W - ro)
  const dropL = m * Math.hypot(runL, apexH - eL) / runL
  const dropR = m * Math.hypot(runR, apexH - eR) / runR

  const shape = new THREE.Shape()
  shape.moveTo(-W, 0)
  shape.lineTo(-W, eL)
  shape.lineTo(ro, apexH)
  shape.lineTo(W, eR)
  shape.lineTo(W, 0)
  shape.lineTo(W - m, 0)
  shape.lineTo(W - m, eR - dropR * ((W - m - ro) / runR) + (apexH - eR) * (1 - (W - m - ro) / runR) - dropR)
  shape.lineTo(ro, apexH - Math.max(dropL, dropR))
  shape.lineTo(-W + m, eL - dropL * ((ro + W - m) / runL) + (apexH - eL) * (1 - (ro + W - m) / runL) - dropL)
  shape.lineTo(-W + m, 0)
  shape.closePath()

  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  return geometry
}
