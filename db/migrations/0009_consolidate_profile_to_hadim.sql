-- One-off DATA migration (2026-07-10, user-requested account consolidation).
--
-- The user now signs in with Google as hadimrifqyfakhrul@gmail.com
-- (usr-MPbZPdo6Bj, supabase_uid a874eb92-…). Move everything owned by their
-- old email/password profile rifqy13.dev@gmail.com (usr-FQR25fnajj) to it,
-- plus the 19 asset-bank items imported under the synthetic owner
-- usr-Qm4UqnMZ9- (see scripts/import-asset-library-projects.mjs) so the Asset
-- Library is no longer empty for the real account.
--
-- Runs exactly once via scripts/migrate.mjs (tracked in schema_migrations,
-- applied inside a transaction on deploy). Every statement no-ops when the
-- referenced profile ids don't exist, so this is safe on fresh/dev databases.

UPDATE projects
   SET owner_id = 'usr-MPbZPdo6Bj'
 WHERE owner_id = 'usr-FQR25fnajj';

UPDATE credits_ledger
   SET profile_id = 'usr-MPbZPdo6Bj'
 WHERE profile_id = 'usr-FQR25fnajj';

UPDATE subscriptions
   SET profile_id = 'usr-MPbZPdo6Bj'
 WHERE profile_id = 'usr-FQR25fnajj';

UPDATE user_assets
   SET user_id = 'usr-MPbZPdo6Bj'
 WHERE user_id IN ('usr-FQR25fnajj', 'usr-Qm4UqnMZ9-');

UPDATE asset_ingestion_jobs
   SET user_id = 'usr-MPbZPdo6Bj'
 WHERE user_id IN ('usr-FQR25fnajj', 'usr-Qm4UqnMZ9-');

-- Keep the denormalized credits counter consistent with the moved ledger
-- history (the migration runner guarantees this runs at most once).
UPDATE profiles t
   SET credits_used = t.credits_used + f.credits_used
  FROM profiles f
 WHERE t.id = 'usr-MPbZPdo6Bj'
   AND f.id = 'usr-FQR25fnajj'
   AND f.credits_used > 0;

UPDATE profiles
   SET credits_used = 0
 WHERE id = 'usr-FQR25fnajj';
