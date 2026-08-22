"use client";

/**
 * RoofInspector terpadu (unifikasi P2) — konsolidasi TIGA editor atap yang
 * dulunya terpisah dan saling tak-superset:
 *   1. `RoofQuickEditor` (panel 3D, preview-controls) — grid tipe, slider
 *      kemiringan/overhang, fascia, toggle rooftop + cakupan dak,
 *   2. `RoofInspector` (SummaryInspector 2D) — input angka + konversi zona,
 *   3. `RoofZoneInspector` (2D) — editor per-zona atap.
 * Kini SATU kartu per kind (`roof` global / `roofZone`) dirender identik di
 * kedua surface, plus `RoofSummarySection` untuk fallback tanpa-seleksi di
 * SummaryInspector 2D (kontrak e2e: radiogroup "Mode deck rooftop" dan tombol
 * "Jadikan zona atap editable" harus bisa dicapai TANPA seleksi apa pun).
 *
 * Kontrak yang dipertahankan (e2e + unit):
 * - testid `roof-quick-editor`, `rooftop-make-full`, `rooftop-make-partial`,
 *   `rooftop-add-terrace`, `rooftop-railing-open`;
 * - heading exact "Zona atap", tombol "Kiri / kanan" / "Depan / belakang",
 *   ToggleRow "Sembunyikan zona" (roof-zone.spec.ts, editor-inspector.test);
 * - radiogroup "Mode deck rooftop", radio "Deck penuh"/"Deck sebagian",
 *   aria "Posisi X/Y deck rooftop (meter)" / "Lebar…" / "Dalam…", teks
 *   "Deck N m²"/"Atap N m²", default parsial 60% footprint centred.
 *
 * Jebakan yang ditangani: `setRooftop` MENGOSONGKAN seleksi (epilogue commit)
 * — kartu me-re-select {kind:"roof"} setelah toggle supaya tidak menutup diri,
 * dan menyinkronkan visibilitas lantai preview via initFloors.
 */

import * as React from "react";
import { Home, X } from "lucide-react";
import { toast } from "sonner";

import type { DesignLayout, RoofMaterial, RoofSpec, RoofType, RoofZone } from "@/types";
import { ROOF_MATERIALS, ROOF_TYPES } from "@/lib/constants";
import { useEditorStore, DEFAULT_ROOF } from "@/stores/editor-store";
import { usePreviewStore } from "@/stores/preview-store";
import { ROOFTOP_RAIL_ID } from "@/lib/three/build-model";
import {
  hasRooftopFloor,
  isPartialRooftop,
  defaultDeckArea,
} from "@/lib/geometry/rooftop";
import { flatRoofHosts } from "@/lib/geometry/roof-holes";
import { topRegularFloorId } from "@/lib/editor/floors";
import { buildingFootprint, buildingFootprintArea } from "@/lib/structural/grid";
import { formatArea } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DeleteButton,
  DirectionPicker,
  Field,
  InspectorCard,
  NumField,
  SegmentedControl,
  ToggleRow,
} from "./fields";
import type { InspectorSurface } from "./registry";

/** Pilihan warna lis fascia (band tepi atap/dak). Swatch berwarna — bukan
 * idiom label SegmentedControl, sengaja dibiarkan hand-rolled (lih. TODO
 * StyleTilePicker di cladding-grid.tsx). */
const FASCIA_COLORS: Array<{ color: string; label: string }> = [
  { color: "#3c4245", label: "Abu gelap" },
  { color: "#1d2022", label: "Hitam" },
  { color: "#e8e6e0", label: "Putih" },
  { color: "#8a6242", label: "Kayu" },
];

const GABLE_END_OPTIONS: ReadonlyArray<{
  value: "none" | "wall" | "glass";
  label: string;
}> = [
  { value: "none", label: "Tanpa" },
  { value: "wall", label: "Dinding" },
  { value: "glass", label: "Kaca" },
];

const ROOF_TYPE_OPTIONS: ReadonlyArray<{ value: RoofType; label: string }> = (
  Object.keys(ROOF_TYPES) as RoofType[]
).map((t) => ({ value: t, label: ROOF_TYPES[t] }));

export function RoofInspectorCard({ surface }: { surface: InspectorSurface }) {
  const kind = useEditorStore((s) => s.selected?.kind ?? null);
  if (kind === "roofZone") return <RoofZoneCard surface={surface} />;
  if (kind === "roof") return <RoofGlobalCard surface={surface} />;
  return null;
}

