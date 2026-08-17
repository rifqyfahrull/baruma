/**
 * Layout validation (PRD §10.6 "Validation UX", §15). Produces issues shown as
 * warning markers on the canvas and in the inspector.
 */
import type { DesignLayout, ValidationIssue, ValidationResult } from "@/types"
import { openingServesRoom, rectsOverlap } from "@/lib/geometry"
import { clampRooftopArea } from "@/lib/geometry/rooftop"
import { buildingFootprint, deriveColumnGrid } from "@/lib/structural/grid"
import { columnLoad } from "@/lib/structural/takedown"
import { sizeColumn } from "@/lib/structural/sizing"
import { sizeFooting } from "@/lib/structural/foundation"
import { FC_MPA, MAX_SPAN, SOIL_DEFAULT_KPA } from "@/lib/structural/loads"
import { groundFloorIds, sanitationObstacles } from "@/lib/water/sanitation"
import { validateRoofZones } from "@/lib/exterior/validation"
import { unresolvedSkylights } from "@/lib/geometry/roof-holes"
import { roomsAdjacentOnSide, parseOpeningWall } from "@/lib/geometry"
import { floorElevations } from "@/lib/geometry/vertical"
import { CANTILEVER_MAX_M, mezzanineParentOf, regularFloorsOf, topRegularFloorId } from "@/lib/editor/floors"

const MIN_ROOM_AREA = 4 // m²

/** Room types that are effectively open/hard-standing ground rather than
 *  enclosed living space — a buried septic tank under these is common
 *  practice on tight urban lots (manhole cover in the paving/garden). */
const SEPTIC_TOLERANT_TYPES = ["carport", "taman"]
/** Room types that keep the ground genuinely open — the only place a
 *  soakwell can still do its job (infiltrate rain water into the soil). */
const OPEN_GROUND_TYPES = ["taman"]

type SanitationObstacle = ReturnType<typeof sanitationObstacles>[number]

/**
 * Severity of a ground-floor room footprint covering a buried sanitation
 * object, per object kind + room type. Null = fine as-is (a soakwell under a
 * garden — exactly where it belongs). The single source of truth for this
 * policy — the editor's validation issues AND the AI assistant's
 * proposal-rejection loop both derive from it, so the assistant never
 * rejects a layout the editor itself would accept (only "danger" is a hard
 * fail; warnings/info are surfaced to the user but valid).
 */
export function sanitationOverlapSeverity(
  roomType: string,
  kind: SanitationObstacle["kind"]
): "info" | "warning" | "danger" | null {
  if (kind === "controlBox") return "info"
  if (kind === "septic") return SEPTIC_TOLERANT_TYPES.includes(roomType) ? "info" : "warning"
  return OPEN_GROUND_TYPES.includes(roomType) ? null : "danger"
}

/**
 * Severity + message for a ground-floor `room` whose footprint covers a
 * buried sanitation object — level comes from `sanitationOverlapSeverity`,
 * message explains the kind's real constraint. Null when the combination is
 * fine as-is.
 */
function sanitationUnderRoomIssue(
  room: { id: string; name: string; type: string },
  obj: SanitationObstacle
): ValidationIssue | null {
  const level = sanitationOverlapSeverity(room.type, obj.kind)
  if (!level) return null
  const message =
    obj.kind === "controlBox"
      ? `Ada ${obj.label} di bawah ${room.name} — pastikan tutup akses inspeksi tersedia di lantai.`
      : obj.kind === "septic"
        ? level === "info"
          ? `Septic tank di bawah ${room.name} — umum di lahan sempit; sediakan manhole akses sedot WC dan pipa ventilasi gas.`
          : `Septic tank di bawah ${room.name} — akses sedot WC dan ventilasi gas jadi sulit; idealnya pindahkan ke halaman/carport.`
        : `Sumur resapan di bawah ${room.name} — resapan butuh tanah terbuka dan jarak dari pondasi (SNI 8456); pindahkan ke taman/halaman.`
  return {
    id: `sanitation-overlap:${room.id}:${obj.label}`,
    level,
    category: "spatial",
    message,
    objectId: room.id,
  }
}

