"use client";

/**
 * WallInspector terpadu (unifikasi P2) — migrasi `FacadeQuickEditor` +
 * `FacadeLouverSection` dari panel 3D ke registry, dirender identik di 2D
 * dan 3D. Bersama hit-target dinding baru di plan-canvas, ini menunaikan
 * spec lama docs/PRD.md §10.6 (wall inspector 2D) yang tak pernah dibangun:
 * dinding akhirnya bisa DIKLIK dan DIEDIT dari denah 2D.
 *
 * Kontrak e2e (preview-3d-optim.spec.ts): root ber-testid
 * `facade-quick-editor`, dan descendant `button[title]` PERTAMA harus swatch
 * cladding — jangan menambah tombol ber-title sebelum grid swatch.
 */

import * as React from "react";
import { ChevronDown, Grid2x2, Lightbulb, Library, Trash2, X } from "lucide-react";

import type { ComponentPatternSpec, FacadeElement, FacadeElementFinish, FacadeElementKind } from "@/types";
import { useEditorStore } from "@/stores/editor-store";
import { wallRefId, isEdgeWallRoomId, edgeWallFloorId } from "@/types/entity-ref";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { requestStudio } from "@/components/studio/component-studio";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, NumField, ToggleRow } from "./fields";
import { CladdingGrid } from "./cladding-grid";
import { facadeBandsForWall } from "@/lib/three/facade-bands";
import { hasWallAccent } from "@/lib/exterior/facade-accents";
import { FACADE_ELEMENT_KIND_LABELS, facadeElementPresetLabel } from "@/lib/exterior/labels";
import type { InspectorSurface } from "./registry";

const PATTERN_ORIENTATION_LABELS: Record<NonNullable<ComponentPatternSpec["orientation"]>, string> = {
  v: "Vertikal",
  h: "Horizontal",
  grid: "Grid (2 arah)",
  cross: "Silang (2 arah)",
};

const WALL_SIDE_LABELS: Record<string, string> = {
  n: "utara",
  s: "selatan",
  w: "barat",
  e: "timur",
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const LOUVER_FINISH_LABELS: Record<FacadeElementFinish, string> = {
  kayu: "Kayu",
  aluminium_gelap: "Aluminium gelap",
  putih: "Putih",
  terakota: "Terakota (roster)",
};

// CladdingGrid dipindah ke cladding-grid.tsx (dipakai juga kartu Exterior).

/**
 * Warna bilah custom (`FacadeElement.colorHex`) — menang atas warna bawaan
 * `finish` (LOUVER_FINISH_COLORS), supaya sirip bisa dicocokkan dengan
 * cladding dinding (mis. kayu gelap "#6f4e37"). Pola PERSIS "Warna kusen"
 * di opening-inspector.tsx (swatch + hex terketik, resync via key eksternal).
 */
function FacadeColorField({ fe }: { fe: FacadeElement }) {
  const updateFacadeElement = useEditorStore((s) => s.updateFacadeElement);
  const [text, setText] = React.useState(fe.colorHex ?? "");
  const [syncKey, setSyncKey] = React.useState(`${fe.id}:${fe.colorHex ?? ""}`);
  const key = `${fe.id}:${fe.colorHex ?? ""}`;
  if (syncKey !== key) {
    setSyncKey(key);
    setText(fe.colorHex ?? "");
  }

  const commit = () => {
    const raw = text.trim();
    if (raw === "") {
      if (fe.colorHex !== undefined) updateFacadeElement(fe.id, { colorHex: undefined });
      return;
    }
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    if (!HEX_COLOR_RE.test(normalized)) {
      setText(fe.colorHex ?? "");
      return;
    }
    if (normalized !== (fe.colorHex ?? "")) {
      updateFacadeElement(fe.id, { colorHex: normalized });
    }
  };

  return (
    <Field label="Warna sirip custom (opsional, cocokkan cladding)">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={HEX_COLOR_RE.test(text) ? text : (fe.colorHex ?? "#8a6242")}
          onChange={(e) => {
            setText(e.target.value);
            updateFacadeElement(fe.id, { colorHex: e.target.value });
          }}
          aria-label="Warna sirip custom"
          className="h-8 w-10 cursor-pointer rounded border bg-background p-0.5 pointer-coarse:h-10"
        />
        <Input
          value={text}
          aria-label="Warna sirip custom (hex)"
          placeholder="#6f4e37"
          spellCheck={false}
          className="h-8 w-24 font-mono text-xs pointer-coarse:h-10"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {fe.colorHex && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs pointer-coarse:h-9"
            onClick={() => updateFacadeElement(fe.id, { colorHex: undefined })}
          >
            Reset
          </Button>
        )}
      </div>
    </Field>
  );
}

