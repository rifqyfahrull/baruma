# SP1 — Gambar Tampak & Potongan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Auto-generate 4 elevation views (tampak U/S/T/B) + axis-cut sections (potongan) from `DesignLayout`, rendered as dimensioned A3 sheets on a new "Gambar Kerja" page, exportable to PDF — fully unit + **E2E** tested.

**Architecture:** Pure projection modules (`src/lib/drawings/`) turn the layout into renderer-agnostic `Drawing` data (lines/labels/dims/levels). A reusable `SheetSvg` component renders any `Drawing` on a virtual A3 sheet (title block + auto architect scale). The `/drawings` page lists 6 sheets and hosts the section-cut slider; `drawings_pack` joins the existing exports pipeline. Playwright E2E covers the page + export.

**Tech Stack:** Next.js 16 · SVG · jsPDF (existing) · vitest (pure) · Playwright (E2E, existing setup: dev server :3100 + demo login).

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-03-sp1-tampak-potongan-design.md](../specs/2026-07-03-sp1-tampak-potongan-design.md); bagian dari [master roadmap](../specs/2026-07-03-master-roadmap-dokumen-kerja.md).
- **Gate "tested" mulai SP1: `rtk tsc` 0 · `npx vitest run` hijau · `npx next build` sukses · `pnpm exec playwright test` hijau** (e2e pakai mock+demo login, server :3100 otomatis via playwright webServer).
- No DB migration, no new npm deps. Bahasa UI. Drawing coords dalam meter (y ke ATAS); renderer yang membalik untuk SVG.
- Konstanta: `WINDOW_SILL_M = 0.9`, `DRAW_SLAB_M = 0.15`, kertas A3 landscape 420×297 mm, margin 15 mm, area title block tinggi 22 mm, skala kandidat `[50, 100, 200, 500]`.
- **Konvensi proyeksi (pinned by tests):** horizontal `h` per sisi — `s`: `h=x` · `n`: `h=totalW−x` (mirror) · `w`: `h=y` · `e`: `h=totalD−y`. Potongan `axis:"x"` (bidang ⊥ sumbu-x di `positionM`): `h=y`; `axis:"y"`: `h=x`.
- Occlusion tampak (v1, valid karena ruang tak pernah overlap): bukaan di dinding sisi V terlihat bila TIDAK ada ruang lain se-lantai yang meng-overlap span-h bukaan dan berada di depan (untuk `s`: `o.y ≥ r.y+r.depth−0.05`; mirror utk sisi lain).
- `positionM` bukaan: **ikuti interpretasi render 3D** — baca penempatan opening di `build-model.ts` (±baris 180–200) dan samakan persis (n/s diukur dari `room.x`, w/e dari `room.y` — verifikasi di kode).

---

## File Structure

- Create `src/lib/drawings/types.ts` — kontrak `Drawing`/`DrawLine`/`DrawLabel`/`DimChain`/`LevelMark`.
- Create `src/lib/drawings/elevation.ts` + `elevation.test.ts` — `buildElevation`.
- Create `src/lib/drawings/section.ts` + `section.test.ts` — `buildSection`.
- Create `src/lib/drawings/scale.ts` + `scale.test.ts` — `pickSheetScale`.
- Modify `src/lib/three/build-model.ts` — export `OPEN_TYPES` (satu kata `export`, dipakai elevation).
- Create `src/components/drawings/sheet-svg.tsx` — renderer sheet A3.
- Create `src/app/app/projects/[projectId]/drawings/page.tsx` — hub Gambar Kerja.
- Modify navigasi projek (layout/tab bar projek — cari komponen nav yang memuat link "Editor"/"Preview 3D") — tambah "Gambar Kerja".
- Create `src/lib/exports/drawings-pack.ts`; Modify `src/types/index.ts` (`ExportFormat` + `"drawings_pack"`), `src/lib/exports/generate.ts`, halaman exports (`ORDER` + copy) — format baru.
- Create `e2e/drawings.spec.ts`.

---

## Task 1: Kontrak data + `buildElevation` (pure, TDD)

**Files:** Create `src/lib/drawings/types.ts`, `src/lib/drawings/elevation.ts`, Test `src/lib/drawings/elevation.test.ts`; Modify `src/lib/three/build-model.ts` (export `OPEN_TYPES`).

