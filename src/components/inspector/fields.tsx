"use client";

/**
 * Kit primitif inspector — SATU kosakata widget untuk semua panel editing
 * (2D editor, 3D preview, interior). Sebelum kit ini, primitif yang sama
 * didefinisikan lokal berulang dengan gaya berbeda-beda: `Field` 3×,
 * ToggleRow/ToggleLine 2×, Stat/Metric 2×, 9 button-grid tulis-tangan,
 * dua skala tipografi label (11px medium vs 12px regular) untuk elemen
 * semantik yang sama. Lihat docs/UNIFIKASI_UI_EDITOR.md §3.5.
 *
 * Kontrak yang dikodekan di sini (supaya tak bisa menyimpang lagi):
 * - Label field: SATU skala — 11px medium muted (varian terpadat, muat di
 *   panel 2D w-80 maupun 3D w-[24rem]).
 * - Commit angka: blur + Enter (bukan onChange) — satu entri undo per edit.
 * - Picker enum: SATU idiom — grid tombol `aria-pressed` (SegmentedControl),
 *   menggantikan 4 idiom berbeda (Select/raw grid/Button row/role=radio).
 */

import * as React from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

/**
 * Resync helper utk field teks lokal (uncontrolled-ish) yang perlu tetap
 * ter-update saat sumber datanya berubah DARI LUAR (undo/AI/drag kanvas/
 * commit field lain) — TANPA remount. Beberapa panel eksterior dulu memaksa
 * resync dengan meng-key ulang seluruh subtree tiap kali geometrinya
 * berubah; masalahnya geometri itu ikut berubah tiap kali field DI DALAM
 * subtree yang sama commit (mis. Tinggi memicu remount yang menghancurkan
 * field Panjang/Rotasi yang baru saja/tengah difokus user — root cause bug
 * "seleksi hilang di tengah pengisian field berturut-turut", lihat
 * exterior-inspector.tsx). Pola commit-blur/Enter yang sama dgn NumField —
 * "adjust state during render" (bukan setState-in-effect).
 */
export function useSyncedText(
  value: string,
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [text, setText] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }
  return [text, setText];
}

/** Baris label + kontrol. Satu-satunya tempat skala label didefinisikan. */
export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Input angka dengan kontrak commit terpadu: blur + Enter (BUKAN per-keystroke
 * — satu entri undo per edit, tak mengetik-ulang state saat mengetik).
 * State teks lokal di-resync saat `value` berubah dari luar (undo/AI/3D).
 */
export function NumField({
  label,
  value,
  onCommit,
  step = 0.05,
  min,
  max,
  id,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  id?: string;
}) {
  const [text, setText] = React.useState(String(value));
  // Resync saat `value` berubah dari luar — pola "adjust state during render"
  // (bukan setState-in-effect yang memicu render kaskade).
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  const commit = () => {
    const v = parseFloat(text);
    if (!Number.isFinite(v)) {
      setText(String(value));
      return;
    }
    onCommit(v);
  };
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="h-8 text-xs pointer-coarse:h-10"
        aria-label={label}
      />
    </Field>
  );
}

/** Baris label + Switch. Icon eksplisit via prop (bukan string-match label). */
export function ToggleRow({
  label,
  checked,
  onChange,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/** ToggleRow "Kunci posisi" dgn ikon gembok — pengganti string-match lama. */
export function LockToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return <ToggleRow label="Kunci posisi" checked={checked} onChange={onChange} icon={Lock} />;
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Deskripsi kecil di bawah label (opsional — utk tile bergaya kartu). */
  description?: string;
};

/**
 * Picker enum terpadu: grid tombol `aria-pressed`. SATU idiom menggantikan
 * empat (Select dropdown / raw <button> grid / Button-variant row /
 * role=radio) — nilai selalu terlihat semua & satu klik, konsisten diuji
 * lewat aria-pressed seperti picker lama.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  columns = options.length <= 4 ? options.length : 4,
  ariaLabel,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  columns?: number;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md border px-1.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted pointer-coarse:py-2.5",
              active && "border-primary bg-primary/10",
            )}
          >
            <span className="block">{opt.label}</span>
            {opt.description && (
              <span className="mt-0.5 block text-[10px] font-normal leading-tight text-muted-foreground">
                {opt.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const DIRECTION_OPTIONS = [
  { value: "n", label: "Utara ↑" },
  { value: "s", label: "Selatan ↓" },
  { value: "w", label: "Barat ←" },
  { value: "e", label: "Timur →" },
] as const;

/**
 * SATU widget arah n/s/w/e — menggantikan tiga widget berbeda untuk nilai
 * yang sama (grid 4-tombol tangga, Select lowSide atap ×2, Select tangga
 * eksterior).
 */
export function DirectionPicker({
  value,
  onChange,
  ariaLabel = "Arah",
}: {
  value: "n" | "s" | "w" | "e" | null;
  onChange: (v: "n" | "s" | "w" | "e") => void;
  ariaLabel?: string;
}) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      options={DIRECTION_OPTIONS}
      columns={2}
      ariaLabel={ariaLabel}
    />
  );
}

/** Ubin statistik read-only (dulu: Stat di editor-inspector, Metric di interior). */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

/**
 * Tombol hapus terstandar: `Hapus <label entity>` — menggantikan 7 varian
 * label/jalur berbeda. `onDelete` wajib memanggil remover TYPED per entity
 * (bukan deleteSelected generik yang else-branch-nya salah utk titik).
 */
export function DeleteButton({
  entityLabel,
  onDelete,
  className,
}: {
  entityLabel: string;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="destructive"
      size="sm"
      className={cn("w-full pointer-coarse:h-10", className)}
      onClick={onDelete}
    >
      Hapus {entityLabel}
    </Button>
  );
}
