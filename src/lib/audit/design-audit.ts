/**
 * Design-Audit engine — the grounded "brain" the AI assistant speaks from.
 *
 * A single pure function that runs a whole house design against Indonesian
 * standards (see standards.ts) and the app's existing structural/sanitation
 * engines, and returns a prioritized, plain-Indonesian report a layperson can
 * act on: WHAT is wrong, WHY (which standard), and the concrete FIX. Zero LLM,
 * zero hallucination — every number is computed. The assistant layer wraps this
 * to explain conversationally and offer to apply fixes.
 *
 * Deliberately additive/read-only: it never mutates the layout. Findings carry
 * enough structure (category, severity, objectId, standard, fix) for both a UI
 * panel and an LLM prompt.
 */
import type { Brief, DesignLayout, ExteriorSurfaceElement, Opening, Project, Room } from "@/types"
import { skylightAreaServingRoom, roomUnderFlatRoof } from "@/lib/geometry/roof-holes"
import { openingServesRoom, rectsOverlap, roomArea, parseOpeningWall, openingSegment } from "@/lib/geometry"
import { OPEN_TYPES } from "@/lib/three/build-model"
import { analyzeRoomConnectivity } from "@/lib/geometry/connectivity"
import { buildingFootprintArea } from "@/lib/structural/grid"
import { structuralNotes } from "@/lib/validation"
import {
  groundFloorIds,
  sanitationObstacles,
} from "@/lib/water/sanitation"
import { sanitationOverlapSeverity } from "@/lib/validation"
import { isMezzanineFloor, isRooftopFloor, mezzanineParentOf } from "@/lib/editor/floors"
import { floorElevations, stairRiseM } from "@/lib/geometry/vertical"
import { interiorStairSpec } from "@/lib/stairs/geometry"
import { polygonArea } from "@/lib/exterior/geometry"
import {
  GSB_ROAD_FRACTION,
  MAX_KDB,
  MAX_KLB,
  MIN_CEILING_M,
  MIN_DOOR_WIDTH_M,
  MIN_HEALTHY_HOUSE_AREA_M2,
  MIN_KDH,
  MIN_MEZZANINE_CLEAR_M,
  MIN_MEZZANINE_TOTAL_M,
  MIN_STAIR_WIDTH_M,
  MIN_WINDOW_TO_FLOOR_RATIO,
  NARROW_ATTACHED_WIDTH_M,
  ROOM_STANDARDS,
  SEPTIC_MIN_DIST_TO_BUILDING_M,
  STAIR_MAX_STEPS_NO_LANDING,
  STAIR_RISER_MAX_M,
  STAIR_RISER_MIN_M,
} from "./standards"

export type AuditSeverity = "critical" | "warning" | "advisory"
export type AuditCategory =
  | "ruang"
  | "cahaya"
  | "sirkulasi"
  | "struktur"
  | "sanitasi"
  | "regulasi"

export type AuditFinding = {
  id: string
  category: AuditCategory
  severity: AuditSeverity
  /** One-line, plain Indonesian, layperson-readable. */
  title: string
  /** Why it matters + how it was measured. */
  detail: string
  /** The standard/regulation cited, if any (e.g. "SNI 03-1733-2004"). */
  standard?: string
  /** Concrete, actionable fix in plain language. */
  fix?: string
  /** Related room/object id, if the finding is spatial. */
  objectId?: string
}

export type AuditCategoryScore = {
  category: AuditCategory
  score: number
  findings: number
}

export type DesignAudit = {
  /** 0–100 overall design-health score. */
  score: number
  /** One-line plain-Indonesian verdict. */
  summary: string
  findings: AuditFinding[]
  byCategory: AuditCategoryScore[]
  /** Counts by severity for quick UI badges. */
  counts: { critical: number; warning: number; advisory: number }
}

const SEVERITY_WEIGHT: Record<AuditSeverity, number> = {
  critical: 15,
  warning: 6,
  advisory: 2,
}

const CATEGORIES: AuditCategory[] = [
  "ruang",
  "cahaya",
  "sirkulasi",
  "struktur",
  "sanitasi",
  "regulasi",
]

const ROOFTOP_FLOOR_ID = "floor-rooftop"

type AuditInput = {
  project: Pick<Project, "floors" | "rooftop" | "readiness" | "site">
  layout: DesignLayout
  brief?: Brief | null
}

/** Run the full standards audit. Never throws on malformed input — missing
 *  pieces simply produce fewer findings. */
export function auditDesign(input: AuditInput): DesignAudit {
  const { project, layout } = input
  const site = project.site
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const findings: AuditFinding[] = []

  findings.push(...auditRooms(rooms))
  findings.push(...auditDaylight(rooms, layout))
  findings.push(...auditCirculation(layout))
  findings.push(...auditRoomAccess(layout))
  findings.push(...auditStructure(project, layout))
  findings.push(...auditSanitation(layout))
  findings.push(...auditRegulatory(project, layout, site))
  findings.push(...auditKdh(layout, site))
  findings.push(...auditLotLineOpenings(layout, site))
  findings.push(...auditNarrowAttachedLight(layout, site))
  findings.push(...auditCeilingHeights(layout))
  findings.push(...auditStairs(layout))
  findings.push(...auditProgram(rooms, input.brief))

  return summarize(findings)
}

/* ------------------------------------------------------------------ */
/* Ruang — per-room area & dimension vs SNI 03-1733 / ergonomics       */
/* ------------------------------------------------------------------ */