**Interfaces (produces):**
```ts
// types.ts
export type DrawLine = { x1: number; y1: number; x2: number; y2: number; kind: "outline" | "slab" | "opening" | "ground" | "cut" }
export type DrawLabel = { x: number; y: number; text: string; kind: "room" | "level" | "title" }
export type DimChain = { axis: "x" | "y"; at: number; points: number[] }
export type LevelMark = { y: number; label: string }
export type Drawing = { widthM: number; heightM: number; lines: DrawLine[]; labels: DrawLabel[]; dims: DimChain[]; levels: LevelMark[]; title: string }
// elevation.ts
export type ElevationSide = "n" | "s" | "e" | "w"
export function buildElevation(layout: DesignLayout, side: ElevationSide): Drawing
```

- [ ] **Step 1: Write the failing test** — `src/lib/drawings/elevation.test.ts`. Fixture: 2 lantai (heightM 3 & 3), lantai 1 ruang A `{x:0,y:0,w:4,d:3}` + ruang B `{x:4,y:0,w:3,d:3}` (menempel), lantai 2 ruang C `{x:0,y:0,w:4,d:3}`; jendela di dinding `s` ruang A (`positionM:1, widthM:1.2, heightM:1.2`), pintu di dinding `s` ruang B (`positionM:0.5, widthM:0.9, heightM:2.1`); satu ruang carport `{x:0,y:3,w:3,d:3}` (OPEN — tanpa dinding) di DEPAN ruang A sisi s… **catatan:** carport TIDAK meng-occlude (OPEN_TYPES tak menyumbang siluet/occlusion). Assert:
  - `title` = "Tampak Selatan" untuk `side:"s"` (mapping judul: n=Utara, s=Selatan, e=Timur, w=Barat).
  - Siluet: `widthM` gambar = 7 (union interval x [0,7]); ada garis outline vertikal di h=0 dan h=7 dari 0 s.d. 6 (2×3 m), garis atap (slab) di y=6.
  - Jendela A muncul sebagai 4 garis `kind:"opening"` membentuk rect `h∈[1,2.2]`, `y∈[0.9,2.1]` (sill 0.9); pintu B rect `h∈[4.5,5.4]`, `y∈[0,2.1]`.
  - `levels`: marker `y=0` label `±0 m` dan `y=3` label `+3 m` (pakai `formatElevation(y, "m")`).
  - Tampak `n` (mirror): jendela A muncul di `h∈[7−2.2, 7−1]` **hanya jika ruangnya eksterior sisi n** — di fixture ini dinding n ruang A menghadap carport (OPEN, bukan ruang penghalang) → tetap tampil; assert mirror-nya benar.
  - Occlusion: tambah ruang D solid `{x:0,y:3,w:4,d:2}` pada varian fixture → jendela A sisi `s` TIDAK muncul (terhalang D).
  - Split-level: beri ruang B `levelOffsetM:-0.18` → ada garis slab tambahan di `y=−0.18` sepanjang `h∈[4,7]`.
- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/drawings/elevation.test.ts`.
- [ ] **Step 3: Implement.**
  - `build-model.ts`: ubah `const OPEN_TYPES` → `export const OPEN_TYPES` (tanpa perubahan lain).
  - `types.ts` sesuai kontrak di atas.
  - `elevation.ts` — algoritme:
    1. Lantai reguler = `layout.floors` tanpa `floor-rooftop`, urut `level`; `baseY[i] = Σ heightM sebelumnya`; totalW/totalD dari bounding rooms (max x+width / y+depth semua ruang non-rooftop).
    2. Proyeksi `h` per Global Constraints (helper `toH(side, x, y, totalW, totalD)` — untuk n/s pakai x, w/e pakai y).
    3. **Siluet per lantai:** interval `[hStart,hEnd]` tiap ruang non-OPEN di lantai itu (setelah proyeksi), union (sort+merge, toleransi 0.05) → untuk tiap blok union: 2 garis vertikal `outline` (`y∈[baseY, baseY+heightM]`) + garis horizontal atas/bawah; slab band: garis `slab` di `y=baseY` (i>0) dan atap `y=baseY_top+heightM_top` (+garis kedua di +`DRAW_SLAB_M`).
    4. **Rooftop:** jika ada `floor-rooftop` + ruang non-OPEN di dalamnya → blok tambahan di atas atap (baseY = puncak atap) setinggi `heightM` rooftop.
    5. **Bukaan:** untuk tiap opening, parse `wallId="roomId:side"`; tampil bila `side === view` DAN ruang non-OPEN DAN tak ter-occlude (Global Constraints; cek span-h bukaan terhadap ruang solid se-lantai yang lebih dekat viewer). Rect 4 garis `kind:"opening"`: `h ∈ toH(...)` dari `room.x+positionM` (atau `room.y+positionM` utk w/e — ikuti build-model) selebar `widthM`; `y ∈ [baseY+off+sill, …+heightM_opening]`, sill = 0 (door) / `WINDOW_SILL_M` (window), `off = room.levelOffsetM ?? 0`.
    6. **Split-level:** ruang non-OPEN dengan `levelOffsetM≠0` → garis `slab` di `y=baseY+offset` sepanjang interval-h ruang itu.
    7. `ground`: garis `y=0` dari `−0.5` s.d. `width+0.5`. `dims`: satu `DimChain {axis:"x", at:−0.8, points:[batas-batas blok union + tepi bukaan]}` (unik+sort). `levels`: tiap `baseY` + puncak atap, label `formatElevation(baseY, "m")`.
  - Semua angka `round2`.
- [ ] **Step 4: Run → PASS** + `rtk tsc`.
- [ ] **Step 5: Commit** — `feat(drawings): Drawing contract + buildElevation (4 tampak)` (+ trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

## Task 2: `buildSection` (pure, TDD)

**Files:** Create `src/lib/drawings/section.ts`, Test `src/lib/drawings/section.test.ts`.

**Interfaces:** `export function buildSection(layout: DesignLayout, cut: { axis: "x" | "y"; positionM: number }): Drawing` (judul: `Potongan A-A` utk axis "x", `Potongan B-B` utk "y").

- [ ] **Step 1: Write the failing test.** Fixture Task 1 (2 lantai). Cut `{axis:"x", positionM:2}` (menembus ruang A & C, TIDAK menembus B yang di x∈[4,7]):
  - Ruang A & C terpotong: garis `cut` vertikal di `h=0` dan `h=3` (y-bounds A) per lantai; label ruang "A"/"C" (`kind:"room"`) di tengah void.
  - B TIDAK muncul (tak ada garis di h∈[4,7]… B y-nya [0,3] juga → pastikan uji pakai ruang B di y berbeda ATAU assert label B absen).
  - Slab: garis `slab` di `y=0`, `y=3` (antar lantai), `y=6` (atap).
  - Bukaan terpotong: pintu di dinding `s` ruang A dengan `positionM` sehingga span-x memuat 2 (mis. positionM 1.5, width 0.9 → x∈[1.5,2.4] ∋ 2) → pada garis cut `h=3` (dinding s ruang A) muncul rect `opening` `y∈[0,2.1]`.
  - Split-level `levelOffsetM` menggeser slab dasar ruang itu (assert satu kasus −0.18).
  - `levels` sama seperti tampak; `dims`: chain vertikal (`axis:"y", at:−0.8, points:[0,3,6]`) + chain horizontal batas ruang terpotong.
  - Cut `{axis:"y", positionM:…}`: `h=x`; assert satu kasus (ruang A & B keduanya terpotong bila y-cut menembus keduanya).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — per lantai: ruang ter-cut = `room.x ≤ pos ≤ room.x+width` (axis x; analog utk y). Utk tiap ruang ter-cut non-OPEN: 2 garis `cut` vertikal di h-bounds (tebal digambar renderer via kind), `y∈[baseY+off, baseY+heightM]`; slab garis bawah/atas sepanjang h-bounds; label nama ruang di tengah. Bukaan pada dinding yang BERPOTONGAN dgn bidang (utk axis x: dinding n/s ruang itu, span-x memuat pos) → rect `opening` pada garis h dinding ybs (`y∈[baseY+off+sill, +h_opening]`). OPEN rooms: slab saja tanpa dinding. Dims/levels per test.
- [ ] **Step 4: Run → PASS** + `rtk tsc`.
- [ ] **Step 5: Commit** — `feat(drawings): buildSection (potongan sumbu-x/y)` (+ trailer).

---

## Task 3: `pickSheetScale` + `SheetSvg`

**Files:** Create `src/lib/drawings/scale.ts` + `scale.test.ts`, `src/components/drawings/sheet-svg.tsx`.

**Interfaces:** `pickSheetScale(wM: number, hM: number): number` (denominator); `<SheetSvg drawing={Drawing} sheetNo="A-01" projectName="..." />`.

- [ ] **Step 1: Test scale (TDD):**
```ts
import { pickSheetScale } from "./scale"
it("picks the smallest architect scale that fits A3", () => {
  expect(pickSheetScale(7, 6)).toBe(50)    // 7m→140mm ≤ 380, 6m→120 ≤ 238
  expect(pickSheetScale(25, 9)).toBe(100)  // 25m→250 ≤ 380 @1:100
  expect(pickSheetScale(60, 20)).toBe(200)
  expect(pickSheetScale(500, 500)).toBe(500) // fallback terbesar
})
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `scale.ts`: avail `w=420−30`, `h=297−30−22` (margin 15×2, title block 22); return skala pertama dari `[50,100,200,500]` yang memuat (`wM*1000/N ≤ availW && hM*1000/N ≤ availH`), else 500. `sheet-svg.tsx`: SVG `viewBox="0 0 420 297"`, border + margin, title block kanan-bawah (projectName, `drawing.title`, `Skala 1:${N}`, sheetNo, tanggal `new Date().toLocaleDateString("id-ID")`), transform gambar: origin tengah area, `xMm = ofsX + hM*1000/N`, `yMm = ofsY − yM*1000/N` (flip y). Render `lines` per `kind` (outline 0.5, cut 1.0, slab 0.35, opening 0.35, ground 0.7 + strokeDasharray utk slab), `labels` (font 3mm; `level` rata-kiri di marker), `dims` (garis + tick + teks `formatLength(delta, "mm")` antar titik, seperti dimension-layer), `levels` (garis pendek + label kiri). Semua stroke `className="stroke-foreground"` / theme-aware, `data-testid="sheet-svg"`.
- [ ] **Step 4: Run scale test → PASS**; `rtk tsc`.
- [ ] **Step 5: Commit** — `feat(drawings): A3 SheetSvg renderer + architect scale picker` (+ trailer).

