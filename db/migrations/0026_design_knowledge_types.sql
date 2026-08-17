-- 0026: Perluas topic_type design_knowledge ke domain TEKNIS.
--
-- Riset cakupan (scripts/asset-harvest/21-coverage-research.mjs) mengukur
-- pertanyaan nyata pemilik rumah: domain benda (furniture/material) 100%
-- ter-grounding, tapi domain yang fiturnya JUSTRU ada di app nyaris kosong —
-- atap 75%, fasad 75%, MEP 50%, struktur 25%, masalah rumah 43%. Empat tipe
-- baru menutup itu:
--   problem   — keluhan nyata (rumah panas, dinding lembap, dak bocor, bising)
--   system    — MEP & sistem bangunan (listrik, air, ventilasi, drainase, AC)
--   structure — konstruksi & struktur (pondasi, kolom, atap, waterproofing)
--   exterior  — elemen fasad/luar (cladding, secondary skin, louver, roster)
--
-- Perizinan/regulasi SENGAJA TIDAK dimasukkan: aturan PBG/IMB berbeda tiap
-- daerah dan berubah, jadi jawaban agent berisiko kedaluwarsa — sejalan dgn
-- pagar "tanpa angka/klaim otoritatif" yang dipegang tabel ini sejak 0025.
alter table design_knowledge drop constraint if exists design_knowledge_topic_type_check;
alter table design_knowledge add constraint design_knowledge_topic_type_check
  check (topic_type in (
    'furniture','material','style','room',
    'problem','system','structure','exterior'
  ));
