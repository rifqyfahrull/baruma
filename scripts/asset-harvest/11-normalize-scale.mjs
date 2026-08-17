/**
 * Tahap 11 — normalisasi skala untuk aset yang bbox-nya janggal (bukan meter).
 *
 * WAWASAN: app me-render custom GLB dengan computeFitTransformOriented — GLB
 * di-scale UNIFORM agar muat di envelope width_m×depth_m×height_m (preserve
 * aspect). Jadi skala native GLB tak relevan; yang menentukan ukuran render =
 * DIMENSI DB. Maka normalisasi cukup memperbaiki width/depth/height di DB
 * (tanpa re-proses Blender): pertahankan ASPECT RATIO dari bbox mentah (rasio
 * sudah benar walau skala absolut salah), lalu skala agar dimensi terbesar =
 * target wajar per-kategori.
 *
 * Menormalisasi setiap aset Objaverse yang dimensinya IMPLAUSIBEL:
 *   - width_m NULL, ATAU
 *   - maxdim < 1 cm (kemungkinan mm-scale/kosong), ATAU
 *   - maxdim > target_kategori × 2.5 (kebesaran, mis. kursi 100 m).
 * Yang dimensinya sudah wajar (0.01 m .. target×2.5) DIPERTAHANKAN (mungkin
 * ukuran asli meter yang benar). Idempotent (re-run → hanya sentuh outlier).
 *
 * Jalankan: node scripts/asset-harvest/11-normalize-scale.mjs [--dry]
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { loadEnvLocal, OUT_DIR } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)
const dry = process.argv.includes("--dry")

// Target dimensi TERBESAR (meter) per kategori — ukuran wajar sebuah objek.
const TARGET_MAX = {
  facade: 8.0, gate: 3.5, fence: 2.5, door: 2.2, window: 1.5,
  arch_element: 2.8, kitchen: 2.4, sofa: 2.0, coffee_table: 1.2,
  bedroom: 2.0, sanitary: 1.4, lighting: 0.9, decor: 0.8,
}
const DEFAULT_TARGET = 1.5

function round3(n) {
  return Math.round(n * 1000) / 1000
}

function main() {
  return (async () => {
    const bbox = new Map(
      readFileSync(path.join(OUT_DIR, "bbox.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((b) => [b.uid, b]),
    )
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false })
    await client.connect()
    // SEMUA aset Objaverse; filter implausibel dihitung di bawah.
    const res = await client.query(
      `select id, category, width_m, depth_m, height_m from user_assets
       where source_name = $1`,
      ["Objaverse (Sketchfab CC)"],
    )
    console.log(`[normalize] ${res.rows.length} aset Objaverse diperiksa`)

    const TOLERANCE = 2.5
    let updated = 0
    let kept = 0
    let noBbox = 0
    for (const row of res.rows) {
      const target = TARGET_MAX[row.category] ?? DEFAULT_TARGET
      const curMax = Math.max(
        Number(row.width_m) || 0,
        Number(row.depth_m) || 0,
        Number(row.height_m) || 0,
      )
      const isNull = row.width_m == null
      const implausible = isNull || curMax < 0.01 || curMax > target * TOLERANCE
      if (!implausible) {
        kept++
        continue
      }
      // id = asset-obj-<uid[:16]>; cari bbox via prefix uid.
      const uidPrefix = row.id.replace(/^asset-obj-/, "")
      // bbox key = full uid; cocokkan by prefix.
      let bb = null
      for (const [uid, b] of bbox) {
        if (uid.startsWith(uidPrefix)) {
          bb = b
          break
        }
      }
      if (!bb || !bb.bbox) {
        noBbox++
        continue
      }
      const w = bb.bbox.max[0] - bb.bbox.min[0]
      const h = bb.bbox.max[1] - bb.bbox.min[1]
      const d = bb.bbox.max[2] - bb.bbox.min[2]
      const rawMax = Math.max(w, h, d)
      if (!(rawMax > 0)) {
        noBbox++
        continue
      }
      const scale = target / rawMax
      const nw = round3(w * scale)
      const nh = round3(h * scale)
      const nd = round3(d * scale)
      if (!dry) {
        await client.query(
          `update user_assets set width_m = $2, depth_m = $3, height_m = $4,
             scale_factor_json = $5, updated_at = now() where id = $1`,
          [row.id, nw, nd, nh, JSON.stringify({ method: "category_aspect_fit", scale, target })],
        )
      }
      updated++
      if (updated <= 6) console.log(`  ${row.category}: cur max ${round3(curMax)}m -> ${nw}x${nd}x${nh} m`)
    }
    console.log(`[normalize] ${dry ? "(DRY) would update" : "updated"} ${updated}, dipertahankan ${kept}, tanpa bbox ${noBbox}`)
    await client.end()
  })()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