/* ────────────────────────── Atap global (kind "roof") ───────────────────── */

function RoofGlobalCard({ surface }: { surface: InspectorSurface }) {
  const layout = useEditorStore((s) => s.layout);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  if (!layout) return null;
  const roof = { ...DEFAULT_ROOF, ...layout.roof };

  return (
    <InspectorCard
      className={cn("space-y-2.5", surface === "3d" && "border-primary/40")}
      data-testid="roof-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Home className="size-4 text-primary" />
          <div>
            <p className="text-sm font-semibold">Atap</p>
            <p className="text-xs text-muted-foreground">
              {ROOF_TYPES[roof.type]} · {ROOF_MATERIALS[roof.material]}
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor atap"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <RoofGlobalBody surface={surface} />
    </InspectorCard>
  );
}

/**
 * Fallback tanpa-seleksi di SummaryInspector 2D — body yang sama persis
 * dengan kartu kind "roof" (satu sumber kebenaran), hanya heading section
 * sebagai chrome host.
 */
export function RoofSummarySection() {
  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-medium">Atap</h3>
      <RoofGlobalBody surface="2d" />
    </div>
  );
}

const GABLE_END_LABEL: Record<string, string> = {
  n: "utara",
  s: "selatan",
  w: "barat",
  e: "timur",
};

