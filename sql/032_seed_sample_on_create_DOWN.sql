-- 032_seed_sample_on_create_DOWN.sql
-- ============================================================================
-- Reverses 032, restoring 013's create_tenant verbatim.
--
-- After this, a new school is created with a tenant row and a team row and
-- nothing else -- an empty dashboard on first login, as before 032.
--
-- SCHOOLS ALREADY CREATED KEEP THEIR SAMPLE GAME. This changes only what the
-- NEXT signup receives. Removing one is the ordinary soft delete:
--
--   update public.games set deleted_at = now()
--    where designator = 'SAMPLE' and tenant_id = '<tenant uuid>';
-- ============================================================================

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
  if not public.is_super_admin() then
    raise exception 'Only the platform can create a school.';
  end if;
  if clean_name is null then
    raise exception 'A school needs a name.';
  end if;

  if exists (select 1 from public.tenants where lower(name) = lower(clean_name)) then
    raise exception 'A school called "%" already exists. If this is a different school, give it a distinguishing name.', clean_name;
  end if;

  insert into public.tenants (name, full_name)
  values (clean_name, nullif(trim(coalesce(p_full_name, '')), ''))
  returning id into new_tenant;

  insert into public.teams (tenant_id, name, full_name, is_our_team, sport, current_season_year)
  values (new_tenant, clean_name, nullif(trim(coalesce(p_full_name, '')), ''), true, 'football',
          coalesce(p_season, extract(year from now())::integer));

  return new_tenant;
end;
$function$;

comment on function public.create_tenant(text, text, integer) is
  'Creates a school and its first team in one transaction. A tenant without a team is invisibly broken - thirteen pages read the team to find out who "we" are.';

delete from public.schema_migrations where version = 32;
