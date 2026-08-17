"use client";

import * as React from "react";
import type {
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
} from "@/types";
import { cn } from "@/lib/utils";

export type ExteriorHandle =
  | { kind: "endpoint"; which: "start" | "end" }
  | { kind: "vertex"; index: number }
  | {
      kind: "resize";
      corner: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
    };

const HANDLE_SIZE = 8;

/**
 * Lebar minimum GARIS HIT-TEST (px) untuk elemen segmen (pagar/tembok/
 * gerbang), lepas dari ketebalan visual asli elemen. Sebelumnya strokeWidth
 * yang dipakai utk RENDER (min 2px) juga dipakai apa adanya utk hit-test —
 * segmen yang tipis (mis. pagar 0,05 m) jadi nyaris tak bisa diklik ulang,
 * apalagi diagonal. `MIN_HIT_STROKE_PX` menjaga target klik tetap nyaman
 * (~garis tebal 8px) tanpa mengubah tampilan visual elemen sama sekali —
 * lihat garis hit-test transparan terpisah di bawah.
 */
const MIN_HIT_STROKE_PX = 8;

function exteriorFill(kind: ExteriorElement["kind"]): string {
  switch (kind) {
    case "boundary_wall":
    case "solid_wall":
      return "fill-stone/20";
    case "fence":
      return "fill-muted/20";
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      return "fill-warning/15";
    case "driveway":
      return "fill-muted/40";
    case "walkway":
      return "fill-muted/25";
    case "terrace_surface":
      return "fill-primary/15";
    case "garden_bed":
      return "fill-success/20";
    case "column":
    case "chimney":
    case "beam":
    case "slab":
    case "overhang_slab":
      return "fill-stone/25";
    case "canopy":
      return "fill-primary/20";
    case "planter":
      return "fill-success/15";
    case "pergola":
      return "fill-stone/15";
    case "facade_panel":
      return "fill-accent/15";
    case "portal_frame":
      return "fill-background/30";
    case "exterior_stair":
      return "fill-stone/20";
    case "asset":
      return "fill-info/15";
    default:
      return "fill-muted/15";
  }
}

function exteriorStroke(kind: ExteriorElement["kind"]): string {
  switch (kind) {
    case "boundary_wall":
    case "solid_wall":
      return "stroke-stone";
    case "fence":
      return "stroke-muted-foreground";
    case "sliding_gate":
    case "swing_gate":
    case "pedestrian_gate":
      return "stroke-warning";
    case "driveway":
    case "walkway":
    case "terrace_surface":
      return "stroke-foreground/50";
    case "garden_bed":
      return "stroke-success";
    case "column":
    case "chimney":
    case "beam":
    case "slab":
    case "overhang_slab":
      return "stroke-stone";
    case "canopy":
      return "stroke-primary";
    case "planter":
      return "stroke-success";
    case "pergola":
      return "stroke-stone";
    case "facade_panel":
      return "stroke-accent";
    case "portal_frame":
      return "stroke-foreground";
    case "exterior_stair":
      return "stroke-stone";
    case "asset":
      return "stroke-info";
    default:
      return "stroke-foreground/60";
  }
}

function rotateTransform(x: number, y: number, rotationDeg: number): string {
  return `rotate(${rotationDeg}, ${x}, ${y})`;
}

