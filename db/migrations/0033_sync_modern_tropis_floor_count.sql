-- 0033 — sync project metadata with the persisted two-floor layout
--
-- proj-modern-tropis-1 was seeded as one floor, then its layout was expanded
-- to include floor-k4KTN1 (Lantai 2). The layout is the editor source of truth,
-- but project.floors feeds cards, audits, and summary views. Keep the metadata
-- in sync without rewriting the live layout payload or changing its revision.
--
-- Idempotent: only updates the guarded stale value, and only when the layout
-- contains both known floors.

BEGIN;

UPDATE projects AS p
SET floors = 2,
    updated_at = now()
WHERE p.id = 'proj-modern-tropis-1'
  AND p.floors <> 2
  AND EXISTS (
    SELECT 1
    FROM design_layouts AS dl
    WHERE dl.project_id = p.id
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(dl.payload->'floors') AS floor
        WHERE floor->>'id' = 'floor-1'
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(dl.payload->'floors') AS floor
        WHERE floor->>'id' = 'floor-k4KTN1'
      )
  );

COMMIT;
