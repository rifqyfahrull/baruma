-- 0035: Perbaiki tabrakan bukaan di 2 layout seed galeri (0034): porthole
-- ditempatkan tepat di positionM jendela generator pada dinding yang sama
-- (dg-04 room-2K2tfk:s @3.2, dg-11 room-LNayNY:s @2.47) — terdeteksi
-- seed-opening-audit. Geser porthole ke posisi bebas (1.2 / 4.2). File 0034
-- ikut dikoreksi utk DB baru; migrasi ini menutup DB yang sudah ter-apply.
-- Idempoten: set nilai yang sama bila dijalankan ulang.

update design_layouts
set payload = jsonb_set(payload, '{openings}', (
  select jsonb_agg(
    case when op->>'id' = 'op-porthole-rthole'
         then jsonb_set(op, '{positionM}', '1.2'::jsonb)
         else op end)
  from jsonb_array_elements(payload->'openings') op
))
where project_id = 'proj-dg-04-tropis-batu-porthole'
  and payload->'openings' @> '[{"id":"op-porthole-rthole"}]'::jsonb;

update design_layouts
set payload = jsonb_set(payload, '{openings}', (
  select jsonb_agg(
    case when op->>'id' = 'op-porthole-roster'
         then jsonb_set(op, '{positionM}', '4.2'::jsonb)
         else op end)
  from jsonb_array_elements(payload->'openings') op
))
where project_id = 'proj-dg-11-barn-roster'
  and payload->'openings' @> '[{"id":"op-porthole-roster"}]'::jsonb;
