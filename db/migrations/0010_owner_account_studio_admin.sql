-- One-off DATA migration (2026-07-11, user-requested).
--
-- usr-MPbZPdo6Bj (hadimrifqyfakhrul@gmail.com) is the product owner's account
-- (post-0009 consolidation). Custom GLB upload 403'd on it because the plan
-- was `free` (entitlement glbUpload=false — the paywall working as designed).
-- Owners test every feature, so: plan → studio (glbUpload/exportPdf/500
-- credits) and role → admin (DB-fresh gate for /app/admin + admin APIs).
-- No-ops when the profile id doesn't exist (fresh/dev databases).

UPDATE profiles
   SET plan = 'studio',
       role = 'admin',
       credits_total = GREATEST(credits_total, 500)
 WHERE id = 'usr-MPbZPdo6Bj';
