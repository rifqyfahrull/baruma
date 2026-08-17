-- 0036: "Templates" feature — a curated, publicly browsable list of
-- ready-made designs (seeded from existing gallery/showcase projects) that a
-- user can start a new project from. Idempotent (if not exists), safe to
-- run repeatedly.

create table if not exists templates (
  id text primary key,
  slug text unique not null,
  name text not null,
  description text,
  style text,
  city text,
  province text,
  floors int not null default 1,
  rooftop boolean not null default false,
  thumbnail text,
  site jsonb not null,
  layout jsonb not null,
  brief jsonb,
  interior jsonb,
  source_project_id text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_templates_active_sort on templates(active, sort_order);
