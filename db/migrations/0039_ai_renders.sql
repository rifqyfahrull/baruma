-- 0039: AI Image Renderer (Fase 1) — job async utk render foto AI (mode Cepat/
-- Nano Banana & Presisi/FLUX Depth). Meniru pola asset_ingestion_jobs
-- (0005_assets.sql): satu baris = satu job, status berjalan lewat state
-- machine queued -> submitted/processing -> succeeded|failed, trigger
-- updated_at pakai set_updated_at() yang sudah ada (0001_init.sql). Idempoten
-- (if not exists), aman dijalankan berulang.

create table if not exists render_jobs (
  id                  text primary key,            -- 'rnd-' || nanoid(12)
  owner_id            text not null references profiles(id),
  project_id          text not null references projects(id),
  status              text not null default 'queued',  -- queued|submitted|processing|succeeded|failed
  mode                text not null,               -- 'cepat' | 'presisi'
  preset              text not null,               -- 'tropis-siang' | 'tropis-senja' | ...
  shot_id             text not null,               -- dari PHOTO_SHOTS ('iso-siang', dst.)
  seed                integer not null,
  credits_spent       integer not null,
  provider            text not null,               -- 'gemini' | 'fal' | 'mock'
  provider_request_id text,                        -- request id fal (utk rekonsiliasi)
  params_hash         text not null,               -- hash(scene+kamera+preset+seed+mode) -> cache
  input_keys          jsonb not null,               -- key S3 beauty/depth
  output_key          text,
  watermarked         boolean not null default false,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists render_jobs_project_idx on render_jobs (project_id, created_at desc);
create index if not exists render_jobs_owner_idx   on render_jobs (owner_id);
-- cache lookup: render sukses dgn params sama -> gratis, tak render ulang
create index if not exists render_jobs_cache_idx   on render_jobs (params_hash) where status = 'succeeded';

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'render_jobs_updated'
  ) then
    create trigger render_jobs_updated before update on render_jobs
      for each row execute function set_updated_at();
  end if;
end $$;

-- Idempotensi kredit: index parsial 0016 hardcode reason 'project_agent'
-- (agent chat) — reason baru 'ai_render'/'ai_render_refund' butuh index
-- parsialnya sendiri agar spendCreditsOnce/refundCreditsOnce idempoten
-- per (profile, reason, ref) tanpa bertabrakan dgn kategori lain.
create unique index if not exists credits_ledger_ai_render_once
  on credits_ledger (profile_id, reason, ref)
  where reason in ('ai_render','ai_render_refund') and ref is not null;
