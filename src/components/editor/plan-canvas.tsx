"use client";

import * as React from "react";
import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import type {
  ElectricalPoint,
  ElectricalPointType,
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorElementKind,
  ExteriorSegmentElement,
  ExteriorSurfaceElement,
  Opening,
  Room,
  RoofZone,
  RoomType,
  SanitationObject,
  Severity,
  ValidationIssue,
  WaterPoint,
  WaterPointType,
} from "@/types";
import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store";
import {
  PX_PER_METER,
  clamp,
  handlePoint,
  nearestEdge,
  openingSegment,
  parseOpeningWall,
  roomsAdjacentOnSide,
  round2,
  RESIZE_HANDLES,
  type HandleId,
  type Side,
  type Rect,
} from "@/lib/geometry";
import { emptyRectAt } from "@/lib/geometry/empty-rect";
import type { EntityRef } from "@/types/entity-ref";
import { AddRoomAtDialog } from "@/components/editor/context-menu/add-room-at-dialog";
import { actionsForContext } from "@/components/editor/context-menu/action-registry";
import {
  EditorCursorMenu,
  type CursorMenuState,
} from "@/components/editor/context-menu/cursor-menu";
import { MIN_DECK_M } from "@/lib/geometry/rooftop";
import { OPEN_TYPES } from "@/lib/three/build-model";
import { buildingFootprint } from "@/lib/structural/grid";
import { courtyardRect, courtyardRoofRooms } from "@/lib/geometry/roof-holes";
import {
  floorOffset,
  isMezzanineFloor,
  isRooftopFloor,
  mezzanineParentOf,
  topRegularFloorId,
} from "@/lib/editor/floors";
import { formatArea, formatLength, formatElevation } from "@/lib/format";
import { roomZones, sharesZone, zoneColor } from "@/lib/editor/zones";
import { roomAt, clampToRoom } from "@/lib/editor/electrical-place";
import { clampToSite } from "@/lib/editor/sanitation-place";
import { symbolLines } from "@/lib/electrical/electrical";
import { symbolLines as waterSymbolLines } from "@/lib/water/water";
import { ELECTRICAL_POINT_TYPES, WATER_POINT_TYPES } from "@/lib/constants";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditorPanelUiStore } from "@/stores/editor-panel-ui-store";
import { DimensionLayer } from "./dimension-layer";
import {
  ExteriorElementShape,
  ExteriorSelectionHandles,
  type ExteriorHandle,
} from "./exterior-canvas";
import {
  makeAssetElement,
  makeBoxElement,
  makeFrameElement,
  makeGableFrameElement,
  makeRoofZone,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
  segmentDefaultLengthM,
} from "@/lib/exterior/factories";
import { segmentLength } from "@/lib/exterior/geometry";

const ROOM_FILL: Partial<Record<RoomType, string>> = {
  kamar_tidur: "fill-info/10",
  kamar_mandi: "fill-info/20",
  ruang_tamu: "fill-primary/8",
  ruang_keluarga: "fill-primary/10",
  area_kumpul: "fill-primary/10",
  dapur: "fill-warning/15",
  ruang_makan: "fill-warning/10",
  kolam: "fill-info/25",
  taman: "fill-success/15",
  rooftop_lounge: "fill-success/10",
  carport: "fill-muted",
  musholla: "fill-accent/40",
};

const warningIcon: Record<Severity, typeof TriangleAlert> = {
  info: Info,
  warning: TriangleAlert,
  danger: ShieldAlert,
};

function roomFill(type: RoomType) {
  return ROOM_FILL[type] ?? "fill-card";
}

const SNAP_PX = 8;

/** The rooftop floor id — the deck overlay is only editable on this floor. */
const ROOFTOP_FLOOR_ID = "floor-rooftop";

/**
 * Mirrors MIN_SEGMENT_LENGTH_M in src/lib/exterior/validation.ts. That constant
 * isn't exported (and this component may not modify validation.ts), so the
 * threshold is duplicated here — keep the two in sync if the validation rule
 * ever changes. Used on pointer-up to detect a tap-placed segment that a tiny
 * finger-drift micro-move collapsed back toward zero length.
 */
const MIN_EXTERIOR_SEGMENT_LENGTH_M = 0.2;

const SEGMENT_KINDS = new Set<ExteriorElementKind>([
  "boundary_wall",
  "fence",
  "sliding_gate",
  "swing_gate",
  "pedestrian_gate",
]);

const BOX_KINDS = new Set<ExteriorElementKind>([
  "solid_wall",
  "facade_panel",
  "column",
  "chimney",
  "beam",
  "slab",
  "canopy",
  "overhang_slab",
  "planter",
  "pergola",
]);

const SURFACE_KINDS = new Set<ExteriorElementKind>([
  "driveway",
  "walkway",
  "terrace_surface",
  "garden_bed",
]);

const ASSET_KINDS = new Set<ExteriorElementKind>([
  "asset",
  "plant",
  "tree",
  "exterior_decor",
  "vehicle",
]);

function isSegmentKind(
  k: ExteriorElementKind,
): k is ExteriorSegmentElement["kind"] {
  return SEGMENT_KINDS.has(k);
}

function isBoxKind(k: ExteriorElementKind): k is ExteriorBoxElement["kind"] {
  return BOX_KINDS.has(k);
}

function isSurfaceKind(
  k: ExteriorElementKind,
): k is ExteriorSurfaceElement["kind"] {
  return SURFACE_KINDS.has(k);
}

function isAssetKind(k: ExteriorElementKind) {
  return ASSET_KINDS.has(k);
}

function defaultAssetEnvelope(kind: ExteriorElementKind) {
  switch (kind) {
    case "plant":
      return { widthM: 0.6, depthM: 0.6, heightM: 0.8 };
    case "tree":
      return { widthM: 1.2, depthM: 1.2, heightM: 3 };
    case "vehicle":
      return { widthM: 1.9, depthM: 4.5, heightM: 1.6 };
    case "exterior_decor":
      return { widthM: 1, depthM: 1, heightM: 1 };
    default:
      return { widthM: 1, depthM: 1, heightM: 1 };
  }
}

type SanitationKind = "septicTank" | "soakwell" | "controlBox";
type DeckCorner = "nw" | "ne" | "sw" | "se";
type OpeningEndpoint = "start" | "end";

type DragState =
  | { kind: "move"; id: string; offX: number; offY: number }
  | { kind: "resize"; id: string; handle: HandleId }
  | { kind: "openingMove"; id: string; offAlong: number }
  | { kind: "openingResize"; id: string; endpoint: OpeningEndpoint }
  | {
      kind: "electrical";
      id: string;
      room: Room | null;
      offX: number;
      offY: number;
    }
  | { kind: "water"; id: string; room: Room | null; offX: number; offY: number }
  | {
      kind: "sanitation";
      sKind: SanitationKind;
      ref: number | null;
      offX: number;
      offY: number;
    }
  | {
      kind: "rooftopDeck";
      corner: DeckCorner | null;
      offX: number;
      offY: number;
    }
  | { kind: "roofZoneMove"; id: string; offX: number; offY: number }
  | { kind: "roofZoneResize"; id: string; handle: HandleId }
  | { kind: "ladderMove" }
  | { kind: "skylightMove"; id: string; offX: number; offY: number }
  | { kind: "courtyardMove"; roomId: string; offX: number; offY: number }
  | { kind: "courtyardResize"; roomId: string; corner: DeckCorner }
  | {
      kind: "exteriorMove";
      id: string;
      offX: number;
      offY: number;
      start?: { x: number; y: number };
      end?: { x: number; y: number };
      points?: Array<{ x: number; y: number }>;
    }
  | { kind: "exteriorResize"; id: string; handle: ExteriorHandle }
  | {
      kind: "exteriorSegment";
      id: string;
      start: { x: number; y: number };
      end: { x: number; y: number };
    }
  | {
      kind: "exteriorSurface";
      id: string;
      points: Array<{ x: number; y: number }>;
    }
  | { kind: "pan"; lastPx: number; lastPy: number };

// ── Memoized sub-components to prevent full SVG re-render ──

const RoomRect = React.memo(function RoomRect({
  room,
  selected,
  hasIssue,
  panning,
  tool,
  toX,
  toY,
  pxPerMeter,
  onPointerDown,
  zoneFill,
  elevationLabel,
}: {
  room: Room;
  selected: boolean;
  hasIssue: boolean;
  panning: boolean;
  tool: string;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onPointerDown: (e: React.PointerEvent, room: Room) => void;
  zoneFill: string | null;
  elevationLabel: string;
}) {
  const w = room.width * pxPerMeter;
  const d = room.depth * pxPerMeter;
  return (
    <g
      data-testid="room-shape"
      data-room-id={room.id}
      data-room-type={room.type}
      onPointerDown={(e) => onPointerDown(e, room)}
      className={cn(
        panning
          ? "cursor-grab"
          : tool === "select"
            ? "cursor-move"
            : "cursor-pointer",
      )}
    >
      <rect
        x={toX(room.x)}
        y={toY(room.y)}
        width={w}
        height={d}
        className={cn(
          roomFill(room.type),
          selected
            ? "stroke-primary"
            : hasIssue
              ? "stroke-warning"
              : "stroke-foreground/45",
        )}
        strokeWidth={selected ? 3 : 2}
      />
      {zoneFill && (
        <rect
          x={toX(room.x)}
          y={toY(room.y)}
          width={w}
          height={d}
          fill={zoneFill}
          opacity={0.18}
          className="pointer-events-none"
        />
      )}
      {w > 54 && d > 34 && (
        <text
          x={toX(room.x + room.width / 2)}
          y={toY(room.y + room.depth / 2)}
          textAnchor="middle"
          className="pointer-events-none fill-foreground"
        >
          <tspan
            x={toX(room.x + room.width / 2)}
            className="text-[11px] font-medium"
          >
            {room.name}
          </tspan>
          <tspan
            x={toX(room.x + room.width / 2)}
            dy={15}
            className="fill-muted-foreground text-[10px]"
          >
            {formatArea(room.areaM2)}
          </tspan>
          <tspan
            x={toX(room.x + room.width / 2)}
            dy={13}
            className="fill-muted-foreground text-[9px]"
          >
            {elevationLabel}
          </tspan>
        </text>
      )}
      {room.locked && (
        <text
          x={toX(room.x) + 6}
          y={toY(room.y) + 14}
          className="pointer-events-none fill-muted-foreground text-[10px]"
        >
          🔒
        </text>
      )}
    </g>
  );
});

/**
 * Marker warning — Fase 6 (satu model "Cek"): hover HANYA menampilkan
 * Tooltip singkat (bukan mega-dialog 300×260 lama); klik memilih ruang DAN
 * memicu tab "Cek" di panel kanan lewat `useEditorPanelUiStore().focusWarning`
 * (baris peringatannya di-scroll+highlight di sana — lihat
 * `editor-warnings-panel.tsx`). Detail lengkap per-peringatan kini hidup di
 * satu tempat: daftar tab Cek + Dialog "Detail Peringatan"-nya, bukan
 * diduplikasi lagi di kanvas.
 */
const WarningMarker = React.memo(function WarningMarker({
  room,
  issues,
  toX,
  toY,
  onFocusRoom,
}: {
  room: Room;
  issues: ValidationIssue[];
  toX: (m: number) => number;
  toY: (m: number) => number;
  onFocusRoom: (roomId: string | null) => void;
}) {
  const focusWarning = useEditorPanelUiStore((s) => s.focusWarning);
  const maxSeverity: Severity = issues.some((issue) => issue.level === "danger")
    ? "danger"
    : issues.some((issue) => issue.level === "warning")
      ? "warning"
      : "info";
  const Icon = warningIcon[maxSeverity];
  const markerX = toX(room.x + room.width) - 20;
  const markerY = toY(room.y) + 4;

  const tooltipText =
    issues.length === 1
      ? issues[0].message
      : `${issues[0].message} (+${issues.length - 1} peringatan lain)`;

  return (
    <g>
      <foreignObject
        x={markerX}
        y={markerY}
        width={20}
        height={20}
        className="overflow-visible"
      >
        {/* TooltipProvider LOKAL — bukan cuma mengandalkan provider global
            (dipasang sekali di app/providers/index.tsx): marker ini juga
            dirender di test unit yang me-mount <PlanCanvas/> berdiri sendiri,
            jadi harus tetap benar tanpa provider ambien apa pun. Nested
            provider aman (Radix mendukungnya). */}
        <TooltipProvider>
          <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-testid={`warning-marker-${room.id}`}
              aria-label={`Detail peringatan untuk ${room.name}`}
              className={cn(
                "size-5 rounded-full border border-warning/50 bg-background/95 text-warning shadow-sm",
                "hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-warning/50",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onFocusRoom(room.id);
                focusWarning(room.id);
              }}
            >
              <Icon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            {tooltipText}
          </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </foreignObject>
    </g>
  );
});

