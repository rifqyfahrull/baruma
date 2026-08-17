# SP4 — Instalasi Listrik & Titik Lampu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Langkah pakai checkbox.

**Goal:** Entitas titik listrik editable di editor 2D + auto-generate default per tipe ruang + sheet "Rencana Listrik" per lantai (daya + lampu + relasi saklar→lampu + legenda + panel schedule) + AI parity + RAB diperhalus — e2e-gated.

**Architecture:** `ElectricalPoint[]` di `DesignLayout` (JSONB, absolut meter, seperti `roof`) dengan store CRUD undo-aware (`commit`); pure builders `electrical/plan.ts` (auto-gen + placement), `electrical/circuits.ts` (grup + MCB/VA), `drawings/electrical-plan.ts` (sheet, pola `ceiling-plan.ts`); editor marker+inspector+tool di plan-canvas; AI 5 aksi via rantai `setRoof`; RAB perhalus baris `listrik` existing.

**Tech Stack:** Next.js 16, zustand (editor-store), zod (actions schema), Drawing contract (lines-only, meter y-UP), vitest, Playwright.

## Global Constraints

- Spec: [2026-07-04-sp4-instalasi-listrik-design.md](../specs/2026-07-04-sp4-instalasi-listrik-design.md). Reuse: `Drawing` contract (`src/lib/drawings/types.ts` — **hanya lines**, kinds `outline|slab|opening|ground|cut`; labels `room|level|title`), `ceiling-plan.ts` pola simbol (`kind:"opening"`, `round2`, bbox/dims SEMUA ruang non-void dikecualikan hanya dari outline/label), `sheet-list.ts` `SheetListEntry.build(layout, interiors, cuts)`, gate Playwright FULL.
- **Koordinat:** `ElectricalPoint.x/y` = **meter ABSOLUT** (ruang koordinat editor: `room.x/room.y/room.width/room.depth`, y-UP). Lampu tetap room-local di interior plan → di sheet digambar `room.x+f.x` (persis ceiling-plan). Titik listrik digambar `p.x,p.y` langsung.
- **Tipe titik** `ElectricalPointType` = `"stopkontak" | "stopkontak_daya" | "saklar_tunggal" | "saklar_ganda" | "panel" | "data"`. Label (`ELECTRICAL_POINT_TYPES`): Stopkontak · Stopkontak Daya · Saklar Tunggal · Saklar Ganda · Panel Listrik · Titik Data/TV.
- **Beban (VA)** `LOAD_VA`: `stopkontak 200` · `stopkontak_daya 900` · `saklar_tunggal/ganda 0` · `panel 0` · `data 0`. Lampu (per unit × qty) `LAMP_LOAD_VA`: `downlight 15` · `pendant 25` · `task 20` · `wall_lamp 15` · `indirect 20` · `outdoor 30`.
- **MCB:** `MCB_STANDARDS = [2,4,6,10,16,20,25]` A. `mcbFor(va) = ` standar pertama `≥ (va/220)*1.25`; bila meldebihi 25 → 25 (v1). Contoh: 90 VA→2A · 1600 VA→10A · 900 VA→6A.
- **Placement (auto-gen):** offset `WALL_OFFSET_M = 0.3` dari tepi ruang. Stopkontak/data disebar merata sepanjang **dinding bawah** (`y = room.y + WALL_OFFSET_M`), bila jumlah >2 sisanya di **dinding kanan** (`x = room.x + room.width − WALL_OFFSET_M`); saklar di **sudut dekat pintu** ruang (opening `type:"door"` pertama pada ruang → sudut terdekat) atau sudut kiri-bawah (`room.x+WALL_OFFSET_M, room.y+WALL_OFFSET_M`) bila tak ada pintu; `panel` (1 per rumah) di ruang non-void pertama lantai dasar (`floors[0]`), sudut kiri-bawah + `WALL_OFFSET_M`. Semua titik WAJIB di dalam bbox ruang (test).
- **ELECTRICAL_DEFAULTS** `Record<RoomType, {stopkontak?, stopkontak_daya?, saklar?: "tunggal"|"ganda", data?}>` (qty; absen=0):
  `kamar_tidur {2, saklar:tunggal}` · `kamar_mandi {1, stopkontak_daya:1, saklar:tunggal}` · `ruang_tamu {2, saklar:tunggal, data:1}` · `ruang_keluarga {3, saklar:ganda, data:1}` · `dapur {3, stopkontak_daya:1, saklar:tunggal}` · `ruang_makan {2, saklar:tunggal}` · `musholla {1, saklar:tunggal}` · `laundry {2, stopkontak_daya:1, saklar:tunggal}` · `gudang {1, saklar:tunggal}` · `balkon {1, saklar:tunggal}` · `rooftop_lounge {2, saklar:tunggal, data:1}` · `area_kumpul {2, saklar:tunggal}` · `kolam {stopkontak_daya:1, saklar:tunggal}` · `taman {1, saklar:tunggal}` · `workspace {2, saklar:tunggal, data:1}` · `carport {1, saklar:tunggal}` · `tangga {saklar:ganda}` · `void {}` (dilewati). Fallback tipe tak terdaftar: `{1, saklar:tunggal}`.
