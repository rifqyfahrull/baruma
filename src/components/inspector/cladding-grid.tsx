"use client";

/**
 * Grid swatch cladding katalog — dipakai kartu Wall (fasad dinding) DAN kartu
 * Exterior (material panel/kolom/kanopi). Markup persis pindahan dari
 * wall-inspector (kontrak e2e preview-3d-optim: swatch = button[title]).
 *
 * TODO: StyleTilePicker (UNIFIKASI §3.5) — swatch bertekstur/berwarna ini
 * sengaja TIDAK dimigrasi ke SegmentedControl (Fase 7): idiomnya beda (grid
 * ubin visual, bukan label teks) dan butuh picker khusus sendiri.
 */

import { FACADE_CLADDINGS } from "@/lib/three/facade-claddings";
import { cn } from "@/lib/utils";

export function CladdingGrid({
  current,
  onPick,
  keyPrefix = "",
}: {
  current: string | null;
  onPick: (id: string) => void;
  keyPrefix?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {FACADE_CLADDINGS.map((c) => (
        <button
          key={`${keyPrefix}${c.id}`}
          type="button"
          aria-pressed={current === c.id}
          title={c.label}
          onClick={() => onPick(c.id)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors hover:bg-muted",
            current === c.id && "border-primary bg-primary/10",
          )}
        >
          <span
            className="h-7 w-full rounded border"
            style={
              c.visual.mapUrl
                ? {
                    backgroundImage: `url(${c.visual.mapUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : { background: c.swatch }
            }
          />
          <span className="w-full truncate text-center text-[10px] leading-tight">
            {c.label}
          </span>
        </button>
      ))}
    </div>
  );
}