const ROOF_ZONE_LABEL: Record<RoofZone["type"], string> = {
  datar: "Dak datar",
  pelana: "Atap pelana",
  limasan: "Atap limasan",
  miring: "Atap miring",
};

function roofZoneClass(type: RoofZone["type"]) {
  if (type === "datar") return "fill-slate-400/20 stroke-slate-600";
  if (type === "miring") return "fill-amber-400/20 stroke-amber-600";
  if (type === "limasan") return "fill-emerald-400/20 stroke-emerald-600";
  return "fill-orange-400/20 stroke-orange-600";
}

/** Panah kecil notasi denah atap (arah aliran air) — px space. */
function RoofArrowPx({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ah = 5;
  return (
    <g data-testid="roof-zone-arrow">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.2} />
      <polygon
        points={`${x2},${y2} ${x2 - ah * Math.cos(ang - 0.42)},${y2 - ah * Math.sin(ang - 0.42)} ${x2 - ah * Math.cos(ang + 0.42)},${y2 - ah * Math.sin(ang + 0.42)}`}
        stroke="none"
      />
    </g>
  );
}

/**
 * Notasi roof plan per zona (konvensi gambar kerja arsitek): garis BUBUNGAN
 * (ridge) untuk pelana/limasan + garis jurai (hip), dan panah ARAH AIR
 * menuruni bidang atap. Datar tanpa notasi (dak).
 */
function RoofZoneNotation({
  zone,
  toX,
  toY,
}: {
  zone: RoofZone;
  toX: (m: number) => number;
  toY: (m: number) => number;
}) {
  if (zone.type === "datar") return null;
  const w = zone.widthM;
  const d = zone.depthM;
  const cx = toX(zone.x);
  const cy = toY(zone.y);
  const px0 = toX(zone.x - w / 2);
  const px1 = toX(zone.x + w / 2);
  const py0 = toY(zone.y - d / 2);
  const py1 = toY(zone.y + d / 2);
  const E = 6; // inset ujung panah dari tepi (px)

  if (zone.type === "miring") {
    // Satu bidang — satu panah menuju sisi RENDAH (arah air).
    const side = zone.lowSide ?? "s";
    const from: [number, number] =
      side === "n"
        ? [cx, cy + (py1 - cy) * 0.5]
        : side === "s"
          ? [cx, cy - (cy - py0) * 0.5]
          : side === "w"
            ? [cx + (px1 - cx) * 0.5, cy]
            : [cx - (cx - px0) * 0.5, cy];
    const to: [number, number] =
      side === "n"
        ? [cx, py0 + E]
        : side === "s"
          ? [cx, py1 - E]
          : side === "w"
            ? [px0 + E, cy]
            : [px1 - E, cy];
    return (
      <g className="pointer-events-none stroke-foreground/60 fill-foreground/60">
        <RoofArrowPx x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
      </g>
    );
  }

  // pelana/limasan: bubungan sepanjang dimensi TERPANJANG (selaras
  // GablePrism/HipPyramid di build-model yang memilih ridge dim panjang).
  const ridgeAlongX = w >= d;
  // Limasan: ridge memendek (panjang − lebar); pelana: ridge penuh.
  const ridgeHalfM = zone.type === "limasan" ? Math.max(0, (ridgeAlongX ? w - d : d - w) / 2) : (ridgeAlongX ? w : d) / 2;
  // Gable asimetris (pelana): ridge bergeser tegak-lurus sejauh ridgeOffsetM.
  const ro = zone.type === "pelana" ? (zone.ridgeOffsetM ?? 0) : 0;
  const rcx = ridgeAlongX ? cx : toX(zone.x + ro);
  const rcy = ridgeAlongX ? toY(zone.y + ro) : cy;
  const r0: [number, number] = ridgeAlongX
    ? [toX(zone.x - ridgeHalfM), rcy]
    : [rcx, toY(zone.y - ridgeHalfM)];
  const r1: [number, number] = ridgeAlongX
    ? [toX(zone.x + ridgeHalfM), rcy]
    : [rcx, toY(zone.y + ridgeHalfM)];

  return (
    <g className="pointer-events-none stroke-foreground/60 fill-foreground/60">
      <line
        data-testid="roof-zone-ridge"
        x1={r0[0]}
        y1={r0[1]}
        x2={r1[0]}
        y2={r1[1]}
        strokeWidth={1.8}
      />
      {zone.type === "limasan" && (
        <>
          {/* Garis jurai (hip): tiap sudut zona → ujung bubungan terdekat. */}
          <line x1={px0} y1={py0} x2={r0[0]} y2={r0[1]} strokeWidth={1} />
          <line x1={ridgeAlongX ? px0 : px1} y1={ridgeAlongX ? py1 : py0} x2={r0[0]} y2={r0[1]} strokeWidth={1} />
          <line x1={ridgeAlongX ? px1 : px0} y1={ridgeAlongX ? py0 : py1} x2={r1[0]} y2={r1[1]} strokeWidth={1} />
          <line x1={px1} y1={py1} x2={r1[0]} y2={r1[1]} strokeWidth={1} />
        </>
      )}
      {/* Panah arah air: dari bubungan menuruni tiap bidang. */}
      {ridgeAlongX ? (
        <>
          <RoofArrowPx x1={cx} y1={cy} x2={cx} y2={py0 + E} />
          <RoofArrowPx x1={cx} y1={cy} x2={cx} y2={py1 - E} />
        </>
      ) : (
        <>
          <RoofArrowPx x1={cx} y1={cy} x2={px0 + E} y2={cy} />
          <RoofArrowPx x1={cx} y1={cy} x2={px1 - E} y2={cy} />
        </>
      )}
      {zone.type === "limasan" &&
        (ridgeAlongX ? (
          <>
            <RoofArrowPx x1={r0[0]} y1={r0[1]} x2={px0 + E} y2={cy} />
            <RoofArrowPx x1={r1[0]} y1={r1[1]} x2={px1 - E} y2={cy} />
          </>
        ) : (
          <>
            <RoofArrowPx x1={r0[0]} y1={r0[1]} x2={cx} y2={py0 + E} />
            <RoofArrowPx x1={r1[0]} y1={r1[1]} x2={cx} y2={py1 - E} />
          </>
        ))}
    </g>
  );
}

/** Lubang courtyard (openToSky) di layer Atap — rect editable (geser +
 *  4 handle sudut, pola deck rooftop). Komponen terpisah agar analisis
 *  compiler-lint bersih dari closure drag di render PlanCanvas. */
const CourtyardHoleShape = React.memo(function CourtyardHoleShape({
  roomId,
  hole,
  selected,
  tool,
  toX,
  toY,
  pxPerMeter,
  onBodyDown,
  onHandleDown,
}: {
  roomId: string;
  hole: { x: number; y: number; width: number; depth: number };
  selected: boolean;
  tool: string;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onBodyDown: (
    e: React.PointerEvent,
    roomId: string,
    rect: { x: number; y: number; width: number; depth: number },
  ) => void;
  onHandleDown: (e: React.PointerEvent, roomId: string, corner: DeckCorner) => void;
}) {
  const hx = toX(hole.x);
  const hy = toY(hole.y);
  const hw = hole.width * pxPerMeter;
  const hd = hole.depth * pxPerMeter;
  const corners: Array<[DeckCorner, number, number]> = [
    ["nw", hx, hy],
    ["ne", hx + hw, hy],
    ["sw", hx, hy + hd],
    ["se", hx + hw, hy + hd],
  ];
  return (
    <g data-testid="courtyard-hole">
      <rect
        x={hx}
        y={hy}
        width={hw}
        height={hd}
        rx={3}
        className={cn(
          "fill-emerald-400/15 stroke-emerald-600 cursor-move",
          selected && "stroke-primary",
        )}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray="7 4"
        onPointerDown={(e) => onBodyDown(e, roomId, hole)}
      />
      <line x1={hx} y1={hy} x2={hx + hw} y2={hy + hd} className="pointer-events-none stroke-emerald-600/60" strokeWidth={1} />
      <line x1={hx + hw} y1={hy} x2={hx} y2={hy + hd} className="pointer-events-none stroke-emerald-600/60" strokeWidth={1} />
      <text
        x={hx + hw / 2}
        y={hy - 4}
        textAnchor="middle"
        className="pointer-events-none fill-emerald-700 select-none"
        fontSize={9}
      >
        Terbuka ke langit
      </text>
      {tool === "select" &&
        corners.map(([corner, cxp, cyp]) => (
          <rect
            key={corner}
            data-testid="courtyard-hole-handle"
            x={cxp - 4}
            y={cyp - 4}
            width={8}
            height={8}
            className="fill-background stroke-emerald-600 cursor-nwse-resize"
            strokeWidth={1.2}
            onPointerDown={(e) => onHandleDown(e, roomId, corner)}
          />
        ))}
    </g>
  );
});

const RoofZoneShape = React.memo(function RoofZoneShape({
  zone,
  selected,
  hasIssue,
  toX,
  toY,
  pxPerMeter,
  onPointerDown,
}: {
  zone: RoofZone;
  selected: boolean;
  hasIssue: boolean;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onPointerDown: (e: React.PointerEvent, zone: RoofZone) => void;
}) {
  const x0 = zone.x - zone.widthM / 2;
  const y0 = zone.y - zone.depthM / 2;
  return (
    <g
      data-testid="roof-zone"
      data-type={zone.type}
      data-has-issue={hasIssue ? "true" : "false"}
      data-hidden={zone.hidden ? "true" : "false"}
      className={cn(
        "cursor-pointer",
        selected && "drop-shadow-sm",
        // Zona tersembunyi yang sedang di-reveal diredupkan agar jelas "sedang
        // ditampilkan untuk unhide" — bukan bagian aktif dari desain.
        zone.hidden && "opacity-30",
      )}
      onPointerDown={(e) => onPointerDown(e, zone)}
    >
      <rect
        x={toX(x0)}
        y={toY(y0)}
        width={zone.widthM * pxPerMeter}
        height={zone.depthM * pxPerMeter}
        rx={6}
        className={cn(
          roofZoneClass(zone.type),
          selected && "stroke-primary",
          hasIssue && "stroke-destructive",
        )}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={hasIssue ? "5 3" : undefined}
      />
      <RoofZoneNotation zone={zone} toX={toX} toY={toY} />
      <text
        x={toX(zone.x)}
        y={toY(zone.y) - 5}
        textAnchor="middle"
        className="pointer-events-none fill-foreground text-[10px] font-semibold"
      >
        {ROOF_ZONE_LABEL[zone.type]}
      </text>
    </g>
  );
});

