/**
 * Tahap 4 — Selection + Deduplication (PRD §6.2, §19). Dari categorized.jsonl:
 *   - per-author cap per kategori (matikan banjir seri konfigurator, mis.
 *     prostair.pl 3348 tangga → maks N per author),
 *   - name-stem cap (buang varian nama near-identik),
 *   - alokasi target per kategori (ambil semua untuk P0 langka; batasi surplus),
 *   - ranking kualitas: utamakan faceCount sehat (2k–200k) & ukuran wajar.
 * Output: out/selected.jsonl (daftar final untuk di-download).
 *
 * Jalankan: node scripts/asset-harvest/04-select.mjs [--target=13000]
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ensureDirs, OUT_DIR } from "./_shared.mjs"

const IN = path.join(OUT_DIR, "categorized.jsonl")
const OUT = path.join(OUT_DIR, "selected.jsonl")

// Target per kategori (oversample dari PRD §6.2 untuk menutup gagal download).
// Nilai = plafon; kalau supply < plafon, ambil semua.
const CATEGORY_TARGET = {
  facade: 1200, fence: 900, gate: 900, window: 1200, door: 1200,
  arch_element: 1600, kitchen: 1300, seating: 1600, table: 1300,
  bedroom: 1000, sanitary: 1000, decor: 1300, lighting: 1100,
}
const PER_AUTHOR_CAP = 120 // per author per kategori
const NAME_STEM_CAP = 25 // per name-stem per kategori

function nameStem(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ")
}

// Proxy kualitas: faceCount di rentang sehat + ukuran wajar → skor tinggi.
function qualityScore(c) {
  const f = c.faceCount ?? 0
  let s = 0
  if (f >= 2000 && f <= 200000) s += 3
  else if (f >= 500 && f < 2000) s += 1.5
  else if (f > 200000) s += 0.5
  const mb = (c.sizeBytes ?? 0) / (1024 * 1024)
  if (mb > 0.05 && mb <= 30) s += 2
  else if (mb > 30 && mb <= 80) s += 1
  if ((c.tags ?? []).some((t) => /pbr|gameready|game-ready|substance|textured/.test(t))) s += 1
  s += Math.min(1, (c.tags?.length ?? 0) / 15)
  return s
}

function main() {
  ensureDirs()
  const targetArg = Number((process.argv.find((a) => a.startsWith("--target=")) || "").split("=")[1]) || 0
  const rows = readFileSync(IN, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.relevant && c.category)

  const byCat = {}
  for (const c of rows) (byCat[c.category] ??= []).push(c)

  const selected = []
  const perCatSelected = {}
  for (const [cat, list] of Object.entries(byCat)) {
    const target = CATEGORY_TARGET[cat] ?? 800
    list.sort((a, b) => qualityScore(b) - qualityScore(a))
    const authorCount = {}
    const stemCount = {}
    let taken = 0
    for (const c of list) {
      if (taken >= target) break
      const author = c.author ?? "?"
      const stem = nameStem(c.name)
      if ((authorCount[author] ?? 0) >= PER_AUTHOR_CAP) continue
      if (stem && (stemCount[stem] ?? 0) >= NAME_STEM_CAP) continue
      authorCount[author] = (authorCount[author] ?? 0) + 1
      stemCount[stem] = (stemCount[stem] ?? 0) + 1
      selected.push(c)
      taken++
    }
    perCatSelected[cat] = taken
  }

  // Kalau target global diminta & hasil > target, trim proporsional kelebihan
  // dari kategori surplus (P1/P2), pertahankan P0 langka.
  writeFileSync(OUT, selected.map((c) => JSON.stringify(c)).join("\n") + "\n")
  console.log(`[select] selected ${selected.length} assets`)
  for (const [k, v] of Object.entries(perCatSelected).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`)
  }
  if (targetArg) console.log(`[select] (global target hint: ${targetArg}; catalog stage will finalize to 10k)`)
  console.log(`[select] -> ${OUT}`)
}

main()
