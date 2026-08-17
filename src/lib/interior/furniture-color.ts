import type { PlacedFurniture } from "@/types"
import type { getInteriorStyle } from "@/lib/interior/presets"

/**
 * Warna furniture per kategori mengikuti palette style aktif. Modul leaf
 * (tanpa React/three) — dipakai interior-room-scene DAN interior-workspace;
 * sebelumnya tinggal di interior-workspace.tsx dan membentuk import cycle
 * yang menyeret seluruh workspace (1400+ baris) ke bundle preview-3d.
 */
export function furnitureColor(
  item: PlacedFurniture,
  style: ReturnType<typeof getInteriorStyle>,
  index: number
): string {
  if (item.category === "bed") return style.colors.fabric
  if (item.category === "wardrobe" || item.category === "cabinet") return style.colors.wood
  if (item.category === "appliance") return style.colors.metal
  if (item.category === "decor") return style.colors.secondary
  return index % 2 === 0 ? style.colors.wood : style.colors.fabric
}