const OpeningLine = React.memo(function OpeningLine({
  op,
  selected,
  rooms,
  toX,
  toY,
  tool,
  onPointerDown,
  onHandleDown,
}: {
  op: Opening;
  selected: boolean;
  rooms: Room[];
  toX: (m: number) => number;
  toY: (m: number) => number;
  tool: string;
  onPointerDown: (e: React.PointerEvent, op: Opening) => void;
  onHandleDown: (
    e: React.PointerEvent,
    op: Opening,
    endpoint: OpeningEndpoint,
  ) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const parsed = parseOpeningWall(op.wallId);
  if (!parsed) return null;
  const room = rooms.find((r) => r.id === parsed.roomId);
  if (!room) return null;
  const seg = openingSegment(room, parsed.side, op.positionM, op.widthM);
  const editable = tool === "select";
  const showHandles = editable && (selected || hovered);
  const cursor = openingResizeCursor(parsed.side);
  const handleSize = 9;
  const handleClass = cn(
    "fill-background stroke-primary opacity-95 transition-opacity",
    editable ? "" : "pointer-events-none opacity-0",
  );
  return (
    <g
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <line
        data-testid="opening-shape"
        data-opening-id={op.id}
        data-opening-type={op.type}
        data-opening-kind={op.kind ?? ""}
        x1={toX(seg.x1)}
        y1={toY(seg.y1)}
        x2={toX(seg.x2)}
        y2={toY(seg.y2)}
        onPointerDown={(e) => onPointerDown(e, op)}
        className={cn(
          editable ? "cursor-pointer" : "cursor-default",
          selected
            ? "stroke-primary"
            : op.type === "door"
              ? "stroke-warning"
              : "stroke-info",
        )}
        strokeWidth={selected ? 6 : 5}
        strokeLinecap="round"
      />
      {showHandles && (
        <>
          <rect
            data-testid="opening-resize-handle"
            data-opening-id={op.id}
            data-endpoint="start"
            x={toX(seg.x1) - handleSize / 2}
            y={toY(seg.y1) - handleSize / 2}
            width={handleSize}
            height={handleSize}
            className={handleClass}
            strokeWidth={1.5}
            style={{ cursor }}
            onPointerDown={(e) => onHandleDown(e, op, "start")}
          />
          <rect
            data-testid="opening-resize-handle"
            data-opening-id={op.id}
            data-endpoint="end"
            x={toX(seg.x2) - handleSize / 2}
            y={toY(seg.y2) - handleSize / 2}
            width={handleSize}
            height={handleSize}
            className={handleClass}
            strokeWidth={1.5}
            style={{ cursor }}
            onPointerDown={(e) => onHandleDown(e, op, "end")}
          />
        </>
      )}
    </g>
  );
});

const ElectricalMarker = React.memo(function ElectricalMarker({
  point,
  selected,
  toX,
  toY,
  onPointerDown,
}: {
  point: ElectricalPoint;
  selected: boolean;
  toX: (m: number) => number;
  toY: (m: number) => number;
  onPointerDown: (e: React.PointerEvent, point: ElectricalPoint) => void;
}) {
  const cx = toX(point.x);
  const cy = toY(point.y);
  // Line-only glyph (distinct per type) rendered in metre space via toX/toY.
  const glyph = symbolLines(point.type, point.x, point.y);
  return (
    <g
      data-testid="electrical-marker"
      data-electrical-id={point.id}
      data-electrical-type={point.type}
      onPointerDown={(e) => onPointerDown(e, point)}
      className="cursor-pointer"
    >
      {/* Fixed-size hit target + selection halo (stays clickable at any zoom). */}
      <circle
        cx={cx}
        cy={cy}
        r={11}
        className={cn(
          selected
            ? "fill-primary/20 stroke-primary"
            : "fill-background/80 stroke-foreground/50",
        )}
        strokeWidth={selected ? 2 : 1}
      />
      {glyph.map((l, i) => (
        <line
          key={i}
          x1={toX(l.x1)}
          y1={toY(l.y1)}
          x2={toX(l.x2)}
          y2={toY(l.y2)}
          className={cn(
            "pointer-events-none",
            selected ? "stroke-primary" : "stroke-foreground",
          )}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
});

const WaterMarker = React.memo(function WaterMarker({
  point,
  selected,
  toX,
  toY,
  onPointerDown,
}: {
  point: WaterPoint;
  selected: boolean;
  toX: (m: number) => number;
  toY: (m: number) => number;
  onPointerDown: (e: React.PointerEvent, point: WaterPoint) => void;
}) {
  const cx = toX(point.x);
  const cy = toY(point.y);
  // Line-only glyph (distinct per fixture type) rendered in metre space.
  const glyph = waterSymbolLines(point.type, point.x, point.y);
  return (
    <g
      data-testid="water-marker"
      data-water-id={point.id}
      data-water-type={point.type}
      onPointerDown={(e) => onPointerDown(e, point)}
      className="cursor-pointer"
    >
      {/* Fixed-size hit target + selection halo (stays clickable at any zoom). */}
      <circle
        cx={cx}
        cy={cy}
        r={11}
        className={cn(
          selected
            ? "fill-primary/20 stroke-primary"
            : "fill-background/80 stroke-info/60",
        )}
        strokeWidth={selected ? 2 : 1}
      />
      {glyph.map((l, i) => (
        <line
          key={i}
          x1={toX(l.x1)}
          y1={toY(l.y1)}
          x2={toX(l.x2)}
          y2={toY(l.y2)}
          className={cn(
            "pointer-events-none",
            selected ? "stroke-primary" : "stroke-info",
          )}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
});

const SanitationMarker = React.memo(function SanitationMarker({
  obj,
  label,
  selected,
  toX,
  toY,
  pxPerMeter,
  onPointerDown,
}: {
  obj: SanitationObject;
  label: string;
  selected: boolean;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Objects sit on the LOT (absolute Site metres); x/y is the object CENTRE,
  // rendered as a widthM × lengthM rectangle.
  const w = Math.max(0, obj.widthM || 0) * pxPerMeter;
  const h = Math.max(0, obj.lengthM || 0) * pxPerMeter;
  const x = toX(obj.x - (obj.widthM || 0) / 2);
  const y = toY(obj.y - (obj.lengthM || 0) / 2);
  return (
    <g
      data-testid="sanitation-marker"
      data-sanitation-id={obj.id}
      onPointerDown={onPointerDown}
      className="cursor-pointer"
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        className={cn(
          "fill-info/15",
          selected ? "stroke-primary" : "stroke-info/70",
        )}
        strokeWidth={selected ? 3 : 2}
        strokeDasharray="4 3"
      />
      <text
        x={toX(obj.x)}
        y={toY(obj.y)}
        textAnchor="middle"
        dominantBaseline="middle"
        className="pointer-events-none fill-foreground text-[9px] font-medium"
      >
        {label}
      </text>
    </g>
  );
});

const RooftopDeckOverlay = React.memo(function RooftopDeckOverlay({
  area,
  tool,
  toX,
  toY,
  pxPerMeter,
  onBodyDown,
  onHandleDown,
}: {
  area: { x: number; y: number; width: number; depth: number };
  tool: string;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onBodyDown: (e: React.PointerEvent) => void;
  onHandleDown: (e: React.PointerEvent, corner: DeckCorner) => void;
}) {
  const w = Math.max(0, area.width) * pxPerMeter;
  const h = Math.max(0, area.depth) * pxPerMeter;
  // Interactive affordances only in the select tool — in door/window/electrical/
  // water tools the deck must not intercept clicks meant for objects underneath.
  const editable = tool === "select";
  const corners: Array<{ id: DeckCorner; cx: number; cy: number }> = [
    { id: "nw", cx: toX(area.x), cy: toY(area.y) },
    { id: "ne", cx: toX(area.x + area.width), cy: toY(area.y) },
    { id: "sw", cx: toX(area.x), cy: toY(area.y + area.depth) },
    { id: "se", cx: toX(area.x + area.width), cy: toY(area.y + area.depth) },
  ];
  return (
    <g>
      {/* Filled body — PURE VISUAL. pointer-events:none so rooms/openings/markers
          under the deck rect (e.g. a "Rooftop lounge" room) stay clickable and
          draggable in every tool. Painted on top so the deck outline stays visible. */}
      <rect
        data-testid="rooftop-deck-overlay"
        x={toX(area.x)}
        y={toY(area.y)}
        width={w}
        height={h}
        className="fill-primary/10 stroke-primary"
        strokeWidth={2}
        strokeDasharray="6 4"
        style={{ pointerEvents: "none" }}
      />
      <text
        x={toX(area.x + area.width / 2)}
        y={toY(area.y) + 14}
        textAnchor="middle"
        className="pointer-events-none fill-primary text-[10px] font-medium"
      >
        Deck rooftop
      </text>
      {editable && (
        <>
          {/* Border-only hit area — a stroke-only rect with a thick TRANSPARENT
              stroke, so the deck can be grabbed by its edge to move it even when a
              room fully covers the fill. Only the stroke is interactive. */}
          <rect
            data-testid="rooftop-deck-border"
            x={toX(area.x)}
            y={toY(area.y)}
            width={w}
            height={h}
            fill="none"
            stroke="transparent"
            strokeWidth={10}
            onPointerDown={onBodyDown}
            className="cursor-move"
            style={{ pointerEvents: "stroke" }}
          />
          {corners.map((c) => (
            <rect
              key={c.id}
              data-testid="rooftop-deck-handle"
              data-corner={c.id}
              x={c.cx - 5}
              y={c.cy - 5}
              width={10}
              height={10}
              onPointerDown={(e) => onHandleDown(e, c.id)}
              className="fill-background stroke-primary"
              strokeWidth={1.5}
              style={{
                cursor:
                  c.id === "nw" || c.id === "se"
                    ? "nwse-resize"
                    : "nesw-resize",
              }}
            />
          ))}
        </>
      )}
    </g>
  );
});

// ── Main canvas ──

export function PlanCanvas() {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<DragState | null>(null);
  const fittedRef = React.useRef<string | null>(null);
  const rafRef = React.useRef<number>(0);
  const pendingMove = React.useRef<PointerEvent | null>(null);
  const [spaceDown, setSpaceDown] = React.useState(false);

  const layout = useEditorStore((s) => s.layout);
  const site = useEditorStore((s) => s.site);
  // Viewer publik read-only (template gallery): SEMUA pointer-down diperlakukan
  // sebagai pan (lihat `panning` di bawah) — tidak ada drag-mutasi/seleksi yang
  // mengubah layout. Wheel-zoom & pan tetap jalan.
  const readOnly = useEditorStore((s) => s.readOnly);
  const floorId = useEditorStore((s) => s.selectedFloorId);
  const selectedId = useEditorStore((s) => s.selectedObjectId);
  const selWallRoomId = useEditorStore((s) =>
    s.selected?.kind === "wall" ? s.selected.roomId : null,
  );
  const selWallSide = useEditorStore((s) =>
    s.selected?.kind === "wall" ? s.selected.side : null,
  );
  const selSkylightId = useEditorStore((s) =>
    s.selected?.kind === "skylight" ? s.selected.id : null,
  );
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.activeTool);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const gridSize = useEditorStore((s) => s.gridSize);
  const showDimensions = useEditorStore((s) => s.showDimensions);
  const dimensionUnit = useEditorStore((s) => s.dimensionUnit);
  const alignmentGuides = useEditorStore((s) => s.alignmentGuides);

  const setTool = useEditorStore((s) => s.setTool);
  // Fase 3: 5 field pending* terpisah dikonsolidasi jadi satu
  // `pendingPlacement {tool, variant}` di store — derive di sini per-tool
  // supaya seluruh logika penempatan di bawah (byte-identical) tetap baca
  // variabel lokal bernama sama seperti sebelumnya.
  const pendingPlacement = useEditorStore((s) => s.pendingPlacement);
  const pendingRoomType =
    pendingPlacement?.tool === "room"
      ? (pendingPlacement.variant as RoomType | undefined) ?? null
      : null;
  const addRoom = useEditorStore((s) => s.addRoom);
  const pendingElectricalType =
    pendingPlacement?.tool === "electrical"
      ? (pendingPlacement.variant as ElectricalPointType | undefined) ?? null
      : null;
  const addElectricalPoint = useEditorStore((s) => s.addElectricalPoint);
  const dragElectricalTo = useEditorStore((s) => s.dragElectricalTo);
  const pendingWaterType =
    pendingPlacement?.tool === "water"
      ? (pendingPlacement.variant as WaterPointType | undefined) ?? null
      : null;
  const addWaterPoint = useEditorStore((s) => s.addWaterPoint);
  const dragWaterTo = useEditorStore((s) => s.dragWaterTo);
  const moveSanitationObject = useEditorStore((s) => s.moveSanitationObject);
  const dragRooftopAreaTo = useEditorStore((s) => s.dragRooftopAreaTo);
  const dragOpeningResize = useEditorStore((s) => s.dragOpeningResize);
  const pendingExteriorKind =
    pendingPlacement?.tool === "exterior"
      ? (pendingPlacement.variant as ExteriorElementKind | undefined) ?? null
      : null;
  const addExteriorElement = useEditorStore((s) => s.addExteriorElement);
  const dragExteriorTo = useEditorStore((s) => s.dragExteriorTo);
  const dragExteriorResize = useEditorStore((s) => s.dragExteriorResize);
  const pendingRoofZoneType =
    pendingPlacement?.tool === "roofZone"
      ? (pendingPlacement.variant as RoofZone["type"] | undefined) ?? null
      : null;
  const addRoofZone = useEditorStore((s) => s.addRoofZone);
  const dragRoofZoneTo = useEditorStore((s) => s.dragRoofZoneTo);
  const dragRoofZoneResize = useEditorStore((s) => s.dragRoofZoneResize);
  const dragRooftopLadderTo = useEditorStore((s) => s.dragRooftopLadderTo);
  const dragSkylightTo = useEditorStore((s) => s.dragSkylightTo);
  const dragCourtyardRectTo = useEditorStore((s) => s.dragCourtyardRectTo);

  const selectObject = useEditorStore((s) => s.selectObject);
  const beginDrag = useEditorStore((s) => s.beginDrag);
  const dragRoomTo = useEditorStore((s) => s.dragRoomTo);
  const dragResize = useEditorStore((s) => s.dragResize);
  const endDrag = useEditorStore((s) => s.endDrag);
  const addOpening = useEditorStore((s) => s.addOpening);
  const panBy = useEditorStore((s) => s.panBy);
  const setPan = useEditorStore((s) => s.setPan);
  const setZoom = useEditorStore((s) => s.setZoom);

  // Memoize pixel conversion to avoid recalculation
  const pxPerMeter = React.useMemo(() => PX_PER_METER * zoom, [zoom]);

  // ── Menu klik-kanan kontekstual (2D) + dialog "Tambah ruang di sini" ──
  const [ctxRef, setCtxRef] = React.useState<EntityRef | null>(null);
  const [ctxPoint, setCtxPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [menuState, setMenuState] = React.useState<CursorMenuState>({ open: false, x: 0, y: 0 });
  const [addRoomRect, setAddRoomRect] = React.useState<Rect | null>(null);
  const closeMenu = React.useCallback(() => setMenuState((s) => ({ ...s, open: false })), []);
  // Override hit-test dari elemen DOM (mis. exterior) yang menetapkan ref-nya
  // sendiri saat klik-kanan — tanpa menghentikan event (Radix tetap membuka
  // menu). Dicocokkan via timeStamp native event yang sama saat menggelembung.
  const ctxHitRef = React.useRef<{ ref: EntityRef; token: number } | null>(null);
  const toX = React.useCallback(
    (m: number) => pan.x + m * pxPerMeter,
    [pan.x, pxPerMeter],
  );
  const toY = React.useCallback(
    (m: number) => pan.y + m * pxPerMeter,
    [pan.y, pxPerMeter],
  );

  const capture = (id: number) => {
    try {
      svgRef.current?.setPointerCapture(id);
    } catch {
      /* released */
    }
  };
  const release = (id: number) => {
    try {
      svgRef.current?.releasePointerCapture(id);
    } catch {
      /* noop */
    }
  };

  const pointer = React.useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return {
        px,
        py,
        wx: (px - pan.x) / pxPerMeter,
        wy: (py - pan.y) / pxPerMeter,
      };
    },
    [pan.x, pan.y, pxPerMeter],
  );

  // ── rAF-throttled move handler — fires at most once per frame ──
  const processMove = React.useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (d.kind === "pan") {
        panBy(e.clientX - d.lastPx, e.clientY - d.lastPy);
        d.lastPx = e.clientX;
        d.lastPy = e.clientY;
        return;
      }
      const { wx, wy } = pointer(e);
      if (d.kind === "move")
        dragRoomTo(d.id, wx - d.offX, wy - d.offY, SNAP_PX / pxPerMeter);
      else if (d.kind === "resize")
        dragResize(d.id, d.handle, wx, wy, SNAP_PX / pxPerMeter);
      else if (d.kind === "electrical") {
        const rx = wx - d.offX;
        const ry = wy - d.offY;
        const c = d.room ? clampToRoom(d.room, rx, ry) : { x: rx, y: ry };
        dragElectricalTo(d.id, c.x, c.y);
      } else if (d.kind === "water") {
        const rx = wx - d.offX;
        const ry = wy - d.offY;
        const c = d.room ? clampToRoom(d.room, rx, ry) : { x: rx, y: ry };
        dragWaterTo(d.id, c.x, c.y);
      } else if (d.kind === "sanitation") {
        // Land-objects clamp to the whole lot (Site bounds), not a room.
        const s = useEditorStore.getState().site;
        if (s) {
          const c = clampToSite(s, wx - d.offX, wy - d.offY);
          moveSanitationObject(d.sKind, d.ref, c.x, c.y);
        }
      } else if (d.kind === "rooftopDeck") {
        // Read the live rect (avoid stale closure) — the store re-clamps to the
        // footprint, so the move handler only proposes a snapped rect. Goes through
        // the live() drag action so the whole gesture is ONE undo entry.
        const area = useEditorStore.getState().layout?.rooftopArea;
        if (!area) return;
        if (d.corner === null) {
          dragRooftopAreaTo({
            ...area,
            x: snap01(wx - d.offX),
            y: snap01(wy - d.offY),
          });
        } else {
          dragRooftopAreaTo(
            resizeDeckRect(area, d.corner, snap01(wx), snap01(wy)),
          );
        }
      } else if (d.kind === "roofZoneMove") {
        dragRoofZoneTo(
          d.id,
          round2(wx - d.offX),
          round2(wy - d.offY),
          SNAP_PX / pxPerMeter,
        );
      } else if (d.kind === "roofZoneResize") {
        dragRoofZoneResize(
          d.id,
          d.handle,
          round2(wx),
          round2(wy),
          SNAP_PX / pxPerMeter,
        );
      } else if (d.kind === "skylightMove") {
        dragSkylightTo(
          d.id,
          round2(wx - d.offX),
          round2(wy - d.offY),
          SNAP_PX / pxPerMeter,
        );
      } else if (d.kind === "courtyardMove" || d.kind === "courtyardResize") {
        const l = useEditorStore.getState().layout;
        const cRoom = l?.rooms.find((r) => r.id === d.roomId);
        if (!cRoom) return;
        const cur = courtyardRect(cRoom);
        if (d.kind === "courtyardMove") {
          dragCourtyardRectTo(d.roomId, {
            ...cur,
            x: snap01(wx - d.offX),
            y: snap01(wy - d.offY),
          });
        } else {
          dragCourtyardRectTo(
            d.roomId,
            resizeDeckRect(cur, d.corner, snap01(wx), snap01(wy), 0.6),
          );
        }
      } else if (d.kind === "ladderMove") {
        const l = useEditorStore.getState().layout;
        if (l?.rooftopAccess?.kind !== "tangga_monyet") return;
        const fp = buildingFootprint(l);
        const posM =
          l.rooftopAccess.side === "n" || l.rooftopAccess.side === "s"
            ? wx - fp.x0
            : wy - fp.y0;
        dragRooftopLadderTo(round2(posM));
      } else if (d.kind === "openingResize") {
        const liveLayout = useEditorStore.getState().layout;
        const op = liveLayout?.openings.find((opening) => opening.id === d.id);
        const parsed = op ? parseOpeningWall(op.wallId) : null;
        const room = parsed
          ? liveLayout?.rooms.find((r) => r.id === parsed.roomId)
          : null;
        if (!op || !parsed || !room) return;
        const along =
          parsed.side === "n" || parsed.side === "s"
            ? wx - room.x
            : wy - room.y;
        const next = resizeOpeningAlongWall(
          room,
          parsed.side,
          op,
          d.endpoint,
          snap01(along),
        );
        dragOpeningResize(op.id, next.positionM, next.widthM);
      } else if (d.kind === "openingMove") {
        const liveLayout = useEditorStore.getState().layout;
        const op = liveLayout?.openings.find((opening) => opening.id === d.id);
        const parsed = op ? parseOpeningWall(op.wallId) : null;
        const room = parsed
          ? liveLayout?.rooms.find((r) => r.id === parsed.roomId)
          : null;
        if (!op || !parsed || !room) return;
        const along =
          parsed.side === "n" || parsed.side === "s"
            ? wx - room.x
            : wy - room.y;
        const next = moveOpeningAlongWall(
          room,
          parsed.side,
          op,
          snap01(along - d.offAlong),
        );
        dragOpeningResize(op.id, next.positionM, next.widthM);
      } else if (d.kind === "exteriorMove") {
        const liveLayout = useEditorStore.getState().layout;
        const el = liveLayout?.exteriorElements?.find((e) => e.id === d.id);
        if (!el) return;
        if ("start" in el && "end" in el) {
          const dx = wx - d.offX;
          const dy = wy - d.offY;
          dragExteriorTo(d.id, {
            start: {
              x: round2((d.start?.x ?? el.start.x) + dx),
              y: round2((d.start?.y ?? el.start.y) + dy),
            },
            end: {
              x: round2((d.end?.x ?? el.end.x) + dx),
              y: round2((d.end?.y ?? el.end.y) + dy),
            },
          });
        } else if ("x" in el && "y" in el) {
          dragExteriorTo(d.id, {
            x: round2(wx - d.offX),
            y: round2(wy - d.offY),
          });
        } else if ("points" in el) {
          const dx = wx - d.offX;
          const dy = wy - d.offY;
          const surface = el as ExteriorSurfaceElement;
          const basePoints = d.points ?? surface.points;
          dragExteriorTo(d.id, {
            points: basePoints.map((p) => ({
              x: round2(p.x + dx),
              y: round2(p.y + dy),
            })),
          });
        }
      } else if (d.kind === "exteriorResize") {
        dragExteriorResize(
          d.id,
          exteriorHandleToString(d.handle),
          round2(wx),
          round2(wy),
        );
      } else if (d.kind === "exteriorSegment") {
        dragExteriorTo(d.id, {
          end: { x: round2(wx), y: round2(wy) },
        });
      }
    },
    [
      panBy,
      pointer,
      dragRoomTo,
      dragResize,
      dragElectricalTo,
      dragWaterTo,
      moveSanitationObject,
      dragRooftopAreaTo,
      dragRoofZoneTo,
      dragRoofZoneResize,
      dragRooftopLadderTo,
      dragSkylightTo,
      dragCourtyardRectTo,
      dragOpeningResize,
      dragExteriorTo,
      dragExteriorResize,
      pxPerMeter,
    ],
  );

  const scheduleMove = React.useCallback(
    (e: React.PointerEvent) => {
      pendingMove.current = e.nativeEvent;
      if (rafRef.current) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (pendingMove.current) {
          processMove(pendingMove.current);
          pendingMove.current = null;
        }
      });
    },
    [processMove],
  );

  // Grid lines — memoized so selection/drag don't rebuild them
  const gridLines = React.useMemo(() => {
    if (!site) return null;
    const lines: React.ReactNode[] = [];
    for (let x = 0; x <= site.widthM + 0.001; x += gridSize) {
      const major = Math.abs(x % 1) < 0.001;
      lines.push(
        <line
          key={`gx-${x}`}
          x1={toX(x)}
          y1={toY(0)}
          x2={toX(x)}
          y2={toY(site.depthM)}
          className={major ? "stroke-border" : "stroke-border/50"}
          strokeWidth={major ? 1 : 0.5}
        />,
      );
    }
    for (let y = 0; y <= site.depthM + 0.001; y += gridSize) {
      const major = Math.abs(y % 1) < 0.001;
      lines.push(
        <line
          key={`gy-${y}`}
          x1={toX(0)}
          y1={toY(y)}
          x2={toX(site.widthM)}
          y2={toY(y)}
          className={major ? "stroke-border" : "stroke-border/50"}
          strokeWidth={major ? 1 : 0.5}
        />,
      );
    }
    return lines;
  }, [site, gridSize, toX, toY]);

  // Fit the plan to the viewport when a new layout loads
  React.useEffect(() => {
    if (!layout || !site || !svgRef.current) return;
    if (fittedRef.current === layout.id) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    const pad = 64;
    const fit = Math.min(
      (rect.width - pad) / (site.widthM * PX_PER_METER),
      (rect.height - pad) / (site.depthM * PX_PER_METER),
    );
    const z = clamp(fit, 0.25, 2);
    const ppm = PX_PER_METER * z;
    setZoom(z);
    setPan({
      x: (rect.width - site.widthM * ppm) / 2,
      y: (rect.height - site.depthM * ppm) / 2,
    });
    fittedRef.current = layout.id;
  }, [layout, site, setZoom, setPan]);

  // Non-passive wheel zoom anchored at the cursor
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cur = useEditorStore.getState();
      const ppm = PX_PER_METER * cur.zoom;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = clamp(cur.zoom * factor, 0.25, 4);
      const newPpm = PX_PER_METER * newZoom;
      const wx = (px - cur.pan.x) / ppm;
      const wy = (py - cur.pan.y) / ppm;
      cur.setPan({ x: px - wx * newPpm, y: py - wy * newPpm });
      cur.setZoom(newZoom);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space to temporarily pan
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e)) {
        e.preventDefault();
        drag.current = null;
        pendingMove.current = null;
        setSpaceDown(false);
        endDrag();
        setTool("select");
        return;
      }
      if (e.code === "Space" && !isTyping(e)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [endDrag, setTool]);

  // Cleanup rAF on unmount
  React.useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Declared before the early return so hook order stays stable (rules-of-hooks).
  // readOnly folds into `panning` so every per-element pointer-down handler
  // below (each already gated on `panning`) bails out WITHOUT stopPropagation,
  // letting the event bubble to onBackgroundDown — which starts a plain pan
  // drag, same as the spaceDown path.
  const panning = readOnly || tool === "pan" || spaceDown;

  const onRoomDown = React.useCallback(
    (e: React.PointerEvent, room: Room) => {
      if (panning) return;
      e.stopPropagation();
      if (tool === "door" || tool === "window") {
        const { wx, wy } = pointer(e);
        const edge = nearestEdge(room, wx, wy);
        const added = addOpening(room.id, edge.side, edge.positionM, tool);
        if (!added) {
          // Dinding penuh — tak ada celah kosong yang muat bukaan baru.
          // Beri tahu pengguna alih-alih diam (regresi: klik ke-2 "Tambah
          // jendela" pada dinding yg sudah terisi tampak tak berbuat apa-apa).
          toast.error(
            tool === "door"
              ? "Tidak ada celah kosong di dinding ini untuk pintu baru."
              : "Tidak ada celah kosong di dinding ini untuk jendela baru.",
          );
          return;
        }
        selectObject(room.id);
        return;
      }
      if (tool === "electrical") {
        // Drop a point inside the clicked room (rooms stop propagation, so the
        // background handler never sees clicks that land on a room).
        const { wx, wy } = pointer(e);
        addElectricalPoint(
          room.id,
          pendingElectricalType ?? "stopkontak",
          wx,
          wy,
        );
        return;
      }
      if (tool === "water") {
        const { wx, wy } = pointer(e);
        addWaterPoint(room.id, pendingWaterType ?? "kran", wx, wy);
        return;
      }
      selectObject(room.id);
      if (tool === "select" && !room.locked) {
        const { wx, wy } = pointer(e);
        beginDrag();
        drag.current = {
          kind: "move",
          id: room.id,
          offX: wx - room.x,
          offY: wy - room.y,
        };
        capture(e.pointerId);
      }
    },
    [
      panning,
      tool,
      pointer,
      addOpening,
      addElectricalPoint,
      pendingElectricalType,
      addWaterPoint,
      pendingWaterType,
      selectObject,
      beginDrag,
    ],
  );

  const onWallDown = React.useCallback(
    (e: React.PointerEvent, room: Room, side: Side) => {
      if (panning) return;
      e.stopPropagation();
      select({ kind: "wall", roomId: room.id, side });
    },
    [panning, select],
  );

  const onOpeningDown = React.useCallback(
    (e: React.PointerEvent, op: Opening) => {
      if (panning) return;
      e.stopPropagation();
      selectObject(op.id);
      if (tool !== "select") return;
      const liveLayout = useEditorStore.getState().layout;
      const parsed = parseOpeningWall(op.wallId);
      const room = parsed
        ? liveLayout?.rooms.find((r) => r.id === parsed.roomId)
        : null;
      if (!parsed || !room) return;
      const { wx, wy } = pointer(e);
      const along =
        parsed.side === "n" || parsed.side === "s" ? wx - room.x : wy - room.y;
      beginDrag();
      drag.current = {
        kind: "openingMove",
        id: op.id,
        offAlong: along - op.positionM,
      };
      capture(e.pointerId);
    },
    [panning, tool, pointer, selectObject, beginDrag],
  );

  const onOpeningHandleDown = React.useCallback(
    (e: React.PointerEvent, op: Opening, endpoint: OpeningEndpoint) => {
      if (panning || tool !== "select") return;
      e.stopPropagation();
      selectObject(op.id);
      beginDrag();
      drag.current = { kind: "openingResize", id: op.id, endpoint };
      capture(e.pointerId);
    },
    [panning, tool, selectObject, beginDrag],
  );

  const onElectricalDown = React.useCallback(
    (e: React.PointerEvent, point: ElectricalPoint) => {
      if (panning) return;
      e.stopPropagation();
      selectObject(point.id);
      if (tool === "select" || tool === "electrical") {
        const { wx, wy } = pointer(e);
        const room =
          useEditorStore
            .getState()
            .layout?.rooms.find((r) => r.id === point.roomId) ?? null;
        beginDrag();
        drag.current = {
          kind: "electrical",
          id: point.id,
          room,
          offX: wx - point.x,
          offY: wy - point.y,
        };
        capture(e.pointerId);
      }
    },
    [panning, tool, pointer, selectObject, beginDrag],
  );

  const onWaterDown = React.useCallback(
    (e: React.PointerEvent, point: WaterPoint) => {
      if (panning) return;
      e.stopPropagation();
      selectObject(point.id);
      if (tool === "select" || tool === "water") {
        const { wx, wy } = pointer(e);
        const room =
          useEditorStore
            .getState()
            .layout?.rooms.find((r) => r.id === point.roomId) ?? null;
        beginDrag();
        drag.current = {
          kind: "water",
          id: point.id,
          room,
          offX: wx - point.x,
          offY: wy - point.y,
        };
        capture(e.pointerId);
      }
    },
    [panning, tool, pointer, selectObject, beginDrag],
  );

  const onSanitationDown = React.useCallback(
    (
      e: React.PointerEvent,
      sKind: SanitationKind,
      ref: number | null,
      obj: SanitationObject,
    ) => {
      if (panning) return;
      e.stopPropagation();
      selectObject(obj.id);
      if (tool === "select" || tool === "water") {
        const { wx, wy } = pointer(e);
        beginDrag();
        drag.current = {
          kind: "sanitation",
          sKind,
          ref,
          offX: wx - obj.x,
          offY: wy - obj.y,
        };
        capture(e.pointerId);
      }
    },
    [panning, tool, pointer, selectObject, beginDrag],
  );

  const onExteriorDown = React.useCallback(
    (e: React.PointerEvent, el: ExteriorElement) => {
      if (panning) return;
      e.stopPropagation();
      selectObject(el.id);
      // Elemen eksterior yang baru ditempatkan tetap di tool "exterior" (mode
      // tap-berulang, sama seperti electrical/water) — jadi drag reposisi
      // HARUS tetap jalan di kedua tool ini, bukan cuma "select". Sebelumnya
      // guard ini hanya mengizinkan "select", sehingga elemen yang baru
      // ditempatkan tak bisa digeser sama sekali sampai user ganti tool.
      if ((tool !== "select" && tool !== "exterior") || el.locked) return;
      const { wx, wy } = pointer(e);
      beginDrag();
      if ("start" in el && "end" in el) {
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: wx,
          offY: wy,
          start: { x: el.start.x, y: el.start.y },
          end: { x: el.end.x, y: el.end.y },
        };
      } else if ("points" in el) {
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: wx,
          offY: wy,
          points: el.points.map((p) => ({ x: p.x, y: p.y })),
        };
      } else if ("x" in el && "y" in el) {
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: wx - el.x,
          offY: wy - el.y,
        };
      }
      capture(e.pointerId);
    },
    [panning, tool, pointer, selectObject, beginDrag],
  );

  const onExteriorHandleDown = React.useCallback(
    (e: React.PointerEvent, el: ExteriorElement, handle: ExteriorHandle) => {
      if (
        panning ||
        (tool !== "select" && tool !== "exterior") ||
        el.locked
      )
        return;
      e.stopPropagation();
      selectObject(el.id);
      beginDrag();
      drag.current = { kind: "exteriorResize", id: el.id, handle };
      capture(e.pointerId);
    },
    [panning, tool, selectObject, beginDrag],
  );

  if (!layout || !site) return null;

  const rooms = layout.rooms.filter((r) => r.floorId === floorId);
  const openings = layout.openings.filter((o) => o.floorId === floorId);
  // Electrical points on this floor. Defensive: drop non-finite coords, unknown
  // types, and orphans whose room is gone or on another floor (carry-forward).
  const roomIds = new Set(rooms.map((r) => r.id));
  const electrical = (layout.electrical ?? []).filter(
    (p) =>
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      (p.type as string) in ELECTRICAL_POINT_TYPES &&
      roomIds.has(p.roomId),
  );
  // Water points on this floor — same defensive filter as electrical.
  const water = (layout.water ?? []).filter(
    (p) =>
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      (p.type as string) in WATER_POINT_TYPES &&
      roomIds.has(p.roomId),
  );
  // PRA-EXISTING (bukan dari WS-A): keempat useEditorStore di bawah dipanggil
  // SETELAH early-return `if (!layout || !site) return null` di atas — ini
  // pelanggaran Rules of Hooks yang sudah ada sebelum audit CI lint 2026-08.
  // Ditandai eslint-disable (bukan diperbaiki di sini) karena memindah hook
  // ke atas early-return butuh verifikasi visual kanvas 2D/3D yang di luar
  // scope & tooling workstream ini (tanpa Playwright). Dilacak di TODOS.md P1.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const showHiddenExteriorElements = useEditorStore(
    (s) => s.showHiddenExteriorElements
  );
  const exteriorElements = (layout.exteriorElements ?? []).filter(
    (el) => (!el.hidden || showHiddenExteriorElements) &&
      (!el.floorId || el.floorId === floorId),
  );
  // Roof zones: HANYA dirender di layer Atap (lembar roof-plan tersendiri —
  // tidak lagi bertumpuk dgn denah lantai). Filter global showRoofZones, lalu
  // per-zona hidden — zona tersembunyi hanya muncul saat reveal aktif.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- lihat catatan di atas (TODOS.md P1)
  const showRoofZones = useEditorStore((s) => s.showRoofZones);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- lihat catatan di atas (TODOS.md P1)
  const showHiddenRoofZones = useEditorStore((s) => s.showHiddenRoofZones);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- lihat catatan di atas (TODOS.md P1)
  const showCrossFloorRooms = useEditorStore((s) => s.showCrossFloorRooms);
  const atapLayer = floorId === ROOF_LAYER_ID;
  const roofZones = (layout.roofZones ?? []).filter(
    (zone) =>
      atapLayer && showRoofZones && (!zone.hidden || showHiddenRoofZones),
  );
  // Ghost referensi layer Atap: outline ruang lantai teratas biasa (atap
  // duduk di atasnya) — konvensi denah atap arsitek.
  const topRegularId = topRegularFloorId(layout.floors);
  const ghostRooms = atapLayer
    ? layout.rooms.filter((r) => r.floorId === topRegularId)
    : [];
  // Ghost referensi lantai MEZZANINE (E7): outline redup ruang lantai INDUK
  // (non-interaktif) — mezzanine melayang di dalam volume induknya, jadi
  // dinding induk jadi acuan letak. Pola sama dgn atap-ghost-layer.
  const activeFloorObj = layout.floors.find((f) => f.id === floorId);
  const mezzParent =
    activeFloorObj && isMezzanineFloor(activeFloorObj)
      ? mezzanineParentOf(layout.floors, activeFloorObj.id)
      : null;
  const mezzGhostRooms = mezzParent
    ? layout.rooms.filter((r) => r.floorId === mezzParent.id)
    : [];
  // Sanitation land-objects live on the LOT (not floor-scoped) so they stay
  // visible on every floor. Defensive: skip non-finite coords.
  const sanitationMarkers: Array<{
    obj: SanitationObject;
    label: string;
    sKind: SanitationKind;
    ref: number | null;
  }> = [];
  const okSan = (o: unknown): o is SanitationObject =>
    Boolean(o) &&
    typeof o === "object" &&
    Number.isFinite((o as SanitationObject).x) &&
    Number.isFinite((o as SanitationObject).y);
  const san = layout.sanitation;
  if (san) {
    if (okSan(san.septicTank))
      sanitationMarkers.push({
        obj: san.septicTank,
        label: "Septic",
        sKind: "septicTank",
        ref: null,
      });
    if (okSan(san.soakwell))
      sanitationMarkers.push({
        obj: san.soakwell,
        label: "Resapan",
        sKind: "soakwell",
        ref: null,
      });
    if (Array.isArray(san.controlBoxes)) {
      san.controlBoxes.forEach((b, i) => {
        if (okSan(b))
          sanitationMarkers.push({
            obj: b,
            label: `BK${i + 1}`,
            sKind: "controlBox",
            ref: i,
          });
      });
    }
  }
  const markerIssues = new Map<string, ValidationIssue[]>();
  for (const issue of layout.validation.issues) {
    if (!issue.objectId || issue.level === "info") continue;
    const objectIds = issue.objectId
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    for (const objectId of objectIds) {
      const list = markerIssues.get(objectId) ?? [];
      list.push(issue);
      markerIssues.set(objectId, list);
    }
  }
  const selectedRoom = rooms.find((r) => r.id === selectedId);
  const selectedRoofZone = roofZones.find((z) => z.id === selectedId);

  const onBackgroundDown = (e: React.PointerEvent) => {
    // readOnly: SEMUA pointer-down (termasuk Ctrl/⌘+klik "tambah ruang di
    // sini" & tool click-to-place di bawah, yang tidak dijaga `panning`)
    // langsung jadi pan — jalur identik dengan cabang `panning` di bawah.
    if (readOnly) {
      drag.current = { kind: "pan", lastPx: e.clientX, lastPy: e.clientY };
      capture(e.pointerId);
      return;
    }
    // Ctrl/⌘ + klik kiri di area kosong → dialog "Tambah ruang di sini"
    // (ruang baru dipasang PAS mengisi celah di bawah kursor).
    if (
      (e.ctrlKey || e.metaKey) &&
      e.button === 0 &&
      !!floorId &&
      floorId !== ROOF_LAYER_ID
    ) {
      const { wx, wy } = pointer(e);
      if (!roomAt(rooms, wx, wy)) {
        const rect = emptyRectAt({ x: wx, y: wy }, rooms, site);
        if (rect) {
          setAddRoomRect(rect);
          return;
        }
      }
    }
    if (tool === "room" && pendingRoomType) {
      const { wx, wy } = pointer(e);
      addRoom(pendingRoomType, wx, wy);
      setTool("select");
      return;
    }
    if (tool === "electrical") {
      const { wx, wy } = pointer(e);
      const room = roomAt(rooms, wx, wy);
      // Only place inside a room; clicking empty canvas does nothing (tool stays
      // active so multiple points can be dropped in a row).
      if (room)
        addElectricalPoint(
          room.id,
          pendingElectricalType ?? "stopkontak",
          wx,
          wy,
        );
      return;
    }
    if (tool === "water") {
      const { wx, wy } = pointer(e);
      const room = roomAt(rooms, wx, wy);
      if (room) addWaterPoint(room.id, pendingWaterType ?? "kran", wx, wy);
      return;
    }
    if (tool === "roofZone" && pendingRoofZoneType) {
      const { wx, wy } = pointer(e);
      const zone = makeRoofZone(pendingRoofZoneType, round2(wx), round2(wy), {
        floorId: floorId && floorId !== ROOF_LAYER_ID ? floorId : undefined,
        widthM: Math.min(6, site.widthM),
        depthM: Math.min(6, site.depthM),
        materialId: layout.roof?.material,
        lowSide: pendingRoofZoneType === "miring" ? "s" : undefined,
      });
      addRoofZone(zone);
      selectObject(zone.id);
      beginDrag();
      drag.current = {
        kind: "roofZoneMove",
        id: zone.id,
        offX: 0,
        offY: 0,
      };
      capture(e.pointerId);
      return;
    }
    if (tool === "exterior" && pendingExteriorKind) {
      const { wx, wy } = pointer(e);
      const k = pendingExteriorKind;
      if (isSegmentKind(k)) {
        const length = segmentDefaultLengthM(k);
        const maxStartX = Math.max(0, site.widthM - length);
        const startX = round2(Math.min(Math.max(wx, 0), maxStartX));
        const endX = round2(Math.min(startX + length, site.widthM));
        const el = makeSegmentElement(
          k,
          { x: startX, y: round2(wy) },
          { x: endX, y: round2(wy) },
        );
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorSegment",
          id: el.id,
          start: { x: startX, y: wy },
          end: { x: endX, y: wy },
        };
        capture(e.pointerId);
      } else if (isBoxKind(k)) {
        // Cerobong (chimney) wajib nongol di puncak bangunan — default
        // "Lantai dasar" ke rooftop (bila dak diaktifkan) atau lantai
        // reguler teratas, bukan tapak (yang bikin cerobong terkubur di
        // dalam massa bangunan). Kind lain tidak diubah.
        const chimneyFloorId =
          k === "chimney"
            ? (layout.floors.find(isRooftopFloor)?.id ??
              topRegularFloorId(layout.floors) ??
              undefined)
            : undefined;
        const el = makeBoxElement(k, round2(wx), round2(wy), {
          ...(chimneyFloorId ? { floorId: chimneyFloorId } : {}),
        });
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: 0,
          offY: 0,
        };
        capture(e.pointerId);
      } else if (k === "portal_frame" || k === "gable_frame") {
        const el =
          k === "gable_frame"
            ? makeGableFrameElement(round2(wx), round2(wy))
            : makeFrameElement(round2(wx), round2(wy));
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: 0,
          offY: 0,
        };
        capture(e.pointerId);
      } else if (k === "exterior_stair") {
        const el = makeStairElement(round2(wx), round2(wy));
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: 0,
          offY: 0,
        };
        capture(e.pointerId);
      } else if (isSurfaceKind(k)) {
        const size = 1.5;
        const el = makeSurfaceElement(k, [
          { x: round2(wx), y: round2(wy) },
          { x: round2(wx + size), y: round2(wy) },
          { x: round2(wx + size / 2), y: round2(wy + size) },
        ]);
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: 0,
          offY: 0,
        };
        capture(e.pointerId);
      } else if (isAssetKind(k)) {
        const envelope = defaultAssetEnvelope(k);
        const el = makeAssetElement(
          k as "asset" | "plant" | "tree" | "exterior_decor" | "vehicle",
          round2(wx),
          round2(wy),
          { modelUrl: null, modelAssetId: null, fitMode: "fit_envelope" },
          envelope,
        );
        addExteriorElement(el);
        selectObject(el.id);
        beginDrag();
        drag.current = {
          kind: "exteriorMove",
          id: el.id,
          offX: 0,
          offY: 0,
        };
        capture(e.pointerId);
      }
      return;
    }
    if (panning || e.button === 1) {
      drag.current = { kind: "pan", lastPx: e.clientX, lastPy: e.clientY };
      capture(e.pointerId);
      return;
    }
    if (tool === "stair") {
      const { wx, wy } = pointer(e);
      const id = useEditorStore.getState().addStairAt(round2(wx), round2(wy));
      if (id) {
        selectObject(id);
        beginDrag();
        drag.current = { kind: "resize", id, handle: "se" };
        capture(e.pointerId);
      }
      return;
    }
    if (tool === "select") selectObject(null);
  };

  const onHandleDown = (e: React.PointerEvent, handle: HandleId) => {
    // Room resize handles only ever render for a `selected` room; panning
    // (incl. readOnly, folded in above) already stops onRoomDown/onWallDown
    // etc. from ever selecting one, but guard directly too — narrowest fix.
    if (readOnly || !selectedRoom) return;
    e.stopPropagation();
    beginDrag();
    drag.current = { kind: "resize", id: selectedRoom.id, handle };
    capture(e.pointerId);
  };

  // Drag the deck rect border → move. Select-tool only; the whole gesture is one
  // undo entry via beginDrag()/live()/endDrag() (like onRoomDown).
  const onRooftopDeckDown = (e: React.PointerEvent) => {
    if (panning || tool !== "select") return;
    const area = layout.rooftopArea;
    if (!area) return;
    e.stopPropagation();
    const { wx, wy } = pointer(e);
    beginDrag();
    drag.current = {
      kind: "rooftopDeck",
      corner: null,
      offX: wx - area.x,
      offY: wy - area.y,
    };
    capture(e.pointerId);
  };

  const onRooftopHandleDown = (e: React.PointerEvent, corner: DeckCorner) => {
    if (panning || tool !== "select") return;
    e.stopPropagation();
    beginDrag();
    drag.current = { kind: "rooftopDeck", corner, offX: 0, offY: 0 };
    capture(e.pointerId);
  };

  const onRoofZoneDown = (e: React.PointerEvent, zone: RoofZone) => {
    if (panning) return;
    e.stopPropagation();
    selectObject(zone.id);
    if (tool !== "select" && tool !== "roofZone") return;
    const { wx, wy } = pointer(e);
    beginDrag();
    drag.current = {
      kind: "roofZoneMove",
      id: zone.id,
      offX: wx - zone.x,
      offY: wy - zone.y,
    };
    capture(e.pointerId);
  };

  const onRoofZoneHandleDown = (
    e: React.PointerEvent,
    zone: RoofZone,
    handle: HandleId,
  ) => {
    if (panning || tool !== "select") return;
    e.stopPropagation();
    selectObject(zone.id);
    beginDrag();
    drag.current = { kind: "roofZoneResize", id: zone.id, handle };
    capture(e.pointerId);
  };

  const onSkylightDown = (e: React.PointerEvent, id: string, x: number, y: number) => {
    if (panning) return;
    e.stopPropagation();
    select({ kind: "skylight", id });
    if (tool !== "select") return;
    const { wx, wy } = pointer(e);
    beginDrag();
    drag.current = { kind: "skylightMove", id, offX: wx - x, offY: wy - y };
    capture(e.pointerId);
  };

  const onCourtyardDown = (
    e: React.PointerEvent,
    roomId: string,
    rect: { x: number; y: number; width: number; depth: number },
  ) => {
    if (panning) return;
    e.stopPropagation();
    selectObject(roomId);
    if (tool !== "select") return;
    const { wx, wy } = pointer(e);
    beginDrag();
    drag.current = { kind: "courtyardMove", roomId, offX: wx - rect.x, offY: wy - rect.y };
    capture(e.pointerId);
  };

  const onCourtyardHandleDown = (
    e: React.PointerEvent,
    roomId: string,
    corner: DeckCorner,
  ) => {
    if (panning || tool !== "select") return;
    e.stopPropagation();
    beginDrag();
    drag.current = { kind: "courtyardResize", roomId, corner };
    capture(e.pointerId);
  };

  const onLadderDown = (e: React.PointerEvent) => {
    if (panning || tool !== "select") return;
    e.stopPropagation();
    beginDrag();
    drag.current = { kind: "ladderMove" };
    capture(e.pointerId);
  };

  const onUp = (e: React.PointerEvent) => {
    if (drag.current) {
      const kind = drag.current.kind;
      const isExteriorDrag =
        kind === "exteriorMove" ||
        kind === "exteriorResize" ||
        kind === "exteriorSegment";
      const isRoofZoneDrag =
        kind === "roofZoneMove" || kind === "roofZoneResize";
      if (drag.current.kind === "exteriorSegment") {
        // A jittery tap (finger drift of just a pixel or two during what the
        // user intended as a single tap — common on touchscreens) can, via
        // processMove above, collapse the segment back to near-zero length.
        // Check the FINAL result here and restore the default placement if so,
        // instead of leaving an invisible degenerate segment behind.
        const segmentId = drag.current.id;
        const liveLayout = useEditorStore.getState().layout;
        const el = liveLayout?.exteriorElements?.find(
          (element) => element.id === segmentId,
        );
        if (el && "start" in el && "end" in el) {
          const finalLength = segmentLength(el.start, el.end);
          if (finalLength < MIN_EXTERIOR_SEGMENT_LENGTH_M) {
            const length = segmentDefaultLengthM(el.kind);
            const maxStartX = site
              ? Math.max(0, site.widthM - length)
              : el.start.x;
            const startX = site
              ? Math.min(Math.max(el.start.x, 0), maxStartX)
              : el.start.x;
            const endX = site
              ? Math.min(startX + length, site.widthM)
              : el.start.x + length;
            dragExteriorTo(segmentId, {
              start: { x: round2(startX), y: el.start.y },
              end: { x: round2(endX), y: el.start.y },
            });
          }
        }
      }
      if (
        (kind === "move" || kind === "resize" || isExteriorDrag || isRoofZoneDrag) &&
        useEditorStore.getState()._dragPushed
      ) {
        track(
          kind.startsWith("exterior")
            ? "exterior_edited"
            : kind.startsWith("roofZone")
              ? "exterior_edited"
              : "room_edited",
          { kind },
        );
      }
      endDrag();
      drag.current = null;
      release(e.pointerId);
    }
    // Flush any pending rAF move
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingMove.current = null;
  };

  const onSvgContextMenu = (e: React.MouseEvent) => {
    if (!layout || !site) return;
    e.preventDefault();
    // readOnly: tidak ada menu klik-kanan (aksinya semua memutasi layout).
    if (readOnly) return;
    const { wx, wy } = pointer(e as unknown as React.PointerEvent);
    // Elemen DOM (exterior) yang meng-override untuk event ini menang; kalau
    // tidak, jatuh ke hit-test geometris (room/wall/opening/roofZone/skylight).
    const hit = ctxHitRef.current;
    const ref =
      hit && hit.token === e.timeStamp
        ? hit.ref
        : hitTestRef(wx, wy, {
            rooms,
            openings,
            roofZones,
            skylights: layout.skylights ?? [],
            atapLayer: floorId === ROOF_LAYER_ID,
          });
    ctxHitRef.current = null;
    if (ref) {
      if (ref.kind === "room") selectObject(ref.id);
      else select(ref);
    }
    setCtxRef(ref);
    setCtxPoint({ x: wx, y: wy });
    setMenuState({ open: true, x: e.clientX, y: e.clientY });
  };

  const menuItems = actionsForContext({
    ref: ctxRef,
    point: ctxPoint,
    layout,
    store: useEditorStore.getState(),
    openAddRoom: (rect) => setAddRoomRect(rect),
  });

  return (
    <>
    <svg
      ref={svgRef}
      onContextMenu={onSvgContextMenu}
      className={cn(
        "h-full w-full touch-none select-none bg-muted/30",
        panning
          ? "cursor-grab"
          : tool === "door" ||
              tool === "window" ||
              tool === "room" ||
              tool === "electrical" ||
              tool === "water" ||
              tool === "exterior" ||
              tool === "roofZone" ||
              tool === "stair"
            ? "cursor-copy"
            : "cursor-default",
      )}
      onPointerDown={onBackgroundDown}
      onPointerMove={scheduleMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      {/* Site boundary */}
      <rect
        x={toX(0)}
        y={toY(0)}
        width={site.widthM * pxPerMeter}
        height={site.depthM * pxPerMeter}
        className="fill-background stroke-foreground/40"
        strokeWidth={2}
      />
      {gridLines}

      {/* Layer Atap: footprint bangunan + ghost ruang lantai teratas
          (non-interaktif) sebagai referensi letak zona atap. */}
      {atapLayer && (
        <g pointerEvents="none" data-testid="atap-ghost-layer">
          {(() => {
            const fp = buildingFootprint(layout);
            if (fp.widthM <= 0 || fp.depthM <= 0) return null;
            return (
              <rect
                x={toX(fp.x0)}
                y={toY(fp.y0)}
                width={fp.widthM * pxPerMeter}
                height={fp.depthM * pxPerMeter}
                fill="none"
                className="stroke-muted-foreground/50"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
            );
          })()}
          {ghostRooms.map((room) => (
            <g key={`ghost-${room.id}`}>
              <rect
                x={toX(room.x)}
                y={toY(room.y)}
                width={room.width * pxPerMeter}
                height={room.depth * pxPerMeter}
                className="fill-muted/40 stroke-muted-foreground/40"
                strokeWidth={1}
              />
              <text
                x={toX(room.x + room.width / 2)}
                y={toY(room.y + room.depth / 2)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground/60"
                fontSize={10}
              >
                {room.name}
              </text>
            </g>
          ))}
        </g>
      )}

      {/* Ghost lantai INDUK saat lantai MEZZANINE aktif — outline redup
          ruang induk sebagai referensi non-interaktif (pola atap-ghost). */}
      {mezzParent && (
        <g pointerEvents="none" data-testid="mezz-ghost-layer">
          {(() => {
            const fp = buildingFootprint(layout);
            if (fp.widthM <= 0 || fp.depthM <= 0) return null;
            return (
              <rect
                x={toX(fp.x0)}
                y={toY(fp.y0)}
                width={fp.widthM * pxPerMeter}
                height={fp.depthM * pxPerMeter}
                fill="none"
                className="stroke-muted-foreground/50"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
            );
          })()}
          {mezzGhostRooms.map((room) => (
            <g key={`mezz-ghost-${room.id}`}>
              <rect
                x={toX(room.x)}
                y={toY(room.y)}
                width={room.width * pxPerMeter}
                height={room.depth * pxPerMeter}
                className="fill-muted/40 stroke-muted-foreground/40"
                strokeWidth={1}
              />
              <text
                x={toX(room.x + room.width / 2)}
                y={toY(room.y + room.depth / 2)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground/60"
                fontSize={10}
              >
                {room.name}
              </text>
            </g>
          ))}
        </g>
      )}

      {/* Indikator CANTILEVER (CB3): bila lantai AKTIF ber-offset, outline
          putus-putus amber di posisi TERGESER (bbox ruang lantai + offset) —
          menunjukkan ke mana massa menjorok. Non-interaktif. */}
      {!atapLayer &&
        activeFloorObj &&
        (() => {
          const off = floorOffset(activeFloorObj);
          if (off.dx === 0 && off.dy === 0) return null;
          const fr = layout.rooms.filter((r) => r.floorId === floorId);
          if (fr.length === 0) return null;
          let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
          for (const r of fr) {
            x0 = Math.min(x0, r.x);
            y0 = Math.min(y0, r.y);
            x1 = Math.max(x1, r.x + r.width);
            y1 = Math.max(y1, r.y + r.depth);
          }
          if (!(x1 > x0 && y1 > y0)) return null;
          return (
            <rect
              data-testid="cantilever-indicator"
              pointerEvents="none"
              x={toX(x0 + off.dx)}
              y={toY(y0 + off.dy)}
              width={(x1 - x0) * pxPerMeter}
              height={(y1 - y0) * pxPerMeter}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          );
        })()}

      {/* Rooms — memoized per room */}
      {rooms.map((room) => (
        <RoomRect
          key={room.id}
          room={room}
          selected={room.id === selectedId}
          hasIssue={markerIssues.has(room.id)}
          panning={panning}
          tool={tool}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={onRoomDown}
          zoneFill={roomZones(room)[0] ? zoneColor(roomZones(room)[0]) : null}
          elevationLabel={formatElevation(
            room.levelOffsetM ?? 0,
            dimensionUnit,
          )}
        />
      ))}

      {/* Cross-floor penetrations (stairs from other floors) — semi-transparent reference */}
      {showCrossFloorRooms &&
        !atapLayer &&
        layout.floors
          .filter((f) => f.id !== floorId)
          .flatMap((floor) =>
            layout.rooms
              .filter(
                (r) =>
                  r.floorId === floor.id &&
                  r.type === "tangga"
              )
              .map((stairRoom) => (
                <rect
                  key={`cross-floor-${stairRoom.id}`}
                  data-testid={`cross-floor-${stairRoom.id}`}
                  data-kind="cross-floor-stair"
                  x={toX(stairRoom.x)}
                  y={toY(stairRoom.y)}
                  width={stairRoom.width * pxPerMeter}
                  height={stairRoom.depth * pxPerMeter}
                  className="fill-gray-400 opacity-30 stroke-gray-600"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  pointerEvents="none"
                />
              ))
          )}

      {/* dashed boundaries between same-zone neighbours */}
      {rooms.flatMap((room) =>
        (["e", "s"] as const).flatMap((side) => {
          const nb = roomsAdjacentOnSide(
            room,
            side,
            rooms.filter((o) => o.id !== room.id),
          );
          if (!nb || !sharesZone(room, nb)) return [];
          const x1 = side === "e" ? toX(room.x + room.width) : toX(room.x);
          const y1 = side === "e" ? toY(room.y) : toY(room.y + room.depth);
          const x2 =
            side === "e" ? toX(room.x + room.width) : toX(room.x + room.width);
          const y2 =
            side === "e" ? toY(room.y + room.depth) : toY(room.y + room.depth);
          return [
            <line
              key={`open-${room.id}-${side}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="stroke-background"
              strokeWidth={2.5}
              strokeDasharray="5 4"
            />,
          ];
        }),
      )}

      {/* Dinding — hit-target seleksi 2D (PRD §10.6 / unifikasi P2). Hanya
          aktif pada tool select supaya alat pintu/jendela/listrik yang juga
          mengklik tepi ruang tidak tercuri event-nya. */}
      {tool === "select" &&
        rooms
          .filter((room) => !OPEN_TYPES.includes(room.type))
          .flatMap((room) =>
            (["n", "s", "w", "e"] as const).map((side) => {
              const x1 = toX(side === "e" ? room.x + room.width : room.x);
              const y1 = toY(side === "s" ? room.y + room.depth : room.y);
              const x2 = toX(side === "w" ? room.x : room.x + room.width);
              const y2 = toY(side === "n" ? room.y : room.y + room.depth);
              const isSel =
                selWallRoomId === room.id && selWallSide === side;
              return (
                <g key={`wall-${room.id}-${side}`}>
                  {isSel && (
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      className="stroke-primary"
                      strokeWidth={4}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  )}
                  <line
                    data-testid={`wall-hit-${room.id}-${side}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={12}
                    className="cursor-pointer"
                    pointerEvents="stroke"
                    onPointerDown={(e) => onWallDown(e, room, side)}
                  />
                </g>
              );
            }),
          )}

      {/* Openings — memoized per opening */}
      {openings.map((op) => (
        <OpeningLine
          key={op.id}
          op={op}
          selected={op.id === selectedId}
          rooms={rooms}
          toX={toX}
          toY={toY}
          tool={tool}
          onPointerDown={onOpeningDown}
          onHandleDown={onOpeningHandleDown}
        />
      ))}

      {/* Electrical points — memoized per marker */}
      {electrical.map((p) => (
        <ElectricalMarker
          key={p.id}
          point={p}
          selected={p.id === selectedId}
          toX={toX}
          toY={toY}
          onPointerDown={onElectricalDown}
        />
      ))}

      {/* Water points — memoized per marker */}
      {water.map((p) => (
        <WaterMarker
          key={p.id}
          point={p}
          selected={p.id === selectedId}
          toX={toX}
          toY={toY}
          onPointerDown={onWaterDown}
        />
      ))}

      {/* Sanitation land-objects (lot-scale, draggable, clamp to Site) */}
      {sanitationMarkers.map((m) => (
        <SanitationMarker
          key={m.obj.id}
          obj={m.obj}
          label={m.label}
          selected={m.obj.id === selectedId}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={(e) => onSanitationDown(e, m.sKind, m.ref, m.obj)}
        />
      ))}

      {/* Rooftop deck overlay — only on the rooftop floor with a partial deck rect */}
      {floorId === ROOFTOP_FLOOR_ID && layout.rooftopArea && (
        <RooftopDeckOverlay
          area={layout.rooftopArea}
          tool={tool}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onBodyDown={onRooftopDeckDown}
          onHandleDown={onRooftopHandleDown}
        />
      )}

      {/* Roof zones: explicit multi-roof massing layer. */}
      {roofZones.map((zone) => (
        <RoofZoneShape
          key={zone.id}
          zone={zone}
          selected={zone.id === selectedId}
          hasIssue={markerIssues.has(zone.id)}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={onRoofZoneDown}
        />
      ))}

      {/* Skylight — rect kaca pada bidang atap datar; digeser dgn auto-fit
          (mesin snap zona). Ukuran diatur di kartu skylight. */}
      {atapLayer &&
        (layout.skylights ?? []).map((sk) => {
          const selectedSk =
            selSkylightId === sk.id;
          return (
            <g
              key={sk.id}
              data-testid="skylight-rect"
              className={tool === "select" ? "cursor-move" : undefined}
              onPointerDown={(e) => onSkylightDown(e, sk.id, sk.x, sk.y)}
            >
              <rect
                x={toX(sk.x)}
                y={toY(sk.y)}
                width={sk.widthM * pxPerMeter}
                height={sk.depthM * pxPerMeter}
                rx={3}
                className={cn(
                  "fill-sky-400/30 stroke-sky-600",
                  selectedSk && "stroke-primary",
                )}
                strokeWidth={selectedSk ? 2.5 : 1.5}
              />
              <line
                x1={toX(sk.x)}
                y1={toY(sk.y)}
                x2={toX(sk.x + sk.widthM)}
                y2={toY(sk.y + sk.depthM)}
                className="pointer-events-none stroke-sky-600/60"
                strokeWidth={1}
              />
              <line
                x1={toX(sk.x + sk.widthM)}
                y1={toY(sk.y)}
                x2={toX(sk.x)}
                y2={toY(sk.y + sk.depthM)}
                className="pointer-events-none stroke-sky-600/60"
                strokeWidth={1}
              />
              <text
                x={toX(sk.x + sk.widthM / 2)}
                y={toY(sk.y) - 4}
                textAnchor="middle"
                className="pointer-events-none fill-sky-700 select-none"
                fontSize={9}
              >
                Skylight
              </text>
            </g>
          );
        })}

      {/* Courtyard (openToSky) — lubang atap yang DIATUR USER: geser badan,
          resize 4 handle sudut (pola deck rooftop); notasi ✕ = bukaan atap. */}
      {atapLayer &&
        courtyardRoofRooms(layout).map(({ roomId: cRoomId, rect: hole }) => (
          <CourtyardHoleShape
            key={`courtyard-${cRoomId}`}
            roomId={cRoomId}
            hole={hole}
            selected={selectedId === cRoomId}
            tool={tool}
            toX={toX}
            toY={toY}
            pxPerMeter={pxPerMeter}
            onBodyDown={onCourtyardDown}
            onHandleDown={onCourtyardHandleDown}
          />
        ))}

      {/* Marker tangga monyet (akses dak servis) — DRAGGABLE sepanjang
          sisinya (posM); render di atas zona supaya selalu bisa dipegang. */}
      {atapLayer &&
        layout.rooftopAccess?.kind === "tangga_monyet" &&
        (() => {
          const fp = buildingFootprint(layout);
          if (fp.widthM <= 0 || fp.depthM <= 0) return null;
          const side = layout.rooftopAccess.side;
          const horizontal = side === "n" || side === "s";
          const len = horizontal ? fp.widthM : fp.depthM;
          const posM = Math.min(
            Math.max(layout.rooftopAccess.posM ?? len / 2, 0.25),
            Math.max(0.25, len - 0.25),
          );
          const mx = horizontal
            ? fp.x0 + posM
            : side === "w"
              ? fp.x0
              : fp.x0 + fp.widthM;
          const my = horizontal
            ? side === "n"
              ? fp.y0
              : fp.y0 + fp.depthM
            : fp.y0 + posM;
          return (
            <g
              data-testid="atap-ladder-marker"
              className={tool === "select" ? "cursor-move" : undefined}
              onPointerDown={onLadderDown}
            >
              <rect
                x={toX(mx) - 8}
                y={toY(my) - 8}
                width={16}
                height={16}
                rx={3}
                className="fill-amber-500/30 stroke-amber-600"
                strokeWidth={1.5}
              />
              {/* Gigi anak tangga (glyph) */}
              {[-4, 0, 4].map((o) => (
                <line
                  key={o}
                  x1={toX(mx) + (horizontal ? o : -5)}
                  y1={toY(my) + (horizontal ? -5 : o)}
                  x2={toX(mx) + (horizontal ? o : 5)}
                  y2={toY(my) + (horizontal ? 5 : o)}
                  className="stroke-amber-600"
                  strokeWidth={1.2}
                />
              ))}
              <text
                x={toX(mx)}
                y={toY(my) + (side === "n" ? -13 : 20)}
                textAnchor="middle"
                className="fill-amber-700 select-none"
                fontSize={9}
              >
                Tangga monyet
              </text>
            </g>
          );
        })()}

      {/* Exterior elements: site-level elements show on every floor; floor-owned elements only on their floor. */}
      {exteriorElements.map((el) => (
        <g
          key={el.id}
          onContextMenu={(e) => {
            ctxHitRef.current = {
              ref: { kind: "exterior", id: el.id },
              token: e.timeStamp,
            };
          }}
        >
          <ExteriorElementShape
            element={el}
            selected={el.id === selectedId}
            toX={toX}
            toY={toY}
            pxPerMeter={pxPerMeter}
            onPointerDown={onExteriorDown}
          />
        </g>
      ))}
      {exteriorElements
        ?.filter((el) => el.id === selectedId && !el.locked)
        .map((el) => (
          <ExteriorSelectionHandles
            key={`handles-${el.id}`}
            element={el}
            toX={toX}
            toY={toY}
            pxPerMeter={pxPerMeter}
            onHandleDown={onExteriorHandleDown}
          />
        ))}

      {selectedRoofZone && (
        <g>
          {RESIZE_HANDLES.map((h) => {
            const p = handlePoint(
              {
                x: selectedRoofZone.x - selectedRoofZone.widthM / 2,
                y: selectedRoofZone.y - selectedRoofZone.depthM / 2,
                width: selectedRoofZone.widthM,
                depth: selectedRoofZone.depthM,
              },
              h,
            );
            return (
              <rect
                key={`roof-zone-${h}`}
                x={toX(p.x) - 4}
                y={toY(p.y) - 4}
                width={8}
                height={8}
                className="cursor-pointer fill-background stroke-primary"
                data-testid="roof-zone-handle"
                strokeWidth={1.5}
                style={{ cursor: handleCursor(h) }}
                onPointerDown={(e) =>
                  onRoofZoneHandleDown(e, selectedRoofZone, h)
                }
              />
            );
          })}
          <text
            x={toX(selectedRoofZone.x)}
            y={toY(selectedRoofZone.y - selectedRoofZone.depthM / 2) - 8}
            textAnchor="middle"
            className="pointer-events-none fill-primary text-[10px] font-medium"
          >
            {formatLength(selectedRoofZone.widthM, dimensionUnit)} ×{" "}
            {formatLength(selectedRoofZone.depthM, dimensionUnit)}
          </text>
        </g>
      )}

      {/* Warning markers */}
      {rooms
        .filter((r) => markerIssues.has(r.id))
        .map((room) => (
          <WarningMarker
            key={`warn-${room.id}`}
            room={room}
            issues={markerIssues.get(room.id) ?? []}
            toX={toX}
            toY={toY}
            onFocusRoom={(roomId) => roomId && selectObject(roomId)}
          />
        ))}

      {/* Dimension overlay (architectural) */}
      {showDimensions && (
        <DimensionLayer
          rooms={rooms}
          site={site}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          unit={dimensionUnit}
        />
      )}

      {/* Selection handles */}
      {selectedRoom && !selectedRoom.locked && (
        <g>
          {RESIZE_HANDLES.map((h) => {
            const p = handlePoint(
              {
                x: selectedRoom.x,
                y: selectedRoom.y,
                width: selectedRoom.width,
                depth: selectedRoom.depth,
              },
              h,
            );
            return (
              <rect
                key={h}
                x={toX(p.x) - 4}
                y={toY(p.y) - 4}
                width={8}
                height={8}
                className="cursor-pointer fill-background stroke-primary"
                strokeWidth={1.5}
                style={{ cursor: handleCursor(h) }}
                onPointerDown={(e) => onHandleDown(e, h)}
              />
            );
          })}
          <text
            x={toX(selectedRoom.x + selectedRoom.width / 2)}
            y={toY(selectedRoom.y) - 6}
            textAnchor="middle"
            className="pointer-events-none fill-primary text-[10px] font-medium"
          >
            {formatLength(selectedRoom.width, dimensionUnit)}
          </text>
          <text
            x={toX(selectedRoom.x) - 6}
            y={toY(selectedRoom.y + selectedRoom.depth / 2)}
            textAnchor="end"
            className="pointer-events-none fill-primary text-[10px] font-medium"
          >
            {formatLength(selectedRoom.depth, dimensionUnit)}
          </text>
        </g>
      )}

      {/* Alignment guides (transient, during drag) */}
      <g pointerEvents="none">
        {[
          ...alignmentGuides.x.map((v) => ({ v, equal: false })),
          ...alignmentGuides.equalX.map((v) => ({ v, equal: true })),
        ].map(({ v, equal }, i) => (
          <g key={`gx-${i}`}>
            <line
              x1={toX(v)}
              y1={toY(0)}
              x2={toX(v)}
              y2={toY(site.depthM)}
              stroke="#e11d80"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {equal && (
              <text
                x={toX(v) + 3}
                y={toY(0) + 12}
                fontSize={11}
                fontWeight={700}
                fill="#e11d80"
              >
                =
              </text>
            )}
          </g>
        ))}
        {[
          ...alignmentGuides.y.map((v) => ({ v, equal: false })),
          ...alignmentGuides.equalY.map((v) => ({ v, equal: true })),
        ].map(({ v, equal }, i) => (
          <g key={`gy-${i}`}>
            <line
              x1={toX(0)}
              y1={toY(v)}
              x2={toX(site.widthM)}
              y2={toY(v)}
              stroke="#e11d80"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {equal && (
              <text
                x={toX(0) + 3}
                y={toY(v) - 3}
                fontSize={11}
                fontWeight={700}
                fill="#e11d80"
              >
                =
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
      <EditorCursorMenu state={menuState} items={menuItems} onClose={closeMenu} />
      <AddRoomAtDialog rect={addRoomRect} onClose={() => setAddRoomRect(null)} />
    </>
  );
}

type HitRoom = { id: string; x: number; y: number; width: number; depth: number };

/** Hit-test klik-kanan 2D: titik (m) → entity di bawah kursor pada layer aktif.
 *  Layer Atap: skylight (pojok) lalu roofZone (pusat). Layer lantai: opening
 *  (dekat tengah bukaan) → wall (dekat tepi ruang) → room (di dalam). */
function hitTestRef(
  wx: number,
  wy: number,
  ctx: {
    rooms: ReadonlyArray<HitRoom>;
    openings: ReadonlyArray<{ id: string; wallId: string; positionM: number; widthM: number }>;
    roofZones: ReadonlyArray<{ id: string; x: number; y: number; widthM: number; depthM: number }>;
    skylights: ReadonlyArray<{ id: string; x: number; y: number; widthM: number; depthM: number }>;
    atapLayer: boolean;
  },
): EntityRef | null {
  if (ctx.atapLayer) {
    for (let i = ctx.skylights.length - 1; i >= 0; i--) {
      const s = ctx.skylights[i];
      if (wx >= s.x && wx <= s.x + s.widthM && wy >= s.y && wy <= s.y + s.depthM)
        return { kind: "skylight", id: s.id };
    }
    for (let i = ctx.roofZones.length - 1; i >= 0; i--) {
      const z = ctx.roofZones[i];
      if (
        wx >= z.x - z.widthM / 2 &&
        wx <= z.x + z.widthM / 2 &&
        wy >= z.y - z.depthM / 2 &&
        wy <= z.y + z.depthM / 2
      )
        return { kind: "roofZone", id: z.id };
    }
    return null;
  }

  // Opening: dekat titik-tengah bukaan (bukaan menempel di dinding).
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r]));
  for (const op of ctx.openings) {
    const [roomId, side] = op.wallId.split(":") as [string, Side];
    const room = roomById.get(roomId);
    if (!room) continue;
    const seg = openingSegment(room as never, side, op.positionM, op.widthM);
    const mx = (seg.x1 + seg.x2) / 2;
    const my = (seg.y1 + seg.y2) / 2;
    if (Math.abs(wx - mx) <= 0.35 && Math.abs(wy - my) <= 0.35)
      return { kind: "opening", id: op.id };
  }

  const tol = 0.3;
  for (let i = ctx.rooms.length - 1; i >= 0; i--) {
    const r = ctx.rooms[i];
    if (wx < r.x - tol || wx > r.x + r.width + tol) continue;
    if (wy < r.y - tol || wy > r.y + r.depth + tol) continue;
    const insideCore =
      wx > r.x + tol &&
      wx < r.x + r.width - tol &&
      wy > r.y + tol &&
      wy < r.y + r.depth - tol;
    if (!insideCore) {
      const dW = Math.abs(wx - r.x);
      const dE = Math.abs(wx - (r.x + r.width));
      const dN = Math.abs(wy - r.y);
      const dS = Math.abs(wy - (r.y + r.depth));
      const m = Math.min(dW, dE, dN, dS);
      if (m <= tol) {
        const side: Side = m === dW ? "w" : m === dE ? "e" : m === dN ? "n" : "s";
        return { kind: "wall", roomId: r.id, side };
      }
    }
    if (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.depth) {
      return { kind: "room", id: r.id };
    }
  }
  return null;
}

function handleCursor(h: HandleId): string {
  if (h === "n" || h === "s") return "ns-resize";
  if (h === "e" || h === "w") return "ew-resize";
  if (h === "nw" || h === "se") return "nwse-resize";
  return "nesw-resize";
}

function openingResizeCursor(side: Side): string {
  return side === "n" || side === "s" ? "ew-resize" : "ns-resize";
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}

/** Snap a metre value to the nearest 0.1 m (deck drag/resize granularity). */
function snap01(v: number): number {
  return Math.round(v * 10) / 10;
}

export function resizeOpeningAlongWall(
  room: Room,
  side: Side,
  op: Pick<Opening, "positionM" | "widthM">,
  endpoint: OpeningEndpoint,
  pointerAlongM: number,
  minWidthM = 0.2,
): { positionM: number; widthM: number } {
  const len = side === "n" || side === "s" ? room.width : room.depth;
  const half = op.widthM / 2;
  const center = clamp(op.positionM, half, Math.max(half, len - half));
  let start = center - half;
  let end = center + half;

  if (endpoint === "start") {
    start = clamp(pointerAlongM, 0, Math.max(0, end - minWidthM));
  } else {
    end = clamp(pointerAlongM, Math.min(len, start + minWidthM), len);
  }

  const width = Math.max(minWidthM, end - start);
  return {
    positionM: round2((start + end) / 2),
    widthM: round2(width),
  };
}

export function moveOpeningAlongWall(
  room: Room,
  side: Side,
  op: Pick<Opening, "widthM">,
  centerAlongM: number,
): { positionM: number; widthM: number } {
  const len = side === "n" || side === "s" ? room.width : room.depth;
  const width = clamp(op.widthM, 0.2, len);
  const half = width / 2;
  return {
    positionM: round2(clamp(centerAlongM, half, Math.max(half, len - half))),
    widthM: round2(width),
  };
}

/**
 * Recompute a deck rect while dragging one corner to `(sx, sy)`, keeping the
 * opposite corner fixed. The local floor matches the store's real minimum
 * (`MIN_DECK_M`, 1.5 m) so the overlay doesn't visibly "stick" between 0.5 and
 * 1.5 m while `clampRooftopArea` re-clamps; the store still enforces footprint
 * containment.
 */
function exteriorHandleToString(
  h: ExteriorHandle,
): string {
  if (h.kind === "endpoint") return h.which;
  if (h.kind === "vertex") return `v${h.index}`;
  return h.corner;
}

function resizeDeckRect(
  area: { x: number; y: number; width: number; depth: number },
  corner: DeckCorner,
  sx: number,
  sy: number,
  min = MIN_DECK_M,
): { x: number; y: number; width: number; depth: number } {
  const x0 = area.x;
  const y0 = area.y;
  const x1 = area.x + area.width;
  const y1 = area.y + area.depth;
  let nx0 = x0;
  let ny0 = y0;
  let nx1 = x1;
  let ny1 = y1;
  if (corner === "nw") {
    nx0 = Math.min(sx, x1 - min);
    ny0 = Math.min(sy, y1 - min);
  } else if (corner === "ne") {
    nx1 = Math.max(sx, x0 + min);
    ny0 = Math.min(sy, y1 - min);
  } else if (corner === "sw") {
    nx0 = Math.min(sx, x1 - min);
    ny1 = Math.max(sy, y0 + min);
  } else {
    nx1 = Math.max(sx, x0 + min);
    ny1 = Math.max(sy, y0 + min);
  }
  return { x: nx0, y: ny0, width: nx1 - nx0, depth: ny1 - ny0 };
}
