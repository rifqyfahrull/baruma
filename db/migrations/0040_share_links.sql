-- 0039: "Share links" — public, no-auth read-only links a project owner can
-- generate so a recipient (contractor/family/reviewer) can view the project
-- WITHOUT logging in (WS-D §2 — the old "Bagikan" dialog pointed at the
-- owner-only /review route, which 404s for anyone else). One project can
-- have many historical links (revoked ones kept for audit), but the repo
-- layer only ever reuses/creates ONE ACTIVE link per project at a time.
-- Idempotent (if not exists), safe to run repeatedly.

create table if not exists share_links (
  id         text primary key,               -- 'shr-' + nanoid(8)
  project_id text not null references projects(id) on delete cascade,
  token      text unique not null,           -- nanoid(21) — unguessable, in the public URL /s/[token]
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_share_links_project on share_links(project_id);
create index if not exists idx_share_links_token on share_links(token);
