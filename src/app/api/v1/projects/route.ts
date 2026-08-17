import { nanoid } from "nanoid"
import { requireUser } from "@/lib/server/auth-server"
import { listProjectsByOwner, createProject } from "@/lib/server/repo/projects"
import { upsertBrief } from "@/lib/server/repo/briefs"
import { getEntitlements } from "@/lib/server/entitlements"
import { ok, err, errCode, handleError } from "@/lib/server/response"
import { createProjectSchema } from "@/lib/schemas/project"
import type { ReadinessStatus, ThumbnailVariant, Site } from "@/types"
import type { CreateProjectInput } from "@/lib/schemas/project"
import { nanoid as nano } from "nanoid"
import type { SpaceProgramItem, RiskWarning, Brief } from "@/types"
import { ROOM_TYPES } from "@/lib/constants"

/* ---- pure helpers (mirror of mock/index.ts logic) ---- */

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

function buildRisks(opts: {
  floors: number
  hasPool: boolean
  rooftop: boolean
  narrow: boolean
}): RiskWarning[] {
  const risks: RiskWarning[] = []
  if (opts.floors >= 3) {
    risks.push({
      id: nano(6),
      level: "warning",
      category: "structural",
      title: `Bangunan ${opts.floors} lantai`,
      message: "Struktur bertingkat tinggi perlu ditinjau engineer struktur sebelum dibangun.",
    })
  }
  if (opts.hasPool) {
    risks.push({
      id: nano(6),
      level: "warning",
      category: "structural",
      title: "Kolam",
      message: "Kolam menambah beban dan kebutuhan waterproofing. Perlu review struktur & MEP.",
    })
  }
  if (opts.rooftop) {
    risks.push({
      id: nano(6),
      level: "info",
      category: "structural",
      title: "Rooftop",
      message: "Pastikan beban rooftop dan pengaman (railing) sesuai standar.",
    })
  }
  if (opts.narrow) {
    risks.push({
      id: nano(6),
      level: "info",
      category: "spatial",
      title: "Cahaya & ventilasi",
      message: "Lahan sempit / menempel tetangga. Pertimbangkan void atau skylight agar terang dan adem.",
    })
  }
  return risks
}

function buildConstraints(input: CreateProjectInput): string[] {
  const c: string[] = []
  if (input.widthM < 7) c.push("Lahan relatif sempit di sisi lebar.")
  if (input.sidesAttached > 0)
    c.push(`${input.sidesAttached} sisi menempel tetangga (bukaan terbatas).`)
  if (input.floors >= 2)
    c.push("Sirkulasi vertikal (tangga) memakan area tiap lantai.")
  if ((input.frontRoadWidthM ?? 0) > 0 && (input.frontRoadWidthM ?? 0) < 4)
    c.push("Jalan depan sempit, perhatikan akses material.")
  if (c.length === 0) c.push("Tidak ada kendala lahan yang menonjol.")
  return c
}

function spaceProgramFromInput(input: CreateProjectInput): SpaceProgramItem[] {
  const items: SpaceProgramItem[] = input.rooms.map((r) => ({
    id: nano(8),
    roomType: r.roomType,
    name: r.name || ROOM_TYPES[r.roomType].label,
    required: r.required,
    quantity: r.quantity,
    preferredFloor: r.preferredFloor,
    sizePreference: r.sizePreference,
    notes: r.notes,
  }))
  if (input.carport && !items.some((i) => i.roomType === "carport")) {
    items.unshift({
      id: nano(8),
      roomType: "carport",
      name: "Carport",
      required: true,
      quantity: 1,
      preferredFloor: 1,
    })
  }
  return items
}

/* ---- routes ---- */

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const projects = await listProjectsByOwner(userId)
    return ok(projects)
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const body = await request.json()
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid input")
    }
    const input = parsed.data

    // Plan quota gate — server is the only trustworthy enforcement layer
    // (see docs/superpowers/specs/2026-07-05-mayar-billing-admin-design.md
    // §Enforcement). Checked before any create side effect.
    const entitlements = await getEntitlements(userId)
    const existing = await listProjectsByOwner(userId)
    if (existing.length >= entitlements.maxProjects) {
      return errCode(
        403,
        "plan_limit_projects",
        "Batas jumlah proyek pada plan Anda sudah tercapai. Upgrade plan untuk menambah proyek."
      )
    }

    const areaM2 = round1(input.widthM * input.depthM)
    const hasPool = input.rooms.some((r) => r.roomType === "kolam")
    const narrow = input.widthM < 7 || input.sidesAttached > 0
    const readiness = computeReadiness({ floors: input.floors, hasPool, rooftop: input.rooftop })

    const id = `proj-${nanoid(8)}`
    const thumbnail: ThumbnailVariant = hasPool
      ? "courtyard"
      : input.floors >= 3
      ? "vertical"
      : "family"

    const site: Site = {
      widthM: input.widthM,
      depthM: input.depthM,
      areaM2,
      city: input.city,
      frontOrientation: input.frontOrientation,
      sidesAttached: input.sidesAttached,
      frontRoadWidthM: input.frontRoadWidthM,
      notes: input.siteNotes,
      regulation: input.regulation,
    }

    const project = await createProject({
      id,
      ownerId: userId,
      name: input.name,
      status: "brief",
      readiness,
      projectType: input.projectType,
      location: input.city,
      city: input.city,
      style: input.style,
      thumbnail,
      floors: input.floors,
      rooftop: input.rooftop,
      site,
    })

    const labelType = input.projectType === "renovation" ? "Renovasi rumah" : "Rumah baru"
    const brief: Brief = {
      projectId: id,
      summary: `${labelType} ${input.floors} lantai${input.rooftop ? " + rooftop" : ""} di tanah ${input.widthM}×${input.depthM} m, ${input.city}. Gaya ${input.style}.`,
      site,
      building: {
        floors: input.floors,
        rooftop: input.rooftop,
        budget: { minIDR: input.budgetMinIDR, maxIDR: input.budgetMaxIDR },
        finishingLevel: input.finishingLevel,
      },
      priorities: input.priorities,
      spaceProgram: spaceProgramFromInput(input),
      assumptions: [
        "Tanah relatif datar dan kering.",
        "Akses jalan depan cukup untuk material standar.",
        "Sumber air dan listrik tersedia di lokasi.",
        "Tinggi antar lantai 3,2 m (standar rumah tinggal).",
      ],
      constraints: buildConstraints(input),
      risks: buildRisks({ floors: input.floors, hasPool, rooftop: input.rooftop, narrow }),
    }

    await upsertBrief(id, brief)

    return ok({ project, brief })
  } catch (e) {
    return handleError(e)
  }
}
