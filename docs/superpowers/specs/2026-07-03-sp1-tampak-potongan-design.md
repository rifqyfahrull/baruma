# SP1 — Gambar Tampak (Elevations) & Potongan (Sections)

**Date:** 2026-07-03
**Status:** Design (awaiting review)
**Covers:** checklist poin **3 (Detail Elevasi Bangunan Presisi)** dan **4 (Gambar Potongan Teknis)**. Bagian dari [master roadmap](2026-07-03-master-roadmap-dokumen-kerja.md) — SP pertama; juga membangun fondasi **pola sheet** yang dipakai SP2–SP6.

## Context

Geometri bangunan sudah lengkap di `DesignLayout` (lantai + `heightM`, ruang + posisi/dimensi/zona/level, bukaan dengan `wallId="roomId:side"`, `positionM/widthM/heightM`, rooftop, kolam) dan sudah dirender 3D (`build-model.ts`). Yang belum ada: **proyeksi ortografik 2D** — gambar tampak 4 sisi dan potongan — sebagai deliverable teknik berdimensi. Pipeline export (jsPDF) dan pola kanvas SVG (plan-canvas, dimension-layer) sudah tersedia untuk ditiru.

## Keputusan desain

- **Turunan murni:** tampak/potongan dihitung on-the-fly dari layout (fungsi pure, tanpa penyimpanan gambar). Posisi garis potong = state UI (default tengah bangunan), tidak dipersist di v1.
- **Sill bukaan (data belum ada):** pintu mulai dari lantai (sill 0); jendela sill **0,9 m** (konstanta `WINDOW_SILL_M`), tinggi sesuai `heightM`. (Field sill per bukaan menyusul bila dibutuhkan; konstanta ini satu-satunya asumsi baru.)
- **Atap dirender apa adanya** (slab datar + volume rooftop, sesuai model 3D kini). Parameter atap kaya (pelana/limasan/kemiringan) datang di SP3 — modul proyeksi ini tinggal mengonsumsinya nanti.
- **Skala & dimensi:** sheet virtual A3 landscape, skala otomatis (fit + skala arsitek terdekat 1:50/1:100/1:200, tertera di title block); dimensi memakai `formatLength` (default mm) — rantai dimensi horizontal (lebar per segmen + total) dan **marker elevasi vertikal** (±0.00, +tinggi tiap lantai, ring atap) di tampak/potongan.

## Arsitektur (unit terisolasi)

### 1. `src/lib/drawings/types.ts` — kontrak data gambar (pure)
```ts
type DrawLine = { x1: number; y1: number; x2: number; y2: number; kind: "outline"|"slab"|"opening"|"ground"|"cut"|"hidden" }
type DrawLabel = { x: number; y: number; text: string; kind: "room"|"level"|"title" }
type DimChain = { axis: "x"|"y"; at: number; points: number[] }   // rantai dimensi
type LevelMark = { y: number; label: string }                      // ±0.00, +3.50 …
type Drawing = { widthM: number; heightM: number; lines: DrawLine[]; labels: DrawLabel[]; dims: DimChain[]; levels: LevelMark[]; title: string }
```
Semua koordinat dalam **meter dunia-gambar** (x kanan, y ke atas); renderer yang membalik sumbu untuk SVG.

### 2. `src/lib/drawings/elevation.ts` — `buildElevation(layout, site, side: "n"|"s"|"e"|"w"): Drawing`
- Sumbu proyeksi: tampak U/S memproyeksikan sumbu-x denah; T/B memproyeksikan sumbu-y (di-mirror sesuai arah pandang).
- **Siluet bangunan:** untuk tiap lantai reguler, ambil interval ruang yang ter-okupansi pada sumbu proyeksi (union interval) → garis dinding luar per lantai (tinggi kumulatif `heightM` + tebal slab), slab lines, atap (slab) + volume rooftop bila ada. Split-level (`levelOffsetM`) menggeser garis lantai ruang terkait pada tampak.
- **Bukaan pada fasad:** bukaan tampil bila dindingnya menghadap arah pandang **dan eksterior** (tak ada ruang tetangga pada sisi itu — reuse `roomsAdjacentOnSide`). Posisi horizontal = proyeksi `positionM` di dinding; vertikal = sill (0 / 0,9) + `heightM`. Digambar sebagai rect `kind:"opening"`.
- **Ground line + dimensi:** garis tanah, rantai dimensi horizontal (tepi bangunan + tepi bukaan), `levels` per lantai (dari kumulatif `heightM`) dengan label `formatElevation`.
- Ruang `OPEN_TYPES` (taman/carport tanpa dinding) tidak menyumbang siluet dinding, hanya slab.

