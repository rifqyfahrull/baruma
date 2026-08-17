# SP2 — Rencana Kusen + Detail Pintu/Jendela

**Date:** 2026-07-03
**Status:** Design (awaiting review)
**Covers:** checklist poin **6 (Gambar Rencana Kusen)** dan **7 (Detail Desain Pintu)**. Bagian dari [master roadmap](2026-07-03-master-roadmap-dokumen-kerja.md); dibangun DI ATAS pola sheet SP1 (Drawing → SheetSvg/PDF, halaman Gambar Kerja, gate e2e).

## Context

Data kusen sudah lengkap di `layout.openings` (`type door|window`, `positionM` [center], `widthM`, `heightM`, wallId per ruang/sisi) — SP1 sudah memproyeksikannya ke tampak/potongan via `openingSegment`. Yang belum ada: **deliverable kusen** — penomoran tipe (P1/J1…), rencana penempatan di denah, daftar (schedule), gambar detail per tipe, dan harga kusen di RAB yang diturunkan dari jumlah nyata.

## Keputusan desain

- **Penomoran tipe deterministik:** grup openings by `(type, widthM, heightM)`. Pintu → `P1, P2, …` (urut lebar desc, lalu tinggi desc); jendela → `J1, J2, …`. Kode stabil untuk layout yang sama.
- **Sill konsisten SP1:** pintu 0, jendela `WINDOW_SILL_M` (0,9 m) — detail jendela mencantumkan sill.
- **Arah bukaan daun pintu belum ada di data** → detail pintu memakai simbol swing generik 90° (busur) tanpa kiri/kanan; field arah menyusul bila dibutuhkan (non-goal v1).
- **Harga kusen di RAB:** tabel harga per-unit parametrik ukuran & jenis, berskala `FinishingLevel` (standar/menengah/premium), konstanta terdokumentasi di modul (mis. pintu: base 850rb/1,4jt/2,4jt × faktor luas daun; jendela: base 450rb/750rb/1,3jt × faktor luas). Baris kusen per tipe **menggantikan** alokasi generik pintu/jendela yang ada di `generateRAB` dan sisa share arsitektur menyerap delta sehingga ringkasan tetap rekonsiliasi (baca rab.ts saat plan).

## Arsitektur (semua pure-first, pola SP1)

### 1. `src/lib/drawings/kusen.ts` — model & schedule (pure)
```ts
export type KusenType = {
  code: string                 // "P1" | "J2" …
  openingType: "door" | "window"
  widthM: number
  heightM: number
  count: number
  perFloor: Record<string, number>   // floorId → jumlah
  openingIds: string[]
}
export function kusenSchedule(layout: DesignLayout): KusenType[]
export function kusenCodeByOpeningId(layout: DesignLayout): Map<string, string>
```

### 2. `src/lib/drawings/kusen-plan.ts` — `buildKusenPlan(layout, floorId): Drawing`
Denah top-view satu lantai: outline ruang (rect per ruang non-void), garis bukaan pada dinding (via `openingSegment`) + **label kode kusen** di tiap bukaan; dimensi keliling sederhana (chain x & y batas ruang); judul "Rencana Kusen — <nama lantai>".

### 3. `src/lib/drawings/kusen-schedule-sheet.ts` — `buildKusenScheduleDrawing(layout): Drawing`
Tabel sebagai Drawing (grid `DrawLine` + sel `DrawLabel`): kolom Kode · Jenis · Lebar · Tinggi · Jumlah · per-Lantai. Judul "Daftar Kusen". (Pure → paritas PDF gratis.)

### 4. `src/lib/drawings/kusen-detail.ts` — `buildKusenDetails(layout): Drawing[]`
Per `KusenType` satu panel detail elevasi parametrik: rangka kusen (frame double-line), daun (pintu: panel + busur swing generik; jendela: silang simbol bukaan + garis sill), dimensi lebar×tinggi (+ sill utk jendela), label kode + ukuran. Panel disusun ke sheet (maks 6 panel/sheet, lanjut sheet berikutnya); judul "Detail Kusen (1/n)".

### 5. Integrasi halaman Gambar Kerja
Sidebar sheet menjadi **dinamis**: [4 tampak, 2 potongan] + `Rencana Kusen` per lantai (K-01…), `Daftar Kusen`, `Detail Kusen (1/n)`. Penomoran sheet berlanjut (A-01…A-06, K-01…). Testid pola sama (`sheet-tab-<id>`).

### 6. PDF `drawings_pack`
`defaultSheets(layout)` diperluas: tampak+potongan+kusen (rencana per lantai, daftar, detail). Halaman PDF bertambah otomatis; paritas via `sheetPlacement` (tak berubah).

### 7. RAB
`generateRAB` (mock/lib): baris per `KusenType` di kategori `arsitektur` — `item: "Kusen ${code} — ${jenis} ${w}×${h}"`, `volume: count`, `unit: "unit"`, harga per tabel finishing; alokasi generik pintu/jendela lama dihapus/disesuaikan agar total tetap = summary (mekanisme rekonsiliasi existing dipertahankan).

## Testing

- **Unit:** `kusenSchedule` (grouping, kode stabil, count per lantai); `buildKusenPlan` (label kode di posisi openingSegment); schedule drawing (baris = jumlah tipe, sel benar); `buildKusenDetails` (panel per tipe, dimensi benar, paging >6); RAB kusen (baris per tipe, total rekonsiliasi).
- **E2E (`e2e/drawings.spec.ts` diperluas atau `kusen.spec.ts`):** sheet "Daftar Kusen" tampil dengan kode P1/J1 sesuai jumlah bukaan demo; klik sheet Rencana Kusen → svg berisi label kode; PDF tetap terunduh (jumlah halaman bertambah).
- **Gate penuh:** `rtk tsc` · `npx vitest run` · `npx next build` · `pnpm exec playwright test` (SELURUH suite).

## Non-goals v1

Arah bukaan kiri/kanan; material kusen per-opening (harga via finishing level dulu); penanda kusen di kanvas editor interaktif (cukup di sheet); DXF.

## Sequencing

T1 `kusen.ts` (schedule+codes, TDD) → T2 `kusen-plan.ts` (TDD) → T3 schedule-sheet + detail (TDD) → T4 integrasi halaman (sheet dinamis) → T5 PDF + RAB → T6 e2e → T7 gate penuh + review akhir.
