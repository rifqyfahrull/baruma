# SP3 — Pola Lantai + Plafon + Atap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Sheet Pola Lantai & Rencana Plafon per lantai + parameter atap (editor + AI + 3D + tampak/potongan + Detail Atap + RAB) — e2e-gated.

**Architecture:** Dua builder pure baru (pola lantai pakai material interior; plafon pakai material + titik lampu interior) + parameter `layout.roof` (editor UI + aksi AI `setRoof` + prim 3D baru + profil miring di elevation/section + `buildRoofDetail`). Interiors di halaman/PDF di-resolve murni: `saved ? applySavedInterior(...) : generateInteriorPlan(...)`.

## Global Constraints

- Spec: [2026-07-03-sp3-lantai-plafon-atap-design.md](../specs/2026-07-03-sp3-lantai-plafon-atap-design.md). Reuse: `Drawing` contract, `openingSegment`-era conventions, `sheetPlacement`, halaman `sheetList` + PDF `defaultSheets` (SP2), gate FULL playwright.
- **TILE_SIZES** (m): `floor-cream-tile: 0.6×0.6` · `bathroom-tile: 0.4×0.4` · `floor-vinyl-oak: 0.18×1.2` (plank) · `outdoor-deck: 0.14×2.2` · `floor-polished-concrete: SEAMLESS` (tanpa grid, label "tanpa nat") · fallback `0.4×0.4`. Kebutuhan: `ceil(areaM2/(tw*th) * 1.1)` pcs (waste 10%).
- **CEILING_DROP_M = 0.4** — tinggi plafon ruang = `floor.heightM − 0.4 + (levelOffsetM ?? 0)`, label via `formatElevation`.
- **Roof:** `DesignLayout.roof?: { type: "datar"|"pelana"|"limasan"; slopeDeg: number; overhangM: number; material: "genteng_beton"|"genteng_keramik"|"metal"|"aspal" }`; default absen = datar (perilaku kini). **Ridge pelana sepanjang dimensi TAPAK terpanjang** (site.widthM ≥ depthM → ridge sumbu-x, span = depthM); `rise = (span/2 + overhangM) × tan(slopeDeg)`. Batas UI: slope 15–40°, overhang 0–1 m.
- **ROOF_PRICES per m² (flat):** genteng_beton 400k · genteng_keramik 500k · metal 350k · aspal 550k. Luas atap: datar `footprint×1.1`; miring `footprint × (1/cos(slopeDeg)) × 1.15`.
- Bahasa UI; tanpa dep baru; JSONB (roof optional → tanpa migrasi).

---

