/**
 * Estimasi biaya & energi kelistrikan — LENGKAP untuk use-case lapangan:
 * beban riil per lampu (Watt, bisa di-override per fixture), rekomendasi daya
 * PLN, rincian biaya instalasi (per titik, kabel, panel/MCB, unit lampu), dan
 * perkiraan konsumsi + tagihan energi bulanan.
 *
 * Pure functions — dipakai RAB (line items kategori "listrik") dan panel
 * ringkasan. Harga = harga pasaran terpasang Jabodetabek 2026 (material +
 * jasa), confidence "medium" — kontraktor tetap sumber angka final.
 */
import type { DesignLayout, ExteriorLamp, LightingFixture, RoomInteriorPlan } from "@/types"
import { LAMP_LOAD_VA, LOAD_VA } from "./electrical"
import { poolCirculation } from "@/lib/three/pool-circulation"
import { poolElectrical, POOL_LIGHT_WATT } from "@/lib/three/pool-electrical"

/** Watt default lampu eksterior per jenis (LED terpasang umum). */
export const EXTERIOR_LAMP_WATT: Record<ExteriorLamp["kind"], number> = {
  wall: 7,
  bollard: 5,
  canopy: 9,
}

/** Jam nyala per hari untuk estimasi energi (lampu eksterior ~ senja–pagi). */
const HOURS_PER_DAY = { interior: 6, exterior: 11 }

/** Tarif listrik rumah tangga (R-1/TR 1300–2200 VA), IDR per kWh. */
export const PLN_TARIFF_IDR_PER_KWH = 1444.7

/** Pilihan daya tersambung PLN (VA). */
export const PLN_TIERS_VA = [900, 1300, 2200, 3500, 4400, 5500, 7700, 11000]

/** Harga terpasang (material + jasa), IDR. */
export const ELECTRICAL_PRICES = {
  titikLampu: 185_000,
  titikStopkontak: 165_000,
  titikSaklar: 95_000,
  kabelNym2x15PerM: 18_000, // penerangan — NYM 2×1,5 mm² dalam conduit
  kabelNym3x25PerM: 28_000, // stopkontak/daya — NYM 3×2,5 mm²
  panelBox: 350_000,
  mcbPerSirkuit: 95_000,
  grounding: 450_000,
} as const

/** Harga unit lampu berdasar watt (LED, terpasang tanpa jasa titik). */
export function lampUnitPriceIDR(watt: number): number {
  if (watt <= 5) return 45_000
  if (watt <= 9) return 65_000
  if (watt <= 15) return 110_000
  if (watt <= 25) return 185_000
  return 275_000
}

/**
 * Beban peralatan rumah tangga umum, diturunkan DETERMINISTIK dari denah —
 * supaya rekomendasi daya PLN & tagihan bulanan realistis, bukan cuma lampu.
 * User-facing asumsi; angka watt = tipikal alat hemat energi 2026.
 */
export type ApplianceLoad = {
  id: string
  label: string
  watt: number
  qty: number
  hoursPerDay: number
  /** Dari mana asumsi ini muncul (ruang/titik yang memicunya). */
  source: string
}

