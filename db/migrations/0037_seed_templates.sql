-- 0037: Seed the `templates` table from existing showcase projects — the 14
-- design-gallery projects (0034_seed_design_gallery.sql) plus the "Villa
-- Modern Santika" reference project (0013_seed_villa_modern.sql), which is
-- pinned first (sort_order 0). Idempotent (on conflict do nothing), safe to
-- run repeatedly. Each statement snapshots the source project's current
-- site/layout/brief/interior payloads into the template row.

-- tpl-villa-modern-santika (Villa Modern Santika — pinned first)
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-villa-modern-santika', 'villa-modern-santika', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 0, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-modern-lux1' and exists (select 1 from projects where id = 'proj-modern-lux1')
on conflict (id) do nothing;

-- tpl-dg-01-dua-tona
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-01-dua-tona', 'dg-01-dua-tona', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 1, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-01-dua-tona' and exists (select 1 from projects where id = 'proj-dg-01-dua-tona')
on conflict (id) do nothing;

-- tpl-dg-02-japandi-sirip
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-02-japandi-sirip', 'dg-02-japandi-sirip', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 2, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-02-japandi-sirip' and exists (select 1 from projects where id = 'proj-dg-02-japandi-sirip')
on conflict (id) do nothing;

-- tpl-dg-03-skillion-charcoal
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-03-skillion-charcoal', 'dg-03-skillion-charcoal', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 3, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-03-skillion-charcoal' and exists (select 1 from projects where id = 'proj-dg-03-skillion-charcoal')
on conflict (id) do nothing;

-- tpl-dg-04-tropis-batu-porthole
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-04-tropis-batu-porthole', 'dg-04-tropis-batu-porthole', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 4, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-04-tropis-batu-porthole' and exists (select 1 from projects where id = 'proj-dg-04-tropis-batu-porthole')
on conflict (id) do nothing;

-- tpl-dg-05-split-green-rooftop
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-05-split-green-rooftop', 'dg-05-split-green-rooftop', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 5, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-05-split-green-rooftop' and exists (select 1 from projects where id = 'proj-dg-05-split-green-rooftop')
on conflict (id) do nothing;

-- tpl-dg-06-japanese-narrow
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-06-japanese-narrow', 'dg-06-japanese-narrow', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 6, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-06-japanese-narrow' and exists (select 1 from projects where id = 'proj-dg-06-japanese-narrow')
on conflict (id) do nothing;

-- tpl-dg-07-concrete-cantilever
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-07-concrete-cantilever', 'dg-07-concrete-cantilever', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 7, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-07-concrete-cantilever' and exists (select 1 from projects where id = 'proj-dg-07-concrete-cantilever')
on conflict (id) do nothing;

-- tpl-dg-08-cabin-skillion
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-08-cabin-skillion', 'dg-08-cabin-skillion', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 8, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-08-cabin-skillion' and exists (select 1 from projects where id = 'proj-dg-08-cabin-skillion')
on conflict (id) do nothing;

-- tpl-dg-09-butterfly-balkon
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-09-butterfly-balkon', 'dg-09-butterfly-balkon', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 9, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-09-butterfly-balkon' and exists (select 1 from projects where id = 'proj-dg-09-butterfly-balkon')
on conflict (id) do nothing;

-- tpl-dg-10-gable-slat-batu
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-10-gable-slat-batu', 'dg-10-gable-slat-batu', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 10, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-10-gable-slat-batu' and exists (select 1 from projects where id = 'proj-dg-10-gable-slat-batu')
on conflict (id) do nothing;

-- tpl-dg-11-barn-roster
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-11-barn-roster', 'dg-11-barn-roster', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 11, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-11-barn-roster' and exists (select 1 from projects where id = 'proj-dg-11-barn-roster')
on conflict (id) do nothing;

-- tpl-dg-12-single-gable
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-12-single-gable', 'dg-12-single-gable', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 12, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-12-single-gable' and exists (select 1 from projects where id = 'proj-dg-12-single-gable')
on conflict (id) do nothing;

-- tpl-dg-13-green-wall-courtyard
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-13-green-wall-courtyard', 'dg-13-green-wall-courtyard', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 13, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-13-green-wall-courtyard' and exists (select 1 from projects where id = 'proj-dg-13-green-wall-courtyard')
on conflict (id) do nothing;

-- tpl-dg-14-louver-pool
insert into templates
  (id, slug, name, description, style, city, province, floors, rooftop,
   thumbnail, site, layout, brief, interior, source_project_id, sort_order, active)
select 'tpl-dg-14-louver-pool', 'dg-14-louver-pool', p.name, b.payload->>'summary',
       p.style, p.city, p.province, p.floors, p.rooftop, coalesce(p.thumbnail, 'compact'),
       p.site, dl.payload, b.payload, pi.payload, p.id, 14, true
from projects p
join design_layouts dl on dl.project_id = p.id
left join briefs b on b.project_id = p.id
left join project_interiors pi on pi.project_id = p.id
where p.id = 'proj-dg-14-louver-pool' and exists (select 1 from projects where id = 'proj-dg-14-louver-pool')
on conflict (id) do nothing;
