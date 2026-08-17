-- Interior design persistence (intent payload, 1:1 per project, keyed by version).
create table project_interiors (
  project_id text primary key references projects(id) on delete cascade,
  version_id text not null,
  payload    jsonb not null,            -- SavedInterior shape
  updated_at timestamptz not null default now()
);
create trigger project_interiors_updated before update on project_interiors
  for each row execute function set_updated_at();