export function deriveApplianceLoads(layout: DesignLayout): ApplianceLoad[] {
  const out: ApplianceLoad[] = []
  const rooms = layout.rooms
  const count = (t: string) => rooms.filter((r) => r.type === t).length

  const bedrooms = count("kamar_tidur")
  if (bedrooms > 0) {
    out.push({
      id: "ac",
      label: "AC split ½ PK",
      watt: 400,
      qty: bedrooms,
      hoursPerDay: 8,
      source: `${bedrooms} kamar tidur`,
    })
  }
  if (count("dapur") > 0) {
    out.push(
      { id: "kulkas", label: "Kulkas 2 pintu", watt: 100, qty: 1, hoursPerDay: 24, source: "dapur" },
      { id: "rice-cooker", label: "Rice cooker", watt: 350, qty: 1, hoursPerDay: 2, source: "dapur" }
    )
  }
  if (count("laundry") > 0) {
    out.push({ id: "mesin-cuci", label: "Mesin cuci", watt: 350, qty: 1, hoursPerDay: 1, source: "ruang laundry" })
  }
  if ((layout.water ?? []).length > 0) {
    out.push({ id: "pompa-air", label: "Pompa air", watt: 250, qty: 1, hoursPerDay: 2, source: `${(layout.water ?? []).length} titik air` })
  }
  if (count("kamar_mandi") > 0) {
    out.push({ id: "water-heater", label: "Water heater listrik", watt: 350, qty: Math.min(2, count("kamar_mandi")), hoursPerDay: 1, source: "kamar mandi" })
  }
  if (count("ruang_keluarga") > 0 || count("ruang_tamu") > 0) {
    out.push({ id: "tv", label: "TV + perangkat elektronik", watt: 120, qty: 1, hoursPerDay: 6, source: "ruang keluarga/tamu" })
  }
  if (count("workspace") > 0) {
    out.push({ id: "komputer", label: "Komputer kerja", watt: 200, qty: count("workspace"), hoursPerDay: 8, source: "workspace" })
  }
  // Kolam renang: pompa sirkulasi (jalan ~8 j/hari) + lampu bawah air (~4 j
  // malam) menambah beban PLN & energi.
  const poolRooms = rooms.filter((r) => r.type === "kolam")
  if (poolRooms.length > 0) {
    const pumpW = Math.round(poolRooms.reduce((s, r) => s + poolCirculation(r).pumpHp * 746, 0))
    if (pumpW > 0) {
      out.push({ id: "pompa-kolam", label: "Pompa sirkulasi kolam", watt: pumpW, qty: 1, hoursPerDay: 8, source: `${poolRooms.length} kolam` })
    }
    const poolLights = poolRooms.reduce((s, r) => s + poolElectrical(r).lights, 0)
    if (poolLights > 0) {
      out.push({ id: "lampu-kolam", label: "Lampu bawah air kolam", watt: POOL_LIGHT_WATT, qty: poolLights, hoursPerDay: 4, source: `${poolLights} titik` })
    }
    // Opsi spa (KL-7): jet/blower, pemanas, salt chlorinator.
    const jetW = poolRooms.reduce((s, r) => s + poolElectrical(r).jetBlowerW, 0)
    if (jetW > 0) {
      out.push({ id: "jet-spa", label: "Jet/blower spa", watt: jetW, qty: 1, hoursPerDay: 1, source: "spa" })
    }
    const heaterW = poolRooms.reduce((s, r) => s + poolElectrical(r).heaterW, 0)
    if (heaterW > 0) {
      out.push({ id: "heater-kolam", label: "Pemanas kolam", watt: heaterW, qty: 1, hoursPerDay: 2, source: "kolam" })
    }
    const chlorW = poolRooms.reduce((s, r) => s + poolElectrical(r).chlorinatorW, 0)
    if (chlorW > 0) {
      out.push({ id: "chlorinator-kolam", label: "Salt chlorinator", watt: chlorW, qty: 1, hoursPerDay: 8, source: "kolam" })
    }
  }
  return out
}

export type ElectricalCosting = {
  /** Total daya lampu tersambung (Watt). */
  totalLampWatt: number
  /** Beban peralatan rumah tangga (diturunkan dari denah). */
  appliances: ApplianceLoad[]
  totalApplianceWatt: number
  /** Total beban tersambung (VA) — lampu + peralatan + stopkontak (LOAD_VA). */
  totalVA: number
  /** Daya PLN yang disarankan (VA), dengan margin 25%. */
  recommendedPlnVA: number
  counts: {
    titikLampuInterior: number
    titikLampuEksterior: number
    titikStopkontak: number
    titikSaklar: number
    sirkuit: number
  }
  cable: { peneranganM: number; stopkontakM: number }
  /** Rincian biaya pembangunan (IDR) — siap jadi BOQ items. */
  costs: {
    instalasiTitik: number
    kabelConduit: number
    panelMcbGrounding: number
    unitLampu: number
    total: number
  }
  /** Perkiraan energi per bulan (lampu + peralatan). */
  monthlyEnergy: {
    kwh: number
    costIDR: number
    breakdown: { lampuKwh: number; peralatanKwh: number }
  }
}

