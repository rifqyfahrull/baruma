"use client";

import * as React from "react";
import {
  Droplet,
  Fence,
  Info,
  MousePointerClick,
  Trash2,
  Waves,
  Zap,
} from "lucide-react";

import type {
  DesignLayout,
  ElectricalPoint,
  ElectricalPointType,
  SanitationObject,
  WaterPoint,
  WaterPointType,
} from "@/types";
import {
  useEditorStore,
  SOIL_DEFAULT_KPA,
  ROOF_LAYER_ID,
} from "@/stores/editor-store";
import {
  ELECTRICAL_POINT_TYPES,
  WATER_POINT_TYPES,
} from "@/lib/constants";
import { autoGenerateElectrical } from "@/lib/electrical/plan";
import { autoGenerateWater } from "@/lib/water/plan";
import {
  autoSizeSanitation,
  occupantsOf,
  sizeSepticTank,
} from "@/lib/water/sanitation";
import { roofAreaForLayout } from "@/lib/editor/sanitation-place";
import {
  CANTILEVER_MAX_M,
  isMezzanineFloor,
  isRegularFloor,
  isRooftopFloor,
  mezzanineParentOf,
} from "@/lib/editor/floors";
import {
  DEFAULT_FLOOR_TO_FLOOR_M,
  floorElevations,
} from "@/lib/geometry/vertical";
import { round2 } from "@/lib/geometry";
import { formatArea } from "@/lib/format";
import { EXTERIOR_KIND_LABELS } from "@/lib/exterior/labels";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, NumField, Stat } from "@/components/inspector/fields";
import { EntityInspector, isUnifiedInspectorKind } from "@/components/inspector/registry";
import { RoofSummarySection } from "@/components/inspector/roof-inspector";
import { RailingRoomContextCard } from "@/components/inspector/railing-inspector";
import { entityKey } from "@/types/entity-ref";

export function EditorInspector() {
  const layout = useEditorStore((s) => s.layout);
  const selectedId = useEditorStore((s) => s.selectedObjectId);
  const selected = useEditorStore((s) => s.selected);

  if (!layout) return null;

  const point = layout.electrical?.find((p) => p.id === selectedId);
  const waterPt = layout.water?.find((p) => p.id === selectedId);
  const saniHit = findSanitationObject(layout, selectedId ?? null);

  // Kind yang sudah termigrasi ke inspector terpadu (registry: opening, lamp,
  // railing, dst.) merender kartunya sendiri LENGKAP dgn header — tanpa h2
  // generik panel ini. Termasuk kind yang dulunya mustahil tampil di 2D
  // (lampu/railing — seleksinya lahir dari klik 3D, terbawa lintas halaman).
  if (isUnifiedInspectorKind(selected?.kind ?? null)) {
    return (
      // key="entity-panel": paksa React unmount BERSIH tiap kali panel ini
      // berganti dari/ke cabang "Ringkasan/global" di bawah — tanpa key,
      // kedua cabang sama-sama mengembalikan `<div className="flex h-full
      // flex-col">` di posisi root, jadi React bisa REUSE node DOM itu (&
      // anak-anaknya secara posisional) alih-alih membongkarnya bersih saat
      // seleksi hilang di tengah edit. Menutup jalur field ketikan nyasar ke
      // panel lain (mis. Material Atap/Lis Fascia) — lihat juga fix
      // `useSyncedText` di exterior-inspector.tsx utk akar penyebab seleksi
      // hilangnya sendiri.
      <div key="entity-panel" className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EntityInspector key={entityKey(selected!)} surface="2d" />
          {/* Jalur implisit railing (balkon / ruang floor-rooftop) — paritas
              dgn panel 3D; null utk kind/ tipe lain. */}
          <RailingRoomContextCard surface="2d" />
        </div>
      </div>
    );
  }

  return (
    <div key="legacy-panel" className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {point
              ? "Titik Listrik"
              : waterPt
                ? "Titik Air"
                : saniHit
                  ? "Sanitasi"
                  : "Ringkasan"}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {point ? (
          <ElectricalInspector key={point.id} point={point} />
        ) : waterPt ? (
          <WaterInspector key={waterPt.id} point={waterPt} />
        ) : saniHit ? (
          <SanitationInspector
            key={saniHit.obj.id}
            obj={saniHit.obj}
            label={saniHit.label}
            kind={saniHit.kind}
            refIndex={saniHit.ref}
          />
        ) : (
          <SummaryInspector />
        )}
      </div>
    </div>
  );
}

