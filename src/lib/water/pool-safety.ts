/**
 * Validasi keselamatan & beban kolam (KL-6) — advisory rule-based, BUKAN
 * analisis struktur final. Air ≈ 1 t/m³: kolam di lantai atas/dak menambah
 * beban besar → wajib engineer struktur + ruang mesin. Bila brief menyebut
 * anak, sarankan pagar pengaman. Modul murni, mudah ditest.
 *
 * DEFERRED (gelombang berikutnya): jarak ke batas lahan (butuh Project.site,
 * tidak tersedia di kontrak layout-only ini).
 */
import type { Brief, DesignLayout } from "@/types"
import { poolCirculation } from "@/lib/three/pool-circulation"

export type PoolSafetyIssue = {
  level: "warning" | "danger" | "info"
  poolId: string
  title: string
  message: string
}

// Kamar anak = kamar_tidur bernama "Kamar Anak" (tak ada RoomType khusus),
// jadi deteksi lewat nama ruang di brief.
const CHILD_RE = /anak|balita|bayi/i

function briefHasChildren(brief: Pick<Brief, "spaceProgram">): boolean {
  return (brief.spaceProgram ?? []).some((i) => CHILD_RE.test(i.name ?? ""))
}

export function poolSafetyIssues(
  layout: Pick<DesignLayout, "rooms" | "floors">,
  brief: Pick<Brief, "spaceProgram">,
): PoolSafetyIssue[] {
  const issues: PoolSafetyIssue[] = []
  const pools = layout.rooms.filter((r) => r.type === "kolam")
  const hasKids = briefHasChildren(brief)
  for (const pool of pools) {
    const floor = layout.floors.find((f) => f.id === pool.floorId)
    const upper = pool.floorId === "floor-rooftop" || (floor?.level ?? 1) > 1
    if (upper) {
      const tons = Math.round(poolCirculation(pool).volumeM3)
      issues.push({
        level: "danger",
        poolId: pool.id,
        title: "Beban kolam di lantai atas",
        message: `Kolam di lantai atas: beban air ±${tons} ton — wajib analisis struktur & ruang mesin.`,
      })
    }
    if (hasKids) {
      issues.push({
        level: "warning",
        poolId: pool.id,
        title: "Keselamatan anak",
        message: "Ada anak di rumah — pasang pagar pengaman kolam tinggi ≥ 1,1 m.",
      })
    }
  }
  return issues
}
