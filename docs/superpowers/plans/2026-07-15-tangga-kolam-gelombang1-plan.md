# Tangga & Kolam â€” Gelombang 1 (Dokumen & Angka) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat tangga & kolam kredibel di dokumen kontraktor: potongan tangga + penomoran anak di denah, validasi kenyamanan SNI, line item RAB tangga interior, sheet "Denah Pipa Kolam" + "Detail Kolam" dari perhitungan MEP yang sudah ada.

**Architecture:** Satu modul pure baru `src/lib/stairs/geometry.ts` menjadi sumber tunggal derivasi tangga interior (dipakai 3D, denah, potongan, RAB, validasi). Dua builder drawing pure baru (`pool-piping.ts`, `pool-detail.ts`) menerbitkan hitungan `poolCirculation`/`poolElectrical` yang SUDAH ada ke sheet gambar kerja. Tidak ada perubahan schema DB; field Room baru bersifat opsional dan lolos `.passthrough()` zod yang ada.

**Tech Stack:** TypeScript, zod (schema layout), Vitest, kontrak `Drawing` (lines/labels/dims/levels â€” TANPA polygon/symbol; lihat deviasi Â§25 roadmap eksterior).

**Sumber:** `docs/superpowers/plans/2026-07-15-tangga-kolam-investigasi-lapangan.md` (WP: TG-1, TG-3, TG-4-interior, KL-1, KL-3).

## Global Constraints

- Semua command lewat Git Bash dengan prefix `rtk` (CLAUDE.md): `rtk vitest run <file>`, `rtk tsc --noEmit`, `rtk lint`.
- TDD ketat: tulis test â†’ lihat gagal â†’ implement â†’ lihat lulus â†’ commit. Jangan menulis implementasi sebelum testnya gagal.
- **Behavior-identical dulu**: Task 1 adalah ekstraksi mekanis â€” seluruh test existing (`build-model.test.ts`, `layout-sheet.test.ts`) harus lulus TANPA mengubah nilai ekspektasi apa pun.
- Tangga interior = `Room type:"tangga"`; kolam = `Room type:"kolam"`. **JANGAN memakai tipe `Stair` (`layout.stairs`) atau `Pool` (`layout.pools`)** â€” keduanya dorman, selalu `[]`.
- Konstanta riser interior default TETAP `0.18` (mengubahnya mengubah jumlah anak â†’ memecahkan snapshot 3D/denah). Konstanta eksterior (0.175, rentang 0.12â€“0.20 di `src/lib/exterior/*`) TIDAK disentuh gelombang ini.
- **Scope eksplisit yang DITUNDA ke Gelombang 2** (jangan dikerjakan sekarang): bordes/bentuk L/U, entry steps kolam, kedalaman gradasi, perubahan basis RAB tangga EKSTERIOR, overflow/balancing tank.
- Jangan mengubah `id`/`sheetNo` sheet existing; sheet baru = entri BARU dengan id stabil.
- Kontrak `Drawing` hanya `lines` (kind: `"outline"|"slab"|"opening"|"ground"|"cut"`) + `labels` (kind: `"room"|"level"|"title"`, `anchor` wajib `"start"` untuk teks tabel) + `dims` + `levels`. Jangan menambah kind baru.
- Harga RAB baru = confidence `"low"`, wajib `sourceElementIds`, wajib catatan notes. Jangan memberi harga pada hal yang belum dimodelkan.
- Commit message: bahasa Indonesia, format `feat(stairs): â€¦` / `feat(pool): â€¦`, diakhiri `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- File hotspot (`build-model.ts`, `layout-sheet.ts`, `section.ts`, `rab.ts`, `editor-inspector.tsx`): hanya patch integrasi kecil; logika baru masuk modul baru.

---

### Task 1: Modul sumber-tunggal `src/lib/stairs/geometry.ts`

Ekstraksi mekanis derivasi tangga interior yang saat ini DUPLIKAT di `build-model.ts:584-643` dan `layout-sheet.ts:174-219` (dan akan dipakai section+RAB+validasi di task berikut). **Tanpa perubahan perilaku.**

**Files:**
- Create: `src/lib/stairs/geometry.ts`
- Create: `src/lib/stairs/geometry.test.ts`
- Modify: `src/lib/three/build-model.ts:587-594` (konsumsi spec; loop prim tetap di sini)
- Modify: `src/lib/drawings/layout-sheet.ts:176-181` (konsumsi spec)

**Interfaces:**
- Produces (dipakai Task 2â€“4):
  ```ts
  export type StairDir = "n" | "s" | "w" | "e"
  export type InteriorStairSpec = {
    dir: StairDir
    horizontalRun: boolean   // true = run sepanjang sumbu x (dir w/e)
    runLenM: number          // panjang run pada arah naik
    widthM: number           // lebar tangga (tegak lurus run)
    totalRiseM: number
    steps: number            // jumlah anak
    riserM: number           // totalRiseM / steps
    treadM: number           // runLenM / steps
  }
  export const INTERIOR_RISER_TARGET_M = 0.18
  export function interiorStairSpec(
    room: Pick<Room, "width" | "depth" | "stairDirection">,
    totalRiseM: number,
  ): InteriorStairSpec
  ```
- PENTING: modul ini TIDAK boleh mengimpor `build-model.ts` (build-model akan mengimpornya â€” hindari cycle). `totalRiseM` selalu dipasok pemanggil (`WALL_H + SLAB_T` dari build-model / layout-sheet / rab).

- [x] **Step 1: Tulis failing test**

```ts
// src/lib/stairs/geometry.test.ts
import { describe, expect, it } from "vitest"

import { interiorStairSpec, INTERIOR_RISER_TARGET_M } from "./geometry"

describe("interiorStairSpec", () => {
  // Nilai HARUS identik dengan rumus lama build-model.ts:588-594:
  // dir = stairDirection ?? (w>=d ? "e" : "s"); steps = max(3, round(rise/0.18)).
  it("deriva default: sisi terpanjang jadi arah run, riser target 0.18", () => {
    const spec = interiorStairSpec({ width: 2.5, depth: 2.5 }, 3.15)
    expect(spec.dir).toBe("e") // w >= d â†’ "e"
    expect(spec.horizontalRun).toBe(true)
    expect(spec.runLenM).toBe(2.5)
    expect(spec.widthM).toBe(2.5)
    expect(spec.steps).toBe(18) // round(3.15/0.18) = 17.5 â†’ 18
    expect(spec.riserM).toBeCloseTo(3.15 / 18, 5)
    expect(spec.treadM).toBeCloseTo(2.5 / 18, 5)
  })

  it("menghormati stairDirection eksplisit dan menukar run/width", () => {
    const spec = interiorStairSpec({ width: 3, depth: 1.2, stairDirection: "n" }, 3.15)
    expect(spec.dir).toBe("n")
    expect(spec.horizontalRun).toBe(false)
    expect(spec.runLenM).toBe(1.2)
    expect(spec.widthM).toBe(3)
  })

  it("minimal 3 anak untuk rise sangat pendek", () => {
    expect(interiorStairSpec({ width: 2, depth: 2 }, 0.3).steps).toBe(3)
  })

  it("konstanta target riser = 0.18 (sinkron build-model & layout-sheet)", () => {
    expect(INTERIOR_RISER_TARGET_M).toBe(0.18)
  })
})
```

- [x] **Step 2: Verifikasi gagal**

Run: `rtk vitest run src/lib/stairs/geometry.test.ts`
Expected: FAIL â€” modul `./geometry` tidak ada.

- [x] **Step 3: Implementasi minimal**

```ts
// src/lib/stairs/geometry.ts
/**
 * Sumber TUNGGAL derivasi tangga interior (Room type:"tangga").
 * Dipakai: 3D (build-model), denah (layout-sheet), potongan (section),
 * RAB (mock/rab), dan validasi kenyamanan (Task 2). JANGAN duplikasi rumus
 * riser/step di file lain lagi â€” investigasi 2026-07-15 menemukan tiga
 * konstanta riser berbeda karena duplikasi.
 *
 * Modul ini SENGAJA tidak mengimpor build-model (pemakainya) â€” totalRiseM
 * (umumnya WALL_H + SLAB_T) selalu dipasok pemanggil.
 */
import type { Room } from "@/types"

export type StairDir = "n" | "s" | "w" | "e"

export type InteriorStairSpec = {
  dir: StairDir
  horizontalRun: boolean
  runLenM: number
  widthM: number
  totalRiseM: number
  steps: number
  riserM: number
  treadM: number
}

/** Target riser interior â€” nilai historis build-model/layout-sheet. */
export const INTERIOR_RISER_TARGET_M = 0.18

