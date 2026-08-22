"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Armchair,
  Box,
  Building2,
  Grid2x2,
  Move3d,
  Plus,
  Sparkles,
  Upload,
  Library,
  Waves,
} from "lucide-react";

import type {
  DesignLayout,
  Project,
} from "@/types";
import { useInteriorStore } from "@/stores/interior-store";
import { useEditorStore } from "@/stores/editor-store";
import { usePreviewStore } from "@/stores/preview-store";
import { interiorRooms } from "@/lib/interior/plan";
import { MATERIAL_PRESET_LIST, MATERIAL_PRESETS } from "@/lib/three/materials";
import { FACADE_PRESETS } from "@/lib/three/facade-presets";
import { facadeCladdingById } from "@/lib/three/facade-claddings";
import { cn } from "@/lib/utils";
import {
  InteriorStyleSelector,
  RoomMaterialEditor,
} from "@/components/interior/interior-controls";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store";
import { ModelUploadDialog } from "@/components/assets/upload/model-upload-dialog";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { EntityInspector } from "@/components/inspector/registry";
import { InspectorSection } from "@/components/inspector/section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Header actions ──
// Hosted by <FloatingPanel actions> on desktop dan header drawer mobile (via
// PreviewControlsBody host). Fase 4: Undo/Redo pindah ke rail ViewToolbar (via
// hook bersama `useUnifiedUndo`, shortcut Ctrl+Z/Ctrl+Shift+Z kini didaftarkan
// di level halaman — lihat preview-3d-view.tsx) dan toggle Edit/View dihapus
// total (interactionMode kini murni gate readOnly, lihat preview-store.ts) —
// jadi tak ada lagi yang perlu dirender di sini. Fungsi ini dipertahankan
// (bukan dihapus) supaya kedua pemanggilnya tak perlu disentuh.
export function PreviewControlsHeaderActions() {
  return null;
}

