# RAB Price Book — baseline & provenance

**Versi:** 2024.1 · **Berlaku:** 2024-07-01 · **Baseline region:** DKI Jakarta
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
| Beton pondasi `3_500_000/m³` | Rp3,5 jt/m³ | Beton K250/K300 (material+upah, tanpa besi/bekisting) ≈ Rp1,15–1,19 jt/m³ | Baseline = **beton bertulang terpasang** (beton + pembesian + bekisting + upah), bukan beton polos |
| Kolom/balok `4_500_000/m³` | Rp4,5 jt/m³ | idem + rasio tulangan lebih tinggi | Terpasang, K300 |
| Plat lantai `3_800_000/m³` | Rp3,8 jt/m³ | idem | Terpasang, t=12cm |
| Atap genteng beton `ROOF_PRICES` (≈Rp400k/m²) | Rp400k/m² | Genteng beton terpasang ≈ Rp350–450k/m²; spandek ≈ Rp363k/m² | Sesuai |

## Kebijakan tanggal berlaku
- **Level estimasi**: setiap RAB memuat baris asumsi `Buku harga v2024.1 — berlaku
  2024-07-01 …` (dari `PRICE_BOOK_META`), sehingga tiap estimasi terstempel tanggal.
- **Kalibrasi ulang**: perbarui `PRICE_BOOK_META.version` + `effectiveDate` saat
  harga baseline direvisi terhadap AHSP/HSPK terbaru, dan catat perubahan di sini.

## Batas & tindak lanjut
- Beton dibilkan sebagai "terpasang" (sudah termasuk besi + bekisting). Jika ingin
  BOQ terpisah (beton polos / pembesian kg / bekisting m²), pecah per komponen AHSP.
- Cakupan IKK kota masih parsial (lihat `IKK_CITY_2024`); lengkapi dari tabel
  BPS kab/kota 2024 untuk presisi kota kecil dalam provinsi mahal.