- **Simbol** (semua `kind:"opening"`, `round2`, half `SYM_M = 0.15`): titik listrik glyph garis, JUMLAH GARIS dipatok utk test — `stopkontak` 6 (kotak 4 + 2 taji) · `stopkontak_daya` 7 (kotak 4 + 2 taji + 1 garis "D" diagonal) · `saklar_tunggal` 2 (tangkai 45° + tuas) · `saklar_ganda` 4 (2 tangkai + 2 tuas) · `panel` 5 (persegi 4 + 1 arsir diagonal) · `data` 3 (segitiga). Lampu pakai `crossLines`/`diamondLines` ceiling-plan (jangan duplikasi — impor/ekstrak bila perlu). **Relasi saklar→lampu:** 1 garis `kind:"opening"` dari tiap `saklar_*` ke tiap pusat lampu di ruang yang sama.
- **Sheet order:** `E-01…` per lantai **setelah** `C-` (ceiling), **sebelum** `R-01` (roof-detail tetap terakhir). Id `electrical-<floorId>`, testid `sheet-tab-electrical-<floorId>`. `SheetKind += "electrical"`.
- **Panel schedule + legenda** digambar DI DALAM `buildElectricalPlan` di sisi KANAN denah (x mulai `bboxW + 1.0`): tabel kolom `Sirkuit | Titik | VA | MCB` (grid `kind:"outline"` + sel `kind:"room"`), 1 baris/sirkuit; `widthM` Drawing diperlebar mencakup tabel agar `sheetPlacement` menskala pas.
- Bahasa UI; tanpa dep baru; JSONB (`roof`-style, tanpa migrasi); AI parity WAJIB (aturan repo). Titik yang room-nya hilang dibersihkan saat load (self-heal).

---

## Task 1: Entitas + store CRUD undo (TDD)

**Files:**
- Modify: `src/types/index.ts` (tambah `ElectricalPointType`, `ElectricalPoint`, `DesignLayout.electrical?: ElectricalPoint[]`)
- Modify: `src/stores/editor-store.ts` (state + CRUD)
- Test: `src/stores/editor-store.test.ts`

**Interfaces — Produces:**
```ts
type ElectricalPointType = "stopkontak" | "stopkontak_daya" | "saklar_tunggal" | "saklar_ganda" | "panel" | "data"
type ElectricalPoint = { id: string; roomId: string; type: ElectricalPointType; x: number; y: number; note?: string }
// DesignLayout.electrical?: ElectricalPoint[]
// store:
addElectricalPoint(roomId: string, type: ElectricalPointType, x: number, y: number): void  // id "elec-<nanoid8>", commit
moveElectricalPoint(id: string, x: number, y: number): void   // commit (via beginDrag/endDrag gesture too)
updateElectricalPoint(id: string, patch: Partial<Pick<ElectricalPoint,"type"|"roomId"|"note">>): void  // commit
removeElectricalPoint(id: string): void  // commit
setElectrical(points: ElectricalPoint[]): void  // replace whole array, commit (dipakai auto-gen T2)
```

