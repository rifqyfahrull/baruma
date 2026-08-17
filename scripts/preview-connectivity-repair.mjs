/**
 * PRATINJAU perbaikan konektivitas — read-only terhadap DB.
 *
 * Menjalankan solver penyambung pintu (padanan generateConnectingDoors) pada
 * setiap denah produksi, lalu melaporkan: berapa ruang yang BISA disambung
 * otomatis, dan mana yang butuh KORIDOR (keputusan desain manusia).
 *
 * Tidak menulis apa pun — tidak ke DB, tidak ke file.
 *
 * Pakai: node scripts/preview-connectivity-repair.mjs [--project proj-xxx]
 */
import { existsSync, readFileSync } from "node:fs"
import pg from "pg"

const MARGIN = 0.15
const WALL_TOL = 0.15
const DOOR_MIN = 0.7
const OUTDOOR = new Set(["carport", "taman", "teras", "balkon", "void", "kolam", "area_jemur", "rooftop"])
const CIRCULATION = new Set(["ruang_tamu", "ruang_keluarga", "ruang_makan", "koridor", "foyer", "teras"])
const SEMI = new Set(["dapur", "laundry", "gudang", "tangga", "area_jemur"])
const PRIVATE = new Set(["kamar_tidur", "kamar_mandi", "musholla", "kamar_art"])
const NOT_WALKABLE = new Set(["void", "kolam"])
const SIDES = ["n", "s", "w", "e"]

function loadEnvLocal() {
  const p = ".env.local"
  if (!existsSync(p)) return
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    if (!k || Object.prototype.hasOwnProperty.call(process.env, k)) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[k] = v
  }
}

const edgeLen = (r, s) => (s === "n" || s === "s" ? r.width : r.depth)
const isOutdoor = (r) => OUTDOOR.has(r.type)
const round2 = (v) => Math.round(v * 100) / 100

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

function segOf(host, side, positionM, widthM) {
  const len = edgeLen(host, side)
  const half = widthM / 2
  const c = Math.min(Math.max(positionM, half), Math.max(half, len - half))
  const horiz = side === "n" || side === "s"
  const line = side === "n" ? host.y : side === "s" ? host.y + host.depth : side === "w" ? host.x : host.x + host.width
  const base = horiz ? host.x : host.y
  return { axis: horiz ? "x" : "y", line, a: base + c - half, b: base + c + half }
}

function neighborServed(host, side, pos, w, rooms) {
  const s = segOf(host, side, pos, w)
  for (const room of rooms) {
    if (room.id === host.id || room.floorId !== host.floorId) continue
    if (s.axis === "x") {
      const onB = Math.abs(s.line - room.y) <= WALL_TOL || Math.abs(s.line - (room.y + room.depth)) <= WALL_TOL
      if (onB && Math.min(s.b, room.x + room.width) - Math.max(s.a, room.x) > 0.1) return room
    } else {
      const onB = Math.abs(s.line - room.x) <= WALL_TOL || Math.abs(s.line - (room.x + room.width)) <= WALL_TOL
      if (onB && Math.min(s.b, room.y + room.depth) - Math.max(s.a, room.y) > 0.1) return room
    }
  }
  return null
}

function freeDoorPos(host, side, nb, w, openings, rooms) {
  const len = edgeLen(host, side)
  const half = w / 2
  const origin = side === "n" || side === "s" ? host.x : host.y
  let lo = half + MARGIN
  let hi = len - half - MARGIN
  if (nb) {
    const span = sharedSpan(host, side, nb)
    if (!span) return null
    lo = Math.max(lo, span.lo - origin + half + MARGIN)
    hi = Math.min(hi, span.hi - origin - half - MARGIN)
  }
  if (hi < lo) return null
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const conflicts = (p) => {
    const prop = segOf(host, side, p, w)
    for (const o of openings) {
      const oh = byId.get(o.roomId)
      if (!oh || oh.floorId !== host.floorId) continue
      const s = segOf(oh, o.side, o.positionM, o.widthM)
      if (s.axis !== prop.axis) continue
      if (Math.abs(s.line - prop.line) > WALL_TOL) continue
      if (Math.max(s.a, prop.a) - Math.min(s.b, prop.b) < 0.1) return true
    }
    return false
  }
  const fits = (p) =>
    !conflicts(p) && (!nb || neighborServed(host, side, p, w, rooms)?.id === nb.id)
  const center = Math.min(Math.max((lo + hi) / 2, lo), hi)
  if (fits(center)) return round2(center)
  for (let d = 0.1; d <= len; d += 0.1) {
    for (const p of [center - d, center + d]) if (p >= lo && p <= hi && fits(p)) return round2(p)
  }
  return null
}