export function interiorStairSpec(
  room: Pick<Room, "width" | "depth" | "stairDirection">,
  totalRiseM: number,
): InteriorStairSpec {
  const dir: StairDir =
    room.stairDirection ?? (room.width >= room.depth ? "e" : "s")
  const horizontalRun = dir === "w" || dir === "e"
  const runLenM = horizontalRun ? room.width : room.depth
  const widthM = horizontalRun ? room.depth : room.width
  const steps = Math.max(3, Math.round(totalRiseM / INTERIOR_RISER_TARGET_M))
  return {
    dir,
    horizontalRun,
    runLenM,
    widthM,
    totalRiseM,
    steps,
    riserM: totalRiseM / steps,
    treadM: runLenM / steps,
  }
}
```

- [x] **Step 4: Verifikasi lulus**

Run: `rtk vitest run src/lib/stairs/geometry.test.ts`
Expected: PASS (4 test).

- [x] **Step 5: Refactor build-model.ts memakai spec (behavior-identical)**

Di `src/lib/three/build-model.ts`, tambahkan import (dekat import lain di atas):

```ts
import { interiorStairSpec } from "@/lib/stairs/geometry"
```

Ganti baris 588-594 (dari `const dir = room.stairDirection ...` s/d `const treadD = runLen / steps`) dengan:

```ts
        const spec = interiorStairSpec(room, WALL_H + SLAB_T)
        const { dir, horizontalRun, runLenM: runLen, widthM: stairW, totalRiseM: totalRise, steps } = spec
        const treadD = spec.treadM
```

JANGAN mengubah apa pun di loop `for (let s = 0; ...)` di bawahnya.

- [x] **Step 6: Refactor layout-sheet.ts memakai spec**

Di `src/lib/drawings/layout-sheet.ts`, tambahkan import:

```ts
import { interiorStairSpec } from "@/lib/stairs/geometry"
```

Ganti baris 177-181 (blok `const dir = ...` s/d `const treadD = runLen / steps`) dengan:

```ts
      const spec = interiorStairSpec(room, WALL_H + SLAB_T)
      const { dir, horizontalRun, runLenM: runLen, steps } = spec
      const treadD = spec.treadM
```

Catatan: konstanta lokal `RISER_M` di layout-sheet menjadi tidak terpakai untuk tangga â€” bila `RISER_M` tidak dipakai tempat lain di file itu, hapus import/deklarasinya (cek dengan `rtk grep RISER_M src/lib/drawings/layout-sheet.ts`).

- [x] **Step 7: Verifikasi behavior-identical**

Run: `rtk vitest run src/lib/three/build-model.test.ts src/lib/drawings/layout-sheet.test.ts src/lib/stairs/geometry.test.ts`
Expected: PASS semua, TANPA mengubah satu pun nilai ekspektasi test existing. Bila ada yang gagal, kembalikan refactor â€” jangan menyesuaikan test.

- [x] **Step 8: Commit**

```bash
rtk git add src/lib/stairs/ src/lib/three/build-model.ts src/lib/drawings/layout-sheet.ts
rtk git commit -m "refactor(stairs): satukan derivasi tangga interior ke src/lib/stairs/geometry.ts

Ekstraksi mekanis tanpa perubahan perilaku dari build-model & layout-sheet
(dua salinan rumus riser 0.18). Menyiapkan pemakaian bersama untuk potongan,
RAB, dan validasi kenyamanan.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TG-1 â€” kontrol riser + validasi kenyamanan SNI

User bisa mengatur target riser; sistem menghitung ulang jumlah anak; peringatan SNI tampil di inspector. Field baru `Room.stairRiserM` opsional â€” layout lama tak berubah.

**Files:**
- Modify: `src/types/index.ts:348-349` (dekat `stairDirection`)
- Modify: `src/lib/schemas/layout.ts:169-184` (schema room â€” tambah field eksplisit)
- Modify: `src/lib/stairs/geometry.ts` (+ override riser + `stairComfortIssues`)
- Modify: `src/lib/three/build-model.ts`, `src/lib/drawings/layout-sheet.ts` (teruskan `room.stairRiserM` â€” otomatis karena spec menerima room; lihat Step 5)
- Modify: `src/components/editor/editor-inspector.tsx:688-720` (blok tangga yang sudah ada)
- Test: `src/lib/stairs/geometry.test.ts`, `src/components/editor/editor-inspector.test.tsx`

**Interfaces:**
- Consumes: `interiorStairSpec` Task 1.
- Produces:
  ```ts
  // ditambahkan ke src/lib/stairs/geometry.ts
  export type StairComfortIssue = { level: "warning" | "danger"; message: string }
  export function stairComfortIssues(spec: InteriorStairSpec): StairComfortIssue[]
  // interiorStairSpec kini juga membaca room.stairRiserM (opsional)
  ```
- Aturan SNI yang dipakai (satu-satunya tempat angka ini boleh hidup):
  riser nyaman 0.15â€“0.19 m; tread nyaman 0.25â€“0.30 m; 2R+T 0.60â€“0.65 m; lebar minimal 0.8 m (danger di bawahnya).

- [x] **Step 1: Failing test â€” override riser & validasi**

Tambahkan ke `src/lib/stairs/geometry.test.ts`:

```ts
import { stairComfortIssues } from "./geometry"

describe("stairRiserM override + stairComfortIssues", () => {
  it("override riser mengubah jumlah anak (round, min 3)", () => {
    const spec = interiorStairSpec({ width: 2.5, depth: 2.5, stairRiserM: 0.15 }, 3.15)
    expect(spec.steps).toBe(21) // round(3.15/0.15)
    expect(spec.riserM).toBeCloseTo(0.15, 5)
  })

  it("override tak wajar (<=0/NaN) diabaikan â†’ default 0.18", () => {
    expect(interiorStairSpec({ width: 2.5, depth: 2.5, stairRiserM: 0 }, 3.15).steps).toBe(18)
    expect(interiorStairSpec({ width: 2.5, depth: 2.5, stairRiserM: Number.NaN }, 3.15).steps).toBe(18)
  })

  it("tangga nyaman â†’ tanpa issue", () => {
    // 3.06 m / 18 anak = riser 0.17; run 4.9 â†’ tread ~0.272; 2R+T = 0.612
    const spec = interiorStairSpec({ width: 4.9, depth: 1.0, stairDirection: "e" }, 3.06)
    expect(stairComfortIssues(spec)).toEqual([])
  })

  it("tread terlalu pendek & 2R+T di luar rentang â†’ warning; lebar <0.8 â†’ danger", () => {
    // run 2.5 / 18 anak = tread 0.139 (< 0.25) dan width 0.7 (< 0.8)
    const spec = interiorStairSpec({ width: 2.5, depth: 0.7, stairDirection: "e" }, 3.15)
    const issues = stairComfortIssues(spec)
    expect(issues.some((i) => i.level === "warning" && i.message.includes("injakan"))).toBe(true)
    expect(issues.some((i) => i.level === "warning" && i.message.includes("2R+T"))).toBe(true)
    expect(issues.some((i) => i.level === "danger" && i.message.includes("Lebar"))).toBe(true)
  })
})
```

- [x] **Step 2: Verifikasi gagal**

Run: `rtk vitest run src/lib/stairs/geometry.test.ts`
Expected: FAIL â€” `stairComfortIssues` belum ada; `stairRiserM` belum dibaca.

- [x] **Step 3: Implementasi di geometry.ts**

Ubah signature & tambah fungsi:

