/**
 * GENERATOR migration koreksi bukaan — read-only terhadap DB, hanya MENULIS
 * FILE .sql untuk ditinjau manusia. Script ini TIDAK menjalankan apa pun ke
 * database.
 *
 * Pakai:
 *   node scripts/gen-opening-fix-migration.mjs            # tulis db/migrations/0024_*.sql
 *   node scripts/gen-opening-fix-migration.mjs --dry-run  # cetak ke stdout saja
 *   node scripts/gen-opening-fix-migration.mjs --only-impossible
 *
 * `--only-impossible` membatasi koreksi pada cacat yang MUSTAHIL dibangun
 * (bukaan menjorok keluar dinding / selebar penuh dinding), melewatkan yang
 * sekadar "kurang ideal" (sisa < 15 cm tapi masih > 0).
 *
 * Latar: docs/AUDIT_BUKAAN_2026-08.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import pg from "pg"

const MARGIN_M = 0.15
const WALL_TOL = 0.15

function loadEnvLocal() {
  const envPath = ".env.local"
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

const round2 = (v) => Math.round(v * 100) / 100
const edgeLen = (room, side) => (side === "n" || side === "s" ? room.width : room.depth)

/** Cermin fitOpeningToWall() di src/lib/geometry/fit-opening.ts. */
function fitOpening(wallLenM, desiredWidthM, preferredPositionM, minWidthM = 0.6, junctionsM = []) {
  if (!(wallLenM > 0) || !(desiredWidthM > 0)) return null
  const cuts = [0, ...junctionsM.filter((j) => j > 0 && j < wallLenM), wallLenM].sort((a, b) => a - b)
  const wanted = preferredPositionM ?? wallLenM / 2
  let best = null
  for (let i = 0; i < cuts.length - 1; i++) {
    const panelLo = cuts[i]
    const panelHi = cuts[i + 1]
    const usable = panelHi - panelLo - 2 * MARGIN_M
    if (usable < minWidthM - 1e-9) continue
    const widthM = round2(Math.min(desiredWidthM, usable))
    if (widthM < minWidthM - 1e-9) continue
    const half = widthM / 2
    const lo = panelLo + MARGIN_M + half
    const hi = panelHi - MARGIN_M - half
    if (hi < lo - 1e-9) continue
    const positionM = round2(Math.min(Math.max(wanted, lo), hi))
    const gap = Math.abs(positionM - wanted)
    if (!best || gap < best.gap - 1e-9 || (Math.abs(gap - best.gap) < 1e-9 && widthM > best.widthM)) {
      best = { positionM, widthM, gap }
    }
  }
  return best ? { positionM: best.positionM, widthM: best.widthM } : null
}

/** Titik pertemuan tembok di sepanjang dinding `side` — cermin wallJunctions()
 *  di src/lib/geometry/opening-plan.ts. */
function wallJunctions(host, side, rooms) {
  const len = edgeLen(host, side)
  const horizontal = side === "n" || side === "s"
  const line =
    side === "n" ? host.y : side === "s" ? host.y + host.depth : side === "w" ? host.x : host.x + host.width
  const origin = horizontal ? host.x : host.y
  const out = new Set()
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    const nbLine = horizontal
      ? side === "n" ? room.y + room.depth : room.y
      : side === "w" ? room.x + room.width : room.x
    if (Math.abs(line - nbLine) > WALL_TOL) continue
    const edges = horizontal ? [room.x, room.x + room.width] : [room.y, room.y + room.depth]
    for (const e of edges) {
      const t = e - origin
      if (t > WALL_TOL && t < len - WALL_TOL) out.add(round2(t))
    }
  }
  return [...out].sort((a, b) => a - b)
}

function classify(host, side, positionM, widthM, junctions = []) {
  const len = edgeLen(host, side)
  const start = positionM - widthM / 2
  const end = len - (positionM + widthM / 2)
  if (widthM >= len - 1e-6) return "selebar_penuh_dinding"
  if (start < -1e-6 || end < -1e-6) return "keluar_dinding"
  if (junctions.some((j) => j > start + 1e-6 && j < positionM + widthM / 2 - 1e-6)) {
    return "menumpang_pertemuan_tembok"
  }
  if (start < MARGIN_M - 1e-6 || end < MARGIN_M - 1e-6) return "mepet_ujung"
  return null
}

const IMPOSSIBLE = new Set(["selebar_penuh_dinding", "keluar_dinding"])

