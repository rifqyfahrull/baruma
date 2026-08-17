-- Harga level aset (Rp) untuk integrasi furnitur ↔ RAB: penempatan furniture
-- dari My Library mewarisi harga ini; NULL = "belum dihargai" (excluded
-- eksplisit di budget interior/RAB, bukan Rp 0 diam-diam).
ALTER TABLE user_assets
  ADD COLUMN IF NOT EXISTS price_idr bigint;
