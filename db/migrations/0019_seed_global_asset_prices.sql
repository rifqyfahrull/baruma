-- 0019: Seed harga level aset (price_idr, Rp/unit) untuk KATALOG GLOBAL
-- (user_assets.is_public = true, bank aset SKP->GLB). Penempatan furniture dari
-- My Library mewarisi harga ini ke budget interior & kategori RAB "Furnishing
-- (Opsional)" (lihat resolvedFurniturePriceRange di src/lib/interior/plan.ts).
--
-- Prinsip:
-- * Harga = estimasi pasar Indonesia 2026 kelas menengah, confidence rendah —
--   pemakai tetap bisa override per-instance dari inspector furniture 3D.
-- * Hanya keluarga bernilai-RAB nyata yang dihargai. Entourage/visual murni
--   (People, Kendaraan, Toys, Rumput, Sepatu/Tas, item komersial niche seperti
--   Etalase/Outlet/Komputer Kasir, serta komponen yang sudah dihitung RAB lain:
--   Pintu/Handle/Genteng/Saklar) SENGAJA dibiarkan NULL -> status "belum
--   dihargai" eksplisit, bukan harga palsu.
-- * Idempotent & non-destruktif: hanya mengisi baris yang masih NULL, tidak
--   pernah menimpa harga yang sudah diisi admin/user.

-- Kamar tidur ---------------------------------------------------------------
UPDATE user_assets SET price_idr = 5500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Kasur %' AND width_m >= 1.6;
UPDATE user_assets SET price_idr = 3500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Kasur %';
UPDATE user_assets SET price_idr = 950000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Footboard%';
UPDATE user_assets SET price_idr = 400000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Gantungan Baju%';

-- Ruang keluarga / furnitur utama -------------------------------------------
UPDATE user_assets SET price_idr = 6500000
  WHERE is_public = true AND price_idr IS NULL
    AND category = 'sofa' AND width_m >= 1.5;
UPDATE user_assets SET price_idr = 3000000
  WHERE is_public = true AND price_idr IS NULL
    AND category = 'sofa' AND width_m >= 0.8;
UPDATE user_assets SET price_idr = 1200000
  WHERE is_public = true AND price_idr IS NULL
    AND category = 'sofa';
UPDATE user_assets SET price_idr = 1800000
  WHERE is_public = true AND price_idr IS NULL
    AND category = 'coffee_table';
UPDATE user_assets SET price_idr = 3500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Lemari Kabinet%';
UPDATE user_assets SET price_idr = 6500000
  WHERE is_public = true AND price_idr IS NULL
    AND name = 'Fireplace 1';

-- Appliance / elektronik -----------------------------------------------------
UPDATE user_assets SET price_idr = 3750000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'AC Split%';
UPDATE user_assets SET price_idr = 7500000
  WHERE is_public = true AND price_idr IS NULL
    AND (name LIKE 'Chiller%' OR name = 'Freezer' OR name LIKE 'Kulkas%');
UPDATE user_assets SET price_idr = 350000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Exhaust Fan%';
UPDATE user_assets SET price_idr = 1500000
  WHERE is_public = true AND price_idr IS NULL
    AND name = 'Monitor';

-- Dapur (hanya set terkurasi; "Dapur N" campuran perkakas kecil -> NULL) -----
UPDATE user_assets SET price_idr = 2500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Dapur Set%';

-- Sanitasi -------------------------------------------------------------------
UPDATE user_assets SET price_idr = 2500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Toilet %' AND height_m >= 0.4;
UPDATE user_assets SET price_idr = 1750000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Bak Mandi%';

-- Arsitektural terpasang ------------------------------------------------------
UPDATE user_assets SET price_idr = 4500000
  WHERE is_public = true AND price_idr IS NULL
    AND (name LIKE 'Kanopi %' OR name LIKE 'Canopy %');
UPDATE user_assets SET price_idr = 2000000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Railing %';
UPDATE user_assets SET price_idr = 12500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Tangga %';
UPDATE user_assets SET price_idr = 850000
  WHERE is_public = true AND price_idr IS NULL
    AND (name LIKE 'Wall Panel%' OR name LIKE 'Wallpanel%');

-- Soft furnishing & dekorasi --------------------------------------------------
UPDATE user_assets SET price_idr = 750000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Gorden %';
UPDATE user_assets SET price_idr = 150000
  WHERE is_public = true AND price_idr IS NULL
    AND (name LIKE 'Bantal %' OR name LIKE 'Buah Hias%' OR name LIKE 'Buku Hias%'
         OR name LIKE 'Batu Hias%' OR name LIKE 'Tong Sampah%');
UPDATE user_assets SET price_idr = 350000
  WHERE is_public = true AND price_idr IS NULL
    AND (name LIKE 'Dekorasi %' OR name LIKE 'Ukiran %');
UPDATE user_assets SET price_idr = 500000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Pajangan %';
UPDATE user_assets SET price_idr = 750000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Patung Hewan%';
UPDATE user_assets SET price_idr = 200000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Jam Dinding%';
UPDATE user_assets SET price_idr = 300000
  WHERE is_public = true AND price_idr IS NULL
    AND name LIKE 'Tanaman %';
