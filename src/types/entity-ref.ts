/**
 * EntityRef — SATU mata uang seleksi untuk semua komponen bangunan, dipakai
 * lintas 2D editor, 3D preview, dan (bertahap) interior. Menggantikan:
 * `selectedObjectId` type-erased di editor-store (kind ditebak ulang lewat
 * scan linear 7 koleksi) dan 7 field seleksi paralel di preview-store.
 * Lihat docs/UNIFIKASI_UI_EDITOR.md §3.1.
 *
 * Keputusan bentuk (divalidasi terhadap kode):
 * - Wall = structured `{roomId, side}` (bukan string `${roomId}:${side}`) —
 *   valid sejak konstruksi; bentuk string hanya untuk key map facade.
 * - Atap global legacy = singleton `{kind:"roof"}` tanpa id (menggantikan
 *   `roofSelected: boolean`).
 * - Railing dak rooftop DILEBUR ke kind "railing" via sentinel
 *   ROOFTOP_RAIL_ID di slot roomId — seluruh pipeline 3D sudah mengunci prim
 *   dak ke sentinel berbentuk roomId itu.
 * - Furniture/light = composite `{roomId, id}` — persis signature API
 *   interior-store & bentuk aksi AI (diadopsi di fase fold-in interior).
 *
 * PERHATIAN pemakaian di komponen React: ref adalah value object — JANGAN
 * `useStore(s => s.selected)` lalu banding `===`; select primitif
 * (`s.selected?.kind === "opening" ? s.selected.id : null`) atau pakai
 * `sameEntity`, supaya kanvas tidak re-render tiap seleksi berubah.
 */

import type { DesignLayout } from "@/types";
import type { Side } from "@/lib/geometry";

/** Duplikat nilai `ROOFTOP_RAIL_ID` dari build-model — disalin ke sini agar
 *  modul types tak bergantung ke lib/three; disamakan lewat unit test. */
export const ROOFTOP_RAIL_REF_ID = "rooftop-deck-railing";

export type EntityRef =
  | { kind: "room"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "wall"; roomId: string; side: Side }
  | { kind: "roof" }
  | { kind: "roofZone"; id: string }
  | { kind: "lamp"; id: string }
  | { kind: "railing"; roomId: string }
  | { kind: "exterior"; id: string }
  | { kind: "electrical"; id: string }
  | { kind: "water"; id: string }
  | { kind: "sanitation"; id: string }
  | { kind: "skylight"; id: string }
  | { kind: "furniture"; roomId: string; id: string }
  | { kind: "light"; roomId: string; id: string };

export type EntityKind = EntityRef["kind"];

/** Label Indonesia per kind — judul inspector & tombol "Hapus <label>". */
export const ENTITY_LABELS: Record<EntityKind, string> = {
  room: "ruang",
  opening: "bukaan",
  wall: "dinding",
  roof: "atap",
  roofZone: "zona atap",
  skylight: "skylight",
  lamp: "lampu",
  railing: "railing",
  exterior: "elemen eksterior",
  electrical: "titik listrik",
  water: "titik air",
  sanitation: "objek sanitasi",
  furniture: "furnitur",
  light: "lampu interior",
};

/** String stabil untuk React key / perbandingan / logging. */
export function entityKey(ref: EntityRef): string {
  switch (ref.kind) {
    case "roof":
      return "roof";
    case "wall":
      return `wall:${ref.roomId}:${ref.side}`;
    case "railing":
      return `railing:${ref.roomId}`;
    case "furniture":
    case "light":
      return `${ref.kind}:${ref.roomId}:${ref.id}`;
    default:
      return `${ref.kind}:${ref.id}`;
  }
}

export function sameEntity(a: EntityRef | null, b: EntityRef | null): boolean {
  if (a === null || b === null) return a === b;
  return entityKey(a) === entityKey(b);
}

