-- 0031 — reset driveway hidden flag untuk fixed dead-end bug
--
-- Latar: hidden-exterior-element dead-end bug. Elemen tersembunyi (seperti
-- driveway) tidak bisa di-unhide karena tidak dirender, jadi tidak bisa diklik
-- untuk akses inspector. Toggle UI ditambahkan di editor (showHiddenExteriorElements),
-- tapi data existing masih punya hidden=true.
--
-- LINGKUP: reset hidden=false untuk semua driveway yang tersembunyi.
--
-- Idempoten: conditional check pada nilai current, jadi re-run aman.

BEGIN;

-- proj-modern-tropis-1 — driveway di carport tersembunyi
UPDATE design_layouts SET payload = jsonb_set(
  payload, '{exteriorElements}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = 'ext-surface-MSvF0IY0'
          AND o->>'hidden' = 'true'
        THEN o || '{"hidden":false}'::jsonb
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'exteriorElements') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-modern-tropis-1'
  AND payload->'exteriorElements' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'exteriorElements') o
    WHERE o->>'id' = 'ext-surface-MSvF0IY0' AND o->>'hidden' = 'true'
  );

COMMIT;

-- Verifikasi:
--   SELECT project_id, jsonb_path_query(payload, '$.exteriorElements[*] ? (@.id == "ext-surface-MSvF0IY0" && @.hidden == true)')
--   FROM design_layouts WHERE payload->'exteriorElements' IS NOT NULL;
