"use client";

/**
 * FurnitureInspector terpadu (unifikasi P2 — fold-in terakhir, 13/13 kind).
 * Migrasi blok "Furniture Inspector" dari preview-controls.tsx ke registry
 * untuk kind "furniture". PENGECUALIAN sumber-data satu-satunya di registry:
 * objek yang diedit (`PlacedFurniture`) hidup di `interior-store.plan`, bukan
 * `editor-store.layout` — seleksi terpadunya dijembatani interior↔editor di
 * selection-bridge. Aksi tetap memanggil interior-store (move/rotate/snap/
 * mountHeight/price/model/remove), jadi undo & autosave interior tak berubah.
 *
 * Kontrak testid dipertahankan: slot-upload-model, furniture-snap-wall,
 * furniture-price-input, aria "Tinggi pasang dari lantai (meter)" / "Harga
 * satuan furniture (Rupiah)".
 */

import * as React from "react";
import Link from "next/link";
import {
  Box,
  ExternalLink,
  Library,
  Magnet,
  Move3d,
  RotateCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";
import { usePreviewStore } from "@/stores/preview-store";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { ModelUploadDialog } from "@/components/assets/upload/model-upload-dialog";
import { resolvedFurniturePriceRange } from "@/lib/interior/plan";
import { slotRequirementsText } from "@/lib/interior/validation-profiles";
import { formatIDRRange } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { InspectorCard } from "./fields";
import type { InspectorSurface } from "./registry";

export function FurnitureInspectorCard({ surface }: { surface: InspectorSurface }) {
  const ref = useEditorStore((s) =>
    s.selected?.kind === "furniture" ? s.selected : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const plan = useInteriorStore((s) => s.plan);
  const projectId = useInteriorStore((s) => s.projectId);

  const moveFurniture = useInteriorStore((s) => s.moveFurniture);
  const rotateFurniture = useInteriorStore((s) => s.rotateFurniture);
  const snapFurnitureToWall = useInteriorStore((s) => s.snapFurnitureToWall);
  const setFurnitureMountHeight = useInteriorStore((s) => s.setFurnitureMountHeight);
  const setFurniturePrice = useInteriorStore((s) => s.setFurniturePrice);
  const setFurnitureModel = useInteriorStore((s) => s.setFurnitureModel);
  const addAssetFurniture = useInteriorStore((s) => s.addAssetFurniture);
  const removeFurniture = useInteriorStore((s) => s.removeFurniture);
  const isEditMode = usePreviewStore((s) => s.interactionMode === "edit");

  const [showUpload, setShowUpload] = React.useState(false);

  const roomPlan = ref ? plan?.rooms.find((r) => r.roomId === ref.roomId) : undefined;
  const item = roomPlan?.furniture.find((f) => f.id === ref?.id);
  const room = ref ? layout?.rooms.find((r) => r.id === ref.roomId) : undefined;

  if (!ref || !item || !room) return null;
  const hasModel = !!(item.modelAssetId || item.modelUrl);
  const req = item.slotType ? slotRequirementsText(item.slotType) : null;

  return (
    <InspectorCard
      className={cn("space-y-1", surface === "3d" && "border-primary/40")}
      data-testid="furniture-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            {item.widthM}×{item.depthM} m ·{" "}
            {formatIDRRange(item.priceRange.low, item.priceRange.high)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">{item.category}</Badge>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 pointer-coarse:size-9"
            aria-label="Tutup editor furnitur"
            onClick={clearSelection}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Model 3D — untuk SEMUA furnitur (bukan hanya slot). */}
      <div className="mt-2 space-y-1.5 rounded-md bg-muted/50 p-2">
        <p className="text-xs font-medium">
          {hasModel ? "Model 3D terpasang" : "Placeholder — bisa diganti"}
        </p>
        {req && (
          <p className="text-xs text-muted-foreground">
            Slot: <span className="font-medium">{req.label}</span> · {req.expectedSize}
          </p>
        )}
        <div className="mt-1.5 flex flex-col gap-1">
          <Button
            size="sm"
            variant="default"
            className="w-full pointer-coarse:h-10"
            data-testid="slot-upload-model"
            onClick={() => setShowUpload(true)}
          >
            <Upload /> {hasModel ? "Ganti — Upload Model 3D" : "Upload Model 3D"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full pointer-coarse:h-10"
            onClick={() =>
              requestAssetPicker({
                type: "furniture-slot",
                roomId: room.id,
                furnitureId: item.id,
              })
            }
          >
            <Library /> {hasModel ? "Ganti dari My Library" : "Pilih dari My Library"}
          </Button>
          <Button size="sm" variant="ghost" className="w-full text-xs" asChild>
            <Link href="/app/guides/furnimesh" target="_blank">
              <ExternalLink /> Panduan FurniMesh
            </Link>
          </Button>
        </div>
      </div>

      {isEditMode ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => moveFurniture(room.id, item.id, item.x - 0.25, item.y)}>
            <Move3d /> Kiri
          </Button>
          <Button size="sm" variant="outline" onClick={() => moveFurniture(room.id, item.id, item.x + 0.25, item.y)}>
            <Move3d /> Kanan
          </Button>
          <Button size="sm" variant="outline" onClick={() => moveFurniture(room.id, item.id, item.x, item.y - 0.25)}>
            <Move3d /> Maju
          </Button>
          <Button size="sm" variant="outline" onClick={() => moveFurniture(room.id, item.id, item.x, item.y + 0.25)}>
            <Move3d /> Mundur
          </Button>
          <Button size="sm" variant="outline" onClick={() => rotateFurniture(room.id, item.id)}>
            <RotateCw /> Rotate
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="furniture-snap-wall"
            onClick={() => snapFurnitureToWall(room.id, item.id)}
          >
            <Magnet /> Tempel dinding
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="col-span-2"
            onClick={() => removeFurniture(room.id, item.id)}
          >
            <Trash2 /> Hapus furniture
          </Button>
          <div className="col-span-2 space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Tinggi pasang dari lantai (m) — 0 = di lantai. Jam/lukisan/TV
              otomatis naik saat &quot;Tempel dinding&quot;; atur di sini bila perlu.
            </p>
            <Input
              type="number"
              step={0.05}
              min={0}
              max={2.6}
              value={item.mountHeightM ?? 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setFurnitureMountHeight(room.id, item.id, Number.isFinite(v) && v > 0 ? v : null);
              }}
              className="h-8 text-xs pointer-coarse:h-10"
              aria-label="Tinggi pasang dari lantai (meter)"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Harga satuan (Rp) untuk budget/RAB
              {resolvedFurniturePriceRange(item).mid <= 0 && (
                <span className="ml-1 text-warning">— belum dihargai</span>
              )}
            </p>
            <Input
              type="number"
              step={50_000}
              min={0}
              data-testid="furniture-price-input"
              value={item.priceOverrideIDR ?? (item.priceRange.mid > 0 ? item.priceRange.mid : "")}
              placeholder="cth. 2500000"
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setFurniturePrice(room.id, item.id, Number.isFinite(v) && v > 0 ? v : null);
              }}
              className="h-8 text-xs pointer-coarse:h-10"
              aria-label="Harga satuan furniture (Rupiah)"
            />
          </div>
        </div>
      ) : (
        <p className="mt-2 rounded-md bg-muted/50 p-2 text-center text-[11px] text-muted-foreground">
          <Box className="mr-1 inline size-3" />
          View mode — switch ke <strong>Edit</strong> untuk drag &amp; drop
          (tekan <strong>E</strong>)
        </p>
      )}

      {/* Upload GLB lokal (slot) — dialog self-contained milik kartu ini. */}
      {projectId && (
        <ModelUploadDialog
          open={showUpload}
          onClose={() => setShowUpload(false)}
          projectId={projectId}
          roomId={room.id}
          slotId={item.id}
          slotType={item.slotType ?? "generic"}
          onUploadComplete={(assetId, modelUrl, meta) => {
            setFurnitureModel(room.id, item.id, {
              modelAssetId: assetId,
              modelUrl: modelUrl || null,
            });
            void addAssetFurniture;
            void meta;
            setShowUpload(false);
          }}
        />
      )}
    </InspectorCard>
  );
}
