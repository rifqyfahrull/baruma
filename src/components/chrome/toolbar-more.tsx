"use client";

/**
 * `ToolbarMore` — SATU strategi overflow untuk `FloatingBar`: seluruh
 * fragmen sekunder (didefinisikan SEKALI di rail) dikumpulkan ke sini saat
 * mode compact, bukan diukur per-item atau diduplikasi jadi menu terpisah.
 *
 * Pakai `Popover`, BUKAN `DropdownMenu`: konten di dalamnya adalah fragmen
 * bar yang SAMA persis yang dirender inline saat expanded — berisi
 * `ToolButton`/`Pill` interaktif, bisa jadi bersarang Popover/DropdownMenu
 * lain (mis. palette searchable). `DropdownMenu` mengasumsikan isinya item
 * menu (role="menuitem", navigasi panah, auto-close per klik) yang akan
 * merusak interaktivitas anak-anak itu; `Popover` netral soal semantik
 * konten, portal-nya juga aman menampung Popover/DropdownMenu bersarang.
 */

import * as React from "react";
import { MoreVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToolButton } from "@/components/chrome/tool-button";
import { useFloatingBarContext } from "@/components/chrome/floating-bar";

export type ToolbarMoreProps = {
  label?: string;
  children: React.ReactNode;
  contentClassName?: string;
  "data-testid"?: string;
};

export function ToolbarMore({
  label = "Kontrol lainnya",
  children,
  contentClassName,
  "data-testid": testId,
}: ToolbarMoreProps) {
  const { tooltipSide } = useFloatingBarContext();

  return (
    <Popover>
      <PopoverTrigger asChild data-testid={testId}>
        <ToolButton label={label}>
          <MoreVertical />
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent
        side={tooltipSide}
        align="start"
        className={cn(
          "flex w-max max-w-72 flex-col gap-1 p-1",
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
