-- FurniMesh model ingestion: user asset library & ingestion job state machine.
-- Stores user-uploaded 3D models metadata + tracks validation progress.
create table user_assets (
  id               text primary key,
  user_id          text not null references profiles(id) on delete cascade,
  name             text not null,
  category         text not null,
  source_type      text not null default 'user_upload',
  source_name      text,
  source_url       text,
  original_filename text not null,
  model_url        text not null,
  thumbnail_url    text,
  file_size_bytes  bigint not null,
  width_m          numeric,
  depth_m          numeric,
  height_m         numeric,
  raw_bounding_box_json jsonb,
  scale_factor_json     jsonb,
  style_tags       jsonb default '[]',
  color_tags       jsonb default '[]',
  material_tags    jsonb default '[]',
  room_types       jsonb default '[]',
  license_confirmation boolean not null default false,
  license_note     text,
  usage_scope      text not null default 'private_project_only',
  material_analysis_json jsonb,
  material_map_json      jsonb,
  performance_json       jsonb,
  status           text not null default 'uploaded',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index user_assets_user_idx on user_assets(user_id);
create index user_assets_category_idx on user_assets(category);
create index user_assets_status_idx on user_assets(status);
create trigger user_assets_updated before update on user_assets
  for each row execute function set_updated_at();

create table asset_ingestion_jobs (
  id               text primary key,
  user_id          text not null references profiles(id) on delete cascade,
  asset_id         text not null references user_assets(id) on delete cascade,
  project_id       text,
  room_id          text,
  slot_id          text,
  expected_category text not null,
  status           text not null,
  progress         int not null default 0,
  validation_result_json jsonb,
  required_user_inputs_json jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index asset_ingestion_jobs_asset_idx on asset_ingestion_jobs(asset_id);
create index asset_ingestion_jobs_project_idx on asset_ingestion_jobs(project_id);
create trigger asset_ingestion_jobs_updated before update on asset_ingestion_jobs
  for each row execute function set_updated_at();
