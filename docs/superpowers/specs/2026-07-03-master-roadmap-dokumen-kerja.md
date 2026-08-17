# Master Roadmap — Baruma "Dokumen Kerja Lengkap" (15 poin deliverable)

**Date:** 2026-07-03
**Status:** Approved direction (user), executed sub-project by sub-project
**Goal:** memenuhi SEMUA 15 poin checklist deliverable arsitektur. Setiap sub-projek (SP) punya siklus sendiri: brainstorm → spec → plan → subagent-driven build → gate (tsc + full tests + build) → push `main`.

## Prinsip arsitektur (mengikat semua SP)

1. **Satu sumber kebenaran:** `DesignLayout` + interior plan + entitas MEP/struktur baru — semua JSONB (tanpa migrasi schema berat). Deliverable adalah **turunan** (derived views), tidak pernah data duplikat.
2. **Pola "sheet":** semua gambar kerja dirender sebagai sheet SVG (kertas virtual + title block + skala + dimensi) di halaman **Gambar Kerja** (`/projects/[id]/drawings`), dan diekspor PDF lewat pipeline exports yang sudah ada (`src/lib/exports/`).
3. **Pola modul entitas** (dari modul lighting yang terbukti): pure builders → room-plan helpers → store CRUD undo-aware → marker 2D + inspector → **AI parity penuh** (setiap mutasi editor punya aksi asisten) → injeksi item RAB.
4. **Aturan mutu repo:** tested = `rtk tsc` 0 + `npx vitest run` full hijau + `npx next build` sukses → langsung push `main` (auto-deploy + migration runner).

## Status checklist → SP mapping

| # | Poin | Status kini | SP |
|---|---|---|---|
| 1 | Denah Fungsional Estetis | ✅ ada | diperkuat berkelanjutan |
| 2 | Visualisasi 3D Eksterior Realistis | ⚠️ skematik | **SP6** (web-PBR: tekstur, matahari, bayangan) |
| 3 | Detail Elevasi Bangunan Presisi | ⚠️ dimensi 2D saja | **SP1** (gambar tampak berdimensi) |
| 4 | Gambar Potongan Teknis | ❌ | **SP1** |
| 5 | Denah Pola Lantai | ⚠️ material saja | **SP3** |
| 6 | Gambar Rencana Kusen | ⚠️ data saja | **SP2** |
| 7 | Detail Desain Pintu | ❌ | **SP2** |
| 8 | Detail Atap | ⚠️ bentuk 3D saja | **SP3** |
| 9 | Detail Plafon | ⚠️ material saja | **SP3** |
| 10 | Instalasi Listrik & Titik Lampu | ⚠️ titik lampu saja | **SP4** |
| 11 | Instalasi Air Bersih & Pembuangan | ❌ | **SP5** |
| 12 | Detail Sumur Resapan & Septic Tank | ❌ | **SP5** |
| 13 | Desain Bak Kontrol Air Limbah | ❌ | **SP5** |
| 14 | Estimasi RAB Detail | ✅ ada | tiap SP menyuntik item RAB |
| 15 | Perencanaan Struktur Bangunan | ⚠️ catatan saja | **SP6** |

## Sub-projek (urutan eksekusi — keputusan user)

### SP1 — Gambar Tampak & Potongan (poin 3, 4) ← MULAI DI SINI
Proyeksi ortografik otomatis dari `DesignLayout`: 4 tampak (U/S/T/B) + potongan pada sumbu pilihan. Halaman **Gambar Kerja** (hub sheet) + export PDF. Spec terpisah: `2026-07-03-sp1-tampak-potongan-design.md`.

### SP2 — Rencana Kusen + Detail Pintu/Jendela (poin 6, 7)
Schedule kusen otomatis dari `openings` (tipe P1/P2/J1…, ukuran, jumlah, per lantai), penanda tipe di denah, gambar detail elevasi tiap tipe kusen (parametrik: daun, arah bukaan, material), sheet + PDF, masuk RAB (harga kusen per tipe).

### SP3 — Pola Lantai + Plafon + Atap (poin 5, 8, 9)
- **Pola lantai:** ukuran tile dari material terpilih → grid pola per ruang (start point, orientasi), hitung kebutuhan tile + waste, sheet per lantai.
- **Plafon:** rencana plafon per ruang (level, material, drop-ceiling opsional), sheet.
- **Atap:** parameter atap di project/layout (tipe: pelana/limasan/datar, kemiringan, overhang, material) → geometri 3D ikut + sheet detail atap parametrik. (SP1 merender atap apa adanya; SP3 memperkaya parameternya.)

### SP4 — Instalasi Listrik & Titik Lampu (poin 10)
Perluasan modul lighting: entitas `ElectricalPoint` (stopkontak/saklar/panel/data) per ruang — **auto-generate default per tipe ruang, lalu editable penuh** (keputusan user), grouping sirkuit sederhana, sheet rencana listrik per lantai dengan simbol standar, item RAB, AI parity.

### SP5 — Air Bersih/Kotor + Septic/Resapan/Bak Kontrol (poin 11, 12, 13)
Entitas titik air (kloset/wastafel/shower/kran/floor-drain — auto dari tipe ruang + editable), jalur pipa skematik per lantai (supply & waste) + riser diagram; objek lahan: **septic tank, sumur resapan, bak kontrol** (posisi di site, dimensi parametrik dari jumlah penghuni — koefisien SNI), gambar detail standar parametrik untuk ketiganya, item RAB, AI parity.

