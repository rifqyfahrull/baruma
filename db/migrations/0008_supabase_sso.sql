-- SSO with tampil.dev: Baruma adopts the shared Supabase Auth project.
-- A Baruma profile is linked to a Supabase auth user by UUID. Existing
-- profiles are linked lazily by matching email on first Supabase login.
-- Migration: 0008_supabase_sso.sql

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS supabase_uid uuid;

-- One Baruma profile per Supabase user. Partial unique index so the many
-- pre-SSO rows with NULL supabase_uid don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profiles_supabase_uid
  ON profiles (supabase_uid) WHERE supabase_uid IS NOT NULL;
