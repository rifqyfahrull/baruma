-- rab (1:1 with project) — persisted manual edits override the generated estimate
create table if not exists rab (
  project_id text primary key references projects(id) on delete cascade,
  payload    jsonb not null,                 -- full RAB shape (manual)
  updated_at timestamptz not null default now()
);
create trigger rab_updated before update on rab
  for each row execute function set_updated_at();

-- The app connects as baruma_app and every other Baruma table is owned by it.
-- If this migration is run as a superuser (postgres), hand ownership over so the
-- app role can read/write (otherwise GET/PUT /rab fail with permission denied).
alter table rab owner to baruma_app;