### SP6 — Struktur + 3D Realistis (poin 15, 2)
- **Struktur (keputusan user: perhitungan teknik sungguhan):** modul kalkulasi berbasis SNI yang disederhanakan untuk rumah ≤3 lantai — load takedown per kolom (SNI 1727 beban), penentuan grid kolom dari denah (bentang maksimum), cek dimensi kolom/balok praktis (SNI 2847 pendekatan), rekomendasi pondasi dari input daya dukung tanah (σ). **Semua asumsi & langkah hitung ditampilkan** di sheet perhitungan; setiap output membawa keterangan tetap: *"Perhitungan pendekatan — wajib diverifikasi insinyur struktur berlisensi sebelum konstruksi (persyaratan PBG)."* Sheet: rencana pondasi, kolom, balok per lantai + tabel perhitungan.
- **3D realistis (web-PBR):** tekstur PBR per preset material (dinding/lantai/atap/kaca), pencahayaan matahari + langit (posisi matahari bisa diatur), bayangan lembut, AO — real-time three.js, tanpa infra render server.
- **PRASYARAT (carry-over dari SP3):** unifikasi model **"building footprint" bersama** — kini luas berbasis-baris di RAB (atap/pondasi/sloof/rooftop) memakai `site.areaM2` (seluruh kavling) sedangkan geometri atap 2D/3D memakai bbox ruang; keduanya harus dari satu model footprint. Load-takedown struktur SP6 memaksa model ini ada → sekalian rebasis semua baris RAB berbasis-luas + span/luas atap ke sana (magnitudo nyata: ~2,6× pada fixture 64 vs 24,5 m²).

## Ledger progres (diisi setiap SP selesai)

- [x] SP1 Tampak & Potongan — SELESAI 2026-07-03 (merge 3dda4a8; gate: tsc 0 · vitest 303 · build OK · Playwright 36/36; follow-ups minor dicatat di review akhir)
- [x] SP2 Kusen & Pintu/Jendela — SELESAI 2026-07-03 (merge 0870cf2; gate: tsc 0 · vitest 367 · build OK · Playwright 38/38; limitasi terdokumentasi: kode P/J stabil per-layout [bukan antar-revisi], RAB kusen = data nyata)
- [x] SP3 Pola Lantai/Plafon/Atap — SELESAI 2026-07-04 (merge 56eb2c8; gate: tsc 0 · vitest 465 · build OK · Playwright 40/40; review akhir opus: Yes. Deliverable: sheet Pola Lantai + Rencana Plafon per lantai, parameter atap end-to-end [editor+AI+3D pelana/limasan+tampak/potongan+Detail Atap], RAB atap material, sheet-list bersama page↔PDF. Carry-over: prasyarat SP6 unifikasi building-footprint [luas RAB vs bbox gambar])
- [x] SP4 Listrik — SELESAI 2026-07-04 (merge cce7d9f; gate: tsc 0 · vitest 544 · build OK · Playwright 42/42; review akhir opus: Yes. Deliverable: ElectricalPoint editable di editor 2D [marker+inspector+tool+drag], auto-generate default per tipe ruang, sheet Rencana Listrik per lantai [daya+lampu+relasi saklar→lampu+legenda+panel schedule], sirkuit+MCB, AI parity 5 aksi, RAB titik listrik diperhalus. Follow-up: thread interiors ke RAB route utk lamp count akurat [kini fallback estimasi]; reproject x/y saat reassign ruang.)
- [x] SP5 Air & Sanitasi — SELESAI 2026-07-04 (merge 83ef01a; gate: tsc 0 · vitest 660 · build OK · Playwright 44/44; review akhir opus: Yes. Deliverable: WaterPoint editable di editor 2D + objek sanitasi lahan [septic/resapan/bak-kontrol] berukuran SNI yang digeser, sheet Rencana Air per lantai [fixtures+pipa+schedule] + Diagram Riser + 3 detail parametrik SNI [disclaimer verifikasi ahli], sizing SNI 2398/8456 [occupants=kt×2], AI parity 7 aksi, RAB titik air + septic/resapan/bak-kontrol. Follow-up: unify footprint atap [RAB soakwell site.areaM2 vs sheet bbox — sama dgn prasyarat SP6 footprint]; extract roofCatchmentArea bersama; pindah normalize ke drawings/normalize.ts.)
- [x] SP6 Struktur & 3D Realistis — SELESAI 2026-07-04 (merge 276d77d; gate: tsc 0 · vitest 771 · build OK · Playwright 47/47; review akhir opus: Yes. Deliverable: STRUKTUR — input σ editable+AI, grid kolom dari denah, load takedown SNI 1727, dimensi kolom/balok SNI 2847, pondasi telapak dari σ, sheet Rencana Pondasi/Kolom/Balok + Tabel Perhitungan [disclaimer wajib insinyur berlisensi/PBG], RAB struktur volume beton nyata + UNIFIKASI FOOTPRINT [tutup OPEN ITEM SP3/SP5 — atap/soakwell dari footprint bangunan]; 3D — shadows + matahari/langit prosedural + kontrol, tekstur PBR prosedural nol-aset-eksternal, soft shadows, toggle Realistis. Follow-up: roofAreaOf sheet sanitasi unify ke buildingFootprintArea; SoftShadows→PCFSoft bila laporan GPU-lemah.)

## === SEMUA 15 POIN CHECKLIST ARSITEKTUR TUNTAS (SP1–SP6) ===
