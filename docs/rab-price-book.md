# RAB Price Book — baseline & provenance

**Versi:** 2026.1 · **Berlaku:** 2026-06-01 · **Baseline region:** DKI Jakarta
(faktor regional ×1.0). Nilai di bawah adalah **harga satuan terpasang** (material
+ upah + alat) baseline DKI Jakarta 2024, lalu diskalakan per-wilayah oleh faktor
**BPS IKK 2024** (`src/lib/rab/regional-pricing.ts`).

## Acuan
- **AHSP** — SE Dirjen Bina Konstruksi No. **68/SE/Dk/2024** (Bidang Cipta Karya &
  Perumahan): koefisien tenaga/material/alat per satuan pekerjaan.
- **IKK** — BPS *Indeks Kemahalan Konstruksi Provinsi & Kabupaten/Kota 2024*
  (acuan Banjarmasin = 100).
- Harga pasar material/upah 2024 (survei toko + HSPK daerah) untuk mengisi
  koefisien AHSP → harga satuan.

## Sandingan harga satuan baseline vs referensi AHSP 2024

| Item (kode di kode) | Baseline DKI (terpasang) | Referensi AHSP/pasar 2024 | Catatan |
|---|---|---|---|
| Bata merah `1_200_000/m³` | Rp1,2 jt/m³ (≈144k/m² @t=12cm) | Pasangan bata 1:4 ≈ Rp200–250k/m² (bata+mortar+upah) | Di kode bata dipisah dari plester; bata+plester 2 sisi ≈ 274k/m² ≈ AHSP |
| Plesteran `65_000/m²` (per sisi) | Rp65k/m² | Plester 1:4 t=15mm ≈ Rp93k/m² | Baseline sedikit di bawah — konservatif; kalibrasi ulang saat harga semen naik |
| Cat `35_000/m²` | Rp35k/m² | Cat interior 2 lapis ≈ Rp30–40k/m² | Sesuai |
| Lantai keramik/granit `250k / 450k / 850k` (standar/menengah/premium) | — | Keramik 40×40 ≈ Rp315k/m²; granit/homogeneous ≈ Rp450–900k/m² | Standar = keramik ekonomis; menengah/premium = granit/HT |
| Plafon `180k / 250k / 400k` | — | Gypsum+rangka ≈ Rp180–250k/m²; PVC ≈ Rp283k/m² | Sesuai bracket |
| Struktur beton | — | lihat tabel terurai di bawah | **Diperbarui v2024.1**: lini beton terpasang lama dipecah → beton-polos + pembesian + bekisting |
| Atap genteng beton `ROOF_PRICES` (≈Rp400k/m²) | Rp400k/m² | Genteng beton terpasang ≈ Rp350–450k/m²; spandek ≈ Rp363k/m² | Sesuai |

### Struktur beton — TERURAI per komponen AHSP (v2024.1)
Lini beton kini dipecah jadi 3 komponen per elemen (pondasi telapak, kolom,
balok & sloof, plat) agar bisa dipakai kontraktor:

| Komponen | Harga baseline DKI | Referensi | Catatan |
|---|---|---|---|
| Beton polos `BETON_POLOS_IDR_M3` | Rp1.250.000/m³ | K250–300 (cor + upah, tanpa besi/bekisting) ≈ Rp1,15–1,25 jt/m³ | Sesuai AHSP beton-polos |
| Pembesian `PEMBESIAN_IDR_KG` | Rp18.500/kg | Besi tulangan + bendrat + fabrikasi + pasang ≈ Rp17–20k/kg | Volume kg = rasio × m³ beton |
| Bekisting `BEKISTING_IDR_M2` | Rp185.000/m² | Multiplek + rangka, pasang+bongkar (2× pakai) ≈ Rp150–200k/m² | Luas bidang cetak |

Rasio pembesian **tidak lagi memakai kg/m³ selimut** — dihitung dari **takeoff
batang berbasis DEMAND (bar schedule)**, `structural/rebar.ts`:
- **Kolom:** As longitudinal dari **aksial Pu** (Pu = φ[0.85 f'c(Ag−Ast)+fy·Ast], φ=0.65,
  ρ∈[1%,4%]) → n D16 + sengkang D8-150.
- **Balok:** As lentur dari **momen Mu = wu·L²/10** (wu = beban lantai × bentang tributari)
  → n D16 bawah+atas (φ=0.9, jd≈0.9d) + sengkang D8-150; **sloof** 4D12.
- **Pondasi & plat:** jaring min-steel (D13-150 / D10-150) — geometri/min-steel, bukan demand.
Berat per meter dari `REBAR_KG_PER_M` (D8 0,395 … D16 1,578 kg/m). Angka final tetap
perlu diverifikasi bar bending schedule aktual.
Luas bekisting dihitung dari geometri elemen.

## Kalibrasi berkala (jadwal update)
- **Kadens:** tinjau ulang harga baseline **tiap 6 bulan** (`PRICE_BOOK_META.reviewCadenceMonths`),
  ATAU lebih awal bila harga **semen/besi bergerak >10%**.
- **Trigger otomatis:** `isPriceBookStale()` bernilai `true` bila tanggal kini melewati
  `PRICE_BOOK_META.nextReviewDate`. Saat itu setiap RAB menampilkan baris peringatan
  "⚠ Buku harga sudah melewati jadwal tinjau — kalibrasi ulang…" di `assumptions`.
- **Langkah kalibrasi:**
  1. Ambil harga AHSP/HSPK + harga pasar semen, besi, keramik, dll terbaru.
  2. Perbarui angka baseline di `src/lib/mock/rab.ts` + `regional-pricing.ts`
     (finishing & komponen beton) dan koefisien bila perlu.
  3. Naikkan `PRICE_BOOK_META.version`, set `effectiveDate` = hari ini, `nextReviewDate` = +6 bulan.
  4. Perbarui IKK bila BPS merilis tahun baru (ganti dataset `ikk-kabkota-2024.json`
     + `IKK_2024`, sesuaikan `BASELINE_IKK`). Ingat: IKK antar-tahun **tidak** dapat
     dibandingkan langsung (basis kota acuan berbeda).
  5. Catat perubahan di changelog di bawah.

### Changelog buku harga
| Versi | Berlaku | Tinjau berikutnya | Catatan |
|---|---|---|---|
| 2024.1 | 2024-07-01 | 2025-01-01 | Rilis awal: baseline DKI 2024, IKK provinsi+kab/kota 2024, beton terurai per komponen AHSP |
| 2026.1 | 2026-06-01 | 2026-12-01 | Tinjau harga: baseline divalidasi dalam rentang SHS/HSPK & pasar 2025 (besi ~Rp16–18k/kg terpasang, multiplek 12mm ~Rp160–209k/lembar, keramik 40×40 ~Rp75–140k/m²) — tetap dalam rentang, tanpa perubahan material. Pembesian pindah dari kg/m³ selimut ke **takeoff batang (BBTB)**. IKK kab/kota diperluas ke 495/514 |

## Batas & tindak lanjut
- Beton kini **terurai** (beton-polos + pembesian kg + bekisting m²) — siap untuk BOQ
  kontraktor. Rasio pembesian & harga komponen indikatif; verifikasi dengan gambar
  penulangan (BBTB) untuk angka final.
- **Cakupan IKK kota: 495 dari 514 kab/kota** (semua **98 kota/municipality** tercakup);
  ~19 kabupaten yang tak terekstrak dari PDF BPS jatuh ke IKK provinsi.
  Sumber: `src/lib/rab/ikk-kabkota-2024.json`.

