"use client";

/**
 * ComponentStudioHost — panel STUDIO KOMPONEN terpadu: satu tempat untuk
 * mengedit pola kisi/roster/jeruji/pergola (`ComponentPatternSpec`) dan
 * menyimpannya sebagai preset bernama. Pola PERSIS AssetPickerHost
 * (component/assets/asset-picker-host.tsx): Sheet kanan GLOBAL, target
 * di-capture SAAT REQUEST lewat union typed (bukan string `customTarget`
 * dibaca via getState() saat commit) — race "ganti seleksi selagi sheet
 * terbuka" tertutup by construction.
 *
 * `pattern` sudah bisa dipatch agent lewat updateFacadeElement/
 * updateExteriorElement (lib/three/component-pattern.ts, resolver dipakai
 * DUA jalur: elemen fasad & pergola/pagar/gerbang eksterior) — AI-assist
 * inti SUDAH jalan sebelum panel ini ada. Studio murni menambah: (a) form
 * param pola lokal (belum ter-commit sampai eksplisit diterapkan — satu
 * entri undo per apply, bukan satu per keystroke), (b) preview SVG 2D
 * generatif dari `patternBarOffsets` (TANPA three.js/R3F, bundle ringan),
 * (c) preset tersimpan lewat DataSource (lib/mock/index.ts
 * listComponentPresets/saveComponentPreset/deleteComponentPreset).
 */

import * as React from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { Library, Loader2, Trash2 } from "lucide-react";

import type {
  ComponentPatternSpec,
  ComponentPreset,
  ComponentPresetFamily,
  ExteriorElement,
  FacadeElement,
} from "@/types";
import { useEditorStore } from "@/stores/editor-store";
import { segmentLength } from "@/lib/exterior/geometry";
import {
  useComponentPresets,
  useDeleteComponentPreset,
  useSaveComponentPreset,
} from "@/lib/api/hooks";
import { componentPatternPreviewRects } from "./component-pattern-preview";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Field, NumField, ToggleRow } from "@/components/inspector/fields";

/** Target Studio Komponen — id entity ditangkap SAAT REQUEST, bukan commit. */
export type ComponentStudioTarget =
  | { kind: "facade-element"; id: string }
  | { kind: "exterior-element"; id: string };

type ComponentStudioState = {
  request: ComponentStudioTarget | null;
  open: (target: ComponentStudioTarget) => void;
  close: () => void;
};

export const useComponentStudioStore = create<ComponentStudioState>((set) => ({
  request: null,
  open: (target) => set({ request: target }),
  close: () => set({ request: null }),
}));

/** Buka Studio Komponen untuk sebuah target (dipanggil dari inspector mana pun). */
export function requestStudio(target: ComponentStudioTarget): void {
  useComponentStudioStore.getState().open(target);
}

const ORIENTATION_LABELS: Record<NonNullable<ComponentPatternSpec["orientation"]>, string> = {
  v: "Vertikal",
  h: "Horizontal",
  grid: "Grid (2 arah)",
  cross: "Silang (2 arah)",
};

const FAMILY_LABELS: Record<ComponentPresetFamily, string> = {
  kisi: "Kisi",
  roster: "Roster",
  pagar: "Pagar",
  gerbang: "Gerbang",
  pergola: "Pergola",
};

const FAMILY_OPTIONS = Object.keys(FAMILY_LABELS) as ComponentPresetFamily[];

/**
 * Info geometri & fallback numerik per jenis target — sumber tunggal
 * envelope preview (widthM×heightM) dan default jalur lama (byte-identik
 * dgn konstanta di build-model.ts/exterior-primitives.ts).
 */
type TargetInfo = {
  title: string;
  widthM: number;
  heightM: number;
  pattern: ComponentPatternSpec | undefined;
  suggestedFamily: ComponentPresetFamily;
  fallbackOrientation: NonNullable<ComponentPatternSpec["orientation"]>;
  fallbackPitchM: number;
  fallbackBarWidthM: number;
  fallbackBarDepthM: number;
  supportsFrame: boolean;
  locked?: boolean;
};

