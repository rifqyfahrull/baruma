-- ── subscriptions.provider CHECK += 'parent' ────────────────────────────────
-- Baruma is a child app and no longer integrates with Mayar directly. All
-- payments are delegated to the tampil.dev parent (Baruma → tampil.dev →
-- Mayar), so the checkout now records subscriptions with provider = 'parent'.
-- Widen the CHECK constraint accordingly (0007 last set it to
-- midtrans|xendit|stripe|mayar). Idempotent: drop-if-exists then re-add.
-- See docs/superpowers/specs/2026-08-22-parent-billing-orchestration-design.md.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_provider_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_provider_check
  CHECK (provider IN ('midtrans','xendit','stripe','mayar','parent'));
