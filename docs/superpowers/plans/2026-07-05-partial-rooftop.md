# Partial Rooftop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** `layout.rooftopArea` (rect eksplisit) → deck sebagian + atap `layout.roof` pada sisa footprint, konsisten di 3D, tampak/potongan/detail atap, RAB, dan beban struktur.

**Architecture:** Satu helper geometri pure (`rooftopStrips`) jadi sumber dekomposisi untuk semua konsumen. Field JSONB opsional (absent = deck penuh, back-compat). Toggle atap preview kembali utk rumah partial via helper bersama `isPartialRooftop`.

## Global Constraints

- Spec: [2026-07-05-partial-rooftop-design.md](../specs/2026-07-05-partial-rooftop-design.md). Keputusan user: rect eksplisit; atap sisa = `layout.roof`; cakupan lengkap; toggle kontrol strip saja.
- `rooftopArea` meter, koordinat site (spt rooms); clamp ke `buildingFootprint` (grid.ts), min 1,5 m/dimensi; partial ⇔ ada && luas < footprint − ε (helper `isPartialRooftop(layout)` di modul geometri, BUKAN di komponen).
- Strip: dekomposisi guillotine U/S penuh-lebar + B/T setinggi deck; strip berdimensi-pendek <1,0 m selalu datar; overhang hanya pada sisi yang menempel batas footprint.
- Rise per strip = `(spanPendek/2 + ov) · tan(slopeDeg)` (formula build-model kini); clamp slope/overhang tetap via `effectiveRoof`.
- WAJIB dijaga: perilaku rumah non-rooftop & full-rooftop byte-identik (test regresi); e2e existing tak dilemahkan; a11y aria-label pada setiap input/tombol baru; UI bahasa Indonesia; tanpa dep baru.
- Pelajaran: gate `npx next build` langsung; dev server bersih utk playwright; jangan konkurenkan review vitest dgn gate; commit implementer trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Task 1: Model + geometri murni (`rooftopStrips`)

**Files:** Modify `src/types/index.ts` (atau lokasi `DesignLayout`) + `src/lib/schemas/layout*.ts` (zod save API) + `src/lib/validation.ts`; Create `src/lib/geometry/rooftop.ts` + `rooftop.test.ts`.
**Produces:** `type RooftopArea = {x,y,width,depth}`; `clampRooftopArea(area, fp): RooftopArea`; `isPartialRooftop(layout): boolean`; `rooftopStrips(fp: BuildingFootprint, deck: RooftopArea): Strip[]` dgn `Strip = {x,y,width,depth, touches: {n,s,w,e}}` (touches = sisi yang menempel batas footprint, utk overhang). Validation: warning `rooftop_room_outside_deck`.
TDD: dekomposisi 4/2/1/0 strip (deck tengah/pojok/sisi/penuh), clamp, min-dimensi, ε-full, layout tanpa floor-rooftop → isPartial false. Commit `feat(rooftop): model rooftopArea + rooftopStrips`.

## Task 2: 3D build-model + toggle preview

**Files:** Modify `src/lib/three/build-model.ts` (+test), `src/components/preview-3d/preview-controls.tsx`, `src/components/preview-3d/house-model.tsx`.
**Consumes:** `rooftopStrips`, `isPartialRooftop`.
Deck slab & 4 railing mengikuti `rooftopArea` (posisi spt ruang: `x+width/2−cx`); strip → prim `roof|roof_gable|roof_hip` per strip (id `roof-strip-{i}`, expand sisi `touches` dgn `overhangM`, strip <1 m datar), digate `opts.showRoof`; full-rooftop & non-rooftop TIDAK berubah (test regresi byte-sama utk prim yang ada). `height` = max(deck+railing, strip tertinggi)+headroom. Toggle: `!hasRooftop || isPartialRooftop(layout)` → tampil. house-model: strip pelana/limasan render via `GablePrism`/`HipPyramid` (sudah menerima pos/args bebas). Commit `feat(3d): deck parsial + strip atap (+ toggle kembali)`.

## Task 3: Editor — store + RoofInspector + kanvas

