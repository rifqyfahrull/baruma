/** Number / currency / date formatters (id-ID). */

const idr = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

const numberFmt = new Intl.NumberFormat("id-ID")

/** "Rp 1.250.000.000" */
export function formatIDR(value: number): string {
  return idr.format(Math.round(value))
}

/** Compact rupiah: "Rp 1,25 M", "Rp 850 jt", "Rp 500 rb". */
export function formatIDRCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) {
    return `Rp ${trim(value / 1_000_000_000)} M`
  }
  if (abs >= 1_000_000) {
    return `Rp ${trim(value / 1_000_000)} jt`
  }
  if (abs >= 1_000) {
    return `Rp ${trim(value / 1_000)} rb`
  }
  return formatIDR(value)
}

/** Compact range: "Rp 1,1 – 1,4 M". */
export function formatIDRRange(min: number, max: number): string {
  return `${formatIDRCompact(min)} – ${formatIDRCompact(max)}`
}

function trim(n: number): string {
  return n
    .toLocaleString("id-ID", { maximumFractionDigits: 2 })
    .replace(/,00$/, "")
}

export function formatNumber(value: number, maxFractionDigits = 1): string {
  return value.toLocaleString("id-ID", {
    maximumFractionDigits: maxFractionDigits,
  })
}

/** "64 m²" */
export function formatArea(m2: number): string {
  return `${formatNumber(m2)} m²`
}

/** "8 × 12 m" */
export function formatDimensions(widthM: number, depthM: number): string {
  return `${formatNumber(widthM)} × ${formatNumber(depthM)} m`
}

/* ── Length units (for the 2D editor dimension overlay) ── */

export type LengthUnit = "m" | "cm" | "mm" | "in" | "ft"

/** Units offered in the editor's unit switcher (label is the short suffix). */
export const LENGTH_UNITS: { id: LengthUnit; label: string; name: string }[] = [
  { id: "m", label: "m", name: "Meter" },
  { id: "cm", label: "cm", name: "Sentimeter" },
  { id: "mm", label: "mm", name: "Milimeter" },
  { id: "in", label: "in", name: "Inci" },
  { id: "ft", label: "ft", name: "Kaki" },
]

const M_TO_IN = 39.3700787402

/** The numeric part of a length (no trailing unit). Imperial renders the
 *  symbol inline (47,2″ / 3′11″) since those are per-value, not a suffix. */
function lengthValue(meters: number, unit: LengthUnit): string {
  switch (unit) {
    case "m":
      return formatNumber(meters, 2)
    case "cm":
      return String(Math.round(meters * 100))
    case "mm":
      return String(Math.round(meters * 1000))
    case "in":
      return `${formatNumber(meters * M_TO_IN, 1)}″`
    case "ft": {
      const totalInches = Math.round(meters * M_TO_IN)
      const ft = Math.floor(totalInches / 12)
      return `${ft}′${totalInches - ft * 12}″`
    }
  }
}

function unitSuffix(unit: LengthUnit): string {
  return unit === "m" ? " m" : unit === "cm" ? " cm" : unit === "mm" ? " mm" : ""
}

/** Format a length given in METERS into the chosen unit (e.g. "1,2 m", "1200 mm", "3′11″"). */
export function formatLength(meters: number, unit: LengthUnit): string {
  return lengthValue(meters, unit) + unitSuffix(unit)
}

/** "3,5 × 4 m" / "3500 × 4000 mm" — width × depth, unit suffix shown once. */
export function formatLengthPair(widthM: number, depthM: number, unit: LengthUnit): string {
  return `${lengthValue(widthM, unit)} × ${lengthValue(depthM, unit)}${unitSuffix(unit)}`
}

/** Signed elevation label for split-level, e.g. "±0 m", "-0,18 m", "+180 mm". */
export function formatElevation(meters: number, unit: LengthUnit): string {
  const sign = meters > 0 ? "+" : meters < 0 ? "-" : "±"
  return `${sign}${formatLength(Math.abs(meters), unit)}`
}

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

/** "baru saja", "3 jam lalu", "2 hari lalu", or a date. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const min = Math.round(diffMs / 60_000)
  if (min < 1) return "baru saja"
  if (min < 60) return `${min} menit lalu`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} hari lalu`
  return formatDate(iso)
}

export { numberFmt }
