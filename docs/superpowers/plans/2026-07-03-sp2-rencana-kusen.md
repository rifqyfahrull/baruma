# SP2 — Rencana Kusen + Detail Pintu/Jendela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Kusen deliverables dari `layout.openings`: penomoran tipe P/J, sheet Rencana Kusen per lantai, Daftar Kusen, Detail Kusen parametrik, PDF, dan baris RAB per tipe — e2e-gated.

**Architecture:** Modul pure baru di `src/lib/drawings/` (schedule/plan/table/detail → `Drawing`), dirender oleh `SheetSvg`/`buildDrawingsPdf` yang SUDAH ADA (paritas via `sheetPlacement`). Halaman Gambar Kerja beralih ke daftar sheet dinamis. `generateRAB` mengganti baris generik "Kusen, pintu & jendela" dengan baris per tipe (summary otomatis ikut karena dijumlah dari items).

**Tech Stack:** sama SP1. Gate: `rtk tsc` · `npx vitest run` · `npx next build` · `pnpm exec playwright test` (FULL).

## Global Constraints

- Spec: [2026-07-03-sp2-rencana-kusen-design.md](../specs/2026-07-03-sp2-rencana-kusen-design.md). Reuse WAJIB: `Drawing`/`types.ts`, `openingSegment` (positionM=CENTER), `WINDOW_SILL_M`/`DRAW_SLAB_M` dari `./elevation`, `sheetPlacement`/`SheetSvg`/`buildDrawingsPdf`, testid pola `sheet-tab-<id>`/`sheet-svg`.
- **Kode tipe:** grup by `(type, widthM, heightM)`; pintu `P1..` (lebar desc, tinggi desc, tie-break heightM desc lalu widthM desc — DETERMINISTIK), jendela `J1..`. `round2` pada dims saat grouping key (`${type}:${round2(w)}x${round2(h)}`).
- **Harga kusen (per unit, IDR)** — modul `kusenPrice(openingType, widthM, heightM, finishing)`: `base = door ? {standar:850_000, menengah:1_400_000, premium:2_400_000} : {standar:450_000, menengah:750_000, premium:1_300_000}`; `price = round1k(base[finishing] * (0.6 + 0.4 * areaDaun))` dengan `areaDaun = widthM*heightM` (m²) — sederhana, monoton terhadap ukuran.
- Bahasa UI. Tanpa migrasi DB/dep baru.

---

## File Structure

- Create `src/lib/drawings/kusen.ts` + `kusen.test.ts` — `KusenType`, `kusenSchedule`, `kusenCodeByOpeningId`, `kusenPrice`.
- Create `src/lib/drawings/kusen-plan.ts` + test — `buildKusenPlan(layout, floorId)`.
- Create `src/lib/drawings/kusen-sheets.ts` + test — `buildKusenScheduleDrawing(layout)`, `buildKusenDetails(layout): Drawing[]`.
- Modify `src/app/app/projects/[projectId]/drawings/page.tsx` — daftar sheet dinamis.
- Modify `src/lib/exports/drawings-pack.ts` (+test) — `defaultSheets` += kusen sheets.
- Modify `src/lib/mock/rab.ts` (+test `src/lib/mock/rab.test.ts` atau file test existing rab) — baris kusen per tipe.
- Modify/extend `e2e/drawings.spec.ts`.

---

## Task 1: `kusen.ts` — schedule, kode, harga (pure, TDD)

**Files:** Create `src/lib/drawings/kusen.ts`, `src/lib/drawings/kusen.test.ts`.

**Interfaces (produces):** per spec —
```ts
export type KusenType = { code: string; openingType: "door"|"window"; widthM: number; heightM: number; count: number; perFloor: Record<string, number>; openingIds: string[] }
export function kusenSchedule(layout: DesignLayout): KusenType[]
export function kusenCodeByOpeningId(layout: DesignLayout): Map<string, string>
export function kusenPrice(openingType: "door"|"window", widthM: number, heightM: number, finishing: FinishingLevel): number
```