function interiorLampWatt(f: LightingFixture): number {
  return f.watt ?? LAMP_LOAD_VA[f.type] ?? 9
}

export function exteriorLampWatt(l: ExteriorLamp): number {
  return l.watt ?? EXTERIOR_LAMP_WATT[l.kind] ?? 7
}

/**
 * Hitung keseluruhan kelistrikan dari layout (+ titik & lampu eksterior) dan
 * rencana interior (lampu per ruang). Panjang kabel = estimasi Manhattan dari
 * panel (titik `panel` bila ada; selain itu pojok site) ke tiap titik, +20%
 * slack naik-turun dinding/plafon.
 */
export function computeElectricalCosting(
  layout: DesignLayout,
  interiors: RoomInteriorPlan[],
  exteriorLamps: ExteriorLamp[]
): ElectricalCosting {
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]))

  // ── Beban & titik lampu ──
  let lampWatt = 0
  let interiorLampCount = 0
  let interiorKwh = 0
  const lampUnitCosts: number[] = []
  for (const plan of interiors) {
    for (const f of plan.lighting ?? []) {
      const qty = Number.isFinite(f?.qty) && f.qty > 0 ? f.qty : 0
      if (!qty) continue
      const w = interiorLampWatt(f)
      interiorLampCount += qty
      lampWatt += w * qty
      interiorKwh += (w * qty * HOURS_PER_DAY.interior * 30) / 1000
      for (let i = 0; i < qty; i++) lampUnitCosts.push(lampUnitPriceIDR(w))
    }
  }
  let exteriorKwh = 0
  for (const l of exteriorLamps) {
    const w = exteriorLampWatt(l)
    lampWatt += w
    exteriorKwh += (w * HOURS_PER_DAY.exterior * 30) / 1000
    lampUnitCosts.push(lampUnitPriceIDR(w))
  }

  // ── Beban peralatan rumah tangga (dari denah) ──
  const appliances = deriveApplianceLoads(layout)
  let applianceWatt = 0
  let applianceKwh = 0
  for (const a of appliances) {
    applianceWatt += a.watt * a.qty
    applianceKwh += (a.watt * a.qty * a.hoursPerDay * 30) / 1000
  }

  // ── Titik listrik dari layer 2D ──
  let outlet = 0
  let saklar = 0
  let daya = 0
  let panelPoint: { x: number; y: number } | null = null
  for (const p of layout.electrical ?? []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.type === "stopkontak") outlet++
    else if (p.type === "stopkontak_daya") daya++
    else if (p.type === "saklar_tunggal" || p.type === "saklar_ganda") saklar++
    else if (p.type === "panel") panelPoint = { x: p.x, y: p.y }
  }

  const totalVA =
    lampWatt + applianceWatt + outlet * LOAD_VA.stopkontak + daya * LOAD_VA.stopkontak_daya
  // Faktor kebutuhan 0,7 (tidak semua alat menyala bersamaan) lalu margin 25%.
  const withMargin = totalVA * 0.7 * 1.25
  const recommendedPlnVA =
    PLN_TIERS_VA.find((t) => t >= withMargin) ?? PLN_TIERS_VA[PLN_TIERS_VA.length - 1]

  // ── Estimasi kabel: Manhattan panel → titik (+20% slack) ──
  const panel = panelPoint ?? { x: 0, y: 0 }
  const manhattan = (x: number, y: number) =>
    Math.abs(x - panel.x) + Math.abs(y - panel.y)
  let peneranganM = 0
  let stopkontakM = 0
  for (const plan of interiors) {
    const room = rooms.get(plan.roomId)
    if (!room) continue
    for (const f of plan.lighting ?? []) {
      const qty = Number.isFinite(f?.qty) && f.qty > 0 ? f.qty : 0
      if (!qty) continue
      // fixture koordinat room-local → absolut
      peneranganM += (manhattan(room.x + (f.x || 0), room.y + (f.y || 0)) + 3) * qty
    }
  }
  for (const l of exteriorLamps) peneranganM += manhattan(l.x, l.y) + 3
  for (const p of layout.electrical ?? []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.type === "stopkontak" || p.type === "stopkontak_daya") {
      stopkontakM += manhattan(p.x, p.y) + 2
    }
  }
  peneranganM = Math.ceil(peneranganM * 1.2)
  stopkontakM = Math.ceil(stopkontakM * 1.2)

  // ── Sirkuit (aturan sama dengan buildCircuits: penerangan/lantai,
  //    stopkontak/lantai, khusus per titik daya) ──
  const floorsWithLoad = new Set<string>()
  for (const plan of interiors) {
    if ((plan.lighting ?? []).length > 0) {
      floorsWithLoad.add(plan.floorId || rooms.get(plan.roomId)?.floorId || "")
    }
  }
  for (const l of exteriorLamps) floorsWithLoad.add(l.floorId)
  const outletFloors = new Set<string>()
  for (const p of layout.electrical ?? []) {
    if (p?.type === "stopkontak") {
      outletFloors.add(rooms.get(p.roomId)?.floorId ?? "")
    }
  }
  const sirkuit = floorsWithLoad.size + outletFloors.size + daya

  const titikLampuEksterior = exteriorLamps.length
  const instalasiTitik =
    (interiorLampCount + titikLampuEksterior) * ELECTRICAL_PRICES.titikLampu +
    (outlet + daya) * ELECTRICAL_PRICES.titikStopkontak +
    saklar * ELECTRICAL_PRICES.titikSaklar
  const kabelConduit =
    peneranganM * ELECTRICAL_PRICES.kabelNym2x15PerM +
    stopkontakM * ELECTRICAL_PRICES.kabelNym3x25PerM
  const panelMcbGrounding =
    ELECTRICAL_PRICES.panelBox +
    Math.max(1, sirkuit) * ELECTRICAL_PRICES.mcbPerSirkuit +
    ELECTRICAL_PRICES.grounding
  const unitLampu = lampUnitCosts.reduce((s, v) => s + v, 0)

  const lampuKwh = Math.round((interiorKwh + exteriorKwh) * 10) / 10
  const peralatanKwh = Math.round(applianceKwh * 10) / 10
  const kwh = Math.round((lampuKwh + peralatanKwh) * 10) / 10

  return {
    totalLampWatt: Math.round(lampWatt),
    appliances,
    totalApplianceWatt: Math.round(applianceWatt),
    totalVA: Math.round(totalVA),
    recommendedPlnVA,
    counts: {
      titikLampuInterior: interiorLampCount,
      titikLampuEksterior,
      titikStopkontak: outlet + daya,
      titikSaklar: saklar,
      sirkuit: Math.max(1, sirkuit),
    },
    cable: { peneranganM, stopkontakM },
    costs: {
      instalasiTitik,
      kabelConduit,
      panelMcbGrounding,
      unitLampu,
      total: instalasiTitik + kabelConduit + panelMcbGrounding + unitLampu,
    },
    monthlyEnergy: {
      kwh,
      costIDR: Math.round(kwh * PLN_TARIFF_IDR_PER_KWH),
      breakdown: { lampuKwh, peralatanKwh },
    },
  }
}