### 3. `src/lib/drawings/section.ts` — `buildSection(layout, site, cut: { axis: "x"|"y"; positionM: number }): Drawing`
- Bidang potong vertikal pada `positionM`. Untuk tiap lantai: ruang yang terpotong (interval pada sumbu tegak lurus) → dinding terpotong (garis tebal `kind:"cut"`), slab atas/bawah, void antar dinding = ruang (label nama ruang + elevasi), bukaan yang terpotong tampil sebagai celah bertinggi sill+heightM.
- Split-level: lantai ruang digeser `levelOffsetM`; riser tampak sebagai step slab.
- `levels` + rantai dimensi vertikal (floor-to-floor) + horizontal (lebar ruang terpotong).
- Garis potong juga digambar di mini-denah pemilih (lihat UI) sebagai penanda A-A / B-B.

### 4. `src/components/drawings/sheet-svg.tsx` — renderer sheet (reusable semua SP)
- Props: `drawing: Drawing`, `sheetNo`, `scaleHint?`. Kertas A3 landscape virtual (420×297), margin, border, **title block** (nama projek, judul gambar, skala "1:N", tanggal, nomor lembar), auto-fit skala arsitek (50/100/200), grid halus opsional.
- Zoom/pan ringan (pola plan-canvas). Semua stroke pakai kelas theme-aware.

### 5. Halaman `/app/projects/[projectId]/drawings` — hub "Gambar Kerja"
- Sidebar daftar sheet: **Tampak Utara / Selatan / Timur / Barat, Potongan A-A (x), Potongan B-B (y)** (+ tempat SP berikutnya menambah sheet).
- Viewer menampilkan sheet terpilih; untuk potongan ada **mini-denah** dengan garis potong yang bisa digeser (slider posisi + pilih sumbu).
- Membaca layout via `useLayout` + draft live editor (pola `pickEffectiveLayout` yang sudah ada) — gambar selalu sinkron dengan editan terakhir.
- Entri menu proyek: tautan "Gambar Kerja" di navigasi projek (samping Editor/Preview 3D/Exports).

### 6. Export PDF — `src/lib/exports/drawings-pack.ts`
- `buildDrawingsPdf(project, layout)` — render 6 sheet default (4 tampak + 2 potongan tengah) ke jsPDF A3 landscape: serialisasi SVG sheet → canvas → PNG → `addImage` per halaman (pola contractor-pack).
- Format export baru `drawings_pack` di halaman Exports (+ ikut `zip_all`).

## Testing (pure-first)

- `buildElevation`: tinggi siluet = Σ heightM + slab; bukaan eksterior muncul dengan x/lebar/sill benar; bukaan interior TIDAK muncul; sisi T/B termirror benar; split-level menggeser garis; levels berlabel benar (±0.00, +3.50…).
- `buildSection`: ruang terpotong terdeteksi benar untuk cut x/y; dinding cut vs void; bukaan terpotong jadi celah; dimensi floor-to-floor benar.
- Sheet/PDF: verifikasi tsc/build + manual (unit test untuk auto-scale picker: fit → 1:50/100/200).
- Halaman: smoke manual (sheet tampil, garis potong digeser → potongan berubah).

## Rollout

Tanpa migrasi DB. Gate: `rtk tsc` · `npx vitest run` · `npx next build` → push `main`. Manual: buka Gambar Kerja pada projek berlantai 2 dengan jendela/pintu + split-level → 4 tampak & 2 potongan berdimensi; export PDF berisi 6 sheet.

## Non-goals SP1

- Parameter atap kaya (SP3), hatch material fasad, anotasi manual di sheet, persist posisi garis potong, DXF (slot export sudah ada, menyusul).