- [ ] **Step 1 (RED):** test — fixture layout 2 lantai: lantai1 2 pintu 0.9×2.1 + 1 pintu 0.8×2.1 + 1 jendela 1.2×1.2; lantai2 1 pintu 0.9×2.1 + 1 jendela 1.2×1.2 + 1 jendela 0.6×0.6. Assert:
  - `kusenSchedule` → 4 tipe: `P1`=0.9×2.1 count 3 (perFloor {f1:2,f2:1}), `P2`=0.8×2.1 count 1, `J1`=1.2×1.2 count 2, `J2`=0.6×0.6 count 1 (pintu duluan, urut lebar desc; jendela setelahnya).
  - `kusenCodeByOpeningId` memetakan setiap opening id ke kodenya.
  - `kusenPrice("door",0.9,2.1,"menengah")` = `round1k(1_400_000*(0.6+0.4*1.89))` = 1_898_000; `kusenPrice("window",1.2,1.2,"standar")` = `round1k(450_000*(0.6+0.4*1.44))` = 529_000. (round1k = pembulatan ke 1.000 — samakan dgn util yang ada atau lokal.)
- [ ] **Step 2:** run → FAIL. **Step 3:** implement per Global Constraints (grouping key round2, sort deterministik, kode P/J berurut). **Step 4:** run → PASS + `rtk tsc`. **Step 5:** commit `feat(drawings): kusen schedule + penomoran tipe + harga parametrik` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Task 2: `buildKusenPlan(layout, floorId)` (pure, TDD)

**Files:** Create `src/lib/drawings/kusen-plan.ts` + `kusen-plan.test.ts`.

- [ ] **Step 1 (RED):** test — fixture T1: untuk f1, Drawing berisi: rect outline tiap ruang (4 garis `outline` per ruang, koordinat = x/y/width/depth denah, y-up: gunakan y denah langsung sebagai y gambar — plan view, TIDAK dibalik; renderer sudah flip); segmen bukaan `kind:"opening"` di posisi `openingSegment`; `DrawLabel` kode kusen (`P1` dst via `kusenCodeByOpeningId`) di titik tengah segmen bukaan (offset 0.25 ke dalam ruang); dim chain x (`at: -0.8`) & y (`at: -0.8`) berisi batas-batas ruang; `title: "Rencana Kusen — Lantai 1"`; `widthM/heightM` = bounding ruang lantai itu.
- [ ] **Step 2-5:** RED→GREEN→tsc→commit `feat(drawings): rencana kusen per lantai (denah berlabel kode)` + trailer.

---

## Task 3: Daftar Kusen (tabel) + Detail Kusen (pure, TDD)

**Files:** Create `src/lib/drawings/kusen-sheets.ts` + `kusen-sheets.test.ts`.

- [ ] **Step 1 (RED):** test —
  - `buildKusenScheduleDrawing(layout)`: header 6 kolom (Kode/Jenis/Lebar/Tinggi/Jumlah/Per Lantai) sebagai `DrawLabel kind:"title"`, satu baris label per KusenType (teks sel: kode, "Pintu"/"Jendela", `formatLength(w,"mm")`… pakai meter 2 desimal `"0,9 m"`? — GUNAKAN `formatLength(w, "mm")` konsisten gambar kerja), grid garis `outline` (kolom+baris; assert jumlah garis = (rows+1) horizontal + (cols+1) vertical); title "Daftar Kusen".
  - `buildKusenDetails(layout)`: 1 panel per tipe — frame rect ganda (outer w×h + inner offset 0.05), pintu: garis diagonal daun + busur swing ≈ polyline `opening` (boleh disederhanakan: diagonal + seperempat busur 8 segmen), jendela: silang + garis sill di y=0 label `sill 900`; dim chain w & h per panel; label kode+ukuran; ≤6 panel/sheet → fixture 4 tipe = 1 Drawing; buat fixture 7 tipe → 2 Drawings (title "(1/2)","(2/2)").
- [ ] **Step 2-5:** RED→GREEN→tsc→commit `feat(drawings): daftar kusen + detail kusen parametrik` + trailer.

---

## Task 4: Halaman Gambar Kerja — sheet dinamis

**Files:** Modify `src/app/app/projects/[projectId]/drawings/page.tsx`.

