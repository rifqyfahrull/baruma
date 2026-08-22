"use client";

/**
 * Rail 2D — direstrukturisasi total di Fase 3 (unifikasi UI editor, lihat
 * plan `dynamic-enchanting-alpaca.md` §Fase 3): dari ~25 tombol ikon tanpa
 * label dalam satu kolom (meluber di 720p, e2e terpaksa pakai viewport
 * 1280×1400) menjadi 11 tombol + 2 label grup di atas primitif Fase 1
 * (`FloatingBar`/`ToolButton`/`ToolbarMore`, satu spec surface & state
 * aktif). Tipe yang dulu punya dropdown/tombol sendiri (ruang, listrik,
 * air, elemen eksterior, template fasad) sekarang hidup di dalam palette
 * searchable (`ui/command`) di balik SATU tombol kategori — pilihan
 * men-set `pendingPlacement {tool, variant}` di store (menggantikan 5
 * field `pending*Type` terpisah) + tampilkan chip kecil di rail sampai
 * ditempatkan/dibatalkan.
 *
 * Fase 5: tombol ke-12 "Fokus" ditambahkan di slot terakhir (hook
 * `useFokusMode`, sama dgn rail 3D `view-toolbar.tsx`) — total kini 12
 * tombol + 2 label grup.
 */

import * as React from "react";
import {
  AppWindow,
  ArrowDownToDot,
  DoorOpen,
  Fence,
  Focus,
  Hand,
  MousePointer2,
  Plug,
  Redo2,
  Settings2,
  SquarePlus,
  Undo2,
  X,
} from "lucide-react";

import type {
  ElectricalPointType,
  ExteriorElementKind,
  RoofZone,
  RoomType,
  WaterPointType,
} from "@/types";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectCapabilities } from "@/hooks/use-project-capabilities";
import { useToolbarCompact } from "@/hooks/use-toolbar-compact";
import { useUnifiedUndo } from "@/hooks/use-unified-undo";
import { useFokusMode } from "@/hooks/use-fokus-mode";
import {
  ELECTRICAL_POINT_TYPES,
  ROOM_TYPES,
  WATER_POINT_TYPES,
} from "@/lib/constants";
import { track } from "@/lib/analytics";
import { LENGTH_UNITS, type LengthUnit } from "@/lib/format";
import { FACADE_COMPOSER_TEMPLATES } from "@/lib/exterior/facade-templates";
import { EXTERIOR_KIND_LABELS } from "@/lib/exterior/labels";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  FloatingBar,
  FloatingBarSeparator,
} from "@/components/chrome/floating-bar";
import { ToolButton } from "@/components/chrome/tool-button";
import { ToolbarMore } from "@/components/chrome/toolbar-more";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const ROOF_ZONE_LABELS: Record<RoofZone["type"], string> = {
  datar: "Dak datar",
  pelana: "Atap pelana",
  limasan: "Atap limasan",
  miring: "Atap miring",
};

/** Pengelompokan 27 kind elemen eksterior (`EXTERIOR_KIND_LABELS`) untuk
 *  palette searchable — kategori murni UI, tidak mengubah model data. */
const EXTERIOR_ELEMENT_GROUPS: {
  heading: string;
  kinds: ExteriorElementKind[];
}[] = [
  {
    heading: "Dinding & pagar",
    kinds: [
      "boundary_wall",
      "fence",
      "sliding_gate",
      "swing_gate",
      "pedestrian_gate",
      "solid_wall",
    ],
  },
  {
    heading: "Struktur",
    kinds: [
      "column",
      "chimney",
      "beam",
      "slab",
      "portal_frame",
      "gable_frame",
      "exterior_stair",
    ],
  },
  {
    heading: "Kanopi & panel",
    kinds: ["facade_panel", "canopy", "overhang_slab", "pergola", "planter"],
  },
  {
    heading: "Permukaan",
    kinds: ["driveway", "walkway", "terrace_surface", "garden_bed"],
  },
  {
    heading: "Aset & vegetasi",
    kinds: ["asset", "plant", "tree", "exterior_decor", "vehicle"],
  },
];

/** Label grup kecil (10px, uppercase) di dalam rail vertikal — lokal di
 *  toolbar ini (bukan di `floating-bar.tsx`) supaya tidak bentrok dgn agen
 *  paralel Fase 4 yang juga mungkin menambahkannya untuk rail 3D. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1.5 pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

/** Baris toggle di dalam popover — idiom yang sama dengan `view-toolbar.tsx`
 *  (dibaca sebagai referensi, tidak diimpor — tetap dua permukaan berdiri
 *  sendiri sampai unifikasi rail 3D di Fase 4). */