const FACADE_FAMILY_BY_KIND: Record<FacadeElement["kind"], ComponentPresetFamily> = {
  louver_band: "kisi",
  slat_horizontal: "kisi",
  roster_screen: "roster",
};

function facadeTargetInfo(fe: FacadeElement): TargetInfo {
  return {
    title: "Elemen fasad",
    widthM: fe.widthM,
    heightM: fe.heightM,
    pattern: fe.pattern,
    suggestedFamily: FACADE_FAMILY_BY_KIND[fe.kind],
    fallbackOrientation: "v",
    fallbackPitchM: 0.25,
    fallbackBarWidthM: 0.08,
    fallbackBarDepthM: 0.15,
    supportsFrame: true,
  };
}

const SEGMENT_PATTERN_KINDS = new Set<ExteriorElement["kind"]>([
  "fence",
  "sliding_gate",
  "swing_gate",
  "pedestrian_gate",
]);

/** `null` = kind eksterior ini tak punya `pattern` (mis. boundary_wall solid) — Studio tak relevan. */
function exteriorTargetInfo(el: ExteriorElement): TargetInfo | null {
  if (el.kind === "pergola") {
    return {
      title: "Pergola",
      // Pola pergola dispasi di bidang DATAR footprint (widthM×depthM),
      // bukan widthM×heightM (heightM = elevasi bidang kisi) — lihat
      // pergolaPrimitives di lib/three/exterior-primitives.ts.
      widthM: el.widthM,
      heightM: el.depthM,
      pattern: el.pattern,
      suggestedFamily: "pergola",
      fallbackOrientation: "cross",
      fallbackPitchM: 0.4,
      fallbackBarWidthM: 0.08,
      fallbackBarDepthM: 0.08,
      supportsFrame: true,
      locked: el.locked,
    };
  }
  if (SEGMENT_PATTERN_KINDS.has(el.kind) && "start" in el && "end" in el) {
    return {
      title: el.kind === "fence" ? "Pagar" : "Gerbang",
      widthM: segmentLength(el.start, el.end),
      heightM: el.heightM,
      pattern: el.pattern,
      suggestedFamily: el.kind === "fence" ? "pagar" : "gerbang",
      fallbackOrientation: "v",
      fallbackPitchM: 0.28,
      fallbackBarWidthM: 0.06,
      fallbackBarDepthM: 0.06,
      supportsFrame: false,
      locked: el.locked,
    };
  }
  return null;
}

function patternIsEmpty(p: ComponentPatternSpec): boolean {
  return (
    p.orientation == null &&
    p.pitchM == null &&
    p.barWidthM == null &&
    p.barDepthM == null &&
    p.frame == null &&
    (p.rhythm == null || p.rhythm.length === 0)
  );
}

function parseRhythmText(text: string): number[] | undefined {
  const nums = text
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 8);
  return nums.length ? nums : undefined;
}

