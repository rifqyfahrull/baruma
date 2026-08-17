/**
 * AUDIT BUKAAN — read-only. Memeriksa setiap pintu/jendela di `design_layouts`
 * terhadap aturan domain-knowledge/domain-knowledge-pintu.md §1:
 *
 *   "Sisakan clearance minimal 10–15 cm dari engsel pintu ke dinding/sudut
 *    terdekat agar daun pintu bisa membuka penuh 90°."
 *   "Kusen pintu idealnya tidak diletakkan persis di sudut ruangan."
 *
 * Script ini TIDAK PERNAH menulis ke database — hanya SELECT.
 *
 * Pakai:
 *   node scripts/audit-openings.mjs             # ringkasan + daftar pelanggaran
 *   node scripts/audit-openings.mjs --json      # keluaran JSON (untuk diproses)
 *   node scripts/audit-openings.mjs --project proj-xxx   # satu proyek saja
 *
 * Butuh DATABASE_URL (dibaca dari .env.local seperti scripts/exec-sql.mjs).
 */
import { existsSync, readFileSync } from "node:fs"
import pg from "pg"

/** Clearance minimal kusen ke dinding tegak lurus (m) — selaras
 *  OPENING_EDGE_MARGIN_M di src/lib/geometry/opening-plan.ts. */
const MARGIN_M = 0.15
/** Toleransi garis dinding, selaras WALL_LINE_TOL. */
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

const edgeLen = (room, side) => (side === "n" || side === "s" ? room.width : room.depth)

/** Titik pertemuan tembok di sepanjang dinding `side`, dalam koordinat dinding
 *  host — tempat dinding sekat tetangga menempel tegak lurus. */
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
      if (t > WALL_TOL && t < len - WALL_TOL) out.add(Math.round(t * 100) / 100)
    }
  }
  return [...out].sort((a, b) => a - b)
}

function auditLayout(projectId, payload) {
  const rooms = payload?.rooms ?? []
  const openings = payload?.openings ?? []
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const findings = []

  for (const o of openings) {
    const [roomId, side] = String(o.wallId ?? "").split(":")
    const host = byId.get(roomId)
    if (!host || !side) continue

    const widthM = o.widthM ?? 0.9
    const len = edgeLen(host, side)
    const startGap = o.positionM - widthM / 2
    const endGap = len - (o.positionM + widthM / 2)
    const name = `${host.name ?? roomId}:${side}`
    const issues = []

    if (widthM > len + 1e-6) {
      issues.push({ kind: "lebih_lebar_dari_dinding", detail: `${widthM} m > dinding ${len.toFixed(2)} m` })
    } else if (widthM >= len - 1e-6) {
      issues.push({ kind: "selebar_penuh_dinding", detail: `${widthM} m = seluruh dinding ${len.toFixed(2)} m` })
    }
    if (startGap < -1e-6 || endGap < -1e-6) {
      issues.push({ kind: "keluar_dinding", detail: `sisa ${startGap.toFixed(2)} / ${endGap.toFixed(2)} m` })
    } else if (startGap < MARGIN_M - 1e-6 || endGap < MARGIN_M - 1e-6) {
      issues.push({ kind: "mepet_ujung", detail: `sisa ${startGap.toFixed(2)} / ${endGap.toFixed(2)} m` })
    }

    const peers = rooms.filter((r) => r.floorId === host.floorId)
    const origin = side === "n" || side === "s" ? host.x : host.y
    const a = o.positionM - widthM / 2
    const b = o.positionM + widthM / 2
    const straddled = wallJunctions(host, side, peers).filter((j) => j > a + 1e-6 && j < b - 1e-6)
    if (straddled.length) {
      issues.push({ kind: "menumpang_pertemuan_tembok", detail: `junction ${straddled.join(", ")}` })
    }

    if (issues.length) {
      findings.push({
        projectId,
        openingId: o.id,
        type: o.type,
        where: name,
        positionM: o.positionM,
        widthM,
        wallLenM: Math.round(len * 100) / 100,
        issues,
      })
    }
  }
  return { total: openings.length, findings }
}

async function main() {
  loadEnvLocal()
  const asJson = process.argv.includes("--json")
  const pIdx = process.argv.indexOf("--project")
  const onlyProject = pIdx > -1 ? process.argv[pIdx + 1] : null

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[audit-openings] DATABASE_URL tidak diset (cek .env.local)")
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: false })
  await client.connect()
  let rows
  try {
    // SELECT saja — script ini tidak pernah menulis.
    const res = await client.query(
      onlyProject
        ? "SELECT project_id, version_id, payload FROM design_layouts WHERE project_id = $1"
        : "SELECT project_id, version_id, payload FROM design_layouts ORDER BY project_id",
      onlyProject ? [onlyProject] : []
    )
    rows = res.rows
  } finally {
    await client.end()
  }

  let totalOpenings = 0
  const all = []
  for (const row of rows) {
    const { total, findings } = auditLayout(row.project_id, row.payload)
    totalOpenings += total
    all.push(...findings)
  }

  if (asJson) {
    console.log(JSON.stringify({ layouts: rows.length, totalOpenings, findings: all }, null, 2))
    return
  }

  const byKind = {}
  for (const f of all) for (const i of f.issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1

  console.log(`\nAUDIT BUKAAN — ${rows.length} denah, ${totalOpenings} bukaan`)
  console.log(`Aturan: clearance >= ${MARGIN_M} m (domain-knowledge-pintu.md §1)\n`)
  console.log(`Bukaan bermasalah: ${all.length} / ${totalOpenings}`)
  for (const [kind, n] of Object.entries(byKind).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${String(n).padStart(4)}  ${kind}`)
  }

  const grouped = new Map()
  for (const f of all) {
    if (!grouped.has(f.projectId)) grouped.set(f.projectId, [])
    grouped.get(f.projectId).push(f)
  }
  for (const [project, items] of grouped) {
    console.log(`\n${project}  (${items.length})`)
    for (const f of items) {
      const tags = f.issues.map((i) => `${i.kind} [${i.detail}]`).join(" | ")
      console.log(`  ${f.type.padEnd(6)} ${f.where.padEnd(24)} pos=${f.positionM} w=${f.widthM} dinding=${f.wallLenM}`)
      console.log(`         ${tags}`)
    }
  }
  console.log("")
}

main().catch((e) => {
  console.error("[audit-openings]", e.message)
  process.exit(1)
})
