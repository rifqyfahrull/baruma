-- 0027: Kolom keywords untuk design_knowledge — "bahasa awam" tiap topik.
--
-- Eval retrieval berlabel (scripts/asset-harvest/25-eval-retrieval.mjs) atas
-- 408 pertanyaan mengungkap jurang nyata:
--   pertanyaan yang MENYEBUT istilah topik  → recall@3 91%
--   pertanyaan ala orang awam (gejala/situasi) → recall@3 16%
-- Selisih 75 poin. Pemilik rumah bilang "atap cor rembes kalau hujan", bukan
-- "waterproofing dak beton" — jadi pencocokan nama topik saja gagal untuk
-- pengguna asli Baruma.
--
-- Solusinya menyalin pola yang SUDAH terbukti di asset_knowledge.keywords
-- (yang membuat pencarian ID menemukan aset bernama Inggris): simpan frasa
-- awam/gejala/sinonim per topik dan ikut dicocokkan saat retrieval. Tetap SQL
-- murni — tanpa model embedding di runtime server.
alter table design_knowledge add column if not exists keywords text;
create index if not exists design_knowledge_keywords_idx
  on design_knowledge using gin (to_tsvector('simple', coalesce(keywords, '')));
