/**
 * Tahap 3 — MiMo Semantic Review (PRD §18) via text metadata.
 * CATATAN PENTING: endpoint faucet mimo-v2.5-pro TEXT-ONLY (dicek: menolak
 * image_url). Jadi klasifikasi berbasis metadata teks Objaverse (name + tags +
 * categories + description) — bukan visual review. Sesuai prinsip PRD §18.4:
 * LLM untuk interpretasi (kategori/tag/relevansi), bukan keputusan legal/teknis
 * final (itu sudah di gate deterministik tahap 2).
 *
 * Batch banyak kandidat per panggilan (hemat token), output JSON terstruktur,
 * resume via out/classified.jsonl (uid yang sudah diproses dilewati), dan
 * pencatatan token ke out/usage.json.
 *
 * Jalankan: node scripts/asset-harvest/03-classify.mjs [--limit=N] [--batch=25]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  faucetConfig,
  faucetChat,
  loadEnvLocal,
  loadTokens,
  OUT_DIR,
  TAXONOMY,
  ensureDirs,
} from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..", "..")
loadEnvLocal(repoRoot)

const args = process.argv.slice(2)
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity
const batchSize = Number((args.find((a) => a.startsWith("--batch=")) || "").split("=")[1]) || 5
// Kuota faucet per-token → 1 worker per token (round-robin) menghindari
// rate-limit. Default concurrency = jumlah token. Enrichment ini hanya lapisan
// di atas kategorisasi deterministik, jadi lambat pun tak memblokir katalog.
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
// Enrich hanya aset yang benar-benar terpilih (selected.jsonl) supaya token
// tidak terbuang untuk 132k kandidat mentah.
const SOURCE = process.env.HARVEST_CLASSIFY_SOURCE || path.join(OUT_DIR, "selected.jsonl")

const CANDIDATES = SOURCE
const CLASSIFIED = path.join(OUT_DIR, "classified.jsonl")
const USAGE = path.join(OUT_DIR, "usage.json")

const CATEGORY_KEYS = Object.keys(TAXONOMY)

const SYSTEM_PROMPT = `You are a 3D asset classifier for an Indonesian house-design platform.
For EACH item (id + name + tags + categories) decide if it is a usable architectural or interior asset for residential house design, and assign ONE category.
Allowed categories: ${CATEGORY_KEYS.join(", ")}, or "other" if it is NOT a residential architecture/interior object (weapons, characters, vehicles, food, logos, scanned junk, abstract, terrain, etc).
Category meanings:
${CATEGORY_KEYS.map((k) => `- ${k}: ${TAXONOMY[k]}`).join("\n")}
Return STRICT JSON only, no prose, shape:
{"results":[{"id":"<id>","category":"<one>","subcategory":"<short or empty>","relevant":true|false,"style":["modern"|"tropical"|"minimalist"|"classic"|"industrial"|"scandinavian"...],"material":["wood"|"steel"|"glass"|"concrete"|"fabric"|"stone"...],"confidence":0.0-1.0}]}
relevant=false whenever category is "other" or the object is clearly not house-design usable. Keep style/material short (max 3 each). Echo the id EXACTLY.`

function loadDone() {
  const done = new Set()
  if (existsSync(CLASSIFIED)) {
    for (const line of readFileSync(CLASSIFIED, "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        done.add(JSON.parse(line).uid)
      } catch {
        /* ignore */
      }
    }
  }
  return done
}

function loadUsage() {
  if (existsSync(USAGE)) {
    try {
      return JSON.parse(readFileSync(USAGE, "utf8"))
    } catch {
      /* ignore */
    }
  }
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, classified: 0, relevant: 0 }
}

function extractJson(text) {
  if (!text) return null
  // strip code fences
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end < 0) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

async function classifyBatch(cfg, batch, token) {
  const userContent = JSON.stringify(
    batch.map((c) => ({
      id: c.uid,
      name: c.name,
      tags: c.tags,
      categories: c.categories,
    })),
  )
  const { text, usage } = await faucetChat(
    cfg,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Classify these ${batch.length} items:\n${userContent}` },
    ],
    // Faucet punya gateway timeout ~15s: batch kecil (default 5) + max_tokens
    // pas supaya generasi selesai di bawah batas (di atas itu body balik kosong).
    { maxTokens: 2500, temperature: 0, tries: 15, token },
  )
  return { parsed: extractJson(text), usage, raw: text }
}

async function main() {
  ensureDirs()
  if (!existsSync(CANDIDATES)) {
    console.error("[classify] candidates.jsonl missing; run 02-discover.mjs first")
    process.exit(1)
  }
  const cfg = faucetConfig()
  const done = loadDone()
  const usage = loadUsage()

  const all = readFileSync(CANDIDATES, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => !done.has(c.uid))
  const todo = Number.isFinite(limit) ? all.slice(0, limit) : all
  console.log(`[classify] ${todo.length} to classify (already done ${done.size}), batch=${batchSize}, conc=${CONCURRENCY}`)

  const byUid = new Map(todo.map((c) => [c.uid, c]))
  const batches = []
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize))

  let processed = 0
  const queue = [...batches]
  console.log(`[classify] round-robin ${TOKENS.length} token(s), 1 worker per token`)
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, workerIdx) => {
      const token = TOKENS[workerIdx % TOKENS.length]
      while (queue.length) {
        const batch = queue.shift()
        if (!batch) break
        try {
          const { parsed, usage: u } = await classifyBatch(cfg, batch, token)
          usage.calls++
          usage.promptTokens += u.prompt_tokens ?? 0
          usage.completionTokens += u.completion_tokens ?? 0
          usage.totalTokens += u.total_tokens ?? 0
          const results = parsed?.results ?? []
          const lines = []
          const seen = new Set()
          for (const r of results) {
            const cand = byUid.get(r.id)
            if (!cand || seen.has(r.id)) continue
            seen.add(r.id)
            const category = CATEGORY_KEYS.includes(r.category) ? r.category : "other"
            const relevant = r.relevant === true && category !== "other"
            lines.push(
              JSON.stringify({
                ...cand,
                category,
                subcategory: (r.subcategory ?? "").slice(0, 40),
                relevant,
                style: Array.isArray(r.style) ? r.style.slice(0, 3) : [],
                material: Array.isArray(r.material) ? r.material.slice(0, 3) : [],
                confidence: typeof r.confidence === "number" ? r.confidence : null,
              }),
            )
            usage.classified++
            if (relevant) usage.relevant++
          }
          // Kandidat dalam batch yang tidak dijawab model → tandai unresolved
          // (relevant=false) supaya tidak dicoba ulang selamanya & resume bersih.
          for (const cand of batch) {
            if (seen.has(cand.uid)) continue
            lines.push(JSON.stringify({ ...cand, category: "other", subcategory: "", relevant: false, style: [], material: [], confidence: 0, unresolved: true }))
            usage.classified++
          }
          if (lines.length) appendFileSync(CLASSIFIED, lines.join("\n") + "\n")
          processed += batch.length
          if (usage.calls % 5 === 0) {
            writeFileSync(USAGE, JSON.stringify(usage, null, 2))
            console.log(`[classify] ${processed}/${todo.length} | relevant ${usage.relevant} | tokens ${usage.totalTokens}`)
          }
        } catch (e) {
          console.error(`[classify] batch failed: ${e.message}`)
        }
      }
    }),
  )
  writeFileSync(USAGE, JSON.stringify(usage, null, 2))
  console.log(`[classify] done. total classified ${usage.classified}, relevant ${usage.relevant}, tokens ${usage.totalTokens}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
