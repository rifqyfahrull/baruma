/**
 * Tahap 7 — ekstrak bounding-box nyata tiap GLB (PRD §16 geometry analyzer):
 * parse chunk JSON GLB, telusuri scene graph (apply node transforms), union
 * bbox POSITION di world-space → width/depth/height. Dipakai untuk field
 * width_m/depth_m/height_m + raw_bounding_box_json di user_assets.
 *
 * CATATAN SKALA: glTF spec = meter, dan mayoritas ekspor Sketchfab mengikuti,
 * jadi bbox umumnya ~meter. TAPI sebagian model tak ternormalisasi (PRD sebut
 * "scale salah") — normalisasi Blender headless adalah pekerjaan lanjutan.
 * Nilai di sini = apa adanya dari file (world-space), ditandai bila janggal.
 *
 * Output: out/bbox.jsonl  (resumable)
 * Jalankan: node scripts/asset-harvest/07-bbox.mjs [--conc=8]
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { ensureDirs, OUT_DIR, RAW_DIR } from "./_shared.mjs"

const OUT = path.join(OUT_DIR, "bbox.jsonl")
const conc = Number((process.argv.find((a) => a.startsWith("--conc=")) || "").split("=")[1]) || 8

/* ---- mat4 helpers (column-major, glTF convention) ---- */
function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
function multiply(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3]
    }
  }
  return o
}
function fromTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  const [sx, sy, sz] = s
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix
  return fromTRS(node.translation, node.rotation, node.scale)
}
function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

function parseGlbJson(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) return null // "glTF"
  let off = 12
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const start = off + 8
    if (type === 0x4e4f534a) {
      // "JSON"
      return JSON.parse(buf.subarray(start, start + len).toString("utf8"))
    }
    off = start + len
  }
  return null
}

/** World-space bbox via scene graph traversal (union of transformed POSITION
 *  accessor min/max corners). Returns [wx,wy,wz] extents or null. */
function computeBbox(gltf) {
  const accessors = gltf.accessors ?? []
  const meshes = gltf.meshes ?? []
  const nodes = gltf.nodes ?? []
  const scenes = gltf.scenes ?? []
  const roots = scenes[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i)
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  let found = false

  const visit = (idx, parent) => {
    const node = nodes[idx]
    if (!node) return
    const world = multiply(parent, nodeMatrix(node))
    if (node.mesh != null) {
      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        const acc = accessors[prim.attributes?.POSITION]
        if (!acc?.min || !acc?.max) continue
        const [ax, ay, az] = acc.min
        const [bx, by, bz] = acc.max
        // 8 corners of the local AABB, transformed to world.
        for (const cx of [ax, bx]) {
          for (const cy of [ay, by]) {
            for (const cz of [az, bz]) {
              const w = transformPoint(world, [cx, cy, cz])
              for (let k = 0; k < 3; k++) {
                if (w[k] < min[k]) min[k] = w[k]
                if (w[k] > max[k]) max[k] = w[k]
              }
              found = true
            }
          }
        }
      }
    }
    for (const c of node.children ?? []) visit(c, world)
  }
  for (const r of roots) visit(r, identity())
  if (!found) return null
  return {
    width: round3(max[0] - min[0]),
    height: round3(max[1] - min[1]),
    depth: round3(max[2] - min[2]),
    min: min.map(round3),
    max: max.map(round3),
  }
}
function round3(n) {
  return Math.round(n * 1000) / 1000
}

function loadDone() {
  const done = new Set()
  if (existsSync(OUT)) {
    for (const l of readFileSync(OUT, "utf8").split("\n")) {
      if (!l.trim()) continue
      try {
        done.add(JSON.parse(l).uid)
      } catch {
        /* ignore */
      }
    }
  }
  return done
}

async function main() {
  ensureDirs()
  const done = loadDone()
  const files = []
  for (const cat of readdirSync(RAW_DIR)) {
    const dir = path.join(RAW_DIR, cat)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".glb")) continue
      const uid = f.replace(/\.glb$/, "")
      if (done.has(uid)) continue
      files.push({ uid, cat, file: path.join(dir, f) })
    }
  }
  console.log(`[bbox] ${files.length} GLB to measure (done ${done.size}), conc=${conc}`)
  let ok = 0
  let weird = 0
  let processed = 0
  const queue = [...files]
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        const item = queue.shift()
        if (!item) break
        processed++
        try {
          const gltf = parseGlbJson(readFileSync(item.file))
          const bb = gltf ? computeBbox(gltf) : null
          const dim = Math.max(bb?.width ?? 0, bb?.height ?? 0, bb?.depth ?? 0)
          // "Janggal" = 0 atau > 100 (kemungkinan bukan meter / perlu normalisasi).
          const suspicious = !bb || dim <= 0 || dim > 100
          if (suspicious) weird++
          appendFileSync(
            OUT,
            JSON.stringify({
              uid: item.uid,
              width_m: bb?.width ?? null,
              depth_m: bb?.depth ?? null,
              height_m: bb?.height ?? null,
              bbox: bb ? { min: bb.min, max: bb.max } : null,
              scale_suspicious: suspicious,
            }) + "\n",
          )
          ok++
        } catch {
          appendFileSync(OUT, JSON.stringify({ uid: item.uid, width_m: null, depth_m: null, height_m: null, bbox: null, scale_suspicious: true }) + "\n")
          weird++
        }
        if (processed % 1000 === 0) console.log(`[bbox] ${processed}/${files.length} ok=${ok} suspicious=${weird}`)
      }
    }),
  )
  console.log(`[bbox] done ok=${ok} suspicious(scale)=${weird} -> ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
