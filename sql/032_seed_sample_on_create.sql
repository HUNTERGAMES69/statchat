-- 032_seed_sample_on_create.sql
-- ============================================================================
-- EVERY NEW SCHOOL GETS THE SAMPLE GAME, AT CREATION.
--
-- Andy's call, 31 Aug 2026. 028 through 031 built the machinery and backfilled
-- the schools that already existed, deliberately leaving the create_tenant
-- hook until the sample had been seen in a real account. It has been, so this
-- is that hook.
--
-- EVERY tenant, not only trials. create_tenant() runs BEFORE anyone pays --
-- there is no subscription to inspect at that moment, and a school that signs
-- up already paying wants an example as much as a trial does. That is the
-- opposite of the sweep's rule, where paid tenants are never in scope, and the
-- difference is deliberate: the sweep reaches into schools that may be
-- mid-season, this runs at the one moment a school is guaranteed to have no
-- games at all.
--
-- ============================================================================
-- IT MUST NEVER STOP A SCHOOL BEING CREATED
--
-- This is the whole reason the call is wrapped rather than written inline.
-- 013 exists because a tenant without a team is invisibly broken; a tenant
-- that fails to be created at all is worse, and a missing sample game is
-- nothing. Every way this can fail -- no template captured yet, a template
-- captured from a game since deleted, a malformed shell, a constraint that
-- moves later -- has to end with the school created and the sample absent.
--
-- The exception block is what buys that. In PL/pgSQL an EXCEPTION clause
-- opens a subtransaction, so a failure inside it rolls back the sample game's
-- rows and nothing else: the tenants and teams inserts above are already
-- committed to the enclosing transaction and stay. Without the block, any
-- error here would roll back the whole function and the signup would fail.
--
-- The failure is announced with RAISE NOTICE rather than swallowed silently,
-- so somebody reading the logs after "why did that school not get one" has an
-- answer waiting rather than a mystery.
--
-- ============================================================================
-- WHY NOT A TRIGGER ON tenants
--
-- A trigger would catch tenants created by any route, including a hand-written
-- INSERT. That sounds better and is worse: apply_sample_game needs the TEAM
-- row, and a trigger on tenants fires before 013 has inserted it -- so it
-- would have to defer, or fire on teams instead and guess which team insert
-- means "a school was just made". create_tenant is the one place that knows
-- both rows exist and that this is a new school rather than a second sport.
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
  --
  -- FULL NAME GOES ON THE TEAM AS WELL AS THE TENANT, because
  -- customize.html reads it from `teams` -- written to only `tenants`, a
  -- new school opened Customize and saw the input's PLACEHOLDER, which
  -- read as another school's name.
  insert into public.teams (tenant_id, name, full_name, is_our_team, sport, current_season_year)
  values (new_tenant, clean_name, nullif(trim(coalesce(p_full_name, '')), ''), true, 'football',
          coalesce(p_season, extract(year from now())::integer));

  -- THE SAMPLE GAME. Added 032, and everything about the shape of this is
  -- about it being unable to break the two inserts above.
  --
  -- AFTER the team, because apply_sample_game attaches the game to it and
  -- reads current_season_year from it -- both written one statement ago and
  -- visible here, same transaction.
  --
  -- The exception block catches EVERYTHING, deliberately. A narrower handler
  -- would mean guessing in advance which failures are acceptable, and the
  -- answer is all of them: there is no error here worth failing a signup for.
  begin
    perform public.apply_sample_game(new_tenant);
  exception when others then
    raise notice 'Sample game not seeded for "%": %', clean_name, sqlerrm;
  end;

  return new_tenant;
end;
$function$;

comment on function public.create_tenant(text, text, integer) is
  'Creates a school, its first team, and its sample game in one transaction. '
  'A tenant without a team is invisibly broken - thirteen pages read the team '
  'to find out who "we" are. The sample game is best-effort: it cannot fail a '
  'signup, and a school created without one is merely missing an example.';

revoke all on function public.create_tenant(text, text, integer) from public, anon;
grant execute on function public.create_tenant(text, text, integer) to authenticated;

insert into public.schema_migrations (version, name)
values (32, '032_seed_sample_on_create') on conflict (version) do nothing;