/** Resolve a selected id to a land-level sanitation object (+ display label). */
function findSanitationObject(
  layout: DesignLayout,
  id: string | null,
): {
  obj: SanitationObject;
  label: string;
  kind: "septicTank" | "soakwell" | "controlBox";
  ref: number | null;
} | null {
  if (!id) return null;
  const san = layout.sanitation;
  if (!san) return null;
  if (san.septicTank?.id === id)
    return {
      obj: san.septicTank,
      label: "Septic Tank",
      kind: "septicTank",
      ref: null,
    };
  if (san.soakwell?.id === id)
    return {
      obj: san.soakwell,
      label: "Sumur Resapan",
      kind: "soakwell",
      ref: null,
    };
  const boxes = Array.isArray(san.controlBoxes) ? san.controlBoxes : [];
  const idx = boxes.findIndex((b) => b?.id === id);
  if (idx >= 0)
    return {
      obj: boxes[idx],
      label: `Bak Kontrol ${idx + 1}`,
      kind: "controlBox",
      ref: idx,
    };
  return null;
}

/** Round a metre/volume value to 2dp for read-only display. */
function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
}

function ElectricalInspector({ point }: { point: ElectricalPoint }) {
  const updateElectricalPoint = useEditorStore((s) => s.updateElectricalPoint);
  const removeElectricalPoint = useEditorStore((s) => s.removeElectricalPoint);
  const floorId = useEditorStore((s) => s.selectedFloorId);
  const rooms = useEditorStore((s) => s.layout?.rooms ?? []);
  const floorRooms = rooms.filter((r) => r.floorId === floorId);

  const [note, setNote] = React.useState(point.note ?? "");

  return (
    <div className="space-y-4">
      <Field label="Tipe">
        <Select
          value={point.type}
          onValueChange={(v) =>
            updateElectricalPoint(point.id, { type: v as ElectricalPointType })
          }
        >
          <SelectTrigger aria-label="Tipe titik listrik">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ELECTRICAL_POINT_TYPES) as ElectricalPointType[]).map(
              (t) => (
                <SelectItem key={t} value={t}>
                  {ELECTRICAL_POINT_TYPES[t]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Ruang">
        <Select
          value={point.roomId}
          onValueChange={(v) => updateElectricalPoint(point.id, { roomId: v })}
        >
          <SelectTrigger aria-label="Ruang">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {floorRooms.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Catatan">
        <Input
          value={note}
          aria-label="Catatan"
          placeholder="Opsional"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (point.note ?? ""))
              updateElectricalPoint(point.id, { note });
          }}
        />
      </Field>

      <Separator />

      <Button
        variant="destructive"
        className="w-full"
        onClick={() => removeElectricalPoint(point.id)}
      >
        <Trash2 />
        Hapus titik
      </Button>
    </div>
  );
}