**Files:** Modify `src/stores/editor-store.ts` (+test), `src/components/editor/roof-inspector.tsx` (atau lokasi section Atap di inspector, +test RTL), `src/components/editor/plan-canvas.tsx`.
`setRooftopArea(rect|undefined)` undo-aware (pola setRoof SP3). Inspector saat `project.rooftop`: radio "Deck penuh"/"Deck sebagian" (aria-label), input X/Y/Lebar/Dalam (clamp live via `clampRooftopArea`), ringkasan "Deck … m² · Atap … m²". Kanvas (lantai Rooftop aktif + partial): rect overlay draggable + 4 handle resize sudut, snap 0,1 m, pola drag objek sanitasi SP5 (`sanitation-place.ts` + marker plan-canvas). Commit `feat(editor): kontrol area deck rooftop`.

## Task 4: AI parity

**Files:** Modify `src/lib/assistant/actions.ts` (+test) + executor/registry aksinya.
Aksi `set_rooftop_area {x,y,width,depth}` (clamp sebelum apply) + `clear_rooftop_area`; deskripsi Indonesia; test parity (aksi ada, apply mengubah layout, clamp jalan, no-op saat non-rooftop dgn pesan jelas). Commit `feat(ai): aksi set/clear rooftop area`.

## Task 5: Tampak + Potongan partial-aware

**Files:** Modify `src/lib/drawings/elevation.ts` (+test), `src/lib/drawings/section.ts` (+test).
Tampak per arah: railing hanya sepanjang proyeksi deck pada arah itu; strip → profil (pelana: segitiga bila ridge ⊥ pandang, trapesium/persegi bila ∥; datar: garis slab; limasan: trapesium). Potongan: irisan pada `cutX/cutY` → slab deck bila garis melintasi deck, profil strip bila melintasi strip. Full-rooftop & non-rooftop: output angka identik dgn sekarang (test snapshot nilai). Commit `feat(drawings): tampak & potongan sadar deck parsial`.

## Task 6: Detail Atap + RAB + beban struktur

**Files:** Modify `src/lib/drawings/roof-detail.ts` (+test), `src/lib/drawings/sheet-list.ts` (`roofAreaOf` → Σ strip, +test), `src/lib/mock/rab.ts` (+test), `src/lib/structural/loads.ts` atau pemakainya (+test).
Detail Atap: denah — deck (hatch + label + dimensi rooftopArea) + strip (ridge/arah kemiringan). RAB: atap = Σ luas strip × faktor kemiringan; waterproofing rooftop = luas deck; railing = keliling deck (perbaiki juga kasus full: kini pakai luas/keliling KAVLING — rebasis ke footprint/deck). Struktur: beban hidup rooftop pada luas deck, beban atap pada luas strip; tabel perhitungan menampilkan pembagian. Commit `feat(rab,drawings,struktur): luas deck/strip konsisten`.

## Task 7: E2E + gate penuh + review akhir

**Files:** Modify `e2e/` (+1-2 test).
E2e: buka editor demo (rumah rooftop) → set "Deck sebagian" via input inspector (mis. 4×4 di pojok) → buka preview-3d: toggle "Tampilkan atap" ADA, ON → strip tampil (assert prim/canvas ready tanpa error), OFF → tetap ada deck; Gambar Kerja → sheet Detail Atap menampilkan label deck. Existing e2e tak dilemahkan. Gate penuh: `rtk tsc` · `npx vitest run` · `npx next build` (langsung) · `pnpm exec playwright test` FULL → hijau. Review akhir whole-branch (opus) → merge main + push. Commit `test(e2e): partial rooftop`.

---

## Self-Review

**Coverage:** spec§model→T1, §geometri→T1, §3D→T2, §editor+AI→T3-T4, §gambar kerja→T5-T6, §RAB+struktur→T6, §testing→semua+T7. **Placeholder:** tidak ada — formula rise, aturan strip/overhang/degenerate, id prim, nama aksi AI, perilaku toggle dipatok. **Konsistensi tipe:** `RooftopArea`/`Strip`/`isPartialRooftop` didefinisikan T1, dikonsumsi T2-T6 dgn nama sama. **Risiko:** T5 (renderer sheet padat) — kerjakan per-arah + snapshot angka; regresi non/full-rooftop dijaga test byte-sama di T2/T5/T6.
