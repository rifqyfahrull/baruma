# SP4 — Instalasi Listrik & Titik Lampu

**Date:** 2026-07-04
**Status:** Design (awaiting review)
**Covers:** checklist poin **10 (Instalasi Listrik & Titik Lampu)**. Bagian dari [master roadmap](2026-07-03-master-roadmap-dokumen-kerja.md); melanjutkan pola entity-module (pure builders → store CRUD undo-aware → marker 2D + inspector → AI parity → injeksi RAB) & pola sheet SP1/SP2/SP3.

## Context

- **Titik lampu SUDAH ada** sebagai `LightingFixture[]` per ruang di interior plan (`src/types/index.ts:533`, digenerate `suggestLighting` di `src/lib/interior/plan.ts:555`), dan SP3 sudah menggambarnya sebagai simbol di **Rencana Plafon** (`ceiling-plan.ts` — silang/belah-ketupat `kind:"opening"`). Yang **belum ada**: titik daya (stopkontak/saklar/panel/data), pengelompokan sirkuit, dan **gambar rencana listrik** dengan simbol standar.
- **RAB listrik sudah ada** sebagai 2 baris heuristik (`rab.ts:184-200`: "Instalasi titik listrik" volume `builtArea*0.6`, "Panel, MCB & grounding" 1 ls); kategori `"listrik"` sudah terdaftar. SP4 **memperhalus** baris ini jadi hitungan titik nyata, bukan membuat kategori baru.
- **Keputusan user (terkunci):** titik listrik diedit di **editor 2D denah** (bukan interior workspace) → entitas hidup di `DesignLayout`; sheet listrik **lengkap** (daya + lampu + relasi saklar→lampu + sirkuit); grouping sirkuit **+ panel schedule ringkas** (MCB + estimasi beban VA).

## Keputusan desain

1. **Entitas `ElectricalPoint` di `DesignLayout` (JSONB, optional, tanpa migrasi).**
   ```ts
   // src/types/index.ts
   type ElectricalPointType =
     | "stopkontak"        // outlet biasa (200 VA)
     | "stopkontak_daya"   // outlet daya tinggi/AC/water-heater (sirkuit khusus)
     | "saklar_tunggal"    // 1 grup lampu
     | "saklar_ganda"      // 2 grup lampu
     | "panel"             // MDP/panel bagi (1 utama per rumah)
     | "data"              // titik data/TV/telepon
   type ElectricalPoint = {
     id: string            // "elec-<nanoid8>"
     roomId: string        // ruang penampung (untuk grup sirkuit & label); floor diturunkan dari room
     type: ElectricalPointType
     x: number; y: number  // meter ABSOLUT (ruang koordinat editor), bukan room-local
     note?: string
   }
   // DesignLayout.electrical?: ElectricalPoint[]
   ```
   Absen = tanpa titik daya (perilaku kini). `x/y` absolut agar selaras ruang-koordinat editor 2D (berbeda dari `LightingFixture` yang room-local — lighting tetap milik interior plan). Floor titik = floor room-nya; titik yang room-nya terhapus → dibersihkan saat load (self-heal, pola `applySavedInterior`).

2. **Auto-generate default per tipe ruang, editable penuh.** `ELECTRICAL_DEFAULTS: Record<RoomType, DefaultSpec>` (konstanta terdokumentasi) menempatkan titik di sepanjang dinding ruang (offset ~0.3 m dari tepi, saklar dekat pintu bila ada opening di dinding ruang). Contoh: `kamar_tidur` 2 stopkontak + 1 saklar_tunggal · `dapur` 3 stopkontak + 1 stopkontak_daya + 1 saklar_tunggal · `kamar_mandi` 1 stopkontak + 1 saklar_tunggal (+ stopkontak_daya bila ada water heater — v1: selalu untuk kamar_mandi utama) · `ruang_keluarga`/`ruang_tamu` 2–3 stopkontak + 1 saklar (ganda bila >2 lampu) + 1 data · `workspace` +1 data. **1 `panel`** per rumah di lantai dasar dekat entrance. `autoGenerateElectrical(layout, floorId?)` mengisi ruang yang belum punya titik; tombol "Auto-generate" + placement manual keduanya ada. Non-void semua dapat titik (termasuk gudang/carport/tangga), bukan subset `SUPPORTED_INTERIOR_ROOMS`.

