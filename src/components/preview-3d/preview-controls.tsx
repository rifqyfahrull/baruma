"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Armchair,
  Box,
  Building2,
  ChevronDown,
  Grid2x2,
  Move3d,
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
import {
} from "@/lib/constants";
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
import { Badge } from "@/components/ui/badge";
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store";
import { ModelUploadDialog } from "@/components/assets/upload/model-upload-dialog";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { EntityInspector } from "@/components/inspector/registry";
import { RailingRoomContextCard } from "@/components/inspector/railing-inspector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Accordion section ──

function AccordionSection({
  icon: Icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  icon: typeof Box;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
          <Icon className="size-3.5" />
          {title}
          {badge && (
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {badge}
            </Badge>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="space-y-2.5 border-t px-3 pb-3 pt-2.5">{children}</div>
      )}
    </div>
  );
}

// ── Header actions ──
// Hosted by <FloatingPanel actions> on desktop dan header drawer mobile (via
// PreviewControls). Fase 4: Undo/Redo pindah ke rail ViewToolbar (via hook
// bersama `useUnifiedUndo`, shortcut Ctrl+Z/Ctrl+Shift+Z kini didaftarkan di
// level halaman — lihat preview-3d-view.tsx) dan toggle Edit/View dihapus
// total (interactionMode kini murni gate readOnly, lihat preview-store.ts) —
// jadi tak ada lagi yang perlu dirender di sini. Fungsi ini dipertahankan
// (bukan dihapus) supaya kedua pemanggilnya tak perlu disentuh.
export function PreviewControlsHeaderActions() {
  return null;
}

// ── Body (inspector cards + accordion sections) ──
// Rendered inside the FloatingPanel scroll body on desktop, and inside the mobile
// drawer's scroll region (via PreviewControls). Does NOT render its own scroll
// wrapper — the host owns `data-testid="preview-controls-scroll"` (+ overflow-y-auto
// + space-y-3 + p-3). Returns a fragment so those styles stay on the host element.

