-- 0024: Tabel asset_knowledge — enrichment kualitatif per-aset katalog
-- (deskripsi Indonesia natural, use-case, ruangan cocok, kata kunci pencarian
-- dwibahasa ID+EN) hasil pipeline 15-describe.mjs (DeepSeek faucet). Dipakai:
--  - search My Library (ILIKE pada keywords/description via LEFT JOIN),
--  - AI agent (deskripsi natural utk pemilihan aset),
--  - bahan embedding semantik v2.
-- Terpisah dari user_assets agar tabel inti tak membengkak & enrichment bisa
-- di-regenerate tanpa menyentuh data aset.
-- (asset_embeddings dibuat runtime oleh 14-embed.mjs — sengaja tidak di sini
-- karena berisi vektor besar yang tak semua env butuhkan.)

create table if not exists asset_knowledge (
  asset_id       text primary key references user_assets(id) on delete cascade,
  description_id text,
  use_case       text,
  room_types     jsonb default '[]',
  keywords       text,
  raw            jsonb,
  updated_at     timestamptz not null default now()
);