function WaterInspector({ point }: { point: WaterPoint }) {
  const updateWaterPoint = useEditorStore((s) => s.updateWaterPoint);
  const removeWaterPoint = useEditorStore((s) => s.removeWaterPoint);
  const floorId = useEditorStore((s) => s.selectedFloorId);
  const rooms = useEditorStore((s) => s.layout?.rooms ?? []);
  const floorRooms = rooms.filter((r) => r.floorId === floorId);

  const [note, setNote] = React.useState(point.note ?? "");

  return (
    <div className="space-y-4">
      <Field label="Tipe">
        <Select
          value={point.type}
          onValueChange={(v) =>
            updateWaterPoint(point.id, { type: v as WaterPointType })
          }
        >
          <SelectTrigger aria-label="Tipe titik air">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(Object.keys(WATER_POINT_TYPES) as WaterPointType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {WATER_POINT_TYPES[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Ruang">
        <Select
          value={point.roomId}
          onValueChange={(v) => updateWaterPoint(point.id, { roomId: v })}
        >
          <SelectTrigger aria-label="Ruang titik air">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {floorRooms.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Catatan">
        <Input
          value={note}
          aria-label="Catatan titik air"
          placeholder="Opsional"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (point.note ?? ""))
              updateWaterPoint(point.id, { note });
          }}
        />
      </Field>

      <Separator />

      <Button
        variant="destructive"
        className="w-full"
        onClick={() => removeWaterPoint(point.id)}
      >
        <Trash2 />
        Hapus titik
      </Button>
    </div>
  );
}

function SanitationInspector({
  obj,
  label,
  kind,
  refIndex,
}: {
  obj: SanitationObject;
  label: string;
  kind: "septicTank" | "soakwell" | "controlBox";
  refIndex: number | null;
}) {
  const removeSanitationObject = useEditorStore(
    (s) => s.removeSanitationObject,
  );
  const deleteLabel =
    kind === "soakwell" ? "Hapus resapan" : "Hapus objek sanitasi";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Objek</span>
        <Badge variant="secondary">{label}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Lebar (m)" value={fmtNum(obj.widthM)} />
        <Stat label="Panjang (m)" value={fmtNum(obj.lengthM)} />
        <Stat label="Kedalaman (m)" value={fmtNum(obj.depthM)} />
      </div>

      {typeof obj.capacity === "number" && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Kapasitas</span>
          <span className="text-sm font-semibold">
            {fmtNum(obj.capacity)} m³
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Dimensi dihitung otomatis dari pendekatan SNI. Seret objek di denah
          untuk memindah; jalankan &ldquo;Auto-size sanitasi&rdquo; lagi untuk
          menghitung ulang ukuran.
        </p>
      </div>

      <Separator />

      <Button
        variant="destructive"
        className="w-full"
        onClick={() => removeSanitationObject(kind, refIndex)}
      >
        <Trash2 />
        {deleteLabel}
      </Button>
    </div>
  );
}

// RoomInspector lama dihapus — digantikan inspector terpadu
// (@/components/inspector/room-inspector) via registry (kind "room"),
// termasuk section kolam & railing void.

// OpeningInspector 2D lama dihapus — digantikan inspector terpadu
// (@/components/inspector/opening-inspector, dirender via registry).

function SummaryInspector() {
  const layout = useEditorStore((s) => s.layout)!;
  const floorId = useEditorStore((s) => s.selectedFloorId);
  const updateFloor = useEditorStore((s) => s.updateFloor);

  const floorRooms = layout.rooms.filter((r) => r.floorId === floorId);
  const floorArea = floorRooms.reduce((sum, r) => sum + r.areaM2, 0);
  // Tinggi lantai AKTIF (Fase D5) — reguler & mezzanine (layer Atap =
  // pseudo-layer; rooftop = tebal dak, bukan floor-to-floor, disembunyikan).
  const activeFloor =
    floorId && floorId !== ROOF_LAYER_ID
      ? layout.floors.find((f) => f.id === floorId && !isRooftopFloor(f))
      : undefined;
  // Mezzanine (E7): heightM = tinggi ruang mezz sendiri (min longgar 2.0)
  // + kontrol elevasi dasar relatif lantai induk.
  const isMezz = !!activeFloor && isMezzanineFloor(activeFloor);
  const mezzParent =
    isMezz && activeFloor
      ? mezzanineParentOf(layout.floors, activeFloor.id)
      : null;
  const parentF2F = mezzParent
    ? (floorElevations(layout.floors).get(mezzParent.id)?.floorToFloorM ??
      DEFAULT_FLOOR_TO_FLOOR_M)
    : null;
  // Cantilever (CB3): kontrol geser massa lantai HANYA utk lantai reguler
  // non-dasar (level di atas lantai reguler terbawah) — lantai atas menjorok
  // di atas lantai bawah. Tak tampil di layer Atap/rooftop (activeFloor
  // undefined di sana) maupun mezzanine.
  const regularFloors = layout.floors.filter(isRegularFloor);
  const minRegularLevel = regularFloors.length
    ? Math.min(...regularFloors.map((f) => f.level))
    : 0;
  const showCantilever =
    !!activeFloor &&
    isRegularFloor(activeFloor) &&
    activeFloor.level > minRegularLevel;
  const offsetDx = activeFloor?.offsetM?.dx ?? 0;
  const offsetDy = activeFloor?.offsetM?.dy ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Ruang (lantai ini)" value={String(floorRooms.length)} />
        <Stat label="Luas lantai" value={formatArea(floorArea)} />
        <Stat label="Total ruang" value={String(layout.rooms.length)} />
        <Stat label="Lantai" value={String(layout.floors.length)} />
      </div>

      {activeFloor && (
        <>
          <Separator />
          <div className="space-y-1.5">
            <NumField
              id="floor-height-input"
              label={
                isMezz
                  ? `Tinggi lantai — ${activeFloor.name} (m, tinggi ruang mezzanine)`
                  : `Tinggi lantai — ${activeFloor.name} (m, lantai-ke-lantai)`
              }
              value={activeFloor.heightM}
              min={isMezz ? 2.0 : 2.4}
              max={4.5}
              step={0.05}
              onCommit={(v) => updateFloor(activeFloor.id, { heightM: v })}
            />
            {activeFloor.heightM < 2.7 && (
              <p className="text-xs text-warning">
                &lt; 2,7 m — kurang nyaman untuk iklim tropis (SNI menyarankan
                plafon ≥ 2,8 m utk ruang huni).
              </p>
            )}
            <p className="text-[11px] leading-snug text-muted-foreground">
              Berlaku ke 3D, denah potongan/tampak, dan RAB sekaligus. Tinggi
              dinding = tinggi lantai − tebal slab (0,15 m).
            </p>
            {isMezz && parentF2F !== null && (
              <NumField
                id="floor-mezz-offset-input"
                label="Elevasi dasar mezzanine (m dari lantai induk)"
                value={activeFloor.baseOffsetM ?? round2(parentF2F / 2)}
                min={1.0}
                max={Math.max(1.0, round2(parentF2F - 0.5))}
                step={0.05}
                onCommit={(v) =>
                  updateFloor(activeFloor.id, { baseOffsetM: v })
                }
              />
            )}
            {showCantilever && (
              <>
                <NumField
                  id="floor-offset-x-input"
                  label="Geser X (m, cantilever)"
                  value={offsetDx}
                  min={-CANTILEVER_MAX_M}
                  max={CANTILEVER_MAX_M}
                  step={0.05}
                  onCommit={(v) =>
                    updateFloor(activeFloor.id, {
                      offsetM: { dx: v, dy: offsetDy },
                    })
                  }
                />
                <NumField
                  id="floor-offset-y-input"
                  label="Geser Y (m, cantilever)"
                  value={offsetDy}
                  min={-CANTILEVER_MAX_M}
                  max={CANTILEVER_MAX_M}
                  step={0.05}
                  onCommit={(v) =>
                    updateFloor(activeFloor.id, {
                      offsetM: { dx: offsetDx, dy: v },
                    })
                  }
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Lantai menjorok di atas lantai bawah (maks 1,5 m).
                </p>
              </>
            )}
          </div>
        </>
      )}

      <Separator />

      <RoofSummarySection />

      <Separator />

      <StructuralSection />

      <Separator />

      <ElectricalSection />

      <Separator />

      <WaterSanitationSection />

      <Separator />

      <ExteriorElementsSection />

      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <MousePointerClick className="mt-0.5 size-4 shrink-0" />
        <p>
          Klik ruang untuk memilih, seret untuk memindah, tarik titik sudut
          untuk ubah ukuran. Tahan{" "}
          <kbd className="rounded border bg-background px-1">Space</kbd> untuk
          geser kanvas.
        </p>
      </div>
    </div>
  );
}