3. **Sirkuit + panel schedule (sederhana).** `buildCircuits(layout, interiors, floorId)`: auto-grup per lantai — **1 sirkuit penerangan** (semua lampu lantai itu), **1 sirkuit stopkontak umum** (semua stopkontak), **1 sirkuit khusus per `stopkontak_daya`**. Estimasi beban: lampu per tipe (downlight 15 VA, pendant 25, task 20, wall_lamp 15, indirect 20, outdoor 30) × qty; stopkontak 200 VA; stopkontak_daya 900 VA (AC/pemanas). MCB per sirkuit = `ceil(VA/220 / 0.8)` → naik ke standar {2,4,6,10,16,20} A. **Panel schedule** = tabel di sheet: nama sirkuit · jumlah titik · beban VA · MCB. Penetapan sirkuit manual = non-goal v1 (auto by rule).

4. **Sheet "Rencana Listrik — <lantai>" (E-01…).** `buildElectricalPlan(layout, interiors, floorId): Drawing` — pakai ulang pola `ceiling-plan.ts` (outline ruang non-void; simbol `kind:"opening"`; label `kind:"room"`; dims/bbox SEMUA ruang). Menggambar: outline ruang; **titik lampu** dari `interiors[].lighting` (simbol silang/belah-ketupat, sama dengan Rencana Plafon); **titik daya** dari `layout.electrical` dengan simbol standar (stopkontak = lingkaran + 2 garis; saklar = lingkaran + tangkai "S"; panel = persegi ber-arsir; data = segitiga); **relasi saklar→lampu** = garis putus-putus tipis dari tiap `saklar_*` ke titik lampu di ruang yang sama (auto by room, geometri murni — tanpa field assignment eksplisit v1); **legenda simbol** + **panel schedule** (tabel via DrawLabel/DrawLine) di sisi sheet. Simbol pakai `kind:"opening"` → tanpa perubahan renderer `sheet-svg.tsx`/`STROKE_WIDTH_MM` (jalur konsisten SP3).

5. **Editor 2D: marker + inspector + tool tempatkan.** `plan-canvas.tsx` (kini tak menggambar fixture apa pun) menambah layer titik listrik saat aktif: render simbol per titik + hit-test seleksi + drag (clamp ke bounds ruang/lahan). Tool "Tambah Titik Listrik" (pilih tipe → klik denah, pola precedent tool "Tambah Ruang"). Inspector: titik terpilih → edit tipe/ruang/catatan + hapus (pola `RoomInspector`); tanpa seleksi → seksi **"Listrik"** (pola `RoofInspector`) dengan tombol Auto-generate + ringkas jumlah titik. Seleksi titik listrik = model seleksi baru di editor-store (kini hanya room/furniture).

6. **AI parity penuh** (aturan "AI menguasai semua mutasi editor"). Aksi floorplan baru: `addElectricalPoint {roomId,type,x,y}` · `moveElectricalPoint {id,x,y}` · `updateElectricalPoint {id, patch}` · `removeElectricalPoint {id}` · `autoGenerateElectrical {floorId?}`. Rantai lengkap spt `setRoof`: schema+`satisfies` enum (`actions.ts`) → sanitize (validasi roomId/id ada di scene, clamp x/y ke bounds, enum) + prompt (`editor-assistant.ts`) → dispatch (`apply.ts`) → store CRUD via `commit` (`editor-store.ts`) → `describeAction`. Scene floorplan tambah `electrical[]` sebagai grounding.

7. **RAB diperhalus (bukan baris baru).** `rab.ts:184-200`: "Instalasi titik listrik" volume = jumlah titik nyata (`layout.electrical.length + Σ lighting`) bukan `builtArea*0.6`; "Panel, MCB & grounding" tetap 1 ls tapi note menyebut jumlah sirkuit & MCB dari `buildCircuits`. Kategori `listrik`, confidence medium. Summary auto-rekonsiliasi (Σ items).

## Deliverables (sheet baru + entitas + editor + AI + RAB)