function scoreNeighbor(target, nb, ground) {
  if (!nb) return ground ? 1 : -1
  if (NOT_WALKABLE.has(nb.type)) return -1
  if (PRIVATE.has(nb.type)) return target.type === "kamar_mandi" && nb.type === "kamar_tidur" ? 4 : -1
  if (CIRCULATION.has(nb.type)) return 4
  if (SEMI.has(nb.type)) return 3
  return 2
}

class UF {
  constructor() { this.p = new Map() }
  find(x) { let r = this.p.get(x) ?? x; while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r); this.p.set(x, r); return r }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb) }
  connected(a, b) { return this.find(a) === this.find(b) }
}

/** Padanan generateConnectingDoors — melaporkan pintu yang akan ditambahkan. */
function planDoors(payload) {
  const rooms = payload?.rooms ?? []
  const existing = payload?.openings ?? []
  const floors = payload?.floors ?? []
  const added = []
  const unresolved = []
  const lowest = Math.min(...floors.map((f) => f.level ?? 1))

  for (const floor of floors) {
    const floorRooms = rooms.filter((r) => r.floorId === floor.id)
    const indoor = floorRooms.filter((r) => !isOutdoor(r))
    if (!indoor.length) continue
    const ground = (floor.level ?? 1) === lowest
    const uf = new UF()
    const refs = existing.flatMap((o) => {
      const [rid, side] = String(o.wallId ?? "").split(":")
      return rid && side ? [{ roomId: rid, side, positionM: o.positionM, widthM: o.widthM ?? 0.9, type: o.type }] : []
    })

    for (const o of existing.filter((x) => x.type === "door")) {
      const [rid, side] = String(o.wallId ?? "").split(":")
      const host = indoor.find((r) => r.id === rid)
      if (!host || !side) continue
      const nb = neighborServed(host, side, o.positionM, o.widthM ?? 0.9, floorRooms)
      if (nb && indoor.some((r) => r.id === nb.id)) uf.union(host.id, nb.id)
    }

    const anchor = indoor.find((r) => CIRCULATION.has(r.type)) ?? indoor[0]
    let progress = true
    while (progress) {
      progress = false
      for (const room of indoor) {
        if (uf.connected(room.id, anchor.id)) continue
        const cands = []
        for (const side of SIDES) {
          if (edgeLen(room, side) < DOOR_MIN + 2 * MARGIN) continue
          const nbs = floorRooms.filter((r) => r.id !== room.id && sharedSpan(room, side, r))
          if (!nbs.length) cands.push({ side, nb: null, score: scoreNeighbor(room, null, ground) })
          for (const nb of nbs) cands.push({ side, nb, score: scoreNeighbor(room, nb, ground) })
        }
        cands.sort((a, b) => b.score - a.score)
        for (const c of cands.filter((x) => x.score >= 0)) {
          if (!c.nb || !uf.connected(c.nb.id, anchor.id)) continue
          const w = room.type === "kamar_mandi" ? 0.7 : room.type === "kamar_tidur" ? 0.8 : 0.9
          const p = freeDoorPos(room, c.side, c.nb, w, refs, floorRooms)
          if (p == null) continue
          added.push({ room: room.name ?? room.id, side: c.side, to: c.nb.name ?? c.nb.id, pos: p, w })
          refs.push({ roomId: room.id, side: c.side, positionM: p, widthM: w, type: "door" })
          uf.union(room.id, c.nb.id)
          progress = true
          break
        }
        if (progress) break
      }
    }
    for (const room of indoor) {
      if (!uf.connected(room.id, anchor.id) && room.id !== anchor.id) {
        unresolved.push(room.name ?? room.id)
      }
    }
  }
  return { added, unresolved }
}