/** Kontrol SOPI-SOPI per ujung bubungan (pelana): Tanpa / Dinding / Kaca. */
function GableEndControls({
  ridgeAlongX,
  ends,
  onChange,
}: {
  ridgeAlongX: boolean;
  ends: Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">> | undefined;
  onChange: (next: Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">>) => void;
}) {
  const sides: Array<"n" | "s" | "w" | "e"> = ridgeAlongX ? ["w", "e"] : ["n", "s"];
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">
        Sopi-sopi (isi ujung bubungan)
      </p>
      {sides.map((side) => (
        <div key={side} className="flex items-center gap-2">
          <span className="w-16 text-xs text-muted-foreground">
            Ujung {GABLE_END_LABEL[side]}
          </span>
          <div className="flex-1">
            <SegmentedControl
              value={ends?.[side] ?? "none"}
              onChange={(val) =>
                onChange({ ...ends, [side]: val === "none" ? undefined : val })
              }
              options={GABLE_END_OPTIONS}
              columns={3}
              ariaLabel={`Sopi-sopi ${GABLE_END_LABEL[side]}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RoofGlobalBody({ surface }: { surface: InspectorSurface }) {
  const layout = useEditorStore((s) => s.layout);
  const setRoof = useEditorStore((s) => s.setRoof);
  const setRooftop = useEditorStore((s) => s.setRooftop);
  const setRooftopArea = useEditorStore((s) => s.setRooftopArea);
  const addRooftopTerrace = useEditorStore((s) => s.addRooftopTerrace);
  const convertLegacyRoofToZone = useEditorStore((s) => s.convertLegacyRoofToZone);
  const addSkylight = useEditorStore((s) => s.addSkylight);
  if (!layout) return null;

  const roof = { ...DEFAULT_ROOF, ...layout.roof };
  const hasRoofZones = (layout.roofZones?.length ?? 0) > 0;
  const hasRooftopDeck = layout.floors.some((f) => f.id === "floor-rooftop");
  // Dak rooftop PENUH menutupi seluruh atap → atap miring ditekan (build-model
  // melewati blok atap saat hasRooftopFloor & bukan parsial). Deteksi ini
  // supaya panel bisa jujur + menawarkan "jadikan sebagian".
  const rooftopPartial = hasRooftopDeck && isPartialRooftop(layout);
  const rooftopDefaultDeck =
    hasRooftopDeck && !rooftopPartial
      ? defaultDeckArea(buildingFootprint(layout))
      : null;
  const hasFlatHost = flatRoofHosts(layout).length > 0;
  const hasRooftopTerrace = layout.rooms.some(
    (r) => r.floorId === "floor-rooftop" && r.type === "rooftop_lounge",
  );

  const toggleRooftop = (v: boolean) => {
    // setRooftop menata ulang daftar lantai → epilogue commit mengosongkan
    // seleksi. Re-select supaya kartu (jika sedang jadi kartu seleksi) tidak
    // menutup diri, lalu sinkronkan visibilitas lantai preview.
    const wasSelected = useEditorStore.getState().selected?.kind === "roof";
    setRooftop(v);
    const st = useEditorStore.getState();
    if (st.layout) {
      usePreviewStore.getState().initFloors(st.layout.floors.map((f) => f.id));
    }
    if (wasSelected) st.select({ kind: "roof" });
  };

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Tipe atap</p>
        <SegmentedControl
          value={roof.type}
          onChange={(t) => setRoof({ type: t })}
          options={ROOF_TYPE_OPTIONS}
          columns={2}
          ariaLabel="Tipe atap"
        />
      </div>

      {roof.type !== "datar" && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            Kemiringan — {roof.slopeDeg}°
          </p>
          <Slider
            key={`slope-${roof.type}-${roof.slopeDeg}`}
            min={roof.type === "miring" ? 5 : 15}
            max={40}
            step={1}
            defaultValue={[roof.slopeDeg]}
            onValueCommit={([v]) => setRoof({ slopeDeg: v })}
            aria-label="Kemiringan atap (derajat)"
          />
        </div>
      )}

      {roof.type === "miring" && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            Arah turun (sisi rendah — arah air)
          </p>
          <DirectionPicker
            value={roof.lowSide ?? "s"}
            onChange={(s) => setRoof({ lowSide: s })}
            ariaLabel="Arah turun atap miring"
          />
        </div>
      )}

      {roof.type === "pelana" && (
        <>
          <NumField
            key={`roof-ro-${roof.ridgeOffsetM ?? 0}`}
            label="Geser bubungan (m) — gable asimetris"
            value={roof.ridgeOffsetM ?? 0}
            min={-6}
            max={6}
            step={0.1}
            onCommit={(v) => setRoof({ ridgeOffsetM: v })}
          />
          {(() => {
            const fp = buildingFootprint(layout);
            const ridgeAlongX =
              (fp.widthM > 0 ? fp.widthM : 1) >= (fp.depthM > 0 ? fp.depthM : 0);
            return (
              <GableEndControls
                ridgeAlongX={ridgeAlongX}
                ends={roof.gableEnds}
                onChange={(next) => setRoof({ gableEnds: next })}
              />
            );
          })()}
        </>
      )}

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">
          Overhang (tritisan) — {roof.overhangM.toFixed(2)} m
        </p>
        <Slider
          key={`overhang-${roof.overhangM}`}
          min={0}
          max={1}
          step={0.05}
          defaultValue={[roof.overhangM]}
          onValueCommit={([v]) => setRoof({ overhangM: Math.round(v * 100) / 100 })}
          aria-label="Overhang atap (meter)"
        />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-muted-foreground">Material atap</p>
        <Select
          value={roof.material}
          onValueChange={(v) => setRoof({ material: v as RoofMaterial })}
        >
          <SelectTrigger size="sm" className="w-full pointer-coarse:h-10" aria-label="Material atap">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROOF_MATERIALS) as RoofMaterial[]).map((m) => (
              <SelectItem key={m} value={m}>
                {ROOF_MATERIALS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lis fascia — global-only by design (per-zona belum didukung model). */}
      <div className="space-y-2 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">Lis fascia (tepi gelap)</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Band di tepi bawah atap (eave) — atap datar/dak, pelana,
              limasan, miring, & tepi dak balkon.
            </p>
          </div>
          <Switch
            checked={!!roof.fascia}
            onCheckedChange={(v) =>
              setRoof({
                fascia: v ? { heightM: 0.35, color: "#3c4245" } : undefined,
              })
            }
            aria-label="Lis fascia"
          />
        </div>
        {roof.fascia && (
          <>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                Tinggi band — {roof.fascia.heightM.toFixed(2)} m
              </p>
              <Slider
                key={`fascia-${roof.fascia.heightM}`}
                min={0.2}
                max={0.6}
                step={0.05}
                defaultValue={[roof.fascia.heightM]}
                onValueCommit={([v]) =>
                  setRoof({
                    fascia: { ...roof.fascia!, heightM: Math.round(v * 100) / 100 },
                  })
                }
                aria-label="Tinggi lis fascia (meter)"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {FASCIA_COLORS.map((c) => (
                <button
                  key={c.color}
                  type="button"
                  title={c.label}
                  aria-label={`Warna fascia ${c.label}`}
                  aria-pressed={roof.fascia!.color === c.color}
                  onClick={() =>
                    setRoof({ fascia: { ...roof.fascia!, color: c.color } })
                  }
                  className={cn(
                    "size-7 rounded-md border-2 transition-transform hover:scale-105 pointer-coarse:size-9",
                    roof.fascia!.color === c.color
                      ? "border-primary"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: c.color }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div>
          <p className="text-xs font-medium">Rooftop (dak beton)</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Lantai dak terbuka di atas — railing otomatis.
          </p>
        </div>
        <Switch
          checked={hasRooftopDeck}
          onCheckedChange={toggleRooftop}
          aria-label="Rooftop (dak beton)"
        />
      </div>

      {/* Cakupan rooftop: penuh (dak menutupi seluruh atap → atap miring tak
          tampil) vs sebagian (dak di satu bagian, atap menutupi sisanya). */}
      {hasRooftopDeck && (
        <div
          className={cn(
            "space-y-1.5 rounded-md border px-2 py-2",
            !rooftopPartial &&
              roof.type !== "datar" &&
              "border-amber-500/60 bg-amber-500/5",
          )}
        >
          <p className="text-xs font-medium">Cakupan rooftop</p>
          {rooftopPartial ? (
            <>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Dak <b>sebagian</b> — atap {ROOF_TYPES[roof.type]} menutupi
                sisanya. Atur letak & ukuran deck di bagian &quot;Deck
                rooftop&quot; di bawah.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full pointer-coarse:h-10"
                data-testid="rooftop-make-full"
                onClick={() => setRooftopArea(undefined)}
              >
                Jadikan dak penuh
              </Button>
            </>
          ) : (
            <>
              {roof.type !== "datar" && (
                <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-500">
                  Dak menutupi <b>seluruh</b> atap → atap {ROOF_TYPES[roof.type]}{" "}
                  tidak tampil. Jadikan sebagian agar dak + atap{" "}
                  {ROOF_TYPES[roof.type]} muncul bersama.
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full pointer-coarse:h-10"
                disabled={!rooftopDefaultDeck}
                data-testid="rooftop-make-partial"
                onClick={() =>
                  rooftopDefaultDeck && setRooftopArea(rooftopDefaultDeck)
                }
              >
                Jadikan rooftop sebagian
              </Button>
              {!rooftopDefaultDeck && (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Footprint terlalu kecil untuk dibagi jadi dak + atap.
                </p>
              )}
            </>
          )}

          {/* Furnitur di dak: ruang teras (rooftop_lounge) mengikuti dak →
              muncul di editor Interior (furnitur outdoor bawaan). */}
          <div className="border-t pt-1.5">
            {hasRooftopTerrace ? (
              <p className="text-[10px] leading-snug text-muted-foreground">
                Ruang teras aktif — isi/atur furnitur di editor <b>Interior</b>.
              </p>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full pointer-coarse:h-10"
                data-testid="rooftop-add-terrace"
                onClick={() => {
                  addRooftopTerrace();
                  toast.success(
                    "Ruang teras dibuat — isi furnitur di editor Interior.",
                  );
                }}
              >
                + Ruang teras (bisa diisi furnitur)
              </Button>
            )}
          </div>

          <RooftopAccessSection layout={layout} />

          {/* Railing dak — SATU jalur: buka kartu railing terpadu. */}
          <div className="space-y-1 border-t pt-1.5">
            <Button
              size="sm"
              variant="outline"
              className="w-full pointer-coarse:h-10"
              data-testid="rooftop-railing-open"
              onClick={() =>
                useEditorStore
                  .getState()
                  .select({ kind: "railing", roomId: ROOFTOP_RAIL_ID })
              }
            >
              Atur railing dak ({layout.rooftopRailingStyle ?? "kaca"})
            </Button>
          </div>
        </div>
      )}

      {hasRooftopFloor(layout) && (
        <RooftopDeckSection layout={layout} setRooftopArea={setRooftopArea} />
      )}

      {/* Skylight — cahaya zenithal pada bidang atap datar/dak/zona datar. */}
      <div className="space-y-1.5 border-t pt-2" data-testid="roof-skylight-section">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">
            Skylight{(layout.skylights?.length ?? 0) > 0 ? ` (${layout.skylights!.length})` : ""}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="pointer-coarse:h-10"
            data-testid="skylight-add"
            disabled={!hasFlatHost}
            onClick={() => {
              const id = addSkylight();
              if (id)
                toast.success(
                  "Skylight ditambahkan — geser posisinya di layer Atap 2D.",
                );
            }}
          >
            + Skylight
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {hasFlatHost
            ? "Bukaan kaca di bidang atap datar — untuk koridor tengah, kamar mandi dalam, atau tangga."
            : "Butuh bidang atap DATAR (atap datar, dak rooftop, atau zona atap datar)."}
        </p>
      </div>

      {/* Zona atap eksplisit — konversi dari mode global legacy. */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        {hasRoofZones ? (
          <p>
            Layout memakai <b>{layout.roofZones?.length}</b> zona atap eksplisit.
            Pilih zona di kanvas 2D untuk mengedit ukuran, material, dan
            kemiringannya.
          </p>
        ) : (
          <div className="space-y-2">
            <p>
              Saat ini atap masih mode global legacy. Ubah menjadi zona eksplisit
              agar massa atap bisa dipisah/diatur seperti scene referensi.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full pointer-coarse:h-10"
              onClick={convertLegacyRoofToZone}
            >
              Jadikan zona atap editable
            </Button>
          </div>
        )}
      </div>

      {surface === "3d" && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Aktifkan &quot;Tampilkan atap&quot; (Opsi tampilan) bila atap tidak
          terlihat. Plafon per ruang diatur di section Material.
        </p>
      )}
    </div>
  );
}

/**
 * Akses ke DAK — arsitek: dak yang bisa diinjak wajib punya jalur akses.
 * Dihuni (teras/lounge) → tangga dalam ruang di lantai teratas; dak servis
 * (tandon, AC outdoor) → tangga monyet (ship ladder) di muka luar cukup.
 */
function RooftopAccessSection({ layout }: { layout: DesignLayout }) {
  const addRooftopAccessStair = useEditorStore((s) => s.addRooftopAccessStair);
  const setRooftopAccessLadder = useEditorStore((s) => s.setRooftopAccessLadder);
  const selectObject = useEditorStore((s) => s.selectObject);

  const topRegular = layout.floors.find(
    (f) => f.id === topRegularFloorId(layout.floors),
  );
  const hasStairAccess = layout.rooms.some(
    (r) => r.type === "tangga" && r.floorId === topRegular?.id,
  );
  const ladder = layout.rooftopAccess?.kind === "tangga_monyet"
    ? layout.rooftopAccess
    : null;
  const inhabited = layout.rooms.some(
    (r) => r.floorId === "floor-rooftop" && r.type === "rooftop_lounge",
  );

  return (
    <div className="space-y-1.5 border-t pt-1.5" data-testid="rooftop-access-section">
      <p className="text-xs font-medium">Akses ke dak</p>

      {hasStairAccess ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Tangga dalam ruang di {topRegular?.name ?? "lantai teratas"} ✓ — slab
          dak otomatis berlubang di atasnya.
        </p>
      ) : ladder ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Tangga monyet (servis) terpasang di muka luar.
        </p>
      ) : (
        <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-500">
          Dak belum punya akses — orang tidak bisa naik. Pilih tangga dalam
          ruang (dak dihuni) atau tangga monyet (dak servis).
        </p>
      )}
      {inhabited && !hasStairAccess && ladder && (
        <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-500">
          Dak dihuni (ada ruang teras) — sebaiknya tangga dalam ruang, bukan
          hanya tangga monyet.
        </p>
      )}

      {!hasStairAccess && (
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          data-testid="rooftop-access-add-stair"
          onClick={() => {
            const id = addRooftopAccessStair();
            if (id) {
              toast.success(
                "Tangga akses dak ditambahkan di lantai teratas — geser & atur arahnya di 2D.",
              );
              selectObject(id);
            }
          }}
        >
          + Tangga ke dak ({topRegular?.name ?? "lantai teratas"})
        </Button>
      )}

      {ladder ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">
            Sisi tangga monyet
          </p>
          <DirectionPicker
            value={ladder.side}
            onChange={(side) => setRooftopAccessLadder(side)}
            ariaLabel="Sisi tangga monyet"
          />
          {(() => {
            const fp = buildingFootprint(layout);
            const len =
              ladder.side === "n" || ladder.side === "s" ? fp.widthM : fp.depthM;
            if (!(len > 0)) return null;
            return (
              <NumField
                label={`Posisi di sisi (m dari ujung, maks ${len.toFixed(1)})`}
                value={ladder.posM ?? Math.round((len / 2) * 100) / 100}
                min={0.25}
                max={len}
                step={0.1}
                onCommit={(v) => setRooftopAccessLadder(ladder.side, v)}
              />
            );
          })()}
          <p className="text-[11px] leading-snug text-muted-foreground">
            Bisa juga digeser langsung di layer &quot;Atap&quot; 2D (seret
            marker).
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => setRooftopAccessLadder(null)}
          >
            Lepas tangga monyet
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          data-testid="rooftop-access-add-ladder"
          onClick={() => setRooftopAccessLadder("s")}
        >
          + Tangga monyet (dak servis)
        </Button>
      )}
    </div>
  );
}

/* ─────────────────────────── Deck rooftop (dak) ─────────────────────────── */

/** Round a metre² value to 1dp for display. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type DeckArea = { x: number; y: number; width: number; depth: number };

/**
 * Kontrol deck rooftop (tampil hanya bila layout punya `floor-rooftop`):
 * deck penuh (hapus `rooftopArea`) atau parsial (rect yang diatur via input
 * X/Y/Lebar/Dalam). Store me-re-clamp setiap commit ke footprint bangunan,
 * jadi input hanya mengusulkan nilai lalu membaca ulang hasilnya.
 */
function RooftopDeckSection({
  layout,
  setRooftopArea,
}: {
  layout: DesignLayout;
  setRooftopArea: (a: DeckArea | undefined) => void;
}) {
  const area = layout.rooftopArea;
  const fp = buildingFootprint(layout);
  const partial = !!area;

  const selectFull = () => setRooftopArea(undefined);
  const selectPartial = () => {
    if (area) return;
    // Default partial deck: 60% of the footprint, centred (clamp handled by store).
    setRooftopArea({
      x: fp.x0 + fp.widthM * 0.2,
      y: fp.y0 + fp.depthM * 0.2,
      width: fp.widthM * 0.6,
      depth: fp.depthM * 0.6,
    });
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h4 className="text-sm font-medium">Deck rooftop</h4>

      <div
        role="radiogroup"
        aria-label="Mode deck rooftop"
        className="grid grid-cols-2 gap-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!partial}
          aria-label="Deck penuh"
          onClick={selectFull}
          className={cn(
            "rounded-md border px-2 py-1.5 text-xs pointer-coarse:py-2.5",
            !partial ? "border-primary bg-primary/10" : "hover:bg-muted",
          )}
        >
          Deck penuh
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={partial}
          aria-label="Deck sebagian"
          onClick={selectPartial}
          className={cn(
            "rounded-md border px-2 py-1.5 text-xs pointer-coarse:py-2.5",
            partial ? "border-primary bg-primary/10" : "hover:bg-muted",
          )}
        >
          Deck sebagian
        </button>
      </div>

      {area && (
        // Keyed on the clamped store value so an external change (canvas drag)
        // or a re-clamp on commit refreshes the input display.
        <RooftopDeckInputs
          key={`${area.x}:${area.y}:${area.width}:${area.depth}`}
          area={area}
          layout={layout}
          setRooftopArea={setRooftopArea}
        />
      )}
    </div>
  );
}

function RooftopDeckInputs({
  area,
  layout,
  setRooftopArea,
}: {
  area: DeckArea;
  layout: DesignLayout;
  setRooftopArea: (a: DeckArea | undefined) => void;
}) {
  const [x, setX] = React.useState(String(area.x));
  const [y, setY] = React.useState(String(area.y));
  const [w, setW] = React.useState(String(area.width));
  const [d, setD] = React.useState(String(area.depth));

  // Propose a new value for one field; the store re-clamps to the footprint and
  // the keyed remount refreshes the display. Non-numeric input reverts.
  const commit =
    (field: "x" | "y" | "width" | "depth", raw: string, reset: () => void) =>
    () => {
      const v = Number(raw);
      if (!Number.isFinite(v)) {
        reset();
        return;
      }
      setRooftopArea({ ...area, [field]: Math.round(v * 100) / 100 });
    };

  const deckArea = round1(area.width * area.depth);
  const roofArea = Math.max(0, round1(buildingFootprintArea(layout) - deckArea));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="X (m)">
          <Input
            type="number"
            step={0.1}
            value={x}
            aria-label="Posisi X deck rooftop (meter)"
            onChange={(e) => setX(e.target.value)}
            onBlur={commit("x", x, () => setX(String(area.x)))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Field>
        <Field label="Y (m)">
          <Input
            type="number"
            step={0.1}
            value={y}
            aria-label="Posisi Y deck rooftop (meter)"
            onChange={(e) => setY(e.target.value)}
            onBlur={commit("y", y, () => setY(String(area.y)))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Field>
        <Field label="Lebar (m)">
          <Input
            type="number"
            step={0.1}
            value={w}
            aria-label="Lebar deck rooftop (meter)"
            onChange={(e) => setW(e.target.value)}
            onBlur={commit("width", w, () => setW(String(area.width)))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Field>
        <Field label="Dalam (m)">
          <Input
            type="number"
            step={0.1}
            value={d}
            aria-label="Dalam deck rooftop (meter)"
            onChange={(e) => setD(e.target.value)}
            onBlur={commit("depth", d, () => setD(String(area.depth)))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Deck {deckArea} m²</span>
        <span className="font-semibold">Atap {roofArea} m²</span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Zona atap (roofZone) ───────────────────────── */

function RoofZoneCard({ surface }: { surface: InspectorSurface }) {
  const id = useEditorStore((s) =>
    s.selected?.kind === "roofZone" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const zone = layout?.roofZones?.find((z) => z.id === id);
  if (!zone || !layout) return null;
  return <RoofZoneBody key={zone.id} zone={zone} surface={surface} />;
}

function RoofZoneBody({
  zone,
  surface,
}: {
  zone: RoofZone;
  surface: InspectorSurface;
}) {
  const layout = useEditorStore((s) => s.layout)!;
  const updateRoofZone = useEditorStore((s) => s.updateRoofZone);
  const splitRoofZone = useEditorStore((s) => s.splitRoofZone);
  const setRoofZoneHidden = useEditorStore((s) => s.setRoofZoneHidden);
  const deleteRef = useEditorStore((s) => s.deleteRef);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const defaultMaterial = layout.roof?.material ?? DEFAULT_ROOF.material;

  const [x, setX] = React.useState(String(zone.x));
  const [y, setY] = React.useState(String(zone.y));
  const [width, setWidth] = React.useState(String(zone.widthM));
  const [depth, setDepth] = React.useState(String(zone.depthM));
  const [slope, setSlope] = React.useState(String(zone.slopeDeg));
  const [overhang, setOverhang] = React.useState(String(zone.overhangM));

  const commitNumber = (
    key: "x" | "y" | "widthM" | "depthM" | "slopeDeg" | "overhangM",
    raw: string,
    min: number,
    max: number,
  ) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const clamped = Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
    if (clamped !== zone[key]) updateRoofZone(zone.id, { [key]: clamped });
  };

  const setType = (type: RoofZone["type"]) => {
    updateRoofZone(zone.id, {
      type,
      slopeDeg:
        type === "datar"
          ? 0
          : Math.min(60, Math.max(zone.slopeDeg, type === "miring" ? 5 : 15)),
      lowSide: type === "miring" ? (zone.lowSide ?? "s") : undefined,
    });
  };

  return (
    <InspectorCard
      className={cn("space-y-4", surface === "3d" && "border-primary/40")}
      data-testid="roof-zone-inspector"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Zona atap</h3>
          <p className="text-xs text-muted-foreground">
            Area proyeksi: {formatArea(zone.widthM * zone.depthM)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">{ROOF_TYPES[zone.type]}</Badge>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 pointer-coarse:size-9"
            aria-label="Tutup editor zona atap"
            onClick={clearSelection}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <Field label="Tipe zona">
        <Select value={zone.type} onValueChange={(v) => setType(v as RoofZone["type"])}>
          <SelectTrigger aria-label="Tipe zona atap">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROOF_TYPES) as RoofZone["type"][]).map((t) => (
              <SelectItem key={t} value={t}>
                {ROOF_TYPES[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="X tengah (m)">
          <Input
            type="number"
            step={0.1}
            value={x}
            onChange={(e) => setX(e.target.value)}
            onBlur={() => commitNumber("x", x, -100, 100)}
          />
        </Field>
        <Field label="Y tengah (m)">
          <Input
            type="number"
            step={0.1}
            value={y}
            onChange={(e) => setY(e.target.value)}
            onBlur={() => commitNumber("y", y, -100, 100)}
          />
        </Field>
        <Field label="Lebar (m)">
          <Input
            type="number"
            step={0.1}
            min={0.5}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            onBlur={() => commitNumber("widthM", width, 0.5, 100)}
          />
        </Field>
        <Field label="Dalam (m)">
          <Input
            type="number"
            step={0.1}
            min={0.5}
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            onBlur={() => commitNumber("depthM", depth, 0.5, 100)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Kemiringan (°)">
          <Input
            type="number"
            step={1}
            min={zone.type === "miring" ? 5 : 15}
            max={60}
            value={slope}
            disabled={zone.type === "datar"}
            onChange={(e) => setSlope(e.target.value)}
            onBlur={() =>
              commitNumber(
                "slopeDeg",
                slope,
                zone.type === "miring" ? 5 : zone.type === "datar" ? 0 : 15,
                60,
              )
            }
          />
        </Field>
        <Field label="Overhang (m)">
          <Input
            type="number"
            step={0.1}
            min={0}
            max={2}
            value={overhang}
            onChange={(e) => setOverhang(e.target.value)}
            onBlur={() => commitNumber("overhangM", overhang, 0, 2)}
          />
        </Field>
      </div>

      {zone.type === "miring" && (
        <Field label="Arah turun (sisi rendah)">
          <DirectionPicker
            value={zone.lowSide ?? "s"}
            onChange={(v) => updateRoofZone(zone.id, { lowSide: v })}
            ariaLabel="Arah turun zona atap miring"
          />
        </Field>
      )}

      {zone.type === "pelana" && (
        <>
          <NumField
            key={`ro-${zone.id}`}
            label="Geser bubungan (m) — gable asimetris"
            value={zone.ridgeOffsetM ?? 0}
            min={-(Math.min(zone.widthM, zone.depthM) / 2 - 0.3)}
            max={Math.min(zone.widthM, zone.depthM) / 2 - 0.3}
            step={0.1}
            onCommit={(v) => updateRoofZone(zone.id, { ridgeOffsetM: v })}
          />
          <GableEndControls
            ridgeAlongX={zone.widthM >= zone.depthM}
            ends={zone.gableEnds}
            onChange={(next) => updateRoofZone(zone.id, { gableEnds: next })}
          />
        </>
      )}

      <Field label="Material atap">
        <Select
          value={zone.materialId ?? defaultMaterial}
          onValueChange={(v) => updateRoofZone(zone.id, { materialId: v })}
        >
          <SelectTrigger aria-label="Material zona atap">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROOF_MATERIALS) as RoofSpec["material"][]).map((m) => (
              <SelectItem key={m} value={m}>
                {ROOF_MATERIALS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Lantai pemilik">
        <Select
          value={zone.floorId ?? "__site__"}
          onValueChange={(v) =>
            updateRoofZone(zone.id, { floorId: v === "__site__" ? undefined : v })
          }
        >
          <SelectTrigger aria-label="Lantai pemilik zona atap">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__site__">Semua lantai / site-level</SelectItem>
            {layout.floors.map((floor) => (
              <SelectItem key={floor.id} value={floor.id}>
                {floor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="space-y-2 border-t pt-3">
        <p className="text-[11px] font-medium text-muted-foreground">Split zona</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            disabled={zone.widthM < 1}
            onClick={() => splitRoofZone(zone.id, "x")}
          >
            Kiri / kanan
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            disabled={zone.depthM < 1}
            onClick={() => splitRoofZone(zone.id, "y")}
          >
            Depan / belakang
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Membagi zona menjadi dua area berdampingan dengan tipe/material yang
          sama.
        </p>
      </div>

      <div className="space-y-3 border-t pt-3">
        <ToggleRow
          label="Sembunyikan zona"
          checked={!!zone.hidden}
          onChange={(v) => setRoofZoneHidden(zone.id, v)}
        />
        <DeleteButton
          entityLabel="zona atap"
          onDelete={() => deleteRef({ kind: "roofZone", id: zone.id })}
        />
      </div>
    </InspectorCard>
  );
}
