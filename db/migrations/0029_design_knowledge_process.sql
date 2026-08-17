-- 0029: tambah topic_type 'process' pada design_knowledge.
--
-- Revisi keputusan 0026 (yang sengaja melewati "proses & regulasi"),
-- didorong riset pasar user (docs/growth-foundry/baruma-market-voice-
-- synthesis.md): tiga pain-point teratas calon pengguna — ketidakpastian
-- budget, "bingung mulai dari mana" (urutan langkah), dan trust gap dgn
-- kontraktor — jatuh di domain PROSES, bukan teknis murni.
--
-- Pagar TETAP berlaku: kualitatif murni. Tanpa harga pasti, tanpa aturan
-- daerah spesifik; PBG/perizinan hanya boleh muncul sebagai URUTAN LANGKAH
-- ("kapan diurus, tanya dinas setempat") — bukan isi aturannya.
alter table design_knowledge drop constraint if exists design_knowledge_topic_type_check;
alter table design_knowledge add constraint design_knowledge_topic_type_check
  check (topic_type in (
    'furniture','material','style','room',
    'problem','system','structure','exterior','process'
  ));