/** Ruang yang bukan permukaan pijak — pintu tak boleh menuju ke sini. */
const NOT_WALKABLE = new Set(["void", "kolam"])

/** Semua bukaan denah sebagai ref (untuk cek tabrakan dua sisi). */
function refsOf(row) {
  return (row.payload?.openings ?? []).flatMap((o) => {
    const [roomId, side] = String(o.wallId ?? "").split(":")
    if (!roomId || !side) return []
    return [{ id: o.id, roomId, side, positionM: o.positionM, widthM: o.widthM ?? 0.9, type: o.type }]
  })
}

const openingSegment = (host, side, positionM, widthM) => {
  const len = edgeLen(host, side)
  const half = widthM / 2
  const center = Math.min(Math.max(positionM, half), Math.max(half, len - half))
  if (side === "n") return { axis: "x", line: host.y, a: host.x + center - half, b: host.x + center + half }
  if (side === "s") return { axis: "x", line: host.y + host.depth, a: host.x + center - half, b: host.x + center + half }
  if (side === "w") return { axis: "y", line: host.x, a: host.y + center - half, b: host.y + center + half }
  return { axis: "y", line: host.x + host.width, a: host.y + center - half, b: host.y + center + half }
}

/** Bentang bersama host–tetangga (koordinat dunia) — cermin sharedWallSpan(). */
function sharedSpan(host, side, nb) {
  if (host.floorId !== nb.floorId) return null
  if (side === "n" || side === "s") {
    const line = side === "n" ? host.y : host.y + host.depth
    const nbLine = side === "n" ? nb.y + nb.depth : nb.y
    if (Math.abs(line - nbLine) > WALL_TOL) return null
    const lo = Math.max(host.x, nb.x)
    const hi = Math.min(host.x + host.width, nb.x + nb.width)
    return hi - lo > 0.1 ? { lo, hi } : null
  }
  const line = side === "w" ? host.x : host.x + host.width
  const nbLine = side === "w" ? nb.x + nb.width : nb.x
  if (Math.abs(line - nbLine) > WALL_TOL) return null
  const lo = Math.max(host.y, nb.y)
  const hi = Math.min(host.y + host.depth, nb.y + nb.depth)
  return hi - lo > 0.1 ? { lo, hi } : null
}

/**
 * Pindahkan bukaan yang MENUMPANG pertemuan tembok ke bentang tetangga yang
 * dilayaninya, LEBAR DIPERTAHANKAN — cermin repositionOpeningToNeighbor() di
 * src/lib/geometry/reposition-opening.ts. Null bila lebar asli tak mungkin
 * dipertahankan (biarkan manusia memutuskan, jangan menyempitkan diam-diam).
 */
function repositionToNeighbor(host, side, positionM, widthM, rooms, openings) {
  const seg = openingSegment(host, side, positionM, widthM)
  let target = null
  let bestOverlap = 0
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    if (room.type && NOT_WALKABLE.has(room.type)) continue
    const span = sharedSpan(host, side, room)
    if (!span) continue
    const overlap = Math.min(seg.b, span.hi) - Math.max(seg.a, span.lo)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      target = room
    }
  }
  if (!target) return null

  const span = sharedSpan(host, side, target)
  if (!span) return null
  const len = edgeLen(host, side)
  const origin = side === "n" || side === "s" ? host.x : host.y
  const half = widthM / 2
  const junctions = wallJunctions(host, side, rooms)

  // Rentang sah: di dalam bentang target, clearance dari ujung dinding.
  const lo = Math.max(MARGIN_M + half, span.lo - origin + half + MARGIN_M)
  const hi = Math.min(len - MARGIN_M - half, span.hi - origin - half - MARGIN_M)
  if (hi < lo - 1e-9) return null

  const clearsJunctions = (p) => junctions.every((j) => Math.abs(j - p) >= half + MARGIN_M - 1e-9)
  const clearsOthers = (p) => {
    const proposed = openingSegment(host, side, p, widthM)
    const byId = new Map(rooms.map((r) => [r.id, r]))
    for (const other of openings) {
      const oHost = byId.get(other.roomId)
      if (!oHost || oHost.floorId !== host.floorId) continue
      if (other.positionM === positionM && other.roomId === host.id && other.side === side) continue
      const s = openingSegment(oHost, other.side, other.positionM, other.widthM)
      if (s.axis !== proposed.axis) continue
      if (Math.abs(s.line - proposed.line) > WALL_TOL) continue
      if (Math.max(s.a, proposed.a) - Math.min(s.b, proposed.b) < 0.1) return false
    }
    return true
  }

  const center = Math.min(Math.max((lo + hi) / 2, lo), hi)
  const ok = (p) => p >= lo - 1e-9 && p <= hi + 1e-9 && clearsJunctions(p) && clearsOthers(p)
  let chosen = ok(center) ? center : null
  if (chosen == null) {
    for (let d = 0.1; d <= len && chosen == null; d += 0.1) {
      for (const p of [center - d, center + d]) {
        if (ok(p)) {
          chosen = p
          break
        }
      }
    }
  }
  if (chosen == null) return null
  return { positionM: round2(chosen), widthM: round2(widthM), neighborName: target.name ?? target.id }
}

