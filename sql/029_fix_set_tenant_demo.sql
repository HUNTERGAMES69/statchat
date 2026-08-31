-- 029_fix_set_tenant_demo.sql
-- ============================================================================
-- set_tenant_demo() HAS BEEN THROWING SINCE 021. Both directions.
--
-- Found 31 Aug 2026 by rebuilding the whole migration set from 000 to 028 on
-- a clean PostgreSQL 16 and calling the platform's own functions against it.
-- The Demo toggle on the tenants page fails with:
--
--   ERROR: relation "public.demo_baselines" does not exist
--   CONTEXT: PL/pgSQL function set_tenant_demo(uuid,boolean) line 16 at IF
--
-- 020 guards un-marking a tenant by looking for rows in `demo_baselines`.
-- 021 DROPPED that table -- deliberately, replacing per-game baselines with a
-- single `demo_seed` -- and left 020's function pointing at it.
--
-- WHY IT BREAKS EVEN WHEN MARKING **TRUE**, which is the surprising half.
-- The guard reads:
--
--   if not p_demo and exists (select 1 from public.demo_baselines ...)
--
-- and `not p_demo` is false for a true call, so SQL's short-circuit should
-- never reach the subquery. It does not get that far: PL/pgSQL PREPARES the
-- whole expression as one statement before evaluating any of it, and
-- preparation fails on a relation that is not there. Short-circuiting is a
-- runtime property; this dies at plan time. So the toggle is dead in both
-- directions, not just the one the guard was written for.
--
-- ============================================================================
-- WHY THIS MATTERS MORE NOW THAN IT DID YESTERDAY
--
-- 028's backfill and its future create_tenant hook both key off
-- `tenants.is_demo`. With this function broken, a tenant cannot be marked as
-- a demo at all -- so a new demo school could never be added to the sweep,
-- and the failure would look like "the sample game did not appear" rather
-- than like a broken toggle three screens away.
--
-- ============================================================================
-- WHAT REPLACES THE GUARD
--
-- The hazard 020 was protecting against is still real, only its shape moved.
-- Under 019 it was: un-marking a tenant strands its per-game baselines,
-- because assert_demo_game() would then refuse to reset them.
--
-- Under 021 there is one demo_seed, naming one target_game_id. Un-marking the
-- tenant that owns THAT game breaks reset_demo() the same way -- the button
-- stops working and the demo game is stuck in whatever state it was last
-- left in. So the guard is kept, pointed at the table that now exists.
--
-- NOT guarded: un-marking the tenant that a sample game was captured from
-- (028). That only means the next capture_sample_game() is refused until the
-- flag goes back, which is a message at the moment you run it rather than
-- state left broken behind you -- and the template already captured is
-- unaffected either way.
-- ============================================================================

create or replace function public.set_tenant_demo(
  p_tenant uuid,
  p_demo   boolean
) returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can mark a tenant as a demo.';
  end if;

  -- UNMARKING MUST NOT STRAND THE DEMO SEED. reset_demo() calls
  -- assert_demo_game() on its target every time, so a tenant that owns that
  -- game and is no longer flagged leaves the reset button permanently
  -- refusing -- and the demo stuck wherever it was last left.
  --
  -- Refused rather than cascaded, exactly as 020 decided: clearing somebody's
  -- demo seed as a side effect of a checkbox is worse than making them do it
  -- deliberately.
  if not p_demo and exists (
    select 1 from public.demo_seed s
      join public.games g on g.id = s.target_game_id
     where g.tenant_id = p_tenant
  ) then
    raise exception 'That tenant holds the demo seed target game. Re-capture the '
                    'seed against another tenant first -- unmarking it now would '
                    'leave reset_demo() permanently refusing.';
  end if;

  update public.tenants set is_demo = p_demo where id = p_tenant;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'No such tenant: %', p_tenant;
  end if;
  return p_demo;
end;
$function$;

comment on function public.set_tenant_demo(uuid, boolean) is
  'Marks a tenant as a demo, or un-marks it. Refuses to un-mark the tenant '
  'holding demo_seed''s target game, which would leave reset_demo() refusing. '
  'Repaired in 029: 020 guarded against demo_baselines, which 021 dropped, and '
  'PL/pgSQL prepares the whole guard before short-circuiting it - so the '
  'function threw on every call, in both directions, not only on un-marking.';

revoke all on function public.set_tenant_demo(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_demo(uuid, boolean) to authenticated;

insert into public.schema_migrations (version, name)
values (29, '029_fix_set_tenant_demo') on conflict (version) do nothing;