```ts
export const STAIR_RISER_COMFORT_M: [number, number] = [0.15, 0.19]
export const STAIR_TREAD_COMFORT_M: [number, number] = [0.25, 0.3]
export const STAIR_2R_PLUS_T_M: [number, number] = [0.6, 0.65]
export const STAIR_MIN_WIDTH_M = 0.8

export function interiorStairSpec(
  room: Pick<Room, "width" | "depth" | "stairDirection" | "stairRiserM">,
  totalRiseM: number,
): InteriorStairSpec {
  const dir: StairDir =
    room.stairDirection ?? (room.width >= room.depth ? "e" : "s")
  const horizontalRun = dir === "w" || dir === "e"
  const runLenM = horizontalRun ? room.width : room.depth
  const widthM = horizontalRun ? room.depth : room.width
  // Override user hanya dipakai bila wajar; selain itu target historis 0.18.
  const target =
    typeof room.stairRiserM === "number" &&
    Number.isFinite(room.stairRiserM) &&
    room.stairRiserM > 0.05 &&
    room.stairRiserM < 0.5
      ? room.stairRiserM
      : INTERIOR_RISER_TARGET_M
  const steps = Math.max(3, Math.round(totalRiseM / target))
  return {
    dir, horizontalRun, runLenM, widthM, totalRiseM, steps,
    riserM: totalRiseM / steps,
    treadM: runLenM / steps,
  }
}

export type StairComfortIssue = { level: "warning" | "danger"; message: string }

/** Aturan kenyamanan SNI/praktik â€” pesan dalam istilah tukang (injakan/tanjakan). */
export function stairComfortIssues(spec: InteriorStairSpec): StairComfortIssue[] {
  const issues: StairComfortIssue[] = []
  const cm = (m: number) => Math.round(m * 100)
  if (spec.riserM < STAIR_RISER_COMFORT_M[0] || spec.riserM > STAIR_RISER_COMFORT_M[1]) {
    issues.push({
      level: "warning",
      message: `Tinggi tanjakan ${cm(spec.riserM)} cm di luar rentang nyaman 15â€“19 cm.`,
    })
  }
  if (spec.treadM < STAIR_TREAD_COMFORT_M[0] || spec.treadM > STAIR_TREAD_COMFORT_M[1]) {
    issues.push({
      level: "warning",
      message: `Lebar injakan ${cm(spec.treadM)} cm di luar rentang nyaman 25â€“30 cm â€” panjangkan ruang tangga atau ubah riser.`,
    })
  }
  const ratio = 2 * spec.riserM + spec.treadM
  if (ratio < STAIR_2R_PLUS_T_M[0] || ratio > STAIR_2R_PLUS_T_M[1]) {
    issues.push({
      level: "warning",
      message: `Rumus kenyamanan 2R+T = ${cm(ratio)} cm (ideal 60â€“65 cm).`,
    })
  }
  if (spec.widthM < STAIR_MIN_WIDTH_M) {
    issues.push({
      level: "danger",
      message: `Lebar tangga ${cm(spec.widthM)} cm â€” minimal 80 cm agar layak dilewati.`,
    })
  }
  return issues
}
```

- [x] **Step 4: Verifikasi lulus**

Run: `rtk vitest run src/lib/stairs/geometry.test.ts`
Expected: PASS.

- [x] **Step 5: Field domain + schema**

Di `src/types/index.ts`, tepat di bawah `stairDirection` (baris Â±348):

```ts
  /** Target tinggi tanjakan (riser, m) tangga â€” absent/null = otomatis 0.18.
   *  Jumlah anak diturunkan: round(totalRise / riser), min 3. */
  stairRiserM?: number | null;
```

Di `src/lib/schemas/layout.ts` schema rooms (baris 169-184), di bawah `carportCanopyMode`:

```ts
          stairDirection: z.enum(["n", "s", "w", "e"]).optional(),
          stairRiserM: z.number().nullable().optional(),
```

(Room schema `.passthrough()` â€” field lama tetap aman; penambahan eksplisit membuat nilai non-angka ditolak saat PUT.)

Run: `rtk tsc --noEmit` â†’ PASS. `rtk vitest run src/lib/schemas/layout.test.ts` â†’ PASS.

- [x] **Step 6: Failing test inspector**

Tambahkan ke `src/components/editor/editor-inspector.test.tsx` (ikuti pola describe/render yang sudah ada di file itu; gunakan `useEditorStore.setState` seperti test lain di file untuk menyiapkan room tangga terseleksi â€” contoh setup ada di test "Arah naik tangga" bila ada, atau test stairDirection existing):

```tsx
it("ruang tangga: input riser + peringatan kenyamanan SNI tampil", () => {
  // layout dengan room tangga 2.5Ã—0.7 (lebar 0.7 â†’ danger lebar) terseleksi
  const layout = makeLayout()
  const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga", type: "tangga" as const, width: 2.5, depth: 0.7 }
  useEditorStore.setState({ layout: { ...layout, rooms: [...layout.rooms, stair] }, selectedObjectId: "room-stair" })
  render(<EditorInspector />)
  expect(screen.getByLabelText(/Tinggi tanjakan/i)).toBeTruthy()
  expect(screen.getByText(/minimal 80 cm/i)).toBeTruthy()
})
```

Run: `rtk vitest run src/components/editor/editor-inspector.test.tsx`
Expected: test baru FAIL (input & warning belum ada).

- [x] **Step 7: Implementasi inspector**

Di blok tangga `editor-inspector.tsx` (baris Â±688-720, setelah tombol arah naik), tambahkan:

```tsx
              {(() => {
                const spec = interiorStairSpec(room, WALL_H + SLAB_T)
                const issues = stairComfortIssues(spec)
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
                        const v = parseFloat(e.target.value)
                        updateRoom(room.id, {
                          stairRiserM: Number.isFinite(v) && v > 0 ? v : null,
                        })
                      }}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {spec.steps} anak Â· tanjakan {(spec.riserM * 100).toFixed(0)} cm Â·
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
                  </div>
                )
              })()}
```

Import yang dibutuhkan di editor-inspector.tsx:

```ts
import { interiorStairSpec, stairComfortIssues } from "@/lib/stairs/geometry"
import { SLAB_T, WALL_H } from "@/lib/three/build-model"
```

(`Label`/`Input`/`updateRoom` sudah ada di file â€” jangan duplikasi import.)

- [x] **Step 8: Verifikasi + AI parity**

Run: `rtk vitest run src/components/editor/editor-inspector.test.tsx src/lib/stairs/geometry.test.ts` â†’ PASS.

Tambahkan `stairRiserM` ke field Room yang boleh dipatch AI: cari `stairDirection` di `src/lib/assistant/actions.ts` (dua kemunculan: schema patch Â±:353 dan Â±:509) dan tambahkan di keduanya `stairRiserM: z.number().nullable().optional(),`; lalu di `src/lib/assistant/apply.ts` cari tempat `stairDirection` diteruskan (Â±:135) dan teruskan `stairRiserM` dengan pola yang sama. Run: `rtk vitest run src/lib/assistant` â†’ PASS (perbaiki `capability-parity` bila menuntut daftar field â€” ikuti pesan test).

- [x] **Step 9: Commit**

```bash
rtk git add src/types/index.ts src/lib/schemas/layout.ts src/lib/stairs/ src/components/editor/editor-inspector.tsx src/components/editor/editor-inspector.test.tsx src/lib/assistant/
rtk git commit -m "feat(stairs): kontrol riser + validasi kenyamanan SNI di inspector

Room.stairRiserM opsional (default historis 0.18), jumlah anak dihitung
ulang; peringatan riser 15-19, injakan 25-30, 2R+T 60-65, lebar min 80 cm
tampil di inspector. Field ikut schema layout & patch AI.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: TG-3 â€” profil tangga di potongan + penomoran anak di denah

**Files:**
- Modify: `src/lib/stairs/geometry.ts` (+ `stairProfilePoints`)
- Modify: `src/lib/drawings/section.ts` (gambar profil dalam `drawFloor`, dekat loop `cutRooms` baris Â±108)
- Modify: `src/lib/drawings/layout-sheet.ts` (penomoran, di dalam blok `if (room.type === "tangga")`)
- Test: `src/lib/stairs/geometry.test.ts`, `src/lib/drawings/section.test.ts`, `src/lib/drawings/layout-sheet.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Polyline profil tangga pada bidang (h = sumbu run, y = elevasi), mulai
   *  (hStart, baseY): riser naik lalu tread maju per anak. Runtut untuk
   *  digambar sebagai pasangan garis. ascending=true berarti naik ke arah h+. */
  export function stairProfilePoints(
    spec: InteriorStairSpec,
    hStart: number,
    baseY: number,
    ascending: boolean,
  ): Array<{ h: number; y: number }>
  ```
- Consumes: `interiorStairSpec` (Task 1), konvensi section: axis "x" â†’ h = y (run n/s sejajar bidang), axis "y" â†’ h = x (run w/e sejajar bidang).

- [x] **Step 1: Failing test profil**

Tambahkan ke `src/lib/stairs/geometry.test.ts`:

```ts
import { stairProfilePoints } from "./geometry"

