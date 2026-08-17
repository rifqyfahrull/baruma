"use client";

/**
 * OpeningInspector terpadu (unifikasi P2) — SUPERSET merge dari dua editor
 * bukaan lama yang sama-sama tidak lengkap:
 * - `OpeningInspector` 2D (editor-inspector): positionM/headHeightM/operation/
 *   privasi/catatan — tanpa warna kusen & model GLB.
 * - `OpeningQuickEditor` 3D (preview-controls): warna kusen/model GLB/gorden —
 *   tanpa posisi/ambang atas/privasi/catatan, dan menautkan "Edit detail lain
 *   di 2D Editor".
 * Kini SATU komponen dirender identik di panel kanan 2D dan 3D. `surface`
 * hanya boleh mengubah AKSI (bukan field/urutan/widget) — kontrak §3.4
 * docs/UNIFIKASI_UI_EDITOR.md.
 */

import * as React from "react";
import { DoorOpen, Library, X } from "lucide-react";

import type {
  Opening,
  OpeningFrameMaterial,
  OpeningKind,
  OpeningOperation,
  OpeningPrivacyLevel,
  OpeningShading,
} from "@/types";
import {
  OPENING_FRAME_MATERIALS,
  OPENING_KIND_META,
  OPENING_OPERATIONS,
  OPENING_PRIVACY_LEVELS,
  OPENING_PURPOSES,
  OPENING_SHADINGS,
  openingDefaultsForKind,
} from "@/lib/constants";
import { useEditorStore } from "@/stores/editor-store";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
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
import { DeleteButton, Field, NumField, Stat } from "./fields";
import type { InspectorSurface } from "./registry";

/**
 * Kind yang masuk akal diberi siluet lengkung (arch/kapsul) — bukaan dgn
 * bentuk/pola sendiri (roster/krawangan berpori, porthole sudah bundar,
 * garage_door sectional, skylight bidang atap) dikecualikan.
 */
const ARCH_SHAPE_KINDS = new Set<OpeningKind>([
  "fixed_window",
  "casement_window",
  "sliding_window",
  "awning_window",
  "clerestory_window",
  "curtain_wall",
  "hinged_door",
  "sliding_glass_door",
  "pocket_door",
  "folding_door",
  "pivot_door",
  "open_passage",
  "facade_cutout",
  "cantilever_opening",
]);

/**
 * Kind yang masuk akal diberi tepi atas MIRING (trapesium mengikuti
 * kemiringan atap) — kaca fasad besar (jendela/curtain wall/facade
 * cutout). Disembunyikan utk porthole (bundar), skylight (bidang atap,
 * bukan dinding), garage_door (sectional), roster/krawangan/jalousie
 * (pola sendiri), dan pintu (bukaan trapesium umumnya kaca fasad, bukan
 * jalur sirkulasi).
 */
const TOP_SLOPE_KINDS = new Set<OpeningKind>([
  "fixed_window",
  "casement_window",
  "sliding_window",
  "awning_window",
  "clerestory_window",
  "curtain_wall",
  "facade_cutout",
]);

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const OPENING_SHAPE_LABELS: Record<"rect" | "arch" | "capsule", string> = {
  rect: "Persegi",
  arch: "Lengkung atas",
  capsule: "Kapsul",
};

function EnumSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className="w-full pointer-coarse:h-10" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {(Object.keys(options) as T[]).map((k) => (
            <SelectItem key={k} value={k}>
              {options[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function OpeningInspectorCard({ surface }: { surface: InspectorSurface }) {
  const openingId = useEditorStore((s) =>
    s.selected?.kind === "opening" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const updateOpening = useEditorStore((s) => s.updateOpening);
  const deleteRef = useEditorStore((s) => s.deleteRef);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const [note, setNote] = React.useState("");
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [frameColorText, setFrameColorText] = React.useState("");
  const [frameColorSyncKey, setFrameColorSyncKey] = React.useState<string | null>(null);

  const opening = layout?.openings.find((o) => o.id === openingId);

  // State catatan lokal per bukaan (resync saat ganti seleksi) — pola
  // adjust-during-render, konsisten dgn NumField kit.
  if (opening && noteFor !== opening.id) {
    setNoteFor(opening.id);
    setNote(opening.notes ?? "");
  }

  // Input hex "Warna kusen" terkontrol (bug uji UI: field lama pakai
  // `defaultValue` pada <input type="color"> — tidak controlled, jadi
  // ketikan/keyboard tidak propagate ke React state). Resync kunci pada
  // `${id}:${frameColor}` (bukan cuma id) supaya perubahan EKSTERNAL
  // (tombol Reset, undo, patch agent) ikut tersinkron, tapi ketikan lokal
  // (yang belum di-commit) tidak ditimpa balik oleh render berikutnya.
  const frameColorKey = opening ? `${opening.id}:${opening.frameColor ?? ""}` : null;
  if (opening && frameColorSyncKey !== frameColorKey) {
    setFrameColorSyncKey(frameColorKey);
    setFrameColorText(opening.frameColor ?? "");
  }

  if (!opening || !layout) return null;

  const kind: OpeningKind =
    opening.kind ?? (opening.type === "door" ? "hinged_door" : "sliding_window");
  const meta = OPENING_KIND_META[kind];
  const hostRoom = layout.rooms.find((r) => opening.wallId.startsWith(`${r.id}:`));

  const commitNumber = (
    key: "widthM" | "heightM" | "positionM" | "sillHeightM" | "headHeightM",
    v: number,
    min: number,
  ) => {
    if (!Number.isFinite(v) || v < min) return;
    updateOpening(opening.id, { [key]: Math.round(v * 100) / 100 });
  };

  const commitFrameColor = () => {
    const raw = frameColorText.trim();
    if (raw === "") {
      if (opening.frameColor !== undefined) updateOpening(opening.id, { frameColor: undefined });
      return;
    }
    const normalized = (raw.startsWith("#") ? raw : `#${raw}`).toLowerCase();
    if (!HEX_COLOR_RE.test(normalized)) {
      // Tak valid — kembalikan tampilan ke nilai tersimpan terakhir alih-alih
      // menyimpan hex rusak.
      setFrameColorText(opening.frameColor ?? "");
      return;
    }
    if (normalized !== (opening.frameColor ?? "")) {
      updateOpening(opening.id, { frameColor: normalized });
    }
    setFrameColorText(normalized);
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border bg-background p-3",
        surface === "3d" && "border-primary/40",
      )}
      data-testid="opening-quick-editor"
    >
      {/* Header: identitas + konteks + tutup */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <DoorOpen className="size-4 text-primary" />
          <div>
            <p className="text-sm font-semibold">
              {opening.type === "door" ? "Pintu" : "Jendela"} — {meta.label}
            </p>
            <p className="text-xs text-muted-foreground">
              {hostRoom?.name ?? "?"} · {opening.widthM}×{opening.heightM} m
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor bukaan"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Jenis & fungsi */}
      <EnumSelect
        label="Tipe bukaan"
        value={kind}
        options={
          Object.fromEntries(
            (Object.keys(OPENING_KIND_META) as OpeningKind[]).map((k) => [
              k,
              OPENING_KIND_META[k].label,
            ]),
          ) as Record<OpeningKind, string>
        }
        onChange={(next) => updateOpening(opening.id, openingDefaultsForKind(next))}
      />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Fungsi" value={OPENING_PURPOSES[opening.purpose ?? meta.purpose]} />
        <Stat
          label="Operasi"
          value={OPENING_OPERATIONS[opening.operation ?? meta.operation]}
        />
      </div>

      {/* Dimensi & posisi — superset (dulu posisi/ambang atas hanya di 2D) */}
      <div className="grid grid-cols-2 gap-2">
        <NumField
          key={`w-${opening.id}`}
          label="Lebar (m)"
          value={opening.widthM}
          step={0.1}
          onCommit={(v) => commitNumber("widthM", v, 0.2)}
        />
        <NumField
          key={`h-${opening.id}`}
          label="Tinggi (m)"
          value={opening.heightM}
          step={0.1}
          onCommit={(v) => commitNumber("heightM", v, 0.2)}
        />
        <NumField
          key={`p-${opening.id}`}
          label="Posisi di dinding (m)"
          value={opening.positionM}
          step={0.1}
          onCommit={(v) => commitNumber("positionM", v, 0)}
        />
        <NumField
          key={`s-${opening.id}`}
          label="Ambang bawah (m)"
          value={opening.sillHeightM ?? meta.defaultSillHeightM}
          step={0.1}
          onCommit={(v) => commitNumber("sillHeightM", v, 0)}
        />
        <NumField
          key={`hh-${opening.id}`}
          label="Ambang atas (m)"
          value={
            opening.headHeightM ??
            (opening.sillHeightM ?? meta.defaultSillHeightM) + opening.heightM
          }
          step={0.1}
          onCommit={(v) => commitNumber("headHeightM", v, 0.2)}
        />
        <NumField
          key={`fd-${opening.id}`}
          label="Bingkai menonjol (m) — 0 = flush"
          value={opening.frameDepthM ?? 0}
          min={0}
          max={0.8}
          step={0.05}
          onCommit={(v) => updateOpening(opening.id, { frameDepthM: v })}
        />
      </div>

      {/* Bentuk — siluet lengkung (fasad mediterania/organik). Lubang dinding
          tetap persegi; hanya untuk kind yang masuk akal diberi lengkung. */}
      {ARCH_SHAPE_KINDS.has(kind) && (
        <EnumSelect
          label="Bentuk"
          value={(opening.archShape ?? "rect") as "rect" | "arch" | "capsule"}
          options={OPENING_SHAPE_LABELS}
          onChange={(v) =>
            updateOpening(opening.id, {
              archShape: v === "rect" ? undefined : (v as Opening["archShape"]),
            })
          }
        />
      )}

      {/* Miring tepi atas — bukaan TRAPESIUM mengikuti kemiringan atap/gable.
          Lubang dinding tetap persegi setinggi Tinggi (m) di atas (sisi
          tinggi); nilai ± menutup sudut sisi rendah dgn step-fill. */}
      {TOP_SLOPE_KINDS.has(kind) && (
        <NumField
          key={`ts-${opening.id}`}
          label="Miring tepi atas (m)"
          value={opening.topSlopeM ?? 0}
          min={-3}
          max={3}
          step={0.1}
          onCommit={(v) => updateOpening(opening.id, { topSlopeM: v || undefined })}
        />
      )}

      {/* Gaya */}
      <div className="grid grid-cols-2 gap-2">
        <EnumSelect
          label="Cara buka"
          value={opening.operation ?? meta.operation}
          options={OPENING_OPERATIONS}
          onChange={(v) => updateOpening(opening.id, { operation: v as OpeningOperation })}
        />
        <EnumSelect
          label="Material frame"
          value={opening.frameMaterial ?? meta.frameMaterial}
          options={OPENING_FRAME_MATERIALS}
          onChange={(v) =>
            updateOpening(opening.id, { frameMaterial: v as OpeningFrameMaterial })
          }
        />
      </div>
      <Field label="Warna kusen">
        <div className="flex items-center gap-2">
          {/* Swatch: controlled `value` (bukan defaultValue) supaya picker
              native benar-benar propagate ke state React alih-alih diam-diam
              nyasar — bug uji UI B2. */}
          <input
            type="color"
            value={
              HEX_COLOR_RE.test(frameColorText)
                ? frameColorText
                : (opening.frameColor ?? "#3c4245")
            }
            onChange={(e) => {
              setFrameColorText(e.target.value);
              updateOpening(opening.id, { frameColor: e.target.value });
            }}
            aria-label="Warna kusen custom"
            className="h-8 w-10 cursor-pointer rounded border bg-background p-0.5 pointer-coarse:h-10"
          />
          {/* Hex terketik langsung — terkontrol, commit onBlur/Enter, validasi
              #rrggbb (kekurangan uji UI: sebelumnya tak ada input teks sama
              sekali, hanya picker native yang tidak bisa diketik). */}
          <Input
            value={frameColorText}
            aria-label="Warna kusen custom (hex)"
            placeholder="#3c4245"
            spellCheck={false}
            className="h-8 w-24 font-mono text-xs pointer-coarse:h-10"
            onChange={(e) => setFrameColorText(e.target.value)}
            onBlur={commitFrameColor}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          {opening.frameColor && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs pointer-coarse:h-9"
              onClick={() => updateOpening(opening.id, { frameColor: undefined })}
            >
              Reset
            </Button>
          )}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <EnumSelect
          label="Privasi"
          value={opening.privacyLevel ?? meta.privacyLevel}
          options={OPENING_PRIVACY_LEVELS}
          onChange={(v) =>
            updateOpening(opening.id, { privacyLevel: v as OpeningPrivacyLevel })
          }
        />
        <EnumSelect
          label="Shading"
          value={opening.shading ?? meta.shading}
          options={OPENING_SHADINGS}
          onChange={(v) => updateOpening(opening.id, { shading: v as OpeningShading })}
        />
      </div>

      {/* Model 3D dari library — mengganti visual daun; lubang, jadwal kusen &
          gambar kerja tetap dari dimensi bukaan. Id bukaan ditangkap SAAT klik
          (AssetTarget) — race commit-time picker lama tertutup. */}
      <div
        className={cn(
          "space-y-1.5 rounded-md border px-2 py-2",
          opening.modelUrl && "border-primary bg-primary/10",
        )}
      >
        <p className="text-xs font-medium">Model 3D dari library</p>
        <p className="text-[10px] leading-tight text-muted-foreground">
          {opening.modelUrl
            ? "Model kustom aktif — di-fit ke lebar×tinggi bukaan."
            : "Ganti daun pintu/jendela dengan model GLB dari My Library."}
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 pointer-coarse:h-10"
            data-testid="opening-pick-model"
            onClick={() => requestAssetPicker({ type: "opening-model", openingId: opening.id })}
          >
            <Library /> {opening.modelUrl ? "Ganti model" : "Pilih model"}
          </Button>
          {opening.modelUrl && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateOpening(opening.id, { modelUrl: null, modelAssetId: null })}
            >
              Lepas
            </Button>
          )}
        </div>
      </div>

      {/* Gorden / tirai — OVERLAY di sisi dalam jendela (kaca tetap). */}
      {opening.type === "window" && (
        <div
          className={cn(
            "space-y-1.5 rounded-md border px-2 py-2",
            opening.curtainModelUrl && "border-primary bg-primary/10",
          )}
        >
          <p className="text-xs font-medium">Gorden / tirai</p>
          <p className="text-[10px] leading-tight text-muted-foreground">
            {opening.curtainModelUrl
              ? "Gorden aktif — digantung di sisi dalam, menutup jendela."
              : "Gantung model gorden 3D dari My Library di muka dalam jendela."}
          </p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 pointer-coarse:h-10"
              data-testid="opening-pick-curtain"
              onClick={() =>
                requestAssetPicker({ type: "opening-curtain", openingId: opening.id })
              }
            >
              <Library /> {opening.curtainModelUrl ? "Ganti gorden" : "Pilih gorden"}
            </Button>
            {opening.curtainModelUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  updateOpening(opening.id, { curtainModelUrl: null, curtainAssetId: null })
                }
              >
                Lepas
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Catatan */}
      <Field label="Catatan">
        <Input
          value={note}
          aria-label="Catatan bukaan"
          placeholder="Opsional"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (opening.notes ?? "")) updateOpening(opening.id, { notes: note });
          }}
        />
      </Field>

      <DeleteButton
        entityLabel="bukaan"
        onDelete={() => deleteRef({ kind: "opening", id: opening.id })}
      />
    </div>
  );
}
