import { create } from "zustand";
import { nanoid } from "nanoid";

import type {
  DesignLayout,
  EditorTool,
  ElectricalPoint,
  ElectricalPointType,
  ExteriorElement,
  ExteriorLamp,
  FacadeElement,
  FacadeElementKind,
  Opening,
  OpeningKind,
  RailingStyle,
  Room,
  RoofSpec,
  RoofZone,
  RoomType,
  ValidationIssue,
  WaterPoint,
  WaterPointType,
} from "@/types";
import { openingDefaultsForKind, ROOM_TYPES } from "@/lib/constants";
import {
  edgeWallFloorId,
  floorIdOf,
  isEdgeWallRoomId,
  legacyIdOf,
  refFromLegacyId,
  refResolves,
  type EntityRef,
} from "@/types/entity-ref";
import { edgeWallSideGeometry, widestEdgeWallSpan } from "@/lib/geometry/edge-wall";
import {
  applyResize,
  clamp,
  clampOrDropOpeningsForRoom,
  edgeLength,
  findOpeningGapPositionM,
  openingWallId,
  parseOpeningWall,
  roomArea,
  round2,
  snap,
  type HandleId,
  type Side,
  type Rect,
  LEVEL_OFFSET_MAX_M,
} from "@/lib/geometry";
import {
  moveCandidatesX,
  moveCandidatesY,
  resizeCandidatesX,
  resizeCandidatesY,
  snapAxis,
  snapMove,
} from "@/lib/geometry/alignment";
import { alignFloorRoomsToFootprint, indoorFootprintBBox, type AlignSummary } from "@/lib/geometry/floor-align";
import { isOutdoorRoom } from "@/lib/geometry/connectivity";
import { segmentLength } from "@/lib/exterior/geometry";
import { clampRooftopArea } from "@/lib/geometry/rooftop";
import { buildingFootprint } from "@/lib/structural/grid";
import {
  clampCourtyardRect,
  clampToHost,
  courtyardRect,
  flatRoofHosts,
  resolveFlatHost,
  skylightRect,
} from "@/lib/geometry/roof-holes";
import { defaultPoolRect, plungeRectInDeck } from "@/lib/three/pool";
import { facadeKeysForWall, formatFacadeKey } from "@/lib/three/facade-bands";
import { buildWallAccent, isAccentOf } from "@/lib/exterior/facade-accents";
import { buildFacadeComposerTemplate } from "@/lib/exterior/facade-templates";
import { effectiveRoofZones, hasExplicitRoofZones } from "@/lib/exterior/roof-zones";
import { effectiveRoof } from "@/lib/geometry/roof";
import { rooftopStrips } from "@/lib/geometry/rooftop";
import {
  CANTILEVER_MAX_M,
  isMezzanineFloor,
  isRegularFloor,
  isRooftopFloor,
  mezzanineParentOf,
  topRegularFloorId,
} from "@/lib/editor/floors";
import {
  DEFAULT_FLOOR_TO_FLOOR_M,
  WALL_H,
  floorElevations,
} from "@/lib/geometry/vertical";
import { validateLayout } from "@/lib/validation";
import type { LengthUnit } from "@/lib/format";
import { makeRoom, makeFloor, defaultRoomSize } from "@/lib/editor/create";
import { lampPlacements } from "@/lib/three/lamps";
import {
  buildFacadePreset,
  orientationToFrontSide,
} from "@/lib/three/facade-presets";

type Site = { widthM: number; depthM: number };

type ExteriorDragPatch = {
  x?: number;
  y?: number;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  points?: Array<{ x: number; y: number }>;
};