async function main() {
  loadEnvLocal()
  const dryRun = process.argv.includes("--dry-run")
  const onlyImpossible = process.argv.includes("--only-impossible")

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[gen-opening-fix] DATABASE_URL tidak diset (cek .env.local)")
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: false })
  await client.connect()
  let rows
  try {
    const res = await client.query(
      "SELECT project_id, version_id, payload FROM design_layouts ORDER BY project_id"
    )
    rows = res.rows
  } finally {
    await client.end()
  }

  const edits = []
  for (const row of rows) {
    const rooms = row.payload?.rooms ?? []
    const byId = new Map(rooms.map((r) => [r.id, r]))
    for (const o of row.payload?.openings ?? []) {
      const [roomId, side] = String(o.wallId ?? "").split(":")
      const host = byId.get(roomId)
      if (!host || !side) continue
      const widthM = o.widthM ?? 0.9
      const junctions = wallJunctions(host, side, rooms)
      const kind = classify(host, side, o.positionM, widthM, junctions)
      if (!kind) continue
      if (onlyImpossible && !IMPOSSIBLE.has(kind)) continue

      const len = edgeLen(host, side)

      // Bukaan yang MENUMPANG pertemuan tembok butuh penanganan berbeda:
      // bidang solid terdekat belum tentu menghadap ruang yang bisa dimasuki.
      // Pindahkan ke bentang tetangga yang dilayaninya, LEBAR DIPERTAHANKAN
      // (cermin repositionOpeningToNeighbor di src/lib/geometry).
      if (kind === "menumpang_pertemuan_tembok") {
        const moved = repositionToNeighbor(host, side, o.positionM, widthM, rooms, refsOf(row))
        if (!moved) {
          edits.push({
            ...baseInfo(row, host, side, o, widthM, len, kind),
            skip: "lebar asli tak bisa dipertahankan di bentang tetangga mana pun — perlu keputusan desain",
          })
          continue
        }
        edits.push({
          ...baseInfo(row, host, side, o, widthM, len, kind),
          newPos: moved.positionM,
          newWidth: moved.widthM,
          note: `masuk bentang ${moved.neighborName}`,
        })
        continue
      }

      // Pertahankan niat asli: posisi sekarang jadi preferensi, lebar hanya
      // menyusut bila dinding tak cukup. Junction ikut diperhitungkan agar
      // koreksi tidak mendorong bukaan menumpang pertemuan tembok.
      const fit = fitOpening(len, widthM, o.positionM, 0.6, junctions)
      if (!fit) {
        edits.push({ ...baseInfo(row, host, side, o, widthM, len, kind), skip: "dinding tak layak untuk bukaan apa pun" })
        continue
      }
      if (Math.abs(fit.positionM - o.positionM) < 1e-9 && Math.abs(fit.widthM - widthM) < 1e-9) continue
      edits.push({ ...baseInfo(row, host, side, o, widthM, len, kind), newPos: fit.positionM, newWidth: fit.widthM })
    }
  }

  const applicable = edits.filter((e) => !e.skip)
  const skipped = edits.filter((e) => e.skip)

  const sql = renderMigration(applicable, skipped, onlyImpossible)
  if (dryRun) {
    console.log(sql)
    return
  }
  const file = onlyImpossible
    ? "db/migrations/0025_fix_impossible_openings.sql"
    : "db/migrations/0025_fix_opening_junctions.sql"
  writeFileSync(file, sql, "utf8")
  console.log(`[gen-opening-fix] ditulis: ${file}`)
  console.log(`  koreksi: ${applicable.length}`)
  if (skipped.length) console.log(`  dilewati (perlu tinjauan manual): ${skipped.length}`)
}