// RoofInspector / RoofZoneInspector / RooftopDeckSection lama dihapus —
// digantikan inspector terpadu (@/components/inspector/roof-inspector):
// kartu kind "roof"/"roofZone" via registry + RoofSummarySection di atas.

function StructuralSection() {
  const layout = useEditorStore((s) => s.layout)!;
  const setSoilBearing = useEditorStore((s) => s.setSoilBearing);
  const soil = layout.structural?.soilBearingKPa ?? SOIL_DEFAULT_KPA;

  const [kPa, setKPa] = React.useState(String(soil));

  const commitSoil = () => {
    const v = Number(kPa);
    if (Number.isFinite(v)) {
      const clamped = Math.min(400, Math.max(50, Math.round(v)));
      if (clamped !== soil) setSoilBearing(clamped);
      setKPa(String(clamped));
    } else {
      setKPa(String(soil));
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Struktur</h3>

      <Field label="Daya dukung tanah σ (kPa)">
        <Input
          type="number"
          step={10}
          min={50}
          max={400}
          value={kPa}
          aria-label="Daya dukung tanah (kPa)"
          onChange={(e) => setKPa(e.target.value)}
          onBlur={commitSoil}
        />
      </Field>

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-sm text-muted-foreground">σ tanah</span>
        <span className="text-sm font-semibold">{soil} kPa</span>
      </div>
    </div>
  );
}

function ElectricalSection() {
  const layout = useEditorStore((s) => s.layout)!;
  const setElectrical = useEditorStore((s) => s.setElectrical);
  const pendingElectricalType = useEditorStore((s) => s.pendingElectricalType);
  const setPendingElectricalType = useEditorStore(
    (s) => s.setPendingElectricalType,
  );
  const count = layout.electrical?.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Listrik</h3>
        <span className="text-xs text-muted-foreground">{count} titik</span>
      </div>

      <Field label="Tipe titik (untuk ditempatkan)">
        <Select
          value={pendingElectricalType ?? "stopkontak"}
          onValueChange={(v) =>
            setPendingElectricalType(v as ElectricalPointType)
          }
        >
          <SelectTrigger aria-label="Tipe titik listrik untuk ditempatkan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ELECTRICAL_POINT_TYPES) as ElectricalPointType[]).map(
              (t) => (
                <SelectItem key={t} value={t}>
                  {ELECTRICAL_POINT_TYPES[t]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </Field>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => setElectrical(autoGenerateElectrical(layout))}
      >
        <Zap />
        Auto-generate titik listrik
      </Button>
    </div>
  );
}

function WaterSanitationSection() {
  const layout = useEditorStore((s) => s.layout)!;
  const site = useEditorStore((s) => s.site);
  const setWater = useEditorStore((s) => s.setWater);
  const setSanitation = useEditorStore((s) => s.setSanitation);
  const pendingWaterType = useEditorStore((s) => s.pendingWaterType);
  const setPendingWaterType = useEditorStore((s) => s.setPendingWaterType);

  const count = layout.water?.length ?? 0;
  const occupants = occupantsOf(layout);
  const septic = layout.sanitation?.septicTank;
  const septicCap =
    typeof septic?.capacity === "number"
      ? septic.capacity
      : sizeSepticTank(occupants).capacity;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Air &amp; Sanitasi</h3>
        <span className="text-xs text-muted-foreground">{count} titik air</span>
      </div>

      <Field label="Tipe titik air (untuk ditempatkan)">
        <Select
          value={pendingWaterType ?? "kran"}
          onValueChange={(v) => setPendingWaterType(v as WaterPointType)}
        >
          <SelectTrigger aria-label="Tipe titik air untuk ditempatkan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(Object.keys(WATER_POINT_TYPES) as WaterPointType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {WATER_POINT_TYPES[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => setWater(autoGenerateWater(layout))}
      >
        <Droplet />
        Auto-generate titik air
      </Button>

      <Button
        variant="outline"
        className="w-full"
        disabled={!site}
        onClick={() => {
          if (site)
            setSanitation(
              autoSizeSanitation(layout, roofAreaForLayout(layout), site),
            );
        }}
      >
        <Waves />
        Auto-size sanitasi
      </Button>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Penghuni (est.)" value={String(occupants)} />
        <Stat label="Kapasitas septik" value={`${fmtNum(septicCap)} m³`} />
      </div>
    </div>
  );
}