type EditorState = {
  layout: DesignLayout | null;
  site: Site | null;
  structural: ValidationIssue[];

  activeTool: EditorTool;
  selectedFloorId: string | null;
  /**
   * Seleksi terpadu (EntityRef) — SATU sumber kebenaran seleksi utk 2D & 3D
   * (unifikasi P1, lihat docs/UNIFIKASI_UI_EDITOR.md §3.2). TIDAK di-undo-track;
   * mutasi via commit() memvalidasi ref (dangling → null) lewat epilogue.
   */
  selected: EntityRef | null;
  /**
   * Naik tiap select() dgn ref non-null (TERMASUK memilih ulang entity yang
   * sama) — sinyal "user baru menunjuk sesuatu" utk UI tablet: drawer
   * inspector auto-terbuka saat objek di-tap (clearSelection tidak menaikkan).
   */
  selectionNonce: number;
  /** Mirror legacy dari `selected` (id polos) — konsumen lama (plan-canvas,
   *  inspector, AI apply) masih membacanya; dihapus saat migrasi P2 tuntas. */
  selectedObjectId: string | null;

  zoom: number;
  pan: { x: number; y: number };
  snapEnabled: boolean;
  gridSize: number; // meters

  // dimension overlay (view state — not undo-tracked)
  showDimensions: boolean;
  dimensionUnit: LengthUnit;
  showHiddenExteriorElements: boolean;
  /** Toggle global: sembunyikan/munculkan SEMUA zona atap di denah 2D. */
  showRoofZones: boolean;
  /** Reveal zona atap yang per-zona di-hidden (antisipasi dead-end). */
  showHiddenRoofZones: boolean;

  past: DesignLayout[];
  future: DesignLayout[];
  dirty: boolean;
  layoutRevision: number | null;
  editSequence: number;
  /**
   * Viewer publik read-only (mis. template gallery) — TIDAK ada mutasi
   * layout sama sekali. `commit()` (gateway satu-satunya utk mutasi bertahap
   * undo-aware) no-op bila true. Disetel lewat opsi `loadLayout(..., { readOnly })`;
   * default selalu false sehingga editor asli (2D editor login) tetap
   * full-edit tanpa perlu menyebut opsi ini.
   */
  readOnly: boolean;

  alignmentGuides: {
    x: number[];
    y: number[];
    equalX: number[];
    equalY: number[];
  };

  // transient drag state
  _dragBase: DesignLayout | null;
  _dragPushed: boolean;

  loadLayout: (
    layout: DesignLayout,
    site: Site,
    structural: ValidationIssue[],
    revision?: number | null,
    opts?: { readOnly?: boolean },
  ) => void;
  setTool: (tool: EditorTool) => void;
  /** Seleksi terpadu — ikut men-set selectedFloorId ke lantai entity-nya. */
  select: (ref: EntityRef | null) => void;
  clearSelection: () => void;
  /** Legacy: seleksi via id polos — delegasi ke select() lewat refFromLegacyId. */
  selectObject: (id: string | null) => void;
  setSelectedFloor: (id: string) => void;

  setZoom: (z: number) => void;
  zoomBy: (factor: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  panBy: (dx: number, dy: number) => void;
  resetView: () => void;
  toggleSnap: () => void;
  toggleDimensions: () => void;
  setDimensionUnit: (unit: LengthUnit) => void;

  setShowHiddenExteriorElements: (show: boolean) => void;
  setShowRoofZones: (show: boolean) => void;
  setShowHiddenRoofZones: (show: boolean) => void;
  setRoofZoneHidden: (id: string, hidden: boolean) => void;
  /** Tampilkan komponen cross-floor yang penetrasi lantai (tangga, lift, dll). */
  showCrossFloorRooms: boolean;
  setShowCrossFloorRooms: (show: boolean) => void;
  /**
   * Fase 3 (unifikasi UI editor): SATU field menggantikan 5 field
   * `pending{Room,Electrical,Water,Exterior,RoofZone}Type` terpisah —
   * palette rail (Ruang/Utilitas/Eksterior) selalu men-set `tool` (jadi
   * `activeTool`) dan `variant` BERSAMAAN dalam satu pick, jadi satu
   * field cukup: `variant` hanya relevan selama `tool` cocok dengan
   * `activeTool` yang sedang aktif. `variant` untyped (string) di level
   * store — pembaca (plan-canvas, editor-inspector) yang men-cast sesuai
   * `tool`-nya (RoomType/ElectricalPointType/WaterPointType/
   * ExteriorElementKind/RoofZone["type"]).
   */
  pendingPlacement: { tool: EditorTool; variant?: string } | null;
  setPendingPlacement: (p: { tool: EditorTool; variant?: string } | null) => void;
  addRoom: (type: RoomType, x: number, y: number) => void;
  /** Tambah ruang PAS mengisi `rect` (mis. celah hasil klik-kanan / Ctrl+klik
   *  "Tambah ruang di sini"). Dimensi di-clamp minRoomSizeFor(type) & batas
   *  site; posisi dijaga tetap di dalam site. Undo-aware, langsung terpilih. */
  addRoomInRect: (
    type: RoomType,
    rect: { x: number; y: number; width: number; depth: number },
  ) => void;
  /** Duplikat ruang (geser +0,5 m). Undo-aware, salinan langsung terpilih. */
  duplicateRoom: (id: string) => void;
  addFloor: () => void;
  /** Tambah lantai MEZZANINE tepat setelah lantai reguler `parentId` (E7):
   *  satu ruang default 40% footprint induk + tangga di induk (bila belum
   *  ada) — SATU entri undo. Kembali id lantai baru; null bila guard gagal
   *  (parent bukan reguler / sudah ber-mezzanine / layout absen). */
  addMezzanine: (parentId: string) => string | null;
  /** Ubah tinggi lantai (floor-to-floor, m) / nama / elevasi dasar mezzanine.
   *  heightM di-clamp 2.4–4.5 (mezzanine: min 2.0 — tinggi ruangnya sendiri);
   *  baseOffsetM hanya utk mezzanine, clamp [1.0, f2f induk − 0.5]; rooftop
   *  ditolak (heightM-nya = tebal dak). Undo-able. */
  updateFloor: (
    id: string,
    patch: {
      heightM?: number;
      name?: string;
      baseOffsetM?: number;
      /** CANTILEVER (CB3): geser horizontal massa lantai (m, koordinat site).
       *  Di-clamp tiap sumbu ±CANTILEVER_MAX_M; DITOLAK utk rooftop. */
      offsetM?: { dx: number; dy: number };
    },
  ) => void;
  removeFloor: (floorId: string) => void;
  /** Samakan footprint lantai `floorId` ke bbox indoor lantai `refFloorId`.
   *  Undo-able (satu entri history). Kembali null bila no-op. */
  alignFloorToReference: (floorId: string, refFloorId: string) => AlignSummary | null;
  /** Tambah/hapus lantai ROOFTOP (dak beton bisa diakses, id "floor-rooftop").
   *  Hapus ikut membuang ruang & bukaan rooftop + rooftopArea. Undo-aware. */
  setRooftop: (enabled: boolean) => void;

  // discrete mutations (each records one history entry)
  updateRoom: (id: string, patch: Partial<Room>) => void;
  toggleLock: (id: string) => void;
  deleteSelected: () => void;
  /**
   * Hapus entity via dispatch TYPED per kind — memperbaiki bug lama di mana
   * titik listrik/air/sanitasi jatuh ke else-branch "anggap opening" (no-op
   * yang tetap mendorong entri undo). Kind yang tak punya jalur hapus
   * (roof/wall/railing/furniture/light) = no-op tanpa entri undo.
   */
  deleteRef: (ref: EntityRef) => void;
  /** Legacy: hapus via id polos — delegasi ke deleteRef() via refFromLegacyId. */
  deleteObject: (id: string) => void;
  /** Return false = tak ada celah kosong yang muat di dinding itu (tak
   *  ditambahkan) — caller wajib menampilkan pesan, bukan diam-diam gagal. */
  addOpening: (
    roomId: string,
    side: Side,
    positionM: number,
    type: "door" | "window",
  ) => boolean;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  setRoof: (patch: Partial<RoofSpec>) => void;
  /** Tambah zona atap eksplisit. Saat ada roofZones, renderer/drawing memakai zona ini
   *  dan roof legacy tetap menjadi fallback/default parameter. Undo-aware. */
  addRoofZone: (zone: RoofZone) => void;
  /** Update zona atap eksplisit. Undo-aware. */
  updateRoofZone: (id: string, patch: Partial<RoofZone>) => void;
  /** Hapus zona atap eksplisit. Undo-aware. */
  removeRoofZone: (id: string) => void;
  /** Split satu roof zone menjadi dua zona berdampingan. Axis "x" = kiri/kanan, "y" = depan/belakang. Undo-aware. */
  splitRoofZone: (id: string, axis: "x" | "y") => void;
  /** Materialisasi `layout.roof` legacy menjadi satu roof zone eksplisit. Undo-aware. */
  convertLegacyRoofToZone: () => void;
  /** Gaya railing keliling DAK rooftop (bukan Room — disimpan di layout).
   *  Memilih gaya juga melepas model GLB kustom. Undo-aware. */
  setRooftopRailingStyle: (style: RailingStyle) => void;
  /** Pasang/lepas model GLB kustom untuk railing DAK rooftop (url null = lepas,
   *  kembali ke gaya bawaan). Undo-aware. */
  setRooftopRailingModel: (url: string | null, assetId?: string | null) => void;
  /** Cladding per dinding (`${roomId}:${side}`); face "outer" = fasad luar,
   *  "inner" = aksen muka dalam. null = kembali polos. Undo-aware. */
  setWallCladding: (
    wallId: string,
    claddingId: string | null,
    face?: "outer" | "inner",
  ) => void;
  /** Tambah louver band selebar dinding host (default sill 0,3 m, tinggi 2,2 m). Undo-aware. */
  addFacadeElement: (wallId: string, kind?: FacadeElementKind) => void;
  /** Preset 1-klik "Panel sirip (fluted)": louver_band sirip vertikal rapat
   *  (pitch 7cm) menutupi SELURUH bidang dinding host (lebar & tinggi penuh,
   *  sill 0). Undo-aware. */
  addFlutedFacadePanel: (wallId: string) => void;
  /** Preset 1-klik "Nat beton / reveal line": louver_band garis horizontal
   *  tipis TENGGELAM (pattern.inset=true) menutupi SELURUH bidang dinding
   *  host (lebar & tinggi penuh, sill 0) — signature fasad kubis modern.
   *  Undo-aware. */
  addRevealLineFacadePanel: (wallId: string) => void;
  updateFacadeElement: (id: string, patch: Partial<FacadeElement>) => void;
  removeFacadeElement: (id: string) => void;
  /** Gaya Fasad 1-klik: ganti komposisi cladding + kisi aksen seluruh muka. Undo-aware. */
  applyFacadePreset: (presetId: string) => void;
  /** Terapkan komposisi facade + frontage native sebagai satu history entry. */
  applyExteriorTemplate: (templateId: string) => void;
  /** Tambah elemen eksterior (pagar, gate, driveway, portal, dll). Undo-aware. */
  addExteriorElement: (element: ExteriorElement) => void;
  /** Update elemen eksterior berdasarkan id. Undo-aware. */
  updateExteriorElement: (id: string, patch: Partial<ExteriorElement>) => void;
  /** Hapus elemen eksterior berdasarkan id. Undo-aware. */
  removeExteriorElement: (id: string) => void;
  /** Duplikat elemen eksterior berdasarkan id. Undo-aware. */
  duplicateExteriorElement: (id: string) => void;
  /** Kunci/buka kunci elemen eksterior. Undo-aware. */
  setExteriorElementLocked: (id: string, locked: boolean) => void;
  /** Sembunyikan/tampilkan elemen eksterior. Undo-aware. */
  setExteriorElementHidden: (id: string, hidden: boolean) => void;
  /**
   * Lampu eksterior (editable). layout.exteriorLamps absent = penempatan
   * otomatis; edit pertama MEMATERIALISASI daftar otomatis itu lalu
   * memodifikasinya (copy-on-write). Semua undo-aware.
   */
  addWallLamp: (wallId: string) => void;
  updateLamp: (id: string, patch: Partial<ExteriorLamp>) => void;
  removeLamp: (id: string) => void;
  /** Set (clamped to the building footprint) or clear the rooftop deck rect.
   *  `undefined` clears it → deck covers the whole footprint (legacy). Undo-aware. */
  setRooftopArea: (
    area: { x: number; y: number; width: number; depth: number } | undefined,
  ) => void;
  /** Create a furnishable open terrace (rooftop_lounge) matching the current
   *  rooftop deck — the partial deck rect if set, else the full footprint. So
   *  the deck can hold interior furniture (railing is already automatic). No-op
   *  when there is no rooftop floor or a rooftop_lounge already exists. Undo-aware. */
  addRooftopTerrace: () => void;
  /** Add a swimming pool (kolam) with smart placement: the largest yard strip
   *  (site − footprint) on the ground floor; else a plunge pool on the rooftop
   *  deck; else a default rect at the footprint origin. Returns the new room id
   *  (for selecting/editing) or null if no layout/site. Undo-aware. */
  addPool: () => string | null;
  /** Add a staircase (tangga) room at the ground floor's footprint corner — the
   *  slab of the floor above is auto-punched over it (build-model). Returns the
   *  new room id, or null if there's no floor above (nothing to access). Undo-aware. */
  addStair: () => string | null;
  /** Add a staircase (tangga) room at specific coordinates on the ground floor.
   *  Returns the new room id, or null if single-floor. Undo-aware. */
  addStairAt: (x: number, y: number) => string | null;
  /** Tangga akses DAK: room tangga di lantai teratas biasa (tepat di bawah
   *  floor-rooftop) — slab dak otomatis berlubang di atasnya (build-model). */
  addRooftopAccessStair: () => string | null;
  /** Pasang/lepas tangga monyet (ship ladder servis) akses dak; null = lepas.
   *  `posM` = posisi sepanjang sisi (m dari ujung); absent = pertahankan/tengah. */
  setRooftopAccessLadder: (
    side: "n" | "s" | "w" | "e" | null,
    posM?: number,
  ) => void;
  /** Live-drag posisi tangga monyet sepanjang sisinya (satu undo per gesture). */
  dragRooftopLadderTo: (posM: number) => void;
  /** Tambah skylight 1.2×1.2 di tengah bidang atap DATAR pertama; null bila
   *  tak ada bidang datar (atap miring tanpa zona datar). */
  /** Tulis-ulang ATOMIK seluruh cladding satu dinding: base (polos, null =
   *  hapus) + daftar band vertikal — satu entri undo. */
  setWallCladdingBands: (
    roomId: string,
    side: "n" | "s" | "w" | "e",
    base: string | null,
    bands: Array<{ sillM: number; headM: number; claddingId: string }>,
  ) => void;
  /** Generator aksen fasad 1-klik: timpa deret ber-tag Accent:{room}:{side}
   *  dgn deret baru (idempoten); opts null = hapus deret saja. */
  generateWallAccent: (
    roomId: string,
    side: "n" | "s" | "w" | "e",
    opts: import("@/lib/exterior/facade-accents").WallAccentOpts | null,
  ) => void;
  /** Courtyard di atap MIRING: konversi atap global → CINCIN roofZones
   *  mengelilingi lubang openToSky ruang ini (guillotine rooftopStrips);
   *  sisi zona yang menghadap lubang diberi overhang 0. Sekaligus men-set
   *  room.openToSky. No-op bila sudah ada roofZones eksplisit. */
  convertRoofToCourtyardZones: (roomId: string) => void;
  /** Live-atur rect lubang courtyard (satu undo per gesture) — clamp ⊆ rect
   *  ruang + margin 0.5 m; hanya berlaku bila room.openToSky. */
  dragCourtyardRectTo: (
    roomId: string,
    rect: { x: number; y: number; width: number; depth: number },
  ) => void;
  addSkylight: () => string | null;
  updateSkylight: (
    id: string,
    patch: Partial<{ x: number; y: number; widthM: number; depthM: number; kind: "fixed" | "operable" }>,
  ) => void;
  removeSkylight: (id: string) => void;
  /** Live-drag skylight (satu undo per gesture) + auto-fit tepi host/ruang. */
  dragSkylightTo: (id: string, x: number, y: number, tol?: number) => void;
  /** Set the soil bearing capacity σ (kPa). Records one undo entry. */
  setSoilBearing: (kPa: number) => void;

  // electrical points (each records one history entry)
  addElectricalPoint: (
    roomId: string,
    type: ElectricalPointType,
    x: number,
    y: number,
  ) => void;
  moveElectricalPoint: (id: string, x: number, y: number) => void;
  updateElectricalPoint: (
    id: string,
    patch: Partial<Pick<ElectricalPoint, "type" | "roomId" | "note">>,
  ) => void;
  removeElectricalPoint: (id: string) => void;
  setElectrical: (points: ElectricalPoint[]) => void;

  // water points (each records one history entry)
  addWaterPoint: (
    roomId: string,
    type: WaterPointType,
    x: number,
    y: number,
  ) => void;
  moveWaterPoint: (id: string, x: number, y: number) => void;
  updateWaterPoint: (
    id: string,
    patch: Partial<Pick<WaterPoint, "type" | "roomId" | "note">>,
  ) => void;
  removeWaterPoint: (id: string) => void;
  setWater: (points: WaterPoint[]) => void;

  // sanitation objects (land-level)
  setSanitation: (
    patch: Partial<NonNullable<DesignLayout["sanitation"]>>,
  ) => void;
  removeSanitationObject: (
    kind: "septicTank" | "soakwell" | "controlBox",
    ref?: number | null,
  ) => void;

  // drag lifecycle (one history entry per gesture)
  beginDrag: () => void;
  dragRoomTo: (id: string, x: number, y: number, tol?: number) => void;
  dragResize: (
    id: string,
    handle: HandleId,
    mx: number,
    my: number,
    tol?: number,
  ) => void;
  /** Live-move an electrical point during a drag gesture (one undo per gesture). */
  dragElectricalTo: (id: string, x: number, y: number) => void;
  /** Live-move a water point during a drag gesture (one undo per gesture). */
  dragWaterTo: (id: string, x: number, y: number) => void;
  /** Live-move a sanitation object during a drag gesture (one undo per gesture).
   *  For septicTank/soakwell `ref` is ignored; for controlBox `ref` is the index. */
  moveSanitationObject: (
    kind: "septicTank" | "soakwell" | "controlBox",
    ref: number | null,
    x: number,
    y: number,
  ) => void;
  /** Live-move/resize the rooftop deck rect during a drag gesture (one undo per
   *  gesture). Mirrors `dragRoomTo`; re-clamps to the building footprint. */
  dragRooftopAreaTo: (area: {
    x: number;
    y: number;
    width: number;
    depth: number;
  }) => void;
  /** Live-resize an opening along its host wall (one undo per gesture). */
  dragOpeningResize: (id: string, positionM: number, widthM: number) => void;
  /** Live-move an exterior element during a drag gesture (one undo per gesture). */
  dragExteriorTo: (id: string, patch: ExteriorDragPatch) => void;
  /** Live-resize an exterior element during a drag gesture (one undo per gesture). */
  dragExteriorResize: (
    id: string,
    handle: string,
    mx: number,
    my: number,
  ) => void;
  /** Live-move a roof zone during a drag gesture (one undo per gesture).
   *  `tol` (meter) mengaktifkan auto-fit ke tepi ruang/footprint/zona lain. */
  dragRoofZoneTo: (id: string, x: number, y: number, tol?: number) => void;
  /** Live-resize a roof zone during a drag gesture (one undo per gesture). */
  dragRoofZoneResize: (
    id: string,
    handle: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w",
    mx: number,
    my: number,
    tol?: number,
  ) => void;
  endDrag: () => void;

  undo: () => void;
  redo: () => void;
  markSaved: (savedEditSequence?: number, nextRevision?: number | null) => void;
};

const MIN_ROOM = 1.2;
const MIN_ROOF_ZONE = 0.5;
/**
 * `void` (bukaan lantai/atrium) punya pengecualian: tidak ada batas minimal
 * panjang/lebar yang berarti — cukup floor kecil agar geometri tidak degenerate
 * (0 m akan merusak area/undo/3D). Ruang lain tetap MIN_ROOM.
 */
const MIN_VOID = 0.1;
const minRoomSizeFor = (type: RoomType | undefined) =>
  type === "void" ? MIN_VOID : MIN_ROOM;

/** Default roof parameters, used whenever `layout.roof` is absent (datar). */
export const DEFAULT_ROOF: RoofSpec = {
  type: "datar",
  slopeDeg: 30,
  overhangM: 0.5,
  material: "genteng_beton",
};

/** Default soil bearing capacity σ (kPa), used whenever `layout.structural` is absent. */
export const SOIL_DEFAULT_KPA = 150;

/**
 * Deep clone khusus data plain-JSON (DesignLayout selalu JSON murni — bolak-
 * balik lewat API). ~7× lebih cepat dari structuredClone, dan ini hot path:
 * live() meng-clone seluruh layout SETIAP pointermove selama drag.
 */
function clone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    out[k] = clone((v as Record<string, unknown>)[k]);
  }
  return out as T;
}


/**
 * Layer denah ATAP di 2D editor — pseudo-floor (bukan lantai sungguhan):
 * zona atap hanya dirender & diedit di layer ini; ruang tampil sebagai ghost
 * referensi. Konsumen yang mem-filter `floorId === selectedFloorId` otomatis
 * kosong di layer ini (by design).
 */
export const ROOF_LAYER_ID = "layer-atap";

/** Clamp posisi tangga monyet ke rentang sisinya (setengah lebar tangga dari
 *  tiap ujung; lebar tangga 0.5 m — selaras build-model). */
function clampLadderPos(
  l: DesignLayout,
  side: "n" | "s" | "w" | "e",
  posM: number,
): number {
  const fp = buildingFootprint(l);
  const len = side === "n" || side === "s" ? fp.widthM : fp.depthM;
  if (!(len > 0)) return round2(Math.max(0.25, posM));
  return round2(Math.min(Math.max(posM, 0.25), Math.max(0.25, len - 0.25)));
}

/**
 * Rect referensi auto-fit zona atap: tepi ruang lantai referensi (lantai
 * pemilik zona; site-level → lantai teratas biasa, karena atap duduk di
 * atasnya), zona atap lain, dan footprint bangunan. Dipakai dragRoofZoneTo/
 * Resize supaya tepi atap gampang segaris dgn dinding di bawahnya.
 */
