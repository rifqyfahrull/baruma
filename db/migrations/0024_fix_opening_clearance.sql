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

-- proj-asset-rumah-2-lantai (2)
--   door Taman belakang:n [mepet_ujung] dinding 11 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 7.5 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-r2l-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-2-lantai-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-2-lantai';

-- proj-asset-rumah-3-kamar (2)
--   door Taman belakang:n [mepet_ujung] dinding 9 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 5.8 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-r3k-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-3-kamar-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-3-kamar';

-- proj-asset-rumah-atap-miring (2)
--   door Taman belakang:n [mepet_ujung] dinding 5.5 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 8 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-ram-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-atap-miring-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-atap-miring';

-- proj-asset-rumah-casa (1)
--   door Ruang tamu:n [mepet_ujung] dinding 8.5 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rumah-casa-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-casa';

-- proj-asset-rumah-farmhouse (2)
--   door Taman belakang:n [mepet_ujung] dinding 11 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 8 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rfh-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-farmhouse-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-farmhouse';

-- proj-asset-rumah-minimalis-modern (2)
--   door Taman belakang:n [mepet_ujung] dinding 3 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 6 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rmm-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-minimalis-modern-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-minimalis-modern';

-- proj-asset-rumah-modern-box (2)
--   door Taman belakang:n [mepet_ujung] dinding 9 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 6 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rmb-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-modern-box-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-modern-box';

-- proj-asset-rumah-mungil (4)
--   window Kamar mandi:s [selebar_penuh_dinding] dinding 1.8 m: pos 0.9 -> 0.9, lebar 1.8 -> 1.5
--   window Dapur:s [selebar_penuh_dinding] dinding 2.4 m: pos 1.2 -> 1.2, lebar 2.4 -> 2.1
--   door Taman belakang:n [selebar_penuh_dinding] dinding 1.8 m: pos 0.9 -> 0.9, lebar 1.8 -> 1.5
--   door Ruang tamu:n [mepet_ujung] dinding 3.3 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rmg-mandi-back'
          AND (o->>'positionM')::numeric = 0.9
        THEN o || '{"positionM":0.9,"widthM":1.5}'::jsonb
        WHEN o->>'id' = 'op-rmg-dapur-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.2,"widthM":2.1}'::jsonb
        WHEN o->>'id' = 'op-rmg-taman-back'
          AND (o->>'positionM')::numeric = 0.9
        THEN o || '{"positionM":0.9,"widthM":1.5}'::jsonb
        WHEN o->>'id' = 'op-rumah-mungil-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-mungil';

-- proj-asset-rumah-sederhana (3)
--   window Kamar 2:s [mepet_ujung] dinding 2.7 m: pos 1.2 -> 1.35
--   door Taman belakang:n [mepet_ujung] dinding 5.1 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 5.3 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rsd-kamar2-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rsd-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-sederhana-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-sederhana';

-- proj-asset-rumah-tipe-36 (2)
--   door Taman belakang:n [mepet_ujung] dinding 6 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 3.3 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rt36-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-tipe-36-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-tipe-36';

-- proj-asset-rumah-tipe-60 (3)
--   window Kamar 2:s [mepet_ujung] dinding 3 m: pos 1.2 -> 1.35
--   door Taman belakang:n [mepet_ujung] dinding 5 m: pos 1.2 -> 1.35
--   door Ruang tamu:n [mepet_ujung] dinding 5 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-rt60-kamar2-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rt60-taman-back'
          AND (o->>'positionM')::numeric = 1.2
        THEN o || '{"positionM":1.35,"widthM":2.4}'::jsonb
        WHEN o->>'id' = 'op-rumah-tipe-60-main-door'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-asset-rumah-tipe-60';

-- proj-jo48M6h4 (1)
--   door Carport:s [mepet_ujung] dinding 7.44 m: pos 6.87 -> 6.84
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-1129068779'
          AND (o->>'positionM')::numeric = 6.87
        THEN o || '{"positionM":6.84,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-jo48M6h4';

-- proj-modern-tropis-1 (2)
--   door Ruang Tamu:s [keluar_dinding] dinding 4.7 m: pos 0.5 -> 0.75
--   door Ruang Tamu:e [mepet_ujung] dinding 1.36 m: pos 0.5 -> 0.6
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'a-door-entry'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.75,"widthM":1.2}'::jsonb
        WHEN o->>'id' = 'op-1021116911'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'openings') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-modern-tropis-1';

-- proj-sKeE6zh- (6)
--   door Ruang tamu:e [mepet_ujung] dinding 3.73 m: pos 0.43 -> 0.52
--   window Kamar 2:w [mepet_ujung] dinding 2.86 m: pos 2.5 -> 2.41
--   window Dapur:n [mepet_ujung] dinding 2.84 m: pos 0.69 -> 0.75
--   door Balkon:s [mepet_ujung] dinding 4.46 m: pos 0.48 -> 0.63
--   door Kamar 1:n [mepet_ujung] dinding 3 m: pos 0.5 -> 0.6
--   door Kamar 2:e [mepet_ujung] dinding 2.86 m: pos 2.4 -> 2.26
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{openings}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'op-1964427086'
          AND (o->>'positionM')::numeric = 0.43
        THEN o || '{"positionM":0.52,"widthM":0.74}'::jsonb
        WHEN o->>'id' = 'op-1123122340'
          AND (o->>'positionM')::numeric = 2.5
        THEN o || '{"positionM":2.41,"widthM":0.6}'::jsonb
        WHEN o->>'id' = 'op-615968887'
          AND (o->>'positionM')::numeric = 0.69
        THEN o || '{"positionM":0.75,"widthM":1.2}'::jsonb
        WHEN o->>'id' = 'op-1621802943'
          AND (o->>'positionM')::numeric = 0.48
        THEN o || '{"positionM":0.63,"widthM":0.96}'::jsonb
        WHEN o->>'id' = 'op-293284436'
          AND (o->>'positionM')::numeric = 0.5
        THEN o || '{"positionM":0.6,"widthM":0.9}'::jsonb
        WHEN o->>'id' = 'op-264223533'
          AND (o->>'positionM')::numeric = 2.4
        THEN o || '{"positionM":2.26,"widthM":0.9}'::jsonb
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
--   proj-sKeE6zh- door Void:s pos=0.3 w=0.6 dinding=0.64
--     dinding tak layak untuk bukaan apa pun
--   proj-sKeE6zh- door Void:w pos=1.75 w=0.5 dinding=2.09
--     dinding tak layak untuk bukaan apa pun
-- ============================================================