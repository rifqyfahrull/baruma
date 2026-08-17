/**
 * Tahap 3 (deterministik) — Categorize + relevance gate. Backbone pipeline:
 * gratis, instan, 100% coverage, tanpa bergantung ke endpoint LLM yang flaky.
 * Sesuai PRD §18.4: "code untuk fakta yang bisa dihitung". MiMo (tahap 07)
 * hanya melapisi enrichment kualitatif di atas ini.
 *
 * Skor tiap kandidat untuk tiap kategori PRD via keyword berbobot pada
 * name+tags+categories, kurangi negative keywords (weapon/character/minecraft/
 * fantasy/food/vehicle...), wajib kategori Sketchfab arsitektur/furniture untuk
 * mayoritas kategori. Ambil kategori skor tertinggi; tandai relevant bila skor
 * >= threshold dan bukan noise.
 *
 * Output: out/categorized.jsonl
 * Jalankan: node scripts/asset-harvest/03-categorize.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ensureDirs, OUT_DIR } from "./_shared.mjs"

const IN = path.join(OUT_DIR, "candidates.jsonl")
const OUT = path.join(OUT_DIR, "categorized.jsonl")

// Sketchfab category yang menandakan objek relevan rumah.
const GOOD_SF_CATS = new Set(["architecture", "furniture-home"])
// Sketchfab category yang hampir selalu noise untuk desain rumah.
const BAD_SF_CATS = new Set([
  "weapons-military", "characters-creatures", "animals-pets", "cars-vehicles",
  "food-drink", "people", "sports-fitness", "music", "news-politics",
  "art-abstract", "fashion-style",
])

// Negative keyword: kalau muncul, objek ditolak (bukan aset rumah nyata).
const NEGATIVE = [
  "minecraft", "medieval", "fantasy", "sword", "gun", "rifle", "pistol",
  "weapon", "knife", "axe", "shield", "armor", "armour", "dragon", "zombie",
  "skull", "skeleton", "monster", "creature", "character", "anime", "waifu",
  "spaceship", "spacecraft", "sci-fi", "scifi", "robot", "mech", "vehicle",
  "\bcar\b", "truck", "airplane", "aircraft", "tank ", "cannon", "dungeon",
  "castle", "ruin", "temple ruins", "tombstone", "grave", "coffin", "pirate",
  "viking", "samurai", "ninja", "wizard", "warrior", "goblin", "orc",
  "pokemon", "mario", "sonic", "lego", "roblox", "avatar", "cartoon character",
  "food", "burger", "pizza", "fruit", "vegetable", "animal", "dog", "cat ",
  "horse", "dinosaur", "bird", "fish ", "insect", "bug ", "flag", "banner",
  "coin", "treasure", "gem ", "jewel", "ring ", "necklace", "clothing",
  "t-shirt", "shoe", "boot", "hat ", "helmet", "mask", "weaponry", "ammo",
  "grenade", "bomb", "missile", "drone", "camera rig", "microphone", "guitar",
  "piano", "drum", "instrument", "phone", "laptop", "keyboard", "console ",
  "controller", "engine", "turbine", "gear ", "machine part", "cnc",
]

// Aturan per kategori: [weight, keyword]. Match substring lowercase pada teks
// gabungan name+tags+categories.
const RULES = {
  facade: [[5, "facade"], [5, "fasad"], [4, "building front"], [3, "house exterior"], [3, "exterior wall"], [2, "elevation"], [2, "villa exterior"]],
  fence: [[5, "fence"], [5, "pagar"], [4, "boundary wall"], [3, "railing fence"], [3, "picket"], [2, "hedge"]],
  gate: [[5, "gate"], [5, "gerbang"], [4, "sliding gate"], [4, "swing gate"], [3, "entrance gate"], [2, "portal"]],
  window: [[5, "window"], [5, "jendela"], [4, "casement"], [3, "shutter"], [2, "skylight"], [2, "glazing"]],
  door: [[5, "door"], [5, "pintu"], [4, "doorway"], [3, "entrance door"], [2, "gate door"], [2, "garage door"]],
  arch_element: [[5, "staircase"], [5, "stair"], [4, "railing"], [4, "canopy"], [4, "pergola"], [4, "balustrade"], [3, "column"], [3, "pillar"], [3, "roster"], [3, "louver"], [3, "partition"], [3, "awning"], [3, "gazebo"], [2, "roof"], [2, "balcony"], [2, "ladder"]],
  kitchen: [[5, "kitchen set"], [5, "kitchen cabinet"], [4, "kitchen"], [4, "cupboard"], [4, "countertop"], [3, "cabinet"], [3, "pantry"], [2, "sink cabinet"]],
  seating: [[5, "sofa"], [5, "armchair"], [4, "couch"], [4, "chair"], [3, "bench"], [3, "stool"], [3, "seat"], [2, "ottoman"], [2, "recliner"]],
  table: [[5, "coffee table"], [5, "dining table"], [4, "table"], [4, "desk"], [3, "nightstand"], [3, "sideboard"], [3, "console table"], [2, "tv stand"]],
  bedroom: [[5, "wardrobe"], [5, "bed frame"], [4, "bed "], [4, " bed"], [4, "closet"], [3, "dresser"], [3, "nightstand"], [2, "bedroom"]],
  sanitary: [[5, "toilet"], [5, "bathtub"], [5, "washbasin"], [4, "sink"], [4, "shower"], [4, "sanitary"], [3, "faucet"], [3, "bidet"], [3, "bathroom"], [2, "basin"]],
  decor: [[5, "vase"], [4, "mirror"], [4, "rug"], [4, "carpet"], [4, "curtain"], [3, "wall art"], [3, "painting frame"], [3, "plant pot"], [3, "planter"], [3, "houseplant"], [2, "decoration"], [2, "ornament"], [2, "cushion"], [2, "clock"]],
  lighting: [[5, "chandelier"], [5, "pendant light"], [4, "ceiling light"], [4, "lamp"], [4, "sconce"], [3, "wall light"], [3, "floor lamp"], [3, "spotlight"], [2, "lantern"], [2, "light fixture"]],
}

const MIN_SCORE = 4

function textOf(c) {
  return `${c.name ?? ""} ${(c.tags ?? []).join(" ")} ${(c.categories ?? []).join(" ")}`.toLowerCase()
}

function hasNegative(text) {
  for (const n of NEGATIVE) {
    if (n.startsWith("\\b")) {
      if (new RegExp(n).test(text)) return true
    } else if (text.includes(n)) {
      return true
    }
  }
  return false
}

function bestCategory(text, sfCats) {
  let best = null
  let bestScore = 0
  for (const [cat, rules] of Object.entries(RULES)) {
    let score = 0
    for (const [w, kw] of rules) {
      if (text.includes(kw)) score = Math.max(score, w) + (score > 0 ? 1 : 0)
    }
    // Boost bila Sketchfab category mendukung.
    if (score > 0 && sfCats.some((c) => GOOD_SF_CATS.has(c))) score += 2
    if (score > bestScore) {
      bestScore = score
      best = cat
    }
  }
  return { category: best, score: bestScore }
}

function main() {
  ensureDirs()
  const lines = readFileSync(IN, "utf8").split("\n").filter(Boolean)
  const out = []
  const catCounts = {}
  let relevant = 0
  let rejectedNegative = 0
  let rejectedLowScore = 0
  for (const line of lines) {
    const c = JSON.parse(line)
    const text = textOf(c)
    const sfCats = (c.categories ?? []).map((x) => x.toLowerCase())
    const negative = hasNegative(text)
    const hardBadCat = sfCats.length > 0 && sfCats.every((x) => BAD_SF_CATS.has(x))
    const { category, score } = bestCategory(text, sfCats)
    let rel = true
    let reason = ""
    if (negative) {
      rel = false
      reason = "negative_keyword"
      rejectedNegative++
    } else if (hardBadCat) {
      rel = false
      reason = "bad_sf_category"
      rejectedLowScore++
    } else if (!category || score < MIN_SCORE) {
      rel = false
      reason = "low_score"
      rejectedLowScore++
    }
    if (rel) {
      relevant++
      catCounts[category] = (catCounts[category] ?? 0) + 1
    }
    out.push(
      JSON.stringify({
        ...c,
        category: rel ? category : null,
        catScore: score,
        relevant: rel,
        reason,
      }),
    )
  }
  writeFileSync(OUT, out.join("\n") + "\n")
  console.log(`[categorize] total ${lines.length}`)
  console.log(`[categorize] rejected negative-keyword: ${rejectedNegative}`)
  console.log(`[categorize] rejected low-score/bad-cat: ${rejectedLowScore}`)
  console.log(`[categorize] relevant: ${relevant}`)
  console.log(`[categorize] per-category:`)
  for (const [k, v] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)}  ${k}`)
  }
  console.log(`[categorize] -> ${OUT}`)
}

main()
