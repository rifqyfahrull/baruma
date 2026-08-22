"use client";

/**
 * `Pill` — idiom tombol pill untuk pill-bar horizontal (switcher lantai,
 * konteks [2D|3D], dsb). Sama seperti `ToolButton`, satu spec aktif
 * (exclusive/soft) dan target sentuh pointer-coarse — tapi punya label teks
 * + ikon opsional (leading/trailing), bukan ikon murni.
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  ACTIVE_EXCLUSIVE_CLASS,
  ACTIVE_SOFT_CLASS,
  TOUCH_PILL_CLASS,
} from "@/components/chrome/floating-bar";

export type PillProps = Omit<React.ComponentProps<"button">, "onClick"> & {
  pressed: boolean;
  /** true = idiom exclusive (bg-primary solid); false/undefined = soft. */
  exclusive?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  label?: string;
  "data-testid"?: string;
};

export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  function Pill(
    {
      pressed,
      exclusive,
      onClick,
      icon,
      trailingIcon,
      label,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={pressed}
        aria-label={label}
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
          TOUCH_PILL_CLASS,
          pressed
            ? exclusive
              ? cn(ACTIVE_EXCLUSIVE_CLASS, "hover:bg-primary hover:text-primary-foreground")
              : cn(ACTIVE_SOFT_CLASS, "hover:bg-primary/10")
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
        {trailingIcon}
      </button>
    );
  },
);
