-- Baruma — initial schema (PostgreSQL).
-- Canonical data model for the external backend. Rich design artifacts
-- (brief / alternatives / layout / review payloads) are stored as JSONB to
-- mirror the frontend types in src/types; the mutable review bits are
-- normalized. App-level authz is assumed (see docs/API.md). For Postgres-RLS
-- backends (e.g. Supabase), add owner-based policies on `owner_id`/`profile_id`.

create extension if not exists pgcrypto;

-- updated_at helper -----------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- profiles --------------------------------------------------------------------
create table profiles (
  id            text primary key,           -- external auth user id (sub)
  email         text unique not null,
  name          text not null default '',
  plan          text not null default 'free' check (plan in ('free','pro','studio')),
  credits_used  integer not null default 0,
  credits_total integer not null default 10,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- projects --------------------------------------------------------------------
create table projects (
  id                 text primary key,
  owner_id           text not null references profiles(id) on delete cascade,
  name               text not null,
  status             text not null default 'draft'
                       check (status in ('draft','brief','alternatives','editing','review','archived')),
  readiness          text not null default 'concept_ready'
                       check (readiness in ('concept_ready','contractor_discussion_ready',
                                            'engineer_review_required','engineer_approved','invalid')),
  project_type       text not null default 'new' check (project_type in ('new','renovation')),
  location           text,
  city               text,
  province           text,
  style              text,
  thumbnail          text not null default 'tropis',
  floors             integer not null default 1,
  rooftop            boolean not null default false,
  site               jsonb not null,         -- { widthM, depthM, areaM2, ... }
  current_version_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index projects_owner_idx on projects(owner_id);
create index projects_updated_idx on projects(updated_at desc);
create trigger projects_updated before update on projects
  for each row execute function set_updated_at();

-- briefs (1:1 with project) ---------------------------------------------------
create table briefs (
  project_id text primary key references projects(id) on delete cascade,
  payload    jsonb not null,                 -- full Brief shape
  updated_at timestamptz not null default now()
);
create trigger briefs_updated before update on briefs
  for each row execute function set_updated_at();

-- alternatives ----------------------------------------------------------------
create table alternatives (
  project_id     text not null references projects(id) on delete cascade,
  alternative_id text not null,
  payload        jsonb not null,             -- full Alternative shape
  created_at     timestamptz not null default now(),
  primary key (project_id, alternative_id)
);

-- design layouts (1:1 with project, current draft) ---------------------------
create table design_layouts (
  project_id text primary key references projects(id) on delete cascade,
  version_id text not null,
  payload    jsonb not null,                 -- full DesignLayout shape
  updated_at timestamptz not null default now()
);
create trigger design_layouts_updated before update on design_layouts
  for each row execute function set_updated_at();

-- review: normalized mutable bits --------------------------------------------
create table review_comments (
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  author     text not null,
  role       text check (role in ('arsitek','engineer_struktur','mep','kontraktor','pbg_legal')),
  body       text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index review_comments_project_idx on review_comments(project_id);

create table review_checklist (
  project_id text not null references projects(id) on delete cascade,
  role       text not null check (role in ('arsitek','engineer_struktur','mep','kontraktor','pbg_legal')),
  label      text not null,
  status     text not null default 'pending' check (status in ('pending','reviewed','not_required')),
  primary key (project_id, role)
);

create table resolved_warnings (
  project_id text not null references projects(id) on delete cascade,
  warning_id text not null,
  primary key (project_id, warning_id)
);

-- ── Billing / payments (scaffold) ───────────────────────────────────────────
create table plans (
  id            text primary key,            -- 'free' | 'pro' | 'studio'
  name          text not null,
  price_idr     integer not null default 0,
  period        text not null default 'month',
  features      jsonb not null default '[]'::jsonb
);

create table subscriptions (
  id                 text primary key default gen_random_uuid()::text,
  profile_id         text not null references profiles(id) on delete cascade,
  plan_id            text not null references plans(id),
  status             text not null default 'active'
                       check (status in ('active','past_due','canceled','incomplete')),
  provider           text check (provider in ('midtrans','xendit','stripe')),
  provider_ref       text,                    -- subscription/order id at provider
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index subscriptions_profile_idx on subscriptions(profile_id);
create trigger subscriptions_updated before update on subscriptions
  for each row execute function set_updated_at();

-- credit ledger (append-only); balance = credits_total - sum(spends) etc.
create table credits_ledger (
  id         text primary key default gen_random_uuid()::text,
  profile_id text not null references profiles(id) on delete cascade,
  delta      integer not null,               -- +grant / -spend
  reason     text not null,                  -- 'export' | 'generate' | 'topup' | ...
  ref        text,
  created_at timestamptz not null default now()
);
create index credits_ledger_profile_idx on credits_ledger(profile_id);

-- raw provider webhook events (idempotency + audit)
create table payment_events (
  id           text primary key,             -- provider event id (idempotency key)
  provider     text not null,
  event_type   text not null,
  signature_ok boolean not null default false,
  processed    boolean not null default false,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

-- seed plans ------------------------------------------------------------------
insert into plans (id, name, price_idr, period, features) values
  ('free',   'Free',   0,      'month', '["1 project","brief + 3 alternatif","editor 2D","3D preview","RAB awal"]'),
  ('pro',    'Pro',    149000, 'month', '["project tanpa batas","export Contractor Pack/DXF/IFC","RAB Excel","AI assistant penuh"]'),
  ('studio', 'Studio', 499000, 'month', '["semua Pro","kolaborasi tim","priority review","brand kustom"]')
on conflict (id) do nothing;
