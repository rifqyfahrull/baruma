"use client";

/**
 * Inspector registry (unifikasi P2) — SATU inspector per jenis komponen
 * bangunan, dirender IDENTIK di panel kanan 2D dan 3D. `EntityInspector`
 * membaca seleksi terpadu (EntityRef di editor-store) dan me-render inspector
 * yang terdaftar untuk kind-nya; kind yang belum termigrasi mengembalikan
 * null (kartu/inspector lamanya masih menangani).
 *
 * Kontrak `surface` (docs/UNIFIKASI_UI_EDITOR.md §3.4): hanya boleh mengubah
 * AKSI/chrome (fokus kamera, gaya bingkai kartu) — TIDAK PERNAH mengubah
 * field, urutan, atau widget. Fallback tanpa-seleksi bukan urusan registry
 * (SummaryInspector 2D / navigator 3D tetap milik host masing-masing).
 */

import * as React from "react";

import { useEditorStore } from "@/stores/editor-store";
import type { EntityKind } from "@/types/entity-ref";
import { OpeningInspectorCard } from "./opening-inspector";
import { LampInspectorCard } from "./lamp-inspector";
import { RailingInspectorCard } from "./railing-inspector";
import { ExteriorInspectorCard } from "./exterior-inspector";
import { WallInspectorCard } from "./wall-inspector";
import { RoofInspectorCard } from "./roof-inspector";
import { RoomInspectorCard } from "./room-inspector";
import { SkylightInspectorCard } from "./skylight-inspector";
import { FurnitureInspectorCard } from "./furniture-inspector";
import { LightInspectorCard } from "./light-inspector";

export type InspectorSurface = "2d" | "3d";

const REGISTRY: Partial<
  Record<EntityKind, React.ComponentType<{ surface: InspectorSurface }>>
> = {
  opening: OpeningInspectorCard,
  lamp: LampInspectorCard,
  railing: RailingInspectorCard,
  exterior: ExteriorInspectorCard,
  wall: WallInspectorCard,
  roof: RoofInspectorCard,
  roofZone: RoofInspectorCard,
  room: RoomInspectorCard,
  skylight: SkylightInspectorCard,
  furniture: FurnitureInspectorCard,
  light: LightInspectorCard,
};

/** Kind yang inspector terpadunya sudah tersedia (host lama harus mundur). */
export function isUnifiedInspectorKind(kind: EntityKind | null): boolean {
  return kind !== null && kind in REGISTRY;
}

export function EntityInspector({ surface }: { surface: InspectorSurface }) {
  const kind = useEditorStore((s) => s.selected?.kind ?? null);
  const Component = kind ? REGISTRY[kind] : undefined;
  if (!Component) return null;
  return <Component surface={surface} />;
}
