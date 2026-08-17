"use client";

/**
 * Section inspector kolaps — diangkat dari `AccordionSection` yang selama
 * ini terkunci un-exported di preview-controls.tsx (sehingga panel 2D &
 * interior tak bisa memakainya dan menumbuhkan heading ad-hoc sendiri).
 * Ikon opsional (panel 2D banyak section tanpa ikon).
 */

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function InspectorSection({
  icon: Icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {title}
          {badge && (
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {badge}
            </Badge>
          )}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="space-y-2.5 border-t px-3 pb-3 pt-2.5">{children}</div>}
    </div>
  );
}
