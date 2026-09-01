-- 034_backfill_tenant_suspensions.sql
-- ============================================================================
-- THE ACCOUNTS 018 NEVER REACHED.
--
-- 018 made set_tenant_deleted() ban a tenant's users in the same transaction
-- that stamps tenants.deleted_at. It is correct, and it only ever runs
-- FORWARD -- on a tenant deleted from that moment on.
--
-- Every tenant deleted BEFORE 018 was applied still has deleted_at set and
-- its people still hold working passwords. Nothing about the platform says
-- so: their tenant is gone from the live list, their accounts sit under a
-- normal-looking heading in the Users tab, and RLS returns nothing to them,
-- which looks like security and is not. That is the exact gap 018's own
-- header describes -- "sees no data is not the same as has no access" --
-- left open for everyone deleted up to the day it shipped.
--
-- This closes it once, using the same rule 018 uses, so the two states agree.
--
-- ============================================================================
-- IT USES 018'S RULE, NOT A NEW ONE
--
-- Same skip: a user already banned when this runs is left alone and gets NO
-- suspended_with_tenant_at stamp. That is what makes restore behave -- an
-- account disabled for cause before its school was deleted must stay
-- disabled after the school is restored, and the absence of the stamp is
-- what tells restore to leave it.
--
-- Same ban: banned_until = now() + 876000 hours, the hundred years Supabase's
-- own admin API writes and the same value api/manage-users.js sets.
--
-- ============================================================================
-- SAFE TO RUN TWICE, AND SAFE TO RUN IN THE SQL EDITOR
--
-- Idempotent: the second run finds no unbanned accounts under a deleted
-- tenant and updates nothing.
--
-- NO auth.uid() ANYWHERE. There is no JWT in the Supabase SQL editor, so
-- auth.uid() is NULL and is_super_admin() is false there -- a guard written
-- that way does not protect this statement, it just makes it silently affect
-- nothing. (That is not theoretical: a diagnostic written for this repo
-- returned "Success. No rows returned" for exactly that reason.) Running
-- this file is itself the authorisation; it is a migration, not an endpoint.
--
-- REVERSIBLE: 034_..._DOWN.sql lifts exactly the bans this file placed, by
-- the stamp, and nothing else.
-- ============================================================================

begin;

-- WHAT IT IS ABOUT TO DO, BEFORE IT DOES IT.
-- Read this row in the output. If accounts_to_lock is 0, 018 is already
-- covering everything and this file changes nothing.
select
  count(*) filter (where t.deleted_at is not null)                    as profiles_under_deleted_tenants,
  count(*) filter (where t.deleted_at is not null
                     and (u.banned_until is null or u.banned_until <= now()))
                                                                      as accounts_to_lock,
  count(*) filter (where t.deleted_at is not null
                     and u.banned_until > now())                      as already_locked
from public.profiles p
join public.tenants t on t.id = p.tenant_id
join auth.users    u on u.id = p.id;

-- 1. STAMP the accounts this migration is responsible for.
--    The stamp is what DOWN and what set_tenant_deleted's restore branch
--    both key on, so it has to be written before the ban, not after.
with targets as (
  select p.id
    from public.profiles p
    join public.tenants t on t.id = p.tenant_id
    join auth.users    u on u.id = p.id
   where t.deleted_at is not null
     and p.suspended_with_tenant_at is null
     and (u.banned_until is null or u.banned_until <= now())
)
update public.profiles p
   set suspended_with_tenant_at = now()
  from targets t
 where p.id = t.id;

-- 2. BAN them. Keyed off the stamp, so this can only ever touch accounts
--    step 1 just claimed -- never one that was already banned for cause.
update auth.users u
   set banned_until = now() + interval '876000 hours'
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
 where p.id = u.id
   and t.deleted_at is not null
   and p.suspended_with_tenant_at is not null
   and (u.banned_until is null or u.banned_until <= now());

-- WHAT IT DID. Both numbers should now be 0 and the full count respectively.
select
  count(*) filter (where u.banned_until is null or u.banned_until <= now())
                                                          as still_unlocked_should_be_0,
  count(*)                                                as accounts_under_deleted_tenants
from public.profiles p
join public.tenants t on t.id = p.tenant_id
join auth.users    u on u.id = p.id
where t.deleted_at is not null;

commit;