function auditRooms(rooms: Room[]): AuditFinding[] {
  const out: AuditFinding[] = []
  for (const room of rooms) {
    const spec = ROOM_STANDARDS[room.type]
    if (!spec) continue
    const area = Number.isFinite(room.areaM2) ? room.areaM2 : roomArea(room.width, room.depth)
    const shortSide = Math.min(room.width, room.depth)

    if (area + 0.05 < spec.minAreaM2) {
      out.push({
        id: `ruang-area:${room.id}`,
        category: "ruang",
        severity: area < spec.minAreaM2 * 0.7 ? "critical" : "warning",
        title: `${room.name} lebih kecil dari standar (${area.toFixed(1)} m² < ${spec.minAreaM2} m²)`,
        detail: `${spec.label} yang layak huni minimal ${spec.minAreaM2} m² menurut norma rumah sehat sederhana. Saat ini ${area.toFixed(1)} m².`,
        standard: "SNI 03-1733-2004",
        fix: `Perbesar ${room.name} hingga minimal ${spec.minAreaM2} m², atau gabungkan dengan ruang bersebelahan.`,
        objectId: room.id,
      })
    }
    if (shortSide + 0.02 < spec.minWidthM) {
      out.push({
        id: `ruang-lebar:${room.id}`,
        category: "ruang",
        severity: "warning",
        title: `${room.name} terlalu sempit (sisi terpendek ${shortSide.toFixed(2)} m < ${spec.minWidthM} m)`,
        detail: `Sisi terpendek ${spec.label.toLowerCase()} sebaiknya ≥ ${spec.minWidthM} m agar furnitur & sirkulasi muat.`,
        standard: "Ergonomi ruang",
        fix: `Lebarkan ${room.name} agar sisi terpendeknya ≥ ${spec.minWidthM} m.`,
        objectId: room.id,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Cahaya — window-to-floor ratio for habitable rooms                  */
/* ------------------------------------------------------------------ */

/**
 * Ruang terbuka (taman/kolam/void) di SEBERANG sebuah jendela dari sudut
 * pandang `room` — jendela ke courtyard hanya layak kredit cahaya bila
 * courtyard-nya openToSky (tertutup atap = gelap; false pass temuan audit
 * ARSITEKTUR_MODERN). Null = jendela menghadap eksterior/tetangga biasa.
 */
function courtNeighborAcrossOpening(
  opening: Pick<Opening, "wallId" | "positionM" | "widthM" | "floorId">,
  room: Room,
  allRooms: Room[],
): Room | null {
  const parsed = parseOpeningWall(opening.wallId)
  if (!parsed) return null
  const host = allRooms.find((r) => r.id === parsed.roomId)
  if (!host) return null
  const seg = openingSegment(host, parsed.side, opening.positionM, opening.widthM)
  const tol = 0.12
  const MIN_SHARED = 0.1
  const horizontal = parsed.side === "n" || parsed.side === "s"
  const line = horizontal ? seg.y1 : seg.x1
  const roomCenter = horizontal ? room.y + room.depth / 2 : room.x + room.width / 2
  for (const o of allRooms) {
    if (o.id === room.id || o.floorId !== room.floorId) continue
    if (o.type !== "taman" && o.type !== "kolam" && o.type !== "void") continue
    const oCenter = horizontal ? o.y + o.depth / 2 : o.x + o.width / 2
    if ((roomCenter < line) === (oCenter < line)) continue // bukan seberang
    if (horizontal) {
      const onB = Math.abs(o.y - line) <= tol || Math.abs(o.y + o.depth - line) <= tol
      const overlap = Math.min(seg.x2, o.x + o.width) - Math.max(seg.x1, o.x)
      if (onB && overlap > MIN_SHARED) return o
    } else {
      const onB = Math.abs(o.x - line) <= tol || Math.abs(o.x + o.width - line) <= tol
      const overlap = Math.min(seg.y2, o.y + o.depth) - Math.max(seg.y1, o.y)
      if (onB && overlap > MIN_SHARED) return o
    }
  }
  return null
}

function auditDaylight(rooms: Room[], layout: DesignLayout): AuditFinding[] {
  const openings = Array.isArray(layout.openings) ? layout.openings : []
  const out: AuditFinding[] = []
  for (const room of rooms) {
    const spec = ROOM_STANDARDS[room.type]
    if (!spec?.habitable) continue
    const area = Number.isFinite(room.areaM2) ? room.areaM2 : roomArea(room.width, room.depth)
    if (area <= 0) continue
    // Jendela di dinding BERSAMA terdaftar pada satu wallId tapi menerangi
    // kedua sisi — hitung via geometri (openingServesRoom), bukan kepemilikan.
    const windowArea = openings
      .filter((o) => {
        if (o.type !== "window" || !o.wallId || !openingServesRoom(o, room, rooms))
          return false
        // Jendela ke courtyard beratap tidak dikredit (gelap); openToSky OK.
        const court = courtNeighborAcrossOpening(o, room, rooms)
        return !court || court.openToSky === true
      })
      .reduce((sum, o) => sum + (o.widthM || 0) * (o.heightM || 0), 0)
    // Kredit cahaya ZENITHAL: skylight yang menaungi ruang dihitung penuh
    // (pencahayaan atas ≥ jendela dinding utk luas sama).
    const skyArea = skylightAreaServingRoom(layout, room)
    const lightArea = windowArea + skyArea
    const ratio = lightArea / area
    if (ratio + 1e-6 < MIN_WINDOW_TO_FLOOR_RATIO) {
      const hasNone = lightArea <= 0
      const skylightHint = roomUnderFlatRoof(layout, room)
        ? ` Alternatif: tambah skylight di atasnya (kartu Atap → + Skylight).`
        : ""
      out.push({
        id: `cahaya:${room.id}`,
        category: "cahaya",
        severity: hasNone ? "warning" : "advisory",
        title: hasNone
          ? `${room.name} belum punya jendela`
          : `Bukaan cahaya ${room.name} kurang luas (${(ratio * 100).toFixed(0)}% < 10% luas lantai)`,
        detail: `Ruang huni butuh bukaan cahaya ≥ 10% luas lantai (${(area * MIN_WINDOW_TO_FLOOR_RATIO).toFixed(2)} m²). Saat ini ${lightArea.toFixed(2)} m²${skyArea > 0 ? ` (termasuk skylight ${skyArea.toFixed(2)} m²)` : ""}.`,
        standard: "SNI 03-6572-2001",
        fix: `Tambah/lebarkan jendela di dinding luar ${room.name} hingga total ≥ ${(area * MIN_WINDOW_TO_FLOOR_RATIO).toFixed(2)} m².${skylightHint}`,
        objectId: room.id,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Sirkulasi — door clear widths                                       */
/* ------------------------------------------------------------------ */

/**
 * Ruang tertutup yang tidak punya PINTU sama sekali — tidak bisa dimasuki.
 *
 * Celah nyata yang terukur: validasi yang ada hanya menuntut ada BUKAAN untuk
 * ventilasi, jadi ruang yang punya JENDELA tapi tanpa pintu lolos tanpa
 * peringatan apa pun. Pada denah produksi ditemukan 44 ruang seperti itu —
 * termasuk kamar tidur dan dapur yang secara harfiah tak terjangkau.
 *
 * Memakai openingServesRoom() milik app: satu pintu di dinding bersama
 * melayani KEDUA sisi, jadi pintu yang digambar di dinding tetangga tetap
 * dihitung sebagai akses (menghitung by-wallId saja memberi hasil keliru).
 */
function auditRoomAccess(layout: DesignLayout): AuditFinding[] {
  const openings = Array.isArray(layout.openings) ? layout.openings : []
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const doors = openings.filter((o) => o.type === "door")
  const out: AuditFinding[] = []

  // (1) Tidak punya pintu sama sekali.
  const doorless = new Set<string>()
  for (const room of rooms) {
    // Ruang terbuka (carport/taman/teras/balkon/void…) memang tanpa daun pintu.
    if (OPEN_TYPES.includes(room.type)) continue
    if (doors.some((d) => openingServesRoom(d, room, rooms))) continue
    doorless.add(room.id)
    out.push({
      id: `sirkulasi-akses:${room.id}`,
      category: "sirkulasi",
      severity: "warning",
      title: `${room.name} belum punya pintu`,
      detail:
        `${room.name} tertutup dinding tanpa pintu, jadi belum bisa diakses. ` +
        `Jendela saja tidak cukup — itu hanya memenuhi kebutuhan ventilasi.`,
      standard: "Aksesibilitas ruang",
      fix: `Tambahkan pintu pada salah satu dinding ${room.name} yang berbatasan dengan ruang sirkulasi.`,
      objectId: room.id,
    })
  }

  // (2) Punya pintu, TAPI terputus dari inti rumah. Memeriksa keberadaan
  //     pintu saja tak cukup: sebuah kamar bisa punya pintu ke halaman dan
  //     pintu ke kamar mandinya sendiri, dan tetap tak terjangkau dari ruang
  //     keluarga — persis keluhan "pintunya hanya keluar rumah".
  const { isolated, withExteriorDoor } = analyzeRoomConnectivity(rooms, openings)
  for (const room of isolated) {
    if (doorless.has(room.id)) continue // sudah dilaporkan di (1)
    const viaOutside = withExteriorDoor.has(room.id)
    out.push({
      id: `sirkulasi-terputus:${room.id}`,
      category: "sirkulasi",
      severity: "warning",
      title: `${room.name} tidak terhubung ke dalam rumah`,
      detail: viaOutside
        ? `${room.name} hanya bisa dicapai dari luar rumah — penghuni harus keluar dulu untuk masuk ke sini.`
        : `${room.name} terputus dari bagian rumah lainnya; tak ada jalur pintu menuju ke sana.`,
      standard: "Aksesibilitas ruang",
      fix: `Tambahkan pintu yang menghubungkan ${room.name} dengan ruang sirkulasi di dalam rumah (mis. ruang keluarga atau koridor).`,
      objectId: room.id,
    })
  }
  return out
}

function auditCirculation(layout: DesignLayout): AuditFinding[] {
  const openings = Array.isArray(layout.openings) ? layout.openings : []
  const out: AuditFinding[] = []
  for (const o of openings) {
    if (o.type !== "door") continue
    if ((o.widthM || 0) + 1e-6 < MIN_DOOR_WIDTH_M) {
      out.push({
        id: `sirkulasi-pintu:${o.id}`,
        category: "sirkulasi",
        severity: "advisory",
        title: `Pintu terlalu sempit (${(o.widthM || 0).toFixed(2)} m < ${MIN_DOOR_WIDTH_M} m)`,
        detail: `Lebar bersih daun pintu sebaiknya ≥ ${MIN_DOOR_WIDTH_M} m agar mudah dilewati (dan ramah kursi roda pada pintu utama).`,
        standard: "Ergonomi sirkulasi",
        fix: `Lebarkan pintu ini menjadi ≥ ${MIN_DOOR_WIDTH_M} m.`,
        objectId: o.id,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Struktur — reuse the existing SNI-approach takedown notes           */
/* ------------------------------------------------------------------ */

function auditStructure(
  project: Pick<Project, "floors" | "rooftop" | "readiness">,
  layout: DesignLayout,
): AuditFinding[] {
  const notes = structuralNotes(project, layout)
  return notes.map((n) => {
    const severity: AuditSeverity =
      n.level === "danger" ? "critical" : n.level === "warning" ? "warning" : "advisory"
    return {
      id: `struktur:${n.id}`,
      category: "struktur",
      severity,
      title: n.message,
      detail:
        n.id === "struct:span"
          ? "Bentang yang mencapai batas menuntut balok lebih tinggi atau kolom tambahan agar lendutan aman."
          : n.id === "struct:deep-foundation"
            ? "Beban besar / daya dukung tanah rendah — pondasi dangkal biasa mungkin tak cukup."
            : "Perkiraan dimensi struktur dari perhitungan takedown beban internal (pendekatan SNI beton).",
      standard: "SNI 2847 / 1727 (pendekatan)",
      fix:
        severity === "advisory"
          ? "Informasi ukuran; konfirmasi dengan gambar kerja struktur."
          : "Tinjau bersama engineer struktur sebelum konstruksi.",
    }
  })
}

/* ------------------------------------------------------------------ */
/* Sanitasi — reuse sanitation overlap severity + septic clearance     */
/* ------------------------------------------------------------------ */

function auditSanitation(layout: DesignLayout): AuditFinding[] {
  const out: AuditFinding[] = []
  const sanitationRects = sanitationObstacles(layout.sanitation)
  if (sanitationRects.length === 0) return out
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const groundIds = groundFloorIds(layout.floors)

  for (const room of rooms) {
    if (!groundIds.has(room.floorId)) continue
    for (const obj of sanitationRects) {
      const sev = sanitationOverlapSeverity(room.type, obj.kind)
      if (!sev) continue
      if (!rectsOverlap(room, obj.rect)) continue
      const severity: AuditSeverity =
        sev === "danger" ? "critical" : sev === "warning" ? "warning" : "advisory"
      out.push({
        id: `sanitasi:${room.id}:${obj.label}`,
        category: "sanitasi",
        severity,
        title: `${obj.label} berada di bawah ${room.name}`,
        detail:
          obj.kind === "soakwell"
            ? "Sumur resapan butuh tanah terbuka untuk meresap; di bawah ruang huni fungsinya hilang."
            : obj.kind === "septic"
              ? `Septic tank di bawah ruang menyulitkan akses sedot & ventilasi gas; jaga jarak ≥ ${SEPTIC_MIN_DIST_TO_BUILDING_M} m dari struktur bila memungkinkan.`
              : "Bak kontrol perlu tutup akses inspeksi yang mudah dijangkau di lantai.",
        standard: obj.kind === "soakwell" ? "SNI 8456:2017" : "SNI 2398:2017",
        fix:
          obj.kind === "soakwell"
            ? "Pindahkan sumur resapan ke taman/halaman terbuka."
            : "Idealnya pindahkan ke bawah carport/taman, atau sediakan akses inspeksi.",
        objectId: room.id,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Regulasi — KDB / KLB / GSB                                          */
/* ------------------------------------------------------------------ */

function auditRegulatory(
  project: Pick<Project, "floors">,
  layout: DesignLayout,
  site: Project["site"],
): AuditFinding[] {
  const out: AuditFinding[] = []
  const lotArea = site?.areaM2 && site.areaM2 > 0 ? site.areaM2 : (site?.widthM || 0) * (site?.depthM || 0)
  if (lotArea <= 0) return out

  const footprint = buildingFootprintArea(layout)
  const kdb = footprint / lotArea
  const kdbOverride = site?.regulation?.maxKdb
  const maxKdb = typeof kdbOverride === "number" && kdbOverride > 0 ? kdbOverride : MAX_KDB
  if (kdb > maxKdb + 0.01) {
    out.push({
      id: "regulasi:kdb",
      category: "regulasi",
      severity: kdb > 0.8 ? "warning" : "advisory",
      title: `KDB ${(kdb * 100).toFixed(0)}% melebihi ${(maxKdb * 100).toFixed(0)}%`,
      detail: `Koefisien Dasar Bangunan = luas lantai dasar (${footprint.toFixed(1)} m²) / luas kavling (${lotArea.toFixed(1)} m²). ${
        typeof kdbOverride === "number"
          ? `Batas KDB yang Anda isi untuk lokasi ini ${(maxKdb * 100).toFixed(0)}%.`
          : `Banyak perda membatasi maksimal ${(maxKdb * 100).toFixed(0)}% untuk hunian agar ada resapan air.`
      }`,
      standard: typeof kdbOverride === "number" ? "KDB (sesuai angka Perda yang Anda isi)" : "KDB (default nasional — cek Perda setempat)",
      fix: "Sisakan lebih banyak lahan terbuka (taman/halaman), atau cek batas KDB zona Anda.",
    })
  }

  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const totalFloorArea = rooms
    .filter((r) => r.floorId !== ROOFTOP_FLOOR_ID && r.type !== "taman" && r.type !== "kolam")
    .reduce((sum, r) => sum + (Number.isFinite(r.areaM2) ? r.areaM2 : roomArea(r.width, r.depth)), 0)
  const klb = totalFloorArea / lotArea
  const klbOverride = site?.regulation?.maxKlb
  const maxKlb = typeof klbOverride === "number" && klbOverride > 0 ? klbOverride : MAX_KLB
  if (klb > maxKlb + 0.01) {
    out.push({
      id: "regulasi:klb",
      category: "regulasi",
      severity: "advisory",
      title: `KLB ${klb.toFixed(2)} melebihi acuan ${maxKlb.toFixed(1)}`,
      detail: `Koefisien Lantai Bangunan = total luas semua lantai (${totalFloorArea.toFixed(1)} m²) / luas kavling (${lotArea.toFixed(1)} m²). ${
        typeof klbOverride === "number"
          ? `Batas KLB yang Anda isi untuk lokasi ini ${maxKlb.toFixed(1)}.`
          : "Cek batas KLB zona Anda."
      }`,
      standard: typeof klbOverride === "number" ? "KLB (sesuai angka Perda yang Anda isi)" : "KLB (default nasional — cek Perda setempat)",
      fix: "Kurangi total luas lantai atau konfirmasi batas KLB zona.",
    })
  }

  // GSB: is there any building setback from the front (y=0) edge? An
  // explicit gsbM override WINS over the ½-road-width formula (it's the
  // real number from the user's Perda, not an estimate).
  const road = site?.frontRoadWidthM
  const gsbOverride = site?.regulation?.gsbM
  const hasOverride = typeof gsbOverride === "number" && gsbOverride > 0
  const requiredGsb = hasOverride ? gsbOverride : road && road > 0 ? road * GSB_ROAD_FRACTION : null
  if (requiredGsb !== null) {
    const frontSetback = minFrontSetback(rooms)
    if (frontSetback + 0.05 < requiredGsb) {
      out.push({
        id: "regulasi:gsb",
        category: "regulasi",
        severity: "advisory",
        title: `Sempadan depan ${frontSetback.toFixed(1)} m kurang dari ${requiredGsb.toFixed(1)} m`,
        detail: hasOverride
          ? `Garis Sempadan Bangunan (GSB) depan yang Anda isi untuk lokasi ini ${requiredGsb.toFixed(1)} m. Setback bangunan terdepan saat ini ${frontSetback.toFixed(1)} m.`
          : `Garis Sempadan Bangunan (GSB) depan umumnya ≥ ½ lebar jalan (${road} m ÷ 2 = ${requiredGsb.toFixed(1)} m). Setback bangunan terdepan saat ini ${frontSetback.toFixed(1)} m.`,
        standard: hasOverride ? "GSB (sesuai angka Perda yang Anda isi)" : "GSB (default nasional — cek Perda setempat)",
        fix: `Mundurkan bangunan dari batas depan hingga ≥ ${requiredGsb.toFixed(1)} m (mis. carport/teras terbuka di depan).`,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Regulasi — KDH (Koefisien Dasar Hijau)                              */
/* ------------------------------------------------------------------ */

/** Luas perkerasan (driveway/walkway) — dihitung MENGURANGI area hijau/
 *  resapan. `terrace_surface`/`garden_bed` sengaja TIDAK dihitung (bisa
 *  berpori/bervegetasi; scope Tier 1 mengikuti checklist domain-knowledge
 *  §5 apa adanya). */
function pavedAreaM2(layout: DesignLayout): number {
  const elements = Array.isArray(layout.exteriorElements) ? layout.exteriorElements : []
  return elements
    .filter((e): e is ExteriorSurfaceElement => e.kind === "driveway" || e.kind === "walkway")
    .reduce((sum, e) => sum + polygonArea(e.points ?? []), 0)
}

function auditKdh(layout: DesignLayout, site: Project["site"]): AuditFinding[] {
  const lotArea = site?.areaM2 && site.areaM2 > 0 ? site.areaM2 : (site?.widthM || 0) * (site?.depthM || 0)
  if (lotArea <= 0) return []
  const footprint = buildingFootprintArea(layout)
  const paved = pavedAreaM2(layout)
  const openArea = Math.max(0, lotArea - footprint - paved)
  const kdh = openArea / lotArea
  const override = site?.regulation?.minKdh
  const threshold = typeof override === "number" && override > 0 ? override : MIN_KDH
  if (kdh + 0.01 >= threshold) return []
  return [
    {
      id: "regulasi:kdh",
      category: "regulasi",
      severity: "advisory",
      title: `KDH ${(kdh * 100).toFixed(0)}% di bawah ${(threshold * 100).toFixed(0)}%`,
      detail: `Koefisien Dasar Hijau = luas lahan terbuka/resapan air (${openArea.toFixed(1)} m² = kavling ${lotArea.toFixed(1)} m² − lantai dasar ${footprint.toFixed(1)} m² − perkerasan ${paved.toFixed(1)} m²) dibagi luas kavling.`,
      standard: typeof override === "number" ? "KDH (sesuai angka Perda yang Anda isi)" : "KDH (default nasional 20% — cek Perda setempat)",
      fix: "Kurangi perkerasan (driveway/carport beraspal) atau sisakan lebih banyak taman/area resapan air.",
    },
  ]
}

/* ------------------------------------------------------------------ */
/* Regulasi — 0-lot-line: larangan bukaan di dinding batas kavling     */
/* ------------------------------------------------------------------ */

/**
 * `site.sidesAttached >= 1` → kavling menempel tetangga di sisi samping
 * (barat/timur — depan/belakang punya aturan GSB sendiri). Domain-knowledge
 * §2: dinding yang FLUSH dengan batas kavling wajib TANPA bukaan apa pun
 * (jendela/ventilasi/pintu). Sisi samping = wallId `:w` (room.x ≈ 0) atau
 * `:e` (room.x+width ≈ site.widthM) — konvensi diverifikasi di
 * lib/geometry/index.ts (openingSegment: "w" = x=room.x, "e" = x=room.x+width).
 */
function auditLotLineOpenings(layout: DesignLayout, site: Project["site"]): AuditFinding[] {
  const attached = site?.sidesAttached ?? 0
  if (attached < 1) return []
  const widthM = site?.widthM ?? 0
  if (widthM <= 0) return []
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const openings = Array.isArray(layout.openings) ? layout.openings : []
  const tol = 0.05
  const severity: AuditSeverity = attached >= 2 ? "warning" : "advisory"
  const out: AuditFinding[] = []
  for (const opening of openings) {
    const parsed = parseOpeningWall(opening.wallId)
    if (!parsed || (parsed.side !== "w" && parsed.side !== "e")) continue
    const host = rooms.find((r) => r.id === parsed.roomId && r.floorId === opening.floorId)
    if (!host) continue
    const onWest = parsed.side === "w" && Math.abs(host.x) <= tol
    const onEast = parsed.side === "e" && Math.abs(host.x + host.width - widthM) <= tol
    if (!onWest && !onEast) continue
    const kindLabel = opening.type === "door" ? "Pintu" : "Jendela/ventilasi"
    const sideLabel = onWest ? "barat" : "timur"
    out.push({
      id: `regulasi:lotline-opening:${opening.id}`,
      category: "regulasi",
      severity,
      title: `${kindLabel} di ${host.name} berada di dinding batas kavling (sisi ${sideLabel})`,
      detail:
        severity === "warning"
          ? `Kavling ini menempel tetangga di ${attached} sisi. Dinding yang flush dengan batas lahan (dinding ${sideLabel} ${host.name}) wajib TANPA bukaan apa pun — bukan preferensi estetika, tapi syarat teknis 0-lot-line di banyak Perda.`
          : `Salah satu sisi kavling ini menempel tetangga. Bukaan pada dinding ${sideLabel} ${host.name} tepat di batas lahan berisiko melanggar aturan 0-lot-line — pastikan dinding itu memang bukan dinding batas.`,
      standard: "0-lot-line (Kepmen PU 441/KPTS/1998)",
      fix: `Tutup/pindahkan bukaan ini dari dinding batas; alihkan cahaya & ventilasi ke void, courtyard, atau skylight di tengah rumah.`,
      objectId: opening.id,
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Cahaya — wajib sumber cahaya tengah pada lahan sempit diapit         */
/* ------------------------------------------------------------------ */

/**
 * Lebar kavling ≤ NARROW_ATTACHED_WIDTH_M & diapit tetangga di KEDUA sisi
 * (sidesAttached >= 2) → dinding samping tanpa bukaan di kedua sisi
 * (lihat auditLotLineOpenings), jadi rumah WAJIB punya void/courtyard
 * (taman/kolam/void openToSky) atau skylight sebagai sumber cahaya tengah
 * (domain-knowledge lahan sempit §3/§5).
 */
function auditNarrowAttachedLight(layout: DesignLayout, site: Project["site"]): AuditFinding[] {
  const widthM = site?.widthM ?? 0
  const attached = site?.sidesAttached ?? 0
  if (widthM <= 0 || widthM > NARROW_ATTACHED_WIDTH_M || attached < 2) return []
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const hasOpenVoidOrCourt = rooms.some(
    (r) => (r.type === "void" || r.type === "taman" || r.type === "kolam") && r.openToSky === true,
  )
  const hasSkylight = Array.isArray(layout.skylights) && layout.skylights.length > 0
  if (hasOpenVoidOrCourt || hasSkylight) return []
  return [
    {
      id: "pencahayaan:narrow-attached",
      category: "cahaya",
      severity: "warning",
      title: `Lahan sempit (lebar ${widthM} m) diapit tetangga di ${attached} sisi tanpa sumber cahaya tengah`,
      detail: `Dinding samping tanpa bukaan (0-lot-line) membuat cahaya & ventilasi alami hanya bisa masuk dari depan/belakang/atas. Tanpa void, courtyard, atau skylight, ruang di tengah denah berisiko gelap & pengap — keluhan #1 rumah lahan sempit.`,
      standard: "Domain-knowledge lahan sempit §3",
      fix: "Tambahkan void vertikal (idealnya di area tangga), courtyard mini terbuka (ruang taman/kolam dengan openToSky), atau skylight di ruang tengah (kartu Atap → + Skylight).",
    },
  ]
}

/* ------------------------------------------------------------------ */
/* Ruang — tinggi plafon minimum + syarat clearance mezzanine           */
/* ------------------------------------------------------------------ */

/**
 * Tinggi plafon per lantai REGULER dari tabel elevasi tunggal
 * (lib/geometry/vertical.ts) — `wallHM` = floor-to-floor − tebal slab,
 * angka yang SAMA dipakai 3D/gambar kerja, bukan `Floor.heightM` mentah
 * (yang floor-to-floor, termasuk slab). Mezzanine dicek terpisah: clearance
 * BAWAH = jarak platform ke lantai induknya (`baseY` mezzanine − `baseY`
 * induk, via `mezzanineParentOf` + tabel elevasi — otomatis benar baik
 * `baseOffsetM` eksplisit maupun default ½ floor-to-floor induk); clearance
 * ATAS = `wallHM` mezzanine itu sendiri (floor.heightM mezzanine adalah
 * "tinggi ruang mezzanine-nya sendiri" per dokumentasi tipe Floor); total =
 * clearance bawah + floor-to-floor mezzanine (termasuk slab platform).
 */
function auditCeilingHeights(layout: DesignLayout): AuditFinding[] {
  const floors = Array.isArray(layout.floors) ? layout.floors : []
  if (floors.length === 0) return []
  const elev = floorElevations(floors)
  const out: AuditFinding[] = []
  for (const floor of floors) {
    if (isRooftopFloor(floor)) continue
    const e = elev.get(floor.id)
    if (!e) continue
    if (isMezzanineFloor(floor)) {
      const parent = mezzanineParentOf(floors, floor.id)
      const parentElev = parent ? elev.get(parent.id) : undefined
      const clearBelow = e.baseY - (parentElev?.baseY ?? 0)
      if (clearBelow + 0.02 < MIN_MEZZANINE_CLEAR_M) {
        out.push({
          id: `ruang-mezzanine-bawah:${floor.id}`,
          category: "ruang",
          severity: "warning",
          title: `${floor.name}: ruang di bawah mezzanine hanya ${clearBelow.toFixed(2)} m`,
          detail: `Clearance di bawah platform mezzanine sebaiknya ≥ ${MIN_MEZZANINE_CLEAR_M} m agar ruang di bawahnya bisa ditempati/dilewati berdiri tegak.`,
          standard: "Ergonomi mezzanine",
          fix: `Naikkan elevasi platform mezzanine (baseOffsetM di kartu Lantai), atau kurangi tinggi ruang di atasnya.`,
        })
      }
      if (e.wallHM + 0.02 < MIN_MEZZANINE_CLEAR_M) {
        out.push({
          id: `ruang-mezzanine-atas:${floor.id}`,
          category: "ruang",
          severity: "warning",
          title: `${floor.name}: ruang di atas mezzanine hanya ${e.wallHM.toFixed(2)} m`,
          detail: `Clearance di atas platform mezzanine (sampai plafon/lantai berikutnya) sebaiknya ≥ ${MIN_MEZZANINE_CLEAR_M} m.`,
          standard: "Ergonomi mezzanine",
          fix: `Tambah tinggi lantai mezzanine (heightM di kartu Lantai) agar ruang di atasnya cukup tinggi.`,
        })
      }
      const total = clearBelow + e.floorToFloorM
      if (total + 0.02 < MIN_MEZZANINE_TOTAL_M) {
        out.push({
          id: `ruang-mezzanine-total:${floor.id}`,
          category: "ruang",
          severity: "advisory",
          title: `${floor.name}: total tinggi bay mezzanine ${total.toFixed(2)} m di bawah ${MIN_MEZZANINE_TOTAL_M} m`,
          detail: `Total tinggi (ruang bawah + pelat mezzanine + ruang atas) idealnya ≥ ${MIN_MEZZANINE_TOTAL_M} m agar mezzanine tak terasa seperti loteng sempit.`,
          standard: "Ergonomi mezzanine",
          fix: `Tinjau ulang tinggi floor-to-floor lantai induk atau tinggi mezzanine agar totalnya ≥ ${MIN_MEZZANINE_TOTAL_M} m.`,
        })
      }
      continue
    }
    if (e.wallHM + 0.02 < MIN_CEILING_M) {
      out.push({
        id: `ruang-plafon:${floor.id}`,
        category: "ruang",
        severity: "warning",
        title: `${floor.name}: tinggi plafon ${e.wallHM.toFixed(2)} m di bawah ${MIN_CEILING_M} m`,
        detail: `Tinggi dinding/plafon lantai ini ${e.wallHM.toFixed(2)} m, di bawah standar kenyamanan & sirkulasi udara minimum ${MIN_CEILING_M} m.`,
        standard: "Ergonomi ruang",
        fix: `Naikkan floor-to-floor lantai ini (heightM di kartu Lantai) hingga plafon ≥ ${MIN_CEILING_M} m.`,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Sirkulasi — dimensi & kenyamanan tangga interior                    */
/* ------------------------------------------------------------------ */

/**
 * Rumus riser/step DIDELEGASIKAN ke `interiorStairSpec` (lib/stairs/geometry.ts
 * — "JANGAN duplikasi rumus riser/step di file lain lagi") memakai rise
 * nyata dari tabel elevasi (`stairRiseM`, sama dipakai 3D/RAB). `spec.widthM`
 * dipakai sebagai "lebar tangga" karena itu dimensi TEGAK LURUS arah naik
 * (bukan sekadar sisi terpendek ruang) — pada arah default keduanya sama.
 */
function auditStairs(layout: DesignLayout): AuditFinding[] {
  const rooms = Array.isArray(layout.rooms) ? layout.rooms : []
  const stairRooms = rooms.filter((r) => r.type === "tangga")
  if (stairRooms.length === 0) return []
  const elev = floorElevations(Array.isArray(layout.floors) ? layout.floors : [])
  const out: AuditFinding[] = []
  for (const room of stairRooms) {
    const totalRiseM = stairRiseM(elev, room.floorId)
    const spec = interiorStairSpec(room, totalRiseM)
    if (spec.widthM + 0.02 < MIN_STAIR_WIDTH_M) {
      out.push({
        id: `sirkulasi-tangga-lebar:${room.id}`,
        category: "sirkulasi",
        severity: "warning",
        title: `${room.name} terlalu sempit (${spec.widthM.toFixed(2)} m < ${MIN_STAIR_WIDTH_M} m)`,
        detail: `Lebar bersih tangga sebaiknya ≥ ${MIN_STAIR_WIDTH_M} m (${Math.round(MIN_STAIR_WIDTH_M * 100)} cm) agar dua orang bisa berpapasan dengan aman.`,
        standard: "Ergonomi tangga",
        fix: `Lebarkan ${room.name} pada sisi tegak lurus arah naik hingga ≥ ${MIN_STAIR_WIDTH_M} m.`,
        objectId: room.id,
      })
    }
    if (spec.riserM + 1e-6 < STAIR_RISER_MIN_M || spec.riserM - 1e-6 > STAIR_RISER_MAX_M) {
      out.push({
        id: `sirkulasi-tangga-riser:${room.id}`,
        category: "sirkulasi",
        severity: "advisory",
        title: `Tanjakan ${room.name} ${(spec.riserM * 100).toFixed(0)} cm di luar rentang nyaman ${STAIR_RISER_MIN_M * 100}–${STAIR_RISER_MAX_M * 100} cm`,
        detail: `Tinggi tanjakan (riser) yang nyaman & aman untuk tangga rumah tinggal ada di ${STAIR_RISER_MIN_M * 100}–${STAIR_RISER_MAX_M * 100} cm; saat ini ${(spec.riserM * 100).toFixed(0)} cm dari ${spec.steps} anak tangga.`,
        standard: "Ergonomi tangga",
        fix: `Sesuaikan tinggi tanjakan (kartu ruang tangga) atau panjangkan ruang tangga agar riser masuk ${STAIR_RISER_MIN_M * 100}–${STAIR_RISER_MAX_M * 100} cm.`,
        objectId: room.id,
      })
    }
    const shape = room.stairShape ?? "lurus"
    if (shape === "lurus" && spec.steps > STAIR_MAX_STEPS_NO_LANDING) {
      out.push({
        id: `sirkulasi-tangga-bordes:${room.id}`,
        category: "sirkulasi",
        severity: "advisory",
        title: `${room.name} punya ${spec.steps} anak tangga lurus tanpa bordes (> ${STAIR_MAX_STEPS_NO_LANDING})`,
        detail: `Tangga lurus dengan lebih dari ${STAIR_MAX_STEPS_NO_LANDING} anak tanpa bordes melelahkan & berisiko jatuh panjang bila tersandung.`,
        standard: "Keselamatan tangga",
        fix: `Ubah bentuk ${room.name} menjadi L atau U (kartu ruang tangga → Bentuk tangga) agar ada bordes istirahat.`,
        objectId: room.id,
      })
    }
  }
  return out
}

/** Smallest y among enclosed rooms (carport/taman count as open front space,
 *  so they don't reduce the setback). */
function minFrontSetback(rooms: Room[]): number {
  const enclosed = rooms.filter((r) => r.type !== "carport" && r.type !== "taman" && r.type !== "kolam")
  if (enclosed.length === 0) return 0
  return Math.max(0, Math.min(...enclosed.map((r) => r.y)))
}

/* ------------------------------------------------------------------ */
/* Program — whole-house completeness & minimum total area             */
/* ------------------------------------------------------------------ */

function auditProgram(rooms: Room[], brief?: Brief | null): AuditFinding[] {
  void brief
  const out: AuditFinding[] = []
  const enclosed = rooms.filter(
    (r) => r.type !== "taman" && r.type !== "kolam" && r.type !== "carport" && r.type !== "void",
  )
  const totalArea = enclosed.reduce(
    (sum, r) => sum + (Number.isFinite(r.areaM2) ? r.areaM2 : roomArea(r.width, r.depth)),
    0,
  )
  if (enclosed.length > 0 && totalArea + 0.5 < MIN_HEALTHY_HOUSE_AREA_M2) {
    out.push({
      id: "ruang:total-area",
      category: "ruang",
      severity: "warning",
      title: `Total luas bangunan ${totalArea.toFixed(1)} m² di bawah standar rumah sehat (${MIN_HEALTHY_HOUSE_AREA_M2} m²)`,
      detail: `SNI 03-1733 menyarankan minimal ${MIN_HEALTHY_HOUSE_AREA_M2} m² untuk satu keluarga (± 9 m²/jiwa).`,
      standard: "SNI 03-1733-2004",
      fix: "Tambah luas ruang atau kurangi jumlah ruang agar tiap ruang memenuhi ukuran minimum.",
    })
  }

  // Essential rooms a livable house should have.
  const present = new Set(rooms.map((r) => r.type))
  const essentials: { type: Room["type"]; label: string }[] = [
    { type: "kamar_tidur", label: "kamar tidur" },
    { type: "kamar_mandi", label: "kamar mandi" },
    { type: "dapur", label: "dapur" },
  ]
  for (const e of essentials) {
    if (!present.has(e.type)) {
      out.push({
        id: `ruang:missing-${e.type}`,
        category: "ruang",
        severity: "warning",
        title: `Belum ada ${e.label}`,
        detail: `Rumah layak huni umumnya memiliki ${e.label}.`,
        standard: "SNI 03-1733-2004",
        fix: `Tambahkan ${e.label} ke denah.`,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Scoring & summary                                                   */
/* ------------------------------------------------------------------ */

function summarize(findings: AuditFinding[]): DesignAudit {
  const counts = { critical: 0, warning: 0, advisory: 0 }
  for (const f of findings) counts[f.severity]++

  const totalPenalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0)
  const score = clampScore(100 - totalPenalty)

  const byCategory: AuditCategoryScore[] = CATEGORIES.map((category) => {
    const catFindings = findings.filter((f) => f.category === category)
    const penalty = catFindings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0)
    return { category, score: clampScore(100 - penalty), findings: catFindings.length }
  })

  const summary =
    counts.critical > 0
      ? `Ada ${counts.critical} masalah penting yang perlu diperbaiki agar desain sesuai standar.`
      : counts.warning > 0
        ? `Desain cukup baik, tapi ada ${counts.warning} hal yang sebaiknya diperbaiki.`
        : findings.length > 0
          ? `Desain sudah baik; tinggal ${counts.advisory} saran penyempurnaan.`
          : "Desain sudah memenuhi standar dasar yang diperiksa. Bagus!"

  // Sort: critical first, then warning, then advisory; stable within severity.
  const order: AuditSeverity[] = ["critical", "warning", "advisory"]
  const sorted = [...findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  )

  return { score, summary, findings: sorted, byCategory, counts }
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}