/** Bentuk string wallId `${roomId}:${side}` — untuk key map facade/facadeInner. */
export function wallRefId(ref: Extract<EntityRef, { kind: "wall" }>): string {
  return `${ref.roomId}:${ref.side}`;
}

export function isRooftopRail(ref: EntityRef): boolean {
  return ref.kind === "railing" && ref.roomId === ROOFTOP_RAIL_REF_ID;
}

/**
 * Resolve id polos era-lama → EntityRef, memakai urutan prioritas PERSIS
 * scan 7-koleksi lama di EditorInspector (rooms → openings → electrical →
 * water → sanitation → exterior → roofZones) supaya perilaku identik saat
 * migrasi; lampu ditambahkan di ekor (tak pernah terjangkau dari 2D lama).
 * SATU-SATUNYA tempat scan ini boleh hidup.
 */
export function refFromLegacyId(layout: DesignLayout, id: string | null): EntityRef | null {
  if (!id) return null;
  if (layout.rooms.some((r) => r.id === id)) return { kind: "room", id };
  if (layout.openings.some((o) => o.id === id)) return { kind: "opening", id };
  if (layout.electrical?.some((p) => p.id === id)) return { kind: "electrical", id };
  if (layout.water?.some((p) => p.id === id)) return { kind: "water", id };
  const san = layout.sanitation;
  if (
    san &&
    (san.septicTank?.id === id ||
      san.soakwell?.id === id ||
      (Array.isArray(san.controlBoxes) && san.controlBoxes.some((b) => b?.id === id)))
  ) {
    return { kind: "sanitation", id };
  }
  if (layout.exteriorElements?.some((e) => e.id === id)) return { kind: "exterior", id };
  if (layout.roofZones?.some((z) => z.id === id)) return { kind: "roofZone", id };
  if (layout.exteriorLamps?.some((l) => l.id === id)) return { kind: "lamp", id };
  // Skylight di EKOR — urutan scan di atas adalah kontrak (id lama menang).
  if (layout.skylights?.some((sk) => sk.id === id)) return { kind: "skylight", id };
  return null;
}

/** Id polos era-lama dari sebuah ref (utk konsumen lama: plan-canvas, AI apply). */
export function legacyIdOf(ref: EntityRef | null): string | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "roof":
    case "wall":
    case "railing":
      return null; // tak pernah terwakili di selectedObjectId lama
    case "furniture":
    case "light":
      return ref.id;
    default:
      return ref.id;
  }
}

/**
 * Ruang "induk"/konteks dari sebuah ref — dipakai panel 3D untuk tetap
 * menampilkan kartu ruang + furnitur saat user memilih bukaan/dinding/lampu
 * di dalam/di sekitar ruang itu.
 */
export function hostRoomIdOf(ref: EntityRef | null, layout: DesignLayout): string | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "room":
      return ref.id;
    case "wall":
      return ref.roomId;
    case "railing":
      return isRooftopRail(ref) ? null : ref.roomId;
    case "furniture":
    case "light":
      return ref.roomId;
    case "opening": {
      const op = layout.openings.find((o) => o.id === ref.id);
      if (!op) return null;
      const idx = op.wallId.lastIndexOf(":");
      return idx > 0 ? op.wallId.slice(0, idx) : null;
    }
    case "electrical":
      return layout.electrical?.find((p) => p.id === ref.id)?.roomId ?? null;
    case "water":
      return layout.water?.find((p) => p.id === ref.id)?.roomId ?? null;
    default:
      return null;
  }
}

/**
 * Lantai tempat sebuah ref berada — `select()` memakai ini untuk ikut
 * men-set `selectedFloorId` (2D floor-scoped; tanpa ini seleksi yang dibuat
 * di 3D tidak terlihat saat pindah ke 2D). null = jangan pindah lantai
 * (atap global, sanitasi level-tanah).
 */
/**
 * Identitas sintetis dinding penutup fasad lantai elevated (`w-edge-*` di
 * build-model) — bukan Room, tapi butuh identitas wall agar bisa diklik &
 * di-cladding (paritas ROOFTOP_RAIL_REF_ID). wallKey: `edge-{floorId}:{side}`.
 */