- [ ] **Step 1:** Refactor `SHEETS` statis → builder `sheetList(layout)` yang menghasilkan `{ id, label, sheetNo, build(layout, cuts) }[]`: 4 tampak (A-01..A-04), 2 potongan (A-05..A-06), lalu `kusen-<floorId>` "Rencana Kusen <nama>" (K-01..), `kusen-daftar` "Daftar Kusen", `kusen-detail-<i>` "Detail Kusen (i/n)". Testid tetap `sheet-tab-<id>`; slider potongan hanya utk secA/secB (existing). Default sheet tetap "s".
- [ ] **Step 2:** `rtk tsc` + `npx next build`; smoke inspeksi.
- [ ] **Step 3:** commit `feat(drawings): sheet dinamis — kusen masuk Gambar Kerja` + trailer.

---

## Task 5: PDF + RAB

**Files:** Modify `src/lib/exports/drawings-pack.ts` (+`drawings-pack.test.ts`), `src/lib/mock/rab.ts` (+ test di file test rab existing atau baru `src/lib/mock/rab.test.ts`).

- [ ] **Step 1 (RED):** test — `defaultSheets(layout)` kini = 6 + (jumlah lantai reguler) + 1 + ceil(tipe/6) entri, urutan & judul benar (fixture T1: 6+2+1+1=10). RAB: `generateRAB(...)` TIDAK lagi memuat item `"Kusen, pintu & jendela"`; memuat 1 baris per KusenType `item: "Kusen P1 — Pintu 0,9×2,1 m"` (format `formatNumber` 2 desimal koma), `volume=count`, `unit:"unit"`, `unitPriceIDR = kusenPrice(...)`, `totalIDR = unitPrice*count` (round1k); summary tetap = Σ items (otomatis).
- [ ] **Step 2:** implement — `defaultSheets` extend; `rab.ts`: hapus Spec generik kusen (baris ~108-115), push Spec per tipe (import `kusenSchedule`, `kusenPrice` dari `@/lib/drawings/kusen`; `total = price*count`, `confidence:"high"` karena dari data nyata, `notes` opsional). Perhatikan: `toItem` menghitung unitPrice dari total/volume — cocok.
- [ ] **Step 3:** `npx vitest run` (semua) + `rtk tsc` + `npx next build`. **Step 4:** commit `feat(exports+rab): kusen sheets di PDF + baris RAB per tipe kusen` + trailer.

---

## Task 6: E2E

**Files:** Modify `e2e/drawings.spec.ts` (tambah 1-2 test; JANGAN ubah 3 test existing kecuali selector berubah karena sheet dinamis — verifikasi tetap hijau).

- [ ] **Step 1:** test baru: (a) buka Gambar Kerja → klik `sheet-tab-kusen-daftar` → `sheet-svg` memuat teks "Daftar Kusen" + regex `/P1/` + `/J1/`; (b) klik tab `sheet-tab-kusen-<floorId pertama>`… id dinamis — beri tab kusen pertama testid stabil ATAU pakai `getByRole("button", { name: /Rencana Kusen/ }).first()`; assert svg berisi ≥1 label kode (teks P1). Juga assert jumlah tab sheet > 8 (dinamis).
- [ ] **Step 2:** `pnpm exec playwright test e2e/drawings.spec.ts` → hijau (5 test). **Step 3:** commit `test(e2e): kusen sheets — daftar + rencana berlabel kode` + trailer.

---

## Task 7: Full gate

- [ ] `rtk tsc` · `npx vitest run` · `npx next build` · `pnpm exec playwright test` (FULL, semua spec) → hijau. Manual: PDF berisi sheet kusen; RAB page menampilkan baris Kusen P1/J1.

---

## Self-Review

**Coverage:** schedule/kode/harga (T1) · rencana per lantai (T2) · daftar+detail (T3) · halaman dinamis (T4) · PDF+RAB (T5) · e2e (T6) · gate (T7) — semua bagian spec terpetakan. ✓
**Placeholders:** tidak ada; angka harga & contoh perhitungan eksplisit; format sel dipatok (`formatLength(w,"mm")` di tabel; label RAB pakai meter format koma — konsisten per test masing-masing).
**Konsistensi:** `KusenType`/`kusenSchedule`/`kusenCodeByOpeningId`/`kusenPrice` T1 ↔ T2/T3/T5; `sheetList` T4 ↔ testid e2e T6; `defaultSheets` T5 ↔ PDF existing.
**Catatan:** T4 mengubah struktur SHEETS — pastikan 3 e2e existing tetap lolos (id `n/s/e/w/secA/secB` TIDAK berubah). T5 rab.ts: summary dihitung dari items (baris 234-247) — tak perlu rekonsiliasi manual.
