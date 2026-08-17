"use client";

import * as React from "react";
import {
  AppWindow,
  DoorOpen,
  Droplet,
  Fence,
  Hand,
  Eye,
  House,
  Magnet,
  Maximize,
  MoreVertical,
  MousePointer2,
  PanelsTopLeft,
  Plug,
  Redo2,
  Ruler,
  SquarePlus,
  ArrowDownToDot,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { EditorTool } from "@/types";
import type {
  ElectricalPointType,
  ExteriorElementKind,
  RoofZone,
  RoomType,
  WaterPointType,
} from "@/types";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectCapabilities } from "@/hooks/use-project-capabilities";
import { useNarrowViewport } from "@/hooks/use-narrow-viewport";
import { useToolbarOverflow } from "@/hooks/use-toolbar-overflow";
import {
  ELECTRICAL_POINT_TYPES,
  ROOM_TYPES,
  WATER_POINT_TYPES,
} from "@/lib/constants";
import { track } from "@/lib/analytics";
import { LENGTH_UNITS, type LengthUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FACADE_COMPOSER_TEMPLATES } from "@/lib/exterior/facade-templates";
import { EDITOR_EXTERIOR_KIND_LABELS } from "@/lib/exterior/labels";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TOOLS: { id: EditorTool; icon: typeof Hand; label: string }[] = [
  { id: "select", icon: MousePointer2, label: "Pilih / geser (V)" },
  { id: "pan", icon: Hand, label: "Geser kanvas (Space)" },
  { id: "door", icon: DoorOpen, label: "Tambah pintu" },
  { id: "window", icon: AppWindow, label: "Tambah jendela" },
];

const ROOF_ZONE_LABELS: Record<RoofZone["type"], string> = {
  datar: "Dak datar",
  pelana: "Atap pelana",
  limasan: "Atap limasan",
  miring: "Atap miring",
};