---

## Task 4: Halaman `/drawings` + navigasi

**Files:** Create `src/app/app/projects/[projectId]/drawings/page.tsx`; Modify nav projek (temukan via grep komponen yang me-render link "Preview 3D"/"Editor" — kemungkinan `src/app/app/projects/[projectId]/layout.tsx` atau komponen nav bersama) — tambah tab "Gambar Kerja".

- [ ] **Step 1: Page.** Client page pola `/preview-3d/page.tsx`: `useProject` + `useLayout(projectId, { fresh: true })` + `pickEffectiveLayout` (draft live). State: `sheet` (`"n"|"s"|"e"|"w"|"secA"|"secB"`), `cutX`/`cutY` (default tengah bangunan). Sidebar tombol 6 sheet (Tampak Utara/Selatan/Timur/Barat, Potongan A-A, Potongan B-B) `data-testid="sheet-tab-<id>"`; viewer `<SheetSvg>` dengan `useMemo(() => buildElevation/buildSection(...))`; untuk potongan tampilkan slider `<input type="range" data-testid="cut-slider">` (min 0, max lebar/kedalaman bangunan, step 0.1) + mini-denah SVG sederhana (rect per ruang + garis potong merah). Empty state bila layout null (pola preview-3d).
- [ ] **Step 2: Nav.** Grep `Preview 3D` di `src/app/app/projects` & `src/components` → tambahkan link "Gambar Kerja" → `/app/projects/${id}/drawings` di tempat yang sama (ikut pola item lain, ikon `Ruler` lucide).
- [ ] **Step 3: Verify** — `rtk tsc` + `npx next build` (route baru muncul). Manual: buka halaman, 6 sheet tampil, slider menggeser garis potong & gambar berubah.
- [ ] **Step 4: Commit** — `feat(drawings): halaman Gambar Kerja (4 tampak + 2 potongan, cut slider)` (+ trailer).

---

## Task 5: Export PDF `drawings_pack`

**Files:** Create `src/lib/exports/drawings-pack.ts`; Modify `src/types/index.ts:646` (union + `"drawings_pack"`), `src/lib/exports/generate.ts` (dispatch), halaman exports `ORDER` + label/copy (grep `contractor_pack` untuk SEMUA tempat registrasi format: types, ORDER, COPY/label map, generate switch — ikuti persis pola `contractor_pack`).

