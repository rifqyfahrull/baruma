# SP6 — Struktur (SNI) + 3D Realistis (web-PBR) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Langkah pakai checkbox.

**Goal:** Perhitungan struktur SNI disederhanakan (grid kolom + load takedown + dimensi kolom/balok/pondasi dari σ) → sheet + RAB rebasis; + upgrade 3D eksterior ke PBR (shadows + tekstur prosedural + matahari/langit + soft shadow) — e2e-gated.

**Architecture:** BAGIAN A: input `layout.structural.soilBearingKPa` (editable spt `roof`) → pure `lib/structural/{loads,grid,takedown,sizing,foundation}.ts` → drawing builders (pola `sanitation-detail.ts`) → sheet-list → `structuralNotes` + RAB rebasis (footprint bersama) → editor inspector + AI. BAGIAN B: aktifkan Canvas shadows + `directionalLight castShadow` + drei `<Sky>`/`<SoftShadows>` + tekstur prosedural `lib/three/textures.ts` + `MATERIAL_PRESETS` diperluas + toggle Realistis. Nol file bersama antara A & B.

**Tech Stack:** Next.js 16, zustand, zod, Drawing contract (lines-only, y-UP), three ^0.184 + @react-three/fiber ^9 + @react-three/drei ^10 (TANPA dep baru), vitest, Playwright.

## Global Constraints

- Spec: [2026-07-04-sp6-struktur-3d-design.md](../specs/2026-07-04-sp6-struktur-3d-design.md). Reuse: entity-module pattern (SP4/SP5), `Drawing` contract (lines only; label bertumpuk utk tabel — pola `sanitation-detail.ts`), `sheet-list.ts` `SheetListEntry`, gate Playwright FULL. Semua konsumen baca `layout.structural` DEFENSIF (PUT tanpa zod).
- **σ:** `DesignLayout.structural?: { soilBearingKPa: number }`; absen → default `SOIL_DEFAULT_KPA = 150`; clamp UI/sanitize `[50, 400]`.
- **Beban (kPa):** `DL_FLOOR=5.0` · `DL_ROOF=1.5` · `LL_FLOOR=2.0` · `LL_ROOF=1.0`. `wu = 1.2·DL + 1.6·LL`; `ws = DL + LL`. → lantai `wu=9.2, ws=7.0`; atap `wu=3.4, ws=2.5`.
- **Material:** `FC_MPA=25`, `FY_MPA=400`. `roundUp50(x)=Math.ceil(x/50)*50`; `roundUp(x,step)=Math.ceil(x/step)*step`.
- **Grid** (`deriveColumnGrid`): footprint = `buildingFootprint(layout)` (bbox ruang non-rooftop — HELPER BERSAMA, §T8). `MAX_SPAN=4.0`. `nx=Math.ceil(W/MAX_SPAN)+1`, `spanX=round2(W/(nx-1))`; `ny`, `spanY` analog. Kolom di `nx×ny` titik perpotongan (posisi absolut `x=col*spanX`, `y=row*spanY` relatif origin footprint). Contoh 8×6: nx3 spanX4.0, ny3 spanY3.0, 9 kolom.
- **Takedown** (`columnLoad`): tributari = `spanX*spanY` (penuh, konservatif, semua kolom). `floors=project.floors`. Kolom terbawah: `Pu = Atrib*(floors*9.2 + 3.4)`; `Ps = Atrib*(floors*7.0 + 2.5)` kN. Contoh Atrib 12, floors 2: Pu=261.6, Ps=198.
- **Kolom** (`sizeColumn(PuKN)`): `Ag_req = PuKN*1000/(0.33*FC_MPA)` mm²; `side = Math.max(150, roundUp50(Math.sqrt(Ag_req)))`. Contoh Pu 261.6 → Ag 31709 → √=178 → 200 mm.
- **Balok** (`sizeBeam(spanM)`): `h = Math.max(300, roundUp50(spanM*1000/12))`; `b = Math.max(150, roundUp50(h/2))`. Contoh span 4.0 → h350 b200. **Sloof** tetap `150×200`.
- **Pondasi** (`sizeFooting(PsKN, soilKPa)`): `A = PsKN/soilKPa` m²; `side = Math.max(0.8, roundUp(Math.sqrt(A), 0.1))` m; `thickness=0.25`. Rekomendasi: `A > 4 m²` (σ rendah/beban besar) → note "pertimbangkan pondasi dalam (tiang/strauss) — konsultasi ahli". Contoh Ps198 σ150 → A1.32 → side1.2.
- **RAB volume** (m³): pondasi `Σ side²*0.25` (per telapak) `× jumlahKolom`; kolom `Σ (side/1000)²*3.0*jumlahKolom*floors`; balok+sloof `(b/1000)*(h/1000)*totalBeamLenM + 0.15*0.2*sloofLenM`; plat `builtArea*0.12`. **Harga/m³:** pondasi `3_500_000` · kolom `4_500_000` · balok `4_500_000` · plat `3_800_000`. `totalBeamLenM` = Σ garis grid balok = `(ny)*(W) + (nx)*(D)` pendekatan (balok arah-x tiap baris + arah-y tiap kolom-garis); `sloofLenM` = sama (sloof ikut grid).
- **Disclaimer struktur (verbatim, DrawLabel kind "room"):** `"Perhitungan pendekatan — wajib diverifikasi insinyur struktur berlisensi sebelum konstruksi (persyaratan PBG)."`
- **Sheet order:** setelah sanitasi (S-), sebelum `roof-detail` (terakhir): `structural-foundation` F-01, `structural-column-<floorId>` **SK-.. per lantai** (deviasi review T7: prefix "K-" sudah dipakai kusen SP2 → tabrakan nomor cetak; kolom struktur pakai "SK-" Struktur Kolom), `structural-beam-<floorId>` B-.. per lantai, `structural-calc` ST-01. `SheetKind += "structural-plan"|"structural-calc"`.
- **B — tekstur:** `lib/three/textures.ts` — fungsi murni-ish generate `CanvasTexture` (canvas 2D). Nol aset eksternal (drei Environment/HDRI preset DILARANG). Memo per kind. **B — drei:** hanya `<Sky>`, `<SoftShadows>`/`<ContactShadows>` (sudah di drei ^10; TANPA `@react-three/postprocessing`).
- **B — preset:** `MATERIAL_PRESETS` tiap permukaan += `{roughness, metalness, texture?: TextureKind}`.
- Bahasa UI; JSONB (tanpa migrasi); AI parity WAJIB; **a11y aria-label** tiap Select/Input; build gate `npx next build` langsung; jangan chain `rtk vitest`+`npx vitest`; jangan jalankan review-akhir konkuren dgn gate vitest; dev server bersih utk playwright.