/**
 * "Pola kustom" kisi/roster — panel collapsible yang mengedit
 * `FacadeElement.pattern` (ComponentPatternSpec): pitch/lebar/kedalaman
 * bilah, orientasi, rhythm (spasi berkelompok), dan bingkai keliling.
 * Absen/reset = jalur numerik bawaan `kind` (lihat build-model.ts).
 */
function FacadePatternFields({ fe }: { fe: FacadeElement }) {
  const updateFacadeElement = useEditorStore((s) => s.updateFacadeElement);
  const pattern = fe.pattern;
  const [open, setOpen] = React.useState(!!pattern);
  const [rhythmText, setRhythmText] = React.useState(pattern?.rhythm?.join(",") ?? "");
  const [lastRhythm, setLastRhythm] = React.useState(pattern?.rhythm);
  // Resync teks rhythm saat pattern berubah dari luar (undo/AI).
  if (pattern?.rhythm !== lastRhythm) {
    setLastRhythm(pattern?.rhythm);
    setRhythmText(pattern?.rhythm?.join(",") ?? "");
  }

  const patch = (p: Partial<ComponentPatternSpec>) => {
    updateFacadeElement(fe.id, { pattern: { ...(pattern ?? {}), ...p } });
  };

  const commitRhythm = () => {
    const nums = rhythmText
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 8);
    patch({ rhythm: nums.length ? nums : undefined });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border px-2 py-1.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between text-left text-xs font-medium"
          aria-label="Pola kustom kisi/roster"
        >
          <span>Pola kustom{pattern ? " · aktif" : ""}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => requestStudio({ kind: "facade-element", id: fe.id })}
        >
          <Library /> Buka Studio Komponen
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Pitch (m)"
            value={pattern?.pitchM ?? 0.25}
            step={0.01}
            min={0.05}
            max={1.5}
            onCommit={(v) => patch({ pitchM: v })}
          />
          <NumField
            label="Lebar bilah (m)"
            value={pattern?.barWidthM ?? 0.08}
            step={0.01}
            min={0.02}
            max={0.5}
            onCommit={(v) => patch({ barWidthM: v })}
          />
          <NumField
            label="Kedalaman bilah (m)"
            value={pattern?.barDepthM ?? 0.15}
            step={0.01}
            min={0.01}
            max={0.6}
            onCommit={(v) => patch({ barDepthM: v })}
          />
        </div>
        <Field label="Orientasi">
          <Select
            value={pattern?.orientation ?? "v"}
            onValueChange={(v) => patch({ orientation: v as ComponentPatternSpec["orientation"] })}
          >
            <SelectTrigger size="sm" className="h-7 w-full text-xs pointer-coarse:h-10" aria-label="Orientasi pola">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PATTERN_ORIENTATION_LABELS) as NonNullable<ComponentPatternSpec["orientation"]>[]).map(
                (o) => (
                  <SelectItem key={o} value={o}>
                    {PATTERN_ORIENTATION_LABELS[o]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Rhythm (mis. 3,1 = 3 rapat lalu 1 gap)">
          <Input
            value={rhythmText}
            placeholder="3,1"
            aria-label="Rhythm pola"
            onChange={(e) => setRhythmText(e.target.value)}
            onBlur={commitRhythm}
          />
        </Field>
        <ToggleRow
          label="Bingkai keliling"
          checked={!!pattern?.frame}
          onChange={(v) => patch({ frame: v || undefined })}
        />
        <ToggleRow
          label="Tenggelam di muka dinding (nat beton/reveal)"
          checked={!!pattern?.inset}
          onChange={(v) => patch({ inset: v || undefined })}
        />
        {pattern && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => updateFacadeElement(fe.id, { pattern: undefined })}
          >
            Reset pola (kembali ke bawaan)
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function WallInspectorCard({ surface }: { surface: InspectorSurface }) {
  const roomId = useEditorStore((s) =>
    s.selected?.kind === "wall" ? s.selected.roomId : null,
  );
  const side = useEditorStore((s) =>
    s.selected?.kind === "wall" ? s.selected.side : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const setWallCladding = useEditorStore((s) => s.setWallCladding);
  const addWallLamp = useEditorStore((s) => s.addWallLamp);
  const addFacadeElement = useEditorStore((s) => s.addFacadeElement);
  const addFlutedFacadePanel = useEditorStore((s) => s.addFlutedFacadePanel);
  const addRevealLineFacadePanel = useEditorStore((s) => s.addRevealLineFacadePanel);
  const updateFacadeElement = useEditorStore((s) => s.updateFacadeElement);
  const removeFacadeElement = useEditorStore((s) => s.removeFacadeElement);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const setWallCladdingBands = useEditorStore((s) => s.setWallCladdingBands);
  const generateWallAccent = useEditorStore((s) => s.generateWallAccent);
  const [accentPitch, setAccentPitch] = React.useState(0.45);
  const [accentHeight, setAccentHeight] = React.useState(2.2);

  if (!roomId || !side || !layout) return null;
  // Dinding sintetis `edge-{floorId}` (penutup fasad lantai elevated) — bukan
  // Room, tapi punya host dinding sendiri (lib/geometry/edge-wall.ts) sejak
  // build-model.ts bisa resolve elemen fasad-nya: kisi/roster & preset
  // fluted/reveal ikut tampil. Lampu & aksen 1-klik TETAP butuh Room nyata
  // (addWallLamp/generateWallAccent belum mendukung wallId sintetis).
  const edgeFloor = isEdgeWallRoomId(roomId)
    ? layout.floors.find((f) => f.id === edgeWallFloorId(roomId))
    : undefined;
  const room = edgeFloor ? undefined : layout.rooms.find((r) => r.id === roomId);
  if (!room && !edgeFloor) return null;

  const wallId = wallRefId({ kind: "wall", roomId, side });
  const current = layout.facade?.[wallId] ?? null;
  const currentInner = layout.facadeInner?.[wallId] ?? null;
  const bands = (layout.facadeElements ?? []).filter((fe) => fe.wallId === wallId);
  // Band cladding vertikal dinding ini (F1 split-facade).
  const bandList = facadeBandsForWall(layout.facade, roomId, side, 2.8);
  const currentBase = current;
  const hasAccent = hasWallAccent(layout, roomId, side);
  const commitBandPatch = (
    index: number,
    patch: Partial<{ sillM: number; headM: number; claddingId: string }>,
  ) => {
    const next = bandList.map((b, i) =>
      i === index
        ? { sillM: b.sillM, headM: b.headM, claddingId: b.claddingId, ...patch }
        : { sillM: b.sillM, headM: b.headM, claddingId: b.claddingId },
    );
    setWallCladdingBands(roomId, side, currentBase, next);
  };

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-lg border bg-background p-3",
        surface === "3d" && "border-primary/40",
      )}
      data-testid="facade-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Grid2x2 className="size-4 text-primary" />
          <div>
            <p className="text-sm font-semibold">Cladding fasad</p>
            <p className="text-xs text-muted-foreground">
              {edgeFloor
                ? `Fasad lantai — ${edgeFloor.name} · sisi ${WALL_SIDE_LABELS[side] ?? side}`
                : `Dinding ${WALL_SIDE_LABELS[side] ?? side} · ${room!.name}`}
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor fasad"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Cladding muka LUAR */}
      <CladdingGrid current={current} onPick={(id) => setWallCladding(wallId, id)} />
      <Button
        size="sm"
        variant="outline"
        className="w-full pointer-coarse:h-10"
        disabled={!current}
        onClick={() => setWallCladding(wallId, null)}
      >
        Polos — ikut material ruang
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Cladding mengubah muka LUAR dinding ini saja.
      </p>

      {/* Band cladding VERTIKAL (split-facade): material berbeda per rentang
          tinggi — mis. batu 0–1 m, plester di atasnya. Ditempatkan SETELAH
          grid luar (kontrak e2e: swatch pertama kartu = grid luar). */}
      <div className="space-y-2 border-t pt-2" data-testid="facade-band-section">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            Band vertikal (per rentang tinggi)
          </p>
          <Button
            size="sm"
            variant="outline"
            className="pointer-coarse:h-10"
            data-testid="facade-band-add"
            onClick={() => {
              const last = bandList[bandList.length - 1];
              const sillM = last ? last.headM : 0;
              const headM = Math.min(2.8, sillM + 1);
              if (headM - sillM < 0.05) return;
              setWallCladdingBands(roomId, side, currentBase, [
                ...bandList.map(({ sillM: s2, headM: h2, claddingId }) => ({
                  sillM: s2,
                  headM: h2,
                  claddingId,
                })),
                { sillM, headM, claddingId: "beton_ekspos" },
              ]);
            }}
          >
            + Band
          </Button>
        </div>
        {bandList.map((b, bi) => (
          <div key={b.key} className="space-y-2 rounded-md border p-2">
            <div className="grid grid-cols-2 gap-2">
              <NumField
                key={`bs-${b.key}`}
                label="Dari (m)"
                value={b.sillM}
                min={0}
                max={2.8}
                step={0.1}
                onCommit={(v) => commitBandPatch(bi, { sillM: v })}
              />
              <NumField
                key={`bh-${b.key}`}
                label="Sampai (m)"
                value={b.headM}
                min={0}
                max={2.8}
                step={0.1}
                onCommit={(v) => commitBandPatch(bi, { headM: v })}
              />
            </div>
            <CladdingGrid
              keyPrefix={`band-${bi}-`}
              current={b.claddingId}
              onPick={(id) => commitBandPatch(bi, { claddingId: id })}
            />
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive"
              onClick={() =>
                setWallCladdingBands(
                  roomId,
                  side,
                  currentBase,
                  bandList
                    .filter((_, i) => i !== bi)
                    .map(({ sillM: s2, headM: h2, claddingId }) => ({
                      sillM: s2,
                      headM: h2,
                      claddingId,
                    })),
                )
              }
            >
              Hapus band
            </Button>
          </div>
        ))}
        {bandList.length === 0 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Belum ada — band memecah dinding jadi beberapa material bertumpuk
            (podium batu + plester di atasnya, dsb.).
          </p>
        )}
      </div>

      {/* Aksen muka DALAM */}
      <div className="space-y-2 border-t pt-2" data-testid="facade-inner-section">
        <p className="text-[11px] font-medium text-muted-foreground">
          Aksen muka dalam (dinding ini saja)
        </p>
        <CladdingGrid
          keyPrefix="in-"
          current={currentInner}
          onPick={(id) => setWallCladding(wallId, id, "inner")}
        />
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          disabled={!currentInner}
          onClick={() => setWallCladding(wallId, null, "inner")}
        >
          Polos — ikut material ruang
        </Button>
      </div>

      {/* Kisi / roster fasad — juga tampil utk dinding tepi sintetis w-edge
          (build-model.ts resolve host-nya lewat lib/geometry/edge-wall.ts,
          bukan `room`, jadi tak butuh Room nyata di sini). */}
      {(room || edgeFloor) && (
      <div className="space-y-2 border-t pt-2" data-testid="facade-louver-section">
        <p className="text-[11px] font-medium text-muted-foreground">
          Kisi / roster fasad
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(FACADE_ELEMENT_KIND_LABELS) as FacadeElementKind[]).map((k) => (
            <Button
              key={k}
              size="sm"
              variant="outline"
              className="h-auto flex-col gap-0.5 px-1 py-1.5 text-[10px] leading-tight pointer-coarse:py-2.5"
              data-testid={`facade-add-${k}`}
              onClick={() => addFacadeElement(wallId, k)}
            >
              <span aria-hidden className="font-mono text-xs">
                {k === "louver_band" ? "|||" : k === "slat_horizontal" ? "≡" : "▦"}
              </span>
              {k === "louver_band" ? "Louver" : k === "slat_horizontal" ? "Slat H" : "Roster"}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="w-full pointer-coarse:h-10"
          data-testid="facade-add-fluted-panel"
          onClick={() => addFlutedFacadePanel(wallId)}
        >
          <span aria-hidden className="font-mono text-xs">
            ||||
          </span>
          Panel sirip (fluted) — seluruh dinding
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="w-full pointer-coarse:h-10"
          data-testid="facade-add-reveal-line"
          onClick={() => addRevealLineFacadePanel(wallId)}
        >
          <span aria-hidden className="font-mono text-xs">
            ▤
          </span>
          Nat beton / reveal line — seluruh dinding
        </Button>

        {bands.map((fe) => {
          const presetLabel = facadeElementPresetLabel(fe);
          return (
          <div key={fe.id} className="space-y-2 rounded-md border p-2" data-testid={`facade-element-${fe.id}`}>
            <p className="text-xs font-medium" data-testid={`facade-element-label-${fe.id}`}>
              {presetLabel}
            </p>
            <div className="flex items-center gap-1.5">
              <Select
                value={fe.kind ?? "louver_band"}
                onValueChange={(v) =>
                  updateFacadeElement(fe.id, { kind: v as FacadeElementKind })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 flex-1 text-xs pointer-coarse:h-10"
                  aria-label="Jenis kisi/roster"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FACADE_ELEMENT_KIND_LABELS) as FacadeElementKind[]).map(
                    (k) => (
                      <SelectItem key={k} value={k}>
                        {FACADE_ELEMENT_KIND_LABELS[k]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 pointer-coarse:size-9"
                aria-label={`Hapus ${presetLabel}`}
                data-testid={`facade-remove-${fe.id}`}
                onClick={() => removeFacadeElement(fe.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <Select
              value={fe.finish}
              onValueChange={(v) =>
                updateFacadeElement(fe.id, { finish: v as FacadeElementFinish })
              }
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-full text-xs pointer-coarse:h-10"
                aria-label="Finish kisi/roster"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LOUVER_FINISH_LABELS) as FacadeElementFinish[]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {LOUVER_FINISH_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <FacadeColorField fe={fe} />

            <div
              className={cn(
                "space-y-1.5 rounded-md border px-2 py-2",
                fe.modelUrl && "border-primary bg-primary/10",
              )}
            >
              <p className="text-xs font-medium">Model 3D fasad</p>
              <p className="text-[10px] leading-tight text-muted-foreground">
                {fe.modelUrl
                  ? "Model kustom aktif — di-fit ke envelope kisi."
                  : "Ganti kisi prosedural dengan model GLB dari My Library."}
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 pointer-coarse:h-10"
                  data-testid="facade-pick-model"
                  onClick={() =>
                    requestAssetPicker({ type: "facade-element", id: fe.id })
                  }
                >
                  <Library /> {fe.modelUrl ? "Ganti model" : "Pilih model"}
                </Button>
                {fe.modelUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateFacadeElement(fe.id, { modelUrl: null, modelAssetId: null })
                    }
                  >
                    Lepas
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumField
                key={`few-${fe.id}`}
                label="Lebar (m)"
                value={fe.widthM}
                onCommit={(v) =>
                  v > 0 && updateFacadeElement(fe.id, { widthM: Math.round(v * 100) / 100 })
                }
              />
              <NumField
                key={`feh-${fe.id}`}
                label="Tinggi (m)"
                value={fe.heightM}
                onCommit={(v) =>
                  v > 0 && updateFacadeElement(fe.id, { heightM: Math.round(v * 100) / 100 })
                }
              />
              <NumField
                key={`fes-${fe.id}`}
                label="Dari lantai (m)"
                value={fe.sillHeightM}
                onCommit={(v) =>
                  v >= 0 &&
                  updateFacadeElement(fe.id, { sillHeightM: Math.round(v * 100) / 100 })
                }
              />
              <NumField
                key={`fep-${fe.id}`}
                label="Posisi tengah (m)"
                value={fe.positionM}
                onCommit={(v) =>
                  v >= 0 &&
                  updateFacadeElement(fe.id, { positionM: Math.round(v * 100) / 100 })
                }
              />
            </div>

            <FacadePatternFields fe={fe} />
          </div>
          );
        })}

        {bands.length === 0 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Belum ada — &quot;Tambah&quot; memasang kisi selebar dinding (finish kayu,
            tinggi 2,2 m) yang bisa kamu atur.
          </p>
        )}
      </div>

      )}

      {/* Lampu dinding — hanya dinding milik ruang nyata. */}
      {room && (
      <div className="border-t pt-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          onClick={() => addWallLamp(wallId)}
        >
          <Lightbulb /> Tambah lampu dinding di sini
        </Button>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Lampu bisa diklik di 3D untuk atur warna, intensitas, tinggi, atau hapus.
        </p>
      </div>
      )}

      {/* Aksen fasad 1-klik (F6): deret sirip vertikal / band horizontal
          sebagai elemen eksterior ber-tag — regenerate menimpa, bukan
          menduplikasi. Hanya dinding milik ruang nyata. */}
      {room && (
        <div className="space-y-2 border-t pt-2" data-testid="facade-accent-section">
          <p className="text-[11px] font-medium text-muted-foreground">
            Aksen fasad 1-klik
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              key={`acp-${wallId}`}
              label="Jarak antar (m)"
              value={accentPitch}
              min={0.2}
              step={0.05}
              onCommit={(v) => v > 0.1 && setAccentPitch(v)}
            />
            <NumField
              key={`ach-${wallId}`}
              label="Tinggi (m)"
              value={accentHeight}
              min={0.3}
              step={0.1}
              onCommit={(v) => v > 0.2 && setAccentHeight(v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="pointer-coarse:h-10"
              data-testid="facade-accent-fins"
              onClick={() =>
                generateWallAccent(roomId, side, {
                  mode: "vertical_fins",
                  pitchM: accentPitch,
                  heightM: accentHeight,
                  sillM: 0.3,
                  materialId: "beton_ekspos",
                })
              }
            >
              Sirip vertikal
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="pointer-coarse:h-10"
              data-testid="facade-accent-bands"
              onClick={() =>
                generateWallAccent(roomId, side, {
                  mode: "horizontal_bands",
                  pitchM: Math.max(0.35, accentPitch),
                  heightM: accentHeight,
                  sillM: 0.3,
                  materialId: "beton_ekspos",
                })
              }
            >
              Band horizontal
            </Button>
          </div>
          {hasAccent && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => generateWallAccent(roomId, side, null)}
            >
              Hapus aksen dinding ini
            </Button>
          )}
          <p className="text-[11px] leading-snug text-muted-foreground">
            Aksen = elemen eksterior (material bisa diedit per panel). Dibuat
            di posisi dinding saat ini — buat ulang bila denah berubah.
          </p>
        </div>
      )}
    </div>
  );
}
