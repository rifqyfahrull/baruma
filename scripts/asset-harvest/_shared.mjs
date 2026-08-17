/**
 * Shared config/util untuk pipeline 3D Asset Harvest (PRD: 3D Asset Research
 * Workflow). Sumber utama: Objaverse (allenai, mirror metadata+GLB Sketchfab
 * CC di Hugging Face) — jalur legal tercepat ke 10k GLB arsitektur/interior.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

export function loadEnvLocal(repoRoot) {
  const envPath = path.join(repoRoot, ".env.local")
  if (!existsSync(envPath)) return
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

export const WORKDIR = process.env.HARVEST_DIR || "D:/tmp/glb-harvest"
export const META_DIR = path.join(WORKDIR, "meta")
export const RAW_DIR = path.join(WORKDIR, "raw")
export const OUT_DIR = path.join(WORKDIR, "out")

export function ensureDirs() {
  for (const d of [WORKDIR, META_DIR, RAW_DIR, OUT_DIR]) {
    mkdirSync(d, { recursive: true })
  }
}

export const HF_BASE = "https://huggingface.co/datasets/allenai/objaverse/resolve/main"

/** Lisensi Sketchfab yang lolos License Gate PRD §13.3: CC0 & CC-BY.
 *  NC = reject (komersial), ND = reject (pipeline perlu konversi/normalisasi). */
export const LICENSE_ALLOW = new Set(["cc0", "by"])

export const LICENSE_LABELS = {
  cc0: "CC0-1.0",
  by: "CC-BY-4.0",
}

/** Taxonomy PRD §6.2 — key internal → deskripsi untuk LLM. */
export const TAXONOMY = {
  facade: "house facade / building front element",
  fence: "fence / boundary wall (pagar)",
  gate: "gate (gerbang) sliding/swing/pedestrian",
  window: "window (jendela) any type",
  door: "door (pintu) any type",
  arch_element: "canopy, railing, stair, partition, pergola, column, roster",
  kitchen: "kitchen set, kitchen cabinet, countertop unit",
  seating: "sofa, armchair, chair, bench, stool",
  table: "table, desk, coffee table, dining table",
  bedroom: "bed, wardrobe, nightstand, dresser",
  sanitary: "sink, toilet, bathtub, shower, bathroom fixture",
  decor: "interior decoration: vase, mirror, rug, curtain, wall art, plant pot",
  lighting: "lamp, chandelier, ceiling light, wall light fixture",
}

/** Prefilter keyword (nama/tag/kategori, lowercase substring). Sengaja luas —
 *  presisi diserahkan ke tahap klasifikasi MiMo. */
export const KEYWORDS = [
  "window", "door", "gate", "fence", "facade", "fasad", "railing", "canopy",
  "pergola", "stair", "staircase", "ladder", "partition", "roster", "louver",
  "kitchen", "cabinet", "cupboard", "countertop", "wardrobe", "closet",
  "sofa", "couch", "armchair", "chair", "bench", "stool", "seat",
  "table", "desk", "nightstand", "dresser", "shelf", "bookshelf", "bed ",
  " bed", "bedroom", "sink", "toilet", "bathtub", "shower", "washbasin",
  "bathroom", "sanitary", "faucet", "lamp", "chandelier", "sconce",
  "light fixture", "ceiling light", "pendant light", "mirror", "vase", "rug",
  "carpet", "curtain", "pot plant", "plant pot", "houseplant", "furniture",
  "interior", "sideboard", "tv stand", "coffee table", "dining", "balcony",
  "column", "pillar", "roof", "awning", "gazebo", "planter",
]

export const CATEGORY_HINTS = new Set(["architecture", "furniture-home"])

export async function fetchWithRetry(url, opts = {}, tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts)
      if (res.ok) return res
      // 429/5xx: backoff & retry; 4xx lain: langsung gagal
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} for ${url}`)
      }
      lastErr = new Error(`HTTP ${res.status} for ${url}`)
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
  }
  throw lastErr
}

export function faucetConfig() {
  const apiKey = process.env.FAUCET_API_KEY
  const baseUrl = process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1"
  const model = process.env.FAUCET_MODEL || "mimo-v2.5-pro"
  if (!apiKey) throw new Error("FAUCET_API_KEY is not set (put it in .env.local)")
  return { apiKey, baseUrl, model }
}

/**
 * Muat daftar token untuk round-robin. Kuota faucet dibatasi PER-TOKEN, jadi
 * memutar beberapa token menghindari rate-limit satu token. Sumber (urutan):
 * env FAUCET_TOKENS (koma), file FAUCET_TOKENS_FILE, lalu
 * src/components/faucet-check/tokens.txt, fallback FAUCET_API_KEY.
 */
export function loadTokens(repoRoot) {
  const fromEnv = (process.env.FAUCET_TOKENS || "").split(",").map((t) => t.trim()).filter(Boolean)
  if (fromEnv.length) return fromEnv
  const file =
    process.env.FAUCET_TOKENS_FILE ||
    path.join(repoRoot, "src", "components", "faucet-check", "tokens.txt")
  if (existsSync(file)) {
    // Format tokens.txt: satu token per baris. Baris diawali `#` = habis
    // (di-skip). Komentar di AKHIR baris (`tf_xxx #label`) dibuang → ambil
    // hanya bagian pertama.
    const toks = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/[\s#]/)[0].trim())
      .filter((t) => t.startsWith("tf_"))
    if (toks.length) return toks
  }
  if (process.env.FAUCET_API_KEY) return [process.env.FAUCET_API_KEY]
  throw new Error("no faucet tokens found (FAUCET_TOKENS / tokens.txt / FAUCET_API_KEY)")
}

/**
 * Chat completion ke faucet dengan backoff SANGAT sabar — endpoint free ini
 * sering 429/503/524 berjam-jam. Backoff eksponensial dibatasi 60s, sampai
 * `tries` percobaan (default 15 ≈ menahan ~10 menit downtime per panggilan).
 * Return {text, usage} atau lempar setelah semua percobaan habis.
 */
export async function faucetChat(cfg, messages, { maxTokens = 4000, temperature = 0, tries = 15, token, thinking } = {}) {
  let lastErr
  const auth = token || cfg.apiKey
  for (let i = 0; i < tries; i++) {
    try {
      // thinking:"disabled" mematikan CoT DeepSeek v4 (default ON). Untuk tugas
      // schema-bound (ekstraksi JSON) ini bikin call jauh lebih cepat & andal —
      // menghindari generasi >15s yang kena gateway-timeout (body kosong). Lih.
      // src/lib/server/llm.ts. No-op utk model non-DeepSeek.
      const body = { model: cfg.model, messages, temperature, max_tokens: maxTokens }
      if (thinking) body.thinking = { type: thinking }
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const raw = await res.text()
        // Gateway timeout ~15s → body kosong meski status 200. Perlakukan sbg
        // retryable (kecilkan batch kalau sering kena).
        if (!raw.trim()) {
          lastErr = new Error("empty body (gateway timeout)")
        } else {
          const data = JSON.parse(raw)
          return { text: data.choices?.[0]?.message?.content ?? "", usage: data.usage ?? {} }
        }
      } else if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status}`)
      } else {
        lastErr = new Error(`HTTP ${res.status}`)
      }
    } catch (e) {
      lastErr = e
    }
    const delay = Math.min(60000, 3000 * 2 ** i)
    await new Promise((r) => setTimeout(r, delay))
  }
  throw lastErr
}