export function ExteriorElementShape({
  element,
  selected,
  toX,
  toY,
  pxPerMeter,
  onPointerDown,
}: {
  element: ExteriorElement;
  selected: boolean;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onPointerDown: (e: React.PointerEvent, el: ExteriorElement) => void;
}) {
  const common = cn(
    "cursor-pointer",
    exteriorFill(element.kind),
    exteriorStroke(element.kind),
    selected ? "stroke-primary" : undefined,
  );
  const strokeWidth = selected ? 3 : 2;

  if (element.kind === "exterior_stair") {
    const el = element as ExteriorStairElement;
    const x = toX(el.x);
    const y = toY(el.y);
    const w = el.widthM * pxPerMeter;
    const runPx = el.lengthM * pxPerMeter;
    const dir = el.direction;
    const dx = dir === "e" ? runPx : dir === "w" ? -runPx : 0;
    const dy = dir === "s" ? -runPx : dir === "n" ? runPx : 0;
    const steps = Math.max(
      1,
      Math.round(el.lengthM / Math.max(0.15, el.riseM)),
    );
    return (
      <g
        data-testid="exterior-element"
        data-kind={element.kind}
        onPointerDown={(e) => onPointerDown(e, element)}
      >
        <rect
          x={x}
          y={y}
          width={Math.abs(dx) || w}
          height={Math.abs(dy) || w}
          className={common}
          strokeWidth={strokeWidth}
        />
        {Array.from({ length: steps + 1 }).map((_, i) => {
          const t = i / steps;
          return (
            <line
              key={i}
              x1={x + (dx ? dx * t : 0)}
              y1={y + (dy ? dy * t : 0)}
              x2={x + (dx ? dx * t : 0) + (dx ? 0 : w)}
              y2={y + (dy ? dy * t : 0) + (dy ? 0 : w)}
              className={cn(
                "stroke-foreground/60",
                selected && "stroke-primary",
              )}
              strokeWidth={1}
            />
          );
        })}
      </g>
    );
  }

  if ("points" in element) {
    const el = element as ExteriorSurfaceElement;
    const d = el.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.x)} ${toY(p.y)}`)
      .join(" ");
    return (
      <path
        data-testid="exterior-element"
        data-kind={element.kind}
        d={`${d} Z`}
        className={common}
        strokeWidth={strokeWidth}
        strokeDasharray={el.kind === "garden_bed" ? "4 3" : undefined}
        onPointerDown={(e) => onPointerDown(e, element)}
      />
    );
  }

  if ("start" in element && "end" in element) {
    const el = element as ExteriorSegmentElement;
    const visualStrokeWidth = Math.max(2, (el.thicknessM ?? 0.2) * pxPerMeter);
    const hitStrokeWidth = Math.max(MIN_HIT_STROKE_PX, visualStrokeWidth);
    return (
      // onPointerDown di `<g>` (bukan di garis) — klik pada garis VISUAL
      // (tipis, tampilan asli) maupun garis HIT-TEST (transparan, lebih
      // lebar) sama-sama bubble ke handler yang sama satu kali.
      <g
        data-testid="exterior-element"
        data-kind={element.kind}
        onPointerDown={(e) => onPointerDown(e, element)}
      >
        <line
          x1={toX(el.start.x)}
          y1={toY(el.start.y)}
          x2={toX(el.end.x)}
          y2={toY(el.end.y)}
          className={common}
          strokeWidth={visualStrokeWidth}
          strokeLinecap="round"
        />
        {/* Garis hit-test — transparan, ikut di atas garis visual (paint
            order) supaya lebar klik minimum ~8px berlaku terlepas dari
            ketebalan asli elemen. `strokeOpacity=0` (bukan `stroke="none"`)
            supaya SVG tetap menganggapnya "painted" utk hit-testing. */}
        <line
          data-testid="exterior-element-hit"
          x1={toX(el.start.x)}
          y1={toY(el.start.y)}
          x2={toX(el.end.x)}
          y2={toY(el.end.y)}
          stroke="currentColor"
          strokeOpacity={0}
          strokeWidth={hitStrokeWidth}
          strokeLinecap="round"
          className="cursor-pointer"
        />
      </g>
    );
  }

  if (element.kind === "portal_frame") {
    const el = element as ExteriorFrameElement;
    const cx = toX(el.x);
    const cy = toY(el.y);
    const ow = el.widthM * pxPerMeter;
    const oh = el.heightM * pxPerMeter;
    const member = el.memberSizeM * pxPerMeter;
    const rotationDeg = el.rotationDeg ?? 0;
    const transform = rotateTransform(cx + ow / 2, cy + oh / 2, rotationDeg);
    return (
      <g
        data-testid="exterior-element"
        data-kind={element.kind}
        transform={transform}
        onPointerDown={(e) => onPointerDown(e, element)}
      >
        <rect
          x={cx}
          y={cy}
          width={ow}
          height={oh}
          fill="none"
          className={common}
          strokeWidth={strokeWidth}
        />
        <rect
          x={cx + member}
          y={cy + member}
          width={Math.max(0, ow - member * 2)}
          height={Math.max(0, oh - member * 2)}
          fill="none"
          className={cn("stroke-foreground/40", selected && "stroke-primary")}
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      </g>
    );
  }

  if ("x" in element && "y" in element) {
    const el = element as ExteriorBoxElement;
    const x = toX(el.x - el.widthM / 2);
    const y = toY(el.y - el.depthM / 2);
    const w = el.widthM * pxPerMeter;
    const h = el.depthM * pxPerMeter;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rotationDeg = el.rotationDeg ?? 0;
    const transform = rotateTransform(cx, cy, rotationDeg);
    return (
      <rect
        data-testid="exterior-element"
        data-kind={element.kind}
        x={x}
        y={y}
        width={w}
        height={h}
        transform={transform}
        className={common}
        strokeWidth={strokeWidth}
        onPointerDown={(e) => onPointerDown(e, element)}
      />
    );
  }

  return null;
}

export function ExteriorSelectionHandles({
  element,
  toX,
  toY,
  pxPerMeter,
  onHandleDown,
}: {
  element: ExteriorElement;
  toX: (m: number) => number;
  toY: (m: number) => number;
  pxPerMeter: number;
  onHandleDown: (
    e: React.PointerEvent,
    el: ExteriorElement,
    handle: ExteriorHandle,
  ) => void;
}) {
  const handle = (cx: number, cy: number, h: ExteriorHandle, cursor: string) => (
    <rect
      key={JSON.stringify(h)}
      data-testid="exterior-handle"
      x={cx - HANDLE_SIZE / 2}
      y={cy - HANDLE_SIZE / 2}
      width={HANDLE_SIZE}
      height={HANDLE_SIZE}
      className="fill-background stroke-primary"
      strokeWidth={1.5}
      style={{ cursor }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onHandleDown(e, element, h);
      }}
    />
  );

  if ("start" in element && "end" in element) {
    const el = element as ExteriorSegmentElement;
    return (
      <g>
        {handle(toX(el.start.x), toY(el.start.y), { kind: "endpoint", which: "start" }, "move")}
        {handle(toX(el.end.x), toY(el.end.y), { kind: "endpoint", which: "end" }, "move")}
      </g>
    );
  }

  if (element.kind === "portal_frame") {
    const el = element as ExteriorFrameElement;
    const cx = toX(el.x);
    const cy = toY(el.y);
    const ow = el.widthM * pxPerMeter;
    const oh = el.heightM * pxPerMeter;
    const rotationDeg = el.rotationDeg ?? 0;
    const transform = rotateTransform(cx + ow / 2, cy + oh / 2, rotationDeg);
    return (
      <g transform={transform}>
        {handle(cx, cy, { kind: "resize", corner: "nw" }, "nwse-resize")}
        {handle(cx + ow, cy, { kind: "resize", corner: "ne" }, "nesw-resize")}
        {handle(cx, cy + oh, { kind: "resize", corner: "sw" }, "nesw-resize")}
        {handle(cx + ow, cy + oh, { kind: "resize", corner: "se" }, "nwse-resize")}
      </g>
    );
  }

  if ("points" in element) {
    const el = element as ExteriorSurfaceElement;
    return (
      <g>
        {el.points.map((point, index) =>
          handle(toX(point.x), toY(point.y), { kind: "vertex", index }, "move"),
        )}
      </g>
    );
  }

  if (element.kind === "exterior_stair") {
    const el = element as ExteriorStairElement;
    const minXM = el.direction === "w" ? el.x - el.lengthM : el.x;
    const maxXM =
      el.direction === "e" ? el.x + el.lengthM : el.direction === "w" ? el.x : el.x + el.widthM;
    const minYM = el.direction === "s" ? el.y - el.lengthM : el.y;
    const maxYM =
      el.direction === "n" ? el.y + el.lengthM : el.direction === "s" ? el.y : el.y + el.widthM;
    const minX = toX(Math.min(minXM, maxXM));
    const maxX = toX(Math.max(minXM, maxXM));
    const minY = toY(Math.min(minYM, maxYM));
    const maxY = toY(Math.max(minYM, maxYM));
    return (
      <g>
        {handle(minX, minY, { kind: "resize", corner: "nw" }, "nwse-resize")}
        {handle(maxX, minY, { kind: "resize", corner: "ne" }, "nesw-resize")}
        {handle(minX, maxY, { kind: "resize", corner: "sw" }, "nesw-resize")}
        {handle(maxX, maxY, { kind: "resize", corner: "se" }, "nwse-resize")}
      </g>
    );
  }

  if ("x" in element && "y" in element) {
    const el = element as ExteriorBoxElement;
    const x = toX(el.x - el.widthM / 2);
    const y = toY(el.y - el.depthM / 2);
    const w = el.widthM * pxPerMeter;
    const h = el.depthM * pxPerMeter;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rotationDeg = el.rotationDeg ?? 0;
    const transform = rotateTransform(cx, cy, rotationDeg);
    return (
      <g transform={transform}>
        {handle(x, y, { kind: "resize", corner: "nw" }, "nwse-resize")}
        {handle(x + w, y, { kind: "resize", corner: "ne" }, "nesw-resize")}
        {handle(x, y + h, { kind: "resize", corner: "sw" }, "nesw-resize")}
        {handle(x + w, y + h, { kind: "resize", corner: "se" }, "nwse-resize")}
      </g>
    );
  }

  return null;
}
