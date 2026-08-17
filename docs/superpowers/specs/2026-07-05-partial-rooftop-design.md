# Partial Rooftop — deck sebagian + atap pada sisa footprint

**Date:** 2026-07-05
**Status:** Design (menunggu approval user)
**Goal:** Rumah ber-rooftop bisa punya deck **sebagian** — area deck ditentukan rect eksplisit; sisa footprint ditutup atap sesuai `layout.roof` (datar/pelana/limasan). Semua turunan (3D, tampak/potongan/detail atap, RAB, struktur) konsisten dari satu sumber kebenaran.

## Konteks (kondisi kini)

- `project.rooftop: boolean` → `generateLayout` menambah `floor-rooftop` (deck terbuka); build-model (fix 863807f) mendudukkan slab deck **seluruh footprint** persis di atas lantai reguler teratas — deck = atap datar bangunan; toggle "Tampilkan atap" disembunyikan (redundan).
- Rumah non-rooftop: atap dari `layout.roof` (SP3: type/slopeDeg/overhangM/material) di-emit saat `showRoof`.
- Footprint bersama: `buildingFootprint`/`buildingFootprintArea` (`src/lib/structural/grid.ts`) = bbox ruang non-rooftop — dipakai grid struktur, sheet, RAB atap.
- Garis RAB rooftop kini pakai **luas kavling** (waterproofing) & keliling kavling (railing) — akan dibetulkan ke deck.

## Keputusan desain (user-locked, 2026-07-05)

1. **Area deck = rect eksplisit** `layout.rooftopArea` — bukan diturunkan dari ruang.
2. **Atap sisa mengikuti `layout.roof`** (datar/pelana/limasan yang sudah ada).
3. **Cakupan v1 lengkap**: 3D + gambar kerja (tampak/potongan/detail atap) + RAB + beban struktur.
4. **Toggle "Tampilkan atap"** muncul lagi pada rumah partial-rooftop dan mengontrol **bagian atap (non-deck) saja**; deck+railing selalu tampil. Full-rooftop tetap tanpa toggle; non-rooftop tak berubah.

## Model data

```ts
// DesignLayout (JSONB, tanpa migrasi berat)
rooftopArea?: { x: number; y: number; width: number; depth: number } // meter, koordinat site (sama dgn rooms)
```

- Hanya bermakna saat layout punya `floor-rooftop`. **Absent = deck penuh** (perilaku kini; back-compat total).
- Disimpan ter-clamp ke `buildingFootprint`; min 1,5 m per dimensi.
- **Partial** ⇔ `rooftopArea` ada DAN luasnya < luas footprint − ε. `rooftopArea` == footprint diperlakukan full.

## Geometri: `rooftopStrips()` (pure, unit-testable)

`rooftopStrips(footprint, deck)` → dekomposisi `footprint − deck` menjadi ≤ 4 rect (guillotine): strip **U** (utara, lebar penuh), **S** (selatan, lebar penuh), **B**/**T** (barat/timur, setinggi deck). Aturan atap per strip:

- `datar` → slab per strip (SLAB_T).
- `pelana`/`limasan` → prisma per strip (reuse `GablePrism`/`HipPyramid`): ridge sepanjang dimensi TERPANJANG strip; rise = `(spanPendek/2 + overhang) · tan(slope)` — formula build-model kini, per-strip.
- **Overhang hanya ke arah tepi footprint** (strip di-expand `overhangM` pada sisi yang menempel batas footprint; sisi yang berbatasan deck TIDAK — agar tak menabrak deck/railing).
- Strip dengan dimensi terpendek **< 1,0 m selalu datar** (hindari prisma degenerate).

## 3D (build-model + preview)

- Deck: slab hanya seluas `rooftopArea` (posisi rx/rz spt ruang); **railing keliling deck** (bukan site).
- Strip atap: prim `roof`/`roof_gable`/`roof_hip` per strip, digate `opts.showRoof`; `floorId = topFloorId` (lantai reguler teratas).
- `height` framing: max(puncak strip tertinggi, deck + railing) + headroom.
- Toggle preview: tampil bila non-rooftop ATAU partial; helper bersama `isPartialRooftop(layout)`.

## Editor 2D + AI parity

- **Kanvas** (lantai Rooftop aktif): overlay rect deck semi-transparan + label "Deck rooftop", drag pindah + resize handle sudut, snap 0,1 m, clamp ke footprint — pola drag objek sanitasi SP5.
- **RoofInspector** (section Atap): saat `project.rooftop` → sub-section "Rooftop" dgn pilihan **Deck penuh / Deck sebagian**; saat sebagian: input X, Y, Lebar, Dalam (m, aria-label lengkap) + ringkasan luas deck vs luas atap.
- **Store**: `setRooftopArea(rect | undefined)` undo-aware (pola roof params SP3).
- **Validation**: warning bila ruang di `floor-rooftop` berada di luar deck ("Ruang rooftop di luar area deck").
- **AI**: aksi `set_rooftop_area {x,y,width,depth}` + `clear_rooftop_area` (deck penuh) — parity penuh + test.

## Gambar kerja + RAB + struktur

- **Tampak** (`elevation.ts`): railing hanya sepanjang proyeksi deck; profil strip (pelana=segitiga/trapesium, datar=garis slab) per arah pandang.
- **Potongan** (`section.ts`): garis potong melintasi deck → slab deck; melintasi strip → profil atap strip.
- **Detail Atap** (`roof-detail.ts`): denah atap — area deck (hatch + label) + strip (ridge/arah kemiringan) + dimensi `rooftopArea` + keliling railing.
- **`roofAreaOf`** (`sheet-list.ts`) & RAB atap: Σ luas strip × faktor kemiringan (datar: ×1).
- **RAB rooftop**: waterproofing = **luas deck** (bukan kavling); railing = **keliling deck**.
- **Struktur** (SNI 1727): beban hidup rooftop dikenakan pada luas deck; beban atap pada luas strip; tabel perhitungan mencantumkan pembagiannya (disclaimer insinyur tetap).

## Non-goals v1

Deck multi-rect / bentuk-L; overhang asimetris per sisi diatur user; atap berbeda per strip; tangga akses deck; migrasi data (JSONB, field opsional).

## Testing

Unit per modul (`rooftopStrips` dekomposisi/clamp/degenerate; build-model deck+strip+toggle; store undo; AI actions; elevation/section/roof-detail; RAB; loads). E2e: set deck sebagian via inspector → preview-3d menampilkan toggle+deck+strip, toggle OFF menyembunyikan strip; Detail Atap menampilkan deck. Gate penuh: tsc · vitest · build · Playwright FULL.

## Risiko

- Dekomposisi strip + overhang-keluar = kompleksitas geometri utama → dipusatkan di satu helper pure ber-test lengkap.
- Tampak/potongan partial-aware menyentuh renderer sheet yang padat — kerjakan per-arah dgn snapshot test angka.
- Railing 3D per tepi deck menempel strip pelana: diterima tumpang sedikit (v1), dicatat.

## Sequencing (7 task SDD)

T1 model+geometri murni → T2 3D+toggle → T3 editor (store+inspector+kanvas) → T4 AI parity → T5 tampak+potongan → T6 detail atap+RAB+struktur → T7 e2e+gate+review akhir.