---

# BAGIAN A — STRUKTUR

## Task 1: σ input — type + store + editor + AI (TDD)
**Modify** `src/types/index.ts` (`DesignLayout.structural?: { soilBearingKPa: number }`), `src/stores/editor-store.ts` (`setSoilBearing(kPa)` via `commit`, default `SOIL_DEFAULT_KPA=150` saat pertama; export const), `src/components/editor/editor-inspector.tsx` (`StructuralSection` di SummaryInspector: input σ 50–400 kPa + ringkas — pola `RoofInspector`; **aria-label**), `src/lib/assistant/actions.ts` (`{type:"setSoilBearing", soilBearingKPa}` + describe), `src/lib/server/editor-assistant.ts` (sanitize clamp 50–400 + prompt), `src/lib/assistant/apply.ts` (dispatch `store.setSoilBearing`). Tests: store setSoilBearing (merge+undo), sanitize clamp, describe. Commit `feat(editor): input daya dukung tanah (σ) + AI setSoilBearing` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Task 2: `loads.ts` konstanta beban (pure, TDD)
**Create** `src/lib/structural/loads.ts`: konstanta `DL_FLOOR/DL_ROOF/LL_FLOOR/LL_ROOF/FC_MPA/FY_MPA/MAX_SPAN/SOIL_DEFAULT_KPA`, `roundUp50`, `roundUp`, `wu(dl,ll)`, `ws(dl,ll)`, `floorWu()=9.2`, `roofWu()=3.4`, `floorWs()`, `roofWs()`. Tests: nilai eksak (wu lantai 9.2, atap 3.4; roundUp50(178)=200). Commit `feat(structural): konstanta & kombinasi beban SNI` + trailer.

