-- 030_sample_game_scope_DOWN.sql
-- ============================================================================
-- Reverses 030, restoring 028's demos-only sweep as a real function again.
--
-- SEEDED GAMES ARE NOT REMOVED, for the same reason 028's DOWN leaves them:
-- by the time this runs a school may have opened its sample and be looking
-- at it. Removing one is the ordinary soft delete, per school:
--
--   update public.games set deleted_at = now()
--    where designator = 'SAMPLE' and tenant_id = '<tenant uuid>';
--
-- AFTER THIS RUNS, seed_sample_game_into_demos() sweeps DEMOS ONLY again --
-- so if the schools you seeded are trials, it will report 0 and mean it.
-- ============================================================================

drop function if exists public.seed_sample_game_into(text, text);
drop function if exists public.sample_game_candidates(text, text);

create or replace function public.seed_sample_game_into_demos(
  p_designator text default 'SAMPLE'
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  t         record;
  v_added   integer := 0;
  v_skipped integer := 0;
  v_game    uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can seed sample games.';
  end if;

  for t in
    select id, name from public.tenants
     where is_demo and deleted_at is null
       and id is distinct from (
             select g.tenant_id from public.games g
               join public.sample_game sg on sg.captured_from = g.id
              where sg.only_row)
     order by created_at
  loop
    select g.id into v_game
      from public.games g
     where g.tenant_id = t.id and g.designator = p_designator;
    if v_game is null then
      begin
        perform public.apply_sample_game(t.id, p_designator);
        v_added := v_added + 1;
      exception when others then
        v_skipped := v_skipped + 1;
        raise notice 'Skipped %: %', t.name, sqlerrm;
      end;
    end if;
  end loop;

  if v_skipped > 0 then
    raise notice '% school(s) seeded, % skipped (see above).', v_added, v_skipped;
  end if;
  return v_added;
end;
$function$;

delete from public.schema_migrations where version = 30;
