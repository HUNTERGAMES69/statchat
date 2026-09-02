-- 022_demo_guard_direct_sql.sql
-- ============================================================================
-- capture_demo_seed() COULD NOT BE RUN WHERE IT IS MEANT TO BE RUN.
--
-- It is a one-time setup script, documented as "run this in the SQL editor",
-- and it failed there with:
--
--   ERROR: Only the platform can seed or reset a demo game.
--
-- assert_demo_game() calls is_super_admin(), which reads
-- `profiles where id = auth.uid()`. The SQL editor has no JWT, so auth.uid()
-- is NULL, no profile matches, and the check fails. The guard was blocking
-- the exact use it was written for.
--
-- ============================================================================
-- THE FIX, AND WHY IT IS NOT A HOLE
--
-- No JWT means the caller reached the database directly -- the SQL editor,
-- psql, a migration. That is already the highest privilege there is: anyone
-- in that position can UPDATE tenants SET is_demo, or delete the plays by
-- hand, and no function-level check can stop them. Refusing them is
-- theatre that only obstructs the intended workflow.
--
-- A JWT that is present but not a platform account is still refused, which
-- is the case the check exists for: reset_demo() is granted to
-- `authenticated` and reachable from any signed-in browser.
--
-- The is_demo check is UNCHANGED and applies to everyone. That is the one
-- that matters -- it is what stops a reset reaching a real school's season,
-- and direct database access does not exempt anybody from it, because the
-- point of it is to catch a mistake rather than to stop an attacker.
-- ============================================================================

create or replace function public.assert_demo_game(p_game uuid)
returns void language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_is_demo boolean;
begin
  -- auth.uid() IS NULL when there is no JWT, which means direct database
  -- access -- the SQL editor or psql. Someone already there can change
  -- anything this function guards, so requiring a platform login of them
  -- blocks the setup script and protects nothing.
  --
  -- A JWT that is NOT a platform account is still refused: reset_demo() is
  -- granted to `authenticated`, so any signed-in browser can reach it.
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Only the platform can seed or reset a demo game.';
  end if;

  select t.is_demo into v_is_demo
    from public.games g
    join public.tenants t on t.id = g.tenant_id
   where g.id = p_game;

  if v_is_demo is null then
    raise exception 'No such game, or it has no tenant.';
  end if;

  -- UNCHANGED, and applies to every caller including direct SQL. This is the
  -- check that stops a reset wiping a real school's season, and it guards
  -- against a mistake rather than against an attacker -- so the person most
  -- likely to trip it is exactly the one running a script by hand.
  if not v_is_demo then
    raise exception 'That game belongs to a real school. Seeding and resetting '
                    'are only possible on a tenant marked is_demo.';
  end if;
end;
$function$;

insert into public.schema_migrations (version, name)
values (22, '022_demo_guard_direct_sql') on conflict (version) do nothing;