## Task 3: `grid.ts` deriveColumnGrid (pure, TDD)
**Create** `src/lib/structural/grid.ts` + `buildingFootprint(layout): {widthM, depthM, x0, y0}` (bbox ruang non-rooftop). `deriveColumnGrid(layout): { columns: {x,y}[]; spanX; spanY; nx; ny; widthM; depthM }`. Tests: footprint 8×6 → nx3 ny3 spanX4 spanY3 9 kolom di posisi eksak; footprint 12×10 → span ≤4. Commit `feat(structural): grid kolom dari denah (bentang ≤4m)` + trailer.

## Task 4: `takedown.ts` load takedown (pure, TDD)
**Create** `src/lib/structural/takedown.ts`: `columnLoad(spanX, spanY, floors): { Atrib; Pu; Ps }`. Tests: Atrib 12, floors 2 → Pu 261.6, Ps 198; floors 1 analog. Commit `feat(structural): load takedown per kolom` + trailer.

## Task 5: `sizing.ts` + `foundation.ts` (pure, TDD)
**Create** `src/lib/structural/sizing.ts`: `sizeColumn(PuKN): { side }` (mm), `sizeBeam(spanM): { b, h }` (mm), `SLOOF = {b:150,h:200}`. **Create** `src/lib/structural/foundation.ts`: `sizeFooting(PsKN, soilKPa): { side, thickness, area, deepNote?: string }`. Tests: sizeColumn(261.6)→200; sizeBeam(4.0)→{b200,h350}; sizeFooting(198,150)→{side1.2,thickness0.25}; sizeFooting beban besar/σ rendah → deepNote ada. Commit `feat(structural): dimensi kolom/balok + pondasi telapak dari σ` + trailer.

