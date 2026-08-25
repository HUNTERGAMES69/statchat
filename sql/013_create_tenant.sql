-- =====================================================================
-- 013 — creating a school, atomically
--
-- A new tenant is not one row. It is a `tenants` row AND a `teams` row,
-- and a school with no team is broken in a way that is invisible until
-- somebody tries to use it: thirteen pages read the team to find out who
-- "we" are, and every one of them would come back empty.
--
-- Two client calls cannot be atomic. A function can, so this is a
-- function — if the team insert fails the tenant is rolled back with it,
-- and there is no half-made school sitting in the list.
--
-- IS_OUR_TEAM IS SET TRUE, and that is not a leftover. Thirteen pages
-- still query `.eq('is_our_team', true)` to find "my team". Since 009
-- scoped `teams` by tenant those queries return the caller's own row, so
-- the flag now means "the team within MY school" rather than "the one
-- team in the system". A new school whose team had the flag false would
-- look empty on every one of those pages.
--
-- The flag is redundant under tenancy and is on the list to remove. Until
-- it is, a new tenant must match what the application still expects.
-- =====================================================================

create or replace function public.create_tenant(
  p_name       text,
  p_full_name  text default null,
  p_season     integer default null
) returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  new_tenant uuid;
  clean_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  -- SECURITY DEFINER means RLS is not doing this for us.
  if not public.is_super_admin() then
    raise exception 'Only the platform can create a school.';
  end if;
  if clean_name is null then
    raise exception 'A school needs a name.';
  end if;

  -- Names are not unique in the schema and should not be: two districts
  -- may each have a "Central High". But creating the SAME name twice in
  -- a row is far more likely to be a double-submitted form than a real
  -- second school, so it is refused with something a human can act on.
  if exists (select 1 from public.tenants where lower(name) = lower(clean_name)) then
    raise exception 'A school called "%" already exists. If this is a different school, give it a distinguishing name.', clean_name;
  end if;

  insert into public.tenants (name, full_name)
  values (clean_name, nullif(trim(coalesce(p_full_name, '')), ''))
  returning id into new_tenant;

  -- The team carries the same name to start with. It is the SPORT within
  -- the school, and a school fielding one sport should not have to think
  -- about the distinction on day one.
  insert into public.teams (tenant_id, name, is_our_team, sport, current_season_year)
  values (new_tenant, clean_name, true, 'football',
          coalesce(p_season, extract(year from now())::integer));

  return new_tenant;
end;
$function$;

comment on function public.create_tenant(text, text, integer) is
  'Creates a school and its first team in one transaction. A tenant without a team is invisibly broken - thirteen pages read the team to find out who "we" are.';

revoke all on function public.create_tenant(text, text, integer) from public, anon;
grant execute on function public.create_tenant(text, text, integer) to authenticated;

insert into public.schema_migrations (version, name)
values (13, '013_create_tenant') on conflict (version) do nothing;
