import { requireAdmin } from "@/lib/server/auth-server"
import { handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"

const DEFAULT_CATEGORY = "window"
const DEFAULT_TARGET_COUNT = 100

type AccessMode =
  | "api_download"
  | "browser_download_allowed"
  | "manual_purchase"
  | "metadata_only"
  | "blocked"

interface WorkflowRequest {
  dbUrl?: unknown
  sourceName?: unknown
  sourceUrl?: unknown
  accessMode?: unknown
  category?: unknown
  subcategory?: unknown
  targetCount?: unknown
  licenseAllowlist?: unknown
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 10_000) : fallback
}

function accessModeValue(value: unknown): AccessMode {
  const raw = stringValue(value)
  if (
    raw === "api_download" ||
    raw === "browser_download_allowed" ||
    raw === "manual_purchase" ||
    raw === "metadata_only" ||
    raw === "blocked"
  ) {
    return raw
  }
  return "api_download"
}

function listValue(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean)
  }
  return fallback
}

function dbUrlFromEnv() {
  return process.env.ASSET_PIPELINE_DB_URL || process.env.DB_URL || process.env.DATABASE_URL || ""
}

function describeDbUrl(dbUrl: string, source: "temporary-form" | "server-env" | "missing") {
  if (!dbUrl) {
    return {
      configured: false,
      source,
      risk: "DB_URL belum tersedia; catalog writer dan review dashboard belum bisa dipersist.",
    }
  }

  try {
    // Sekadar validasi bentuk — JANGAN echo host/nama DB (audit #4:
    // disclosure). Cukup laporkan bahwa DB_URL valid & tersedia.
    new URL(dbUrl)
    return {
      configured: true,
      source,
      risk: "DB_URL valid & tersedia; endpoint ini tidak membuka koneksi database dari input browser.",
    }
  } catch {
    return {
      configured: false,
      source,
      risk: "Format DB_URL tidak valid. Gunakan postgres://user:password@host:5432/database.",
    }
  }
}

function allowedBrowser(accessMode: AccessMode) {
  return accessMode === "browser_download_allowed"
}

function workflowStages(accessMode: AccessMode) {
  return [
    {
      stage: "Source Registry",
      status: "ready",
      gate: "source.status harus approved sebelum job berjalan",
    },
    {
      stage: "Research Planner",
      status: "ready",
      gate: "LLM/MiMo hanya membuat query dan klasifikasi awal; bukan validator legal final",
    },
    {
      stage: "Candidate Discovery",
      status: "ready",
      gate: accessMode === "api_download" ? "pakai API resmi" : "batasi ke metadata publik yang diizinkan",
    },
    {
      stage: "Source & License Gate",
      status: "required",
      gate: "CC0/CC-BY/owned/partner diterima; non-commercial otomatis reject",
    },
    {
      stage: "Download / Import",
      status: accessMode === "blocked" ? "blocked" : "guarded",
      gate: allowedBrowser(accessMode)
        ? "browser hanya boleh klik download resmi, tanpa CAPTCHA/paywall/anti-bot bypass"
        : "browser download tidak aktif untuk mode ini",
    },
    {
      stage: "Normalization + Validation",
      status: "planned",
      gate: "canonical GLB, meter units, pivot bottom-center, glTF validator JSON wajib tersimpan",
    },
    {
      stage: "Preview Rendering",
      status: "planned",
      gate: "front/back/left/right/top/perspective/wireframe preview wajib tersedia",
    },
    {
      stage: "MiMo Semantic Review",
      status: "planned",
      gate: "output structured JSON; final decision tetap dari scoring engine + human review",
    },
    {
      stage: "Catalog Writer",
      status: "planned",
      gate: "asset accepted tidak boleh masuk catalog tanpa license evidence, preview, GLB, quality score",
    },
  ]
}

function recommendedQueries(category: string, subcategory: string) {
  const readable = [subcategory, category].filter(Boolean).join(" ")
  return [
    `modern tropical ${readable} 3d model glb`,
    `${readable} 3d model creative commons`,
    `residential ${readable} gltf download`,
  ]
}

function sqlBootstrap() {
  return [
    "create table if not exists asset_sources (id uuid primary key, name text not null, base_url text not null, access_mode text not null, status text not null default 'pending');",
    "create table if not exists asset_candidates (id uuid primary key, source_id uuid references asset_sources(id), source_url text not null, title text, declared_license text, expected_category text, expected_subcategory text, candidate_status text default 'discovered');",
    "create table if not exists assets (id uuid primary key, canonical_name text not null, category text not null, subcategory text, dimensions_m jsonb, file_url text not null, preview_urls jsonb, license_type text, attribution_text text, source_url text, quality_score numeric, status text default 'active');",
  ]
}

export async function POST(request: Request) {
  // Endpoint diagnostik yang memproses DB_URL → wajib admin (audit #4) +
  // rate-limit.
  try {
    const limited = rateLimitGuard(request, {
      scope: "faucet-asset-workflow",
      limit: 30,
      windowMs: 60_000,
    })
    if (limited) return limited
    await requireAdmin(request)
  } catch (e) {
    return handleError(e)
  }

  let body: WorkflowRequest
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: "Body harus berupa JSON." }, 400)
  }

  const requestDbUrl = stringValue(body.dbUrl)
  const envDbUrl = dbUrlFromEnv()
  const dbUrl = requestDbUrl || envDbUrl
  const dbSource = requestDbUrl ? "temporary-form" : envDbUrl ? "server-env" : "missing"
  const accessMode = accessModeValue(body.accessMode)
  const sourceName = stringValue(body.sourceName, "Sketchfab")
  const sourceUrl = stringValue(body.sourceUrl, "https://sketchfab.com")
  const category = stringValue(body.category, DEFAULT_CATEGORY)
  const subcategory = stringValue(body.subcategory, "")
  const targetCount = numberValue(body.targetCount, DEFAULT_TARGET_COUNT)
  const licenseAllowlist = listValue(body.licenseAllowlist, ["CC0", "CC-BY", "owned", "partner"])
  const candidateTarget = Math.ceil(targetCount * 3)

  return json({
    ok: true,
    db: describeDbUrl(dbUrl, dbSource),
    registry: {
      sourceName,
      sourceUrl,
      accessMode,
      apiFirst: accessMode === "api_download",
      browserAllowed: allowedBrowser(accessMode),
      downloadAllowed: accessMode === "api_download" || accessMode === "browser_download_allowed",
      guardrails: [
        "Tidak menjalankan broad browser crawling.",
        "Tidak bypass CAPTCHA, paywall, login wall, anti-bot, atau ToS.",
        "robots.txt, source policy, dan license evidence harus lolos sebelum download.",
        "CC-BY wajib menyimpan attribution; non-commercial otomatis reject.",
      ],
    },
    planner: {
      category,
      subcategory,
      targetAccepted: targetCount,
      targetCandidates: candidateTarget,
      licenseAllowlist,
      searchQueries: recommendedQueries(category, subcategory),
      negativeTerms: ["2d", "texture only", "wallpaper", "blueprint", "non-commercial"],
    },
    workflow: workflowStages(accessMode),
    qualityGates: {
      webStandardProfile: {
        maxTriangles: 250_000,
        maxMaterials: 32,
        maxTextures: 32,
        maxTextureDimension: 4096,
        maxFileSizeMb: 80,
      },
      hardBlockers: [
        "license reject",
        "file corrupt",
        "invalid GLB after repair",
        "no visible mesh",
        "unsafe/prohibited content",
        "duplicate exact",
      ],
    },
    sqlBootstrap: sqlBootstrap(),
  })
}
