"use client";

/**
 * AssetPickerHost — SATU gerbang "pilih model dari My Library" untuk seluruh
 * workspace project (unifikasi P2, docs/UNIFIKASI_UI_EDITOR.md §3.6).
 *
 * Menggantikan Sheet lokal di panel 3D yang di-dispatch lewat string
 * `customTarget` 9-arah DAN membaca seleksi via `getState()` SAAT COMMIT —
 * race nyata: ganti seleksi selagi sheet terbuka → aset menempel ke entity
 * yang salah. Di sini target membawa id entity SAAT REQUEST (typed union),
 * jadi race tertutup by construction — dan karena tak ada dependensi 3D
 * (Sheet portal ke body), picker yang sama bisa dipakai dari halaman 2D.
 */

import * as React from "react";
import { create } from "zustand";
import { toast } from "sonner";

import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";
import { useAttachAssetToSlot } from "@/lib/api/hooks";
import {
  MyAssetLibraryPanel,
  type AssetItem,
} from "@/components/assets/library/my-asset-library-panel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Target picker — id entity ditangkap saat REQUEST, bukan saat commit. */
export type AssetTarget =
  | { type: "opening-model"; openingId: string }
  | { type: "opening-curtain"; openingId: string }
  | { type: "facade-element"; id: string }
  | { type: "exterior"; id: string; initialCategory?: string }
  | { type: "railing"; roomId: string }
  | { type: "rooftop-railing" }
  | { type: "lamp"; id: string }
  | { type: "furniture-slot"; roomId: string; furnitureId: string }
  | { type: "room-add"; roomId: string };

type AssetPickerState = {
  request: AssetTarget | null;
  open: (target: AssetTarget) => void;
  close: () => void;
};

export const useAssetPickerStore = create<AssetPickerState>((set) => ({
  request: null,
  open: (target) => set({ request: target }),
  close: () => set({ request: null }),
}));

/** Buka picker My Library untuk sebuah target (dipanggil dari inspector mana pun). */
export function requestAssetPicker(target: AssetTarget): void {
  useAssetPickerStore.getState().open(target);
}

export function AssetPickerHost({ projectId }: { projectId: string }) {
  const request = useAssetPickerStore((s) => s.request);
  const close = useAssetPickerStore((s) => s.close);
  const attachAsset = useAttachAssetToSlot();
  const setFurnitureModel = useInteriorStore((s) => s.setFurnitureModel);
  const addAssetFurniture = useInteriorStore((s) => s.addAssetFurniture);
  const currentSlotAssetId = useInteriorStore((s) => {
    if (request?.type !== "furniture-slot") return undefined;
    const roomPlan = s.plan?.rooms.find((r) => r.roomId === request.roomId);
    return roomPlan?.furniture.find((f) => f.id === request.furnitureId)?.modelAssetId ?? undefined;
  });

  const onSelect = (asset: AssetItem) => {
    if (!request) return;
    const editor = useEditorStore.getState();
    switch (request.type) {
      case "opening-model":
        editor.updateOpening(request.openingId, {
          modelUrl: asset.modelUrl ?? null,
          modelAssetId: asset.id,
        });
        toast.success(`Model bukaan dipasang: ${asset.name}`);
        break;
      case "opening-curtain":
        editor.updateOpening(request.openingId, {
          curtainModelUrl: asset.modelUrl ?? null,
          curtainAssetId: asset.id,
        });
        toast.success(`Gorden dipasang: ${asset.name}`);
        break;
      case "facade-element":
        editor.updateFacadeElement(request.id, {
          modelUrl: asset.modelUrl ?? null,
          modelAssetId: asset.id,
        });
        toast.success(`Model fasad dipasang: ${asset.name}`);
        break;
      case "exterior":
        editor.updateExteriorElement(request.id, {
          model: {
            modelAssetId: asset.id,
            modelUrl: asset.modelUrl ?? null,
            fitMode: "fit_envelope",
          },
        });
        toast.success(`Model 3D dipasang: ${asset.name}`);
        break;
      case "railing":
        editor.updateRoom(request.roomId, {
          railingModelUrl: asset.modelUrl ?? null,
          railingModelAssetId: asset.id,
        });
        toast.success(`Model railing dipasang: ${asset.name}`);
        break;
      case "rooftop-railing":
        editor.setRooftopRailingModel(asset.modelUrl ?? null, asset.id);
        toast.success(`Model railing dak dipasang: ${asset.name}`);
        break;
      case "lamp":
        editor.updateLamp(request.id, {
          modelAssetId: asset.id,
          modelUrl: asset.modelUrl ?? null,
        });
        toast.success(`Model lampu diganti: ${asset.name}`);
        break;
      case "room-add":
        addAssetFurniture(request.roomId, {
          id: asset.id,
          name: asset.name,
          category: asset.category,
          modelUrl: asset.modelUrl ?? null,
          widthM: asset.widthM,
          depthM: asset.depthM,
          heightM: asset.heightM,
          // Harga level aset diwariskan ke penempatan (budget/RAB);
          // tanpa harga → item berstatus "belum dihargai".
          priceIDR: asset.priceIDR ?? null,
        });
        toast.success(`"${asset.name}" ditambahkan ke ruang`);
        break;
      case "furniture-slot":
        attachAsset.mutate(
          {
            projectId,
            slotId: request.furnitureId,
            assetId: asset.id,
            fitMode: "fit_to_slot_width",
            materialMode: "match_project_style",
          },
          {
            onSuccess: () => {
              setFurnitureModel(request.roomId, request.furnitureId, {
                modelAssetId: asset.id,
                modelUrl: asset.modelUrl ?? null,
                fitMode: "fit_to_slot_width",
                materialMode: "match_project_style",
              });
              toast.success(`"${asset.name}" dipasang ke slot`);
              close();
            },
            onError: () => toast.error("Gagal memasang asset"),
          },
        );
        return; // close ditangani onSuccess (mutasi async)
    }
    close();
  };

  return (
    <Sheet open={request !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="flex w-[24rem] flex-col p-0 sm:max-w-[24rem]"
      >
        <SheetHeader className="shrink-0 px-4 pt-4">
          <SheetTitle>My Library</SheetTitle>
        </SheetHeader>
        {request && (
          <MyAssetLibraryPanel
            selectedAssetId={currentSlotAssetId}
            initialCategory={request.type === "exterior" ? (request.initialCategory ?? "") : ""}
            onSelect={onSelect}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