export const edgeWallRoomId = (floorId: string) => `edge-${floorId}`;
export const isEdgeWallRoomId = (id: string) => id.startsWith("edge-");
export const edgeWallFloorId = (roomId: string) =>
  isEdgeWallRoomId(roomId) ? roomId.slice("edge-".length) : null;

export function floorIdOf(ref: EntityRef | null, layout: DesignLayout): string | null {
  if (!ref) return null;
  const roomFloor = (roomId: string) =>
    layout.rooms.find((r) => r.id === roomId)?.floorId ?? null;
  switch (ref.kind) {
    case "room":
      return roomFloor(ref.id);
    case "wall":
      return edgeWallFloorId(ref.roomId) ?? roomFloor(ref.roomId);
    case "railing":
      return isRooftopRail(ref)
        ? layout.floors.find((f) => f.id === "floor-rooftop")?.id ?? null
        : roomFloor(ref.roomId);
    case "furniture":
    case "light":
      return roomFloor(ref.roomId);
    case "opening":
      return layout.openings.find((o) => o.id === ref.id)?.floorId ?? null;
    case "roofZone":
      return layout.roofZones?.find((z) => z.id === ref.id)?.floorId ?? null;
    case "lamp":
      return layout.exteriorLamps?.find((l) => l.id === ref.id)?.floorId ?? null;
    case "exterior":
      return layout.exteriorElements?.find((e) => e.id === ref.id)?.floorId ?? null;
    case "electrical": {
      const p = layout.electrical?.find((pt) => pt.id === ref.id);
      return p ? roomFloor(p.roomId) : null;
    }
    case "water": {
      const p = layout.water?.find((pt) => pt.id === ref.id);
      return p ? roomFloor(p.roomId) : null;
    }
    case "roof":
    case "sanitation":
    // Skylight hidup di layer Atap — pemetaan pseudo-layer ROOF_LAYER_ID
    // dilakukan di select() editor-store (presedan roofZone), bukan di sini.
    case "skylight":
      return null;
  }
}

/**
 * Apakah ref masih menunjuk entity yang ada di layout — dipakai epilogue
 * `validateSelection` di commit() editor-store untuk menihilkan seleksi
 * menggantung setelah mutasi (hapus/undo/AI apply).
 */
export function refResolves(ref: EntityRef | null, layout: DesignLayout): boolean {
  if (!ref) return false;
  switch (ref.kind) {
    case "roof":
      return true;
    case "room":
      return layout.rooms.some((r) => r.id === ref.id);
    case "wall": {
      const edgeFloor = edgeWallFloorId(ref.roomId);
      if (edgeFloor) return layout.floors.some((f) => f.id === edgeFloor);
      return layout.rooms.some((r) => r.id === ref.roomId);
    }
    case "railing":
      return isRooftopRail(ref) || layout.rooms.some((r) => r.id === ref.roomId);
    case "opening":
      return layout.openings.some((o) => o.id === ref.id);
    case "roofZone":
      return !!layout.roofZones?.some((z) => z.id === ref.id);
    case "lamp":
      return !!layout.exteriorLamps?.some((l) => l.id === ref.id);
    case "exterior":
      return !!layout.exteriorElements?.some((e) => e.id === ref.id);
    case "electrical":
      return !!layout.electrical?.some((p) => p.id === ref.id);
    case "water":
      return !!layout.water?.some((p) => p.id === ref.id);
    case "sanitation":
      return refFromLegacyId(layout, ref.id)?.kind === "sanitation";
    case "skylight":
      return !!layout.skylights?.some((sk) => sk.id === ref.id);
    case "furniture":
    case "light":
      // Interior plan hidup di store terpisah sampai fase fold-in — anggap
      // resolve selama ruangnya ada.
      return layout.rooms.some((r) => r.id === ref.roomId);
  }
}
