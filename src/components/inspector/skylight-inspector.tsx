"use client";

/**
 * SkylightInspector terpadu (Fase B plan ARSITEKTUR_MODERN) — kartu kind
 * "skylight" di registry, identik di 2D & 3D. Skylight = rect kaca pada
 * bidang atap DATAR (atap datar / dak rooftop / zona datar); posisinya
 * digeser di layer Atap 2D (drag + auto-fit) atau via NumField di sini.
 */

import { Sun, X } from "lucide-react";

import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DeleteButton, NumField, SegmentedControl } from "./fields";
import type { InspectorSurface } from "./registry";

const KIND_OPTIONS = [
  { value: "fixed", label: "Kaca mati" },
  { value: "operable", label: "Bisa dibuka" },
] as const;

export function SkylightInspectorCard({ surface }: { surface: InspectorSurface }) {
  const id = useEditorStore((s) =>
    s.selected?.kind === "skylight" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const updateSkylight = useEditorStore((s) => s.updateSkylight);
  const deleteRef = useEditorStore((s) => s.deleteRef);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const sk = id ? layout?.skylights?.find((k) => k.id === id) : undefined;
  if (!sk) return null;

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-lg border bg-background p-3",
        surface === "3d" && "border-primary/40",
      )}
      data-testid="skylight-inspector"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sun className="size-4 text-amber-500" />
          <div>
            <p className="text-sm font-semibold">Skylight</p>
            <p className="text-xs text-muted-foreground">
              {sk.widthM.toFixed(1)} × {sk.depthM.toFixed(1)} m · cahaya zenithal
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor skylight"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField
          key={`skw-${sk.id}`}
          label="Lebar (m)"
          value={sk.widthM}
          min={0.4}
          step={0.1}
          onCommit={(v) => v > 0 && updateSkylight(sk.id, { widthM: v })}
        />
        <NumField
          key={`skd-${sk.id}`}
          label="Dalam (m)"
          value={sk.depthM}
          min={0.4}
          step={0.1}
          onCommit={(v) => v > 0 && updateSkylight(sk.id, { depthM: v })}
        />
        <NumField
          key={`skx-${sk.id}`}
          label="Posisi X (m)"
          value={sk.x}
          step={0.1}
          onCommit={(v) => updateSkylight(sk.id, { x: v })}
        />
        <NumField
          key={`sky-${sk.id}`}
          label="Posisi Y (m)"
          value={sk.y}
          step={0.1}
          onCommit={(v) => updateSkylight(sk.id, { y: v })}
        />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Jenis</p>
        <SegmentedControl
          value={sk.kind}
          onChange={(v) => updateSkylight(sk.id, { kind: v })}
          options={KIND_OPTIONS}
          ariaLabel="Jenis skylight"
        />
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Geser posisinya di layer &quot;Atap&quot; 2D (auto-fit ke tepi ruang di
        bawahnya). Berkas cahaya matahari tampak di mode Realistis.
      </p>

      <DeleteButton
        entityLabel="skylight"
        onDelete={() => deleteRef({ kind: "skylight", id: sk.id })}
      />
    </div>
  );
}
