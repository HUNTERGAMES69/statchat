-- 031_sample_game_direct_sql_DOWN.sql
-- ============================================================================
-- Reverses 031, restoring the strict is_super_admin() gate everywhere.
--
-- AFTER THIS RUNS, none of these can be called from the Supabase SQL editor
-- again -- capture_sample_game, apply_sample_game, sample_game_candidates,
-- seed_sample_game_into, and (through assert_demo_game) capture_demo_seed and
-- reset_demo. The editor has no JWT, so auth.uid() is NULL and every one of
-- them refuses. That is the state 031 exists to undo, so running this puts
-- the fault back on purpose.
--
-- Only the four sample functions' GATES are restored here; their bodies are
-- 031's, which are otherwise identical to 028 and 030. To go further back,
-- run 030_DOWN and 028_DOWN.
-- ============================================================================

-- assert_demo_game, back to 019's definition verbatim.
create or replace function public.assert_demo_game(p_game uuid)
returns void language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_is_demo boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can seed or reset a demo game.';
  end if;

  select t.is_demo into v_is_demo
    from public.games g
    join public.tenants t on t.id = g.tenant_id
   where g.id = p_game;

  if v_is_demo is null then
    raise exception 'No such game, or it has no tenant.';
  end if;

  if not v_is_demo then
    raise exception 'That game belongs to a real school. Seeding and resetting '
                    'are only possible on a tenant marked is_demo.';
  end if;
end;
$function$;

-- The helper is what the four sample functions test, so pointing it back at
-- is_super_admin() alone restores their strict behaviour without four more
-- copies of their bodies here.
create or replace function public.platform_or_direct_sql()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_super_admin();
$function$;

comment on function public.platform_or_direct_sql() is
  'REVERTED by 031_DOWN: platform only. The SQL editor has no JWT and is now '
  'refused by every function that calls this.';

delete from public.schema_migrations where version = 31;