- [ ] **Step 1: Builder.** `buildDrawingsPdf(project: Project, layout: DesignLayout): Promise<Blob>` — jsPDF A3 landscape (`format: "a3", orientation: "landscape"`); untuk 6 drawing default (4 tampak + potongan tengah x & y): render TANPA DOM — gambar ulang primitif `Drawing` langsung ke jsPDF (`doc.line/rect/text`) dengan transform mm yang sama dengan SheetSvg (faktorkan transform+scale ke helper bersama di `src/lib/drawings/layout-sheet.ts`: `sheetPlacement(drawing) → {scaleN, toMm(x,y)}` — dipakai SVG & PDF agar identik); title block digambar manual (pola contractor-pack). Satu halaman per sheet.
- [ ] **Step 2: Registrasi format** — tiru `contractor_pack` di semua titik yang ditemukan grep; label: "Gambar Kerja (PDF)" deskripsi "4 tampak + 2 potongan berdimensi".
- [ ] **Step 3: Unit test kecil** — `sheetPlacement` (skala terpilih & mapping mm) di `src/lib/drawings/layout-sheet.test.ts` (2-3 assert).
- [ ] **Step 4: Verify** — `rtk tsc`, `npx vitest run`, `npx next build`. Manual: exports page → kartu baru → download PDF 6 halaman.
- [ ] **Step 5: Commit** — `feat(exports): drawings_pack PDF (tampak & potongan)` (+ trailer).

---

## Task 6: E2E Playwright

**Files:** Create `e2e/drawings.spec.ts`.

- [ ] **Step 1: Baca konvensi** — buka `e2e/critical-flows.spec.ts` (navigasi projek demo) dan `e2e/interior-drag.spec.ts` (interaksi); ikuti pola mereka (storageState sudah otomatis; ambil projek pertama dari dashboard atau URL langsung projek demo mock).
- [ ] **Step 2: Spec** — skenario:
```ts
test("Gambar Kerja: 6 sheet tampil dan bisa dinavigasi", async ({ page }) => {
  // buka projek demo (pola critical-flows) → klik nav "Gambar Kerja"
  // assert: 6 tombol sheet; sheet aktif default merender <svg data-testid="sheet-svg">
  // dengan >10 elemen line dan teks title block "Tampak" + "Skala 1:"
})
test("Potongan: slider menggeser garis potong dan mengubah gambar", async ({ page }) => {
  // klik sheet-tab-secA → hitung jumlah line svg → geser cut-slider (fill ke nilai lain)
  // → assert jumlah/posisi line berubah ATAU atribut x1 garis cut mini-denah berubah
})
test("Export drawings_pack menghasilkan unduhan PDF", async ({ page }) => {
  // buka /exports → klik kartu "Gambar Kerja (PDF)" (button unduh)
  // const dl = await page.waitForEvent("download") → expect(dl.suggestedFilename()).toMatch(/\.pdf$/)
})
```
  Lengkapi selector dari implementasi nyata (testid yang dibuat Task 4/5). JANGAN tautologis — assert konten nyata (jumlah line > 10, teks skala, perubahan setelah slider).
- [ ] **Step 3: Run** — `pnpm exec playwright test e2e/drawings.spec.ts` → hijau (server :3100 otomatis).
- [ ] **Step 4: Commit** — `test(e2e): gambar kerja — sheets, cut slider, PDF export` (+ trailer).

---

## Task 7: Full verification (gate baru)

- [ ] **Step 1:** `rtk tsc` · `npx vitest run` · `npx next build` · **`pnpm exec playwright test`** (SELURUH suite e2e, bukan hanya drawings) → semua hijau.
- [ ] **Step 2: Manual smoke** — projek 2 lantai + jendela/pintu + split-level: 4 tampak benar (mirror n/e, occlusion, sill jendela 0.9), potongan mengikuti slider, PDF 6 halaman berdimensi.
- [ ] **Step 3: Commit sisa perbaikan** (jika ada).

---

## Self-Review

**Spec coverage:** kontrak+elevation (T1) · section (T2) · sheet+skala (T3) · halaman+nav+slider (T4) · PDF+registrasi format (T5) · E2E (T6) · gate (T7). Konvensi proyeksi/occlusion/sill/skala dipatok di Global Constraints & dites. ✓
**Placeholders:** tidak ada — angka, selector, dan algoritme konkret; dua "temukan via grep" disertai cara menemukan + pola yang harus ditiru.
**Type consistency:** `Drawing/DrawLine/DimChain/LevelMark` (T1) dikonsumsi T2/T3/T5; `buildElevation(layout, side)`/`buildSection(layout, cut)` konsisten T1/T2/T4/T5; `pickSheetScale`/`sheetPlacement` T3↔T5; testid `sheet-svg`/`sheet-tab-*`/`cut-slider` T4↔T6.
**Catatan implementer:** T1 wajib menyamakan interpretasi `positionM` dengan build-model (baca dulu); T5 wajib grep semua titik registrasi `contractor_pack` (types/ORDER/label/generate) — jangan ada yang tertinggal; T6 dilarang menulis assertion tautologis.