- [ ] **Step 1: Failing test** — di `editor-store.test.ts` tambah `describe("electrical")`: load layout punya ≥1 room; `addElectricalPoint(roomId,"stopkontak",1,1)` → `layout.electrical` len 1, id diawali `elec-`; `updateElectricalPoint(id,{type:"data"})` → type "data"; `moveElectricalPoint(id,2,3)` → x2 y3; `removeElectricalPoint(id)` → len 0; tiap mutasi menaikkan `past` (undo) & `undo()` mengembalikan. `setElectrical([...])` mengganti penuh + satu entri undo.
- [ ] **Step 2: Run → FAIL** (`npx vitest run src/stores/editor-store.test.ts`).
- [ ] **Step 3: Implement** — types dulu (union + entity + `electrical?` di `DesignLayout` dekat `roof?`). Store: tambah 5 method via `commit((l)=>{ l.electrical = [...(l.electrical??[]), pt] })` dst; `nanoid(8)` (impor sama spt `makeRoom`). `import type { ElectricalPoint, ElectricalPointType } from "@/types"`.
- [ ] **Step 4: Run → PASS** (+ full `npx vitest run` hijau).
- [ ] **Step 5: Commit** `feat(editor): entitas ElectricalPoint + store CRUD undo` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Task 2: `electrical.ts` (beban/harga/simbol) + auto-generate (pure, TDD)

**Files:**
- Create: `src/lib/electrical/electrical.ts` (konstanta beban/harga + `symbolLines`)
- Create: `src/lib/electrical/plan.ts` (`autoGenerateElectrical`)
- Modify: `src/lib/constants/index.ts` (`ELECTRICAL_POINT_TYPES`, `ELECTRICAL_DEFAULTS`)
- Test: `src/lib/electrical/plan.test.ts`, `src/lib/electrical/electrical.test.ts`

**Interfaces — Produces:**
```ts
// electrical.ts
export const LOAD_VA: Record<ElectricalPointType, number>          // Global Constraints
export const LAMP_LOAD_VA: Record<LightingFixture["type"], number>
export function symbolLines(type: ElectricalPointType, cx: number, cy: number): DrawLine[]  // JUMLAH garis dipatok
// plan.ts
export function autoGenerateElectrical(layout: DesignLayout, floorId?: string): ElectricalPoint[]
//   mengembalikan ARRAY BARU (layout.electrical lama + titik utk ruang yg BELUM punya titik; idempoten). floorId?: batasi 1 lantai.
```

- [ ] **Step 1: Failing test** — `plan.test.ts`: layout 1 lantai berisi `kamar_tidur` + `dapur` (+ `void`); `autoGenerateElectrical(layout)` → kamar_tidur 2 `stopkontak`+1 `saklar_tunggal`, dapur 3 `stopkontak`+1 `stopkontak_daya`+1 `saklar_tunggal`, `void` 0; total titik = jumlah eksak; TEPAT 1 `panel` (di ruang lantai-dasar pertama); tiap titik `x∈[room.x,room.x+width] && y∈[room.y,room.y+depth]`; idempoten (jalankan 2× = sama, tak dobel). `electrical.test.ts`: `symbolLines("stopkontak",0,0)` len 6, `"data"` len 3, `"saklar_tunggal"` len 2, `"panel"` len 5, semua `kind:"opening"` & titik berpusat (semua koordinat ∈ ±SYM_M dari cx,cy).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — konstanta di `constants/index.ts` (pola trio ROOF). `autoGenerateElectrical`: kumpulkan roomIds yang sudah punya titik (skip), utk ruang non-void tanpa titik pakai `ELECTRICAL_DEFAULTS[room.type] ?? FALLBACK`, tempatkan per aturan Global Constraints (`distributeAlongWalls`), saklar dekat pintu (`layout.openings` filter `roomId` & `type:"door"` → sudut terdekat). Panel: bila belum ada `panel` mana pun, tambah 1 di `floors[0]` ruang non-void pertama. `symbolLines` glyph garis (pola `crossLines`). Kembalikan `[...existing, ...baru]`.
- [ ] **Step 4: Run → PASS** (+ full suite).
- [ ] **Step 5: Commit** `feat(electrical): auto-generate default + beban/simbol` + trailer.

## Task 3: `circuits.ts` grup sirkuit + MCB (pure, TDD)

**Files:**
- Create: `src/lib/electrical/circuits.ts`
- Test: `src/lib/electrical/circuits.test.ts`

**Interfaces — Produces:**
```ts
export type Circuit = { id: string; name: string; kind: "penerangan"|"stopkontak"|"khusus"; pointCount: number; loadVA: number; mcbA: number }
export function mcbFor(va: number): number   // MCB_STANDARDS, (va/220)*1.25
export function buildCircuits(layout: DesignLayout, interiors: RoomInteriorPlan[], floorId: string): Circuit[]
//   1 "penerangan" (semua lampu lantai) + 1 "stopkontak" (semua stopkontak) + 1 "khusus" per stopkontak_daya. Nama pakai konvensi em-dash `Penerangan — <floor.name>` / `Stopkontak — <floor.name>` / `Daya Khusus <i>` (floor.name sudah "Lantai N" — JANGAN prefix "Lt.").
```

