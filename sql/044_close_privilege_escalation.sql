-- 044 — Close three privilege paths that RLS does not cover
-- ============================================================================
-- Copyright 2026 StatChat. All rights reserved. Unauthorized copying,
-- modification or distribution of this software or its documentation is
-- prohibited.
--
-- Found 3 Sep 2026 in a full security review. All three sit OUTSIDE the policy
-- layer, which is why the policies themselves audit clean: a writable column
-- that policies never look at, a SECURITY DEFINER function that skips the
-- tenant test, and a table-level grant that outruns the policy above it.
--
-- NO APPLICATION FILE CHANGES. This runs in the Supabase SQL editor and needs
-- no deploy, so it does not touch the Friday lockdown.
--
-- ============================================================================
-- RUN THIS WHOLE FILE. It ends with three verify queries that each RETURN A
-- ROW; if any prints FAIL, nothing below it has taken effect and you should
-- stop and send me the output.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. CRITICAL — a signed-in user could make themselves the platform owner.
--
-- `grant all on table public.profiles to anon, authenticated` (000:503) covers
-- every column, including ones added later. The UPDATE policy (000:424) has no
-- WITH CHECK, so Postgres reuses its USING clause and the only invariant is
-- "the row is still yours". The sole trigger on the table,
-- prevent_self_role_change, tests `role` AND NOTHING ELSE.
--
-- 006 then added the two columns that ARE the tenancy boundary -- tenant_id
-- (006:90) and is_super_admin (006:105) -- and neither ever got a guard. So:
--
--   PATCH /rest/v1/profiles?id=eq.<self>   {"is_super_admin": true}
--
-- with the publishable key that every page already ships, from any signed-in
-- account, returned a platform owner. is_super_admin() then opens the
-- `or public.is_super_admin()` branch of every policy on every table, plus
-- create_tenant, set_tenant_deleted, restore_game and the rest.
--
-- Setting tenant_id instead moves the attacker into another school at their
-- existing role.
--
-- WHY A TRIGGER RATHER THAN FIXING THE GRANT: a column-level REVOKE cannot
-- claw back a table-level grant -- table and column ACLs are separate, and a
-- check passes if EITHER allows it. 018:139 already tried that and is a silent
-- no-op today. Rewriting the grants would work but changes the privilege of
-- every column at once, twelve hours before sixteen live games. The trigger is
-- exact, and it is the shape this schema already uses for the same job
-- (protect_tenant_billing_columns, 009:186).
--
-- `auth.uid() is not null` mirrors prevent_self_role_change: the service role
-- has no auth.uid(), so api/manage-users.js and api/create-tenant.js keep
-- working, and so does the SQL editor. Only a BROWSER is refused.
create or replace function public.prevent_self_privilege_change()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null then
    if new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'is_super_admin cannot be changed from the application.';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id cannot be changed from the application.';
    end if;
  end if;
  return new;
end $function$;

comment on function public.prevent_self_privilege_change() is
  'Blocks browser writes to profiles.is_super_admin and profiles.tenant_id. '
  'The UPDATE policy only proves the row is yours; these two columns decide '
  'what "yours" means, so they need their own guard. Service role passes.';

drop trigger if exists profiles_privilege_guard on public.profiles;
create trigger profiles_privilege_guard
  before update on public.profiles
  for each row execute function public.prevent_self_privilege_change();

