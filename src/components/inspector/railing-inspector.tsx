"use client";

/**
 * RailingInspector terpadu (unifikasi P2) — migrasi dari `RailingQuickEditor`
 * 3D. Menangani DUA konteks yang dulunya field terpisah:
 * - Railing balkon (per-Room: `railingStyle`/`railingModelUrl`).
 * - Railing dak rooftop (per-layout: `rooftopRailingStyle` — dak bukan Room,
 *   diseleksi via sentinel ROOFTOP_RAIL_ID di slot roomId EntityRef).
 * Dua jalur render:
 * - `RailingInspectorCard` via registry saat kind === "railing" (klik mesh
 *   railing di 3D; juga tampil di panel 2D berkat seleksi terpadu).
 * - `RailingRoomContextCard` (mount 3D): perilaku implisit lama — memilih
 *   RUANG balkon, atau ruang apa pun di floor-rooftop, juga memunculkan kartu
 *   (mesh railing tipis susah di-tap, penting utk tablet).
 */

import * as React from "react";
import { Library, X } from "lucide-react";

import type { RailingStyle, Room } from "@/types";
import { ROOFTOP_RAIL_ID } from "@/lib/three/build-model";
import { useEditorStore } from "@/stores/editor-store";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NumField, SegmentedControl } from "./fields";
import type { InspectorSurface } from "./registry";

const RAILING_STYLE_OPTIONS: ReadonlyArray<{
  value: RailingStyle;
  label: string;
  description: string;
}> = [
  { value: "kaca", label: "Kaca", description: "Panel kaca + handrail aluminium (modern)" },
  { value: "besi", label: "Besi", description: "Baluster vertikal ramping" },
  { value: "tembok", label: "Tembok", description: "Parapet solid — bisa di-cladding" },
  { value: "kayu", label: "Kayu", description: "Bilah horizontal + tiang kayu" },
];

type RailingCtx =
  | { kind: "room"; room: Room }
  | { kind: "rooftop" };