function ToolButton({
  active,
  label,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "default" : "ghost"}
          size="icon"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const selectedId = useEditorStore((s) => s.selectedObjectId);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const zoomBy = useEditorStore((s) => s.zoomBy);
  const resetView = useEditorStore((s) => s.resetView);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const showDimensions = useEditorStore((s) => s.showDimensions);
  const toggleDimensions = useEditorStore((s) => s.toggleDimensions);
  const showHiddenExteriorElements = useEditorStore(
    (s) => s.showHiddenExteriorElements
  );
  const setShowHiddenExteriorElements = useEditorStore(
    (s) => s.setShowHiddenExteriorElements
  );
  const showRoofZones = useEditorStore((s) => s.showRoofZones);
  const setShowRoofZones = useEditorStore((s) => s.setShowRoofZones);
  const showHiddenRoofZones = useEditorStore((s) => s.showHiddenRoofZones);
  const setShowHiddenRoofZones = useEditorStore(
    (s) => s.setShowHiddenRoofZones
  );
  const dimensionUnit = useEditorStore((s) => s.dimensionUnit);
  const setDimensionUnit = useEditorStore((s) => s.setDimensionUnit);
  const setPendingRoomType = useEditorStore((s) => s.setPendingRoomType);
  const adding = useEditorStore((s) => s.activeTool === "room");
  const pendingElectricalType = useEditorStore((s) => s.pendingElectricalType);
  const setPendingElectricalType = useEditorStore(
    (s) => s.setPendingElectricalType,
  );
  const pendingWaterType = useEditorStore((s) => s.pendingWaterType);
  const setPendingWaterType = useEditorStore((s) => s.setPendingWaterType);
  const pendingRoofZoneType = useEditorStore((s) => s.pendingRoofZoneType);
  const setPendingRoofZoneType = useEditorStore(
    (s) => s.setPendingRoofZoneType,
  );
  const pendingExteriorKind = useEditorStore((s) => s.pendingExteriorKind);
  const setPendingExteriorKind = useEditorStore(
    (s) => s.setPendingExteriorKind,
  );
  const addingExterior = useEditorStore((s) => s.activeTool === "exterior");
  const showCrossFloorRooms = useEditorStore((s) => s.showCrossFloorRooms);
  const setShowCrossFloorRooms = useEditorStore((s) => s.setShowCrossFloorRooms);
  const addingRoofZone = useEditorStore((s) => s.activeTool === "roofZone");
  const applyExteriorTemplate = useEditorStore((s) => s.applyExteriorTemplate);
  // Gating rollout §21: hanya creation UI yang disembunyikan saat flag off —
  // elemen existing tetap dirender/di-edit (rollback tidak menghapus data).
  const projectId = useEditorStore((s) => s.layout?.projectId);
  const capabilities = useProjectCapabilities(projectId);

  // Table/mobile (<1024px) → alat sekunder menciut ke tombol More (⋯). Sinyal
  // kedua — independen dari lebar — mengukur tinggi toolbar yang SEBENARNYA
  // dirender: di desktop lebar tapi window pendek (atau setelah toolbar
  // bertambah panjang), lebar saja tidak pernah memicu compact meski konten
  // meluber ke luar viewport.
  const narrow = useNarrowViewport();
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const overflowsHeight = useToolbarOverflow(toolbarRef, narrow);
  const compact = narrow || overflowsHeight;

  // ── Alat primer (selalu inline) ────────────────────────────────────────
  const primaryControls = (
    <>
      {TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          active={activeTool === t.id}
          label={t.label}
          onClick={() => setTool(t.id)}
        >
          <t.icon className="size-4" />
        </ToolButton>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={adding ? "default" : "ghost"}
            size="icon"
            aria-label="Tambah ruang"
            title="Tambah ruang"
          >
            <SquarePlus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          className="max-h-72 overflow-y-auto"
        >
          {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
            <DropdownMenuItem
              key={t}
              onClick={() => {
                setTool("room");
                setPendingRoomType(t);
              }}
            >
              {ROOM_TYPES[t].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton
        active={activeTool === "electrical"}
        label="Titik listrik"
        onClick={() => setTool("electrical")}
      >
        <Plug className="size-4" />
      </ToolButton>

      {activeTool === "electrical" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="text-[10px] font-semibold uppercase"
              aria-label="Pilih tipe titik listrik"
            >
              {ELECTRICAL_POINT_TYPES[
                pendingElectricalType ?? "stopkontak"
              ].slice(0, 3)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            className="max-h-72 overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              value={pendingElectricalType ?? "stopkontak"}
              onValueChange={(v) =>
                setPendingElectricalType(v as ElectricalPointType)
              }
            >
              {(
                Object.keys(ELECTRICAL_POINT_TYPES) as ElectricalPointType[]
              ).map((t) => (
                <DropdownMenuRadioItem key={t} value={t}>
                  {ELECTRICAL_POINT_TYPES[t]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ToolButton
        active={activeTool === "water"}
        label="Titik air"
        onClick={() => setTool("water")}
      >
        <Droplet className="size-4" />
      </ToolButton>

      <ToolButton
        active={showCrossFloorRooms}
        label={`Tampilkan lantai lain: ${showCrossFloorRooms ? "aktif" : "mati"}`}
        onClick={() => setShowCrossFloorRooms(!showCrossFloorRooms)}
      >
        <Eye className="size-4" />
      </ToolButton>

      {activeTool === "water" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="text-[10px] font-semibold uppercase"
              aria-label="Pilih tipe titik air"
            >
              {WATER_POINT_TYPES[pendingWaterType ?? "kran"].slice(0, 3)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            className="max-h-72 overflow-y-auto"
          >
            <DropdownMenuRadioGroup
              value={pendingWaterType ?? "kran"}
              onValueChange={(v) => setPendingWaterType(v as WaterPointType)}
            >
              {(Object.keys(WATER_POINT_TYPES) as WaterPointType[]).map((t) => (
                <DropdownMenuRadioItem key={t} value={t}>
                  {WATER_POINT_TYPES[t]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ToolButton
        active={activeTool === "stair"}
        label="Tambah tangga"
        onClick={() => setTool("stair")}
      >
        <ArrowDownToDot className="size-4" />
      </ToolButton>

      <Separator className="my-1 w-6" />

      <ToolButton
        label="Hapus (Del)"
        onClick={deleteSelected}
        disabled={!selectedId}
      >
        <Trash2 className="size-4" />
      </ToolButton>

      <Separator className="my-1 w-6" />

      <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
        <Redo2 className="size-4" />
      </ToolButton>

      <Separator className="my-1 w-6" />

      <ToolButton label="Perbesar" onClick={() => zoomBy(1.2)}>
        <ZoomIn className="size-4" />
      </ToolButton>
      <ToolButton label="Perkecil" onClick={() => zoomBy(1 / 1.2)}>
        <ZoomOut className="size-4" />
      </ToolButton>
      <ToolButton label="Pas ke layar" onClick={resetView}>
        <Maximize className="size-4" />
      </ToolButton>

      {capabilities.roof_zones_v1 &&
        activeTool === "roofZone" &&
        pendingRoofZoneType && (
          <div className="text-center text-[10px] leading-tight text-muted-foreground">
            {ROOF_ZONE_LABELS[pendingRoofZoneType]}
          </div>
        )}

      {capabilities.exterior_elements_v1 &&
        activeTool === "exterior" &&
        pendingExteriorKind && (
          <div className="text-[10px] text-center leading-tight text-muted-foreground">
            {EDITOR_EXTERIOR_KIND_LABELS[pendingExteriorKind]}
          </div>
        )}
    </>
  );

  // ── Alat sekunder — inline di layar lebar, atau di dalam dropdown More ──
  const secondaryInline = (
    <>
      {(capabilities.roof_zones_v1 || capabilities.exterior_elements_v1) && (
        <Separator className="my-1 w-6" />
      )}

      {capabilities.roof_zones_v1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={addingRoofZone ? "default" : "ghost"}
                  size="icon"
                  aria-label="Tambah zona atap"
                >
                  <House className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                {(Object.keys(ROOF_ZONE_LABELS) as RoofZone["type"][]).map((t) => (
                  <DropdownMenuItem
                    key={t}
                    onClick={() => {
                      setTool("roofZone");
                      setPendingRoofZoneType(t);
                    }}
                  >
                    {ROOF_ZONE_LABELS[t]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger>
          <TooltipContent side="right">Tambah zona atap</TooltipContent>
        </Tooltip>
      )}

      {capabilities.roof_zones_v1 && (
        <>
          <ToolButton
            active={showRoofZones}
            label={`Tampilkan area atap: ${showRoofZones ? "aktif" : "mati"}`}
            onClick={() => setShowRoofZones(!showRoofZones)}
          >
            <House
              className={cn("size-4", showRoofZones && "text-primary-foreground")}
            />
          </ToolButton>

          <ToolButton
            active={showHiddenRoofZones}
            label={`Tampilkan zona atap tersembunyi: ${showHiddenRoofZones ? "aktif" : "mati"}`}
            onClick={() => setShowHiddenRoofZones(!showHiddenRoofZones)}
          >
            <Eye
              className={cn("size-4", showHiddenRoofZones && "text-primary-foreground")}
            />
          </ToolButton>
        </>
      )}

      {capabilities.exterior_elements_v1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={addingExterior ? "default" : "ghost"}
                  size="icon"
                  aria-label="Tambah elemen eksterior"
                >
                  <Fence className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                className="max-h-72 overflow-y-auto"
              >
                {(Object.keys(EDITOR_EXTERIOR_KIND_LABELS) as ExteriorElementKind[]).map(
                  (k) => (
                    <DropdownMenuItem
                      key={k}
                      onClick={() => {
                        setTool("exterior");
                        setPendingExteriorKind(k);
                      }}
                    >
                      {EDITOR_EXTERIOR_KIND_LABELS[k]}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger>
          <TooltipContent side="right">Tambah elemen eksterior</TooltipContent>
        </Tooltip>
      )}

      {capabilities.exterior_elements_v1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Pilih template tampak depan"
                >
                  <PanelsTopLeft className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-72">
                {FACADE_COMPOSER_TEMPLATES.map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    className="flex-col items-start gap-1"
                    onClick={() => {
                      const accepted = window.confirm(
                        `Terapkan ${template.label}? Komposisi template sebelumnya dan material fasad akan diganti. Elemen manual tetap dipertahankan dan perubahan dapat di-Undo.`,
                      );
                      if (accepted) {
                        applyExteriorTemplate(template.id);
                        track("exterior_template_applied", {
                          template_id: template.id,
                          source: "editor_toolbar",
                        });
                      }
                    }}
                  >
                    <span className="font-medium">{template.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {template.description}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger>
          <TooltipContent side="right">Pilih template tampak depan</TooltipContent>
        </Tooltip>
      )}

      <Separator className="my-1 w-6" />

      <ToolButton
        active={snapEnabled}
        label={`Snap grid: ${snapEnabled ? "aktif" : "mati"}`}
        onClick={toggleSnap}
      >
        <Magnet
          className={cn("size-4", snapEnabled && "text-primary-foreground")}
        />
      </ToolButton>

      <Separator className="my-1 w-6" />

      <ToolButton
        active={showDimensions}
        label={`Dimensi: ${showDimensions ? "aktif" : "mati"}`}
        onClick={toggleDimensions}
      >
        <Ruler
          className={cn("size-4", showDimensions && "text-primary-foreground")}
        />
      </ToolButton>

      <Separator className="my-1 w-6" />

      <ToolButton
        active={showHiddenExteriorElements}
        label={`Tampilkan tersembunyi: ${showHiddenExteriorElements ? "aktif" : "mati"}`}
        onClick={() => setShowHiddenExteriorElements(!showHiddenExteriorElements)}
      >
        <Eye
          className={cn("size-4", showHiddenExteriorElements && "text-primary-foreground")}
        />
      </ToolButton>

      {showDimensions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="text-[11px] font-semibold uppercase"
              aria-label={`Satuan dimensi: ${dimensionUnit}`}
            >
              {dimensionUnit}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end">
            <DropdownMenuRadioGroup
              value={dimensionUnit}
              onValueChange={(v) => setDimensionUnit(v as LengthUnit)}
            >
              {LENGTH_UNITS.map((u) => (
                <DropdownMenuRadioItem key={u.id} value={u.id}>
                  {u.name} ({u.label})
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  // Versi compact: item dropdown "More" + submenu untuk picker yang
  // memilih beberapa opsi (Radix: DropdownMenu bersarang tak boleh menjadi
  // item di dalam menu lain — pakai DropdownMenuSub yang benar).
  const secondaryMore = (
    <>
      {capabilities.roof_zones_v1 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <House className="size-4" /> Tambah zona atap
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {(Object.keys(ROOF_ZONE_LABELS) as RoofZone["type"][]).map((t) => (
              <DropdownMenuItem
                key={t}
                onClick={() => {
                  setTool("roofZone");
                  setPendingRoofZoneType(t);
                }}
              >
                {ROOF_ZONE_LABELS[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}

      {capabilities.exterior_elements_v1 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Fence className="size-4" /> Tambah elemen eksterior
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {(Object.keys(EDITOR_EXTERIOR_KIND_LABELS) as ExteriorElementKind[]).map(
              (k) => (
                <DropdownMenuItem
                  key={k}
                  onClick={() => {
                    setTool("exterior");
                    setPendingExteriorKind(k);
                  }}
                >
                  {EDITOR_EXTERIOR_KIND_LABELS[k]}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}

      {capabilities.exterior_elements_v1 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PanelsTopLeft className="size-4" /> Template tampak depan
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            {FACADE_COMPOSER_TEMPLATES.map((template) => (
              <DropdownMenuItem
                key={template.id}
                className="flex-col items-start gap-1"
                onClick={() => {
                  const accepted = window.confirm(
                    `Terapkan ${template.label}? Komposisi template sebelumnya dan material fasad akan diganti.`,
                  );
                  if (accepted) {
                    applyExteriorTemplate(template.id);
                    track("exterior_template_applied", {
                      template_id: template.id,
                      source: "editor_toolbar_more",
                    });
                  }
                }}
              >
                <span className="font-medium">{template.label}</span>
                <span className="text-xs text-muted-foreground">
                  {template.description}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}

      {capabilities.exterior_elements_v1 && (
        <DropdownMenuSeparator />
      )}

      <DropdownMenuCheckboxItem
        checked={snapEnabled}
        onCheckedChange={() => toggleSnap()}
      >
        Snap grid {snapEnabled ? "aktif" : "mati"}
      </DropdownMenuCheckboxItem>

      <DropdownMenuCheckboxItem
        checked={showDimensions}
        onCheckedChange={() => toggleDimensions()}
      >
        Dimensi {showDimensions ? "aktif" : "mati"}
      </DropdownMenuCheckboxItem>

      <DropdownMenuCheckboxItem
        checked={showHiddenExteriorElements}
        onCheckedChange={() =>
          setShowHiddenExteriorElements(!showHiddenExteriorElements)
        }
      >
        Tampilkan tersembunyi
      </DropdownMenuCheckboxItem>

      {capabilities.roof_zones_v1 && (
        <>
          <DropdownMenuCheckboxItem
            checked={showRoofZones}
            onCheckedChange={() => setShowRoofZones(!showRoofZones)}
          >
            Tampilkan area atap
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={showHiddenRoofZones}
            onCheckedChange={() => setShowHiddenRoofZones(!showHiddenRoofZones)}
          >
            Tampilkan zona atap tersembunyi
          </DropdownMenuCheckboxItem>
        </>
      )}

      {showDimensions && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Satuan dimensi</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={dimensionUnit}
                onValueChange={(v) => setDimensionUnit(v as LengthUnit)}
              >
                {LENGTH_UNITS.map((u) => (
                  <DropdownMenuRadioItem key={u.id} value={u.id}>
                    {u.name} ({u.label})
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      )}
    </>
  );

  return (
    <div
      ref={toolbarRef}
      className="flex flex-col items-center gap-1 rounded-xl border bg-card p-1.5 shadow-sm"
    >
      {primaryControls}

      <Separator className="my-1 w-6" />

      {compact ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Kontrol lainnya"
                  data-testid="editor-toolbar-more"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Kontrol lainnya</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="right"
            align="start"
            className="max-h-[min(70vh,32rem)] overflow-y-auto"
          >
            {secondaryMore}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        secondaryInline
      )}
    </div>
  );
}
