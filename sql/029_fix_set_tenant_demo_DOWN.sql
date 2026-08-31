-- 029_fix_set_tenant_demo_DOWN.sql
-- ============================================================================
-- Reverses 029 by restoring 020's definition verbatim.
--
-- BE CLEAR ABOUT WHAT THIS DOES: it puts back a function that THROWS on every
-- call, in both directions, because it references public.demo_baselines --
-- which 021 dropped and 029 exists to stop pointing at.
--
-- There is no version of set_tenant_demo between "020 as written" and "029"
-- that works, so this DOWN restores a broken function on purpose, for the
-- sake of a reversible migration set. If you are running it to fix something,
-- you almost certainly want to fix 029 forward instead.
-- ============================================================================

create or replace function public.set_tenant_demo(
  p_tenant uuid, p_demo boolean
) returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can mark a tenant as a demo.';
  end if;

  if not p_demo and exists (
    select 1 from public.demo_baselines b
      join public.games g on g.id = b.game_id
     where g.tenant_id = p_tenant
  ) then
    raise exception 'That tenant still has seeded demo games. Remove those games '
                    'first -- unmarking it now would leave them unresettable.';
  end if;

  update public.tenants set is_demo = p_demo where id = p_tenant;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'No such tenant: %', p_tenant;
  end if;
  return p_demo;
end;
$function$;

delete from public.schema_migrations where version = 29;