function RailingCardInner({ ctx }: { ctx: RailingCtx; surface: InspectorSurface }) {
  const layout = useEditorStore((s) => s.layout);
  const updateRoom = useEditorStore((s) => s.updateRoom);
  const setRooftopRailingStyle = useEditorStore((s) => s.setRooftopRailingStyle);
  const setRooftopRailingModel = useEditorStore((s) => s.setRooftopRailingModel);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  if (!layout) return null;

  const isRooftop = ctx.kind === "rooftop";
  const room = ctx.kind === "room" ? ctx.room : undefined;
  const hasCustomModel = isRooftop
    ? !!layout.rooftopRailingModelUrl
    : !!room!.railingModelUrl;
  // Default gaya: balkon "kaca"; void "besi" (aman-anak utk lubang lantai —
  // konsisten dgn build-model & RoomInspector).
  const fallback: RailingStyle = room?.type === "void" ? "besi" : "kaca";
  const current: RailingStyle = isRooftop
    ? (layout.rooftopRailingStyle ?? "kaca")
    : (room!.railingStyle ?? fallback);

  const applyStyle = (style: RailingStyle) => {
    if (isRooftop) setRooftopRailingStyle(style);
    else
      // Memilih gaya bawaan sekaligus MELEPAS model GLB kustom.
      updateRoom(room!.id, {
        railingStyle: style,
        railingModelUrl: null,
        railingModelAssetId: null,
      });
  };

  return (
    <div
      className="space-y-2.5 rounded-lg border border-primary/40 bg-background p-3"
      data-testid="railing-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            Railing — {isRooftop ? "Dak Rooftop" : room!.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {isRooftop
              ? "Model pengaman keliling dak rooftop"
              : "Model pengaman sisi terbuka"}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor railing"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <SegmentedControl
        value={hasCustomModel ? null : current}
        onChange={applyStyle}
        options={RAILING_STYLE_OPTIONS}
        columns={2}
        ariaLabel="Gaya railing"
      />

      {/* Tepi depan MELENGKUNG — hanya balkon (bukan void/rooftop): pelat
          lantai & railing sisi paling menjorok keluar dibentuk jadi busur
          low-poly (lihat bowFloorStrips/bowRailSegments di
          geometry/balcony-bow.ts). 0/kosong = lurus (jalur lama). */}
      {!isRooftop && room!.type === "balkon" && (
        <NumField
          label="Lengkung tepi (m)"
          value={room!.edgeBowM ?? 0}
          min={0}
          max={1.5}
          step={0.1}
          onCommit={(v) =>
            updateRoom(room!.id, { edgeBowM: Number.isFinite(v) ? Math.min(Math.max(v, 0), 1.5) : 0 })
          }
        />
      )}

      {/* Model GLB kustom dari library — balkon DAN dak rooftop (di-tile
          keliling perimeter dak / sisi terbuka balkon). */}
      <div
        className={cn(
          "space-y-1.5 rounded-md border px-2 py-2",
          hasCustomModel && "border-primary bg-primary/10",
        )}
      >
        <p className="text-xs font-medium">Model 3D dari library</p>
        <p className="text-[10px] leading-tight text-muted-foreground">
          {hasCustomModel
            ? isRooftop
              ? "Model kustom aktif — di-tile keliling dak."
              : "Model kustom aktif — di-tile otomatis di sisi terbuka."
            : "Pakai model railing dari My Library (mis. Railing 2)."}
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 pointer-coarse:h-10"
            data-testid="railing-pick-model"
            onClick={() =>
              isRooftop
                ? requestAssetPicker({ type: "rooftop-railing" })
                : requestAssetPicker({ type: "railing", roomId: room!.id })
            }
          >
            <Library /> {hasCustomModel ? "Ganti model" : "Pilih model"}
          </Button>
          {hasCustomModel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                isRooftop
                  ? setRooftopRailingModel(null)
                  : updateRoom(room!.id, {
                      railingModelUrl: null,
                      railingModelAssetId: null,
                    })
              }
            >
              Lepas
            </Button>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Gaya &quot;Tembok&quot; menghasilkan parapet solid — klik parapetnya untuk
        memberi cladding/aksen seperti dinding biasa.
      </p>
    </div>
  );
}

/** Jalur registry: kind === "railing" (klik mesh railing / dak). */
export function RailingInspectorCard({ surface }: { surface: InspectorSurface }) {
  const railingRoomId = useEditorStore((s) =>
    s.selected?.kind === "railing" ? s.selected.roomId : null,
  );
  const layout = useEditorStore((s) => s.layout);
  if (!railingRoomId || !layout) return null;
  if (railingRoomId === ROOFTOP_RAIL_ID) {
    return <RailingCardInner ctx={{ kind: "rooftop" }} surface={surface} />;
  }
  const room = layout.rooms.find((r) => r.id === railingRoomId);
  if (!room) return null;
  return <RailingCardInner ctx={{ kind: "room", room }} surface={surface} />;
}

/**
 * Jalur implisit 3D (perilaku lama dipertahankan): RUANG balkon terpilih, atau
 * ruang apa pun di floor-rooftop → kartu railing ikut tampil. Saling eksklusif
 * dgn jalur registry (hanya render saat kind === "room").
 */
export function RailingRoomContextCard({ surface }: { surface: InspectorSurface }) {
  const selectedRoomId = useEditorStore((s) =>
    s.selected?.kind === "room" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  if (!selectedRoomId || !layout) return null;
  const room = layout.rooms.find((r) => r.id === selectedRoomId);
  if (!room) return null;
  if (room.floorId === "floor-rooftop") {
    return <RailingCardInner ctx={{ kind: "rooftop" }} surface={surface} />;
  }
  if (room.type === "balkon") {
    return <RailingCardInner ctx={{ kind: "room", room }} surface={surface} />;
  }
  return null;
}
