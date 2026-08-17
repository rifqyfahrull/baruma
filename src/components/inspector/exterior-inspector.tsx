"use client";

/**
 * ExteriorInspector terpadu (unifikasi P2) — migrasi PENUH editor elemen
 * eksterior 2D (label/lantai/tinggi/rotasi + 5 sub-form per jenis + kontrak
 * model GLB + kebijakan RAB + kunci/sembunyikan) ke registry, dirender
 * identik di panel 2D dan 3D. Di 3D ini upgrade besar: kartu lama
 * (`ExteriorSelectionQuickEditor`) READ-ONLY — dead-end berisi badge saja,
 * plus satu tombol ganti-GLB yang terdampar di luar kartunya. Header kartu
 * (label + badge Native/Custom GLB + tombol tutup) dipertahankan persis —
 * e2e certification-scenes mengunci kontraknya.
 */

import * as React from "react";
import { Box, Library, Lock, Trash2, X } from "lucide-react";

import type {
  ComponentPatternSpec,
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorFrameElement,
  ExteriorGableFrameElement,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
} from "@/types";
import { useEditorStore } from "@/stores/editor-store";
import { usePreviewStore } from "@/stores/preview-store";
import {
  EXTERIOR_KIND_ASSET_CATEGORY,
  EXTERIOR_KIND_LABELS,
} from "@/lib/exterior/labels";
import { exteriorRateFor } from "@/lib/exterior/rates";
import { validateExteriorElement } from "@/lib/exterior/validation";
import {
  exteriorModelContract,
  exteriorModelPerformanceWarnings,
} from "@/lib/exterior/assets";
import { round2, segmentLength } from "@/lib/exterior/geometry";
import { requestAssetPicker } from "@/components/assets/asset-picker-host";
import { requestStudio } from "@/components/studio/component-studio";
import { CladdingGrid } from "./cladding-grid";
import { facadeCladdingById } from "@/lib/three/facade-claddings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, ToggleRow, useSyncedText } from "./fields";
import type { InspectorSurface } from "./registry";

/** Round a metre value to 2dp for read-only display. */
function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
}

export function ExteriorInspectorCard({ surface }: { surface: InspectorSurface }) {
  const exteriorId = useEditorStore((s) =>
    s.selected?.kind === "exterior" ? s.selected.id : null,
  );
  const layout = useEditorStore((s) => s.layout);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const isEditMode = usePreviewStore((s) => s.interactionMode === "edit");

  const element = layout?.exteriorElements?.find((e) => e.id === exteriorId);
  if (!element) return null;

  const label = element.label?.trim() || EXTERIOR_KIND_LABELS[element.kind];
  const customModel = element.model?.modelAssetId || element.model?.modelUrl;
  const categoryPreset = EXTERIOR_KIND_ASSET_CATEGORY[element.kind] ?? "";
  // Di 2D selalu bisa edit; di 3D ikuti mode Edit/View (paritas perilaku lama
  // tombol ganti-GLB — aksi per-surface, field tetap sama).
  const canSwapModel = surface === "2d" || isEditMode;

  return (
    <div
      className="space-y-3 rounded-lg border bg-background p-3"
      data-testid="exterior-quick-editor"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Elemen eksterior terpilih</p>
          <p className="text-sm font-semibold">{label}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 pointer-coarse:size-9"
          aria-label="Tutup editor elemen eksterior"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{EXTERIOR_KIND_LABELS[element.kind]}</Badge>
        <Badge variant="outline" className="font-mono text-[10px]">
          {element.id}
        </Badge>
        {customModel ? (
          <Badge variant="outline">Custom GLB</Badge>
        ) : (
          <Badge variant="outline">Native</Badge>
        )}
      </div>

      {canSwapModel && (
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          data-testid="exterior-custom-model"
          onClick={() =>
            requestAssetPicker({
              type: "exterior",
              id: element.id,
              initialCategory: categoryPreset,
            })
          }
        >
          <Box /> Ganti model 3D
        </Button>
      )}

      {/* Key HANYA pada id (bukan geometri) — setiap field anak resync lewat
          `useSyncedText` (adjust-state-during-render), bukan lewat remount.
          Sebelumnya key ikut geometri (posisi/ukuran/rotasi) supaya field
          lokal sinkron dgn drag kanvas/undo/AI; efek sampingnya subtree ini
          (dan DOM node field yg sedang difokus user, mis. "Panjang" atau
          "Rotasi") remount ulang tiap kali SATU field commit — geometrinya
          ikut berubah oleh commit itu sendiri. Fokus yg baru saja
          Tab/klik-pindah ke field berikutnya jatuh ke node yg baru saja
          dihancurkan browser lalu memindah fokus ke <body>; ketikan
          berikutnya bisa nyasar ke shortcut global/panel lain (root cause
          bug: seleksi eksterior hilang di tengah pengisian field
          berturut-turut). resync-on-render menutup kebutuhan yg sama tanpa
          menghancurkan DOM/fokus. */}
      <ExteriorInspector key={element.id} element={element} />
    </div>
  );
}