/** Cermin planCorridorFor() di src/lib/geometry/corridor-plan.ts. */
function planCorridor(floorId, rooms, isolatedIds, circulationIds, site, minW = 0.9, maxW = 2.4) {
  const TOUCH = 0.15, MINW = 0.6
  const fr = rooms.filter((r) => r.floorId === floorId)
  if (!fr.length) return null
  const circ = fr.filter((r) => circulationIds.includes(r.id))
  if (!circ.length) return null
  if (!site?.widthM) {
    site = {
      widthM: Math.max(...fr.map((r) => r.x + r.width)),
      depthM: Math.max(...fr.map((r) => r.y + r.depth)),
    }
  }
  const shares = (a, b) => {
    const xo = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const yo = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y)
    const v = Math.abs(a.x + a.width - b.x) <= TOUCH || Math.abs(b.x + b.width - a.x) <= TOUCH
    const h = Math.abs(a.y + a.depth - b.y) <= TOUCH || Math.abs(b.y + b.depth - a.y) <= TOUCH
    return (v && yo > MINW) || (h && xo > MINW)
  }
  const ov = (a, b) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.01 &&
    Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > 0.01
  const needy = fr.filter((r) => isolatedIds.includes(r.id) && !circ.some((c) => shares(r, c)))
  if (!needy.length) return null
  const freeIv = (blockers, lo, hi) => {
    const s = blockers.filter((b) => b.hi > lo && b.lo < hi).sort((a, b) => a.lo - b.lo)
    const out = []
    let cur = lo
    for (const b of s) {
      if (b.lo > cur) out.push({ lo: cur, hi: Math.min(b.lo, hi) })
      cur = Math.max(cur, b.hi)
      if (cur >= hi) break
    }
    if (cur < hi) out.push({ lo: cur, hi })
    return out.filter((i) => i.hi - i.lo > 0.01)
  }
  let best = null
  for (const vertical of [true, false]) {
    const band = vertical ? site.widthM : site.depthM
    const cross = vertical ? site.depthM : site.widthM
    const edges = new Set([0, band])
    for (const r of fr) {
      edges.add(vertical ? r.x : r.y)
      edges.add(vertical ? r.x + r.width : r.y + r.depth)
    }
    const sorted = [...edges].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const lo = sorted[i], hi = sorted[j], w = hi - lo
        if (w < minW - 1e-9) continue
        if (w > maxW + 1e-9) break
        const blockers = fr
          .filter((r) => {
            const a = vertical ? r.x : r.y, b = vertical ? r.x + r.width : r.y + r.depth
            return Math.min(b, hi) - Math.max(a, lo) > 0.01
          })
          .map((r) => (vertical ? { lo: r.y, hi: r.y + r.depth } : { lo: r.x, hi: r.x + r.width }))
        for (const iv of freeIv(blockers, 0, cross)) {
          const mk = (a, b) =>
            vertical
              ? { x: round2(lo), y: round2(a), width: round2(w), depth: round2(b - a) }
              : { x: round2(a), y: round2(lo), width: round2(b - a), depth: round2(w) }
          let cand = mk(iv.lo, iv.hi)
          const serves = needy.filter((r) => shares(cand, r))
          if (!serves.length || !circ.some((c) => shares(cand, c))) continue
          const anchors = [...serves, ...circ.filter((c) => shares(cand, c))]
          const nLo = Math.max(iv.lo, Math.min(...anchors.map((r) => (vertical ? r.y : r.x))))
          const nHi = Math.min(iv.hi, Math.max(...anchors.map((r) => (vertical ? r.y + r.depth : r.x + r.width))))
          if (nHi - nLo >= minW - 1e-9) {
            const t = mk(nLo, nHi)
            if (needy.filter((r) => shares(t, r)).length === serves.length && circ.some((c) => shares(t, c))) cand = t
          }
          if (cand.width < minW - 1e-9 || cand.depth < minW - 1e-9) continue
          if (fr.some((r) => ov(cand, r))) continue
          if (cand.x < -1e-6 || cand.y < -1e-6) continue
          if (cand.x + cand.width > site.widthM + 1e-6) continue
          if (cand.y + cand.depth > site.depthM + 1e-6) continue
          const fs = needy.filter((r) => shares(cand, r))
          if (!fs.length) continue
          const area = cand.width * cand.depth
          if (!best || fs.length > best.serves.length || (fs.length === best.serves.length && area < best.room.width * best.room.depth)) {
            best = { room: cand, serves: fs }
          }
        }
      }
    }
  }
  return best ? { room: best.room, serves: best.serves.map((r) => r.name ?? r.id) } : null
}