/**
 * BUG 2 (jalan keluar selalu bekerja): daftar SEMUA elemen eksterior, dgn
 * tombol pilih + hapus per baris — tak bergantung sama sekali pada klik
 * kanvas 2D. Elemen yang jadi sangat tipis/nyaris nol panjang (mis. pagar
 * 0,05 m diagonal, hasil resize tak sengaja) bisa saja tetap lolos dari
 * hit-test kanvas (lihat perbaikan lebar hit-test di exterior-canvas.tsx);
 * daftar ini adalah jaring pengaman terakhir supaya elemen begitu TIDAK
 * PERNAH jadi sampah permanen yang tak bisa dipilih ulang atau dihapus.
 * Ditaruh di panel Ringkasan (selalu terjangkau, tak perlu seleksi apa pun).
 */
function ExteriorElementsSection() {
  const layout = useEditorStore((s) => s.layout)!;
  const select = useEditorStore((s) => s.select);
  const removeExteriorElement = useEditorStore((s) => s.removeExteriorElement);
  const selectedExteriorId = useEditorStore((s) =>
    s.selected?.kind === "exterior" ? s.selected.id : null,
  );
  const elements = layout.exteriorElements ?? [];

  if (elements.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="exterior-elements-section">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Elemen eksterior</h3>
        <span className="text-xs text-muted-foreground">
          {elements.length} elemen
        </span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Elemen yang tak bisa diklik lagi di kanvas (mis. segmen sangat tipis)
        tetap bisa dipilih atau dihapus dari sini.
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {elements.map((el) => {
          const label = el.label?.trim() || EXTERIOR_KIND_LABELS[el.kind];
          return (
            <div
              key={el.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1.5",
                el.id === selectedExteriorId && "border-primary bg-primary/5",
              )}
            >
              <Fence className="size-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
                onClick={() => select({ kind: "exterior", id: el.id })}
              >
                {label}
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0 text-destructive hover:text-destructive"
                aria-label={`Hapus ${label}`}
                onClick={() => removeExteriorElement(el.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ExteriorInspector + sub-form dipindah ke inspector terpadu
// (@/components/inspector/exterior-inspector) — dirender via registry.

// Field/ToggleRow/Stat kini dari kit inspector bersama
// (@/components/inspector/fields) — definisi lokal dihapus (P0 unifikasi).
