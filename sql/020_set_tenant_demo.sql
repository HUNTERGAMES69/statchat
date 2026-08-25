-- 020_set_tenant_demo.sql
-- ============================================================================
-- MARK A TENANT AS A DEMO, FROM THE CONSOLE.
--
-- 019 added `tenants.is_demo` and gated seeding and resetting on it -- and
-- provided no way to SET it. The only route was hand-written SQL in the
-- Supabase editor, which meant the demo controls were invisible on a tenant
-- created for exactly that purpose, with nothing on screen explaining why.
--
-- A flag that gates a feature has to be settable wherever the feature lives.
--
-- Kept as an RPC rather than a direct update from the browser, to match
-- set_tenant_deleted: the platform check lives in one place, in SQL, and is
-- the same for every tenant-level change.
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

  -- UNMARKING IS NOT ALLOWED TO ORPHAN A BASELINE. A tenant with seeded demo
  -- games that is no longer flagged can never be reset again -- assert_demo_game
  -- would refuse it -- so the snapshot would sit there unusable and the demo
  -- game would be stuck in whatever state it was last left in.
  --
  -- Refused rather than cascaded: deleting somebody's baselines as a side
  -- effect of a checkbox is worse than making them clear the games first.
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
  return v_rows > 0;
end;
$function$;

revoke all on function public.set_tenant_demo(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_demo(uuid, boolean) to authenticated;

insert into public.schema_migrations (version, name)
values (20, '020_set_tenant_demo') on conflict (version) do nothing;