export function validateLayout(
  layout: DesignLayout,
  site?: { widthM: number; depthM: number },
  extraNotes: ValidationIssue[] = []
): ValidationResult {
  const issues: ValidationIssue[] = [...extraNotes]
  const { rooms, openings } = layout
  const s = site && typeof site.widthM === "number" && typeof site.depthM === "number"
    ? site
    : { widthM: 100, depthM: 100 }

  // Partial rooftop: clamp the deck rect once so we can flag rooftop rooms that
  // fall outside it. Absent `rooftopArea` = full deck → no such warning.
  const deckRect = layout.rooftopArea
    ? clampRooftopArea(layout.rooftopArea, buildingFootprint(layout))
    : null

  for (const room of rooms) {
    // Out of bounds
    if (
      room.x < -0.01 ||
      room.y < -0.01 ||
      room.x + room.width > s.widthM + 0.01 ||
      room.y + room.depth > s.depthM + 0.01
    ) {
      issues.push({
        id: `bounds:${room.id}`,
        level: "danger",
        category: "spatial",
        message: `${room.name} keluar dari batas tanah.`,
        objectId: room.id,
      })
    }

    // Too small — void (bukaan lantai/atrium) is exempt: it's not a habitable
    // room and may legitimately be arbitrarily small.
    if (room.areaM2 < MIN_ROOM_AREA && room.type !== "void") {
      issues.push({
        id: `small:${room.id}`,
        level: "info",
        category: "spatial",
        message: `${room.name} cukup kecil (${room.areaM2} m²).`,
        objectId: room.id,
      })
    }

    // Needs ventilation but has no opening. An opening on a SHARED wall is
    // registered under one wallId but serves both sides (pintu kamar mandi
    // yang digambar di dinding tetangga tetap ventilasi kamar mandi) —
    // openingServesRoom checks the geometry, not just wallId ownership.
    if (room.requiresVentilation) {
      const hasOpening = openings.some((o) => openingServesRoom(o, room, rooms))
      if (!hasOpening) {
        issues.push({
          id: `vent:${room.id}`,
          level: "warning",
          category: "spatial",
          message: `${room.name} belum punya jendela/pintu untuk ventilasi.`,
          objectId: room.id,
        })
      }
    }

    // Rooftop room outside the deck area (partial rooftop only).
    if (deckRect && room.floorId === "floor-rooftop") {
      const outside =
        room.x < deckRect.x - 0.01 ||
        room.y < deckRect.y - 0.01 ||
        room.x + room.width > deckRect.x + deckRect.width + 0.01 ||
        room.y + room.depth > deckRect.y + deckRect.depth + 0.01
      if (outside) {
        issues.push({
          id: `rooftop-outside:${room.id}`,
          level: "warning",
          category: "spatial",
          message: `${room.name} berada di luar area deck rooftop.`,
          objectId: room.id,
        })
      }
    }
  }

  // Overlaps (per floor)
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]
      const b = rooms[j]
      if (a.floorId !== b.floorId) continue
      if (rectsOverlap(a, b)) {
        issues.push({
          id: `overlap:${a.id}:${b.id}`,
          level: "warning",
          category: "spatial",
          message: `${a.name} dan ${b.name} bertumpuk.`,
          objectId: a.id,
        })
      }
    }
  }

  // Ground-level sanitation (septic tank / soakwell / control boxes) sitting
  // under a ground-floor room. These are buried objects, so this is NOT a
  // physical clash — the severity reflects the real constraint each kind
  // carries when built over: a septic tank needs a desludging manhole + gas
  // vent (routine under a carport, awkward under a living room), a soakwell
  // needs open ground to infiltrate into (SNI 8456 also wants distance from
  // footings), and a control box just needs an inspection cover in the floor
  // (normal practice anywhere). Only rooms on the floor resting on grade can
  // conflict — upper floors ignore these entirely.
  const sanitationRects = sanitationObstacles(layout.sanitation)
  if (sanitationRects.length > 0) {
    const groundIds = groundFloorIds(layout.floors)
    for (const room of rooms) {
      if (!groundIds.has(room.floorId)) continue
      for (const obj of sanitationRects) {
        if (!rectsOverlap(room, obj.rect)) continue
        const issue = sanitationUnderRoomIssue(room, obj)
        if (issue) issues.push(issue)
      }
    }
  }

  // Resapan di taman yang TERTUTUP ATAP: aturan lokasi (di atas) sudah
  // menuntut soakwell berada di taman, tapi taman terkurung di dalam massa
  // (courtyard) yang tidak openToSky tidak menerima hujan — resapan tak bisa
  // bekerja. Deteksi "terkurung": ≥3 sisi menempel ruang solid se-lantai.
  {
    const sanRects = sanitationObstacles(layout.sanitation)
    const soaks = sanRects.filter((o) => o.kind === "soakwell")
    if (soaks.length > 0) {
      for (const room of rooms) {
        if (room.type !== "taman" || room.openToSky === true) continue
        const solids = rooms.filter(
          (o) =>
            o.id !== room.id &&
            o.floorId === room.floorId &&
            !["taman", "kolam", "void", "carport", "balkon"].includes(o.type),
        )
        const enclosedSides = (["n", "s", "w", "e"] as const).filter((side) =>
          roomsAdjacentOnSide(room, side, solids),
        ).length
        if (enclosedSides < 3) continue
        for (const obj of soaks) {
          if (!rectsOverlap(room, obj.rect)) continue
          issues.push({
            id: `resapan:tertutup-atap:${room.id}`,
            level: "warning",
            category: "spatial",
            message:
              `Sumur resapan berada di ${room.name} yang terkurung massa bangunan ` +
              "dan masih TERTUTUP ATAP — aktifkan \"Terbuka ke langit\" pada " +
              "taman ini (courtyard) agar hujan sampai ke resapan.",
            objectId: room.id,
          })
          break
        }
      }
    }
  }

  if (layout.roofZones?.length) {
    issues.push(
      ...validateRoofZones(layout.roofZones, {
        ...s,
        areaM2: s.widthM * s.depthM,
      }),
    )
  }

  // Headroom split-level (E4): ruang ber-offset positif di bawah lantai lain
  // — plafon rata berarti tinggi bersihnya = wallH − offset; di bawah 2.1 m
  // tidak layak huni (SNI plafon ruang huni ≥ 2.8 m; 2.1 = ambang keras).
  {
    const elevT = floorElevations(layout.floors)
    const regularIds = regularFloorsOf(layout.floors).map((f) => f.id)
    for (const room of rooms) {
      const off = room.levelOffsetM ?? 0
      if (off <= 0) continue
      const idx = regularIds.indexOf(room.floorId)
      const hasFloorAbove = idx >= 0 && idx < regularIds.length - 1
      if (!hasFloorAbove && !layout.floors.some((f) => f.id === "floor-rooftop"))
        continue
      const wallH = elevT.get(room.floorId)?.wallHM ?? 2.8
      const clearM = wallH - off
      if (clearM < 2.1) {
        issues.push({
          id: `headroom:${room.id}`,
          level: "warning",
          category: "spatial",
          message:
            `${room.name}: elevasi +${Math.round(off * 100)} cm menyisakan ` +
            `tinggi bersih ${clearM.toFixed(2)} m di bawah plafon (< 2.1 m) — ` +
            "kurangi offset atau tinggikan lantai (kartu Ringkasan).",
          objectId: room.id,
        })
      }
    }
  }

  // MEZZANINE (E8) — aturan arsitek: headroom di BAWAH platform ≥ 2.2 m,
  // di ATAS platform ≥ 2.0 m; luas mezzanine lazim ≤ 50% lantai induk.
  {
    const elevT = floorElevations(layout.floors)
    for (const mz of layout.floors) {
      if (mz.kind !== "mezzanine") continue
      const parent = mezzanineParentOf(layout.floors, mz.id)
      const e = elevT.get(mz.id)
      const pe = parent ? elevT.get(parent.id) : undefined
      if (!parent || !e || !pe) continue
      const offset = e.baseY - pe.baseY
      const clearBelow = offset - 0.15
      const clearAbove = pe.floorToFloorM - offset - 0.15
      if (clearBelow < 2.2) {
        issues.push({
          id: `mezzanine:headroom-bawah:${mz.id}`,
          level: "warning",
          category: "spatial",
          message:
            `${mz.name}: ruang di BAWAH platform hanya ${clearBelow.toFixed(2)} m ` +
            "(< 2.2 m) — naikkan elevasi dasar mezzanine atau tinggikan lantai induk.",
        })
      }
      if (clearAbove < 2.0) {
        issues.push({
          id: `mezzanine:headroom-atas:${mz.id}`,
          level: "warning",
          category: "spatial",
          message:
            `${mz.name}: ruang di ATAS platform hanya ${clearAbove.toFixed(2)} m ` +
            "(< 2.0 m) — turunkan elevasi dasar atau tinggikan lantai induk.",
        })
      }
      const mzArea = rooms
        .filter((r) => r.floorId === mz.id)
        .reduce((sum, r) => sum + (r.areaM2 || 0), 0)
      const parentArea = rooms
        .filter((r) => r.floorId === parent.id)
        .reduce((sum, r) => sum + (r.areaM2 || 0), 0)
      if (parentArea > 0 && mzArea > parentArea * 0.5) {
        issues.push({
          id: `mezzanine:luas:${mz.id}`,
          level: "info",
          category: "spatial",
          message:
            `${mz.name}: luas platform ${mzArea.toFixed(1)} m² melebihi 50% ` +
            "lantai induk — lazimnya mezzanine ≤ setengah luas ruang di bawahnya.",
        })
      }
    }
  }

  // PORTHOLE (jendela bulat, PLAN_TUTUP_GAP Gap 1 Track B): diameter +
  // ambang bawah tak boleh melebihi tinggi dinding lantai ruangnya.
  {
    const elevP = floorElevations(layout.floors)
    for (const op of openings) {
      if (op.kind !== "porthole") continue
      const parsed = parseOpeningWall(op.wallId)
      if (!parsed) continue
      const host = rooms.find((r) => r.id === parsed.roomId)
      if (!host) continue
      const wallH = elevP.get(host.floorId)?.wallHM ?? 2.8
      const dia = Math.min(op.widthM ?? 0, op.heightM ?? 0)
      const sill = op.sillHeightM ?? 0.9
      if (dia + sill > wallH + 1e-6) {
        issues.push({
          id: `porthole:tinggi:${op.id}`,
          level: "warning",
          category: "spatial",
          message:
            `Jendela bulat di ${host.name}: diameter ${dia.toFixed(2)} m + ambang ` +
            `${sill.toFixed(2)} m melebihi tinggi dinding ${wallH.toFixed(2)} m — ` +
            "perkecil diameter atau turunkan ambang.",
          objectId: host.id,
        })
      }
    }
  }

  // CANTILEVER (PLAN_TUTUP_GAP Gap 2 Track B): lantai menjorok besar tanpa
  // penopang → info struktural; melebihi batas keras → warning.
  for (const fl of layout.floors) {
    const o = fl.offsetM
    if (!o) continue
    const mag = Math.max(Math.abs(o.dx), Math.abs(o.dy))
    if (mag < 0.01) continue
    if (mag > CANTILEVER_MAX_M + 1e-6) {
      issues.push({
        id: `cantilever:batas:${fl.id}`,
        level: "warning",
        category: "structural",
        message:
          `${fl.name} menjorok ${mag.toFixed(2)} m — melebihi batas wajar ` +
          `${CANTILEVER_MAX_M} m tanpa struktur khusus (kantilever di-clamp saat render).`,
      })
    } else if (mag > 1.0) {
      issues.push({
        id: `cantilever:penopang:${fl.id}`,
        level: "info",
        category: "structural",
        message:
          `${fl.name} menjorok ${mag.toFixed(2)} m — cantilever > 1 m sebaiknya ` +
          "diperkuat balok kantilever/kolom penopang di bawahnya.",
      })
    }
  }

  // Skylight hanya hidup di bidang atap DATAR (atap datar/dak/zona datar) —
  // yang tak ter-resolve (mis. atap pelana) tetap tersimpan tapi diberi tahu.
  {
    const orphan = unresolvedSkylights(layout)
    if (orphan.length > 0) {
      issues.push({
        id: "skylight:bidang-miring",
        level: "warning",
        category: "spatial",
        message:
          `${orphan.length} skylight tidak berada di bidang atap datar — ` +
          "skylight butuh atap datar, dak rooftop, atau zona atap datar " +
          "(atap miring belum didukung).",
      })
    }
  }

  // Akses DAK rooftop — arsitek: dak yang bisa diinjak wajib punya jalur
  // akses. Dihuni (rooftop_lounge) → tangga dalam ruang; dak servis → tangga
  // monyet (ship ladder) masih wajar.
  if (layout.floors.some((f) => f.id === "floor-rooftop")) {
    const topRegularId = topRegularFloorId(layout.floors)
    const hasStairAccess = rooms.some(
      (r) => r.type === "tangga" && r.floorId === topRegularId,
    )
    const hasLadder = layout.rooftopAccess?.kind === "tangga_monyet"
    const inhabited = rooms.some(
      (r) => r.floorId === "floor-rooftop" && r.type === "rooftop_lounge",
    )
    if (!hasStairAccess && !hasLadder) {
      issues.push({
        id: "rooftop:no-access",
        level: "warning",
        category: "spatial",
        message:
          "Dak rooftop belum punya akses — tambahkan tangga di lantai teratas " +
          "(atau tangga monyet untuk dak servis) dari kartu Atap.",
      })
    } else if (inhabited && !hasStairAccess) {
      issues.push({
        id: "rooftop:ladder-only",
        level: "warning",
        category: "spatial",
        message:
          "Dak rooftop dihuni (ada ruang teras) tapi aksesnya hanya tangga " +
          "monyet — untuk kenyamanan & keselamatan sebaiknya tangga dalam ruang.",
      })
    }
  }

  const passed = !issues.some((i) => i.level === "danger")
  return { passed, issues }
}

