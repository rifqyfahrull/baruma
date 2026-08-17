-- 0032 — koreksi floorId roof zone proj-modern-tropis-1
--
-- Latar: rumah 2 lantai (floor-1 + floor-k4KTN1) tapi roof zone main
-- "proj-modern-tropis-1-roof-main" menunjuk floorId=floor-1 (lantai bawah).
-- Di renderer build-model zona atap ditempatkan di elevation
-- index*(floorStep+gap)+SLAB_T+WALL_H sesuai floorId-nya; karena floor-1
-- berindex 0, atap duel di ketinggian atap lantai 1 = TEPAT di slab lantai 2,
-- jadi atap tampak menembus/mengubur lantai 2. Proyek bertingkat lain
-- (proj-urban-monokrom-1, proj-V3-L4Hdr) memakai lantai teratas — ini satu
-- kasus yang salah assign.
--
-- Koreksi: floorId floor-1 -> floor-k4KTN1 (lantai teratas).
-- Idempoten: guarded pada nilai lama, jadi re-run aman.

BEGIN;

UPDATE design_layouts SET payload = jsonb_set(
  payload, '{roofZones}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'proj-modern-tropis-1-roof-main'
          AND o->>'floorId' = 'floor-1'
        THEN o || '{"floorId":"floor-k4KTN1"}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'roofZones') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-modern-tropis-1'
  AND payload->'roofZones' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'roofZones') o
    WHERE o->>'id' = 'proj-modern-tropis-1-roof-main' AND o->>'floorId' = 'floor-1'
  );

COMMIT;