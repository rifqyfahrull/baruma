/**
 * AUDIT KETERJANGKAUAN — read-only. Menjawab pertanyaan yang lebih mendasar
 * daripada audit bukaan: apakah setiap ruang bisa dicapai DARI DALAM rumah,
 * dan apakah rumah tersambung dari depan ke belakang tanpa keluar?
 *
 * "Yang namanya ruangan itu harus bisa diakses dari dalam rumah, bukan
 *  sembarangan naruh pintu; dan rumah itu dari depan ke belakang bisa diakses
 *  dari dalam rumah — lumrahnya desain rumah seperti ini."
 *
 * Script ini TIDAK PERNAH menulis ke database.
 *
 * Pakai:
 *   node scripts/audit-connectivity.mjs
 *   node scripts/audit-connectivity.mjs --project proj-xxx
 */
import { existsSync, readFileSync } from "node:fs"
import pg from "pg"

const WALL_TOL = 0.15
/** Ruang luar/terbuka — melewatinya berarti keluar rumah. */
const OUTDOOR = new Set(["carport", "taman", "teras", "balkon", "void", "kolam", "area_jemur", "rooftop"])

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
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[key] = v
  }
}

const edgeLen = (r, s) => (s === "n" || s === "s" ? r.width : r.depth)

/** Ruang yang benar-benar dilayani segmen bukaan (per-segmen, bukan per-sisi). */
function neighborServed(host, side, positionM, widthM, rooms) {
  const len = edgeLen(host, side)
  const half = widthM / 2
  const center = Math.min(Math.max(positionM, half), Math.max(half, len - half))
  const horizontal = side === "n" || side === "s"
  const line =
    side === "n" ? host.y : side === "s" ? host.y + host.depth : side === "w" ? host.x : host.x + host.width
  const a = (horizontal ? host.x : host.y) + center - half
  const b = (horizontal ? host.x : host.y) + center + half
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    if (horizontal) {
      const onBoundary = Math.abs(line - room.y) <= WALL_TOL || Math.abs(line - (room.y + room.depth)) <= WALL_TOL
      const overlap = Math.min(b, room.x + room.width) - Math.max(a, room.x)
      if (onBoundary && overlap > 0.1) return room
    } else {
      const onBoundary = Math.abs(line - room.x) <= WALL_TOL || Math.abs(line - (room.x + room.width)) <= WALL_TOL
      const overlap = Math.min(b, room.y + room.depth) - Math.max(a, room.y)
      if (onBoundary && overlap > 0.1) return room
    }
  }
  return null
}

function analyze(payload) {
  const rooms = payload?.rooms ?? []
  const openings = payload?.openings ?? []
  const isOutdoor = (r) => OUTDOOR.has(r.type)
  const indoor = rooms.filter((r) => !isOutdoor(r))
  const adj = new Map(indoor.map((r) => [r.id, []]))
  const withExteriorDoor = new Set()
  const byId = new Map(rooms.map((r) => [r.id, r]))

  for (const o of openings) {
    if (o.type !== "door") continue
    const [roomId, side] = String(o.wallId ?? "").split(":")
    const host = byId.get(roomId)
    if (!host || !side) continue
    const nb = neighborServed(host, side, o.positionM, o.widthM ?? 0.9, rooms)
    const hostIn = !isOutdoor(host)
    const nbIn = nb && !isOutdoor(nb)
    if (hostIn && nb && nbIn) {
      adj.get(host.id)?.push(nb.id)
      adj.get(nb.id)?.push(host.id)
    } else if (hostIn) withExteriorDoor.add(host.id)
    else if (nb && nbIn) withExteriorDoor.add(nb.id)
  }

  const componentOf = new Map()
  let comp = 0
  for (const room of indoor) {
    if (componentOf.has(room.id)) continue
    const queue = [room.id]
    componentOf.set(room.id, comp)
    while (queue.length) {
      const cur = queue.shift()
      for (const nx of adj.get(cur) ?? []) {
        if (!componentOf.has(nx)) {
          componentOf.set(nx, comp)
          queue.push(nx)
        }
      }
    }
    comp++
  }

  const sizeByFloor = new Map()
  for (const room of indoor) {
    const c = componentOf.get(room.id)
    if (!sizeByFloor.has(room.floorId)) sizeByFloor.set(room.floorId, new Map())
    const m = sizeByFloor.get(room.floorId)
    m.set(c, (m.get(c) ?? 0) + 1)
  }
  const mainByFloor = new Map()
  for (const [floorId, sizes] of sizeByFloor) {
    let best = -1
    let bestComp = 0
    for (const [c, n] of sizes) if (n > best) { best = n; bestComp = c }
    mainByFloor.set(floorId, bestComp)
  }

  const isolated = indoor.filter((r) => componentOf.get(r.id) !== mainByFloor.get(r.floorId))
  const noDoorAtAll = indoor.filter(
    (r) => !openings.some((o) => o.type === "door" && String(o.wallId).startsWith(`${r.id}:`)) &&
           !(adj.get(r.id) ?? []).length
  )
  // Gugus per lantai: >1 gugus = rumah terbelah, penghuni harus keluar.
  const fragmentedFloors = [...sizeByFloor.entries()].filter(([, sizes]) => sizes.size > 1)

  return { indoor, isolated, noDoorAtAll, fragmentedFloors, withExteriorDoor }
}

async function main() {
  loadEnvLocal()
  const pIdx = process.argv.indexOf("--project")
  const only = pIdx > -1 ? process.argv[pIdx + 1] : null
  const cs = process.env.DATABASE_URL
  if (!cs) {
    console.error("[audit-connectivity] DATABASE_URL tidak diset")
    process.exit(1)
  }
  const client = new pg.Client({ connectionString: cs, ssl: false })
  await client.connect()
  let rows
  try {
    const res = await client.query(
      only
        ? "SELECT project_id, payload FROM design_layouts WHERE project_id = $1"
        : "SELECT project_id, payload FROM design_layouts ORDER BY project_id",
      only ? [only] : []
    )
    rows = res.rows
  } finally {
    await client.end()
  }

  console.log(`\nAUDIT KETERJANGKAUAN — ${rows.length} denah`)
  console.log("Aturan: setiap ruang dalam wajib tercapai dari dalam rumah\n")

  let bad = 0
  for (const row of rows) {
    const a = analyze(row.payload)
    const problems = []
    if (a.isolated.length) {
      problems.push(`terputus dari gugus utama: ${a.isolated.map((r) => r.name ?? r.id).join(", ")}`)
    }
    if (a.noDoorAtAll.length) {
      problems.push(`tanpa pintu sama sekali: ${a.noDoorAtAll.map((r) => r.name ?? r.id).join(", ")}`)
    }
    for (const [floorId, sizes] of a.fragmentedFloors) {
      problems.push(`${floorId} terbelah ${sizes.size} gugus (penghuni harus keluar rumah untuk pindah)`)
    }
    if (!problems.length) continue
    bad++
    console.log(`${row.project_id}  (${a.indoor.length} ruang dalam)`)
    for (const p of problems) console.log(`   - ${p}`)
  }
  console.log(`\nDenah bermasalah: ${bad} / ${rows.length}\n`)
}

main().catch((e) => {
  console.error("[audit-connectivity]", e.message)
  process.exit(1)
})