| Bagian | Artefak (pure/where) | Isi |
|---|---|---|
| Entitas | `ElectricalPoint`/`ElectricalPointType` (`types`), `layout.electrical?` | Titik daya per ruang, JSONB |
| Auto-gen + sirkuit | `src/lib/electrical/plan.ts` (`autoGenerateElectrical`, `buildCircuits`) + `electrical.ts` (harga/beban/simbol-geometri) | Default per tipe ruang; grup sirkuit + MCB/VA |
| Sheet | `src/lib/drawings/electrical-plan.ts` `buildElectricalPlan(layout, interiors, floorId)` | Denah + lampu + daya + relasi saklar→lampu + legenda + panel schedule |
| Sheet-list | `sheet-list.ts` `kind:"electrical"`, `E-01…` per lantai (setelah `C-`, sebelum `R-01`) | Halaman + PDF konsumsi sama |
| Editor | `plan-canvas.tsx` marker+drag, `editor-inspector.tsx` inspector + seksi Listrik, `editor-toolbar.tsx` tool | Tempatkan/edit/hapus/auto-gen |
| AI | `actions.ts`/`editor-assistant.ts`/`apply.ts`/`editor-store.ts` | 5 aksi + sanitize + prompt + dispatch + store CRUD undo |
| RAB | `rab.ts` | 2 baris listrik diperhalus ke hitungan nyata |
| Konstanta | `constants/index.ts` | `ELECTRICAL_POINT_TYPES` (label), `ELECTRICAL_DEFAULTS`, beban/harga |

## Testing

- **Pure:** `autoGenerateElectrical` (jumlah & tipe titik per tipe ruang; idempoten — tak dobel bila sudah ada; titik dalam bounds ruang); `buildCircuits` (grup benar, VA & MCB eksak untuk kasus contoh, sirkuit khusus per stopkontak_daya); `buildElectricalPlan` (simbol per tipe di posisi absolut; relasi saklar→lampu = garis ke lampu se-ruang; legenda + panel schedule ada; ruang void dikecualikan); `electrical.ts` beban/harga.
- **Store/AI:** CRUD undo (`add/move/update/remove`, merge + undo), sanitize clamp (roomId invalid ditolak, x/y clamp, enum), describe.
- **RAB:** volume titik listrik = hitungan nyata untuk layout contoh; summary = Σ items.
- **E2E (`e2e/drawings.spec.ts` + editor):** sheet "Rencana Listrik" tampil dgn simbol (svg text legenda + >N line); tempatkan titik via tool → marker muncul; ubah tipe atap-style tak terpengaruh (regresi SP3). Existing tests TIDAK dilemahkan.
- **Gate penuh:** tsc · vitest · build · **Playwright FULL**.

## Non-goals v1

Penetapan sirkuit manual (auto by rule dulu); single-line diagram (SLD) skematik terpisah (sheet denah dulu); perhitungan drop tegangan/kabel presisi (estimasi VA/MCB sederhana); grounding/penangkal petir detail; titik listrik lintas-lantai riser (per-lantai dulu); import/export DXF.

## Sequencing (≈8 task)

T1 `ElectricalPoint` type + `layout.electrical` + store CRUD undo (TDD) → T2 `electrical.ts` (beban/harga/simbol-geometri) + `ELECTRICAL_DEFAULTS` + `autoGenerateElectrical` (pure, TDD) → T3 `buildCircuits` + panel schedule (pure, TDD) → T4 `buildElectricalPlan` sheet (pure, TDD) → T5 sheet-list `E-` + integrasi halaman/PDF → T6 editor: marker + drag + inspector + tool + toolbar → T7 AI parity (5 aksi end-to-end) + RAB perhalus → T8 e2e + gate penuh + review akhir.

## Self-review

**Coverage:** poin 10 (semua task). **Placeholder:** tidak ada — tipe titik, default per ruang, rumus VA/MCB, simbol, urutan sheet dipatok. **Konsistensi:** `ElectricalPoint` T1 ↔ T2-T7; `buildElectricalPlan(layout,interiors,floorId)` selaras signature `SheetListEntry.build`; simbol `kind:"opening"` = jalur SP3 (tanpa sentuh renderer); RAB perhalus baris existing (tanpa dobel kategori). **Risiko diketahui:** T6 (marker+seleksi titik di editor 2D) = UI net-new terbesar (plan-canvas kini tak punya seleksi non-room) → dipecah tugas sendiri; koordinat absolut titik ↔ carry-over SP3 "footprint" tak terpengaruh (titik pakai posisi absolut, bukan luas).