function roofZoneSnapRects(l: DesignLayout, zoneId: string): Rect[] {
  const zone = l.roofZones?.find((z) => z.id === zoneId);
  const topFloorId = [...l.floors]
    .filter((f) => f.id !== "floor-rooftop")
    .sort((a, b) => b.level - a.level)[0]?.id;
  const refFloorId = zone?.floorId ?? topFloorId;
  const rects: Rect[] = l.rooms
    .filter((r) => r.floorId === refFloorId)
    .map((r) => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }));
  for (const z of l.roofZones ?? []) {
    if (z.id === zoneId) continue;
    rects.push({
      x: z.x - z.widthM / 2,
      y: z.y - z.depthM / 2,
      width: z.widthM,
      depth: z.depthM,
    });
  }
  const fp = buildingFootprint(l);
  if (fp.widthM > 0 && fp.depthM > 0) {
    rects.push({ x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM });
  }
  return rects;
}

export const useEditorStore = create<EditorState>((set, get) => {
  function revalidate(layout: DesignLayout): DesignLayout {
    const { site, structural } = get();
    if (site) layout.validation = validateLayout(layout, site, structural);
    return layout;
  }

  /** Apply a mutation that creates one undo entry. */
  function commit(mutator: (l: DesignLayout) => void) {
    const { layout, readOnly } = get();
    // Viewer publik read-only: gateway satu-satunya mutasi bertahap — no-op
    // di sini menutup SEMUA jalur commit() sekaligus (quick editor 3D, kartu
    // tambah cepat, inspector terpadu, dst.) tanpa harus menjaga tiap action.
    if (readOnly) return;
    if (!layout) return;
    const snapshot = clone(layout);
    const next = clone(layout);
    mutator(next);
    revalidate(next);
    set((s) => {
      // Epilogue validateSelection: ref yang tak lagi resolve setelah mutasi
      // (entity terhapus / diganti) di-null-kan DI SINI — satu tempat, bukan
      // clear ad-hoc per-aksi. Membunuh seluruh kelas dangling-ref. Mirror
      // legacy hanya ikut di-null bila memang sedang me-mirror ref itu
      // (bisa diverge saat di-set mentah oleh kode/test lama).
      const stale = s.selected !== null && !refResolves(s.selected, next);
      const clearMirror = stale && legacyIdOf(s.selected) === s.selectedObjectId;
      return {
        layout: next,
        past: [...s.past, snapshot].slice(-100),
        future: [],
        dirty: true,
        editSequence: s.editSequence + 1,
        ...(stale ? { selected: null } : {}),
        ...(clearMirror ? { selectedObjectId: null } : {}),
      };
    });
  }

  /** Live mutation during a drag — one history entry pushed on first move.
   *  Validation is deferred to endDrag to keep drags smooth. */
  function live(mutator: (l: DesignLayout) => void) {
    const { layout, readOnly, _dragBase, _dragPushed } = get();
    // Sama seperti commit() — jalur cepat drag ini juga harus tertutup total
    // di viewer read-only (dipakai mis. saat menggeser furniture/ruang).
    if (readOnly) return;
    if (!layout) return;
    const next = clone(layout);
    mutator(next);
    // Skip revalidation during drag — expensive and not needed until gesture ends
    if (!_dragPushed && _dragBase) {
      set((s) => ({
        layout: next,
        past: [...s.past, _dragBase].slice(-100),
        future: [],
        dirty: true,
        editSequence: s.editSequence + 1,
        _dragPushed: true,
      }));
    } else {
      set((s) => ({
        layout: next,
        dirty: true,
        editSequence: s.editSequence + 1,
      }));
    }
  }

  return {
    layout: null,
    site: null,
    structural: [],
    activeTool: "select",
    selectedFloorId: null,
    selected: null,
    selectionNonce: 0,
    selectedObjectId: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    snapEnabled: true,
    gridSize: 0.5,
    pendingPlacement: null,
    showDimensions: false,
    dimensionUnit: "mm",
    showHiddenExteriorElements: false,
    showRoofZones: true,
    showHiddenRoofZones: false,
    showCrossFloorRooms: true,
    past: [],
    future: [],
    dirty: false,
    layoutRevision: null,
    editSequence: 0,
    readOnly: false,
    _dragBase: null,
    _dragPushed: false,
    alignmentGuides: { x: [], y: [], equalX: [], equalY: [] },

    loadLayout: (layout, site, structural, revision = null, opts) => {
      const l = clone(layout);
      l.validation = validateLayout(l, site, structural);
      set({
        layout: l,
        site,
        structural,
        selectedFloorId: l.floors[0]?.id ?? null,
        selected: null,
        selectedObjectId: null,
        past: [],
        future: [],
        dirty: false,
        layoutRevision: revision,
        editSequence: 0,
        readOnly: opts?.readOnly ?? false,
        zoom: 1,
        pan: { x: 0, y: 0 },
        activeTool: "select",
        pendingPlacement: null,
      });
    },

    // Palette rail (Fase 3) selalu men-set pendingPlacement BERSAMAAN dgn
    // setTool dalam satu pick (mis. pilih "Kamar Tidur" di palette Ruang →
    // setPendingPlacement({tool:"room",variant:"kamar_tidur"}) lalu
    // setTool("room")) — jadi begitu tool berpindah ke tool LAIN, sisa
    // pendingPlacement lama otomatis tak relevan lagi; dibuang di sini
    // supaya chip "batal pilihan" tak nyangkut nunjuk kategori yang bukan
    // tool aktif. Re-entry ke tool yang SAMA (mis. keydown 'v' → "select"
    // dipanggil berulang) tak membuang variant yang barusan dipilih.
    setTool: (tool) =>
      set((s) => ({
        activeTool: tool,
        selected: null,
        selectedObjectId: null,
        pendingPlacement:
          s.pendingPlacement?.tool === tool ? s.pendingPlacement : null,
      })),
    // select() = plain set DI LUAR commit() — tak menyentuh dirty/editSequence,
    // jadi seleksi tak pernah memicu autosave/konflik revisi (dipin unit test).
    select: (ref) => {
      if (!ref) {
        set({ selected: null, selectedObjectId: null });
        return;
      }
      const { layout } = get();
      // Zona atap hidup di layer Atap (satu-satunya tempat ia dirender) —
      // seleksi kind lain sinkron ke lantai pemiliknya seperti biasa.
      const floorId =
        ref.kind === "roofZone" || ref.kind === "skylight"
          ? ROOF_LAYER_ID
          : layout
            ? floorIdOf(ref, layout)
            : null;
      set((s) => ({
        selected: ref,
        selectionNonce: s.selectionNonce + 1,
        selectedObjectId: legacyIdOf(ref),
        ...(floorId ? { selectedFloorId: floorId } : {}),
      }));
    },
    clearSelection: () => set({ selected: null, selectedObjectId: null }),
    selectObject: (id) => {
      if (id === null) {
        set({ selected: null, selectedObjectId: null });
        return;
      }
      const { layout } = get();
      const ref = layout ? refFromLegacyId(layout, id) : null;
      if (ref) get().select(ref);
      // Id tak dikenal (edge legacy): simpan mentah agar perilaku lama
      // (inspector fallback ke Summary) tak berubah; selected tetap null.
      else set({ selected: null, selectedObjectId: id });
    },
    setSelectedFloor: (id) =>
      set({ selectedFloorId: id, selected: null, selectedObjectId: null }),

    setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.25, z)) }),
    zoomBy: (factor) =>
      set((s) => ({ zoom: Math.min(4, Math.max(0.25, s.zoom * factor)) })),
    setPan: (pan) => set({ pan }),
    panBy: (dx, dy) =>
      set((s) => ({ pan: { x: s.pan.x + dx, y: s.pan.y + dy } })),
    resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
    toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
    toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
    setDimensionUnit: (unit) => set({ dimensionUnit: unit }),
    setShowHiddenExteriorElements: (show) =>
      set({ showHiddenExteriorElements: show }),
    setShowRoofZones: (show) => set({ showRoofZones: show }),
    setShowHiddenRoofZones: (show) => set({ showHiddenRoofZones: show }),
    setShowCrossFloorRooms: (show) => set({ showCrossFloorRooms: show }),

    setPendingPlacement: (p) => set({ pendingPlacement: p }),

    addRoom: (type, x, y) => {
      const { selectedFloorId, site, snapEnabled, gridSize } = get();
      // Layer Atap bukan lantai — ruang tidak boleh lahir dgn floorId sentinel.
      if (!selectedFloorId || selectedFloorId === ROOF_LAYER_ID || !site) return;
      let newId = "";
      commit((l) => {
        const room = makeRoom(
          type,
          x,
          y,
          selectedFloorId,
          site,
          snapEnabled ? (v) => snap(v, gridSize) : undefined,
        );
        newId = room.id;
        l.rooms.push(room);
      });
      set({ pendingPlacement: null });
      if (newId) get().selectObject(newId);
    },

    addRoomInRect: (type, rect) => {
      const { selectedFloorId, site } = get();
      if (!selectedFloorId || selectedFloorId === ROOF_LAYER_ID || !site) return;
      const min = minRoomSizeFor(type);
      let newId = "";
      commit((l) => {
        const w = round2(clamp(rect.width, min, site.widthM));
        const d = round2(clamp(rect.depth, min, site.depthM));
        const x = round2(clamp(rect.x, 0, Math.max(0, site.widthM - w)));
        const y = round2(clamp(rect.y, 0, Math.max(0, site.depthM - d)));
        const room: Room = {
          id: `room-${nanoid(8)}`,
          floorId: selectedFloorId,
          name: ROOM_TYPES[type].label,
          type,
          x,
          y,
          width: w,
          depth: d,
          areaM2: roomArea(w, d),
        };
        newId = room.id;
        l.rooms.push(room);
      });
      set({ pendingPlacement: null });
      if (newId) get().selectObject(newId);
    },

    duplicateRoom: (id) => {
      let newId = "";
      commit((l) => {
        const r = l.rooms.find((rm) => rm.id === id);
        if (!r) return;
        const copy = clone(r);
        copy.id = `room-${nanoid(8)}`;
        copy.x = round2(r.x + 0.5);
        copy.y = round2(r.y + 0.5);
        newId = copy.id;
        l.rooms.push(copy);
      });
      if (newId) get().selectObject(newId);
    },

    updateFloor: (id, patch) =>
      commit((l) => {
        const floor = l.floors.find((f) => f.id === id);
        if (!floor || isRooftopFloor(floor)) return;
        const mezz = isMezzanineFloor(floor);
        if (patch.heightM !== undefined && Number.isFinite(patch.heightM)) {
          // Mezzanine boleh lebih rendah (min 2.0): heightM-nya = tinggi
          // ruang mezz sendiri, bukan floor-to-floor penuh.
          const minH = mezz ? 2.0 : 2.4;
          floor.heightM = round2(Math.min(4.5, Math.max(minH, patch.heightM)));
        }
        if (patch.name !== undefined && patch.name.trim()) {
          floor.name = patch.name.trim();
        }
        // baseOffsetM: elevasi dasar mezzanine dari dasar lantai induk —
        // clamp [1.0, f2f induk − 0.5]; DITOLAK utk lantai non-mezzanine.
        if (
          patch.baseOffsetM !== undefined &&
          Number.isFinite(patch.baseOffsetM) &&
          mezz
        ) {
          const parent = mezzanineParentOf(l.floors, id);
          const parentF2F = parent
            ? (floorElevations(l.floors).get(parent.id)?.floorToFloorM ??
              DEFAULT_FLOOR_TO_FLOOR_M)
            : DEFAULT_FLOOR_TO_FLOOR_M;
          const maxOff = Math.max(1.0, round2(parentF2F - 0.5));
          floor.baseOffsetM = round2(
            Math.min(maxOff, Math.max(1.0, patch.baseOffsetM)),
          );
        }
        // offsetM (CB3): geser horizontal massa lantai (cantilever) — clamp
        // tiap sumbu ±CANTILEVER_MAX_M. Rooftop sudah ditolak di guard atas,
        // jadi berlaku utk lantai reguler & mezzanine.
        if (patch.offsetM) {
          const clampAxis = (v: number) =>
            Number.isFinite(v)
              ? round2(
                  Math.max(-CANTILEVER_MAX_M, Math.min(CANTILEVER_MAX_M, v)),
                )
              : 0;
          floor.offsetM = {
            dx: clampAxis(patch.offsetM.dx),
            dy: clampAxis(patch.offsetM.dy),
          };
        }
      }),

    addMezzanine: (parentId) => {
      const { layout } = get();
      if (!layout) return null;
      const idx = layout.floors.findIndex((f) => f.id === parentId);
      const parent = idx >= 0 ? layout.floors[idx] : undefined;
      // Guard: induk harus lantai REGULER (bukan rooftop/mezzanine) dan
      // belum punya mezzanine langsung di atasnya (elemen array berikutnya).
      if (!parent || !isRegularFloor(parent)) return null;
      const after = layout.floors[idx + 1];
      if (after && isMezzanineFloor(after)) return null;

      const parentF2F =
        floorElevations(layout.floors).get(parentId)?.floorToFloorM ??
        DEFAULT_FLOOR_TO_FLOOR_M;
      const id = `floor-mezz-${nanoid(8)}`;
      // SATU commit → satu entri undo: lantai + ruang mezz + tangga induk.
      commit((l) => {
        const at = l.floors.findIndex((f) => f.id === parentId);
        if (at < 0) return;
        l.floors.splice(at + 1, 0, {
          id,
          level: parent.level + 0.5,
          name: "Mezzanine",
          heightM: 2.2,
          kind: "mezzanine",
          baseOffsetM: round2(parentF2F / 2),
        });
        // Footprint referensi: bbox ruang indoor lantai induk; fallback
        // footprint bangunan; fallback terakhir ukuran default area_kumpul.
        const bbox = indoorFootprintBBox(
          l.rooms.filter((r) => r.floorId === parentId),
        );
        const fpAll = buildingFootprint(l);
        const fp =
          bbox ??
          (fpAll.widthM > 0 && fpAll.depthM > 0
            ? { x: fpAll.x0, y: fpAll.y0, width: fpAll.widthM, depth: fpAll.depthM }
            : null);
        // Ruang mezz default: 40% LUAS footprint induk di pojok footprint —
        // lebar penuh, kedalaman 40% (rak balkon memanjang, lazim mezzanine).
        const size = defaultRoomSize("area_kumpul"); // acuan dimensi minimum
        const rect = fp
          ? {
              x: round2(fp.x),
              y: round2(fp.y),
              width: round2(fp.width),
              depth: round2(Math.max(MIN_ROOM, fp.depth * 0.4)),
            }
          : { x: 0, y: 0, width: size.width, depth: size.depth };
        l.rooms.push({
          id: `room-${nanoid(8)}`,
          floorId: id,
          name: "Mezzanine",
          // Platform TERBUKA bertipe balkon → mesin railing existing otomatis
          // memagari tepinya pada elevasi mezzanine (konvensi E6); ganti tipe
          // dari kartu ruang bila ingin kamar berdinding.
          type: "balkon",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          depth: rect.depth,
          areaM2: roomArea(rect.width, rect.depth),
        });
        // Akses: bila induk belum punya tangga, tambahkan di pojok footprint
        // (pola addStairAt/addRooftopAccessStair).
        const hasStair = l.rooms.some(
          (r) => r.floorId === parentId && r.type === "tangga",
        );
        if (!hasStair) {
          const st = defaultRoomSize("tangga");
          const sx = round2(fp ? fp.x : 0);
          const sy = round2(fp ? fp.y : 0);
          l.rooms.push({
            id: `room-${nanoid(8)}`,
            floorId: parentId,
            name: ROOM_TYPES.tangga.label,
            type: "tangga",
            x: sx,
            y: sy,
            width: st.width,
            depth: st.depth,
            areaM2: roomArea(st.width, st.depth),
          });
        }
      });
      set({ selectedFloorId: id, selected: null, selectedObjectId: null });
      return id;
    },

    addFloor: () => {
      const { layout } = get();
      if (!layout) return;
      const floor = makeFloor(layout.floors);
      commit((l) => {
        const rooftopIdx = l.floors.findIndex((f) => f.id === "floor-rooftop");
        if (rooftopIdx >= 0) l.floors.splice(rooftopIdx, 0, floor);
        else l.floors.push(floor);
      });
      set({ selectedFloorId: floor.id, selected: null, selectedObjectId: null });
    },

    setRooftop: (enabled) => {
      const { layout } = get();
      if (!layout) return;
      const has = layout.floors.some((f) => f.id === "floor-rooftop");
      if (enabled === has) return;
      commit((l) => {
        if (enabled) {
          l.floors.push({
            id: "floor-rooftop",
            level: l.floors.length + 1,
            name: "Rooftop",
            heightM: 0.3, // slab tipis — rooftop = dak terbuka (paritas generator)
          });
        } else {
          l.floors = l.floors.filter((f) => f.id !== "floor-rooftop");
          l.rooms = l.rooms.filter((r) => r.floorId !== "floor-rooftop");
          l.openings = l.openings.filter((o) => o.floorId !== "floor-rooftop");
          if (l.roofZones) {
            l.roofZones = l.roofZones.filter((z) => z.floorId !== "floor-rooftop");
            if (l.roofZones.length === 0) delete l.roofZones;
          }
          delete l.rooftopArea;
        }
      });
      set((st) => ({
        selectedFloorId:
          !enabled && st.selectedFloorId === "floor-rooftop"
            ? (get().layout?.floors[0]?.id ?? null)
            : st.selectedFloorId,
        selected: null,
        selectedObjectId: null,
      }));
    },

    removeFloor: (floorId) => {
      const { layout } = get();
      if (!layout || layout.floors.length <= 1) return;
      commit((l) => {
        l.floors = l.floors.filter((f) => f.id !== floorId);
        l.rooms = l.rooms.filter((r) => r.floorId !== floorId);
        l.openings = l.openings.filter((o) => o.floorId !== floorId);
        if (l.exteriorElements) {
          const next = l.exteriorElements.filter(
            (el) => el.floorId !== floorId,
          );
          if (next.length === 0) delete l.exteriorElements;
          else l.exteriorElements = next as ExteriorElement[];
        }
        if (l.roofZones) {
          l.roofZones = l.roofZones.filter((z) => z.floorId !== floorId);
          if (l.roofZones.length === 0) delete l.roofZones;
        }
      });
      set((s) => ({
        selectedFloorId:
          s.selectedFloorId === floorId
            ? (get().layout?.floors[0]?.id ?? null)
            : s.selectedFloorId,
        selected: null,
        selectedObjectId: null,
      }));
    },

    alignFloorToReference: (floorId, refFloorId) => {
      const { layout } = get();
      if (!layout || floorId === refFloorId) return null;
      const floorRooms = layout.rooms.filter(
        (r) => r.floorId === floorId && !isOutdoorRoom(r),
      );
      const refRooms = layout.rooms.filter(
        (r) => r.floorId === refFloorId && !isOutdoorRoom(r),
      );
      if (floorRooms.length === 0 || refRooms.length === 0) return null;
      const target = indoorFootprintBBox(refRooms);
      if (!target) return null;
      const res = alignFloorRoomsToFootprint(floorRooms, target);
      const noop =
        res.summary.grown.length === 0 &&
        res.summary.shrunk.length === 0 &&
        res.summary.removed.length === 0;
      if (noop) return null;
      commit((l) => {
        l.rooms = l.rooms.filter(
          (r) => !(r.floorId === floorId && !isOutdoorRoom(r)),
        );
        l.rooms = [...l.rooms, ...res.rooms];
      });
      return res.summary;
    },

    updateRoom: (id, patch) =>
      commit((l) => {
        const room = l.rooms.find((r) => r.id === id);
        if (!room) return;
        Object.assign(room, patch);
        // Clamp keras split-level ±0.9 m (E1) — hanya utk EDIT baru; data
        // lama di luar rentang dibiarkan saat load (tidak menulis tanpa perlu).
        if (patch.levelOffsetM !== undefined && room.levelOffsetM !== undefined) {
          room.levelOffsetM = Math.max(
            -LEVEL_OFFSET_MAX_M,
            Math.min(LEVEL_OFFSET_MAX_M, room.levelOffsetM),
          );
        }
        if (patch.width !== undefined || patch.depth !== undefined) {
          room.areaM2 = roomArea(room.width, room.depth);
          // BUG D: resize via inspector (patch width/depth langsung) — bukaan
          // yatim di dinding yang mengecil di-clamp/dibuang, lihat
          // clampOrDropOpeningsForRoom (lib/geometry). Jalur drag-resize
          // interaktif (dragResize) memakai fungsi yang sama, tapi
          // diterapkan SEKALI di endDrag() (bukan tiap frame) — lihat di sana.
          l.openings = clampOrDropOpeningsForRoom(l.openings, room);
        }
        // Moving a room to another floor takes its openings along.
        if (patch.floorId !== undefined) {
          for (const op of l.openings) {
            if (op.wallId.startsWith(`${id}:`)) op.floorId = patch.floorId;
          }
        }
      }),

    toggleLock: (id) =>
      commit((l) => {
        const room = l.rooms.find((r) => r.id === id);
        if (room) room.locked = !room.locked;
      }),

    deleteSelected: () => {
      const { selected, selectedObjectId, layout } = get();
      const ref =
        selected ??
        (layout && selectedObjectId
          ? refFromLegacyId(layout, selectedObjectId)
          : null);
      if (ref) get().deleteRef(ref);
    },

    deleteRef: (ref) => {
      switch (ref.kind) {
        case "exterior":
          get().removeExteriorElement(ref.id);
          return;
        case "roofZone":
          get().removeRoofZone(ref.id);
          return;
        case "skylight":
          get().removeSkylight(ref.id);
          return;
        case "electrical":
          get().removeElectricalPoint(ref.id);
          return;
        case "water":
          get().removeWaterPoint(ref.id);
          return;
        case "lamp":
          get().removeLamp(ref.id);
          return;
        case "sanitation": {
          const san = get().layout?.sanitation;
          if (!san) return;
          if (san.septicTank?.id === ref.id) get().removeSanitationObject("septicTank");
          else if (san.soakwell?.id === ref.id) get().removeSanitationObject("soakwell");
          else {
            const idx = (san.controlBoxes ?? []).findIndex((b) => b?.id === ref.id);
            if (idx >= 0) get().removeSanitationObject("controlBox", idx);
          }
          return;
        }
        case "room": {
          const id = ref.id;
          commit((l) => {
            l.rooms = l.rooms.filter((r) => r.id !== id);
            l.openings = l.openings.filter((o) => !o.wallId.startsWith(`${id}:`));
            // Elemen & cladding fasad menempel di dinding ruang ini → ikut hilang.
            if (l.facadeElements) {
              const next = l.facadeElements.filter(
                (fe) => !fe.wallId.startsWith(`${id}:`),
              );
              if (next.length === 0) delete l.facadeElements;
              else l.facadeElements = next;
            }
            for (const key of ["facade", "facadeInner"] as const) {
              const cur = l[key];
              if (!cur) continue;
              const map = Object.fromEntries(
                Object.entries(cur).filter(
                  ([wallId]) => !wallId.startsWith(`${id}:`),
                ),
              );
              if (Object.keys(map).length === 0) delete l[key];
              else l[key] = map;
            }
          });
          return;
        }
        case "opening":
          commit((l) => {
            l.openings = l.openings.filter((o) => o.id !== ref.id);
          });
          return;
        // roof/wall/railing/furniture/light: tak punya jalur hapus di sini —
        // no-op TANPA entri undo (dulu else-branch salah mendorong entri).
        default:
          return;
      }
    },

    deleteObject: (id) => {
      const { layout } = get();
      if (!layout) return;
      const ref = refFromLegacyId(layout, id);
      if (ref) get().deleteRef(ref);
    },

    addOpening: (roomId, side, positionM, type) => {
      // Celah kosong dicari DI LUAR commit() — bila dinding penuh, batal
      // total (tak ada entri undo/dirty percuma) & caller diberi tahu lewat
      // return false, bukan diam-diam menumpuk di atas bukaan existing
      // (regresi: klik "Tambah jendela" ke-2 di dinding yg sudah terisi
      // tampak tak melakukan apa-apa — overlap memotong span dinding yg
      // sama persis dgn bukaan pertama).
      const { layout } = get();
      if (!layout) return false;
      const room = layout.rooms.find((r) => r.id === roomId);
      if (!room) return false;
      const kind: OpeningKind =
        type === "door" ? "hinged_door" : "sliding_window";
      const defaults = openingDefaultsForKind(kind);
      const wallId = openingWallId(roomId, side);
      const existing = layout.openings
        .filter((o) => o.wallId === wallId)
        .map((o) => ({ positionM: o.positionM, widthM: o.widthM }));
      const gapPositionM = findOpeningGapPositionM(
        edgeLength(room, side),
        defaults.widthM,
        existing,
        positionM,
      );
      if (gapPositionM === null) return false;
      commit((l) => {
        l.openings.push({
          id: `op-${Math.abs(hashStr(roomId + side + gapPositionM + l.openings.length))}`,
          floorId: room.floorId,
          wallId,
          ...defaults,
          positionM: gapPositionM,
        });
      });
      return true;
    },

    updateOpening: (id, patch) =>
      commit((l) => {
        const op = l.openings.find((o) => o.id === id);
        if (!op) return;
        Object.assign(op, patch);
        // Bingkai menonjol: clamp 0–0.8 m; 0/negatif = flush (hapus field).
        if (op.frameDepthM !== undefined) {
          if (!Number.isFinite(op.frameDepthM) || op.frameDepthM <= 0) {
            delete op.frameDepthM;
          } else {
            op.frameDepthM = round2(Math.min(0.8, op.frameDepthM));
          }
        }
        // Siluet lengkung: jaga dimensi cukup untuk radius arch/kapsul muat
        // (build-model menurunkan radius dari widthM/heightM — tanpa clamp
        // ini opening pendek+lebar bisa menghasilkan radius > tinggi tersisa).
        if (op.archShape === "arch") {
          const minH = round2(op.widthM / 2 + 0.2);
          if (!Number.isFinite(op.heightM) || op.heightM < minH) op.heightM = minH;
        } else if (op.archShape === "capsule") {
          if (!Number.isFinite(op.widthM) || op.widthM < 0.3) op.widthM = 0.3;
          if (!Number.isFinite(op.heightM) || op.heightM < 0.3) op.heightM = 0.3;
        }
        // Trapesium (tepi atas miring): batasi ±3 m & jaga sisi RENDAH tak
        // < 0.3 m (heightM − |topSlopeM| ≥ 0.3) — kombinasi miring besar +
        // heightM kecil bisa membuat sisi rendah negatif/mustahil.
        if (op.topSlopeM !== undefined) {
          if (!Number.isFinite(op.topSlopeM) || op.topSlopeM === 0) {
            delete op.topSlopeM;
          } else {
            const maxDrop = Math.max(0, round2(op.heightM - 0.3));
            const bounded = clamp(op.topSlopeM, -3, 3);
            const sign = bounded < 0 ? -1 : 1;
            const limited = sign * Math.min(Math.abs(bounded), maxDrop);
            if (Math.abs(limited) < 0.02) delete op.topSlopeM;
            else op.topSlopeM = round2(limited);
          }
        }
      }),

    setRoof: (patch) =>
      commit((l) => {
        l.roof = { ...DEFAULT_ROOF, ...l.roof, ...patch };
        // Sopi-sopi hanya utk pelana; hapus objek kosong.
        if (l.roof.type !== "pelana") {
          delete l.roof.gableEnds;
        } else if (
          l.roof.gableEnds &&
          Object.values(l.roof.gableEnds).every((v) => !v)
        ) {
          delete l.roof.gableEnds;
        }
        // Gable asimetris hanya utk pelana; clamp longgar ±6 m (geometri
        // meng-clamp lagi terhadap span nyata saat render).
        if (l.roof.type !== "pelana" || !l.roof.ridgeOffsetM) {
          delete l.roof.ridgeOffsetM;
        } else {
          l.roof.ridgeOffsetM = round2(
            Math.max(-6, Math.min(6, l.roof.ridgeOffsetM)),
          );
          if (l.roof.ridgeOffsetM === 0) delete l.roof.ridgeOffsetM;
        }
      }),

    addRoofZone: (zone) => {
      commit((l) => {
        l.roofZones = [...(l.roofZones ?? []), { ...zone }];
      });
      set({ pendingPlacement: null });
      get().selectObject(zone.id);
    },

    updateRoofZone: (id, patch) =>
      commit((l) => {
        const zone = l.roofZones?.find((z) => z.id === id);
        if (!zone) return;
        Object.assign(zone, patch);
        zone.x = round2(zone.x);
        zone.y = round2(zone.y);
        zone.widthM = round2(Math.max(MIN_ROOF_ZONE, zone.widthM));
        zone.depthM = round2(Math.max(MIN_ROOF_ZONE, zone.depthM));
        zone.slopeDeg = round2(Math.max(0, Math.min(60, zone.slopeDeg)));
        zone.overhangM = round2(Math.max(0, Math.min(2, zone.overhangM)));
        if (zone.type !== "miring") delete zone.lowSide;
        if (zone.type === "datar") zone.slopeDeg = 0;
        // Sopi-sopi hanya utk pelana; buang sisi tak valid (ujung ridge saja)
        // dan hapus objek kosong.
        if (zone.type !== "pelana") {
          delete zone.gableEnds;
        } else if (zone.gableEnds) {
          const ridgeAlongX = zone.widthM >= zone.depthM;
          const valid: Array<"n" | "s" | "w" | "e"> = ridgeAlongX
            ? ["w", "e"]
            : ["n", "s"];
          const cleaned: NonNullable<typeof zone.gableEnds> = {};
          for (const side of valid) {
            const v = zone.gableEnds[side];
            if (v) cleaned[side] = v;
          }
          if (Object.keys(cleaned).length === 0) delete zone.gableEnds;
          else zone.gableEnds = cleaned;
        }
        // Gable asimetris hanya utk pelana; clamp agar bubungan tetap di
        // dalam bentang (span/2 − 0.3) dan buang nilai 0/di tipe lain.
        if (zone.type !== "pelana" || !zone.ridgeOffsetM) {
          delete zone.ridgeOffsetM;
        } else {
          const roMax = Math.max(0, Math.min(zone.widthM, zone.depthM) / 2 - 0.3);
          zone.ridgeOffsetM = round2(
            Math.max(-roMax, Math.min(roMax, zone.ridgeOffsetM)),
          );
          if (zone.ridgeOffsetM === 0) delete zone.ridgeOffsetM;
        }
      }),

    removeRoofZone: (id) =>
      commit((l) => {
        if (!l.roofZones) return;
        l.roofZones = l.roofZones.filter((z) => z.id !== id);
        if (l.roofZones.length === 0) delete l.roofZones;
      }),

    splitRoofZone: (id, axis) => {
      const { layout } = get();
      const zone = layout?.roofZones?.find((z) => z.id === id);
      if (!zone) return;
      if (axis === "x" && zone.widthM < MIN_ROOF_ZONE * 2) return;
      if (axis === "y" && zone.depthM < MIN_ROOF_ZONE * 2) return;

      const firstId = `roofz-${nanoid(8)}`;
      const secondId = `roofz-${nanoid(8)}`;
      commit((l) => {
        const index = l.roofZones?.findIndex((z) => z.id === id) ?? -1;
        if (!l.roofZones || index < 0) return;
        const base = l.roofZones[index];
        const halfW = round2(base.widthM / 2);
        const halfD = round2(base.depthM / 2);
        const first: RoofZone = {
          ...base,
          id: firstId,
          x: axis === "x" ? round2(base.x - base.widthM / 4) : base.x,
          y: axis === "y" ? round2(base.y - base.depthM / 4) : base.y,
          widthM: axis === "x" ? halfW : base.widthM,
          depthM: axis === "y" ? halfD : base.depthM,
        };
        const second: RoofZone = {
          ...base,
          id: secondId,
          x: axis === "x" ? round2(base.x + base.widthM / 4) : base.x,
          y: axis === "y" ? round2(base.y + base.depthM / 4) : base.y,
          widthM: axis === "x" ? round2(base.widthM - halfW) : base.widthM,
          depthM: axis === "y" ? round2(base.depthM - halfD) : base.depthM,
        };
        l.roofZones.splice(index, 1, first, second);
      });
      get().selectObject(firstId);
    },

    convertLegacyRoofToZone: () => {
      const { layout } = get();
      if (!layout || hasExplicitRoofZones(layout)) return;
      let newId = "";
      commit((l) => {
        const legacy = effectiveRoofZones(l)[0];
        if (!legacy) return;
        newId = `roofz-${nanoid(8)}`;
        l.roofZones = [
          {
            id: newId,
            // Zona legacy mewarisi floors[0] (netral utk 2D/RAB) — tapi zona
            // EKSPLISIT dirender 3D di puncak lantai pemiliknya, jadi pakai
            // lantai reguler TERATAS agar atap tidak turun ke atas lantai 1.
            floorId: topRegularFloorId(l.floors) ?? legacy.floorId,
            type: legacy.type,
            x: legacy.x,
            y: legacy.y,
            widthM: legacy.widthM,
            depthM: legacy.depthM,
            slopeDeg: legacy.slopeDeg,
            overhangM: legacy.overhangM,
            materialId: legacy.materialId,
            lowSide: legacy.lowSide,
            // Bawa fitur gable global ke zona — konversi tidak boleh diam-diam
            // membuang gable asimetris / sopi-sopi yang sudah di-set user.
            ...(l.roof?.type === "pelana" && l.roof.ridgeOffsetM
              ? { ridgeOffsetM: l.roof.ridgeOffsetM }
              : {}),
            ...(l.roof?.type === "pelana" && l.roof.gableEnds
              ? { gableEnds: { ...l.roof.gableEnds } }
              : {}),
          },
        ];
      });
      if (newId) get().selectObject(newId);
    },

    setRooftopRailingStyle: (style) =>
      commit((l) => {
        // Memilih gaya bawaan sekaligus MELEPAS model GLB kustom (paritas balkon).
        l.rooftopRailingStyle = style;
        delete l.rooftopRailingModelUrl;
        delete l.rooftopRailingModelAssetId;
      }),

    setRooftopRailingModel: (url, assetId) =>
      commit((l) => {
        if (url) {
          l.rooftopRailingModelUrl = url;
          l.rooftopRailingModelAssetId = assetId ?? null;
        } else {
          delete l.rooftopRailingModelUrl;
          delete l.rooftopRailingModelAssetId;
        }
      }),

    setWallCladding: (wallId, claddingId, face = "outer") =>
      commit((l) => {
        const key = face === "inner" ? "facadeInner" : "facade";
        const map = { ...(l[key] ?? {}) };
        if (claddingId) map[wallId] = claddingId;
        else delete map[wallId];
        if (Object.keys(map).length === 0) delete l[key];
        else l[key] = map;
      }),

    applyFacadePreset: (presetId) =>
      commit((l) => {
        // Gaya Fasad 1-klik: GANTI komposisi muka luar + kisi aksen (bukan
        // menambah) — fasad advance seketika, lalu user tinggal tweak per dinding.
        // `site` lokal store hanya lebar/dalam; runtime menerima project.site
        // penuh (punya frontOrientation) — baca via cast, default "s".
        const front = orientationToFrontSide(
          (get().site as { frontOrientation?: string } | null)
            ?.frontOrientation,
        );
        const { facade, facadeElements } = buildFacadePreset(
          l,
          presetId,
          front,
          l.facade,
        );
        if (Object.keys(facade).length > 0) l.facade = facade;
        else delete l.facade;
        if (facadeElements.length > 0) l.facadeElements = facadeElements;
        else delete l.facadeElements;
      }),

    applyExteriorTemplate: (templateId) =>
      commit((l) => {
        const site = get().site;
        if (!site) return;
        const result = buildFacadeComposerTemplate(l, site, templateId);
        const manualElements = (l.exteriorElements ?? []).filter(
          (element) => !element.label?.startsWith("Template:"),
        );
        l.exteriorElements = [...manualElements, ...result.exteriorElements];
        if (Object.keys(result.facade).length > 0) l.facade = result.facade;
        else delete l.facade;
        if (result.facadeElements.length > 0)
          l.facadeElements = result.facadeElements;
        else delete l.facadeElements;
      }),

    addFacadeElement: (wallId, kind = "louver_band") =>
      commit((l) => {
        const host = resolveFacadeWallHost(l, wallId);
        if (!host) return;
        const len = host.lenM;
        const widthM = Math.max(0.6, Math.round((len - 0.2) * 100) / 100);
        l.facadeElements = [
          ...(l.facadeElements ?? []),
          {
            id: `fe-${Math.abs(hashStr(wallId + kind + (l.facadeElements?.length ?? 0)))}`,
            wallId,
            floorId: host.floorId,
            kind,
            positionM: Math.round((len / 2) * 100) / 100,
            widthM,
            sillHeightM: 0.3,
            heightM: 2.2,
            finish: "kayu",
          },
        ];
      }),

    addFlutedFacadePanel: (wallId) =>
      commit((l) => {
        const host = resolveFacadeWallHost(l, wallId);
        if (!host) return;
        const len = host.lenM;
        // Tinggi dinding PENUH lantai host (tabel elevasi Fase D, konsisten
        // dgn build-model.ts) dikurangi split-level offset — mirror rumus
        // `feWallH` di generator elemen fasad build-model.ts. Dinding tepi
        // sintetis tak punya split-level (levelOffsetM = 0).
        const wallHM =
          floorElevations(l.floors).get(host.floorId)?.wallHM ?? WALL_H;
        const heightM = Math.max(
          0.4,
          Math.round((wallHM - host.levelOffsetM) * 100) / 100,
        );
        l.facadeElements = [
          ...(l.facadeElements ?? []),
          {
            id: `fe-${Math.abs(hashStr(wallId + "fluted" + (l.facadeElements?.length ?? 0)))}`,
            wallId,
            floorId: host.floorId,
            kind: "louver_band",
            positionM: Math.round((len / 2) * 100) / 100,
            widthM: Math.round(len * 100) / 100,
            sillHeightM: 0,
            heightM,
            finish: "kayu",
            pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
          },
        ];
      }),

    addRevealLineFacadePanel: (wallId) =>
      commit((l) => {
        const host = resolveFacadeWallHost(l, wallId);
        if (!host) return;
        const len = host.lenM;
        // Tinggi dinding PENUH lantai host — mirror addFlutedFacadePanel.
        const wallHM =
          floorElevations(l.floors).get(host.floorId)?.wallHM ?? WALL_H;
        const heightM = Math.max(
          0.4,
          Math.round((wallHM - host.levelOffsetM) * 100) / 100,
        );
        l.facadeElements = [
          ...(l.facadeElements ?? []),
          {
            id: `fe-${Math.abs(hashStr(wallId + "reveal" + (l.facadeElements?.length ?? 0)))}`,
            wallId,
            floorId: host.floorId,
            kind: "louver_band",
            positionM: Math.round((len / 2) * 100) / 100,
            widthM: Math.round(len * 100) / 100,
            sillHeightM: 0,
            heightM,
            finish: "aluminium_gelap",
            // Nat beton gelap, bukan warna aluminium bawaan.
            colorHex: "#2b2a27",
            pattern: {
              orientation: "grid",
              pitchM: 0.9,
              barWidthM: 0.02,
              barDepthM: 0.012,
              inset: true,
            },
          },
        ];
      }),

    updateFacadeElement: (id, patch) =>
      commit((l) => {
        l.facadeElements = (l.facadeElements ?? []).map((fe) =>
          fe.id === id ? { ...fe, ...patch, id: fe.id } : fe,
        );
      }),

    removeFacadeElement: (id) =>
      commit((l) => {
        const next = (l.facadeElements ?? []).filter((fe) => fe.id !== id);
        if (next.length === 0) delete l.facadeElements;
        else l.facadeElements = next;
      }),

    addExteriorElement: (element) =>
      commit((l) => {
        l.exteriorElements = [
          ...(l.exteriorElements ?? []),
          element,
        ] as ExteriorElement[];
      }),

    updateExteriorElement: (id, patch) =>
      commit((l) => {
        l.exteriorElements = (l.exteriorElements ?? []).map((el) => {
          if (el.id !== id) return el;
          // Segmen (pagar/tembok/gerbang) tak punya rotationDeg mandiri —
          // start/end TETAP satu-satunya sumber kebenaran geometri. Patch
          // rotationDeg (dari inspector "Rotasi (°)" ATAU agent) dibaca lalu
          // dikonversi jadi `end` baru di sekeliling `start` sepanjang
          // panjang SAAT INI, supaya 2D (yang menggambar garis start→end)
          // dan 3D (rotationY dari atan2(end-start), lihat
          // exterior-primitives.ts) otomatis konsisten satu sama lain tanpa
          // jalur rotasi terpisah. Patch yang SUDAH menyertakan `end`
          // eksplisit menang (tak ditimpa) — hormati intent pemanggil.
          let nextPatch: Partial<ExteriorElement> = patch;
          const rawPatch = patch as {
            rotationDeg?: number;
            end?: { x: number; y: number };
          };
          if (
            rawPatch.rotationDeg != null &&
            rawPatch.end === undefined &&
            "start" in el &&
            "end" in el
          ) {
            const seg = el as ExteriorElement & {
              start: { x: number; y: number };
              end: { x: number; y: number };
            };
            const length = segmentLength(seg.start, seg.end);
            if (length > 0) {
              const rad = (rawPatch.rotationDeg * Math.PI) / 180;
              nextPatch = {
                ...patch,
                end: {
                  x: round2(seg.start.x + length * Math.cos(rad)),
                  y: round2(seg.start.y + length * Math.sin(rad)),
                },
              };
            }
          }
          return { ...el, ...nextPatch, id: el.id } as ExteriorElement;
        });
      }),

    removeExteriorElement: (id) =>
      commit((l) => {
        const next = (l.exteriorElements ?? []).filter((el) => el.id !== id);
        if (next.length === 0) delete l.exteriorElements;
        else l.exteriorElements = next as ExteriorElement[];
      }),

    duplicateExteriorElement: (id) =>
      commit((l) => {
        const el = l.exteriorElements?.find((e) => e.id === id);
        if (!el) return;
        const copy = clone(el);
        copy.id = `ext-${nanoid(8)}`;
        copy.label = el.label ? `${el.label} (copy)` : `${copy.kind} (copy)`;
        if ("x" in copy && typeof copy.x === "number") copy.x += 0.5;
        if ("y" in copy && typeof copy.y === "number") copy.y += 0.5;
        if ("start" in copy && copy.start) {
          copy.start.x += 0.5;
          copy.start.y += 0.5;
        }
        if ("end" in copy && copy.end) {
          copy.end.x += 0.5;
          copy.end.y += 0.5;
        }
        l.exteriorElements = [
          ...(l.exteriorElements ?? []),
          copy as ExteriorElement,
        ];
      }),

    setExteriorElementLocked: (id, locked) =>
      commit((l) => {
        l.exteriorElements = (l.exteriorElements ?? []).map((el) =>
          el.id === id ? { ...el, locked } : el,
        );
      }),

    setExteriorElementHidden: (id, hidden) =>
      commit((l) => {
        l.exteriorElements = (l.exteriorElements ?? []).map((el) =>
          el.id === id ? { ...el, hidden } : el,
        );
      }),

    setRoofZoneHidden: (id, hidden) =>
      commit((l) => {
        if (!l.roofZones) return;
        l.roofZones = l.roofZones.map((z) =>
          z.id === id ? { ...z, hidden } : z,
        );
      }),

    addWallLamp: (wallId) =>
      commit((l) => {
        const parsed = parseOpeningWall(wallId);
        const host = parsed
          ? l.rooms.find((r) => r.id === parsed.roomId)
          : null;
        if (!parsed || !host) return;
        const horizontal = parsed.side === "n" || parsed.side === "s";
        const line =
          parsed.side === "n"
            ? host.y
            : parsed.side === "s"
              ? host.y + host.depth
              : parsed.side === "w"
                ? host.x
                : host.x + host.width;
        const mid = horizontal
          ? host.x + host.width / 2
          : host.y + host.depth / 2;
        const lamps = l.exteriorLamps ?? lampPlacements(l);
        l.exteriorLamps = [
          ...lamps,
          {
            id: `lamp-w-${Math.abs(hashStr(wallId + lamps.length))}`,
            kind: "wall",
            x: horizontal ? mid : line,
            y: horizontal ? line : mid,
            mountH: 2.0,
            side: parsed.side,
            floorId: host.floorId,
          },
        ];
      }),

    updateLamp: (id, patch) =>
      commit((l) => {
        const lamps = l.exteriorLamps ?? lampPlacements(l);
        l.exteriorLamps = lamps.map((lamp) =>
          lamp.id === id ? { ...lamp, ...patch, id: lamp.id } : lamp,
        );
      }),

    removeLamp: (id) =>
      commit((l) => {
        const lamps = l.exteriorLamps ?? lampPlacements(l);
        // Daftar dimaterialisasi meski hasilnya kosong — [] berarti "user
        // menghapus semuanya", beda dari absent (= otomatis).
        l.exteriorLamps = lamps.filter((lamp) => lamp.id !== id);
      }),

    setRooftopArea: (area) =>
      commit((l) => {
        if (!area) {
          delete l.rooftopArea;
          return;
        }
        l.rooftopArea = clampRooftopArea(area, buildingFootprint(l));
      }),

    addRooftopTerrace: () =>
      commit((l) => {
        if (!l.floors.some((f) => f.id === "floor-rooftop")) return;
        if (
          l.rooms.some(
            (r) => r.floorId === "floor-rooftop" && r.type === "rooftop_lounge",
          )
        )
          return;
        const fp = buildingFootprint(l);
        if (fp.widthM <= 0 || fp.depthM <= 0) return;
        // Teras mengikuti dak: rect deck parsial bila ada, selain itu footprint penuh.
        const rect = l.rooftopArea
          ? clampRooftopArea(l.rooftopArea, fp)
          : { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM };
        l.rooms.push({
          id: `room-${nanoid(8)}`,
          floorId: "floor-rooftop",
          name: ROOM_TYPES.rooftop_lounge.label,
          type: "rooftop_lounge",
          x: round2(rect.x),
          y: round2(rect.y),
          width: round2(rect.width),
          depth: round2(rect.depth),
          areaM2: roomArea(rect.width, rect.depth),
        });
      }),

    addPool: () => {
      const { site, layout } = get();
      if (!site || !layout) return null;
      const fp = buildingFootprint(layout);
      let floorId = "floor-1";
      // 1) Halaman (yard) di lantai dasar bila ada.
      let rect = defaultPoolRect(site, fp);
      // 2) Tak ada halaman → kolam plunge di dak rooftop.
      if (
        !rect &&
        layout.floors.some((f) => f.id === "floor-rooftop") &&
        fp.widthM > 0
      ) {
        const deck = layout.rooftopArea
          ? clampRooftopArea(layout.rooftopArea, fp)
          : { x: fp.x0, y: fp.y0, width: fp.widthM, depth: fp.depthM };
        const pr = plungeRectInDeck(deck);
        if (pr) {
          rect = pr;
          floorId = "floor-rooftop";
        }
      }
      // 3) Fallback: rect kecil di pojok footprint lantai dasar (user geser).
      if (!rect) {
        const w = Math.min(3, fp.widthM > 0 ? fp.widthM : site.widthM);
        const d = Math.min(4, fp.depthM > 0 ? fp.depthM : site.depthM);
        rect = {
          x: round2(fp.x0),
          y: round2(fp.y0),
          width: round2(w),
          depth: round2(d),
        };
      }
      const id = `room-${nanoid(8)}`;
      commit((l) => {
        l.rooms.push({
          id,
          floorId,
          name: ROOM_TYPES.kolam.label,
          type: "kolam",
          x: rect!.x,
          y: rect!.y,
          width: rect!.width,
          depth: rect!.depth,
          areaM2: roomArea(rect!.width, rect!.depth),
          poolKind: floorId === "floor-rooftop" ? "plunge" : "renang",
        });
      });
      return id;
    },

    addStair: () => {
      const { site, layout } = get();
      if (!site || !layout) return null;
      // Butuh minimal satu lantai DI ATAS lantai dasar agar tangga punya tujuan
      // (slab lantai atas otomatis dilubangi di atas tangga di build-model).
      if (layout.floors.length < 2) return null;
      const targetFloor = layout.floors[0]; // lantai dasar → akses ke lantai berikutnya
      const fp = buildingFootprint(layout);
      const size = defaultRoomSize("tangga");
      const w = round2(
        Math.min(size.width, fp.widthM > 0 ? fp.widthM : site.widthM),
      );
      const d = round2(
        Math.min(size.depth, fp.depthM > 0 ? fp.depthM : site.depthM),
      );
      // Pojok footprint (user geser & set arah di 2D editor).
      const x = round2(fp.widthM > 0 ? fp.x0 : 0);
      const y = round2(fp.depthM > 0 ? fp.y0 : 0);
      const id = `room-${nanoid(8)}`;
      commit((l) => {
        l.rooms.push({
          id,
          floorId: targetFloor.id,
          name: ROOM_TYPES.tangga.label,
          type: "tangga",
          x,
          y,
          width: w,
          depth: d,
          areaM2: roomArea(w, d),
        });
      });
      return id;
    },

    addStairAt: (x: number, y: number) => {
      const { site, layout } = get();
      if (!site || !layout || layout.floors.length < 2) return null;
      const targetFloor = layout.floors[0];
      const size = defaultRoomSize("tangga");
      const id = `room-${nanoid(8)}`;
      commit((l) => {
        l.rooms.push({
          id,
          floorId: targetFloor.id,
          name: ROOM_TYPES.tangga.label,
          type: "tangga",
          x,
          y,
          width: size.width,
          depth: size.depth,
          areaM2: roomArea(size.width, size.depth),
        });
      });
      return id;
    },

    addRooftopAccessStair: () => {
      const { site, layout } = get();
      if (!site || !layout) return null;
      if (!layout.floors.some((f) => f.id === "floor-rooftop")) return null;
      const targetId = topRegularFloorId(layout.floors);
      const targetFloor = layout.floors.find((f) => f.id === targetId);
      if (!targetFloor) return null;
      const fp = buildingFootprint(layout);
      const size = defaultRoomSize("tangga");
      const w = round2(Math.min(size.width, fp.widthM > 0 ? fp.widthM : site.widthM));
      const d = round2(Math.min(size.depth, fp.depthM > 0 ? fp.depthM : site.depthM));
      const x = round2(fp.widthM > 0 ? fp.x0 : 0);
      const y = round2(fp.depthM > 0 ? fp.y0 : 0);
      const id = `room-${nanoid(8)}`;
      commit((l) => {
        l.rooms.push({
          id,
          floorId: targetFloor.id,
          name: ROOM_TYPES.tangga.label,
          type: "tangga",
          x,
          y,
          width: w,
          depth: d,
          areaM2: roomArea(w, d),
        });
      });
      return id;
    },

    generateWallAccent: (roomId, side, opts) =>
      commit((l) => {
        const room = l.rooms.find((r) => r.id === roomId);
        const kept = (l.exteriorElements ?? []).filter(
          (el) => !isAccentOf(el.label, roomId, side),
        );
        const fresh = opts && room ? buildWallAccent(room, side, opts) : [];
        const next = [...kept, ...fresh];
        if (next.length === 0) delete l.exteriorElements;
        else l.exteriorElements = next;
      }),

    setWallCladdingBands: (roomId, side, base, bands) =>
      commit((l) => {
        const facade = { ...(l.facade ?? {}) };
        for (const key of facadeKeysForWall(facade, roomId, side)) delete facade[key];
        if (base) facade[formatFacadeKey(roomId, side)] = base;
        for (const b of bands) {
          if (!(b.headM > b.sillM)) continue;
          facade[formatFacadeKey(roomId, side, { sillM: b.sillM, headM: b.headM })] =
            b.claddingId;
        }
        if (Object.keys(facade).length === 0) delete l.facade;
        else l.facade = facade;
      }),

    convertRoofToCourtyardZones: (roomId) => {
      const { layout } = get();
      if (!layout || hasExplicitRoofZones(layout)) return;
      const room = layout.rooms.find((r) => r.id === roomId);
      if (!room) return;
      const fp = buildingFootprint(layout);
      if (!(fp.widthM > 0 && fp.depthM > 0)) return;
      const hole = clampCourtyardRect(room, courtyardRect(room));
      // Clip lubang ⊆ footprint (rooftopStrips mengasumsikan deck ⊆ fp).
      const hx0 = Math.max(hole.x, fp.x0);
      const hy0 = Math.max(hole.y, fp.y0);
      const hx1 = Math.min(hole.x + hole.width, fp.x0 + fp.widthM);
      const hy1 = Math.min(hole.y + hole.depth, fp.y0 + fp.depthM);
      if (hx1 - hx0 < 0.3 || hy1 - hy0 < 0.3) return;
      const holeRect = { x: hx0, y: hy0, width: hx1 - hx0, depth: hy1 - hy0 };
      const strips = rooftopStrips(fp, holeRect);
      if (strips.length === 0) return;
      const roof = effectiveRoof(layout);
      const holeCx = hx0 + (hx1 - hx0) / 2;
      const holeCy = hy0 + (hy1 - hy0) / 2;
      const opposite = { n: "s", s: "n", w: "e", e: "w" } as const;
      let firstId = "";
      commit((l) => {
        const target = l.rooms.find((r) => r.id === roomId);
        if (target) target.openToSky = true;
        l.roofZones = strips.map((st) => {
          const cx = st.x + st.width / 2;
          const cy = st.y + st.depth / 2;
          const dx = cx - holeCx;
          const dy = cy - holeCy;
          // Air jatuh MENJAUHI lubang: lowSide = arah dominan keluar;
          // sisi seberangnya = menghadap lubang → overhang 0.
          const lowSide =
            Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "s" : "n");
          const holeSide = opposite[lowSide];
          const id = `roofz-${nanoid(8)}`;
          if (!firstId) firstId = id;
          return {
            id,
            type: roof.type === "datar" ? ("datar" as const) : roof.type,
            x: round2(cx),
            y: round2(cy),
            widthM: round2(st.width),
            depthM: round2(st.depth),
            slopeDeg: roof.type === "datar" ? 0 : roof.slopeDeg,
            overhangM: roof.overhangM,
            overhangSides: { [holeSide]: 0 },
            materialId: roof.material,
            ...(roof.type === "miring" ? { lowSide } : {}),
          };
        });
      });
      if (firstId) get().select({ kind: "roofZone", id: firstId });
    },

    dragCourtyardRectTo: (roomId, rect) =>
      live((l) => {
        const room = l.rooms.find((r) => r.id === roomId);
        if (!room || !room.openToSky) return;
        room.openToSkyRect = clampCourtyardRect(room, rect);
      }),

    addSkylight: () => {
      const { layout } = get();
      if (!layout) return null;
      const host = flatRoofHosts(layout)[0];
      if (!host) return null;
      const id = `sky-${nanoid(8)}`;
      const rect = clampToHost(
        {
          x: host.rect.x + host.rect.width / 2 - 0.6,
          y: host.rect.y + host.rect.depth / 2 - 0.6,
          width: 1.2,
          depth: 1.2,
        },
        host,
      );
      commit((l) => {
        l.skylights = [
          ...(l.skylights ?? []),
          { id, x: rect.x, y: rect.y, widthM: rect.width, depthM: rect.depth, kind: "fixed" },
        ];
      });
      get().select({ kind: "skylight", id });
      return id;
    },

    updateSkylight: (id, patch) =>
      commit((l) => {
        const sk = l.skylights?.find((k) => k.id === id);
        if (!sk) return;
        Object.assign(sk, patch);
        const host = resolveFlatHost(l, skylightRect(sk)) ?? flatRoofHosts(l)[0];
        if (host) {
          const rect = clampToHost(skylightRect(sk), host);
          sk.x = rect.x;
          sk.y = rect.y;
          sk.widthM = rect.width;
          sk.depthM = rect.depth;
        }
      }),

    removeSkylight: (id) =>
      commit((l) => {
        if (!l.skylights) return;
        l.skylights = l.skylights.filter((k) => k.id !== id);
        if (l.skylights.length === 0) delete l.skylights;
      }),

    dragSkylightTo: (id, x, y, tol = 0) => {
      const { snapEnabled, gridSize, site } = get();
      const gx: number[] = [],
        gy: number[] = [];
      live((l) => {
        const sk = l.skylights?.find((k) => k.id === id);
        if (!sk || !site) return;
        // Kandidat auto-fit: tepi ruang lantai referensi + zona atap lain
        // (mesin yang sama dgn zona atap) + skylight lain — tepi skylight
        // lazim dibuat segaris dinding di bawahnya.
        const others = roofZoneSnapRects(l, `skylight:${id}`);
        for (const other of l.skylights ?? []) {
          if (other.id === id) continue;
          others.push({ x: other.x, y: other.y, width: other.widthM, depth: other.depthM });
        }
        const rx = snapMove(x, sk.widthM, moveCandidatesX(others, site), tol);
        const ry = snapMove(y, sk.depthM, moveCandidatesY(others, site), tol);
        const fx = rx.guide ? rx.value : snapEnabled ? snap(x, gridSize) : x;
        const fy = ry.guide ? ry.value : snapEnabled ? snap(y, gridSize) : y;
        if (rx.guide) gx.push(round2(rx.guide.value));
        if (ry.guide) gy.push(round2(ry.guide.value));
        sk.x = round2(fx);
        sk.y = round2(fy);
        const host = resolveFlatHost(l, skylightRect(sk)) ?? flatRoofHosts(l)[0];
        if (host) {
          const rect = clampToHost(skylightRect(sk), host);
          sk.x = rect.x;
          sk.y = rect.y;
        }
      });
      set({ alignmentGuides: { x: gx, y: gy, equalX: [], equalY: [] } });
    },

    setRooftopAccessLadder: (side, posM) =>
      commit((l) => {
        if (!side) {
          delete l.rooftopAccess;
          return;
        }
        const prev =
          l.rooftopAccess?.kind === "tangga_monyet" ? l.rooftopAccess : null;
        // Ganti sisi -> posisi lama tidak relevan (panjang sisi beda).
        const keepPos = prev && prev.side === side ? prev.posM : undefined;
        const nextPos = posM ?? keepPos;
        l.rooftopAccess = {
          kind: "tangga_monyet",
          side,
          ...(nextPos !== undefined
            ? { posM: clampLadderPos(l, side, nextPos) }
            : {}),
        };
      }),

    dragRooftopLadderTo: (posM) =>
      live((l) => {
        if (l.rooftopAccess?.kind !== "tangga_monyet") return;
        l.rooftopAccess = {
          ...l.rooftopAccess,
          posM: clampLadderPos(l, l.rooftopAccess.side, posM),
        };
      }),

    setSoilBearing: (kPa) =>
      commit((l) => {
        l.structural = { soilBearingKPa: kPa };
      }),

    addElectricalPoint: (roomId, type, x, y) =>
      commit((l) => {
        const point: ElectricalPoint = {
          id: `elec-${nanoid(8)}`,
          roomId,
          type,
          x,
          y,
        };
        l.electrical = [...(l.electrical ?? []), point];
      }),

    moveElectricalPoint: (id, x, y) =>
      commit((l) => {
        const point = l.electrical?.find((p) => p.id === id);
        if (point) {
          point.x = x;
          point.y = y;
        }
      }),

    updateElectricalPoint: (id, patch) =>
      commit((l) => {
        const point = l.electrical?.find((p) => p.id === id);
        if (point) Object.assign(point, patch);
      }),

    removeElectricalPoint: (id) =>
      commit((l) => {
        l.electrical = (l.electrical ?? []).filter((p) => p.id !== id);
      }),

    setElectrical: (points) =>
      commit((l) => {
        l.electrical = points;
      }),

    addWaterPoint: (roomId, type, x, y) =>
      commit((l) => {
        const point: WaterPoint = {
          id: `water-${nanoid(8)}`,
          roomId,
          type,
          x,
          y,
        };
        l.water = [...(l.water ?? []), point];
      }),

    moveWaterPoint: (id, x, y) =>
      commit((l) => {
        const point = l.water?.find((p) => p.id === id);
        if (point) {
          point.x = x;
          point.y = y;
        }
      }),

    updateWaterPoint: (id, patch) =>
      commit((l) => {
        const point = l.water?.find((p) => p.id === id);
        if (point) Object.assign(point, patch);
      }),

    removeWaterPoint: (id) =>
      commit((l) => {
        l.water = (l.water ?? []).filter((p) => p.id !== id);
      }),

    setWater: (points) =>
      commit((l) => {
        l.water = points;
      }),

    setSanitation: (patch) =>
      commit((l) => {
        l.sanitation = { ...l.sanitation, ...patch };
      }),

    removeSanitationObject: (kind, ref = null) => {
      commit((l) => {
        if (!l.sanitation) return;
        if (kind === "controlBox") {
          const idx = ref ?? -1;
          l.sanitation.controlBoxes = (l.sanitation.controlBoxes ?? []).filter(
            (_, i) => i !== idx,
          );
        } else {
          delete l.sanitation[kind];
        }
        if (
          !l.sanitation.septicTank &&
          !l.sanitation.soakwell &&
          (l.sanitation.controlBoxes?.length ?? 0) === 0
        ) {
          delete l.sanitation;
        }
      });
      // Seleksi menggantung dibersihkan epilogue validateSelection di commit().
    },

    beginDrag: () => {
      const { layout } = get();
      set({
        _dragBase: layout ? clone(layout) : null,
        _dragPushed: false,
        alignmentGuides: { x: [], y: [], equalX: [], equalY: [] },
      });
    },

    dragRoomTo: (id, x, y, tol = 0) => {
      const { snapEnabled, gridSize, site } = get();
      const gx: number[] = [],
        gy: number[] = [];
      live((l) => {
        const room = l.rooms.find((r) => r.id === id);
        if (!room || room.locked || !site) return;
        const others = l.rooms.filter(
          (r) => r.floorId === room.floorId && r.id !== id,
        );
        const rx = snapMove(x, room.width, moveCandidatesX(others, site), tol);
        const ry = snapMove(y, room.depth, moveCandidatesY(others, site), tol);
        const fx = rx.guide ? rx.value : snapEnabled ? snap(x, gridSize) : x;
        const fy = ry.guide ? ry.value : snapEnabled ? snap(y, gridSize) : y;
        if (rx.guide) gx.push(round2(rx.guide.value));
        if (ry.guide) gy.push(round2(ry.guide.value));
        room.x = round2(fx);
        room.y = round2(fy);
      });
      set({ alignmentGuides: { x: gx, y: gy, equalX: [], equalY: [] } });
    },

    dragResize: (id, handle, mx, my, tol = 0) => {
      const { snapEnabled, gridSize, site } = get();
      const gx: number[] = [],
        gy: number[] = [],
        eqx: number[] = [],
        eqy: number[] = [];
      live((l) => {
        const room = l.rooms.find((r) => r.id === id);
        if (!room || room.locked) return;
        const others = l.rooms.filter(
          (r) => r.floorId === room.floorId && r.id !== id,
        );
        const rect = {
          x: room.x,
          y: room.y,
          width: room.width,
          depth: room.depth,
        };
        let sx = mx,
          sy = my;
        if (site && (handle.includes("w") || handle.includes("e"))) {
          const edge = handle.includes("w") ? "left" : "right";
          const res = snapAxis(
            mx,
            resizeCandidatesX(rect, others, site, edge),
            tol,
          );
          sx = res.guide ? res.value : snapEnabled ? snap(mx, gridSize) : mx;
          if (res.guide)
            (res.guide.kind === "equal" ? eqx : gx).push(round2(res.value));
        } else {
          sx = snapEnabled ? snap(mx, gridSize) : mx;
        }
        if (site && (handle.includes("n") || handle.includes("s"))) {
          const edge = handle.includes("n") ? "top" : "bottom";
          const res = snapAxis(
            my,
            resizeCandidatesY(rect, others, site, edge),
            tol,
          );
          sy = res.guide ? res.value : snapEnabled ? snap(my, gridSize) : my;
          if (res.guide)
            (res.guide.kind === "equal" ? eqy : gy).push(round2(res.value));
        } else {
          sy = snapEnabled ? snap(my, gridSize) : my;
        }
        const r = applyResize(rect, handle, sx, sy, minRoomSizeFor(room.type));
        room.x = round2(r.x);
        room.y = round2(r.y);
        room.width = round2(r.width);
        room.depth = round2(r.depth);
        room.areaM2 = roomArea(room.width, room.depth);
      });
      set({ alignmentGuides: { x: gx, y: gy, equalX: eqx, equalY: eqy } });
    },

    dragElectricalTo: (id, x, y) =>
      live((l) => {
        const point = l.electrical?.find((p) => p.id === id);
        if (point) {
          point.x = round2(x);
          point.y = round2(y);
        }
      }),

    dragWaterTo: (id, x, y) =>
      live((l) => {
        const point = l.water?.find((p) => p.id === id);
        if (point) {
          point.x = round2(x);
          point.y = round2(y);
        }
      }),

    moveSanitationObject: (kind, ref, x, y) =>
      live((l) => {
        const san = l.sanitation;
        if (!san) return;
        const target =
          kind === "controlBox" ? san.controlBoxes?.[ref ?? -1] : san[kind];
        if (target) {
          target.x = round2(x);
          target.y = round2(y);
        }
      }),

    dragRooftopAreaTo: (area) =>
      live((l) => {
        l.rooftopArea = clampRooftopArea(area, buildingFootprint(l));
      }),

    dragOpeningResize: (id, positionM, widthM) =>
      live((l) => {
        const op = l.openings.find((o) => o.id === id);
        if (!op) return;
        op.positionM = round2(positionM);
        op.widthM = round2(widthM);
      }),

    dragExteriorTo: (id, patch: ExteriorDragPatch) =>
      live((l) => {
        const el = l.exteriorElements?.find((e) => e.id === id);
        if (!el || el.locked) return;
        if (
          "x" in el &&
          "y" in el &&
          patch.x !== undefined &&
          patch.y !== undefined
        ) {
          (el as ExteriorElement & { x: number; y: number }).x = round2(
            patch.x,
          );
          (el as ExteriorElement & { x: number; y: number }).y = round2(
            patch.y,
          );
        }
        if ("start" in el && patch.start) {
          (el as ExteriorElement & { start: { x: number; y: number } }).start =
            {
              x: round2(patch.start.x),
              y: round2(patch.start.y),
            };
        }
        if ("end" in el && patch.end) {
          (el as ExteriorElement & { end: { x: number; y: number } }).end = {
            x: round2(patch.end.x),
            y: round2(patch.end.y),
          };
        }
        if ("points" in el && patch.points) {
          (
            el as ExteriorElement & {
              points: Array<{ x: number; y: number }>;
            }
          ).points = patch.points.map((p) => ({
            x: round2(p.x),
            y: round2(p.y),
          }));
        }
      }),

    dragExteriorResize: (id, handle, mx, my) =>
      live((l) => {
        const el = l.exteriorElements?.find((e) => e.id === id);
        if (!el || el.locked) return;
        if ("start" in el && "end" in el) {
          const seg = el as ExteriorElement & {
            start: { x: number; y: number };
            end: { x: number; y: number };
          };
          if (handle === "start") seg.start = { x: round2(mx), y: round2(my) };
          else if (handle === "end") seg.end = { x: round2(mx), y: round2(my) };
        }
        if ("points" in el && handle.startsWith("v")) {
          const surface = el as ExteriorElement & {
            points: Array<{ x: number; y: number }>;
          };
          const index = Number(handle.slice(1));
          if (Number.isInteger(index) && surface.points[index]) {
            surface.points[index] = { x: round2(mx), y: round2(my) };
          }
        }
        if (el.kind === "exterior_stair") {
          const stair = el as ExteriorElement & {
            kind: "exterior_stair";
            x: number;
            y: number;
            widthM: number;
            lengthM: number;
            direction: "n" | "s" | "w" | "e";
          };
          let x0 = stair.direction === "w" ? stair.x - stair.lengthM : stair.x;
          let x1 = stair.direction === "e" ? stair.x + stair.lengthM : stair.direction === "w" ? stair.x : stair.x + stair.widthM;
          let y0 = stair.direction === "s" ? stair.y - stair.lengthM : stair.y;
          let y1 = stair.direction === "n" ? stair.y + stair.lengthM : stair.direction === "s" ? stair.y : stair.y + stair.widthM;
          if (handle.includes("w")) x0 = Math.min(mx, x1 - 0.2);
          if (handle.includes("e")) x1 = Math.max(mx, x0 + 0.2);
          if (handle.includes("n")) y0 = Math.min(my, y1 - 0.2);
          if (handle.includes("s")) y1 = Math.max(my, y0 + 0.2);
          if (stair.direction === "e") {
            stair.x = round2(x0);
            stair.y = round2(y0);
            stair.lengthM = round2(Math.max(0.2, x1 - x0));
            stair.widthM = round2(Math.max(0.2, y1 - y0));
          } else if (stair.direction === "w") {
            stair.x = round2(x1);
            stair.y = round2(y0);
            stair.lengthM = round2(Math.max(0.2, x1 - x0));
            stair.widthM = round2(Math.max(0.2, y1 - y0));
          } else if (stair.direction === "n") {
            stair.x = round2(x0);
            stair.y = round2(y0);
            stair.widthM = round2(Math.max(0.2, x1 - x0));
            stair.lengthM = round2(Math.max(0.2, y1 - y0));
          } else {
            stair.x = round2(x0);
            stair.y = round2(y1);
            stair.widthM = round2(Math.max(0.2, x1 - x0));
            stair.lengthM = round2(Math.max(0.2, y1 - y0));
          }
        }
        if ("x" in el && "y" in el && "widthM" in el && "depthM" in el) {
          const box = el as ExteriorElement & {
            x: number;
            y: number;
            widthM: number;
            depthM: number;
          };
          const x0 = box.x;
          const y0 = box.y;
          const x1 = box.x + box.widthM;
          const y1 = box.y + box.depthM;
          let nx0 = x0;
          let ny0 = y0;
          let nx1 = x1;
          let ny1 = y1;
          if (handle.includes("w")) nx0 = Math.min(mx, x1 - 0.2);
          if (handle.includes("e")) nx1 = Math.max(mx, x0 + 0.2);
          if (handle.includes("n")) ny0 = Math.min(my, y1 - 0.2);
          if (handle.includes("s")) ny1 = Math.max(my, y0 + 0.2);
          box.x = round2(nx0);
          box.y = round2(ny0);
          box.widthM = round2(Math.max(0.2, nx1 - nx0));
          box.depthM = round2(Math.max(0.2, ny1 - ny0));
        }
      }),

    dragRoofZoneTo: (id, x, y, tol = 0) => {
      // Auto-fit denah atap: tepi zona nge-snap ke tepi ruang lantai
      // referensinya + footprint bangunan + zona atap lain + tepi lahan —
      // mesin snap yang sama dgn ruang (arsitek: tepi atap segaris dinding).
      const { snapEnabled, gridSize, site } = get();
      const gx: number[] = [],
        gy: number[] = [];
      live((l) => {
        const zone = l.roofZones?.find((z) => z.id === id);
        if (!zone || !site) return;
        const others = roofZoneSnapRects(l, id);
        const px = x - zone.widthM / 2;
        const py = y - zone.depthM / 2;
        const rx = snapMove(px, zone.widthM, moveCandidatesX(others, site), tol);
        const ry = snapMove(py, zone.depthM, moveCandidatesY(others, site), tol);
        const fx = rx.guide ? rx.value : snapEnabled ? snap(px, gridSize) : px;
        const fy = ry.guide ? ry.value : snapEnabled ? snap(py, gridSize) : py;
        if (rx.guide) gx.push(round2(rx.guide.value));
        if (ry.guide) gy.push(round2(ry.guide.value));
        zone.x = round2(fx + zone.widthM / 2);
        zone.y = round2(fy + zone.depthM / 2);
      });
      set({ alignmentGuides: { x: gx, y: gy, equalX: [], equalY: [] } });
    },

    dragRoofZoneResize: (id, handle, mx, my, tol = 0) => {
      const { snapEnabled, gridSize, site } = get();
      const gx: number[] = [],
        gy: number[] = [],
        eqx: number[] = [],
        eqy: number[] = [];
      live((l) => {
        const zone = l.roofZones?.find((z) => z.id === id);
        if (!zone) return;
        const x0 = zone.x - zone.widthM / 2;
        const y0 = zone.y - zone.depthM / 2;
        const x1 = zone.x + zone.widthM / 2;
        const y1 = zone.y + zone.depthM / 2;
        const rect = { x: x0, y: y0, width: zone.widthM, depth: zone.depthM };
        const others = roofZoneSnapRects(l, id);
        let sx = mx,
          sy = my;
        if (site && (handle.includes("w") || handle.includes("e"))) {
          const edge = handle.includes("w") ? "left" : "right";
          const res = snapAxis(mx, resizeCandidatesX(rect, others, site, edge), tol);
          sx = res.guide ? res.value : snapEnabled ? snap(mx, gridSize) : mx;
          if (res.guide)
            (res.guide.kind === "equal" ? eqx : gx).push(round2(res.value));
        } else {
          sx = snapEnabled ? snap(mx, gridSize) : mx;
        }
        if (site && (handle.includes("n") || handle.includes("s"))) {
          const edge = handle.includes("n") ? "top" : "bottom";
          const res = snapAxis(my, resizeCandidatesY(rect, others, site, edge), tol);
          sy = res.guide ? res.value : snapEnabled ? snap(my, gridSize) : my;
          if (res.guide)
            (res.guide.kind === "equal" ? eqy : gy).push(round2(res.value));
        } else {
          sy = snapEnabled ? snap(my, gridSize) : my;
        }
        let nx0 = x0;
        let ny0 = y0;
        let nx1 = x1;
        let ny1 = y1;
        if (handle.includes("w")) nx0 = Math.min(sx, x1 - MIN_ROOF_ZONE);
        if (handle.includes("e")) nx1 = Math.max(sx, x0 + MIN_ROOF_ZONE);
        if (handle.includes("n")) ny0 = Math.min(sy, y1 - MIN_ROOF_ZONE);
        if (handle.includes("s")) ny1 = Math.max(sy, y0 + MIN_ROOF_ZONE);
        zone.x = round2((nx0 + nx1) / 2);
        zone.y = round2((ny0 + ny1) / 2);
        zone.widthM = round2(Math.max(MIN_ROOF_ZONE, nx1 - nx0));
        zone.depthM = round2(Math.max(MIN_ROOF_ZONE, ny1 - ny0));
      });
      set({ alignmentGuides: { x: gx, y: gy, equalX: eqx, equalY: eqy } });
    },

    endDrag: () => {
      const { layout, site, structural, _dragBase } = get();
      if (layout && site) {
        const validated = clone(layout);
        // BUG D: dragResize memutasi room.width/depth tiap frame lewat
        // live() TANPA membersihkan bukaan (biar drag tetap mulus) — sekali
        // di sini, di akhir gesture, ruang yang dimensinya benar2 berubah
        // selama drag ini (dibandingkan _dragBase, snapshot dari beginDrag)
        // dibersihkan: bukaan yang jatuh di luar dinding baru di-clamp/
        // dibuang (clampOrDropOpeningsForRoom). Diff thd _dragBase supaya
        // HANYA ruang yang benar-benar di-resize yang kena — drag lain
        // (geser ruang, geser bukaan, resize zona atap, dst.) tak tersentuh.
        if (_dragBase) {
          for (const room of validated.rooms) {
            const before = _dragBase.rooms.find((r) => r.id === room.id);
            if (before && (before.width !== room.width || before.depth !== room.depth)) {
              validated.openings = clampOrDropOpeningsForRoom(validated.openings, room);
            }
          }
        }
        validated.validation = validateLayout(validated, site, structural);
        set({
          layout: validated,
          _dragBase: null,
          _dragPushed: false,
          alignmentGuides: { x: [], y: [], equalX: [], equalY: [] },
        });
      } else {
        set({
          _dragBase: null,
          _dragPushed: false,
          alignmentGuides: { x: [], y: [], equalX: [], equalY: [] },
        });
      }
    },

    undo: () => {
      const { past, layout } = get();
      if (past.length === 0 || !layout) return;
      const prev = past[past.length - 1];
      set((s) => ({
        layout: revalidate(clone(prev)),
        past: s.past.slice(0, -1),
        future: [clone(layout), ...s.future].slice(0, 100),
        dirty: true,
        editSequence: s.editSequence + 1,
        selected: null,
        selectedObjectId: null,
      }));
    },

    redo: () => {
      const { future, layout } = get();
      if (future.length === 0 || !layout) return;
      const next = future[0];
      set((s) => ({
        layout: revalidate(clone(next)),
        future: s.future.slice(1),
        past: [...s.past, clone(layout)].slice(-100),
        dirty: true,
        editSequence: s.editSequence + 1,
        selected: null,
        selectedObjectId: null,
      }));
    },

    markSaved: (savedEditSequence, nextRevision = null) =>
      set((s) => {
        if (
          savedEditSequence !== undefined &&
          s.editSequence !== savedEditSequence
        ) {
          return nextRevision === null ? {} : { layoutRevision: nextRevision };
        }
        return {
          dirty: false,
          layoutRevision: nextRevision ?? s.layoutRevision,
        };
      }),
  };
});

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Host dinding utk aksi tambah elemen fasad (addFacadeElement/
 * addFlutedFacadePanel/addRevealLineFacadePanel) — menangani dua bentuk
 * wallId: `${roomId}:${side}` biasa (Room nyata) DAN `edge-{floorId}:{side}`
 * sintetis (dinding penutup fasad lantai elevated, lihat
 * lib/geometry/edge-wall.ts). Sebelum ini `l.rooms.find` selalu gagal utk
 * wallId sintetis sehingga tombol preset fluted/reveal diam-diam tak berbuat
 * apa-apa pada dinding tepi.
 */
function resolveFacadeWallHost(
  l: DesignLayout,
  wallId: string,
): { floorId: string; lenM: number; levelOffsetM: number } | null {
  const parsed = parseOpeningWall(wallId);
  if (!parsed) return null;
  if (isEdgeWallRoomId(parsed.roomId)) {
    const floorId = edgeWallFloorId(parsed.roomId);
    if (!floorId) return null;
    const geom = edgeWallSideGeometry(l, floorId, parsed.side);
    const span = widestEdgeWallSpan(geom);
    if (!span) return null;
    return { floorId, lenM: span.end - span.start, levelOffsetM: 0 };
  }
  const host = l.rooms.find((r) => r.id === parsed.roomId);
  if (!host) return null;
  const lenM = parsed.side === "n" || parsed.side === "s" ? host.width : host.depth;
  return { floorId: host.floorId, lenM, levelOffsetM: host.levelOffsetM ?? 0 };
}
