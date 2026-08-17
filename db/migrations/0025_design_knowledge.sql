-- 0025: Tabel design_knowledge — "Design Reasoning Dataset": penalaran desain
-- kualitatif per topik (furnitur/elemen, material, style DNA, aturan ruangan)
-- hasil mini-run LLM (16-design-knowledge.mjs) di atas DAFTAR TOPIK yang
-- dikurasi tangan. Dipakai AI agent untuk MENJELASKAN pilihan desain
-- ("kenapa pakai kitchen island", "alternatif quartz kalau budget turun"),
-- rekomendasi alternatif, dan konsistensi style — tanpa memanggil LLM terus.
--
-- SENGAJA kualitatif murni: tanpa harga, tanpa angka SNI, tanpa kuantitas
-- BOM (itu domain mesin RAB parametrik / dokumen resmi, bukan LLM).

create table if not exists design_knowledge (
  id         text primary key,          -- <topic_type>:<slug>
  topic_type text not null check (topic_type in ('furniture','material','style','room')),
  topic      text not null,             -- nama topik human-readable (ID)
  knowledge  jsonb not null,            -- payload penalaran (why/when_not/alternatives/…)
  updated_at timestamptz not null default now()
);
create index if not exists design_knowledge_type_idx on design_knowledge(topic_type);
