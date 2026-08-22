"use client";

/**
 * `FloatingBar` — SATU spec kontainer floating untuk rail/pill-bar kanvas
 * (2D & 3D). Sebelum ini ada 4 kontainer floating hand-rolled dengan 3
 * kombinasi radius/bg berbeda dan 3 cara berbeda merender state "aktif"
 * (lihat docs/UNIFIKASI_UI_EDITOR.md). Primitif ini + `ToolButton` + `Pill`
 * mengunci satu grammar: kontainer `rounded-xl`, tombol anak `rounded-lg`
 * (default Button).
 *
 * Konstanta kelas di bawah di-export supaya fase-fase berikutnya (dan
 * `PanelTab` di `floating-panel.tsx`) mereferensikan SATU sumber kebenaran,
 * bukan menyalin string tailwind lagi.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

/** Permukaan floating standar: kontainer rail, panel, pill bar. */
export const CHROME_SURFACE_CLASS =
  "rounded-xl border bg-card/95 shadow-sm backdrop-blur";

/** State aktif EKSKLUSIF (tool aktif, view preset, lantai aktif 2D) — hanya
 * satu opsi dalam grup yang bisa aktif sekaligus. */
export const ACTIVE_EXCLUSIVE_CLASS = "bg-primary text-primary-foreground";

/** State aktif TOGGLE independen (snap, visibilitas, PanelTab, lantai 3D)
 * — banyak opsi bisa aktif bersamaan. */
export const ACTIVE_SOFT_CLASS = "bg-primary/10 text-foreground";

/** Target sentuh minimum di layar pointer-coarse (tablet) — ikon. */
export const TOUCH_ICON_CLASS = "pointer-coarse:size-10";

/** Target sentuh minimum di layar pointer-coarse (tablet) — pill/pill-like. */
export const TOUCH_PILL_CLASS = "pointer-coarse:py-2.5";

export type FloatingBarOrientation = "vertical" | "horizontal";

type FloatingBarContextValue = {
  orientation: FloatingBarOrientation;
  /** Sisi tooltip yang cocok dengan orientasi bar: rail vertikal → tooltip
   * di kanan; pill bar horizontal → tooltip di bawah. */
  tooltipSide: "right" | "bottom";
};

const FloatingBarContext = React.createContext<FloatingBarContextValue | null>(
  null,
);

const DEFAULT_CONTEXT: FloatingBarContextValue = {
  orientation: "vertical",
  tooltipSide: "right",
};

/** Konteks orientasi bar terdekat. Di luar `FloatingBar` (mis. `ToolButton`
 * dipakai lepas), default ke vertikal/kanan. */
export function useFloatingBarContext(): FloatingBarContextValue {
  const ctx = React.useContext(FloatingBarContext);
  return ctx ?? DEFAULT_CONTEXT;
}

function tooltipSideFor(orientation: FloatingBarOrientation): "right" | "bottom" {
  return orientation === "vertical" ? "right" : "bottom";
}

export type FloatingBarProps = React.ComponentProps<"div"> & {
  orientation?: FloatingBarOrientation;
};

/**
 * Kontainer rail/pill-bar floating. `orientation="vertical"` (default) =
 * rail kolom kiri kanvas; `"horizontal"` = pill bar baris (mis. floor
 * switcher).
 */
export const FloatingBar = React.forwardRef<HTMLDivElement, FloatingBarProps>(
  function FloatingBar({ orientation = "vertical", className, children, ...rest }, ref) {
    const value = React.useMemo<FloatingBarContextValue>(
      () => ({ orientation, tooltipSide: tooltipSideFor(orientation) }),
      [orientation],
    );

    return (
      <FloatingBarContext.Provider value={value}>
        <div
          ref={ref}
          data-slot="floating-bar"
          data-orientation={orientation}
          className={cn(
            "flex gap-1 p-1",
            orientation === "vertical" ? "flex-col" : "flex-row items-center",
            CHROME_SURFACE_CLASS,
            className,
          )}
          {...rest}
        >
          {children}
        </div>
      </FloatingBarContext.Provider>
    );
  },
);

export type FloatingBarSeparatorProps = React.ComponentProps<"div">;

/** Divider satu-satunya idiom untuk memisah grup di dalam `FloatingBar` —
 * orientasi otomatis mengikuti bar induk (via konteks). */
export function FloatingBarSeparator({
  className,
  ...rest
}: FloatingBarSeparatorProps) {
  const { orientation } = useFloatingBarContext();
  return (
    <div
      data-slot="floating-bar-separator"
      role="separator"
      aria-orientation={orientation === "vertical" ? "horizontal" : "vertical"}
      className={cn(
        orientation === "vertical"
          ? "my-0.5 h-px w-6 bg-border"
          : "mx-0.5 h-5 w-px bg-border",
        className,
      )}
      {...rest}
    />
  );
}
