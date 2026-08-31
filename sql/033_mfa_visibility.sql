-- 033_mfa_visibility.sql
-- ============================================================================
-- THE PLATFORM COULD NOT SEE WHO HAS TWO-FACTOR.
--
-- Reported 31 Aug 2026 with a screenshot: the Users page showed "No 2FA"
-- against an account that demonstrably has it. Both files were deployed, so
-- the pills were rendering exactly as written -- they were being handed a
-- flag that was false for everybody.
--
-- WHY. api/manage-users.js read `u.factors` off auth.admin.listUsers(). In
-- supabase-js that field is typed OPTIONAL -- `factors?: Factor[]` -- and the
-- client does nothing but hand back whatever GoTrue's GET /admin/users
-- returns. If that endpoint does not include factors, `u.factors` is
-- undefined on every row, `Array.isArray(undefined)` is false, and every
-- account reports as having no second factor. Which is precisely what the
-- screenshot shows: not one green pill anywhere in the list.
--
-- The check was right and the source was wrong. Nothing about "is this a
-- verified factor" needed fixing; where the answer came from did.
--
-- ============================================================================
-- READ THE SOURCE OF TRUTH INSTEAD
--
-- auth.mfa_factors IS the answer. It is one table, it is what GoTrue itself
-- consults at sign-in, and it cannot be out of date with respect to itself.
-- Reading it removes the dependency on an optional field of an admin endpoint
-- whose contents this codebase does not control and cannot pin.
--
-- ONE QUERY, NOT ONE PER USER. The other way to fix this is
-- admin.mfa.listFactors({ userId }) in a loop -- correct, and a round trip
-- per row: on the "All tenants" view that is one HTTP call per account,
-- every time the page loads. This is a single select returning only the ids
-- that have a verified factor.
--
-- ============================================================================
-- WHY IT IS SECURITY DEFINER, AND WHY ALMOST NOBODY MAY CALL IT
--
-- auth.mfa_factors is not reachable from PostgREST and not readable by
-- `authenticated`, both deliberately. SECURITY DEFINER is what lets a
-- function in `public` read it at all.
--
-- That makes the grants the whole security story, so they are as narrow as
-- they go: EXECUTE is revoked from public, anon and authenticated, and given
-- ONLY to service_role. api/manage-users.js holds the secret key and has
-- already established the caller is a platform super admin before it gets
-- here; nothing else can call this at all.
--
-- There is deliberately no is_super_admin() check inside. The service key
-- has no JWT, so auth.uid() is NULL and is_super_admin() returns false --
-- the same trap 031 was written to undo. A gate that refuses its only
-- legitimate caller is not a gate.
--
-- WHAT IT DOES NOT RETURN: the factor id, the friendly name, the type, and
-- above all the secret. A user id and nothing else. The console asks one
-- question -- does this account have a working second factor -- and this
-- answers exactly that and no more.
-- ============================================================================

create or replace function public.users_with_verified_mfa()
returns table (user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- DISTINCT because a user may enroll more than one factor -- a phone and
  -- an authenticator app both count once.
  --
  -- status = 'verified' is the whole test, unchanged from what it always
  -- was. An enrollment that was started and abandoned sits at 'unverified'
  -- for ever: a QR code somebody photographed and never confirmed, which
  -- protects nothing. Counting it would report an account as secured when it
  -- is not, and that is the one direction this must never be wrong in.
  select distinct f.user_id
    from auth.mfa_factors f
   where f.status = 'verified';
$function$;

comment on function public.users_with_verified_mfa() is
  'Every user id with at least one VERIFIED MFA factor. Reads auth.mfa_factors '
  'directly because auth.admin.listUsers() does not reliably include `factors` '
  '- relying on it reported every account as having no 2FA. service_role only: '
  'api/manage-users.js is the sole caller, after it has established the caller '
  'is a platform super admin.';

revoke all on function public.users_with_verified_mfa() from public, anon, authenticated;
grant execute on function public.users_with_verified_mfa() to service_role;

insert into public.schema_migrations (version, name)
values (33, '033_mfa_visibility') on conflict (version) do nothing;