function ExteriorInspector({ element }: { element: ExteriorElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const removeExteriorElement = useEditorStore((s) => s.removeExteriorElement);
  const setLocked = useEditorStore((s) => s.setExteriorElementLocked);
  const setHidden = useEditorStore((s) => s.setExteriorElementHidden);
  const floors = useEditorStore((s) => s.layout?.floors ?? []);
  const site = useEditorStore((s) => s.site);

  const [label, setLabel] = useSyncedText(element.label ?? "");
  const [height, setHeight] = useSyncedText(
    String("heightM" in element ? element.heightM : 0),
  );
  const [rotation, setRotation] = useSyncedText(
    String("rotationDeg" in element ? (element.rotationDeg ?? 0) : 0),
  );

  const commitLabel = () => {
    if (label !== (element.label ?? ""))
      updateExteriorElement(element.id, { label });
  };

  const commitHeight = () => {
    const v = Number(height);
    if (
      Number.isFinite(v) &&
      v > 0 &&
      "heightM" in element &&
      v !== element.heightM
    ) {
      updateExteriorElement(element.id, { heightM: v });
    }
  };

  const commitRotation = () => {
    const v = Number(rotation);
    if (Number.isFinite(v) && "rotationDeg" in element) {
      updateExteriorElement(element.id, { rotationDeg: v });
    }
  };

  const isSegment =
    element.kind === "boundary_wall" ||
    element.kind === "fence" ||
    element.kind === "sliding_gate" ||
    element.kind === "swing_gate" ||
    element.kind === "pedestrian_gate";
  const isSurface =
    element.kind === "driveway" ||
    element.kind === "walkway" ||
    element.kind === "terrace_surface" ||
    element.kind === "garden_bed";
  const isStair = element.kind === "exterior_stair";
  const isBox =
    "widthM" in element &&
    "depthM" in element &&
    !isStair &&
    element.kind !== "gable_frame";
  const validationIssues = React.useMemo(() => {
    if (!site) return [];
    return validateExteriorElement(element, {
      site: { ...site, areaM2: site.widthM * site.depthM },
      validFloorIds: new Set(floors.map((floor) => floor.id)),
    });
  }, [element, floors, site]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Jenis</span>
        <Badge variant="secondary">{EXTERIOR_KIND_LABELS[element.kind]}</Badge>
      </div>

      {validationIssues.length > 0 && (
        <div
          className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
          data-testid="exterior-validation-feedback"
        >
          <p className="font-semibold">Validasi elemen eksterior</p>
          {validationIssues.map((issue) => (
            <p key={`${issue.objectId ?? issue.id}-${issue.message}`}>
              {issue.level === "danger" ? "Danger" : "Warning"}: {issue.message}
            </p>
          ))}
        </div>
      )}

      <Field label="Label">
        <Input
          value={label}
          aria-label="Label elemen"
          disabled={element.locked}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
        />
      </Field>

      <Field label="Lantai dasar">
        <Select
          value={element.floorId ?? "__site__"}
          disabled={element.locked}
          onValueChange={(v) =>
            updateExteriorElement(element.id, {
              floorId: v === "__site__" ? undefined : v,
            })
          }
        >
          <SelectTrigger aria-label="Lantai dasar elemen">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__site__">Tapak</SelectItem>
            {floors.map((floor) => (
              <SelectItem key={floor.id} value={floor.id}>
                {floor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {"heightM" in element && (
        <Field label="Tinggi (m)">
          <Input
            type="number"
            step={0.1}
            min={0.1}
            value={height}
            disabled={element.locked}
            onChange={(e) => setHeight(e.target.value)}
            onBlur={commitHeight}
          />
        </Field>
      )}

      {/* Segmen (pagar/tembok/gerbang) punya editor Rotasi sendiri yang lebih
          lengkap di SegmentFields (id "segment-rotation") — jangan render
          dua field "Rotasi (°)" hidup berdampingan utk entity yang sama
          (factory selalu menulis key `rotationDeg` meski nilainya undefined,
          jadi `"rotationDeg" in element` true utk semua segmen). */}
      {"rotationDeg" in element && !isSegment && (
        <Field label="Rotasi (°)">
          <Input
            type="number"
            step={1}
            value={rotation}
            disabled={element.locked}
            onChange={(e) => setRotation(e.target.value)}
            onBlur={commitRotation}
          />
        </Field>
      )}

      {"x" in element && "y" in element && (
        <PositionFields
          element={element as ExteriorElement & { x: number; y: number }}
        />
      )}

      {isSegment && (
        <SegmentFields element={element as ExteriorSegmentElement} />
      )}
      {isBox && <BoxFields element={element as ExteriorBoxElement} />}
      {element.kind === "pergola" && (
        <PergolaFields element={element as ExteriorBoxElement} />
      )}
      {isSurface && (
        <SurfaceFields element={element as ExteriorSurfaceElement} />
      )}
      {isStair && <StairFields element={element as ExteriorStairElement} />}
      {element.kind === "portal_frame" && (
        <PortalFields element={element as ExteriorFrameElement} />
      )}
      {element.kind === "gable_frame" && (
        <GableFrameFields element={element as ExteriorGableFrameElement} />
      )}

      <Separator />

      {/* Material dari katalog cladding — resolusi render sudah jalan
          (resolveExteriorMaterial); selama ini hanya bisa via template/AI. */}
      <div className="space-y-2" data-testid="exterior-material-section">
        <p className="text-[11px] font-medium text-muted-foreground">
          Material (katalog fasad)
        </p>
        <CladdingGrid
          keyPrefix="ext-"
          current={facadeCladdingById(element.material?.materialId)?.id ?? null}
          onPick={(id) =>
            !element.locked &&
            updateExteriorElement(element.id, {
              material: { ...(element.material ?? {}), materialId: id },
            })
          }
        />
        {element.material?.materialId && (
          <Button
            size="sm"
            variant="outline"
            className="w-full pointer-coarse:h-10"
            disabled={element.locked}
            onClick={() => {
              const next = { ...(element.material ?? {}) };
              delete next.materialId;
              updateExteriorElement(element.id, {
                material: Object.keys(next).length ? next : undefined,
              });
            }}
          >
            Reset material (bawaan jenis)
          </Button>
        )}
      </div>

      <Separator />

      <ExteriorModelContractFields element={element} />

      <ExteriorCostingFields element={element} />

      <Separator />

      <ToggleRow
        label="Kunci posisi"
        icon={Lock}
        checked={!!element.locked}
        onChange={(v) => setLocked(element.id, v)}
      />
      <ToggleRow
        label="Sembunyikan"
        checked={!!element.hidden}
        onChange={(v) => setHidden(element.id, v)}
      />

      <Separator />

      <Button
        variant="destructive"
        className="w-full"
        disabled={element.locked}
        onClick={() => removeExteriorElement(element.id)}
      >
        <Trash2 />
        Hapus elemen
      </Button>
    </div>
  );
}

/**
 * Posisi X/Y (m) — anchor elemen box/frame/tangga/aset ("x"/"y" langsung di
 * elemen). Sebelumnya elemen yang tersangkut di luar tapak (mis. tangga
 * eksterior) tak punya cara diperbaiki selain hapus+taruh ulang — drag di
 * kanvas kini jalan lagi (lihat plan-canvas.tsx onExteriorDown), tapi field
 * numerik ini tetap perlu untuk presisi & aksesibilitas (mis. keyboard-only).
 */
function PositionFields({
  element,
}: {
  element: ExteriorElement & { x: number; y: number };
}) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [x, setX] = useSyncedText(String(element.x));
  const [y, setY] = useSyncedText(String(element.y));

  const commit = (key: "x" | "y", raw: string, current: number) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v === current) {
      (key === "x" ? setX : setY)(String(current));
      return;
    }
    updateExteriorElement(element.id, { [key]: v });
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Posisi X (m)" htmlFor="exterior-pos-x">
        <Input
          id="exterior-pos-x"
          type="number"
          step={0.1}
          value={x}
          disabled={element.locked}
          onChange={(e) => setX(e.target.value)}
          onBlur={() => commit("x", x, element.x)}
        />
      </Field>
      <Field label="Posisi Y (m)" htmlFor="exterior-pos-y">
        <Input
          id="exterior-pos-y"
          type="number"
          step={0.1}
          value={y}
          disabled={element.locked}
          onChange={(e) => setY(e.target.value)}
          onBlur={() => commit("y", y, element.y)}
        />
      </Field>
    </div>
  );
}

function ExteriorModelContractFields({ element }: { element: ExteriorElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  if (!element.model?.modelUrl && !element.model?.modelAssetId) return null;

  const contract = exteriorModelContract(element.model);
  const warnings = exteriorModelPerformanceWarnings(element.model);
  const patchModel = (patch: NonNullable<ExteriorElement["model"]>) => {
    updateExteriorElement(element.id, {
      model: {
        ...(element.model ?? {}),
        ...patch,
      },
    });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Kontrak Model 3D
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Atur cara GLB custom difit dan arah authored model supaya replace
          facade/asset tidak bergantung tebakan renderer.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Fit model">
          <Select
            value={contract.fitMode}
            disabled={element.locked}
            onValueChange={(value) =>
              patchModel({
                fitMode: value as NonNullable<ExteriorElement["model"]>["fitMode"],
              })
            }
          >
            <SelectTrigger
              aria-label="Fit model eksterior"
              data-testid="exterior-model-fit"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fit_envelope">Fit envelope</SelectItem>
              <SelectItem value="use_real_size">Real size</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Up axis">
          <Select
            value={contract.upAxis}
            disabled={element.locked}
            onValueChange={(value) =>
              patchModel({
                upAxis: value as NonNullable<ExteriorElement["model"]>["upAxis"],
              })
            }
          >
            <SelectTrigger
              aria-label="Up axis model eksterior"
              data-testid="exterior-model-up-axis"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="y">Y-up</SelectItem>
              <SelectItem value="z">Z-up</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Front axis">
          <Select
            value={contract.frontAxis}
            disabled={element.locked}
            onValueChange={(value) =>
              patchModel({
                frontAxis: value as NonNullable<ExteriorElement["model"]>["frontAxis"],
              })
            }
          >
            <SelectTrigger
              aria-label="Front axis model eksterior"
              data-testid="exterior-model-front-axis"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="z+">+Z front</SelectItem>
              <SelectItem value="z-">-Z front</SelectItem>
              <SelectItem value="x+">+X front</SelectItem>
              <SelectItem value="x-">-X front</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {warnings.length ? (
        <div
          className="space-y-1 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300"
          data-testid="exterior-model-performance-warning"
        >
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Belum ada warning performa dari metadata GLB.
        </p>
      )}
    </div>
  );
}

function ExteriorCostingFields({ element }: { element: ExteriorElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const rate = exteriorRateFor(element.kind, element.costing?.rateId);
  const isCustomAsset = element.kind === "asset";
  const mode =
    isCustomAsset || element.costing?.includeInRab === false
      ? "excluded"
      : "catalog";
  const unitLabel =
    rate?.unit === "m2"
      ? "m²"
      : rate?.unit === "m3"
        ? "m³"
        : (rate?.unit ?? "manual");

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kebijakan RAB
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Menentukan apakah elemen ini masuk estimasi biaya.
          </p>
        </div>
        <Select
          value={mode}
          disabled={element.locked || isCustomAsset}
          onValueChange={(value) => {
            updateExteriorElement(element.id, {
              costing: {
                ...(element.costing ?? {}),
                includeInRab: value === "catalog",
              },
            });
          }}
        >
          <SelectTrigger
            aria-label="Kebijakan RAB elemen eksterior"
            data-testid="exterior-costing-policy"
            className="w-[150px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="catalog">Catalog rate</SelectItem>
            <SelectItem value="excluded">Dikecualikan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustomAsset ? (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          Custom GLB belum diberi harga otomatis. Model tetap dikecualikan dari
          RAB sampai ada costing manual/catalog yang eksplisit.
        </p>
      ) : rate && mode === "catalog" ? (
        <p className="text-xs text-muted-foreground">
          Rate aktif: {rate.id} · Rp {fmtNum(rate.unitPriceIDR)}/{unitLabel} ·
          confidence {rate.confidence}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Elemen ini akan tampil di desain, tetapi tidak masuk perhitungan RAB.
        </p>
      )}
    </div>
  );
}

/** Sudut segmen (°, 0–360, 0 = +x horizontal) — derajat dari `start`→`end`
 *  konvensi sama dgn `Math.atan2` yang dipakai exterior-primitives.ts. */
function segmentAngleDeg(
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

const SEGMENT_PATTERN_KINDS = new Set<ExteriorSegmentElement["kind"]>([
  "fence",
  "sliding_gate",
  "swing_gate",
  "pedestrian_gate",
]);

function SegmentFields({ element }: { element: ExteriorSegmentElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [thickness, setThickness] = useSyncedText(
    String(element.thicknessM ?? 1),
  );
  const currentLength = segmentLength(element.start, element.end);
  const [length, setLength] = useSyncedText(currentLength.toFixed(2));
  // resync-on-render (`useSyncedText`) — sinkron baik dari commit field ini
  // sendiri (no-op, nilai sudah sama) maupun dari luar (drag kanvas/undo/AI),
  // tanpa remount subtree (lihat catatan di `ExteriorInspectorCard`).
  const [rotation, setRotation] = useSyncedText(
    String(Math.round(segmentAngleDeg(element.start, element.end) * 10) / 10),
  );
  // Posisi = titik `start` (anchor). Panjang & rotasi di atas sudah menutup
  // ukuran/arah relatif start — jadi ini cukup buat menggeser seluruh
  // segmen (start DAN end sekaligus, delta yang sama) tanpa mengubah
  // panjang/rotasi. Sama seperti drag body di kanvas (lihat plan-canvas.tsx
  // exteriorMove).
  const [posX, setPosX] = useSyncedText(String(element.start.x));
  const [posY, setPosY] = useSyncedText(String(element.start.y));

  const commitPosition = (axis: "x" | "y", raw: string) => {
    const v = Number(raw);
    const current = element.start[axis];
    if (!Number.isFinite(v) || v === current) {
      (axis === "x" ? setPosX : setPosY)(String(current));
      return;
    }
    const delta = v - current;
    updateExteriorElement(element.id, {
      start: {
        x: round2(axis === "x" ? v : element.start.x),
        y: round2(axis === "y" ? v : element.start.y),
      },
      end: {
        x: round2(axis === "x" ? element.end.x + delta : element.end.x),
        y: round2(axis === "y" ? element.end.y + delta : element.end.y),
      },
    });
  };

  const commitThickness = () => {
    const v = Number(thickness);
    if (Number.isFinite(v) && v > 0 && v !== (element.thicknessM ?? 1)) {
      updateExteriorElement(element.id, { thicknessM: v });
    }
  };

  const commitLength = () => {
    const v = Number(length);
    if (!Number.isFinite(v) || v <= 0 || Math.abs(v - currentLength) < 0.001) {
      setLength(currentLength.toFixed(2));
      return;
    }
    const dx = element.end.x - element.start.x;
    const dy = element.end.y - element.start.y;
    const len = Math.hypot(dx, dy);
    // A pre-existing zero-length (legacy-buggy) segment has no direction to
    // extend along — fall back to the same +x placement convention the
    // tap-placement code uses, so this field can repair it instead of
    // silently no-op'ing.
    const ux = len > 0 ? dx / len : 1;
    const uy = len > 0 ? dy / len : 0;
    updateExteriorElement(element.id, {
      end: {
        x: round2(element.start.x + ux * v),
        y: round2(element.start.y + uy * v),
      },
    });
  };

  const commitRotation = () => {
    const v = Number(rotation);
    const current = segmentAngleDeg(element.start, element.end);
    if (!Number.isFinite(v) || Math.abs(((v % 360) + 360) % 360 - current) < 0.01) {
      setRotation(String(Math.round(current * 10) / 10));
      return;
    }
    // Store menghitung ulang `end` di sekeliling `start` (panjang tetap) —
    // lihat updateExteriorElement di stores/editor-store.ts.
    updateExteriorElement(element.id, { rotationDeg: v });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Posisi X (m)" htmlFor="segment-pos-x">
          <Input
            id="segment-pos-x"
            type="number"
            step={0.1}
            value={posX}
            disabled={element.locked}
            onChange={(e) => setPosX(e.target.value)}
            onBlur={() => commitPosition("x", posX)}
          />
        </Field>
        <Field label="Posisi Y (m)" htmlFor="segment-pos-y">
          <Input
            id="segment-pos-y"
            type="number"
            step={0.1}
            value={posY}
            disabled={element.locked}
            onChange={(e) => setPosY(e.target.value)}
            onBlur={() => commitPosition("y", posY)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Panjang (m)" htmlFor="segment-length">
          <Input
            id="segment-length"
            type="number"
            step={0.1}
            min={0.1}
            value={length}
            disabled={element.locked}
            onChange={(e) => setLength(e.target.value)}
            onBlur={commitLength}
          />
        </Field>
        <Field label="Tebal (m)">
          <Input
            type="number"
            step={0.05}
            min={0.05}
            value={thickness}
            disabled={element.locked}
            onChange={(e) => setThickness(e.target.value)}
            onBlur={commitThickness}
          />
        </Field>
        <Field label="Rotasi (°)" htmlFor="segment-rotation">
          <Input
            id="segment-rotation"
            type="number"
            step={1}
            min={0}
            max={360}
            value={rotation}
            disabled={element.locked}
            onChange={(e) => setRotation(e.target.value)}
            onBlur={commitRotation}
          />
        </Field>
      </div>
      {SEGMENT_PATTERN_KINDS.has(element.kind) && (
        <SegmentPatternFields element={element} />
      )}
    </div>
  );
}

/** Pola jeruji/bilah KUSTOM (fence/gate saja — boundary_wall selalu solid):
 *  pitch/lebar/rhythm, dipakai `patternBarOffsets` menggantikan spasi bilah
 *  adaptif bawaan. Absen `pattern` = jalur lama (byte-identik). */
function SegmentPatternFields({ element }: { element: ExteriorSegmentElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const pattern = element.pattern;
  const [pitch, setPitch] = useSyncedText(String(pattern?.pitchM ?? 0.28));
  const [barWidth, setBarWidth] = useSyncedText(String(pattern?.barWidthM ?? 0.06));
  const [rhythmText, setRhythmText] = useSyncedText(pattern?.rhythm?.join(",") ?? "");

  const patch = (p: Partial<ComponentPatternSpec>) => {
    updateExteriorElement(element.id, { pattern: { ...(pattern ?? {}), ...p } });
  };

  const commitRhythm = () => {
    const nums = rhythmText
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 8);
    patch({ rhythm: nums.length ? nums : undefined });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3" data-testid="segment-pattern-fields">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pola jeruji
      </Label>
      <Button
        size="sm"
        variant="outline"
        className="w-full pointer-coarse:h-10"
        disabled={element.locked}
        onClick={() => requestStudio({ kind: "exterior-element", id: element.id })}
      >
        <Library /> Buka Studio Komponen
      </Button>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pitch (m)">
          <Input
            type="number"
            step={0.01}
            min={0.05}
            max={1.5}
            value={pitch}
            disabled={element.locked}
            onChange={(e) => setPitch(e.target.value)}
            onBlur={() => {
              const v = Number(pitch);
              if (Number.isFinite(v)) patch({ pitchM: v });
            }}
          />
        </Field>
        <Field label="Lebar bilah (m)">
          <Input
            type="number"
            step={0.01}
            min={0.02}
            max={0.5}
            value={barWidth}
            disabled={element.locked}
            onChange={(e) => setBarWidth(e.target.value)}
            onBlur={() => {
              const v = Number(barWidth);
              if (Number.isFinite(v)) patch({ barWidthM: v });
            }}
          />
        </Field>
      </div>
      <Field label="Rhythm (mis. 3,1 = 3 rapat lalu 1 gap)">
        <Input
          value={rhythmText}
          placeholder="3,1"
          aria-label="Rhythm pola jeruji"
          disabled={element.locked}
          onChange={(e) => setRhythmText(e.target.value)}
          onBlur={commitRhythm}
        />
      </Field>
      {pattern && (
        <Button
          size="sm"
          variant="outline"
          className="w-full pointer-coarse:h-10"
          disabled={element.locked}
          onClick={() => updateExteriorElement(element.id, { pattern: undefined })}
        >
          Reset pola (spasi bilah bawaan)
        </Button>
      )}
    </div>
  );
}

function BoxFields({ element }: { element: ExteriorBoxElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [width, setWidth] = useSyncedText(String(element.widthM));
  const [depth, setDepth] = useSyncedText(String(element.depthM));
  const [z, setZ] = useSyncedText(String(element.zM ?? 0));

  const commit = (key: "widthM" | "depthM" | "zM", raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0 && v !== element[key]) {
      updateExteriorElement(element.id, { [key]: v });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lebar (m)">
          <Input
            type="number"
            step={0.1}
            min={0.1}
            value={width}
            disabled={element.locked}
            onChange={(e) => setWidth(e.target.value)}
            onBlur={() => commit("widthM", width)}
          />
        </Field>
        <Field label="Dalam (m)">
          <Input
            type="number"
            step={0.1}
            min={0.1}
            value={depth}
            disabled={element.locked}
            onChange={(e) => setDepth(e.target.value)}
            onBlur={() => commit("depthM", depth)}
          />
        </Field>
      </div>
      <Field label="Elevasi Z (m)">
        <Input
          type="number"
          step={0.1}
          value={z}
          disabled={element.locked}
          onChange={(e) => setZ(e.target.value)}
          onBlur={() => commit("zM", z)}
        />
      </Field>
    </div>
  );
}

const PERGOLA_ORIENTATION_LABELS: Record<NonNullable<ComponentPatternSpec["orientation"]>, string> = {
  v: "Balok arah Z saja",
  h: "Balok arah X saja",
  grid: "Grid (2 arah)",
  cross: "Silang (2 arah)",
};

/** PERGOLA (kind "pergola"): pola kisi silang + kolom penyangga — widthM/
 *  depthM/heightM (heightM = elevasi bidang kisi) sudah ditangani `BoxFields`
 *  generik di atas; di sini hanya field spesifik pergola. */
function PergolaFields({ element }: { element: ExteriorBoxElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const pattern = element.pattern;
  const [pitch, setPitch] = useSyncedText(String(pattern?.pitchM ?? 0.4));
  const [barWidth, setBarWidth] = useSyncedText(String(pattern?.barWidthM ?? 0.08));
  const [barDepth, setBarDepth] = useSyncedText(String(pattern?.barDepthM ?? 0.08));
  const [rhythmText, setRhythmText] = useSyncedText(pattern?.rhythm?.join(",") ?? "");

  const patch = (p: Partial<ComponentPatternSpec>) => {
    updateExteriorElement(element.id, { pattern: { ...(pattern ?? {}), ...p } });
  };

  const commitRhythm = () => {
    const nums = rhythmText
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 8);
    patch({ rhythm: nums.length ? nums : undefined });
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3" data-testid="pergola-pattern-fields">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pola kisi pergola
      </Label>
      <Button
        size="sm"
        variant="outline"
        className="w-full pointer-coarse:h-10"
        disabled={element.locked}
        onClick={() => requestStudio({ kind: "exterior-element", id: element.id })}
      >
        <Library /> Buka Studio Komponen
      </Button>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pitch (m)">
          <Input
            type="number"
            step={0.01}
            min={0.05}
            max={1.5}
            value={pitch}
            disabled={element.locked}
            onChange={(e) => setPitch(e.target.value)}
            onBlur={() => {
              const v = Number(pitch);
              if (Number.isFinite(v)) patch({ pitchM: v });
            }}
          />
        </Field>
        <Field label="Lebar bilah (m)">
          <Input
            type="number"
            step={0.01}
            min={0.02}
            max={0.5}
            value={barWidth}
            disabled={element.locked}
            onChange={(e) => setBarWidth(e.target.value)}
            onBlur={() => {
              const v = Number(barWidth);
              if (Number.isFinite(v)) patch({ barWidthM: v });
            }}
          />
        </Field>
        <Field label="Tebal balok (m)">
          <Input
            type="number"
            step={0.01}
            min={0.01}
            max={0.6}
            value={barDepth}
            disabled={element.locked}
            onChange={(e) => setBarDepth(e.target.value)}
            onBlur={() => {
              const v = Number(barDepth);
              if (Number.isFinite(v)) patch({ barDepthM: v });
            }}
          />
        </Field>
        <Field label="Orientasi">
          <Select
            value={pattern?.orientation ?? "cross"}
            disabled={element.locked}
            onValueChange={(v) => patch({ orientation: v as ComponentPatternSpec["orientation"] })}
          >
            <SelectTrigger size="sm" className="h-9 w-full text-xs" aria-label="Orientasi kisi pergola">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERGOLA_ORIENTATION_LABELS) as NonNullable<ComponentPatternSpec["orientation"]>[]).map(
                (o) => (
                  <SelectItem key={o} value={o}>
                    {PERGOLA_ORIENTATION_LABELS[o]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Rhythm (mis. 3,1 = 3 rapat lalu 1 gap)">
        <Input
          value={rhythmText}
          placeholder="3,1"
          aria-label="Rhythm pola pergola"
          disabled={element.locked}
          onChange={(e) => setRhythmText(e.target.value)}
          onBlur={commitRhythm}
        />
      </Field>
      <ToggleRow
        label="Bingkai keliling balok atas"
        checked={!!pattern?.frame}
        onChange={(v) => patch({ frame: v || undefined })}
      />
      <ToggleRow
        label="4 kolom penyangga"
        checked={element.posts !== false}
        onChange={(v) => updateExteriorElement(element.id, { posts: v })}
      />
    </div>
  );
}

function SurfaceFields({ element }: { element: ExteriorSurfaceElement }) {
  const area = React.useMemo(
    () =>
      Math.abs(
        Math.round(
          element.points.reduce((sum, p, i, arr) => {
            const next = arr[(i + 1) % arr.length];
            return sum + (p.x * next.y - next.x * p.y);
          }, 0) * 50,
        ) / 100,
      ),
    [element.points],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-sm text-muted-foreground">Luas bidang</span>
        <span className="text-sm font-semibold">{fmtNum(area)} m²</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Edit bentuk polygon dari kanvas dengan menarik titik sudut.
      </p>
    </div>
  );
}

function StairFields({ element }: { element: ExteriorStairElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [length, setLength] = useSyncedText(String(element.lengthM));
  const [rise, setRise] = useSyncedText(String(element.riseM));
  const [width, setWidth] = useSyncedText(String(element.widthM));

  const commit = (key: "lengthM" | "riseM" | "widthM", raw: string, min: number) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= min && v !== element[key]) {
      updateExteriorElement(element.id, { [key]: v });
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Lebar (m)">
        <Input
          type="number"
          step={0.1}
          min={0.5}
          value={width}
          disabled={element.locked}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={() => commit("widthM", width, 0.5)}
        />
      </Field>
      <Field label="Panjang (m)">
        <Input
          type="number"
          step={0.1}
          min={0.5}
          value={length}
          disabled={element.locked}
          onChange={(e) => setLength(e.target.value)}
          onBlur={() => commit("lengthM", length, 0.5)}
        />
      </Field>
      <Field label="Riser (m)">
        <Input
          type="number"
          step={0.05}
          min={0.1}
          value={rise}
          disabled={element.locked}
          onChange={(e) => setRise(e.target.value)}
          onBlur={() => commit("riseM", rise, 0.1)}
        />
      </Field>
      <Field label="Arah">
        <Select
          value={element.direction}
          disabled={element.locked}
          onValueChange={(v) =>
            updateExteriorElement(element.id, {
              direction: v as "n" | "s" | "w" | "e",
            })
          }
        >
          <SelectTrigger aria-label="Arah tangga">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="n">Utara</SelectItem>
            <SelectItem value="e">Timur</SelectItem>
            <SelectItem value="s">Selatan</SelectItem>
            <SelectItem value="w">Barat</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** BINGKAI GABLE (W4): outline pelana asimetris — eave kiri/kanan boleh beda
 *  tinggi, apex geser (±), dasar bisa dinaikkan (Elevasi Z, mis. ke lantai
 *  balkon). Paritas penuh dgn aksi agent addExteriorElement gable_frame. */
function GableFrameFields({ element }: { element: ExteriorGableFrameElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  // Satu `useSyncedText` per field (bukan satu useState objek) — resync
  // masing-masing field independen saat nilainya berubah dari luar, tanpa
  // remount subtree (lihat catatan di `ExteriorInspectorCard`).
  const [widthM, setWidthM] = useSyncedText(String(element.widthM));
  const [heightM, setHeightM] = useSyncedText(String(element.heightM));
  const [eaveLeftM, setEaveLeftM] = useSyncedText(String(element.eaveLeftM));
  const [eaveRightM, setEaveRightM] = useSyncedText(String(element.eaveRightM));
  const [apexOffsetM, setApexOffsetM] = useSyncedText(String(element.apexOffsetM ?? 0));
  const [memberSizeM, setMemberSizeM] = useSyncedText(String(element.memberSizeM));
  const [depthM, setDepthM] = useSyncedText(String(element.depthM ?? 0.5));
  const [zM, setZM] = useSyncedText(String(element.zM ?? 0));

  const vals = { widthM, heightM, eaveLeftM, eaveRightM, apexOffsetM, memberSizeM, depthM, zM };
  type K = keyof typeof vals;
  const setters: Record<K, React.Dispatch<React.SetStateAction<string>>> = {
    widthM: setWidthM,
    heightM: setHeightM,
    eaveLeftM: setEaveLeftM,
    eaveRightM: setEaveRightM,
    apexOffsetM: setApexOffsetM,
    memberSizeM: setMemberSizeM,
    depthM: setDepthM,
    zM: setZM,
  };
  const commit = (key: K) => {
    const v = Number(vals[key]);
    // apexOffsetM & zM boleh 0/negatif (offset); dimensi lain wajib positif.
    const ok =
      key === "apexOffsetM"
        ? Number.isFinite(v)
        : key === "zM"
          ? Number.isFinite(v) && v >= 0
          : Number.isFinite(v) && v > 0;
    if (ok && v !== (element as unknown as Record<string, number>)[key]) {
      updateExteriorElement(element.id, { [key]: v });
    }
  };
  const field = (key: K, label: string, step = 0.1) => (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        value={vals[key]}
        disabled={element.locked}
        onChange={(e) => setters[key](e.target.value)}
        onBlur={() => commit(key)}
      />
    </Field>
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      {field("widthM", "Lebar (m)")}
      {field("heightM", "Tinggi apex (m)")}
      {field("eaveLeftM", "Eave kiri (m)")}
      {field("eaveRightM", "Eave kanan (m)")}
      {field("apexOffsetM", "Geser apex (m)")}
      {field("memberSizeM", "Tebal member (m)", 0.05)}
      {field("depthM", "Tebal bingkai (m)", 0.05)}
      {field("zM", "Elevasi dasar (m)")}
    </div>
  );
}

function PortalFields({ element }: { element: ExteriorFrameElement }) {
  const updateExteriorElement = useEditorStore((s) => s.updateExteriorElement);
  const [width, setWidth] = useSyncedText(String(element.widthM));
  const [height, setHeight] = useSyncedText(String(element.heightM));
  const [member, setMember] = useSyncedText(String(element.memberSizeM));

  const commit = (key: "widthM" | "heightM" | "memberSizeM", raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0 && v !== element[key]) {
      updateExteriorElement(element.id, { [key]: v });
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Lebar luar (m)">
        <Input
          type="number"
          step={0.1}
          min={0.1}
          value={width}
          disabled={element.locked}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={() => commit("widthM", width)}
        />
      </Field>
      <Field label="Tinggi luar (m)">
        <Input
          type="number"
          step={0.1}
          min={0.1}
          value={height}
          disabled={element.locked}
          onChange={(e) => setHeight(e.target.value)}
          onBlur={() => commit("heightM", height)}
        />
      </Field>
      <Field label="Ukuran member (m)">
        <Input
          type="number"
          step={0.05}
          min={0.05}
          value={member}
          disabled={element.locked}
          onChange={(e) => setMember(e.target.value)}
          onBlur={() => commit("memberSizeM", member)}
        />
      </Field>
    </div>
  );
}