// ── Body (+Tambah menu, inspector, section kolaps) ──
// Rendered inside the FloatingPanel scroll body on desktop, dan inside
// PanelDrawer body di mobile (lihat preview-3d-view.tsx). Does NOT render its
// own scroll wrapper — the host owns `data-testid="preview-controls-scroll"`
// (+ overflow-y-auto + space-y-3 + p-3). Returns a fragment so those styles
// stay on the host element.
//
// Fase 6 (restrukturisasi panel kanan):
// - Tab stub "Asisten Interior" DIHAPUS — `injectAgentDraft("", "interior")`
//   kini baris kecil ✦ "Tanya AI soal interior" DI DALAM section Interior
//   (ProjectBar punya tombol AI global yang menutup kebutuhan chat penuh).
// - EntityInspector (kartu entitas terpilih) tampil PALING ATAS, diikuti tiga
//   section kolaps (InspectorSection, dari kit @/components/inspector/section
//   — bukan lagi `AccordionSection` privat yang dihapus): ▸ Gaya Fasad ▸
//   Interior ▸ Material.
// - Tiga kartu tambah (Kolam/Tangga/Model 3D Kustom) melebur jadi SATU
//   DropdownMenu "+ Tambah" di puncak panel; visibilitas kondisional lama
//   kini jadi enabled/disabled per item.
export function PreviewControlsBody({
  layout,
  project,
}: {
  layout: DesignLayout;
  project: Project;
}) {
  const presetId = usePreviewStore((s) => s.materialPreset);
  const setMaterialPreset = usePreviewStore((s) => s.setMaterialPreset);
  const setShowRoof = usePreviewStore((s) => s.setShowRoof);
  const previewSelectedRoomId = usePreviewStore((s) => s.selectedRoomId);
  const requestFocusRoom = usePreviewStore((s) => s.requestFocusRoom);
  const setFloorVisible = usePreviewStore((s) => s.setFloorVisible);
  const selectRoom = usePreviewStore((s) => s.selectRoom);
  const plan = useInteriorStore((s) => s.plan);
  const interiorSelectedRoomId = useInteriorStore((s) => s.selectedRoomId);
  const selectInteriorRoom = useInteriorStore((s) => s.selectRoom);
  const setStyle = useInteriorStore((s) => s.setStyle);
  const addAssetFurniture = useInteriorStore((s) => s.addAssetFurniture);
  const resetRoom = useInteriorStore((s) => s.resetRoom);
  const injectAgentDraft = useProjectAgentUiStore((s) => s.injectDraft);

  const addPool = useEditorStore((s) => s.addPool);
  const addStair = useEditorStore((s) => s.addStair);
  const applyFacadePreset = useEditorStore((s) => s.applyFacadePreset);
  const editorReady = useEditorStore(
    (s) => s.layout?.projectId === layout.projectId,
  );
  const hasSelectedPool = useEditorStore(
    (s) =>
      s.selected?.kind === "room" &&
      s.layout?.rooms.find(
        (r) => r.id === (s.selected?.kind === "room" ? s.selected.id : null),
      )?.type === "kolam",
  );
  const activeFacadeCount = Object.keys(layout.facade ?? {}).length;
  const multiFloor = layout.floors.length >= 2;

  const [showUpload, setShowUpload] = useState(false);
  // Picker My Library kini global (AssetPickerHost, id ditangkap saat request)
  // — panel ini tinggal memanggil requestAssetPicker(). Upload dialog tetap
  // lokal: "slot" = pasang ke furniture terpilih, "room" = furniture baru.
  const [showCustomModal, setShowCustomModal] = useState(false);

  const supportedRooms = interiorRooms(layout);
  const selectedRoomId =
    previewSelectedRoomId ??
    interiorSelectedRoomId ??
    supportedRooms[0]?.id ??
    null;
  const room = layout.rooms.find((r) => r.id === selectedRoomId);
  const roomPlan = plan?.rooms.find((r) => r.roomId === selectedRoomId);
  // Room-list click = select + FLY: kamera membingkai ruangnya dari sudut iso
  // tinggi, dan lantai DI ATAS ruang disembunyikan (dollhouse) supaya interior
  // terlihat — kembalikan kapan saja lewat toggle mata di FloorToggleBar.
  const focusRoom = (roomId: string) => {
    selectInteriorRoom(roomId);
    const target = layout.rooms.find((r) => r.id === roomId);
    if (target) {
      const idx = layout.floors.findIndex((f) => f.id === target.floorId);
      layout.floors.forEach((f, i) => setFloorVisible(f.id, i <= idx));
      if (usePreviewStore.getState().showRoof) setShowRoof(false);
    }
    requestFocusRoom(roomId);
  };

  // Reset ruang: konfirmasi 2 langkah (klik kedua dalam 3 detik).
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  useEffect(() => {
    const t = setTimeout(() => setConfirmReset(false), 0);
    return () => clearTimeout(t);
  }, [selectedRoomId]);

  return (
    <>
      {/* ── "+ Tambah" — satu menu menggantikan tiga kartu berdiri sendiri
          (Kolam/Tangga/Model 3D Kustom). Aturan visibilitas lama kini jadi
          enabled/disabled per item; menunya sendiri disembunyikan total bila
          editor belum siap (paritas: ketiga kartu lama semuanya null saat
          itu). ── */}
      {editorReady && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full pointer-coarse:h-10"
              data-testid="preview-add-menu"
            >
              <Plus /> Tambah
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem
              data-testid="pool-add"
              disabled={hasSelectedPool}
              onSelect={() => {
                const id = addPool();
                if (id) {
                  selectRoom(id);
                  toast.success(
                    "Kolam ditambahkan — atur tipe, kedalaman & finish di kartu Ruang.",
                  );
                } else {
                  toast.error("Tak bisa menambah kolam (data belum siap).");
                }
              }}
            >
              <Waves /> Kolam renang
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="stair-add"
              disabled={!multiFloor}
              onSelect={() => {
                const id = addStair();
                if (id) {
                  selectRoom(id);
                  toast.success(
                    "Tangga ditambahkan — atur posisi & arah naik di 2D editor.",
                  );
                } else {
                  toast.error("Tambah lantai 2 dulu agar tangga punya tujuan.");
                }
              }}
            >
              <Move3d /> Tangga
              {!multiFloor && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  butuh 2 lantai
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="room-custom-model"
              disabled={!(room && roomPlan)}
              onSelect={() => setShowCustomModal(true)}
            >
              <Box /> Model 3D kustom
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Modal pilihan sumber model kustom */}
      <Dialog open={showCustomModal} onOpenChange={setShowCustomModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Model 3D kustom</DialogTitle>
            <DialogDescription>
              Tambahkan model GLB ke {room?.name ?? "ruang terpilih"} —
              langsung, tanpa perlu model bawaan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              data-testid="room-upload-model"
              onClick={() => {
                setShowCustomModal(false);
                setShowUpload(true);
              }}
            >
              <Upload /> Upload Model 3D
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCustomModal(false);
                if (room) requestAssetPicker({ type: "room-add", roomId: room.id });
              }}
            >
              <Library /> Tambah dari My Library
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Inspector terpadu (registry) — kartu entitas terpilih (kind yang
          sudah termigrasi: Opening, Ruang, dst.), IDENTIK dgn panel 2D. Kartu
          ruang kini juga membawa section railing implisit (balkon/rooftop) —
          dilebur di sana, tak lagi dipasang terpisah di sini. Tanpa seleksi:
          hint orientasi singkat. ── */}
      {!room && (
        <p className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <Move3d className="size-4 shrink-0" />
          Putar dengan seret, zoom dengan scroll. Pilih ruang untuk edit
          interior.
        </p>
      )}
      <EntityInspector surface="3d" />

      {/* ── Gaya Fasad — kolaps, composisi cladding+kisi seluruh muka 1-klik ── */}
      <InspectorSection icon={Building2} title="Gaya Fasad">
        {!editorReady ? (
          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Memuat data editor…
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {FACADE_PRESETS.map((p) => {
              const swatches = [p.hero, p.accent, p.base].map(
                (id) => facadeCladdingById(id)?.swatch ?? "#ccc",
              );
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.description}
                  onClick={() => applyFacadePreset(p.id)}
                  className="rounded-md border px-2 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="mb-1 flex gap-0.5">
                    {swatches.map((c, i) => (
                      <span
                        key={i}
                        className="size-3 rounded-sm border"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                  <span className="block text-xs font-medium">{p.label}</span>
                  <span className="block text-[10px] leading-tight text-muted-foreground">
                    {p.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {activeFacadeCount > 0 && (
          <p className="text-[10px] leading-tight text-muted-foreground">
            {activeFacadeCount} dinding sudah bercladding. Menerapkan gaya akan
            menimpanya (bisa di-undo).
          </p>
        )}
      </InspectorSection>

      {/* ── Interior — navigator ruang + gaya + reset + ✦ tanya AI ── */}
      {room && roomPlan && plan && (
        <InspectorSection
          icon={Armchair}
          title="Interior Editor"
          badge={`${roomPlan.furniture.length}`}
        >
          {/* Room navigator — dikelompokkan per lantai; klik = fokus kamera ke
              ruang (dollhouse). Badge kanan: jumlah furniture + titik warning. */}
          <div className="space-y-1.5" data-testid="interior-room-navigator">
            {layout.floors
              .filter((floor) =>
                supportedRooms.some((r) => r.floorId === floor.id),
              )
              .map((floor) => (
                <div key={floor.id}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {floor.name}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {supportedRooms
                      .filter((r) => r.floorId === floor.id)
                      .map((item) => {
                        const itemPlan = plan.rooms.find(
                          (p) => p.roomId === item.id,
                        );
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => focusRoom(item.id)}
                            title={`Fokus kamera ke ${item.name}`}
                            className={cn(
                              "flex items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted",
                              item.id === room.id &&
                                "border-primary bg-primary/10",
                            )}
                          >
                            <span className="truncate">{item.name}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              {itemPlan && itemPlan.furniture.length > 0 && (
                                <span className="text-[10px] tabular-nums text-muted-foreground">
                                  {itemPlan.furniture.length}
                                </span>
                              )}
                              {itemPlan && itemPlan.warnings.length > 0 && (
                                <span
                                  className="size-1.5 rounded-full bg-warning"
                                  title={`${itemPlan.warnings.length} warning ergonomi`}
                                />
                              )}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
          </div>

          <InteriorStyleSelector
            value={plan.style}
            onChange={setStyle}
            compact
          />

          {/* ✦ Asisten AI interior — dulu tab header "Asisten Interior"
              terpisah (dihapus, Fase 6); ProjectBar punya tombol AI global
              utk percakapan penuh, baris ini cukup sebagai pintasan cepat. */}
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start gap-2 text-primary hover:text-primary"
            onClick={() => injectAgentDraft("", "interior")}
          >
            <Sparkles className="size-3.5" /> Tanya AI soal interior
          </Button>

          <Button
            size="sm"
            variant={confirmReset ? "destructive" : "secondary"}
            className="w-full"
            onClick={() => {
              if (confirmReset) {
                resetRoom(room.id);
                setConfirmReset(false);
              } else {
                setConfirmReset(true);
              }
            }}
          >
            {confirmReset
              ? "Yakin? Klik lagi untuk reset"
              : "Reset interior ruang"}
          </Button>
        </InspectorSection>
      )}

      {/* ── Material — preset global + material ruang terpilih ── */}
      <InspectorSection icon={Grid2x2} title="Material">
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">
            Preset visual global
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {MATERIAL_PRESET_LIST.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMaterialPreset(m.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-colors",
                  presetId === m.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted",
                )}
              >
                <span
                  className="size-4 shrink-0 rounded-full border"
                  style={{ background: MATERIAL_PRESETS[m.id].accent }}
                />
                <span className="truncate">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {room && roomPlan && (
          <div className="space-y-1.5 border-t pt-2">
            <p className="text-[11px] font-medium text-muted-foreground">
              Material ruang terpilih
            </p>
            <RoomMaterialEditor room={room} roomPlan={roomPlan} compact />
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link href={`/app/projects/${project.id}/materials`}>
                <Grid2x2 /> Jadwal material
              </Link>
            </Button>
          </div>
        )}
      </InspectorSection>

      {/* Upload dialog — slot mode (pasang/ganti pada furniture terpilih) atau
          room mode (upload ke My Library lalu tambah sebagai furniture BARU). */}
      {room && (
        <ModelUploadDialog
          open={showUpload}
          onClose={() => setShowUpload(false)}
          projectId={project.id}
          roomId={room.id}
          slotId={undefined}
          slotType={"generic"}
          onUploadComplete={(assetId, modelUrl, meta) => {
            {
              addAssetFurniture(room.id, {
                id: assetId,
                name: meta?.name ?? "Model kustom",
                category: meta?.category ?? "generic",
                modelUrl: modelUrl || null,
                widthM: meta?.widthM,
                depthM: meta?.depthM,
                heightM: meta?.heightM,
                priceIDR: meta?.priceIDR ?? null,
              });
              toast.success("Model ditambahkan ke ruang");
            }
            setShowUpload(false);
          }}
        />
      )}

      {/* My Library sheet kini AssetPickerHost (level halaman) — lihat
          @/components/assets/asset-picker-host. */}
    </>
  );
}
