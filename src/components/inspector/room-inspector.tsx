"use client";

/**
 * RoomInspector terpadu (unifikasi P2) — migrasi `RoomInspector` (panel 2D)
 * ke registry untuk kind "room", dirender identik di 2D dan 3D. Ini pertama
 * kalinya ruang bisa DIEDIT penuh dari halaman 3D (dulu 3D hanya menampilkan
 * kartu info read-only).
 *
 * Termasuk section KOLAM (migrasi edit-flow `PoolQuickEditor` 3D): ruang tipe
 * "kolam" mendapat blok tipe/kedalaman/finish/sirkulasi/kelistrikan + denah
 * pipa — kini juga dari 2D. Add-flow kolam tetap kartu tersendiri di panel 3D
 * (`PoolAddCard`, butuh rumah selalu-render untuk penempatan pintar).
 *
 * Pembagian kerja railing (anti-duplikasi):
 * - balkon / ruang di floor-rooftop → `RailingRoomContextCard`
 *   (railing-inspector) yang kini di-mount di KEDUA host;
 * - void → blok gaya railing di kartu ini (context card mengembalikan null
 *   untuk void).
 *
 * Kontrak yang dipertahankan (unit test): aria "Lantai ruang" pada Select
 * lantai, tombol "Bentuk L"/"Belok kiri", label /Tinggi tanjakan/, urutan
 * moveToFloor updateRoom → setSelectedFloor → selectObject (setSelectedFloor
 * mengosongkan seleksi — selectObject me-re-select), tombol "Hapus ruang",
 * testid pool-quick-editor / pool-delete.
 */

import * as React from "react";
import { Lock, Waves, X } from "lucide-react";

import type { PoolFinish, PoolKind, Room, RoomType } from "@/types";
import { ROOM_TYPES, ROOF_TYPES } from "@/lib/constants";
import { useEditorStore } from "@/stores/editor-store";
import { snapLevelOffset, levelStepWarning } from "@/lib/geometry";
import { roomZones, zoneColor } from "@/lib/editor/zones";
import { formatArea } from "@/lib/format";
import {
  interiorStairLayout,
  interiorStairSpec,
  stairComfortIssues,
} from "@/lib/stairs/geometry";
import { floorElevations, stairRiseM } from "@/lib/geometry/vertical";
import { POOL_KINDS, POOL_FINISHES, effectivePoolDepth } from "@/lib/three/pool";
import { poolCirculation, poolFittings } from "@/lib/three/pool-circulation";
import { poolElectrical } from "@/lib/three/pool-electrical";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeleteButton, Field, InspectorCard, ToggleRow } from "./fields";
import { RailingRoomContextCard } from "./railing-inspector";
import type { InspectorSurface } from "./registry";

