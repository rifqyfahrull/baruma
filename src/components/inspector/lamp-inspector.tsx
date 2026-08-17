"use client";

/**
 * LampInspector terpadu (unifikasi P2) — migrasi dari `LampQuickEditor` 3D.
 * Lampu eksterior dulu HANYA bisa diedit dari 3D; kini kartu yang sama tampil
 * di panel 2D juga (seleksi lampu memang baru bisa lahir dari klik 3D, tapi
 * begitu terpilih, propertinya bisa diedit dari halaman mana pun). `surface`
 * hanya mengubah AKSI: hint "mode malam" (view-state 3D) tampil di 3D saja.
 */

import * as React from "react";
import { Library, Lightbulb, X } from "lucide-react";

import { effectiveLamps } from "@/lib/three/lamps";
import { exteriorLampWatt } from "@/lib/electrical/costing";
import { useEditorStore } from "@/stores/editor-store";
import { usePreviewStore } from "@/stores/preview-store";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DeleteButton, Field, NumField } from "./fields";
import type { InspectorSurface } from "./registry";

const LAMP_KIND_LABELS: Record<string, string> = {
  wall: "Lampu dinding",
  bollard: "Lampu taman (bollard)",
  canopy: "Downlight kanopi",
};

export function LampInspectorCard({ surface }: { surface: InspectorSurface }) {
  const lampId = useEditorStore((s) =>
    s.selected?.kind === "lamp" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const updateLamp = useEditorStore((s) => s.updateLamp);
  const deleteRef = useEditorStore((s) => s.deleteRef);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const nightMode = usePreviewStore((s) => s.nightMode);
  const setNightMode = usePreviewStore((s) => s.setNightMode);

  const lamp = layout ? effectiveLamps(layout).find((l) => l.id === lampId) : undefined;
  if (!lamp) return null;

  return (
    <div
      className="space-y-2.5 rounded-lg border border-primary/40 bg-background p-3"
      data-testid="lamp-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-primary" />
          <div>
            <p className="text-sm font-semibold">{LAMP_KIND_LABELS[lamp.kind]}</p>
            <p className="text-xs text-muted-foreground">
              ({lamp.x.toFixed(1)}, {lamp.y.toFixed(1)}) m
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor lampu"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Aksi khusus surface 3D: nyalakan mode malam supaya cahayanya terlihat. */}
      {surface === "3d" && !nightMode && (
        <button
          type="button"
          onClick={() => setNightMode(true)}
          className="w-full rounded-md bg-muted/50 p-2 text-left text-[11px] text-muted-foreground hover:bg-muted"
        >
          Cahaya lampu terlihat di{" "}
          <span className="font-medium text-foreground">mode malam</span> — klik
          untuk mengaktifkan.
        </button>
      )}

      <Field label="Warna cahaya">
        <div className="flex items-center gap-2">
          <input
            type="color"
            defaultValue={lamp.color ?? "#ffc98a"}
            onBlur={(e) => updateLamp(lamp.id, { color: e.target.value })}
            aria-label="Warna cahaya lampu"
            className="h-8 w-14 cursor-pointer rounded border bg-background p-0.5 pointer-coarse:h-10"
          />
          <span className="text-[11px] text-muted-foreground">
            {lamp.color ?? "hangat (bawaan)"}
          </span>
          {lamp.color && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs pointer-coarse:h-9"
              onClick={() => updateLamp(lamp.id, { color: undefined })}
            >
              Reset
            </Button>
          )}
        </div>
      </Field>

      <Field
        label={`Intensitas — ${(lamp.intensity ?? 1).toFixed(1)}×${
          (lamp.intensity ?? 1) === 0 ? " (mati)" : ""
        }`}
      >
        <Slider
          min={0}
          max={2}
          step={0.1}
          defaultValue={[lamp.intensity ?? 1]}
          onValueCommit={([v]) =>
            updateLamp(lamp.id, { intensity: Math.round(v * 10) / 10 })
          }
          aria-label="Intensitas lampu"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <NumField
          key={`lw-${lamp.id}`}
          label="Daya (Watt)"
          value={exteriorLampWatt(lamp)}
          onCommit={(v) => v > 0 && v <= 200 && updateLamp(lamp.id, { watt: Math.round(v) })}
        />
        {lamp.kind === "wall" && (
          <NumField
            key={`lh-${lamp.id}`}
            label="Tinggi pasang (m)"
            value={lamp.mountH}
            onCommit={(v) =>
              v > 0.2 && v < 3 && updateLamp(lamp.id, { mountH: Math.round(v * 100) / 100 })
            }
          />
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Watt memengaruhi beban sirkuit, RAB listrik, dan estimasi tagihan bulanan.
      </p>

      <div className="space-y-1.5">
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          data-testid="lamp-pick-model"
          onClick={() => requestAssetPicker({ type: "lamp", id: lamp.id })}
        >
          <Library /> {lamp.modelUrl ? "Ganti model 3D lampu" : "Pakai model 3D dari Library"}
        </Button>
        {lamp.modelUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-xs"
            onClick={() => updateLamp(lamp.id, { modelAssetId: null, modelUrl: null })}
          >
            Lepas model — kembali ke fixture bawaan
          </Button>
        )}
      </div>

      <DeleteButton
        entityLabel="lampu"
        onDelete={() => deleteRef({ kind: "lamp", id: lamp.id })}
      />
    </div>
  );
}
