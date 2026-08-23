-- WS-B "uang bisa dipercaya": kolom penanda H-7 renewal reminder pada
-- subscriptions, dipakai src/lib/server/repo/subscriptions.ts's
-- listSubscriptionsNeedingReminder/markReminderSent (cron POST
-- /api/internal/maintenance). NULL = belum pernah dikirim. Idempotent
-- (IF NOT EXISTS), pola sama dengan migration lain di repo ini.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Pro plan → "Project tanpa batas" (maxProjects null = unlimited), sesuai
-- copy landing/pricing yang sudah lama menjanjikan ini (lihat
-- src/lib/server/repo/plan-defaults.ts, sinkron dengan migration ini).
-- Studio (50) & Free (1) tidak berubah.
UPDATE plans
SET entitlements = jsonb_set(entitlements, '{maxProjects}', 'null'::jsonb, true)
WHERE id = 'pro';