describe("stairProfilePoints", () => {
  it("menghasilkan 2*steps+1 titik zig-zag riser/tread", () => {
    const spec = interiorStairSpec({ width: 2.7, depth: 1.0, stairDirection: "e" }, 0.54)
    // 0.54/0.18 = 3 anak; tread = 0.9
    const pts = stairProfilePoints(spec, 10, 0, true)
    expect(pts).toHaveLength(7)
    expect(pts[0]).toEqual({ h: 10, y: 0 })
    expect(pts[1]).toEqual({ h: 10, y: 0.18 })          // riser 1
    expect(pts[2]).toEqual({ h: 10.9, y: 0.18 })        // tread 1
    expect(pts[6]).toEqual({ h: 12.7, y: 0.54 })        // puncak = h+runLen
  })

  it("ascending=false berjalan ke arah h negatif", () => {
    const spec = interiorStairSpec({ width: 2.7, depth: 1.0, stairDirection: "e" }, 0.54)
    const pts = stairProfilePoints(spec, 10, 0, false)
    expect(pts[6].h).toBeCloseTo(10 - 2.7, 5)
  })
})
```

Run: `rtk vitest run src/lib/stairs/geometry.test.ts` â†’ FAIL (fungsi belum ada).

- [x] **Step 2: Implementasi**

```ts
export function stairProfilePoints(
  spec: InteriorStairSpec,
  hStart: number,
  baseY: number,
  ascending: boolean,
): Array<{ h: number; y: number }> {
  const dirSign = ascending ? 1 : -1
  const pts: Array<{ h: number; y: number }> = [{ h: hStart, y: baseY }]
  let h = hStart
  let y = baseY
  for (let s = 0; s < spec.steps; s++) {
    y = baseY + spec.riserM * (s + 1)
    pts.push({ h, y })
    h = hStart + dirSign * spec.treadM * (s + 1)
    pts.push({ h, y })
  }
  return pts
}
```

Run: `rtk vitest run src/lib/stairs/geometry.test.ts` â†’ PASS.

- [x] **Step 3: Failing test section**

Tambahkan ke `src/lib/drawings/section.test.ts` (pakai helper fixture yang sudah ada di file â€” cari cara test lain membangun layout, biasanya `makeLayout()` + rooms custom):

```ts
it("memotong ruang tangga â†’ profil anak tangga tergambar (kind cut, refId room)", () => {
  const layout = makeLayout()
  const stair = {
    ...layout.rooms[0],
    id: "room-stair",
    name: "Tangga",
    type: "tangga" as const,
    x: 1, y: 1, width: 2.5, depth: 1.0,
    stairDirection: "s" as const, // run sepanjang y â†’ sejajar bidang potong axis "x"
  }
  const l = { ...layout, rooms: [...layout.rooms, stair] }
  const drawing = buildSection(l, { axis: "x", positionM: 2 }) // 1 â‰¤ 2 â‰¤ 3.5 â†’ terpotong
  const stairLines = drawing.lines.filter((ln) => ln.refId === "room-stair" && ln.kind === "cut")
  // 2*steps garis zig-zag; steps â‰¥ 3 â†’ minimal 6 garis
  expect(stairLines.length).toBeGreaterThanOrEqual(6)
})

it("run tegak lurus bidang potong â†’ tidak menggambar profil (tidak crash)", () => {
  const layout = makeLayout()
  const stair = {
    ...layout.rooms[0],
    id: "room-stair2", name: "Tangga", type: "tangga" as const,
    x: 1, y: 1, width: 2.5, depth: 1.0, stairDirection: "e" as const,
  }
  const l = { ...layout, rooms: [...layout.rooms, stair] }
  const drawing = buildSection(l, { axis: "x", positionM: 2 })
  expect(drawing.lines.filter((ln) => ln.refId === "room-stair2").length).toBe(0)
})
```

Run: `rtk vitest run src/lib/drawings/section.test.ts` â†’ FAIL.

- [x] **Step 4: Implementasi di section.ts**

Import:

```ts
import { interiorStairSpec, stairProfilePoints } from "@/lib/stairs/geometry"
import { SLAB_T, WALL_H } from "@/lib/three/build-model"
```

(cek: `OPEN_TYPES` sudah diimpor dari build-model â€” gabungkan ke import yang sama.)

Di dalam `drawFloor`, di dalam loop `for (const room of cutRooms)` (setelah geometri dinding ruang, sebelum penutup loop), tambahkan:

```ts
      // Profil tangga: hanya bila arah run SEJAJAR bidang gambar
      // (axis "x" â†’ h=y â†’ run n/s; axis "y" â†’ h=x â†’ run w/e).
      if (room.type === "tangga") {
        const spec = interiorStairSpec(room, WALL_H + SLAB_T)
        const runParallel = axis === "x" ? !spec.horizontalRun : spec.horizontalRun
        if (runParallel) {
          // Titik awal run pada sumbu h + apakah naik ke arah h positif.
          const ascending = spec.dir === "s" || spec.dir === "e"
          const hStart = ascending ? h0 : h1
          const pts = stairProfilePoints(spec, hStart, baseY + off, ascending)
          for (let i = 0; i < pts.length - 1; i++) {
            lines.push({
              x1: round2(pts[i].h), y1: round2(pts[i].y),
              x2: round2(pts[i + 1].h), y2: round2(pts[i + 1].y),
              kind: "cut", refId: room.id,
            })
          }
          labels.push({
            x: round2((h0 + h1) / 2),
            y: round2(baseY + off + spec.totalRiseM / 2),
            text: `TANGGA ${spec.steps} anak Â· R ${Math.round(spec.riserM * 100)} cm`,
            kind: "room", refId: room.id,
          })
        }
      }
```

Catatan penting untuk engineer: `h0`, `h1`, `off`, `baseY` sudah tersedia di scope loop (lihat baris 109-110). `dir === "s"`: run dari y kecilâ†’besar = h kecilâ†’besar = ascending. `dir === "n"` kebalikannya. Analogi e/w pada axis "y".

Run: `rtk vitest run src/lib/drawings/section.test.ts` â†’ PASS (dan seluruh test lama file itu tetap PASS).

- [x] **Step 5: Failing test penomoran denah**

Tambahkan ke `src/lib/drawings/layout-sheet.test.ts`:

```ts
it("denah tangga: setiap anak diberi nomor 1..N", () => {
  const layout = makeLayout()
  const stair = {
    ...layout.rooms[0],
    id: "room-stair", name: "Tangga", type: "tangga" as const,
    x: 1, y: 1, width: 2.5, depth: 1.0, stairDirection: "e" as const,
  }
  const l = { ...layout, rooms: [...layout.rooms, stair] }
  const d = buildLayoutSheet(l, layout.floors[0].id)
  const nums = d.labels.filter((lb) => lb.refId === "room-stair" && /^\d+$/.test(lb.text))
  // steps = max(3, round(3.15/0.18)) tergantung heightM fixture â€” minimal 3
  expect(nums.length).toBeGreaterThanOrEqual(3)
  expect(nums[0].text).toBe("1")
  expect(nums[nums.length - 1].text).toBe(String(nums.length))
})
```

Run: `rtk vitest run src/lib/drawings/layout-sheet.test.ts` â†’ FAIL.

- [x] **Step 6: Implementasi penomoran**

Di blok tangga `layout-sheet.ts`, setelah loop garis tread (baris Â±182-190), tambahkan:

```ts
      // Penomoran anak tangga 1..N di as run, sedikit menepi agar tidak
      // menabrak panah NAIK (offset 25% lebar dari tepi).
      const u = sideVec(dir)
      const perpN = { x: -u.y, y: u.x }
      const stairWidth = horizontalRun ? room.depth : room.width
      const offEdge = stairWidth * 0.25
      for (let k = 0; k < steps; k++) {
        const along = (k + 0.5) * treadD
        const bx = dir === "e" ? room.x + along : dir === "w" ? room.x + room.width - along : room.x + room.width / 2
        const by = dir === "s" ? room.y + along : dir === "n" ? room.y + room.depth - along : room.y + room.depth / 2
        labels.push({
          x: round2(bx + perpN.x * offEdge),
          y: round2(by + perpN.y * offEdge),
          text: String(k + 1),
          kind: "room",
          refId: room.id,
        })
      }
```

Catatan: `sideVec` sudah ada di file (baris 103); variabel `u` untuk panah NAIK dideklarasikan SETELAH blok ini (baris Â±193) â€” beri nama berbeda atau pindahkan deklarasi agar tidak bentrok (`const u` ganda dalam satu blok = error; gunakan nama `u` sekali di atas dan hapus deklarasi duplikat di blok panah).

Run: `rtk vitest run src/lib/drawings/layout-sheet.test.ts` â†’ PASS (semua, termasuk yang lama).

- [x] **Step 7: Commit**

```bash
rtk git add src/lib/stairs/ src/lib/drawings/section.ts src/lib/drawings/section.test.ts src/lib/drawings/layout-sheet.ts src/lib/drawings/layout-sheet.test.ts
rtk git commit -m "feat(stairs): profil tangga di potongan + penomoran anak di denah

Potongan menggambar zig-zag riser/tread (kind cut, refId room) bila arah run
sejajar bidang potong, dengan label jumlah anak & riser. Denah menomori anak
1..N di as run. Semua derivasi dari interiorStairSpec â€” satu sumber.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---### Task 4: TG-4 â€” line item RAB tangga interior

