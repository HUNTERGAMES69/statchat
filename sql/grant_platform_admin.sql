-- grant_platform_admin.sql
-- ============================================================================
-- MAKE AN EXISTING ACCOUNT A PLATFORM ADMIN (or take it back).
--
-- Not a migration. Nothing here runs automatically and nothing tracks it in
-- schema_migrations -- this is a deliberate, occasional act, and it is written
-- down so the next one is reproducible rather than reconstructed from memory.
--
-- ============================================================================
-- WHY THIS IS NOT A BUTTON
--
-- Every other way of creating a user refuses to make one of these:
--
--   api/invite-user.js   requires a tenant. A super admin may choose WHICH
--                        tenant, but not "none":
--                          if (!targetTenantId) -> 400
--   api/manage-users.js  has list, setRole, setPassword, sendReset,
--                        resendInvite, delete and setDisabled. No create.
--
-- That is the right shape. A platform account has tenant_id = null and reads
-- every customer's data; it should not be creatable from the same form that
-- adds a coach. The platform console also has no audit trail yet -- it says so
-- on the page -- so an action there that mints an account seeing every
-- school's statistics would be the worst thing to add first.
--
-- ============================================================================
-- STEP 1 -- CREATE THE AUTH USER, NOT HERE
--
-- Do NOT insert into auth.users by hand. That table carries hashed passwords,
-- a matching row in auth.identities, and confirmation/recovery token state
-- that has to agree with it. An account assembled by hand looks present and
-- then fails at some later step -- a password reset that goes nowhere, a
-- login that half-works -- and the cause is a long way from the symptom.
--
-- Use one of:
--   * Supabase dashboard -> Authentication -> Users -> Add user
--   * auth.admin.createUser() from a server-side script
--
-- Either way the `create_profile_for_new_user` trigger fires and inserts a
-- profiles row with the email as display_name, role defaulting to 'view' and
-- tenant_id null. Which is already most of what a platform account is.
--
-- ============================================================================
-- STEP 2 -- GRANT IT, HERE
--
-- Three things have to be true, and the UPDATE below sets all three:
--
--   is_super_admin = true   what is_super_admin() reads, and every platform
--                           RLS policy is written against that function
--   tenant_id      = null   a platform account belongs to no school; a
--                           tenant_id here would scope it to one
--   role           = 'admin'  not what grants platform access, but several
--                           pages check role for ordinary admin controls and
--                           a super admin left on 'view' hits odd corners
-- ============================================================================

-- THE SUPABASE SQL EDITOR DOES NOT SUPPORT \set. It is psql only. So the
-- email is written out in each statement below rather than bound once --
-- three places to edit instead of one, which is worse, but a variable the
-- editor silently ignores is worse still: :'target_email' would be sent
-- literally and the UPDATE would match nothing while reporting success.
--
-- Change someone@statchat.co in all three statements. Search and replace.

-- ---------------------------------------------------------------------------
-- CHECK FIRST. Read this before running the UPDATE: if it returns no rows,
-- step 1 has not happened and the UPDATE below would silently affect nothing.
-- ---------------------------------------------------------------------------
select u.id,
       u.email,
       u.email_confirmed_at is not null as confirmed,
       p.role,
       p.tenant_id,
       p.is_super_admin
  from auth.users u
  left join public.profiles p on p.id = u.id
 where lower(u.email) = lower('someone@statchat.co');

-- ---------------------------------------------------------------------------
-- GRANT. Matched on the auth.users email rather than a pasted uuid: an email
-- is checkable by eye and a uuid is not, and the wrong uuid here hands one
-- customer's admin every other customer's data.
-- ---------------------------------------------------------------------------
update public.profiles p
   set is_super_admin = true,
       tenant_id      = null,
       role           = 'admin'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = lower('someone@statchat.co');

-- ---------------------------------------------------------------------------
-- CONFIRM. Expect exactly one row, is_super_admin true and tenant_id null.
-- If it comes back empty, the email did not match any account and nothing
-- was changed -- an UPDATE that matches nothing is not an error.
-- ---------------------------------------------------------------------------
select u.email, p.role, p.tenant_id, p.is_super_admin
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.is_super_admin
 order by u.email;

-- ============================================================================
-- REVOKING
--
-- Setting is_super_admin = false is NOT enough on its own. The account is
-- left with tenant_id null, which belongs to no school -- it will show under
-- "No tenant assigned" in the platform console and see nothing anywhere else.
-- Decide which it should be:
--
--   -- back to an ordinary member of a school
--   update public.profiles p
--      set is_super_admin = false,
--          tenant_id      = (select id from public.tenants where name = 'Neville'),
--          role           = 'admin'
--     from auth.users u
--    where u.id = p.id and lower(u.email) = lower('someone@statchat.co');
--
--   -- or gone entirely: disable the account rather than deleting it, so the
--   -- plays and games it created keep an author. The platform console's
--   -- Disable button does this, and it is reversible.
--
-- ============================================================================
-- WHO HAS THIS TODAY
--
-- Run the confirm query above on its own to answer that. It is the only
-- record: nothing logs a grant, so the list of accounts IS the list. Worth
-- reading occasionally for that reason.
-- ============================================================================
