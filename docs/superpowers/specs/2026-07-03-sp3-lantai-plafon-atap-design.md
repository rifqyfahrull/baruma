# SP3 — Denah Pola Lantai + Detail Plafon + Detail Atap

**Date:** 2026-07-03
**Status:** Design (awaiting review)
**Covers:** checklist poin **5 (Denah Pola Lantai)**, **8 (Detail Atap)**, **9 (Detail Plafon)**. Bagian dari [master roadmap](2026-07-03-master-roadmap-dokumen-kerja.md); melanjutkan pola sheet SP1/SP2 (pure `Drawing` → SheetSvg/PDF → halaman Gambar Kerja → gate e2e penuh).

## Context

- **Lantai:** interior sudah memberi `MaterialAssignment` per ruang (permukaan `floor` + `areaM2` + material id/nama) — tapi belum ada **gambar pola pemasangan** (grid tile, start point, hitungan kebutuhan + waste).
- **Plafon:** material plafon + luas sudah dihitung interior; **titik lampu per ruang sudah ada** (modul lighting). Belum ada **rencana plafon** (ketinggian, material, titik lampu) sebagai gambar.
- **Atap:** 3D merender slab datar; belum ada parameter atap (tipe/kemiringan/overhang/material) maupun **gambar detail atap**.

## Keputusan desain

1. **Ukuran tile dari katalog konstanta** (`TILE_SIZES: Record<materialId-prefix, {w,h}>` + fallback 0,4×0,4 m) — tanpa perubahan data-model; material lantai ruang menentukan grid. Start point pola: sudut kiri-atas ruang (konvensi v1, terdokumentasi); orientasi mengikuti sumbu ruang.
2. **Rencana plafon memuat titik lampu** dari interior plan (posisi fixture per ruang, simbol per jenis) — plafon sheet jadi berguna nyata dan memanfaatkan data yang ada. Ketinggian plafon = `floor.heightM − 0,4 m` (asumsi struktur+plafon, konstanta terdokumentasi) + `levelOffsetM` ruang; label per ruang `±h`. Drop-ceiling per ruang: **non-goal v1** (butuh field baru; menyusul).
3. **Parameter atap baru di layout (JSONB-safe, optional):**
   ```ts
   // DesignLayout
   roof?: { type: "datar" | "pelana" | "limasan"; slopeDeg: number; overhangM: number; material: "genteng_beton" | "genteng_keramik" | "metal" | "aspal" }
   ```
   Default bila absen: `datar` (perilaku kini). Editor: kontrol "Atap" kecil di panel Properti saat TIDAK ada objek terpilih (default panel) — pilih tipe, kemiringan (15–40°), overhang (0–1 m), material. **AI parity:** aksi floorplan `setRoof { patch }` (schema+sanitize+describe+apply) — sesuai aturan "AI menguasai semua mutasi editor".
4. **3D mengikuti:** `PrimKind` baru `"roof_gable"`/`"roof_hip"` — prisma segitiga/limas dirender komponen geometry khusus di house-model (bukan box); `build-model` memancarkan prim atap sesuai `roof.type` (datar = slab kini). Ini perubahan 3D terkontrol; fotorealisme tetap SP6.
5. **Tampak/Potongan ikut:** `buildElevation`/`buildSection` menggambar profil atap miring (segitiga/trapesium) bila `roof.type ≠ datar` — murni 2D, mudah dites.
6. **RAB:** baris atap existing ("Atap (rangka + penutup)") disesuaikan materialnya (harga per m² per material × luas miring = footprint × faktor kemiringan `1/cos(slope)` + overhang); baris pola lantai TIDAK dobel (material lantai sudah dihitung interior — pola lantai hanya deliverable gambar + info kebutuhan tile di sheet, bukan baris RAB baru).

## Deliverables (sheet baru di Gambar Kerja + PDF)

| Sheet | Builder (pure) | Isi |
|---|---|---|
| **Pola Lantai — <lantai>** (L-01…) | `buildFloorPatternPlan(layout, interiors, floorId)` | Denah ruang + grid tile per ruang (garis pola dari start-corner, ukuran dari material), label ruang: nama material + ukuran tile + kebutuhan (`ceil(area/tileArea × 1.1)` pcs, waste 10%) |
| **Rencana Plafon — <lantai>** (C-01…) | `buildCeilingPlan(layout, interiors, floorId)` | Denah ruang + simbol titik lampu (jenis), label per ruang: material plafon + tinggi `+2,60` dsb |
| **Detail Atap** (R-01) | `buildRoofDetail(layout)` | Potongan atap parametrik: profil kemiringan, overhang, susunan (kuda-kuda skematik, gording, penutup sesuai material), dimensi + catatan material; utk `datar`: detail atap datar (screed, waterproofing) |

`interiors` = interior plan (untuk material lantai/plafon + titik lampu); bila belum ada interior utk suatu ruang → fallback material default (terdokumentasi), sheet tetap tergenerate.

## Testing

- Pure: grid tile (jumlah garis & offset utk ruang w×d dgn tile 0,4), kebutuhan tile + waste; ceiling plan (simbol lampu di posisi fixture, label tinggi dgn levelOffset); roof detail (geometri profil per tipe/kemiringan/overhang; datar vs pelana); elevation/section dengan atap miring (puncak = run×tan(slope)); build-model prim atap per tipe; sanitize `setRoof`.
- E2E: sheet Pola Lantai & Rencana Plafon & Detail Atap tampil dgn konten nyata; ubah tipe atap di editor → tampak berubah (opsional bila cepat); PDF bertambah halaman.
- Gate penuh: tsc · vitest · build · **Playwright FULL**.

## Non-goals v1

Drop-ceiling per ruang; pola diagonal/herringbone (grid lurus dulu); kalkulasi struktur kuda-kuda (SP6); fotorealisme 3D (SP6); start-point pola custom.

## Sequencing (≈8 task)

T1 tile-pattern pure → T2 ceiling-plan pure → T3 roof params (type+schema+editor UI+AI setRoof) → T4 roof di build-model (prim baru + house-model geometry) → T5 roof di elevation/section + `buildRoofDetail` → T6 integrasi halaman+PDF (sheet L/C/R) + RAB atap → T7 e2e → T8 gate penuh + review akhir.
