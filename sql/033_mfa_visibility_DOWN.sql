-- 033_mfa_visibility_DOWN.sql
-- ============================================================================
-- Reverses 033 by dropping the function.
--
-- AFTER THIS RUNS the platform Users page cannot see two-factor at all. It
-- does not go back to reporting everybody as "No 2FA" -- api/manage-users.js
-- treats a failed lookup as "not known" and sends mfaKnown:false, and
-- platform.html then renders NEITHER pill and says the column is unavailable.
-- No claim is made in either direction, which is the point: the fault this
-- migration exists to fix was a false claim, not a missing one.
--
-- So running this is safe, and visibly incomplete rather than quietly wrong.
-- ============================================================================

drop function if exists public.users_with_verified_mfa();

delete from public.schema_migrations where version = 33;