**Files:**
- Modify: `src/lib/stairs/geometry.ts` (+ `interiorStairQuantities`)
- Modify: `src/lib/mock/rab.ts` (blok specs baru â€” letakkan SETELAH blok furnishing, sebelum `const items = specs.map(toItem)`)
- Test: `src/lib/stairs/geometry.test.ts`, `src/lib/mock/rab.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type InteriorStairQuantities = {
    concreteM3: number   // pelat miring 12 cm + volume anak
    finishM2: number     // (tread+riser) Ã— width Ã— steps
    railingM: number     // 2 sisi Ã— panjang miring
  }
  export function interiorStairQuantities(spec: InteriorStairSpec): InteriorStairQuantities
  ```
- Rate (konstanta di rab.ts, confidence "low"):
  beton bertulang terpasang Rp 4.500.000/mÂ³; finishing injakan+tanjakan Rp 450.000/mÂ²; railing Rp 950.000/m.

- [x] **Step 1: Failing test kuantitas (hand calculation)**

Tambahkan ke `src/lib/stairs/geometry.test.ts`:

```ts
import { interiorStairQuantities } from "./geometry"

describe("interiorStairQuantities", () => {
  it("hand calculation: run 2.7, width 1.0, rise 0.54 (3 anak)", () => {
    const spec = interiorStairSpec({ width: 2.7, depth: 1.0, stairDirection: "e" }, 0.54)
    const q = interiorStairQuantities(spec)
    const slope = Math.sqrt(2.7 ** 2 + 0.54 ** 2) // 2.7535
    // pelat: slope Ã— 1.0 Ã— 0.12 = 0.3304 ; anak: 3 Ã— 0.5Ã—0.18Ã—0.9Ã—1.0 = 0.243
    expect(q.concreteM3).toBeCloseTo(slope * 0.12 + 0.243, 3)
    // finish: 3 Ã— (0.9+0.18) Ã— 1.0 = 3.24
    expect(q.finishM2).toBeCloseTo(3.24, 3)
    expect(q.railingM).toBeCloseTo(2 * slope, 3)
  })
})
```

Run: `rtk vitest run src/lib/stairs/geometry.test.ts` â†’ FAIL.

- [x] **Step 2: Implementasi**

```ts
/** Ketebalan pelat miring tangga beton (praktik umum 12 cm). */
export const STAIR_SLAB_T_M = 0.12

export function interiorStairQuantities(spec: InteriorStairSpec): InteriorStairQuantities {
  const slopeLen = Math.sqrt(spec.runLenM ** 2 + spec.totalRiseM ** 2)
  const slabM3 = slopeLen * spec.widthM * STAIR_SLAB_T_M
  // Tiap anak = prisma segitiga riserÃ—tread/2 sepanjang lebar.
  const stepsM3 = spec.steps * 0.5 * spec.riserM * spec.treadM * spec.widthM
  return {
    concreteM3: slabM3 + stepsM3,
    finishM2: spec.steps * (spec.treadM + spec.riserM) * spec.widthM,
    railingM: 2 * slopeLen,
  }
}
```

Run: `rtk vitest run src/lib/stairs/geometry.test.ts` â†’ PASS.

- [x] **Step 3: Failing test RAB**

Tambahkan describe baru di `src/lib/mock/rab.test.ts` (ikuti pola `furnishedLayout()` yang ada â€” layout + rooms custom):

```ts
describe("stair lines (tangga interior â†” RAB)", () => {
  function stairLayout(): DesignLayout {
    const base = makeLayout()
    return {
      ...base,
      rooms: [
        ...base.rooms,
        { ...base.rooms[0], id: "room-stair", name: "Tangga", type: "tangga",
          x: 1, y: 1, width: 2.5, depth: 1.0, areaM2: 2.5, stairDirection: "e" },
      ],
    }
  }

  it("tangga interior menghasilkan 3 line item struktur dengan sourceElementIds", () => {
    const rab = generateRAB(sampleProject, sampleBrief, stairLayout())
    const beton = rab.items.find((i) => i.item.includes("Beton tangga"))
    const finish = rab.items.find((i) => i.item.includes("Finishing tangga"))
    const railing = rab.items.find((i) => i.item.includes("Railing tangga"))
    expect(beton).toBeDefined()
    expect(beton!.category).toBe("struktur")
    expect(beton!.unit).toBe("mÂ³")
    expect(beton!.sourceElementIds).toEqual(["room-stair"])
    expect(beton!.notes).toContain("review struktur")
    expect(finish!.unit).toBe("mÂ²")
    expect(railing!.unit).toBe("m")
  })

  it("tanpa room tangga â†’ tidak ada item tangga", () => {
    const rab = generateRAB(sampleProject, sampleBrief, makeLayout())
    expect(rab.items.some((i) => i.item.includes("tangga"))).toBe(false)
  })

  it("summary tetap reconcile", () => {
    const rab = generateRAB(sampleProject, sampleBrief, stairLayout())
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
  })
})
```

Run: `rtk vitest run src/lib/mock/rab.test.ts` â†’ FAIL (3 test baru; test lama tetap PASS).

- [x] **Step 4: Implementasi di rab.ts**

Import:

```ts
import {
  interiorStairQuantities,
  interiorStairSpec,
} from "@/lib/stairs/geometry"
import { SLAB_T, WALL_H } from "@/lib/three/build-model"
```

(cek dulu apakah `WALL_H`/`SLAB_T` sudah diimpor file ini; kalau sudah, gabungkan.)

Tepat SETELAH blok furnishing (`for (const plan of layout.interiors ?? []) { ... }`) dan SEBELUM `const items = specs.map(toItem)`, tambahkan:

```ts
  // â”€â”€ Tangga interior (Room type:"tangga") â€” beton + finishing + railing.
  // Sebelum ini tangga sama sekali tidak punya line item (hanya terhitung
  // sebagai luas lantai) â€” investigasi 2026-07-15 Â§A.3.
  const STAIR_CONCRETE_IDR_M3 = 4_500_000
  const STAIR_FINISH_IDR_M2 = 450_000
  const STAIR_RAILING_IDR_M = 950_000
  for (const room of layout.rooms.filter((r) => r.type === "tangga")) {
    const spec = interiorStairSpec(room, WALL_H + SLAB_T)
    const q = interiorStairQuantities(spec)
    specs.push(
      {
        category: "struktur",
        item: `Beton tangga â€” ${room.name}`,
        volume: q.concreteM3,
        unit: "mÂ³",
        total: q.concreteM3 * STAIR_CONCRETE_IDR_M3,
        confidence: "low",
        notes: `${spec.steps} anak, riser ${Math.round(spec.riserM * 100)} cm, pelat miring 12 cm. Perlu review struktur.`,
        sourceElementIds: [room.id],
      },
      {
        category: "finishing",
        item: `Finishing tangga (injakan+tanjakan) â€” ${room.name}`,
        volume: q.finishM2,
        unit: "mÂ²",
        total: q.finishM2 * STAIR_FINISH_IDR_M2,
        confidence: "low",
        notes: "Granit/homogenous tile + step nosing anti slip.",
        sourceElementIds: [room.id],
      },
      {
        category: "finishing",
        item: `Railing tangga 2 sisi â€” ${room.name}`,
        volume: q.railingM,
        unit: "m",
        total: q.railingM * STAIR_RAILING_IDR_M,
        confidence: "low",
        notes: "Hollow/besi tempa, tinggi 90 cm.",
        sourceElementIds: [room.id],
      },
    )
  }
```

- [x] **Step 5: Verifikasi**

Run: `rtk vitest run src/lib/mock/rab.test.ts` â†’ PASS semua (baru + lama; test reconcile lama tetap hijau karena summary dihitung dari items).

- [x] **Step 6: Commit**

