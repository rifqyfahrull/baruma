"use client";

/**
 * LightInspector terpadu (unifikasi P2 — kind ke-11 registry). Lampu interior
 * dulu HANYA bisa diedit di editor 2D interior (interior-workspace); kini
 * kind "light" punya kartu registry — UI 3D pertama untuk lampu, IDENTIK dgn
 * kind lain. Sama seperti furnitur: objek (`LightingFixture`) hidup di
 * `interior-store.plan`; seleksi dijembatani interior↔editor di
 * selection-bridge; aksi memanggil interior-store (undo/autosave tak berubah).
 */

import { Lightbulb, X } from "lucide-react";

import type { LightingFixture } from "@/types";
import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";
import { LIGHT_COLORS, LIGHT_LABELS } from "@/lib/interior/lighting";
import { LAMP_LOAD_VA } from "@/lib/electrical/electrical";
import { formatIDRRange } from "@/lib/format";
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
import { DeleteButton, Field } from "./fields";
import type { InspectorSurface } from "./registry";

const TEMP_LABEL = { warm: "Hangat", neutral: "Netral", cool: "Sejuk" } as const;

export function LightInspectorCard({ surface }: { surface: InspectorSurface }) {
  const ref = useEditorStore((s) =>
    s.selected?.kind === "light" ? s.selected : null,
  );
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const plan = useInteriorStore((s) => s.plan);
  const updateLight = useInteriorStore((s) => s.updateLight);
  const removeLight = useInteriorStore((s) => s.removeLight);

  const roomPlan = ref ? plan?.rooms.find((r) => r.roomId === ref.roomId) : undefined;
  const light = roomPlan?.lighting.find((l) => l.id === ref?.id);
  if (!ref || !light) return null;

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-lg border bg-background p-3",
        surface === "3d" && "border-primary/40",
      )}
      data-testid="light-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-amber-500" />
          <div>
            <p className="text-sm font-semibold">{LIGHT_LABELS[light.type]}</p>
            <p className="text-xs text-muted-foreground">
              {formatIDRRange(light.priceRange.low, light.priceRange.high)}
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

      <Field label="Tipe lampu">
        <Select
          value={light.type}
          onValueChange={(v) =>
            updateLight(ref.roomId, light.id, { type: v as LightingFixture["type"] })
          }
        >
          <SelectTrigger size="sm" className="w-full pointer-coarse:h-10" aria-label="Tipe lampu">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LIGHT_LABELS) as LightingFixture["type"][]).map((t) => (
              <SelectItem key={t} value={t}>
                {LIGHT_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Temperatur warna</p>
        <div className="flex gap-1.5" role="group" aria-label="Temperatur warna">
          {(["warm", "neutral", "cool"] as const).map((temp) => (
            <button
              key={temp}
              type="button"
              aria-pressed={light.colorTemperature === temp}
              onClick={() => updateLight(ref.roomId, light.id, { colorTemperature: temp })}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors pointer-coarse:py-2.5",
                light.colorTemperature === temp
                  ? "border-primary bg-primary/10 font-medium"
                  : "bg-background hover:bg-muted",
              )}
            >
              <span
                className="size-3 rounded-full border border-foreground/20"
                style={{ background: LIGHT_COLORS[temp] }}
              />
              {TEMP_LABEL[temp]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Jumlah">
          <Input
            type="number"
            min={1}
            value={light.qty}
            aria-label="Jumlah lampu"
            onChange={(e) => {
              const qty = Math.max(1, parseInt(e.target.value, 10) || 1);
              updateLight(ref.roomId, light.id, { qty });
            }}
            className="h-8 pointer-coarse:h-10"
          />
        </Field>
        <Field label="Watt/unit">
          <Input
            type="number"
            min={1}
            max={200}
            value={light.watt ?? LAMP_LOAD_VA[light.type]}
            aria-label="Watt per unit"
            onChange={(e) => {
              const watt = parseInt(e.target.value, 10);
              if (Number.isFinite(watt) && watt > 0)
                updateLight(ref.roomId, light.id, { watt });
            }}
            className="h-8 pointer-coarse:h-10"
          />
        </Field>
      </div>

      <Field label="Tinggi (m)">
        <Input
          type="number"
          min={0.5}
          step={0.1}
          value={light.heightM}
          aria-label="Tinggi lampu (meter)"
          onChange={(e) => {
            const heightM = parseFloat(e.target.value) || light.heightM;
            updateLight(ref.roomId, light.id, { heightM });
          }}
          className="h-8 pointer-coarse:h-10"
        />
      </Field>

      <DeleteButton
        entityLabel="lampu"
        onDelete={() => removeLight(ref.roomId, light.id)}
      />
    </div>
  );
}