/**
 * Structural notes for the layout, `category:"structural"`.
 *
 * Two kinds:
 *  1. Project-level flags (≥3 floors, rooftop) — always emitted, layout-free so
 *     legacy callers that pass only `project` still get them.
 *  2. Calc-driven issues (SP6) — emitted only when a `layout` is supplied:
 *     governing column dimension, spread-footing size, a deep-foundation
 *     advisory (σ low / load high), and a span-at-limit warning. These call the
 *     same pure structural modules the drawing sheets + RAB use (grid →
 *     takedown → sizing → foundation) — never re-deriving the formulas — so the
 *     inspector notes agree with the sheets and the BOQ exactly.
 *
 * `layout` is optional: `structuralNotes(project)` returns just the two
 * project-level notes (backwards-compatible).
 */
export function structuralNotes(
  project: {
    floors: number
    rooftop: boolean
    readiness: string
  },
  layout?: DesignLayout
): ValidationIssue[] {
  const notes: ValidationIssue[] = []
  if (project.floors >= 3) {
    notes.push({
      id: "struct:floors",
      level: "warning",
      category: "structural",
      message: `Bangunan ${project.floors} lantai perlu ditinjau engineer struktur.`,
    })
  }
  if (project.rooftop) {
    notes.push({
      id: "struct:rooftop",
      level: "info",
      category: "structural",
      message: "Pastikan beban rooftop dan railing pengaman sesuai standar.",
    })
  }

  // Calc-driven notes — only when a layout is available AND the footprint is
  // non-degenerate (an empty grid means no rooms to build structure on).
  if (layout) {
    const grid = deriveColumnGrid(layout)
    if (grid.columns.length > 0) {
      const floors = Number.isFinite(project.floors) ? Math.max(1, project.floors) : 1
      const load = columnLoad(grid.spanX, grid.spanY, floors)
      const column = sizeColumn(load.Pu)
      const sigmaKPa = layout.structural?.soilBearingKPa ?? SOIL_DEFAULT_KPA
      const footing = sizeFooting(load.Ps, sigmaKPa)

      notes.push({
        id: "struct:column",
        level: "info",
        category: "structural",
        message: `Kolom terbebani ${load.Pu} kN → ${column.side}×${column.side} mm (f'c ${FC_MPA} MPa).`,
      })
      notes.push({
        id: "struct:footing",
        level: "info",
        category: "structural",
        message: `σ ${sigmaKPa} kPa → telapak ${footing.side}×${footing.side} m (tebal ${footing.thickness} m).`,
      })
      if (footing.deepNote) {
        notes.push({
          id: "struct:deep-foundation",
          level: "warning",
          category: "structural",
          message: `Beban besar / σ rendah → ${footing.deepNote}.`,
        })
      }

      // Span-at-limit warning: deriveColumnGrid caps spans at MAX_SPAN, so a
      // span that reaches the 4 m limit is the signal to add columns / deepen
      // the beam (brief: "span≥4 warning").
      const maxSpan = Math.max(grid.spanX, grid.spanY)
      if (maxSpan >= MAX_SPAN - 1e-9) {
        notes.push({
          id: "struct:span",
          level: "warning",
          category: "structural",
          message: `Bentang ${maxSpan} m mencapai batas ${MAX_SPAN} m — pertimbangkan tambah kolom atau balok lebih tinggi.`,
        })
      }
    }
  }

  return notes
}