## Task 6: Drawing builders struktur (pure, TDD)
**Create** `src/lib/drawings/structural-plan.ts`: `buildFoundationPlan(layout, project)`, `buildColumnPlan(layout, project, floorId)`, `buildBeamPlan(layout, project, floorId)` → `Drawing` (grid kolom = titik/persegi; telapak persegi berdimensi; balok garis antar kolom; label dimensi + Pu/σ; pakai `deriveColumnGrid`+sizing; `normalize` bila perlu koord ≥0). **Create** `src/lib/drawings/structural-calc.ts`: `buildStructuralCalc(layout, project)` → tabel label bertumpuk (asumsi DL/LL/f'c/fy/σ + langkah Atrib/wu/Pu/Ps/Ag/dimensi + hasil) + **disclaimer verbatim**; title `Perhitungan Struktur`. `project` beri `floors` + `site` (σ dari `layout.structural` default 150). Tests: foundation plan jumlah telapak = jumlah kolom; calc sheet teks memuat "Pu"/"telapak"/"PBG"/disclaimer; column/beam plan label dimensi. Commit `feat(drawings): rencana pondasi/kolom/balok + tabel perhitungan struktur` + trailer.

## Task 7: sheet-list + integrasi halaman/PDF
**Modify** `src/lib/drawings/sheet-list.ts` (`SheetKind += "structural-plan"|"structural-calc"`; F-01 + K-/B- per lantai + ST-01 setelah sanitasi sebelum roof-detail; `build` resolve `project` — cek apakah buildSheetList punya akses project/site; bila tidak, teruskan via param baru `buildSheetList(layout, opts)` ATAU derive σ default + floors dari layout.floors.length; **grep pemanggil** page+PDF, sesuaikan minimal) + tests. Commit `feat(drawings): daftar & PDF sheet struktur` + trailer.

## Task 8: structuralNotes + RAB rebasis + footprint bersama
**Modify** `src/lib/validation.ts` (`structuralNotes` → tambah issue kalkulasi: kolom terbesar, telapak, bentang>4m — pakai grid+takedown+sizing), `src/lib/mock/rab.ts` (ganti 3 baris struktur %-anggaran → 4 baris volume nyata: Pondasi telapak/Kolom beton/Balok & sloof/Plat lantai per rumus Global Constraints; harga/m³ dipatok; **buildingFootprint bersama** dipakai di sini + selaraskan baris atap/soakwell yg kini `site.areaM2` → gunakan footprint bersama utk KONSISTENSI [tuntaskan carry-over]; DOKUMENTASIKAN perubahan total). Tests: structuralNotes kalkulasi; RAB struktur volume eksak (footprint 8×6, floors 2 → jumlah kolom 9, volume pondasi/kolom eksak); footprint bersama konsisten grid↔RAB; summary=Σ; **sesuaikan tes RAB existing yg berubah nilainya** (bukan dilemahkan — nilai baru diverifikasi). Commit `feat(structural+rab): catatan kalkulasi + RAB volume nyata + footprint bersama` + trailer.

---

# BAGIAN B — 3D REALISTIS (web-PBR)

## Task 9: Shadows + matahari + langit + kontrol
**Modify** `src/components/preview-3d/house-scene.tsx` (`<Canvas shadows>`; satu `directionalLight castShadow` sebagai matahari dgn shadow-camera frustum ke bbox; ground `receiveShadow`; drei `<Sky>` sunPosition dari state), `src/stores/preview-store.ts` (state `sunAzimuthDeg`/`sunElevationDeg` + setter + `realistic:boolean` toggle default true; view-state), `src/components/preview-3d/preview-controls.tsx` (slider azimuth/elevasi + toggle "Realistis" — **aria-label**). Sun position drei helper (azimuth/elevasi → vector). Tests: preview-store sun state + toggle. Commit `feat(3d): shadows + matahari/langit + kontrol posisi matahari` + trailer.

## Task 10: `textures.ts` prosedural + preset diperluas
**Create** `src/lib/three/textures.ts`: `makeWallTexture()/makeFloorTexture()/makeRoofTexture()/makeGlassTexture(): CanvasTexture` (canvas 2D pola+noise; memo modul-level; `wrapS/wrapT=RepeatWrapping`). **Modify** `src/lib/three/materials.ts` (`MATERIAL_PRESETS` tiap permukaan += `{roughness, metalness, texture?}`; `SHARED_COLORS` biarkan). Tests (node/jsdom terbatas — utamakan): textures menghasilkan objek CanvasTexture non-null (mock canvas bila perlu) + MATERIAL_PRESETS shape (roughness/metalness ada semua preset). Commit `feat(3d): tekstur PBR prosedural + preset roughness/metalness` + trailer.

## Task 11: house-model/roof pakai tekstur + soft shadow + toggle
**Modify** `src/components/preview-3d/house-model.tsx` + `roof-geometry.tsx` (`meshStandardMaterial` pakai `map`+`roughness`+`metalness` dari preset bila `realistic`; fallback warna datar bila `!realistic`), `house-scene.tsx` (drei `<SoftShadows>` atau `<ContactShadows>` saat `realistic`). Guard WebGL (SceneBoundary sudah ada). Tidak sentuh interior scene. Commit `feat(3d): terapkan tekstur PBR + soft shadow (toggle realistis)` + trailer.

## Task 12: E2E + gate penuh + review akhir
**Modify** `e2e/drawings.spec.ts` (+`e2e/structural.spec.ts` / `e2e/preview-3d.spec.ts`): sheet Rencana Pondasi (teks /telapak|σ|kN/), Tabel Perhitungan (/PBG|Pu|diverifikasi/); editor set σ; `/preview-3d` toggle Realistis → canvas render tanpa console error + slider matahari ada. Existing tak dilemahkan, run 2×. Gate penuh: `npx tsc` · `npx vitest run` · `npx next build` (langsung) · `pnpm exec playwright test` (FULL) → hijau. Review akhir whole-branch (opus) + triage minor. Commit `test(e2e): struktur + 3d realistis` + trailer.

---

## Self-Review
**Coverage:** poin 15 (A: T1-T8), poin 2 (B: T9-T11), RAB (T8), e2e (T12). **Placeholder:** tidak ada — σ default/batas, DL/LL/f'c/fy/MAX_SPAN, rumus Ag/h/b/A_ftg + contoh eksak, harga/m³, disclaimer, urutan sheet, komponen drei, sumber tekstur prosedural dipatok. **Konsistensi:** `buildingFootprint` bersama T3↔T8; sizing T5↔sheet T6↔RAB T8; disclaimer verbatim; sheet-list auto page↔PDF; σ T1↔semua. **Risiko:** T8 rebasis footprint ubah RAB total & tes existing → task sendiri, nilai baru diverifikasi bukan tes dilemahkan; Drawing tanpa tabel → label bertumpuk (pola SP5); B tekstur prosedural nol-eksternal; shadow GPU lemah → toggle Realistis + SceneBoundary. **Catatan:** A & B nol file bersama — bila B tersendat, A tetap merge-able (tapi user pilih satu branch → gate sekali di T12).
