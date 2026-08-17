/**
 * Penempatan lampu eksterior untuk preview 3D — fixture yang TERLIHAT siang
 * hari dan menyala (emissive + point light nyata) di mode malam, sehingga
 * cahaya malam punya sumber, bukan hanya jendela yang berpendar.
 *
 * Pure & deterministik (tanpa Math.random):
 * - lampu dinding: di samping tiap PINTU lantai dasar yang dindingnya berada
 *   di tepi footprint bangunan (pintu keluar/masuk) — praktik nyata: lampu
 *   teras di samping pintu;
 * - downlight kanopi: di tengah tiap carport (menempel di bawah kanopi, atau
 *   di bawah lantai atas bila carport tertutup massa bangunan);
 * - bollard taman: dua tiang lampu rendah di sudut-sudut taman.
 */
import type { DesignLayout, ExteriorLamp } from "@/types"
import { openingSegment, parseOpeningWall, rectsOverlap } from "@/lib/geometry"
import { buildingFootprint } from "@/lib/structural/grid"
import { SLAB_T, WALL_H } from "@/lib/three/build-model"
import { floorElevations } from "@/lib/geometry/vertical"

export type LampPlacement = ExteriorLamp

/**
 * Lampu efektif sebuah layout: daftar EDITABLE di layout.exteriorLamps bila
 * ada; selain itu penempatan otomatis. Edit pertama (via editor-store)
 * mematerialisasi daftar otomatis lalu memodifikasinya.
 */
export function effectiveLamps(layout: DesignLayout): ExteriorLamp[] {
  return layout.exteriorLamps ?? lampPlacements(layout)
}

const EDGE_TOL = 0.06

export function lampPlacements(layout: DesignLayout): ExteriorLamp[] {
  const out: ExteriorLamp[] = []
  const ground = layout.floors[0]
  if (!ground) return out
  const fp = buildingFootprint(layout)

  // Lampu dinding di samping pintu eksterior lantai dasar.
  for (const op of layout.openings) {
    if (op.type !== "door" || op.floorId !== ground.id) continue
    const parsed = parseOpeningWall(op.wallId)
    if (!parsed) continue
    const host = layout.rooms.find((r) => r.id === parsed.roomId)
    if (!host || host.floorId !== ground.id) continue
    const seg = openingSegment(host, parsed.side, op.positionM, op.widthM)
    const horizontal = parsed.side === "n" || parsed.side === "s"
    const line = horizontal ? seg.y1 : seg.x1
    const onEdge = horizontal
      ? Math.abs(line - fp.y0) <= EDGE_TOL || Math.abs(line - (fp.y0 + fp.depthM)) <= EDGE_TOL
      : Math.abs(line - fp.x0) <= EDGE_TOL || Math.abs(line - (fp.x0 + fp.widthM)) <= EDGE_TOL
    if (!onEdge) continue
    // Di samping kusen (0,35 m dari tepi daun pintu), menjauh dari ujung dinding.
    const wallStart = horizontal ? host.x : host.y
    const wallEnd = horizontal ? host.x + host.width : host.y + host.depth
    const segEnd = horizontal ? seg.x2 : seg.y2
    const segStart = horizontal ? seg.x1 : seg.y1
    const along = segEnd + 0.35 <= wallEnd - 0.15 ? segEnd + 0.35 : Math.max(wallStart + 0.15, segStart - 0.35)
    out.push({
      id: `lamp-door-${op.id}`,
      kind: "wall",
      x: horizontal ? along : line,
      y: horizontal ? line : along,
      mountH: 2.0,
      side: parsed.side,
      floorId: ground.id,
    })
  }

  for (const room of layout.rooms) {
    if (room.floorId !== ground.id) continue
    if (room.type === "carport") {
      // Sama dengan aturan kanopi build-model: tertutup lantai atas → fixture
      // menempel di bawah slab lantai atas; selain itu di bawah kanopi 2,5 m.
      const above = layout.floors[1]
      const covered =
        !!above && layout.rooms.some((r) => r.floorId === above.id && rectsOverlap(r, room))
      out.push({
        id: `lamp-cp-${room.id}`,
        kind: "canopy",
        x: room.x + room.width / 2,
        y: room.y + room.depth / 2,
        // Plafon carport tertutup = bawah slab lantai atas — pakai tinggi
        // dinding LANTAI DASAR dari tabel elevasi (Fase D), bukan konstanta.
        mountH: covered
          ? (floorElevations(layout.floors).get(ground.id)?.wallHM ?? WALL_H) +
            SLAB_T / 2 -
            0.06
          : 2.44,
        floorId: ground.id,
      })
    } else if (room.type === "taman") {
      out.push(
        {
          id: `lamp-tm-${room.id}-a`,
          kind: "bollard",
          x: room.x + 0.3,
          y: room.y + 0.3,
          mountH: 0,
          floorId: ground.id,
        },
        {
          id: `lamp-tm-${room.id}-b`,
          kind: "bollard",
          x: room.x + room.width - 0.3,
          y: room.y + room.depth - 0.3,
          mountH: 0,
          floorId: ground.id,
        }
      )
    }
  }
  return out
}