- [ ] **Step 1: Failing test** — `mcbFor(90)===2`, `mcbFor(1600)===10`, `mcbFor(900)===6`. `buildCircuits` utk lantai: 6 downlight (interiors lighting) + 8 stopkontak + 1 stopkontak_daya → circuits: penerangan {pointCount 6, loadVA 90, mcbA 2}, stopkontak {8, 1600, 10}, khusus×1 {1, 900, 6}; nama Bahasa (`Penerangan Lt.<name>`, `Stopkontak Lt.<name>`, `Daya Khusus 1`). Lantai tanpa titik/lampu → array kosong.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `loadVA` lampu via `LAMP_LOAD_VA[type]*qty` dari `interiors[].lighting` (ruang di lantai itu), stopkontak via `LOAD_VA`. `saklar/panel/data` 0 (tak jadi sirkuit sendiri). Id stabil (`circ-<kind>-<floorId>[-i]`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(electrical): grouping sirkuit + MCB` + trailer.

## Task 4: `buildElectricalPlan` sheet (pure, TDD)

**Files:**
- Create: `src/lib/drawings/electrical-plan.ts`
- Modify: `src/lib/drawings/ceiling-plan.ts` (EKSPOR `crossLines`/`diamondLines` atau ekstrak ke helper bersama `lighting-symbols.ts` — hindari duplikasi)
- Test: `src/lib/drawings/electrical-plan.test.ts`

**Interfaces — Produces:**
```ts
export function buildElectricalPlan(layout: DesignLayout, interiors: RoomInteriorPlan[], floorId: string): Drawing
```

- [ ] **Step 1: Failing test** — layout 1 lantai + `layout.electrical` (1 stopkontak, 1 saklar_tunggal) + interiors 1 downlight di ruang sama. `buildElectricalPlan`: outline ruang non-void ada; simbol stopkontak (6 line `opening` sekitar `p.x,p.y`) + saklar (2) + lampu cross (2); **≥1 garis relasi** dari saklar ke pusat lampu (assert ada line dari `(saklar.x,saklar.y)` ke `(room.x+f.x,room.y+f.y)`); ruang `void` dikecualikan dari outline; label legenda (`kind:"room"` text mengandung "Stopkontak") ada; ≥1 baris panel-schedule (`kind:"room"` text mengandung "MCB" atau nama sirkuit); `title==="Rencana Listrik — <floor.name>"`; `widthM` > bbox ruang (mencakup tabel). Titik listrik lantai lain TIDAK muncul.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — pola `buildCeilingPlan`: outline+bbox+dims SEMUA ruang (void hanya dari outline dikecualikan). Titik: filter `layout.electrical` yg room-nya di `floorId`; `symbolLines(type,p.x,p.y)`. Lampu: reuse cross/diamond dari helper bersama. Relasi: utk tiap saklar, garis ke tiap lampu se-ruang. `buildCircuits(...)` → gambar tabel + legenda di kanan (x `bboxW+1.0`), perlebar `widthM`. Label kode titik opsional (`kind:"room"`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(drawings): sheet rencana listrik (titik + sirkuit + panel schedule)` + trailer.

## Task 5: Integrasi sheet-list + halaman + PDF

**Files:**
- Modify: `src/lib/drawings/sheet-list.ts` (`SheetKind += "electrical"`; loop `E-` per lantai setelah `C-`, sebelum `R-`)
- Modify: `src/lib/exports/drawings-pack.ts` test count (naik), bila perlu `STROKE_WIDTH_MM` tak berubah (pakai `opening`)
- Test: `src/lib/drawings/sheet-list.test.ts`, `src/lib/exports/drawings-pack.test.ts`

- [ ] **Step 1: Failing test** — `sheet-list.test.ts`: buildSheetList utk layout N lantai → jumlah = (sebelumnya) + `N` sheet electrical; ada entry id `electrical-<floorId>`, `kind:"electrical"`, `sheetNo` `E-01`.., `label` `Rencana Listrik — <lantai>`; urutan: electrical setelah semua ceiling, roof-detail tetap TERAKHIR; `build(layout, interiors)` mengembalikan Drawing ber-title "Rencana Listrik". Update `drawings-pack.test.ts` count (strengthen, bukan lemahkan).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — di sheet-list per-floor loop, push electrical entry `build:(l,interiors)=>buildElectricalPlan(l,interiors,floor.id)`. Halaman `drawings/page.tsx` & PDF `drawings-pack.ts` konsumsi via buildSheetList → OTOMATIS muncul (tanpa edit page bila sheet-list satu-satunya sumber — verifikasi). Testid `sheet-tab-electrical-<floorId>` mengikuti pola `sheet-tab-<id>`.
- [ ] **Step 4: Run → PASS** (+ full suite; jalankan `npx tsc`).
- [ ] **Step 5: Commit** `feat(drawings): daftar & PDF sheet rencana listrik` + trailer.

## Task 6: Editor — marker + drag + inspector + tool + toolbar

**Files:**
- Modify: `src/types/index.ts` (`EditorTool` += `"electrical"`)
- Modify: `src/stores/editor-store.ts` (`pendingElectricalType`/`setPendingElectricalType`; `dragElectricalTo` gesture opsional pakai `beginDrag/endDrag`)
- Modify: `src/components/editor/plan-canvas.tsx` (render titik listrik + hit-test seleksi via `selectedObjectId` + drag + placement saat `activeTool==="electrical"` klik → `addElectricalPoint(roomAt(x,y), pendingType, x, y)`)
- Modify: `src/components/editor/editor-inspector.tsx` (titik terpilih → `ElectricalInspector` edit tipe/ruang/catatan + hapus; tanpa seleksi → seksi "Listrik": tombol Auto-generate (`setElectrical(autoGenerateElectrical(layout))`) + ringkas jumlah titik + pilih tipe pending)
- Modify: `src/components/editor/editor-toolbar.tsx` (ToolButton "Titik Listrik" ikon `Plug`/`Zap`, aktif set `activeTool="electrical"`; dropdown tipe → `setPendingElectricalType`)
- Test: `e2e` di Task 8; unit ringan bila ada util `roomAt`.

- [ ] **Step 1** — `EditorTool` union tambah `"electrical"`; store `pendingElectricalType` + setter (view-state, non-undo).
- [ ] **Step 2** — plan-canvas: layer titik listrik (pakai `symbolLines`→SVG atau ikon sederhana), warna aktif saat `selectedObjectId===p.id`; klik titik → `selectObject(p.id)`; drag → `beginDrag`/`moveElectricalPoint`/`endDrag` dgn clamp ke bbox ruang (`clampToRoom`); saat `activeTool==="electrical"` klik kanvas → tentukan `roomAt(mx,my)` (room mengandung titik) → `addElectricalPoint`. **JANGAN ubah** perilaku room/opening.
- [ ] **Step 3** — inspector: resolve `selectedObjectId` → titik di `layout.electrical` → `ElectricalInspector` (Select tipe dari `ELECTRICAL_POINT_TYPES` + Select ruang + input catatan + tombol Hapus `removeElectricalPoint`). **a11y: tiap Select trigger & Input WAJIB `aria-label`** (pelajaran SP3: gate a11y menolak kontrol tanpa nama). Seksi "Listrik" di panel kosong (pola `RoofInspector`).
- [ ] **Step 4** — toolbar ToolButton + dropdown tipe (pola tool "Tambah Ruang").
- [ ] **Step 5** — `npx tsc` 0; `npx vitest run` hijau (unit tak berubah). Commit `feat(editor): tempatkan/edit titik listrik di denah 2D` + trailer.

## Task 7: AI parity (5 aksi) + RAB perhalus

**Files:**
- Modify: `src/lib/assistant/actions.ts` (5 aksi di `floorplanActionSchema` + `ELECTRICAL_POINT_TYPE_VALUES satisfies` + `describeAction` cases + `floorplanSceneSchema.electrical[]`)
- Modify: `src/lib/server/editor-assistant.ts` (prompt bullet 5 aksi + `sanitizeFloorplan`: validasi roomId/id ada di scene, clamp x/y ke bbox layout, enum tipe)
- Modify: `src/lib/assistant/apply.ts` (`buildFloorplanScene` isi `electrical[]`; dispatch 5 aksi → store method)
- Modify: `src/lib/mock/rab.ts` (perhalus 2 baris `listrik`)
- Test: `src/lib/server/editor-assistant.test.ts`, `src/lib/mock/rab.test.ts`

**Aksi:** `addElectricalPoint {roomId,type,x,y}` · `moveElectricalPoint {id,x,y}` · `updateElectricalPoint {id, patch}` · `removeElectricalPoint {id}` · `autoGenerateElectrical {floorId?}` (dispatch → `store.setElectrical(autoGenerateElectrical(layout, a.floorId))`).

- [ ] **Step 1: Failing test** — sanitize: `addElectricalPoint` dgn roomId tak ada → ditolak; x/y di luar bbox → clamp; tipe invalid → ditolak; `autoGenerateElectrical` diteruskan. `describeAction` tiap aksi → string Bahasa. RAB: layout dgn `electrical` (mis. 10 titik) + interiors (mis. 6 lampu) → baris "Instalasi titik listrik" volume `= electrical.length + Σ lighting.qty` (eksak, mis. 16), unit "titik"; "Panel, MCB & grounding" note menyebut jumlah sirkuit; summary = Σ items (test existing tetap).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — rantai persis `setRoof` (lihat `actions.ts` `setRoof`/`roofPatchSchema`/`describeAction` case; `editor-assistant.ts` `sanitizeFloorplan` clamp slope; `apply.ts` `else if (a.type==="setRoof")`). `ELECTRICAL_POINT_TYPE_VALUES = [...] satisfies readonly ElectricalPointType[]`. RAB: hitung `Σ lighting` dari interiors param (rab sudah terima layout; cek apakah interiors tersedia di `buildRab` — bila tidak, hitung titik daya dari `layout.electrical` + estimasi lampu dari `builtArea` fallback; **prefer** teruskan interiors bila signature memungkinkan tanpa ubah caller besar — grep pemanggil `buildRab`).
- [ ] **Step 4: Run → PASS** (+ full suite, `npx tsc`).
- [ ] **Step 5: Commit** `feat(assistant+rab): AI aksi titik listrik + RAB titik nyata` + trailer.

## Task 8: E2E + gate penuh + review akhir

**Files:** Modify `e2e/drawings.spec.ts` (+ editor spec bila ada `e2e/editor*.spec.ts`).

- [ ] **Step 1** — e2e: (a) klik tab pertama `/Rencana Listrik/` → `sheet-svg` text /Stopkontak|MCB/ dan >10 `line`; (b) di editor, pilih tool "Titik Listrik" → klik denah → marker titik bertambah (atau: tombol Auto-generate → titik muncul; assert via testid `electrical-marker`). Existing 7 test drawings TIDAK dilemahkan. Run 2× stabil.
- [ ] **Step 2** — Gate penuh: `npx tsc --noEmit` · `npx vitest run` · `npx next build` (exit 0 langsung; wrapper rtk build bisa exit-1 palsu) · `pnpm exec playwright test` (FULL) → hijau.
- [ ] **Step 3** — Review akhir whole-branch (opus) + triage minor. Commit e2e `test(e2e): rencana listrik + tempatkan titik` + trailer.

---

## Self-Review

**Coverage:** poin 10 — entitas+store (T1), auto-gen+default+simbol (T2), sirkuit+MCB (T3), sheet (T4), integrasi halaman/PDF (T5), editor UI (T6), AI+RAB (T7), e2e+gate (T8). ✓ **Placeholders:** tidak ada — tipe titik, LOAD_VA, MCB standar+rumus, ELECTRICAL_DEFAULTS lengkap 18 tipe ruang, placement, jumlah-garis simbol, urutan sheet dipatok. **Konsistensi:** `ElectricalPoint` T1 ↔ semua; `autoGenerateElectrical(layout, floorId?)` T2 ↔ T6 tombol ↔ T7 aksi; `buildCircuits(layout, interiors, floorId)` T3 ↔ T4 tabel; `buildElectricalPlan(layout, interiors, floorId)` T4 ↔ `SheetListEntry.build` T5; simbol `kind:"opening"` = tanpa sentuh renderer; RAB perhalus baris existing (kategori `listrik` sudah ada, tanpa dobel). **Risiko:** T6 UI terbesar (plan-canvas kini tak render fixture/seleksi non-room) — dipecah langkah; a11y `aria-label` diwajibkan eksplisit (pelajaran SP3). **Carry-over SP3 footprint:** tak tersentuh — titik pakai posisi absolut, bukan luas kavling.