```bash
rtk git add src/lib/stairs/ src/lib/mock/rab.ts src/lib/mock/rab.test.ts
rtk git commit -m "feat(stairs): RAB tangga interior â€” beton m3 + finishing m2 + railing m

Sebelumnya tangga interior tidak punya line item sama sekali. Kuantitas dari
interiorStairQuantities (pelat miring 12 cm + prisma anak), rate confidence
low, sourceElementIds ke room tangga, notes wajib review struktur.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: KL-1 â€” sheet "Denah Pipa Kolam" + skedul MEP

Menerbitkan `poolFittings` + `poolCirculation` + `poolElectrical` (semua SUDAH ada dan teruji) ke gambar kerja. Paritas UI/PDF otomatis karena `defaultSheets` mengikuti `buildSheetList`.

**Files:**
- Create: `src/lib/drawings/pool-piping.ts`
- Create: `src/lib/drawings/pool-piping.test.ts`
- Modify: `src/lib/drawings/sheet-list.ts` (registrasi kondisional; JANGAN mengubah entri lain)
- Test tambahan: `src/lib/drawings/sheet-list.test.ts`

**Interfaces:**
- Consumes: `poolCirculation(room)`, `poolFittings(room)` dari `@/lib/three/pool-circulation` (fitting: `{kind:"skimmer"|"return"|"drain"|"equipment"; u,vâˆˆ[0,1] (equipment u>1); label}`), `poolElectrical(room)` dari `@/lib/three/pool-electrical`.
- Produces: `export function buildPoolPiping(layout: DesignLayout): Drawing`
- Pemetaan kind garis (kontrak Drawing tak boleh nambah kind): outline kolam & glyph fitting = `"outline"`; pipa HISAP (skimmer/drainâ†’equipment) = `"cut"`; pipa BALIK (equipmentâ†’inlet) = `"opening"`; garis tabel = `"slab"`. Renderer existing menggambar semua kind â€” pemetaan ini didokumentasikan di header modul.
- Semua elemen ber-`refId = room.id`; teks skedul pakai `anchor: "start"`.

- [x] **Step 1: Failing test builder**

```ts
// src/lib/drawings/pool-piping.test.ts
import { describe, expect, it } from "vitest"

import { buildPoolPiping } from "./pool-piping"
import { poolCirculation } from "@/lib/three/pool-circulation"
import { makeLayout } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

