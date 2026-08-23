import { requireUser } from "@/lib/server/auth-server"
import { getOwnedProject } from "@/lib/server/repo/projects"
import { getBriefPayload } from "@/lib/server/repo/briefs"
import { upsertAlternatives } from "@/lib/server/repo/alternatives"
import { updateProject } from "@/lib/server/repo/projects"
import { spendCredits, refundCredits } from "@/lib/server/repo/credits"
import { ok, err, errCode, handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"
import { enrichAlternatives } from "@/lib/server/enrich-alternatives"
import { after } from "next/server"
import type {
  Alternative,
  Brief,
  ReadinessStatus,
  ThumbnailVariant,
} from "@/types"
import { FINISHING_LEVELS } from "@/lib/constants"

/* ---- mirror of mock/index.ts buildAlternatives ---- */

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function computeReadiness(opts: {
  floors: number
  hasPool: boolean
  rooftop: boolean
}): ReadinessStatus {
  if (opts.floors >= 3 || opts.hasPool) return "engineer_review_required"
  if (opts.floors === 2 || opts.rooftop) return "contractor_discussion_ready"
  return "concept_ready"
}

function buildAlternatives(projectId: string, brief: Brief): Alternative[] {
  const builtArea = round1(brief.site.areaM2 * brief.building.floors * 0.85)
  const perM2 = FINISHING_LEVELS[brief.building.finishingLevel].perM2IDR
  const rooms = brief.spaceProgram.reduce((sum, r) => sum + r.quantity, 0)
  const hasPool = brief.spaceProgram.some((s) => s.roomType === "kolam")
  const readiness = computeReadiness({
    floors: brief.building.floors,
    hasPool,
    rooftop: brief.building.rooftop,
  })
  const base = builtArea * perM2

  type MakeFn = (
    idSuffix: string,
    name: string,
    type: Alternative["type"],
    score: number,
    costFactor: number,
    thumbnail: ThumbnailVariant,
    description: string,
    keyFeatures: string[],
    pros: string[],
    cons: string[]
  ) => Alternative

  const make: MakeFn = (
    idSuffix, name, type, score, costFactor, thumbnail, description, keyFeatures, pros, cons
  ) => ({
    id: `alt-${idSuffix}`,
    projectId,
    name,
    type,
    score,
    thumbnail,
    description,
    keyFeatures,
    pros,
    cons,
    estimatedCost: {
      minIDR: Math.round((base * costFactor * 0.92) / 1_000_000) * 1_000_000,
      maxIDR: Math.round((base * costFactor * 1.12) / 1_000_000) * 1_000_000,
    },
    readiness,
    risks: brief.risks
      .filter((r) => r.level !== "info")
      .slice(0, 2)
      .map((r) => ({ level: r.level, label: r.title })),
    areaM2: builtArea,
    roomCount: rooms,
    floors: brief.building.floors,
  })

  return [
    make(
      "lega", "Terasa Lega", "terasa_lega", 87, 1.05, "courtyard",
      "Memprioritaskan kesan lapang dan cahaya dengan void/bukaan strategis.",
      ["Void untuk cahaya", "Ruang publik menyatu", "Sirkulasi udara baik"],
      ["Terasa paling lega", "Cahaya alami maksimal"],
      ["Void mengurangi luas lantai"]
    ),
    make(
      "keluarga", "Keluarga Besar", "keluarga_besar", 83, 1.0, "family",
      "Memaksimalkan jumlah kamar dan ruang kumpul untuk keluarga besar.",
      ["Area kumpul luas", "Kamar maksimal", "Dapur + ruang makan menyatu"],
      ["Kapasitas besar", "Fleksibel"],
      ["Kamar relatif kompak"]
    ),
    make(
      "hemat", "Hemat Biaya", "hemat_biaya", 79, 0.9, "vertical",
      "Tata ruang efisien dan struktur sederhana untuk menekan biaya.",
      ["Struktur sederhana", "Luas lantai maksimal", "Mudah dibangun"],
      ["Paling hemat", "Cepat dibangun"],
      ["Kurang dramatis"]
    ),
  ]
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { userId } = await requireUser(request)

    // 6/menit/user — cukup untuk regenerate ulang-alik wajar (tiap panggilan
    // memotong 1 kredit & memicu LLM background), ketat terhadap spam.
    const limited = rateLimitGuard(request, {
      scope: "alternatives-generate",
      limit: 6,
      windowMs: 60_000,
      keyExtra: userId,
    })
    if (limited) return limited

    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)
    if (!project) return err(404, "Project not found")

    const brief = await getBriefPayload(id)
    if (!brief) return err(404, "Brief not found")

    // Credit gate — reserved BEFORE the (background) LLM call, refunded if it
    // fails. This is the only LLM call this route makes; buildAlternatives
    // below is pure/deterministic. See §Enforcement in the design doc.
    const spend = await spendCredits(userId, 1, "generate_alternatives", id)
    if (spend === "insufficient") {
      return errCode(
        402,
        "insufficient_credits",
        "Kredit AI Anda telah habis. Upgrade plan untuk melanjutkan."
      )
    }

    const base = buildAlternatives(id, brief)
    await upsertAlternatives(id, base)
    await updateProject(id, userId, { status: "alternatives" })

    // Enrich narrative via NVIDIA NIM in the BACKGROUND (the LLM is slow). The
    // client gets the deterministic set instantly and refetches to pick up the
    // AI-enriched copy. Costs/area/readiness are already correct & untouched.
    // The 1 credit reserved above covers this background call — refund it
    // both when enrichment throws AND when it fails silently. The realistic
    // failure mode is NOT an exception: enrichAlternatives resolves to the
    // SAME `base` reference when the LLM is unavailable/times out/returns
    // malformed JSON (see enrich-alternatives.ts's `if (!out?.items?.length)
    // return alts` fallback) — refund on that signal too. Note: by the time
    // this runs, the response has already been sent, so a failure here can
    // never surface as an HTTP error to the client; refunding is the one
    // failure-path side effect we can still perform. (A restart/crash of the
    // process before this background job completes is a separate, accepted
    // residual-risk window — see design doc.)
    after(async () => {
      try {
        const enriched = await enrichAlternatives(base, brief)
        if (enriched !== base) {
          await upsertAlternatives(id, enriched)
        } else {
          // enrichAlternatives returns the same reference on failure (LLM
          // unavailable/timeout/malformed) — this is the realistic failure mode,
          // not a thrown exception. Refund the reserved credit either way.
          await refundCredits(userId, 1, "generate_alternatives_refund", id)
        }
      } catch (e) {
        console.error("[enrich-bg]", e instanceof Error ? e.message : e)
        await refundCredits(userId, 1, "generate_alternatives_refund", id)
      }
    })

    return ok(base)
  } catch (e) {
    return handleError(e)
  }
}