async function main() {
  loadEnvLocal()
  const pi = process.argv.indexOf("--project")
  const only = pi > -1 ? process.argv[pi + 1] : null
  const cs = process.env.DATABASE_URL
  if (!cs) { console.error("DATABASE_URL tidak diset"); process.exit(1) }
  const client = new pg.Client({ connectionString: cs, ssl: false })
  await client.connect()
  let rows
  try {
    const res = await client.query(
      only ? "SELECT project_id, payload FROM design_layouts WHERE project_id=$1"
           : "SELECT project_id, payload FROM design_layouts ORDER BY project_id",
      only ? [only] : []
    )
    rows = res.rows
  } finally { await client.end() }

  console.log(`\nPRATINJAU PERBAIKAN KETERJANGKAUAN — ${rows.length} denah\n`)
  let totalAdded = 0, totalUnresolved = 0, fixedFully = 0, totalCorridors = 0, viaCorridor = 0
  for (const row of rows) {
    const { added, unresolved } = planDoors(row.payload)
    const rooms = row.payload?.rooms ?? []
    const floors = row.payload?.floors ?? []
    // Denah produksi TIDAK menyimpan  (0 dari 16) — turunkan batas dari
    // bounding box ruang, sama seperti planCorridorFor.
    const site = row.payload?.site?.widthM
      ? row.payload.site
      : {
          widthM: Math.max(0, ...rooms.map((r) => r.x + r.width)),
          depthM: Math.max(0, ...rooms.map((r) => r.y + r.depth)),
        }

    // Sisa yang tak bisa disambung pintu: coba KORIDOR.
    const corridors = []
    let stillStuck = [...unresolved]
    if (unresolved.length && site.widthM) {
      for (const f of floors) {
        const fr = rooms.filter((r) => r.floorId === f.id)
        const isoHere = fr.filter((r) => unresolved.includes(r.name ?? r.id)).map((r) => r.id)
        if (!isoHere.length) continue
        const plan = planCorridor(
          f.id, rooms, isoHere,
          fr.filter((r) => CIRCULATION.has(r.type)).map((r) => r.id),
          site
        )
        if (!plan) continue
        corridors.push({ floorId: f.id, ...plan })
        stillStuck = stillStuck.filter((n) => !plan.serves.includes(n))
      }
    }

    totalAdded += added.length
    totalCorridors += corridors.length
    viaCorridor += corridors.reduce((n, c) => n + c.serves.length, 0)
    totalUnresolved += stillStuck.length
    if ((added.length || corridors.length) && !stillStuck.length) fixedFully++

    if (!added.length && !corridors.length && !stillStuck.length) continue
    console.log(`${row.project_id}`)
    for (const a of added) {
      console.log(`   + pintu ${a.room}:${a.side} -> ${a.to}  (pos ${a.pos}, lebar ${a.w})`)
    }
    for (const c of corridors) {
      console.log(
        `   + KORIDOR ${c.floorId} @ (${c.room.x}, ${c.room.y}) ${c.room.width}x${c.room.depth} m` +
        `  -> melayani ${c.serves.join(", ")}`
      )
    }
    if (stillStuck.length) {
      console.log(`   ! masih terkurung (perlu keputusan desain): ${stillStuck.join(", ")}`)
    }
  }
  console.log(`\nRingkasan:`)
  console.log(`  pintu ditambah otomatis    : ${totalAdded}`)
  console.log(`  koridor diusulkan          : ${totalCorridors} (melayani ${viaCorridor} ruang)`)
  console.log(`  ruang masih terkurung      : ${totalUnresolved}`)
  console.log(`  denah tuntas otomatis      : ${fixedFully} / ${rows.length}\n`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
