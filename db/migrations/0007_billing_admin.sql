-- Mayar billing + admin backoffice foundation.
-- Migration: 0007_billing_admin.sql
-- Idempotent: IF NOT EXISTS / DO $$ guards (same pattern as 0002_auth.sql).

-- ── profiles: role (admin gating) + phone (Mayar invoices require `mobile`) ──
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'profiles'::regclass AND conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('user','admin'));
  END IF;
END $$;

-- ── plans: pricing-card content + admin knobs + entitlements ─────────────────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS tagline text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed content mirrors src/lib/pricing.ts PRICING_PLANS verbatim (and
-- src/lib/server/repo/plan-defaults.ts DEFAULT_PLANS — parity is test-locked)
-- so the landing stays pixel-equal once it reads plans from the DB.
-- Guarded on `tagline IS NULL`: re-runs never clobber later admin edits.
UPDATE plans SET
  tagline      = 'Untuk mencoba dan eksplorasi konsep awal.',
  featured     = false,
  sort_order   = 0,
  features     = '["1 project aktif","Brief + 3 alternatif layout","Editor denah 2D dasar","3D preview sederhana","RAB awal (estimasi)"]'::jsonb,
  limits       = '["Watermark pada export","Tanpa DXF/IFC"]'::jsonb,
  entitlements = '{"creditsPerPeriod":10,"maxProjects":1,"exportPdf":false,"glbUpload":false}'::jsonb
WHERE id = 'free' AND tagline IS NULL;

UPDATE plans SET
  tagline      = 'Untuk yang serius menyiapkan diskusi dengan kontraktor.',
  featured     = true,
  sort_order   = 1,
  features     = '["Project tanpa batas","Semua fitur Free","Export Contractor Pack PDF","Export DXF & IFC","RAB Excel","AI assistant penuh"]'::jsonb,
  limits       = '["Tanpa watermark"]'::jsonb,
  entitlements = '{"creditsPerPeriod":100,"maxProjects":10,"exportPdf":true,"glbUpload":true}'::jsonb
WHERE id = 'pro' AND tagline IS NULL;

UPDATE plans SET
  tagline      = 'Untuk studio & kontraktor dengan banyak proyek.',
  featured     = false,
  sort_order   = 2,
  features     = '["Semua fitur Pro","Kolaborasi tim","Professional review priority","Brand kustom pada export","Dukungan prioritas"]'::jsonb,
  limits       = '[]'::jsonb,
  entitlements = '{"creditsPerPeriod":500,"maxProjects":50,"exportPdf":true,"glbUpload":true}'::jsonb
WHERE id = 'studio' AND tagline IS NULL;

-- ── subscriptions: provider CHECK += 'mayar' ─────────────────────────────────
-- The 0001 inline CHECK was auto-named by Postgres; find it by definition,
-- drop it only when it doesn't yet allow 'mayar', then (re)add under a stable
-- name. Re-running is a no-op.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%provider%'
    AND pg_get_constraintdef(oid) NOT LIKE '%mayar%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', cname);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%provider%'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_provider_check
      CHECK (provider IN ('midtrans','xendit','stripe','mayar'));
  END IF;
END $$;

-- ── subscriptions: status CHECK += 'pending' / 'expired' ─────────────────────
-- The billing flow creates rows as 'pending' (checkout) and lazily marks them
-- 'expired' (manual-renew) — see spec §Arsitektur 4–6. The 0001 CHECK only
-- allowed active|past_due|canceled|incomplete, so extend it the same way.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
    AND pg_get_constraintdef(oid) NOT LIKE '%pending%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', cname);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('pending','active','past_due','canceled','incomplete','expired'));
  END IF;
END $$;
