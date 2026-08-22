"use client";

/**
 * `ToolButton` — generalisasi dari `ToolButton` privat di
 * `editor-toolbar.tsx` (dulu 1 file, sekarang dipakai bersama rail 2D & 3D).
 * Mengunci kontrak: SATU idiom aktif (exclusive/soft), tooltip + aria-label
 * wajib (tanpa `title` native), sisi tooltip mengikuti orientasi bar induk.
 *
 * Kontrak komposisi KRITIS: seluruh `...rest` (termasuk `ref` sebagai prop —
 * React 19) diteruskan ke `Button` di dalam, supaya `DropdownMenuTrigger
 * asChild` / `PopoverTrigger asChild` yang membungkus `ToolButton` tetap
 * bekerja — Radix menyuntikkan `onClick`/`onPointerDown`/`aria-expanded`/dst
 * ke child langsungnya, jadi child itu (Button) yang harus menerimanya.
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ACTIVE_EXCLUSIVE_CLASS,
  ACTIVE_SOFT_CLASS,
  TOUCH_ICON_CLASS,
  useFloatingBarContext,
} from "@/components/chrome/floating-bar";

type ButtonProps = React.ComponentProps<typeof Button>;

export type ToolButtonProps = Omit<ButtonProps, "variant" | "size"> & {
  /** Wajib: jadi aria-label tombol + isi tooltip. */
  label: string;
  /** Ditambahkan sebagai sufiks tooltip, mis. " (Ctrl+Z)". */
  shortcut?: string;
  /** Saat diset, tombol jadi toggle: aria-pressed + gaya aktif. */
  pressed?: boolean;
  /** true = idiom exclusive (bg-primary solid); false/undefined = soft. */
  exclusive?: boolean;
};

export const ToolButton = React.forwardRef<HTMLButtonElement, ToolButtonProps>(
  function ToolButton(
    { label, shortcut, pressed, exclusive, className, children, ...rest },
    ref,
  ) {
    const { tooltipSide } = useFloatingBarContext();
    const isActive = pressed === true;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={pressed === undefined ? undefined : pressed}
            className={cn(
              TOUCH_ICON_CLASS,
              // Ghost hover (bg-muted) tetap dipertahankan untuk state
              // non-aktif; saat aktif, hover di-pin ke warna aktif itu
              // sendiri supaya tidak "berkedip" jadi abu-abu saat di-hover.
              isActive &&
                (exclusive
                  ? cn(ACTIVE_EXCLUSIVE_CLASS, "hover:bg-primary hover:text-primary-foreground")
                  : cn(ACTIVE_SOFT_CLASS, "hover:bg-primary/10")),
              className,
            )}
            {...rest}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {label}
          {shortcut}
        </TooltipContent>
      </Tooltip>
    );
  },
);