export function RoomInspectorCard({ surface }: { surface: InspectorSurface }) {
  const id = useEditorStore((s) =>
    s.selected?.kind === "room" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const room = id ? layout?.rooms.find((r) => r.id === id) : undefined;
  if (!room) return null;
  return <RoomBody key={room.id} room={room} surface={surface} />;
}

function RoomBody({ room, surface }: { room: Room; surface: InspectorSurface }) {
  const updateRoom = useEditorStore((s) => s.updateRoom);
  const setSelectedFloor = useEditorStore((s) => s.setSelectedFloor);
  const selectObject = useEditorStore((s) => s.selectObject);
  const toggleLock = useEditorStore((s) => s.toggleLock);
  const deleteRef = useEditorStore((s) => s.deleteRef);
  const convertRoofToCourtyardZones = useEditorStore(
    (s) => s.convertRoofToCourtyardZones,
  );
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const floors = useEditorStore((s) => s.layout?.floors ?? []);

  const allRooms = useEditorStore((s) => s.layout?.rooms ?? []);
  const zones = Array.from(new Set(allRooms.flatMap((r) => roomZones(r))));
  const memberZones = roomZones(room);

  // Multi-zone: klik zona = toggle keanggotaan. `zoneId` legacy dijaga sinkron
  // dengan zona pertama agar konsumen lama (patch AI, layout tersimpan) akur.
  const setZones = (next: string[]) => {
    updateRoom(room.id, {
      zoneIds: next.length ? next : undefined,
      zoneId: next[0],
    });
  };
  const toggleZone = (z: string) => {
    setZones(
      memberZones.includes(z)
        ? memberZones.filter((m) => m !== z)
        : [...memberZones, z],
    );
  };

  const [name, setName] = React.useState(room.name);
  const [width, setWidth] = React.useState(String(room.width));
  const [depth, setDepth] = React.useState(String(room.depth));
  const [elev, setElev] = React.useState(
    String(Math.round((room.levelOffsetM ?? 0) * 100)),
  );

  const commitElev = () => {
    const cm = Number(elev);
    if (!Number.isFinite(cm)) return;
    const snapped = snapLevelOffset(
      Math.max(-90, Math.min(90, cm)) / 100,
    );
    if (snapped !== (room.levelOffsetM ?? 0))
      updateRoom(room.id, { levelOffsetM: snapped });
    setElev(String(Math.round(snapped * 100)));
  };

  const commitNumber = (key: "width" | "depth", raw: string) => {
    const v = Number(raw);
    // `void` bebas batas minimal (hanya floor 0.1 m agar tidak degenerate);
    // ruang lain tetap minimal 1.2 m — selaras dengan resize di editor-store.
    const min = room.type === "void" ? 0.1 : 1.2;
    if (Number.isFinite(v) && v >= min && v !== room[key]) {
      updateRoom(room.id, { [key]: Math.round(v * 100) / 100 });
    }
  };

  const fullLayout = useEditorStore.getState().layout;
  // Rise tangga = floor-to-floor lantai ruang (tabel elevasi, Fase D4).
  const riStairRise = stairRiseM(
    floorElevations(fullLayout?.floors ?? []),
    room.floorId,
  );
  const roofType = fullLayout?.roof?.type ?? "datar";
  const slopedLegacyRoof =
    (room.type === "taman" || room.type === "kolam" || room.type === "void") &&
    roofType !== "datar" &&
    !(fullLayout?.roofZones?.length ?? 0) &&
    !fullLayout?.floors.some((f) => f.id === "floor-rooftop");

  const moveToFloor = (floorId: string) => {
    if (floorId === room.floorId) return;
    // setSelectedFloor mengosongkan seleksi → selectObject me-re-select ruang
    // di lantai barunya (urutan dipin unit test).
    updateRoom(room.id, { floorId });
    setSelectedFloor(floorId);
    selectObject(room.id);
  };

  return (
    <InspectorCard
      className={cn("space-y-4", surface === "3d" && "border-primary/40")}
      data-testid="room-inspector"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{room.name}</p>
          <p className="text-xs text-muted-foreground">
            {ROOM_TYPES[room.type].label} · {formatArea(room.areaM2)}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor ruang"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <Field label="Nama">
        <Input
          value={name}
          disabled={room.locked}
          aria-label="Nama ruang"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== room.name && updateRoom(room.id, { name })}
        />
      </Field>

      <Field label="Tipe">
        <Select
          value={room.type}
          disabled={room.locked}
          onValueChange={(v) => updateRoom(room.id, { type: v as RoomType })}
        >
          <SelectTrigger aria-label="Tipe ruang">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {ROOM_TYPES[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Lantai">
        <Select
          value={room.floorId}
          disabled={room.locked || floors.length <= 1}
          onValueChange={moveToFloor}
        >
          <SelectTrigger aria-label="Lantai ruang">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {floors.map((floor) => (
              <SelectItem key={floor.id} value={floor.id}>
                {floor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Lebar (m)">
          <Input
            type="number"
            step={0.25}
            min={1.2}
            value={width}
            disabled={room.locked}
            aria-label="Lebar ruang (meter)"
            onChange={(e) => setWidth(e.target.value)}
            onBlur={() => commitNumber("width", width)}
          />
        </Field>
        <Field label="Panjang (m)">
          <Input
            type="number"
            step={0.25}
            min={1.2}
            value={depth}
            disabled={room.locked}
            aria-label="Panjang ruang (meter)"
            onChange={(e) => setDepth(e.target.value)}
            onBlur={() => commitNumber("depth", depth)}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-sm text-muted-foreground">Luas</span>
        <span className="text-sm font-semibold">{formatArea(room.areaM2)}</span>
      </div>

      <Separator />

      <ToggleRow
        label="Perlu cahaya alami"
        checked={!!room.requiresNaturalLight}
        onChange={(v) => updateRoom(room.id, { requiresNaturalLight: v })}
      />
      <ToggleRow
        label="Perlu ventilasi"
        checked={!!room.requiresVentilation}
        onChange={(v) => updateRoom(room.id, { requiresVentilation: v })}
      />
      <ToggleRow
        label="Kunci posisi"
        icon={Lock}
        checked={!!room.locked}
        onChange={() => toggleLock(room.id)}
      />

      <Separator />

      <Field label="Zona open-plan (bisa lebih dari satu)">
        <div className="flex flex-wrap gap-1.5">
          {zones.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => toggleZone(z)}
              aria-pressed={memberZones.includes(z)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-xs pointer-coarse:py-2",
                memberZones.includes(z) && "border-primary bg-primary/10",
              )}
            >
              <span
                className="size-3 rounded-full"
                style={{ background: zoneColor(z) }}
              />{" "}
              {z}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setZones([...memberZones, `zona-${zones.length + 1}`])}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted pointer-coarse:py-2"
          >
            + Zona baru
          </button>
          {memberZones.length > 0 && (
            <button
              type="button"
              onClick={() => setZones([])}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted pointer-coarse:py-2"
            >
              Lepas semua
            </button>
          )}
        </div>
      </Field>

      <Field label="Elevasi (cm dari lantai)">
        <Input
          type="number"
          step={1}
          value={elev}
          disabled={room.locked}
          aria-label="Elevasi ruang (cm dari lantai)"
          onChange={(e) => setElev(e.target.value)}
          onBlur={commitElev}
        />
      </Field>
      {levelStepWarning(room.levelOffsetM ?? 0) && (
        <p className="text-xs text-warning">
          {levelStepWarning(room.levelOffsetM ?? 0)}
        </p>
      )}

      {/* Courtyard/light-well: terbuka ke langit — atap/slab di atasnya
          dilubangi; area lubang bisa diatur di layer Atap 2D. */}
      {(room.type === "taman" || room.type === "kolam" || room.type === "void") && (
        <>
          <ToggleRow
            label="Terbuka ke langit"
            checked={!!room.openToSky}
            onChange={(v) =>
              updateRoom(room.id, {
                openToSky: v || undefined,
                ...(v ? {} : { openToSkyRect: undefined }),
              })
            }
          />
          {room.openToSky && (
            <p className="rounded-md bg-muted/50 p-2 text-xs leading-snug text-muted-foreground">
              Atap/dak di atas ruang ini dilubangi — cahaya & hujan masuk
              (courtyard). Geser/ubah area terbukanya di layer
              &quot;Atap&quot; 2D.
            </p>
          )}
          {slopedLegacyRoof && (
            <div className="space-y-1.5 rounded-md border border-amber-500/60 bg-amber-500/5 px-2 py-2">
              <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-500">
                Atap saat ini {ROOF_TYPES[roofType]} (satu massa) — lubang
                courtyard butuh atap dipecah jadi CINCIN zona mengelilingi
                area terbuka (tritisan sisi dalam otomatis 0).
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full pointer-coarse:h-10"
                data-testid="courtyard-convert-roof"
                onClick={() => convertRoofToCourtyardZones(room.id)}
              >
                Lubangi atap (jadikan cincin zona)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Void: railing otomatis di sisi terbuka — default besi (baluster
          rapat, lebih aman-anak drpd kaca polos utk lubang lantai). Balkon &
          ruang floor-rooftop TIDAK di sini — kartunya RailingRoomContextCard
          (railing-inspector), di-mount di kedua host. */}
      {room.type === "void" && (
        <>
          <Field label="Model railing">
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ["kaca", "Kaca"],
                  ["besi", "Besi"],
                  ["tembok", "Tembok"],
                  ["kayu", "Kayu"],
                ] as const
              ).map(([id, label]) => {
                const active =
                  !room.railingModelUrl && (room.railingStyle ?? "besi") === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    // Memilih gaya bawaan sekaligus melepas model GLB kustom.
                    onClick={() =>
                      updateRoom(room.id, {
                        railingStyle: id,
                        railingModelUrl: null,
                        railingModelAssetId: null,
                      })
                    }
                    className={cn(
                      "rounded-md border px-1.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted pointer-coarse:py-2.5",
                      active && "border-primary bg-primary/10",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>
          <p className="rounded-md bg-muted/50 p-2 text-xs leading-snug text-muted-foreground">
            Railing terpasang otomatis di sisi ruang ini yang berbagi ZONA
            open-plan dengan ruang solid tetangga (dindingnya di-drop supaya
            terkesan menyatu) — mencegah lubang lantai jadi drop-off tanpa
            pembatas. Sisi yang kena tepi bangunan tetap dapat dinding penuh,
            bukan railing.
          </p>
        </>
      )}

      {/* Ruang tangga: arah NAIK anak tangga (dirender solid di preview 3D). */}
      {room.type === "tangga" && (
        <Field label="Arah naik tangga">
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                ["n", "Utara ↑"],
                ["s", "Selatan ↓"],
                ["w", "Barat ←"],
                ["e", "Timur →"],
              ] as const
            ).map(([dir, label]) => {
              const active =
                (room.stairDirection ?? (room.width >= room.depth ? "e" : "s")) ===
                dir;
              return (
                <button
                  key={dir}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateRoom(room.id, { stairDirection: dir })}
                  className={cn(
                    "rounded-md border px-1.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted pointer-coarse:py-2.5",
                    active && "border-primary bg-primary/10",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {/* Ruang tangga: input riser + peringatan kenyamanan SNI. */}
      {room.type === "tangga" &&
        (() => {
          const spec = interiorStairSpec(room, riStairRise);
          const issues = stairComfortIssues(spec);
          return (
            <div className="space-y-1.5">
              <Label htmlFor="stair-riser">Tinggi tanjakan (riser, m)</Label>
              <Input
                id="stair-riser"
                type="number"
                step={0.005}
                min={0.1}
                max={0.25}
                value={room.stairRiserM ?? ""}
                placeholder="otomatis 0.18"
                aria-label="Tinggi tanjakan (riser, meter)"
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  updateRoom(room.id, {
                    stairRiserM: Number.isFinite(v) && v > 0 ? v : null,
                  });
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                {spec.steps} anak · tanjakan {(spec.riserM * 100).toFixed(0)} cm ·
                injakan {(spec.treadM * 100).toFixed(0)} cm
              </p>
              {issues.map((issue, i) => (
                <p
                  key={i}
                  className={
                    issue.level === "danger"
                      ? "text-[11px] text-destructive"
                      : "text-[11px] text-warning"
                  }
                >
                  {issue.message}
                </p>
              ))}
              <Label>Bentuk tangga</Label>
              <div className="flex gap-1">
                {(
                  [
                    ["lurus", "Bentuk lurus", "Lurus"],
                    ["L", "Bentuk L", "L"],
                    ["U", "Bentuk U", "U"],
                  ] as const
                ).map(([v, aria, label]) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={(room.stairShape ?? "lurus") === v ? "default" : "outline"}
                    aria-label={aria}
                    onClick={() =>
                      updateRoom(room.id, { stairShape: v === "lurus" ? null : v })
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {(room.stairShape === "L" || room.stairShape === "U") && (
                <div className="flex gap-1">
                  {(
                    [
                      ["kanan", "Belok kanan"],
                      ["kiri", "Belok kiri"],
                    ] as const
                  ).map(([v, label]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={(room.stairTurn ?? "kanan") === v ? "default" : "outline"}
                      aria-label={label}
                      onClick={() => updateRoom(room.id, { stairTurn: v })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              )}
              {interiorStairLayout(room, riStairRise).degraded && (
                <p className="text-[11px] text-warning">
                  Ruang terlalu kecil untuk bentuk ini — sementara digambar lurus.
                </p>
              )}
            </div>
          );
        })()}

      {/* Kolam: kustomisasi penuh (migrasi edit-flow PoolQuickEditor 3D). */}
      {room.type === "kolam" && <PoolSection pool={room} />}

      {/* Railing implisit (balkon / ruang di floor-rooftop) — dilebur ke sini
          (Fase 6) daripada dipasang terpisah di kedua host (2D/3D); void
          punya blok railingnya sendiri di atas (lihat komentar section). */}
      <RailingRoomContextCard surface={surface} />

      <Separator />

      <DeleteButton
        entityLabel="ruang"
        onDelete={() => deleteRef({ kind: "room", id: room.id })}
      />
    </InspectorCard>
  );
}

/* ───────────────────────────── Kolam renang ─────────────────────────────── */

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{k}</span>
      <span className="text-[11px] font-medium tabular-nums">{v}</span>
    </div>
  );
}

function PoolSection({ pool }: { pool: Room }) {
  const updateRoom = useEditorStore((s) => s.updateRoom);
  const deleteRef = useEditorStore((s) => s.deleteRef);
  const convertRoofToCourtyardZones = useEditorStore(
    (s) => s.convertRoofToCourtyardZones,
  );
  const kind: PoolKind = pool.poolKind ?? "renang";
  const spec = POOL_KINDS[kind];
  const c = poolCirculation(pool);
  const e = poolElectrical(pool);

  return (
    <div
      className="space-y-2.5 rounded-lg border border-sky-500/40 p-2.5"
      data-testid="pool-quick-editor"
    >
      <div className="flex items-center gap-2">
        <Waves className="size-4 text-sky-500" />
        <div>
          <p className="text-sm font-semibold">Kolam renang</p>
          <p className="text-xs text-muted-foreground">
            {spec.label} · {effectivePoolDepth(pool).toFixed(1)} m
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Tipe kolam</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(POOL_KINDS) as PoolKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() =>
                updateRoom(pool.id, {
                  poolKind: k,
                  poolDepthM: POOL_KINDS[k].defaultDepthM,
                })
              }
              className={cn(
                "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted pointer-coarse:py-2.5",
                kind === k && "border-sky-500 bg-sky-500/10",
              )}
            >
              {POOL_KINDS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">
          Kedalaman — {effectivePoolDepth(pool).toFixed(1)} m
        </p>
        <Slider
          key={`${pool.id}-${kind}`}
          min={spec.minDepthM}
          max={spec.maxDepthM}
          step={0.1}
          defaultValue={[effectivePoolDepth(pool)]}
          onValueCommit={([v]) =>
            updateRoom(pool.id, { poolDepthM: Math.round(v * 10) / 10 })
          }
          aria-label="Kedalaman kolam (meter)"
        />
      </div>

      {/* Kedalaman bervariasi (dasar miring) + tangga masuk.
          Kosong = uniform/tanpa undakan. */}
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">
          Kedalaman bervariasi (opsional)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground">
            Dangkal (m)
            <Input
              type="number"
              step={0.1}
              value={pool.poolShallowM ?? ""}
              placeholder="uniform"
              aria-label="Kedalaman dangkal (meter)"
              onChange={(ev) => {
                const v = parseFloat(ev.target.value);
                updateRoom(pool.id, { poolShallowM: Number.isFinite(v) ? v : null });
              }}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Dalam (m)
            <Input
              type="number"
              step={0.1}
              value={pool.poolDeepM ?? ""}
              placeholder="uniform"
              aria-label="Kedalaman dalam (meter)"
              onChange={(ev) => {
                const v = parseFloat(ev.target.value);
                updateRoom(pool.id, { poolDeepM: Number.isFinite(v) ? v : null });
              }}
            />
          </label>
        </div>
        <p className="text-[11px] font-medium text-muted-foreground">Tangga masuk</p>
        <div className="flex gap-1">
          {(
            [
              ["n", "Utara"],
              ["e", "Timur"],
              ["s", "Selatan"],
              ["w", "Barat"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={pool.poolEntrySide === v ? "default" : "outline"}
              aria-label={`Tangga masuk sisi ${label}`}
              onClick={() =>
                updateRoom(pool.id, {
                  poolEntrySide: pool.poolEntrySide === v ? null : v,
                })
              }
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Finish</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(POOL_FINISHES) as PoolFinish[]).map((f) => (
            <button
              key={f}
              type="button"
              title={POOL_FINISHES[f].label}
              aria-label={`Finish ${POOL_FINISHES[f].label}`}
              aria-pressed={(pool.poolFinish ?? "keramik_biru") === f}
              onClick={() => updateRoom(pool.id, { poolFinish: f })}
              className={cn(
                "size-7 rounded-md border-2 transition-transform hover:scale-105 pointer-coarse:size-9",
                (pool.poolFinish ?? "keramik_biru") === f
                  ? "border-sky-500"
                  : "border-transparent",
              )}
              style={{ backgroundColor: POOL_FINISHES[f].water }}
            />
          ))}
        </div>
      </div>

      {/* Opsi spa — hanya untuk spa/plunge. */}
      {(pool.poolKind === "spa" || pool.poolKind === "plunge") && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Opsi spa</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["poolHasJets", "Jet/blower"],
                ["poolHeater", "Pemanas"],
                ["poolSaltChlorinator", "Salt chlorinator"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={pool[key] ? "default" : "outline"}
                aria-label={label}
                onClick={() =>
                  updateRoom(pool.id, { [key]: pool[key] ? null : true })
                }
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Sistem perairan/sirkulasi — turunan teknik otomatis + denah pipa. */}
      <div className="space-y-1.5 rounded-md border px-2 py-2">
        <p className="text-xs font-medium">Sistem perairan</p>
        <div className="flex gap-1 pb-1">
          {(
            [
              ["skimmer", "Skimmer"],
              ["overflow", "Overflow"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={
                (pool.poolCirculationType ?? "skimmer") === v ? "default" : "outline"
              }
              aria-label={`Sistem ${label}`}
              onClick={() =>
                updateRoom(pool.id, {
                  poolCirculationType: v === "skimmer" ? null : v,
                })
              }
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <SpecRow k="Volume" v={`${c.volumeM3} m³`} />
          <SpecRow k="Debit" v={`${c.flowM3h} m³/j`} />
          <SpecRow k="Pompa" v={`${c.pumpHp} HP`} />
          <SpecRow
            k="Filter"
            v={c.filterKind === "cartridge" ? "cartridge" : `pasir Ø${c.filterDiaInch}″`}
          />
          {c.circulationType === "overflow" ? (
            <SpecRow k="Gutter" v={`±${c.gutterM} m`} />
          ) : (
            <SpecRow k="Skimmer" v={`${c.skimmers}`} />
          )}
          <SpecRow k="Inlet" v={`${c.returns}`} />
          <SpecRow k="Main drain" v={`${c.mainDrains}`} />
          <SpecRow k="Turnover" v={`${c.turnoverHours} j`} />
          {c.circulationType === "overflow" && (
            <SpecRow k="Balancing" v={`${c.balancingTankM3} m³`} />
          )}
          <SpecRow k="Pipa hisap" v={`Ø${c.suctionPipeMm}`} />
          <SpecRow k="Pipa balik" v={`Ø${c.returnPipeMm}`} />
        </div>
        <PoolPipingDenah room={pool} />
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] text-muted-foreground">
          <span>
            <span className="text-amber-500">●</span> skimmer
          </span>
          <span>
            <span className="text-sky-400">●</span> inlet
          </span>
          <span>
            <span className="text-red-500">●</span> main drain
          </span>
          <span>
            <span className="text-slate-500">▮</span> pompa/filter
          </span>
          <span>± {c.estPipeM} m pipa</span>
        </div>
      </div>

      {/* Kelistrikan — MCB pompa, lampu bawah air + trafo, bonding, beban. */}
      <div className="space-y-1 rounded-md border px-2 py-2">
        <p className="text-xs font-medium">Kelistrikan</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <SpecRow k="Pompa" v={`${e.pumpKw} kW`} />
          <SpecRow k="MCB pompa" v={`${e.pumpBreakerA} A`} />
          <SpecRow k="Lampu air" v={`${e.lights}× ${e.lightWattEach} W`} />
          <SpecRow k="Trafo" v={`${e.transformerVa} VA`} />
          <SpecRow k="Beban total" v={`${e.totalLoadW} W`} />
          <SpecRow k="Bonding" v={`± ${e.bondingM} m`} />
        </div>
        <p className="text-[9px] leading-snug text-muted-foreground">
          Pembumian ekipotensial (bonding) wajib untuk keselamatan; lampu 12V
          via trafo. Beban ini otomatis masuk hitungan daya PLN.
        </p>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="w-full text-destructive hover:text-destructive"
        data-testid="pool-delete"
        onClick={() => deleteRef({ kind: "room", id: pool.id })}
      >
        Hapus kolam
      </Button>
    </div>
  );
}

/** Denah pipa kolam mini (skimmer/inlet/main-drain → pompa/filter). */
function PoolPipingDenah({ room }: { room: Room }) {
  const fittings = poolFittings(room);
  const maxDim = Math.max(room.width, room.depth, 1);
  const PX = 140;
  const pw = (room.width / maxDim) * PX;
  const pd = (room.depth / maxDim) * PX;
  const ox = 10;
  const oy = 10;
  const eqX = ox + pw + 42;
  const eqY = oy + pd / 2;
  const px = (u: number) => ox + u * pw;
  const py = (v: number) => oy + v * pd;
  const svgW = eqX + 26;
  const svgH = oy + pd + 10;
  const dot = (k: string) =>
    k === "skimmer" ? "#f59e0b" : k === "return" ? "#38bdf8" : "#ef4444";
  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="h-auto w-full rounded-md border bg-muted/30"
    >
      {fittings
        .filter((f) => f.kind !== "equipment")
        .map((f, i) => (
          <line
            key={`pipe-${i}`}
            x1={px(f.u)}
            y1={py(f.v)}
            x2={eqX}
            y2={eqY}
            stroke={f.kind === "return" ? "#38bdf8" : "#1e3a5f"}
            strokeWidth={1}
            strokeDasharray={f.kind === "return" ? undefined : "3 2"}
          />
        ))}
      <rect
        x={ox}
        y={oy}
        width={pw}
        height={pd}
        fill="#2f8fd0"
        fillOpacity={0.3}
        stroke="#7dd3fc"
        strokeWidth={1.2}
      />
      {fittings
        .filter((f) => f.kind !== "equipment")
        .map((f, i) => (
          <circle
            key={`fit-${i}`}
            cx={px(f.u)}
            cy={py(f.v)}
            r={2.6}
            fill={dot(f.kind)}
            stroke="#fff"
            strokeWidth={0.5}
          />
        ))}
      <rect x={eqX - 8} y={eqY - 7} width={16} height={14} rx={2} fill="#64748b" />
    </svg>
  );
}