-- ---------------------------------------------------------------------------
-- 2. Any admin or game_entry user could put ANY school's game on air.
--
-- set_broadcast_game (024:40) and clear_broadcast_game (000:243) are SECURITY
-- DEFINER and check the caller's ROLE but never compare the target game's
-- tenant to the caller's own. 024 scoped the collateral clear -- which is what
-- tests/broadcast_scope_check.js asserts -- but not the caller.
--
-- Live consequence: a crew at one school could knock another school's game off
-- the air mid-broadcast, and their overlays would go blank. Nothing malicious
-- is required; a copied game id does it.
create or replace function public.set_broadcast_game(p_game_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller_role text;
  target_tenant uuid;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can set the broadcast game.';
  end if;

  select tenant_id into target_tenant from games where id = p_game_id;
  if target_tenant is null then
    raise exception 'No such game, or it has no school: %', p_game_id;
  end if;

  -- ADDED 044. The check this function never had. Worded as "no such game"
  -- rather than "not your game" so it cannot be used to test whether an id
  -- exists at another school.
  if target_tenant is distinct from public.current_tenant_id()
     and not public.is_super_admin() then
    raise exception 'No such game, or it has no school: %', p_game_id;
  end if;

  update games set is_broadcast = false
   where is_broadcast
     and tenant_id = target_tenant
     and id <> p_game_id;

  update games
     set is_broadcast = true,
         broadcast_set_by = auth.uid(),
         broadcast_set_at = now()
   where id = p_game_id;
end $function$;

create or replace function public.clear_broadcast_game(p_game_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller_role text;
  target_tenant uuid;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can clear the broadcast game.';
  end if;

  select tenant_id into target_tenant from games where id = p_game_id;
  if target_tenant is null then
    raise exception 'No such game, or it has no school: %', p_game_id;
  end if;
  if target_tenant is distinct from public.current_tenant_id()
     and not public.is_super_admin() then
    raise exception 'No such game, or it has no school: %', p_game_id;
  end if;

  update games
     set is_broadcast = false,
         broadcast_set_by = null,
         broadcast_set_at = null
   where id = p_game_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Anonymous readers could read every school's feed_key.
--
-- 009:212 lets anon SELECT any tenant row that has ever published a public
-- recap, and 009:217 grants that at TABLE level -- every column. `games` got a
-- careful column-level grant (000:510); `tenants` did not. 017 later dropped
-- the three branding columns the policy was named for, and the grant was never
-- revisited.
--
-- feed_key is the ONLY credential the overlay endpoints accept
-- (api/_tenant.js:46), and those run with the service role and bypass RLS. So
-- this handed out the key to every school's LIVE, unpublished game feed. It
-- also exposed subscription, renews_on and disabled_reason.
--
-- CONTAINED RATHER THAN CLEAN, DELIBERATELY, AND HERE IS WHY: no anon-facing
-- page reads `tenants` at all -- I checked recap, view, scoresummary,
-- stat_package, every broadcast overlay and both report pages -- and the anon
-- policies on games/plays/rosters reach tenant state through the SECURITY
-- DEFINER helper tenant_is_live(), not through this grant. So the clean fix is
-- to revoke anon SELECT outright and drop the vestigial policy.
--
-- I am not doing that twelve hours before sixteen live games. A column grant
-- closes the actual leak with no chance of blanking a recap that reads a
-- column I did not predict. Revoking the rest belongs in 045, after Friday.
revoke select on public.tenants from anon;
grant select (id, name, full_name, sponsor_bar) on public.tenants to anon;

commit;

-- ============================================================================
-- VERIFY. ONE result set, three rows, all must say PASS.
--
-- WRITTEN AS A SINGLE UNION ON PURPOSE. The first version of this file used
-- three separate SELECTs, and the Supabase SQL editor displays only the LAST
-- result set when several statements are run together -- so two of the three
-- checks were invisible and looked like they had not run. A verify you cannot
-- see is not a verify.
--
-- Safe to re-run at any time; it reads catalogs and changes nothing.
-- ============================================================================

select 'is_super_admin / tenant_id guard installed' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result,
       count(*) as detail
  from pg_trigger
 where tgrelid = 'public.profiles'::regclass
   and tgname  = 'profiles_privilege_guard'
   and not tgisinternal

union all

select 'broadcast functions check caller tenant',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*)
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('set_broadcast_game','clear_broadcast_game')
   and prosrc like '%current_tenant_id()%'

union all

select 'anon cannot read feed_key',
       case when bool_or(has_column_privilege('anon','public.tenants',c,'SELECT'))
            then 'FAIL' else 'PASS' end,
       count(*) filter (where has_column_privilege('anon','public.tenants',c,'SELECT'))
  from (values ('feed_key'),('subscription'),('renews_on'),('disabled_reason')) v(c);

-- Applied to production 3 Sep 2026. All three rows returned PASS (1 / 2 / 0).