export function ComponentStudioHost() {
  const request = useComponentStudioStore((s) => s.request);
  const close = useComponentStudioStore((s) => s.close);

  const fe = useEditorStore((s) =>
    request?.kind === "facade-element"
      ? s.layout?.facadeElements?.find((e) => e.id === request.id)
      : undefined
  );
  const ext = useEditorStore((s) =>
    request?.kind === "exterior-element"
      ? s.layout?.exteriorElements?.find((e) => e.id === request.id)
      : undefined
  );

  const info = request?.kind === "facade-element"
    ? (fe ? facadeTargetInfo(fe) : null)
    : ext
      ? exteriorTargetInfo(ext)
      : null;

  return (
    <Sheet open={request !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="flex w-[24rem] flex-col overflow-y-auto p-0 sm:max-w-[24rem]"
        data-testid="component-studio-sheet"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>Studio Komponen</SheetTitle>
          <SheetDescription>
            Atur pola bilah dan simpan sebagai preset yang bisa dipakai lagi.
          </SheetDescription>
        </SheetHeader>
        {request && info ? (
          <ComponentStudioBody
            key={`${request.kind}:${request.id}`}
            target={request}
            info={info}
          />
        ) : request ? (
          <p className="px-4 text-sm text-muted-foreground">
            Elemen ini tidak memiliki pola kustom yang bisa diedit.
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ComponentStudioBody({
  target,
  info,
}: {
  target: ComponentStudioTarget;
  info: TargetInfo;
}) {
  const updateFacadeElement = useEditorStore((s) => s.updateFacadeElement);
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);

  const [pattern, setPattern] = React.useState<ComponentPatternSpec>(() => ({
    ...(info.pattern ?? {}),
  }));
  const [rhythmText, setRhythmText] = React.useState(pattern.rhythm?.join(",") ?? "");
  const [presetName, setPresetName] = React.useState("");
  const [presetFamily, setPresetFamily] = React.useState<ComponentPresetFamily>(
    info.suggestedFamily
  );

  const patch = (p: Partial<ComponentPatternSpec>) => setPattern((prev) => ({ ...prev, ...p }));

  const commitRhythm = () => patch({ rhythm: parseRhythmText(rhythmText) });

  const loadPattern = (p: ComponentPatternSpec) => {
    setPattern({ ...p });
    setRhythmText(p.rhythm?.join(",") ?? "");
  };

  const rects = componentPatternPreviewRects({
    pattern,
    widthM: info.widthM,
    heightM: info.heightM,
    fallbackOrientation: info.fallbackOrientation,
    fallbackPitchM: info.fallbackPitchM,
    fallbackBarWidthM: info.fallbackBarWidthM,
  });

  const applyToElement = () => {
    const next = patternIsEmpty(pattern) ? undefined : pattern;
    if (target.kind === "facade-element") {
      updateFacadeElement(target.id, { pattern: next });
    } else {
      updateExteriorElement(target.id, { pattern: next });
    }
    toast.success("Pola diterapkan ke elemen");
  };

  const resetPattern = () => {
    loadPattern({});
    if (target.kind === "facade-element") {
      updateFacadeElement(target.id, { pattern: undefined });
    } else {
      updateExteriorElement(target.id, { pattern: undefined });
    }
    toast.success("Pola dikembalikan ke bawaan");
  };

  const { data: presets, isLoading: presetsLoading } = useComponentPresets();
  const savePreset = useSaveComponentPreset();
  const deletePreset = useDeleteComponentPreset();

  const onSavePreset = () => {
    const name = presetName.trim();
    if (!name) {
      toast.error("Beri nama preset dulu");
      return;
    }
    savePreset.mutate(
      { name, family: presetFamily, pattern: { ...pattern } },
      {
        onSuccess: () => {
          toast.success(`Preset "${name}" tersimpan`);
          setPresetName("");
        },
        onError: () => toast.error("Gagal menyimpan preset"),
      }
    );
  };

  const onDeletePreset = (preset: ComponentPreset) => {
    deletePreset.mutate(preset.id, {
      onSuccess: () => toast.success(`Preset "${preset.name}" dihapus`),
      onError: () => toast.error("Gagal menghapus preset"),
    });
  };

  const locked = !!info.locked;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
      <p className="text-xs text-muted-foreground">{info.title}</p>

      {/* (b) preview SVG 2D generatif — proporsional widthM×heightM target */}
      <PatternPreview widthM={info.widthM} heightM={info.heightM} rects={rects} />

      {/* (a) form parameter pola */}
      <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Pitch (m)"
            value={pattern.pitchM ?? info.fallbackPitchM}
            step={0.01}
            min={0.05}
            max={1.5}
            onCommit={(v) => patch({ pitchM: v })}
          />
          <NumField
            label="Lebar bilah (m)"
            value={pattern.barWidthM ?? info.fallbackBarWidthM}
            step={0.01}
            min={0.02}
            max={0.5}
            onCommit={(v) => patch({ barWidthM: v })}
          />
          <NumField
            label="Kedalaman bilah (m)"
            value={pattern.barDepthM ?? info.fallbackBarDepthM}
            step={0.01}
            min={0.01}
            max={0.6}
            onCommit={(v) => patch({ barDepthM: v })}
          />
        </div>
        <Field label="Orientasi">
          <Select
            value={pattern.orientation ?? info.fallbackOrientation}
            onValueChange={(v) => patch({ orientation: v as ComponentPatternSpec["orientation"] })}
          >
            <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Orientasi pola">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ORIENTATION_LABELS) as NonNullable<ComponentPatternSpec["orientation"]>[]).map(
                (o) => (
                  <SelectItem key={o} value={o}>
                    {ORIENTATION_LABELS[o]}
                  </SelectItem>
                )
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
        {info.supportsFrame && (
          <ToggleRow
            label="Bingkai keliling"
            checked={!!pattern.frame}
            onChange={(v) => patch({ frame: v || undefined })}
          />
        )}
      </div>

      {/* (d) commit eksplisit ke entity — satu entri undo */}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={locked} onClick={applyToElement}>
          Terapkan ke elemen
        </Button>
        <Button variant="ghost" disabled={locked} onClick={resetPattern}>
          Reset
        </Button>
      </div>

      <Separator />

      {/* Simpan pola saat ini sebagai preset baru */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Simpan sebagai preset
        </p>
        <div className="flex gap-2">
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Nama preset, mis. Kisi Rapat 8cm"
            aria-label="Nama preset baru"
            className="flex-1"
          />
          <Select value={presetFamily} onValueChange={(v) => setPresetFamily(v as ComponentPresetFamily)}>
            <SelectTrigger size="sm" className="h-9 w-28 text-xs" aria-label="Kategori preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FAMILY_OPTIONS.map((f) => (
                <SelectItem key={f} value={f}>
                  {FAMILY_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={savePreset.isPending}
          onClick={onSavePreset}
        >
          {savePreset.isPending ? <Loader2 className="animate-spin" /> : <Library />}
          Simpan preset
        </Button>
      </div>

      <Separator />

      {/* (c) daftar Preset Saya */}
      <div className="space-y-2 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Preset Saya
        </p>
        {presetsLoading && (
          <p className="text-xs text-muted-foreground">Memuat preset…</p>
        )}
        {!presetsLoading && (presets?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">Belum ada preset tersimpan.</p>
        )}
        <ul className="space-y-1.5">
          {presets?.map((preset) => (
            <li
              key={preset.id}
              className="flex items-center gap-2 rounded-md border px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{preset.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {FAMILY_LABELS[preset.family]}
                  {preset.pattern.pitchM != null ? ` · pitch ${preset.pattern.pitchM}m` : ""}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => loadPattern(preset.pattern)}>
                Terapkan
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Hapus preset ${preset.name}`}
                disabled={deletePreset.isPending}
                onClick={() => onDeletePreset(preset)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Preview SVG 2D — viewBox proporsional widthM×heightM target, bilah dari
 * `componentPatternPreviewRects` (fungsi pure, lihat component-pattern-
 * preview.ts). Tanpa three.js/R3F: cukup <rect> murni, bundle tetap ringan.
 */
function PatternPreview({
  widthM,
  heightM,
  rects,
}: {
  widthM: number;
  heightM: number;
  rects: { x: number; y: number; w: number; h: number }[];
}) {
  if (!(widthM > 0) || !(heightM > 0)) return null;
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30 p-3">
      <svg
        viewBox={`0 0 ${widthM} ${heightM}`}
        className="h-40 w-full"
        role="img"
        aria-label="Pratinjau pola komponen"
      >
        <rect x={0} y={0} width={widthM} height={heightM} className="fill-background" />
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            className="fill-primary/70"
          />
        ))}
        <rect
          x={0}
          y={0}
          width={widthM}
          height={heightM}
          fill="none"
          className="stroke-border"
          strokeWidth={Math.max(widthM, heightM) * 0.006}
        />
      </svg>
    </div>
  );
}