export function PreviewControlsBody({
  layout,
  project,
  withAssistant = true,
}: {
  layout: DesignLayout;
  project: Project;
  /**
   * Sertakan section Asisten Interior inline. Desktop FloatingPanel memasang
   * asisten sebagai TAB header (paritas 2D editor) sehingga mematikan ini;
   * mobile drawer tetap membawa asisten inline.
   */
  withAssistant?: boolean;
}) {
  const presetId = usePreviewStore((s) => s.materialPreset);
  const setMaterialPreset = usePreviewStore((s) => s.setMaterialPreset);
  const setShowRoof = usePreviewStore((s) => s.setShowRoof);
  const previewSelectedRoomId = usePreviewStore((s) => s.selectedRoomId);
  const requestFocusRoom = usePreviewStore((s) => s.requestFocusRoom);
  const setFloorVisible = usePreviewStore((s) => s.setFloorVisible);
  const plan = useInteriorStore((s) => s.plan);
  const interiorSelectedRoomId = useInteriorStore((s) => s.selectedRoomId);
  const selectInteriorRoom = useInteriorStore((s) => s.selectRoom);
  const setStyle = useInteriorStore((s) => s.setStyle);
  const addAssetFurniture = useInteriorStore((s) => s.addAssetFurniture);
  const resetRoom = useInteriorStore((s) => s.resetRoom);
  const injectAgentDraft = useProjectAgentUiStore((s) => s.injectDraft);

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
      {/* AI Assistant (interior) — inline hanya di mobile drawer; desktop
          memakai TAB "Asisten Interior" di header FloatingPanel (paritas 2D). */}
      {withAssistant && (
        <AccordionSection icon={Sparkles} title="AI Agent">
          <p className="mb-3 text-sm text-muted-foreground">
            Chat Interior menyatu dengan seluruh percakapan proyek.
          </p>
          <Button className="w-full" onClick={() => injectAgentDraft("", "interior")}>
            <Sparkles /> Buka AI Agent
          </Button>
        </AccordionSection>
      )}

      {/* Kartu ruang penuh kini dirender EntityInspector (registry kind
          "room") di bawah — info card read-only lama dihapus. */}
      {!room && (
        <p className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <Move3d className="size-4 shrink-0" />
          Putar dengan seret, zoom dengan scroll. Pilih ruang untuk edit
          interior.
        </p>
      )}

      {/* ── Gaya Fasad 1-klik — komposisi cladding+kisi seluruh muka ── */}
      <FacadePresetCard layout={layout} />

      {/* ── Inspector terpadu (registry) — kind yang sudah termigrasi
          (Opening, dst.) dirender di sini, IDENTIK dgn panel 2D. ── */}
      <EntityInspector surface="3d" />

      {/* ── Roof editor — muncul saat atap diklik di 3D ── */}

      {/* ── Kolam renang — ADD-flow saja (butuh rumah selalu-render utk
          penempatan pintar). Edit kolam kini di kartu Ruang terpadu
          (registry, section pool) — juga dari 2D. ── */}
      <PoolAddCard layout={layout} />

      {/* ── Tangga — akses antar-lantai (slab atas otomatis berlubang) ── */}
      <StairQuickAdd layout={layout} />

      {/* ── Railing (jalur implisit): ruang balkon / ruang di floor-rooftop
          terpilih → kartu railing tampil (mesh railing tipis susah di-tap).
          Jalur klik-mesh (kind railing) ditangani EntityInspector di atas. ── */}
      <RailingRoomContextCard surface="3d" />

      {/* Exterior kini ditangani EntityInspector (registry) di atas — kartu
          terpadu FULL-EDIT menggantikan ExteriorSelectionQuickEditor lama yang
          read-only. e2e frontage certification tetap penjaganya (testid
          exterior-quick-editor dipertahankan di kartu terpadu). */}


      {/* Furniture Inspector kini kartu registry terpadu
          (@/components/inspector/furniture-inspector) — dirender via
          <EntityInspector surface="3d"/> di atas, IDENTIK dgn kind lain.
          Seleksi furnitur dijembatani interior↔editor di selection-bridge. */}

      {/* ── Model 3D kustom — satu tombol; detailnya di modal ── */}
      {room && roomPlan && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          data-testid="room-custom-model"
          onClick={() => setShowCustomModal(true)}
        >
          <Box /> Tambah Model 3D Kustom
        </Button>
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

      {/* ── Accordion sections ── */}

      {/* Interior Editor */}
      {room && roomPlan && plan && (
        <AccordionSection
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
        </AccordionSection>
      )}

      {/* View */}
      {/* "Sudut pandang", "Pencahayaan", "Opsi tampilan" pindah ke ViewToolbar
          (floating kiri di atas canvas). */}

      {/* Material */}
      <AccordionSection icon={Grid2x2} title="Material">
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
      </AccordionSection>

      {/* "Lantai" + exploded pindah ke FloorToggleBar (overlay di atas canvas). */}

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

// ── Full controls (header + body) — used by the mobile drawer ──
// Desktop uses <FloatingPanel> hosting the header pieces (title + actions) and
// PreviewControlsBody directly; the mobile drawer keeps the full header+body here.

export function PreviewControls({
  layout,
  project,
}: {
  layout: DesignLayout;
  project: Project;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Preview 3D</h2>
        <PreviewControlsHeaderActions />
      </div>

      {/* ── Body ── */}
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        data-testid="preview-controls-scroll"
      >
        <PreviewControlsBody layout={layout} project={project} />
      </div>
    </div>
  );
}

// ── Opening quick editor (edit pintu/jendela langsung dari 3D) ──
// Bukaan diklik di canvas → kartu ini muncul. Mutasi lewat editor store
// (updateOpening) — model 3D re-build live dan autosave layout berjalan di
// halaman ini juga (lihat Preview3DView). Edit menyeluruh tetap di 2D editor.

// OpeningQuickEditor lama dihapus — digantikan OpeningInspectorCard terpadu
// (@/components/inspector/opening-inspector) via <EntityInspector surface="3d"/>.

// ── Gaya Fasad 1-klik (komposisi cladding + kisi seluruh muka) ──
// Awam dapat fasad "advance" seketika; lalu tinggal setel per dinding (klik
// dinding). Menggantikan komposisi fasad lama (undo-aware).

function FacadePresetCard({ layout }: { layout: DesignLayout }) {
  const applyFacadePreset = useEditorStore((s) => s.applyFacadePreset);
  const editorReady = useEditorStore(
    (s) => s.layout?.projectId === layout.projectId,
  );
  const activeFacadeCount = Object.keys(layout.facade ?? {}).length;

  return (
    <div
      className="rounded-lg border bg-background p-3"
      data-testid="facade-preset-card"
    >
      <div className="flex items-center gap-2">
        <Building2 className="size-4 text-primary" />
        <div>
          <p className="text-sm font-semibold">Gaya Fasad — 1 klik</p>
          <p className="text-xs text-muted-foreground">
            Terapkan komposisi fasad modern ke seluruh muka, lalu setel per
            dinding.
          </p>
        </div>
      </div>
      {!editorReady ? (
        <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          Memuat data editor…
        </p>
      ) : (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
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
        <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
          {activeFacadeCount} dinding sudah bercladding. Menerapkan gaya akan
          menimpanya (bisa di-undo).
        </p>
      )}
    </div>
  );
}

// FacadeQuickEditor + FacadeLouverSection lama dihapus — digantikan
// WallInspectorCard terpadu (@/components/inspector/wall-inspector) via registry.


// RailingQuickEditor lama dihapus — digantikan RailingInspectorCard terpadu
// (@/components/inspector/railing-inspector) via registry + RailingRoomContextCard.

// LampQuickEditor lama dihapus — digantikan LampInspectorCard terpadu
// (@/components/inspector/lamp-inspector) via <EntityInspector surface="3d"/>.

// ── Roof quick editor (edit atap langsung dari 3D) ──
// Klik atap di canvas → atur tipe (datar/pelana/limasan/miring), kemiringan,
// overhang, material, arah turun (skillion), dan lis fascia — via editor-store
// setRoof (undo-able + autosave).


/**
 * Tangga — akses antar-lantai. Tombol tambah cepat dari 3D (konsisten dgn
 * kolam/teras). Ditaruh di pojok lantai dasar; slab lantai di atasnya OTOMATIS
 * berlubang tepat di atas tangga (build-model). Butuh ≥2 lantai (ada tujuan).
 */
function StairQuickAdd({ layout }: { layout: DesignLayout }) {
  const addStair = useEditorStore((s) => s.addStair)
  const selectRoom = usePreviewStore((s) => s.selectRoom)
  const editorReady = useEditorStore((s) => s.layout?.projectId === layout.projectId)
  if (!editorReady) return null
  const multiFloor = layout.floors.length >= 2

  return (
    <div className="rounded-lg border bg-background p-3" data-testid="stair-quick-add">
      <div className="flex items-center gap-2">
        <Move3d className="size-4 text-primary" />
        <div>
          <p className="text-sm font-semibold">Tangga</p>
          <p className="text-xs text-muted-foreground">Akses antar-lantai / ke rooftop</p>
        </div>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {multiFloor ? (
          <>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Ditaruh di pojok lantai dasar; slab lantai di atasnya otomatis
              berlubang tepat di atas tangga. Atur posisi & arah naik di <b>2D editor</b>.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              data-testid="stair-add"
              onClick={() => {
                const id = addStair()
                if (id) {
                  selectRoom(id)
                  toast.success("Tangga ditambahkan — atur posisi & arah naik di 2D editor.")
                } else {
                  toast.error("Tambah lantai 2 dulu agar tangga punya tujuan.")
                }
              }}
            >
              <Move3d /> Tambah tangga
            </Button>
          </>
        ) : (
          <p className="text-[10px] leading-snug text-muted-foreground">
            Tambah lantai 2 dulu (panel <b>Atap</b> → Rooftop, atau 2D editor)
            agar tangga punya tujuan.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Denah pipa kolam — skema sirkulasi: skimmer (kuning) & main drain (merah) →
 * ruang pompa/filter (abu) via pipa HISAP (garis putus gelap); pompa → inlet
 * (biru) via pipa BALIK (garis biru). Proporsional ke aspek kolam.
 */
/**
 * Kolam renang — ADD-flow (kartu selalu tampil; butuh rumah ter-render untuk
 * penempatan pintar halaman → dak rooftop → footprint via store.addPool).
 * EDIT kolam pindah ke kartu Ruang terpadu (registry kind "room", section
 * pool) — identik di 2D dan 3D.
 */
function PoolAddCard({ layout }: { layout: DesignLayout }) {
  const selectRoom = usePreviewStore((s) => s.selectRoom);
  const addPool = useEditorStore((s) => s.addPool);
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
  if (!editorReady) return null;
  // Saat kolam terpilih, kartu Ruang terpadu (di atas) yang tampil — kartu
  // tambah disembunyikan supaya tak dobel branding "Kolam renang".
  if (hasSelectedPool) return null;

  return (
    <div
      className="rounded-lg border border-sky-500/40 bg-background p-3"
      data-testid="pool-quick-editor"
    >
      <div className="flex items-center gap-2">
        <Waves className="size-4 text-sky-500" />
        <div>
          <p className="text-sm font-semibold">Kolam renang</p>
          <p className="text-xs text-muted-foreground">Tambah & kustom kolam</p>
        </div>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <p className="text-[10px] leading-snug text-muted-foreground">
          Ditaruh otomatis di halaman; bila lahan penuh & ada rooftop → kolam
          plunge di dak. Klik air kolam di 3D untuk atur/geser.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          data-testid="pool-add"
          onClick={() => {
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
          <Waves /> Tambah kolam renang
        </Button>
      </div>
    </div>
  );
}

// RoofQuickEditor lama dihapus — digantikan inspector terpadu
// (@/components/inspector/roof-inspector) via <EntityInspector surface="3d"/>.

// OpeningNumField lama dihapus — kit NumField (@/components/inspector/fields)
// kini jadi satu-satunya field angka inspector.