function poolLayout(): DesignLayout {
  const base = makeLayout()
  return {
    ...base,
    rooms: [
      ...base.rooms,
      { ...base.rooms[0], id: "room-pool", name: "Kolam", type: "kolam",
        x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" },
    ],
  }
}

describe("buildPoolPiping", () => {
  it("menggambar outline kolam + fitting + jalur hisap/balik ber-refId", () => {
    const d = buildPoolPiping(poolLayout())
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    expect(d.title).toBe("Denah Pipa Kolam")
    const poolLines = d.lines.filter((l) => l.refId === "room-pool")
    expect(poolLines.some((l) => l.kind === "cut")).toBe(true)     // pipa hisap
    expect(poolLines.some((l) => l.kind === "opening")).toBe(true) // pipa balik
    // label fitting: 1 per skimmer/inlet/drain + equipment
    const fittingLabels = d.labels.filter((lb) => lb.refId === "room-pool" &&
      ["Skimmer", "Inlet", "Main drain", "Pompa & filter"].includes(lb.text))
    expect(fittingLabels.length).toBe(c.skimmers + c.returns + c.mainDrains + 1)
  })

  it("skedul MEP memuat angka pompa/filter/pipa/MCB persis dari kalkulasi", () => {
    const d = buildPoolPiping(poolLayout())
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    const texts = d.labels.map((l) => l.text).join("\n")
    expect(texts).toContain(`Pompa ${c.pumpHp} HP`)
    expect(texts).toContain(`Filter pasir Ã˜${c.filterDiaInch}"`)
    expect(texts).toContain(`Hisap Ã˜${c.suctionPipeMm} / balik Ã˜${c.returnPipeMm} mm`)
    expect(texts).toContain(`Turnover ${c.turnoverHours} jam`)
  })

  it("tanpa kolam â†’ drawing kosong berjudul benar (tidak crash)", () => {
    const d = buildPoolPiping(makeLayout())
    expect(d.lines).toHaveLength(0)
  })
})
```

Run: `rtk vitest run src/lib/drawings/pool-piping.test.ts` â†’ FAIL (modul belum ada).

- [x] **Step 2: Implementasi builder**

```ts
// src/lib/drawings/pool-piping.ts
/**
 * DENAH PIPA KOLAM â€” menerbitkan perhitungan sirkulasi (pool-circulation.ts)
 * ke gambar kerja. Sebelumnya denah pipa hanya ada di panel editor 3D
 * (PoolQuickEditor) dan tidak pernah sampai ke kontraktor.
 *
 * Pemetaan kind (kontrak Drawing tidak menambah kind baru):
 *   "outline"  = outline kolam + glyph fitting
 *   "cut"      = pipa HISAP  (skimmer & main drain â†’ pompa)
 *   "opening"  = pipa BALIK  (pompa â†’ inlet/return)
 *   "slab"     = garis tabel skedul MEP
 * Semua elemen milik satu kolam ber-refId room.id.
 */
import type { DesignLayout, Room } from "@/types"
import { round2 } from "@/lib/geometry"
import { poolCirculation, poolFittings } from "@/lib/three/pool-circulation"
import { poolElectrical } from "@/lib/three/pool-electrical"
import type { Drawing, DrawLabel, DrawLine } from "./types"

const GLYPH_R = 0.18          // setengah sisi glyph fitting (m)
const POOL_GAP_M = 2.5        // jarak antar kolam bila lebih dari satu
const TABLE_ROW_M = 0.55      // tinggi baris skedul
const MARGIN_M = 1

function glyph(lines: DrawLine[], x: number, y: number, refId: string): void {
  // kotak kecil + silang â€” cukup khas tanpa butuh DrawSymbol
  lines.push(
    { x1: x - GLYPH_R, y1: y - GLYPH_R, x2: x + GLYPH_R, y2: y - GLYPH_R, kind: "outline", refId },
    { x1: x + GLYPH_R, y1: y - GLYPH_R, x2: x + GLYPH_R, y2: y + GLYPH_R, kind: "outline", refId },
    { x1: x + GLYPH_R, y1: y + GLYPH_R, x2: x - GLYPH_R, y2: y + GLYPH_R, kind: "outline", refId },
    { x1: x - GLYPH_R, y1: y + GLYPH_R, x2: x - GLYPH_R, y2: y - GLYPH_R, kind: "outline", refId },
    { x1: x - GLYPH_R, y1: y - GLYPH_R, x2: x + GLYPH_R, y2: y + GLYPH_R, kind: "outline", refId },
  )
}

export function buildPoolPiping(layout: DesignLayout): Drawing {
  const pools = layout.rooms.filter((r) => r.type === "kolam")
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  let cursorY = 0
  let maxX = 0

  for (const pool of pools) {
    const y0 = cursorY
    drawOnePool(pool, y0, lines, labels)
    const c = poolCirculation(pool)
    const rows = scheduleRows(pool, c)
    const tableY = y0 + pool.depth + 1
    drawSchedule(pool, rows, tableY, lines, labels)
    cursorY = tableY + rows.length * TABLE_ROW_M + POOL_GAP_M
    maxX = Math.max(maxX, pool.width + 4) // + ruang pompa & label kanan
  }

  return {
    widthM: round2(maxX + MARGIN_M * 2),
    heightM: round2(Math.max(1, cursorY - POOL_GAP_M) + MARGIN_M * 2),
    lines,
    labels,
    dims: [],
    levels: [],
    title: "Denah Pipa Kolam",
  }
}

function drawOnePool(
  pool: Room,
  y0: number,
  lines: DrawLine[],
  labels: DrawLabel[],
): void {
  const refId = pool.id
  const w = pool.width
  const d = pool.depth

  // outline kolam (digambar lokal dari (0,y0) â€” sheet ini skematik, bukan
  // posisi tapak; posisi tapak ada di denah arsitektur)
  lines.push(
    { x1: 0, y1: y0, x2: w, y2: y0, kind: "outline", refId },
    { x1: w, y1: y0, x2: w, y2: y0 + d, kind: "outline", refId },
    { x1: w, y1: y0 + d, x2: 0, y2: y0 + d, kind: "outline", refId },
    { x1: 0, y1: y0 + d, x2: 0, y2: y0, kind: "outline", refId },
  )
  labels.push({ x: round2(w / 2), y: round2(y0 + d / 2), text: pool.name, kind: "room", refId })

  const fittings = poolFittings(pool)
  const eq = fittings.find((f) => f.kind === "equipment")!
  const eqX = round2(eq.u * w)
  const eqY = round2(y0 + eq.v * d)
  for (const f of fittings) {
    const fx = round2(f.u * w)
    const fy = round2(y0 + f.v * d)
    glyph(lines, fx, fy, refId)
    labels.push({ x: round2(fx + GLYPH_R + 0.1), y: fy, text: f.label, kind: "room", refId, anchor: "start" })
    if (f.kind === "skimmer" || f.kind === "drain") {
      lines.push({ x1: fx, y1: fy, x2: eqX, y2: eqY, kind: "cut", refId })   // hisap
    } else if (f.kind === "return") {
      lines.push({ x1: eqX, y1: eqY, x2: fx, y2: fy, kind: "opening", refId }) // balik
    }
  }
}

function scheduleRows(pool: Room, c: ReturnType<typeof poolCirculation>): string[] {
  const e = poolElectrical(pool)
  return [
    `Volume ${c.volumeM3} mÂ³ Â· Turnover ${c.turnoverHours} jam Â· Debit ${c.flowM3h} mÂ³/jam`,
    `Pompa ${c.pumpHp} HP (${e.pumpKw.toFixed(2)} kW) Â· MCB ${e.pumpBreakerA} A`,
    `Filter pasir Ã˜${c.filterDiaInch}"`,
    `Skimmer ${c.skimmers} Â· Inlet ${c.returns} Â· Main drain ${c.mainDrains}`,
    `Hisap Ã˜${c.suctionPipeMm} / balik Ã˜${c.returnPipeMm} mm Â· Pipa Â±${c.estPipeM} m`,
    `Lampu ${e.lights}Ã—${25} W 12V Â· Trafo ${e.transformerVa} VA Â· Bonding Â±${e.bondingM} m`,
  ]
}

function drawSchedule(
  pool: Room,
  rows: string[],
  tableY: number,
  lines: DrawLine[],
  labels: DrawLabel[],
): void {
  const refId = pool.id
  const tw = Math.max(pool.width, 6)
  for (let i = 0; i <= rows.length; i++) {
    const y = round2(tableY + i * TABLE_ROW_M)
    lines.push({ x1: 0, y1: y, x2: tw, y2: y, kind: "slab", refId })
  }
  lines.push({ x1: 0, y1: round2(tableY), x2: 0, y2: round2(tableY + rows.length * TABLE_ROW_M), kind: "slab", refId })
  lines.push({ x1: tw, y1: round2(tableY), x2: tw, y2: round2(tableY + rows.length * TABLE_ROW_M), kind: "slab", refId })
  rows.forEach((text, i) => {
    labels.push({
      x: 0.15,
      y: round2(tableY + (i + 0.5) * TABLE_ROW_M),
      text,
      kind: "room",
      refId,
      anchor: "start",
    })
  })
}
```

Catatan untuk engineer: cek dulu bentuk return `poolElectrical` di `src/lib/three/pool-electrical.ts:44-70` â€” field yang dipakai di atas: `pumpKw`, `pumpBreakerA`, `lights`, `transformerVa`, `bondingM`. Bila nama berbeda, ikuti nama di file itu (JANGAN mengubah pool-electrical).

- [x] **Step 3: Verifikasi**

Run: `rtk vitest run src/lib/drawings/pool-piping.test.ts` â†’ PASS.

- [x] **Step 4: Registrasi sheet (kondisional)**

Di `src/lib/drawings/sheet-list.ts`:
1. Import: `import { buildPoolPiping } from "./pool-piping"`.
2. Temukan entri `id: "riser"` (sheetNo `"P-R"`). TEPAT SETELAH entri itu, tambahkan (gunakan nilai `kind` YANG SAMA dengan entri riser â€” baca dari file, jangan mengarang nilai baru):

```ts
    ...(layout.rooms.some((r) => r.type === "kolam")
      ? [{
          id: "pool-piping" as const,
          label: "Denah Pipa Kolam",
          sheetNo: "P-K1",
          kind: /* SAMA dengan kind entri "riser" di atas */,
          build: (l: DesignLayout) => buildPoolPiping(l),
        }]
      : []),
```

3. Bila union tipe `id`/`kind` pada `SheetListEntry` (deklarasi Â±baris 59-85) menolak `"pool-piping"`, tambahkan `"pool-piping"` ke union `id` â€” JANGAN menambah nilai kind baru.

- [x] **Step 5: Test registrasi**

Tambahkan ke `src/lib/drawings/sheet-list.test.ts` (ikuti pola test existing yang memanggil `buildSheetList`):

```ts
it("layout dengan kolam mendaftarkan sheet pool-piping P-K1 setelah riser; tanpa kolam tidak ada", () => {
  const withPool = { ...makeLayout(), rooms: [...makeLayout().rooms,
    { ...makeLayout().rooms[0], id: "room-pool", name: "Kolam", type: "kolam" as const, poolKind: "renang" as const }] }
  const entries = buildSheetList(withPool)
  const idx = entries.findIndex((e) => e.id === "pool-piping")
  expect(idx).toBeGreaterThan(entries.findIndex((e) => e.id === "riser"))
  expect(entries[idx].sheetNo).toBe("P-K1")
  expect(buildSheetList(makeLayout()).some((e) => e.id === "pool-piping")).toBe(false)
})
```

Run: `rtk vitest run src/lib/drawings/sheet-list.test.ts src/lib/exports/drawings-pack.test.ts` â†’ PASS (pack test = paritas PDF; bila ia meng-assert daftar sheet statis, perbarui ekspektasinya menambah "pool-piping" HANYA pada fixture yang punya kolam).

- [x] **Step 6: Commit**

```bash
rtk git add src/lib/drawings/pool-piping.ts src/lib/drawings/pool-piping.test.ts src/lib/drawings/sheet-list.ts src/lib/drawings/sheet-list.test.ts
rtk git commit -m "feat(pool): sheet Denah Pipa Kolam (P-K1) â€” sirkulasi & skedul MEP masuk gambar kerja

Menerbitkan poolCirculation/poolFittings/poolElectrical (sudah ada & teruji)
ke paket kontraktor: outline kolam, glyph fitting, jalur hisap (cut) & balik
(opening), tabel skedul (volume/turnover/pompa/MCB/filter/pipa/lampu/bonding).
Sheet kondisional â€” hanya bila layout punya room kolam.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: KL-3 â€” sheet "Detail Kolam" (potongan konstruksi)

**Files:**
- Create: `src/lib/drawings/pool-detail.ts`
- Create: `src/lib/drawings/pool-detail.test.ts`
- Modify: `src/lib/drawings/sheet-list.ts` (registrasi setelah "pool-piping")

**Interfaces:**
- Consumes: `effectivePoolDepth`, `effectivePoolFinish`, `POOL_FINISHES` dari `@/lib/three/pool`.
- Produces: `export function buildPoolDetail(layout: DesignLayout): Drawing`
- Konstanta konstruksi (hidup HANYA di modul ini): dinding beton 0.20 m, lantai kolam 0.20 m, lantai kerja 0.05 m, muka air 0.08 m di bawah bibir, coping 0.12 tinggi Ã— 0.18 lebar.

- [x] **Step 1: Failing test**

```ts
// src/lib/drawings/pool-detail.test.ts
import { describe, expect, it } from "vitest"

import { buildPoolDetail } from "./pool-detail"
import { makeLayout } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

function poolLayout(depth = 1.5): DesignLayout {
  const base = makeLayout()
  return {
    ...base,
    rooms: [...base.rooms, { ...base.rooms[0], id: "room-pool", name: "Kolam",
      type: "kolam", x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
      poolKind: "renang", poolDepthM: depth }],
  }
}

describe("buildPoolDetail", () => {
  it("potongan memuat garis tanah, dinding cut, muka air, level Â±0.00 dan -kedalaman", () => {
    const d = buildPoolDetail(poolLayout(1.5))
    expect(d.title).toBe("Detail Kolam")
    expect(d.lines.some((l) => l.kind === "ground")).toBe(true)
    expect(d.lines.some((l) => l.kind === "cut" && l.refId === "room-pool")).toBe(true)
    expect(d.levels.some((lv) => lv.y === 0)).toBe(true)
    expect(d.levels.some((lv) => lv.y === -1.5)).toBe(true)
  })

  it("catatan spesifikasi (K-300, waterproofing, finish) tercantum", () => {
    const texts = buildPoolDetail(poolLayout()).labels.map((l) => l.text).join("\n")
    expect(texts).toContain("K-300")
    expect(texts).toContain("Waterproofing")
    expect(texts).toMatch(/Keramik biru|Finishing/)
  })

  it("dim chain kedalaman & lebar ada", () => {
    const d = buildPoolDetail(poolLayout(1.5))
    expect(d.dims.some((dim) => dim.axis === "y" && dim.points.includes(-1.5))).toBe(true)
    expect(d.dims.some((dim) => dim.axis === "x")).toBe(true)
  })
})
```

Run: `rtk vitest run src/lib/drawings/pool-detail.test.ts` â†’ FAIL.

- [x] **Step 2: Implementasi**

```ts
// src/lib/drawings/pool-detail.ts
/**
 * DETAIL KOLAM â€” potongan konstruksi per kolam: dinding & lantai beton 20 cm,
 * lantai kerja 5 cm, muka air âˆ’8 cm dari bibir, coping, level Â±0.00/âˆ’kedalaman,
 * catatan spesifikasi. Elevasi memakai konvensi drawing: y ke ATAS, tanah = 0,
 * dasar kolam = âˆ’kedalaman.
 */
import type { DesignLayout, Room } from "@/types"
import { round2 } from "@/lib/geometry"
import { POOL_FINISHES, effectivePoolDepth, effectivePoolFinish } from "@/lib/three/pool"
import type { Drawing, DrawLabel, DrawLine, DimChain, LevelMark } from "./types"

const WALL_T = 0.2
const FLOOR_T = 0.2
const LEAN_T = 0.05          // lantai kerja
const WATER_DROP = 0.08
const COPING_H = 0.12
const COPING_W = 0.18
const POOL_GAP_M = 3

const FINISH_LABEL: Record<string, string> = {
  keramik_biru: "Keramik biru",
  mozaik_hijau: "Mozaik hijau",
  pebble_gelap: "Pebble gelap",
  batu_alam: "Batu alam",
}

export function buildPoolDetail(layout: DesignLayout): Drawing {
  const pools = layout.rooms.filter((r) => r.type === "kolam")
  const lines: DrawLine[] = []
  const labels: DrawLabel[] = []
  const dims: DimChain[] = []
  const levels: LevelMark[] = []
  let x0 = 0
  let maxDepth = 0

  for (const pool of pools) {
    drawOne(pool, x0, lines, labels, dims, levels)
    maxDepth = Math.max(maxDepth, effectivePoolDepth(pool))
    x0 += pool.width + 2 * (WALL_T + COPING_W) + POOL_GAP_M
  }

  return {
    widthM: round2(Math.max(1, x0 - POOL_GAP_M) + 2),
    heightM: round2(maxDepth + FLOOR_T + LEAN_T + COPING_H + 2.5),
    lines,
    labels,
    dims,
    levels,
    title: "Detail Kolam",
  }
}

function drawOne(
  pool: Room,
  x0: number,
  lines: DrawLine[],
  labels: DrawLabel[],
  dims: DimChain[],
  levels: LevelMark[],
): void {
  const refId = pool.id
  const depth = effectivePoolDepth(pool)
  const innerW = pool.width
  const inL = x0 + WALL_T          // muka dalam dinding kiri
  const inR = inL + innerW
  const outL = x0
  const outR = inR + WALL_T

  // garis tanah kiri-kanan
  lines.push({ x1: outL - 1, y1: 0, x2: outR + 1, y2: 0, kind: "ground", refId })

  // dinding kiri & kanan (rect cut: dari 0 turun ke dasar)
  for (const [a, b] of [[outL, inL], [inR, outR]] as const) {
    lines.push(
      { x1: a, y1: 0, x2: a, y2: -depth - FLOOR_T, kind: "cut", refId },
      { x1: b, y1: 0, x2: b, y2: -depth, kind: "cut", refId },
    )
  }
  // lantai kolam + lantai kerja
  lines.push(
    { x1: inL, y1: -depth, x2: inR, y2: -depth, kind: "cut", refId },
    { x1: outL, y1: -depth - FLOOR_T, x2: outR, y2: -depth - FLOOR_T, kind: "cut", refId },
    { x1: outL, y1: -depth - FLOOR_T - LEAN_T, x2: outR, y2: -depth - FLOOR_T - LEAN_T, kind: "slab", refId },
  )
  // muka air
  lines.push({ x1: inL, y1: -WATER_DROP, x2: inR, y2: -WATER_DROP, kind: "opening", refId })
  // coping dua sisi (rect kecil di atas dinding)
  for (const cx of [outL - COPING_W + WALL_T, inR] as const) {
    lines.push(
      { x1: cx, y1: 0, x2: cx + WALL_T + COPING_W, y2: 0, kind: "outline", refId },
      { x1: cx, y1: COPING_H, x2: cx + WALL_T + COPING_W, y2: COPING_H, kind: "outline", refId },
    )
  }

  levels.push({ y: 0, label: "Â±0.00" })
  levels.push({ y: round2(-depth), label: `-${depth.toFixed(2)}` })
  dims.push({ axis: "y", at: round2(outR + 0.6), points: [0, round2(-depth)] })
  dims.push({ axis: "x", at: round2(-depth - FLOOR_T - 0.6), points: [round2(inL), round2(inR)] })

  const finish = effectivePoolFinish(pool)
  const notes = [
    `${pool.name} â€” ${innerW.toFixed(1)} m Ã— kedalaman ${depth.toFixed(2)} m`,
    `Beton bertulang K-300, dinding & lantai t=${Math.round(WALL_T * 100)} cm`,
    "Waterproofing integral + coating semen 2 lapis",
    `Lantai kerja t=${Math.round(LEAN_T * 100)} cm`,
    `Finishing: ${FINISH_LABEL[finish] ?? finish} (${POOL_FINISHES[finish].water})`,
    `Coping batu ${Math.round(COPING_W * 100)} cm, muka air -${Math.round(WATER_DROP * 100)} cm`,
  ]
  notes.forEach((text, i) => {
    labels.push({
      x: round2(outL), y: round2(0.6 + (notes.length - i) * 0.45),
      text, kind: "room", refId, anchor: "start",
    })
  })
}
```

- [x] **Step 3: Verifikasi**

Run: `rtk vitest run src/lib/drawings/pool-detail.test.ts` â†’ PASS.

- [x] **Step 4: Registrasi + test**

Di `sheet-list.ts`, TEPAT SETELAH entri `"pool-piping"` (Task 5), tambahkan dengan pola kondisional yang sama:

```ts
    ...(layout.rooms.some((r) => r.type === "kolam")
      ? [{
          id: "pool-detail" as const,
          label: "Detail Kolam",
          sheetNo: "P-K2",
          kind: /* SAMA dengan kind entri "riser" */,
          build: (l: DesignLayout) => buildPoolDetail(l),
        }]
      : []),
```

Tambahkan assertion di test sheet-list yang sudah dibuat Task 5:

```ts
  expect(entries.some((e) => e.id === "pool-detail" && e.sheetNo === "P-K2")).toBe(true)
```

Run: `rtk vitest run src/lib/drawings/sheet-list.test.ts` â†’ PASS.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/drawings/pool-detail.ts src/lib/drawings/pool-detail.test.ts src/lib/drawings/sheet-list.ts src/lib/drawings/sheet-list.test.ts
rtk git commit -m "feat(pool): sheet Detail Kolam (P-K2) â€” potongan konstruksi + spesifikasi

Dinding/lantai beton 20 cm, lantai kerja, muka air -8 cm, coping, level
Â±0.00/-kedalaman, dim chain, catatan K-300/waterproofing/finishing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Gerbang penuh + status dokumen

- [x] **Step 1: Full gates**

```bash
rtk tsc --noEmit
rtk lint
rtk vitest run
rtk playwright test e2e/drawings.spec.ts e2e/critical-flows.spec.ts --project=chromium
rtk next build
```

Expected: semua hijau. `drawings.spec` menyentuh halaman gambar kerja â€” bila ia meng-assert daftar tab sheet, sesuaikan HANYA bila fixture-nya memuat kolam.

- [x] **Step 2: Update status dokumen investigasi**

Di `docs/superpowers/plans/2026-07-15-tangga-kolam-investigasi-lapangan.md`, ubah baris `**Status:**` menjadi:

```
**Status:** Gelombang 1 selesai <tanggal> (TG-1, TG-3, TG-4-interior, KL-1, KL-3 â€” lihat 2026-07-15-tangga-kolam-gelombang1-plan.md); Gelombang 2/3 belum
```

- [x] **Step 3: Commit + push**

```bash
rtk git add docs/superpowers/plans/
rtk git commit -m "docs(plans): tandai Gelombang 1 tangga & kolam selesai

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
rtk git push origin main
```

---

## Self-review notes (sudah dijalankan penulis plan)

- Cakupan vs investigasi Gelombang 1: TG-1 (Task 2), TG-3 (Task 3), TG-4-interior (Task 4; basis eksterior DITUNDA â€” lihat Global Constraints), KL-1 (Task 5), KL-3 (Task 6). âœ“
- Konsistensi tipe: `InteriorStairSpec` didefinisikan Task 1, dipakai Task 2-4 dengan nama field sama; `buildPoolPiping`/`buildPoolDetail` sesuai kontrak `Drawing` types.ts. âœ“
- Angka test dihitung tangan: 3.15/0.18=17.5â†’18; 0.54/0.18=3; slope âˆš(2.7Â²+0.54Â²). âœ“
- Risiko yang disengaja dan diberi pagar: nama field `poolElectrical` diverifikasi engineer di Step Task 5 (instruksi eksplisit baca file, jangan ubah); nilai `kind` sheet mengikuti entri "riser" (instruksi eksplisit, tanpa mengarang union baru).