function baseInfo(row, host, side, o, widthM, len, kind) {
  return {
    projectId: row.project_id,
    versionId: row.version_id,
    openingId: o.id,
    where: `${host.name ?? host.id}:${side}`,
    type: o.type,
    oldPos: o.positionM,
    oldWidth: widthM,
    wallLen: round2(len),
    kind,
  }
}

function renderMigration(edits, skipped, onlyImpossible) {
  const byProject = new Map()
  for (const e of edits) {
    if (!byProject.has(e.projectId)) byProject.set(e.projectId, [])
    byProject.get(e.projectId).push(e)
  }

  const lines = []
  lines.push("-- 0024 — koreksi clearance bukaan pada denah yang sudah tersimpan.")
  lines.push("--")
  lines.push("-- Latar: docs/AUDIT_BUKAAN_2026-08.md. Bukaan di bawah melanggar aturan")
  lines.push("-- domain-knowledge-pintu.md §1 (clearance >= 15 cm dari dinding tegak lurus,")
  lines.push("-- atau daun pintu mentok saat dibuka 90°). Semuanya data WARISAN — lahir dari")
  lines.push("-- generator/jalur LLM sebelum clearance ditegakkan di kode (commit 3125b38).")
  lines.push("--")
  if (onlyImpossible) {
    lines.push("-- LINGKUP: hanya cacat yang MUSTAHIL dibangun (menjorok keluar dinding /")
    lines.push("-- bukaan selebar penuh dinding). Pelanggaran 'mepet ujung' dibiarkan.")
  } else {
    lines.push("-- LINGKUP: seluruh pelanggaran clearance.")
  }
  lines.push("--")
  lines.push("-- Yang diubah HANYA positionM (dan widthM bila dinding tak cukup lebar).")
  lines.push("-- Jenis bukaan, tinggi, sill, dan wallId TIDAK disentuh.")
  lines.push("--")
  lines.push("-- Idempoten: setiap UPDATE dijaga syarat nilai lama, jadi menjalankan ulang")
  lines.push("-- tidak mengubah apa pun.")
  lines.push("")
  lines.push("BEGIN;")
  lines.push("")

  for (const [project, items] of byProject) {
    lines.push(`-- ${project} (${items.length})`)
    for (const e of items) {
      const widthNote =
        (e.newWidth !== e.oldWidth ? `, lebar ${e.oldWidth} -> ${e.newWidth}` : "") +
        (e.note ? ` (${e.note})` : "")
      lines.push(
        `--   ${e.type} ${e.where} [${e.kind}] dinding ${e.wallLen} m: pos ${e.oldPos} -> ${e.newPos}${widthNote}`
      )
    }
    lines.push("UPDATE design_layouts SET payload = jsonb_set(")
    lines.push("  payload, '{openings}', (")
    lines.push("    SELECT jsonb_agg(")
    lines.push("      CASE")
    for (const e of items) {
      lines.push(`        WHEN o->>'id' = ${lit(e.openingId)}`)
      lines.push(`          AND (o->>'positionM')::numeric = ${e.oldPos}`)
      lines.push(
        `        THEN o || ${lit(JSON.stringify({ positionM: e.newPos, widthM: e.newWidth }))}::jsonb`
      )
    }
    lines.push("        ELSE o")
    lines.push("      END ORDER BY ord)")
    lines.push("    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)")
    lines.push("  ))")
    lines.push(`WHERE project_id = ${lit(project)};`)
    lines.push("")
  }

  lines.push("COMMIT;")
  lines.push("")
  lines.push("-- Verifikasi setelah dijalankan:")
  lines.push("--   node scripts/audit-openings.mjs")
  lines.push("")

  if (skipped.length) {
    lines.push("-- ============================================================")
    lines.push("-- PERLU TINJAUAN MANUAL — tidak dikoreksi otomatis:")
    for (const s of skipped) {
      lines.push(`--   ${s.projectId} ${s.type} ${s.where} pos=${s.oldPos} w=${s.oldWidth} dinding=${s.wallLen}`)
      lines.push(`--     ${s.skip}`)
    }
    lines.push("-- ============================================================")
  }
  return lines.join("\n")
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

main().catch((e) => {
  console.error("[gen-opening-fix]", e.message)
  process.exit(1)
})