## Task 1: `floor-pattern.ts` (pure, TDD)
**Create** `src/lib/drawings/floor-pattern.ts` + test. `tileSizeFor(materialId): {w,h}|null` (null=seamless) + `buildFloorPatternPlan(layout, interiors: RoomInteriorPlan[], floorId): Drawing`:
- Outline ruang non-void (pola kusen-plan); per ruang: material lantai = `interiors.find(roomId).materials.find(surface==="floor")` (fallback `floor-cream-tile` + nama "Homogeneous Tile Cream" bila tak ada interior).
- Grid nat: garis `kind:"opening"` vertikal `x = room.x + k·tw` (k≥1, < width) + horizontal analog, terklip rect ruang; seamless → tanpa grid.
- Label per ruang (kind "room"): `"<nama material> · 60×60 · 34 pcs"` (pcs per rumus waste; seamless → `"<nama> · tanpa nat"`).
- Dim chains + bbox pola kusen-plan (SEMUA ruang utk bbox/dims); title `Pola Lantai — <floor.name>`.
- Tests: jumlah garis grid utk ruang 4×3 tile 0.6 (6 vertikal [0.6..3.6] + 4 horizontal [0.6..2.4] → assert eksak), plank vinyl orientasi (tw 0.18 sumbu-x), pcs = ceil(12/0.36×1.1)=37, seamless tanpa grid, fallback material.
Commit: `feat(drawings): pola lantai per ruang (grid nat + kebutuhan tile)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Task 2: `ceiling-plan.ts` (pure, TDD)
**Create** `src/lib/drawings/ceiling-plan.ts` + test. `buildCeilingPlan(layout, interiors, floorId): Drawing`:
- Outline ruang non-void; label per ruang: `"<material plafon> · +2,60 m"` (tinggi per Global Constraints; material ceiling dari assignments surface "ceiling", fallback "Gypsum + Cat"). 
- **Titik lampu** dari `interiors[].lighting` (fixture x/y relatif ruang → absolut room.x+f.x): simbol per jenis — downlight/task/outdoor: silang 2 garis ±0.12; pendant/indirect/wall_lamp: belah ketupat 4 garis ±0.12 (`kind:"opening"`); label qty ×N bila >1.
- Dims/bbox/title `Rencana Plafon — <floor.name>`.
- Tests: posisi simbol = room.x+fixture.x (eksak), jenis→bentuk, label tinggi dgn levelOffset −0.18 → `+2,42 m`, fallback tanpa interior.
Commit: `feat(drawings): rencana plafon (material, tinggi, titik lampu)` + trailer.

## Task 3: Parameter atap — type + store + editor UI + AI (TDD utk store/sanitize)
**Modify** `src/types/index.ts` (DesignLayout.roof per Global Constraints + `export type RoofSpec`), `src/stores/editor-store.ts` (`setRoof(patch: Partial<RoofSpec>)` via `commit`, merge dgn default `{type:"datar",slopeDeg:30,overhangM:0.5,material:"genteng_beton"}` saat pertama), `src/components/editor/editor-inspector.tsx` (saat TIDAK ada objek terpilih: seksi **"Atap"** — Select tipe [Datar/Pelana/Limasan], input slope 15–40 (disabled saat datar), input overhang 0–1, Select material; label Bahasa), AI parity di `src/lib/assistant/actions.ts` + `src/lib/server/editor-assistant.ts` + `src/lib/assistant/apply.ts` (aksi floorplan `{type:"setRoof", patch:{...semua optional, enum divalidasi zod, slope di-clamp 15–40, overhang 0–1 di sanitizer}}` + prompt + describe "Ubah atap → pelana 30°") + test sanitize. Grep dulu: bila ada zod schema layout utk save API, tambahkan `roof` optional di sana juga.
Tests: store setRoof (merge+undo), sanitize clamp, describe. Commit: `feat(editor): parameter atap (UI + AI setRoof)` + trailer.

## Task 4: Atap 3D (build-model + house-model + glb)
**Modify** `src/lib/three/build-model.ts` (PrimKind += `"roof_gable" | "roof_hip"`; saat `opts.showRoof`: datar → slab kini; pelana → prim `roof_gable` pos puncak-tengah args `[siteW+2·ov, rise, siteD+2·ov]`; limasan → `roof_hip` sama; simpan konvensi ridge Global Constraints — house-model yang menafsirkan args), `src/components/preview-3d/house-model.tsx` (render kind baru dgn geometry khusus: gable = prisma segitiga [BufferGeometry 6 vertex ridge sepanjang sumbu terpanjang], hip = limas 5 vertex; warna preset.roof; JANGAN ubah prim box lain), `src/lib/exports/glb.ts` (case kind baru → warna roof; switch tetap exhaustive). InteriorRoomScene tak tersentuh.
Tests (build-model.test): datar tanpa prim baru; pelana emit `roof_gable` args eksak utk site 8×6 slope 30 ov 0.5 (span=6 → rise=(3+0.5)·tan30≈2.02); limasan analog.
Commit: `feat(3d): atap pelana/limasan (prim + geometry)` + trailer.

## Task 5: Atap di tampak/potongan + `buildRoofDetail` (pure, TDD)
**Modify** `src/lib/drawings/elevation.ts` + `section.ts` (bila `layout.roof?.type` miring: ganti slab-atap datar dgn profil — tampak tegak-lurus ridge: segitiga (pelana) / trapesium (limasan, panjang puncak = panjang ridge − 2·span/2); tampak sejajar ridge: persegi panjang penuh tinggi rise dgn tepi miring utk limasan; potongan memotong ridge → profil sama; overhang melebar ±ov; puncak `topY + rise`); **Create** `src/lib/drawings/roof-detail.ts` + test: `buildRoofDetail(layout): Drawing` — potongan setengah-bentang parametrik: garis kemiringan slopeDeg, overhang, kuda-kuda skematik (segitiga + 2 web), gording (3 titik di garis miring), label material + slope `30°` + dims (½ span, rise, overhang); varian datar: lapisan screed+waterproofing berlabel. Title `Detail Atap`.
Tests: puncak elevation = topY+rise eksak; trapesium limasan; roof-detail garis kemiringan gradien tan(slope); datar variant.
Commit: `feat(drawings): profil atap di tampak/potongan + detail atap parametrik` + trailer.

## Task 6: Integrasi halaman + PDF + RAB
**Modify** `drawings/page.tsx` + `drawings-pack.ts` (+tests): resolve interiors murni — page: `useInterior(projectId)` (+`useProject`) → `saved ? applySavedInterior(layout, saved, {projectId}) : generateInteriorPlan(layout, {projectId, style: interiorStyleFromHouseStyle(project.style)})`; PDF: `generateExport` fetch interior juga → `buildDrawingsPdf(project, layout, interiors)`. `sheetList`/`defaultSheets` += `Pola Lantai — <lantai>` (L-01..), `Rencana Plafon — <lantai>` (C-01..), `Detail Atap` (R-01) — urutan setelah kusen; **factor builder daftar-sheet BERSAMA** ke `src/lib/drawings/sheet-list.ts` (menghapus duplikasi page↔PDF, sesuai follow-up SP2 — pindahkan juga kusen entries ke sana; kSheetNo dkk ikut). RAB (`mock/rab.ts` + test): ganti baris "Atap (rangka + penutup)" — volume = luas atap (rumus Global Constraints), total = luas × ROOF_PRICES[material] (default genteng_beton bila roof absen), confidence medium.
Tests: sheet-list bersama (page & PDF konsumsi sama; jumlah = SP2 + 2·lantai + 1), RAB atap eksak utk pelana 30° footprint 64.
Commit: `feat(drawings+rab): sheet lantai/plafon/atap + sheet-list bersama + RAB atap material` + trailer.

## Task 7: E2E
**Modify** `e2e/drawings.spec.ts`: +2 test — (a) klik tab `Pola Lantai` pertama (`getByRole button name /Pola Lantai/`) → svg ada text /pcs|tanpa nat/ dan >10 line; klik `Rencana Plafon` pertama → svg text /\+2,\d/ (label tinggi); (b) klik `sheet-tab-roof-detail` (id: `roof-detail`) → svg text /Detail Atap/. Existing 5 test TIDAK dilemahkan. Run 2× stabil. Commit: `test(e2e): pola lantai, plafon, detail atap` + trailer.

## Task 8: Full gate
`rtk tsc` · `npx vitest run` · `npx next build` · `pnpm exec playwright test` (FULL) → hijau. Review akhir whole-branch (opus) + triage minors SP2 yang tersentuh (sheet-list bersama ✓).

---

## Self-Review
**Coverage:** poin 5 (T1+T6), poin 9 (T2+T6), poin 8 (T3+T4+T5+T6), RAB (T6), e2e (T7). ✓ **Placeholders:** tidak ada — rumus, ukuran, harga, konvensi ridge dipatok. **Konsistensi:** `RoofSpec` T3 ↔ T4/T5/T6; `buildFloorPatternPlan/buildCeilingPlan(layout, interiors, floorId)` T1/T2 ↔ T6; sheet-list bersama T6 ↔ e2e id `roof-detail` T7. **Catatan:** T4 house-model geometry = satu-satunya sentuhan non-box (komponen terisolasi); T6 memindahkan sheetList → modul bersama (follow-up SP2 tuntas sekalian).
