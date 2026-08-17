-- 0024 — koreksi clearance bukaan pada denah yang sudah tersimpan.
--
-- Latar: docs/AUDIT_BUKAAN_2026-08.md. Bukaan di bawah melanggar aturan
-- domain-knowledge-pintu.md §1 (clearance >= 15 cm dari dinding tegak lurus,
-- atau daun pintu mentok saat dibuka 90°). Semuanya data WARISAN — lahir dari
-- generator/jalur LLM sebelum clearance ditegakkan di kode (commit 3125b38).
--
-- LINGKUP: seluruh pelanggaran clearance.
--
-- Yang diubah HANYA positionM (dan widthM bila dinding tak cukup lebar).
-- Jenis bukaan, tinggi, sill, dan wallId TIDAK disentuh.
--
-- Idempoten: setiap UPDATE dijaga syarat nilai lama, jadi menjalankan ulang
-- tidak mengubah apa pun.

BEGIN;

-- proj-asset-rumah-sederhana (1)
--   door Taman belakang:n [menumpang_pertemuan_tembok] dinding 5.1 m: pos 1.35 -> 3.45 (masuk bentang Dapur)
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rsd-taman-back'
          AND (o->>'positionM')::numeric = 1.35
        THEN o || '{"positionM":3.45,"widthM":2.4}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-sederhana';

-- proj-asset-rumah-tipe-60 (1)
--   door Taman belakang:n [menumpang_pertemuan_tembok] dinding 5 m: pos 1.35 -> 3.4 (masuk bentang Dapur)
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rt60-taman-back'
          AND (o->>'positionM')::numeric = 1.35
        THEN o || '{"positionM":3.4,"widthM":2.4}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-tipe-60';

-- proj-modern-tropis-1 (1)
--   door Kamar mandi 2:w [menumpang_pertemuan_tembok] dinding 2.07 m: pos 0.67 -> 1.42 (masuk bentang Kamar tidur 2)
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-322244375'
          AND (o->>'positionM')::numeric = 0.67
        THEN o || '{"positionM":1.42,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-modern-tropis-1';

-- proj-sKeE6zh- (1)
--   door Balkon:s [menumpang_pertemuan_tembok] dinding 4.46 m: pos 0.63 -> 2.72 (masuk bentang Laundry)
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-1621802943'
          AND (o->>'positionM')::numeric = 0.63
        THEN o || '{"positionM":2.72,"widthM":0.96}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-sKeE6zh-';

COMMIT;

-- Verifikasi setelah dijalankan:
--   node scripts/audit-openings.mjs

-- ============================================================
-- PERLU TINJAUAN MANUAL — tidak dikoreksi otomatis:
--   proj-sKeE6zh- door Ruang tamu:e pos=0.52 w=0.74 dinding=3.73
--     lebar asli tak bisa dipertahankan di bentang tetangga mana pun — perlu keputusan desain
--   proj-sKeE6zh- door Void:s pos=0.3 w=0.6 dinding=0.64
--     dinding tak layak untuk bukaan apa pun
--   proj-sKeE6zh- door Void:w pos=1.75 w=0.5 dinding=2.09
--     dinding tak layak untuk bukaan apa pun
-- ============================================================