function ToggleLine({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Chip kecil di bawah tombol kategori aktif, menampilkan label varian
 *  `pendingPlacement` yang sedang menunggu ditempatkan di kanvas —
 *  menggantikan caption teks mengambang lama. */
function PendingChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] leading-tight text-foreground">
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label="Batalkan pilihan penempatan"
        onClick={onClear}
        className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}

export function EditorToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const pendingPlacement = useEditorStore((s) => s.pendingPlacement);
  const setPendingPlacement = useEditorStore((s) => s.setPendingPlacement);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const showDimensions = useEditorStore((s) => s.showDimensions);
  const toggleDimensions = useEditorStore((s) => s.toggleDimensions);
  const dimensionUnit = useEditorStore((s) => s.dimensionUnit);
  const setDimensionUnit = useEditorStore((s) => s.setDimensionUnit);
  const showCrossFloorRooms = useEditorStore((s) => s.showCrossFloorRooms);
  const setShowCrossFloorRooms = useEditorStore(
    (s) => s.setShowCrossFloorRooms,
  );
  const showHiddenExteriorElements = useEditorStore(
    (s) => s.showHiddenExteriorElements,
  );
  const setShowHiddenExteriorElements = useEditorStore(
    (s) => s.setShowHiddenExteriorElements,
  );
  const showRoofZones = useEditorStore((s) => s.showRoofZones);
  const setShowRoofZones = useEditorStore((s) => s.setShowRoofZones);
  const showHiddenRoofZones = useEditorStore((s) => s.showHiddenRoofZones);
  const setShowHiddenRoofZones = useEditorStore(
    (s) => s.setShowHiddenRoofZones,
  );
  const applyExteriorTemplate = useEditorStore((s) => s.applyExteriorTemplate);
  // Gating rollout §21: hanya creation UI yang disembunyikan saat flag off —
  // elemen existing tetap dirender/di-edit (rollback tidak menghapus data).
  const projectId = useEditorStore((s) => s.layout?.projectId);
  const capabilities = useProjectCapabilities(projectId);
  const confirm = useConfirm();
  const { fokusMode, toggle: toggleFokus } = useFokusMode();

  // Undo/redo terpadu — di 2D stack interior nyaris tak relevan (tak ada
  // furniture/light di sini), tapi memakai hook yang sama menjaga paritas
  // dgn rail 3D & satu sumber kebenaran routing (lihat use-unified-undo.ts).
  const { undo, redo, canUndo, canRedo } = useUnifiedUndo();

  const [roomOpen, setRoomOpen] = React.useState(false);
  const [utilityOpen, setUtilityOpen] = React.useState(false);
  const [exteriorOpen, setExteriorOpen] = React.useState(false);

  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const compact = useToolbarCompact(toolbarRef);

  const clearPending = () => setPendingPlacement(null);

  // ── Grup "Bangun" + "Tampilan" — SATU fragmen dipakai inline (desktop)
  // ATAU di dalam ToolbarMore (compact/tablet), tidak pernah diduplikasi.
  // Undo/Redo di luar fragmen ini (selalu inline, lihat return di bawah).
  const secondaryFragment = (
    <>
      <FloatingBarSeparator />

      <ToolButton
        label="Pilih / geser (V)"
        pressed={activeTool === "select"}
        exclusive
        onClick={() => setTool("select")}
      >
        <MousePointer2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Geser kanvas (Space)"
        pressed={activeTool === "pan"}
        exclusive
        onClick={() => setTool("pan")}
      >
        <Hand className="size-4" />
      </ToolButton>

      <GroupLabel>Bangun</GroupLabel>

      <Popover open={roomOpen} onOpenChange={setRoomOpen}>
        <PopoverTrigger asChild>
          <ToolButton
            label="Tambah ruang"
            pressed={activeTool === "room"}
            exclusive
          >
            <SquarePlus className="size-4" />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Cari tipe ruang…" />
            <CommandList>
              <CommandEmpty>Tidak ada hasil.</CommandEmpty>
              <CommandGroup>
                {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
                  <CommandItem
                    key={t}
                    value={ROOM_TYPES[t].label}
                    onSelect={() => {
                      setPendingPlacement({ tool: "room", variant: t });
                      setTool("room");
                      setRoomOpen(false);
                    }}
                  >
                    {ROOM_TYPES[t].label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {pendingPlacement &&
        pendingPlacement.tool === "room" &&
        pendingPlacement.variant && (
          <PendingChip
            label={ROOM_TYPES[pendingPlacement.variant as RoomType].label}
            onClear={clearPending}
          />
        )}

      <ToolButton
        label="Tambah pintu"
        pressed={activeTool === "door"}
        exclusive
        onClick={() => setTool("door")}
      >
        <DoorOpen className="size-4" />
      </ToolButton>
      <ToolButton
        label="Tambah jendela"
        pressed={activeTool === "window"}
        exclusive
        onClick={() => setTool("window")}
      >
        <AppWindow className="size-4" />
      </ToolButton>
      <ToolButton
        label="Tambah tangga"
        pressed={activeTool === "stair"}
        exclusive
        onClick={() => setTool("stair")}
      >
        <ArrowDownToDot className="size-4" />
      </ToolButton>

      <Popover open={utilityOpen} onOpenChange={setUtilityOpen}>
        <PopoverTrigger asChild>
          <ToolButton
            label="Utilitas (listrik & air)"
            pressed={activeTool === "electrical" || activeTool === "water"}
            exclusive
          >
            <Plug className="size-4" />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Cari titik listrik/air…" />
            <CommandList>
              <CommandEmpty>Tidak ada hasil.</CommandEmpty>
              <CommandGroup heading="Listrik">
                {(
                  Object.keys(ELECTRICAL_POINT_TYPES) as ElectricalPointType[]
                ).map((t) => (
                  <CommandItem
                    key={t}
                    value={ELECTRICAL_POINT_TYPES[t]}
                    onSelect={() => {
                      setPendingPlacement({ tool: "electrical", variant: t });
                      setTool("electrical");
                      setUtilityOpen(false);
                    }}
                  >
                    {ELECTRICAL_POINT_TYPES[t]}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Air">
                {(Object.keys(WATER_POINT_TYPES) as WaterPointType[]).map(
                  (t) => (
                    <CommandItem
                      key={t}
                      value={WATER_POINT_TYPES[t]}
                      onSelect={() => {
                        setPendingPlacement({ tool: "water", variant: t });
                        setTool("water");
                        setUtilityOpen(false);
                      }}
                    >
                      {WATER_POINT_TYPES[t]}
                    </CommandItem>
                  ),
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {pendingPlacement &&
        pendingPlacement.tool === "electrical" &&
        pendingPlacement.variant && (
          <PendingChip
            label={
              ELECTRICAL_POINT_TYPES[
                pendingPlacement.variant as ElectricalPointType
              ]
            }
            onClear={clearPending}
          />
        )}
      {pendingPlacement &&
        pendingPlacement.tool === "water" &&
        pendingPlacement.variant && (
          <PendingChip
            label={
              WATER_POINT_TYPES[pendingPlacement.variant as WaterPointType]
            }
            onClear={clearPending}
          />
        )}

      {(capabilities.roof_zones_v1 || capabilities.exterior_elements_v1) && (
        <>
          <Popover open={exteriorOpen} onOpenChange={setExteriorOpen}>
            <PopoverTrigger asChild>
              <ToolButton
                label="Eksterior"
                pressed={
                  activeTool === "exterior" || activeTool === "roofZone"
                }
                exclusive
              >
                <Fence className="size-4" />
              </ToolButton>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-72 p-0">
              <Command>
                <CommandInput placeholder="Cari elemen, zona atap, atau template…" />
                <CommandList>
                  <CommandEmpty>Tidak ada hasil.</CommandEmpty>
                  {capabilities.roof_zones_v1 && (
                    <CommandGroup heading="Zona atap">
                      {(
                        Object.keys(ROOF_ZONE_LABELS) as RoofZone["type"][]
                      ).map((t) => (
                        <CommandItem
                          key={t}
                          value={ROOF_ZONE_LABELS[t]}
                          onSelect={() => {
                            setPendingPlacement({
                              tool: "roofZone",
                              variant: t,
                            });
                            setTool("roofZone");
                            setExteriorOpen(false);
                          }}
                        >
                          {ROOF_ZONE_LABELS[t]}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {capabilities.exterior_elements_v1 &&
                    EXTERIOR_ELEMENT_GROUPS.map((group) => (
                      <CommandGroup key={group.heading} heading={group.heading}>
                        {group.kinds.map((k) => (
                          <CommandItem
                            key={k}
                            value={EXTERIOR_KIND_LABELS[k]}
                            onSelect={() => {
                              setPendingPlacement({
                                tool: "exterior",
                                variant: k,
                              });
                              setTool("exterior");
                              setExteriorOpen(false);
                            }}
                          >
                            {EXTERIOR_KIND_LABELS[k]}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  {capabilities.exterior_elements_v1 && (
                    <CommandGroup heading="Template tampak depan">
                      {FACADE_COMPOSER_TEMPLATES.map((template) => (
                        <CommandItem
                          key={template.id}
                          value={template.label}
                          onSelect={() => {
                            setExteriorOpen(false);
                            void (async () => {
                              const accepted = await confirm({
                                title: `Terapkan ${template.label}?`,
                                description:
                                  "Komposisi template sebelumnya dan material fasad akan diganti. Elemen manual tetap dipertahankan dan perubahan dapat di-Undo.",
                              });
                              if (accepted) {
                                applyExteriorTemplate(template.id);
                                track("exterior_template_applied", {
                                  template_id: template.id,
                                  source: "editor_toolbar",
                                });
                              }
                            })();
                          }}
                        >
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="font-medium">
                              {template.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {template.description}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {pendingPlacement &&
            pendingPlacement.tool === "exterior" &&
            pendingPlacement.variant && (
              <PendingChip
                label={
                  EXTERIOR_KIND_LABELS[
                    pendingPlacement.variant as ExteriorElementKind
                  ]
                }
                onClear={clearPending}
              />
            )}
          {pendingPlacement &&
            pendingPlacement.tool === "roofZone" &&
            pendingPlacement.variant && (
              <PendingChip
                label={
                  ROOF_ZONE_LABELS[
                    pendingPlacement.variant as RoofZone["type"]
                  ]
                }
                onClear={clearPending}
              />
            )}
        </>
      )}

      <FloatingBarSeparator />
      <GroupLabel>Tampilan</GroupLabel>

      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Tampilan">
            <Settings2 className="size-4" />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-64 space-y-0.5">
          <p className="pb-1 text-xs font-semibold">Tampilan</p>
          <ToggleLine
            label="Snap grid"
            checked={snapEnabled}
            onChange={() => toggleSnap()}
          />
          <ToggleLine
            label="Dimensi"
            checked={showDimensions}
            onChange={() => toggleDimensions()}
          />
          {showDimensions && (
            <div className="flex items-center justify-between gap-3 py-1 pl-1 text-xs">
              <span className="text-muted-foreground">Satuan</span>
              <Select
                value={dimensionUnit}
                onValueChange={(v) => setDimensionUnit(v as LengthUnit)}
              >
                <SelectTrigger
                  className="h-7 w-28 text-xs"
                  aria-label={`Satuan dimensi: ${dimensionUnit}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LENGTH_UNITS.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <ToggleLine
            label="Tampilkan lantai lain"
            checked={showCrossFloorRooms}
            onChange={setShowCrossFloorRooms}
          />
          <ToggleLine
            label="Tampilkan tersembunyi"
            checked={showHiddenExteriorElements}
            onChange={setShowHiddenExteriorElements}
          />
          {capabilities.roof_zones_v1 && (
            <>
              <ToggleLine
                label="Area atap"
                checked={showRoofZones}
                onChange={setShowRoofZones}
              />
              <ToggleLine
                label="Zona atap tersembunyi"
                checked={showHiddenRoofZones}
                onChange={setShowHiddenRoofZones}
              />
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Fokus — slot ke-12 (Fase 5), hook & testid sama dgn rail 3D
          (view-toolbar.tsx) supaya perilaku & spec-nya identik di kedua
          permukaan; label "Mode fokus" simetris dgn 3D. */}
      <ToolButton
        label="Mode fokus"
        pressed={fokusMode}
        data-testid="clean-mode-toggle"
        onClick={toggleFokus}
      >
        <Focus className="size-4" />
      </ToolButton>
    </>
  );

  return (
    <FloatingBar ref={toolbarRef}>
      <ToolButton
        label="Undo"
        shortcut=" (Ctrl+Z)"
        onClick={undo}
        disabled={!canUndo}
      >
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="Redo"
        shortcut=" (Ctrl+Y)"
        onClick={redo}
        disabled={!canRedo}
      >
        <Redo2 className="size-4" />
      </ToolButton>

      {/*
       * Budget tinggi rail — HARUS < 672px supaya desktop 720p tak pernah
       * memicu compact (fallback tinggal untuk tablet/mobile via
       * useToolbarCompact = lebar sempit ATAU tinggi konten nyata melebihi
       * viewport):
       *   12 tombol ikon × 32px (Button size="icon", +Fokus Fase 5) = 384px
       *   2 label grup ("Bangun"/"Tampilan") × ~18px        =  36px
       *   2 separator (h-px + margin my-0.5) × ~5px         =  10px
       *   gap-1 (4px) antar 16 child langsung FloatingBar    =  60px
       *   padding kontainer p-1 (atas + bawah)               =   8px
       *   -------------------------------------------------------
       *   total ≈ 498px (chip pending kondisional +1 baris ~20px saat
       *   aktif memilih varian — tetap ≪ 672px).
       */}
      {compact ? (
        <ToolbarMore data-testid="editor-toolbar-more">
          {secondaryFragment}
        </ToolbarMore>
      ) : (
        secondaryFragment
      )}
    </FloatingBar>
  );
}
