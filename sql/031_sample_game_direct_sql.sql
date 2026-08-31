-- 031_sample_game_direct_sql.sql
-- ============================================================================
-- THE SAMPLE-GAME FUNCTIONS REFUSED THE ONLY PLACE THEY ARE EVER RUN FROM.
--
--   ERROR: Only the platform can capture the sample game.
--   CONTEXT: PL/pgSQL function capture_sample_game(uuid,text) line 7
--
-- is_super_admin() reads `profiles where id = auth.uid()`. The Supabase SQL
-- editor has no JWT, so auth.uid() is NULL, the lookup finds nothing, and the
-- coalesce returns false. Every one of these functions is documented "run
-- this by hand in the SQL editor" -- and every one of them refused exactly
-- that.
--
-- ============================================================================
-- THIS IS NOT A NEW PROBLEM, AND THE ANSWER IS ALREADY WRITTEN DOWN
--
-- capture_demo_seed() hit it first. tests/demo_seed_reset_check.js still
-- asserts the fix, in a file it expects to find at
-- sql/022_demo_guard_direct_sql.sql:
--
--   'no JWT means direct database access, which is already total - refusing
--    it blocks the setup script and protects nothing'
--
-- That migration is NOT IN THE REPOSITORY. It is not on main and 021 carries
-- no such gate, so either it was applied to the database and never committed,
-- or it was never written. Flagged 31 Aug 2026; this migration does not fix
-- that gap, it just stops repeating the mistake it was written for.
--
-- ============================================================================
-- WHAT THE GATE BECOMES
--
--   if auth.uid() is not null and not is_super_admin() then refuse
--
-- A SIGNED-IN user who is not the platform is still refused, which is the
-- case the gate exists for -- a school's own admin calling this by RPC.
--
-- NO auth.uid() AT ALL means the caller is talking to the database directly,
-- with credentials that can already drop the table. A check cannot defend
-- against someone who has passed it by definition; all it can do is block the
-- legitimate use, which is what it was doing.
--
-- ============================================================================
-- WHAT IS DELIBERATELY *NOT* RELAXED
--
-- set_tenant_demo() (029) keeps its strict gate. It has a home in the
-- platform UI, where there IS a JWT, and it is called by a button rather than
-- by hand -- so relaxing it would widen a gate for no use that exists. The
-- distinction is not "how dangerous" but "is the SQL editor its only home".
-- For everything below it is.
--
-- assert_demo_game() IS relaxed the same way -- see the note above it below.
-- Its is_demo CHECK is untouched and still applies to everyone, direct SQL
-- included. That check guards against a MISTAKE rather than an attacker --
-- pointing capture at a real school's game -- and the person running a script
-- by hand is precisely who makes that mistake.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- One helper, so the rule is written once and the four call sites cannot
-- drift apart the way nine ladder buttons did.
-- ---------------------------------------------------------------------------
create or replace function public.platform_or_direct_sql()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select auth.uid() is null or public.is_super_admin();
$function$;

comment on function public.platform_or_direct_sql() is
  'True for the platform, and true for direct database access (no JWT, so no '
  'auth.uid()). Refusing a caller who already holds database credentials '
  'blocks the documented setup path and protects nothing.';

-- ---------------------------------------------------------------------------
-- assert_demo_game() CARRIES THE SAME GATE, and it is the one the missing
-- 022 was actually written against.
-- ---------------------------------------------------------------------------
-- 019 opens it with `if not is_super_admin() then raise` before it ever looks
-- at is_demo -- so from the SQL editor it refuses before reaching the check
-- that matters. capture_sample_game() calls it, which is why relaxing the
-- four functions below was not enough on its own.
--
-- This is exactly what tests/demo_seed_reset_check.js expects of
-- 022_demo_guard_direct_sql.sql, down to the shape of the condition and the
-- insistence that the v_is_demo check stays untouched. That file is still
-- missing from the repository; this restores the behaviour it describes, so
-- capture_demo_seed() and reset_demo() -- which also go through here -- start
-- working from the SQL editor again too.
--
-- THE is_demo CHECK IS UNCHANGED and applies to everyone, direct SQL
-- included. It guards against a MISTAKE rather than an attacker -- pointing
-- a seed at a real school's game -- and the person running a script by hand
-- is precisely who makes that mistake.
create or replace function public.assert_demo_game(p_game uuid)
returns void language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_is_demo boolean;
begin
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

  -- THE LINE THAT MATTERS. Everything else here is convenience.
  if not v_is_demo then
    raise exception 'That game belongs to a real school. Seeding and resetting '
                    'are only possible on a tenant marked is_demo.';
  end if;
end;
$function$;

create or replace function public.capture_sample_game(
  p_source_game uuid,
  p_note        text default null
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  g       public.games%rowtype;
  v_count integer;
begin
  if not public.platform_or_direct_sql() then
    raise exception 'Only the platform can capture the sample game.';
  end if;

  -- UNCHANGED, and it applies to direct SQL too. This is the whole safety
  -- model now there is no scrub: the source cannot be a real school's game.
  perform public.assert_demo_game(p_source_game);

  select * into g from public.games where id = p_source_game;
  if g.id is null then
    raise exception 'No such game: %', p_source_game;
  end if;
  if g.status = 'setup' then
    raise exception 'The sample game has not been started. Score some of it first -- a game in setup has nothing to show.';
  end if;
  select count(*) into v_count from public.plays where game_id = p_source_game;
  if v_count = 0 then
    raise exception 'The sample game has no plays in it. There is nothing to hand a school.';
  end if;
  if g.status = 'final' and (g.final_score_us is null or g.final_score_opp is null) then
    raise exception 'This game is marked final but has no final score recorded. Finish it through the app so final_score_us and final_score_opp are written.';
  end if;

  insert into public.sample_game (only_row, shell, rosters, plays, captured_from, note)
  values (
    true,
    jsonb_build_object(
      'home_team_name',           g.home_team_name,
      'away_team_name',           g.away_team_name,
      'our_team_is_home',         g.our_team_is_home,
      'quarter_length_seconds',   g.quarter_length_seconds,
      'game_date',                g.game_date,
      'opponent_logo_url',        g.opponent_logo_url,
      'opponent_primary_color',   g.opponent_primary_color,
      'opponent_secondary_color', g.opponent_secondary_color,
      'status',                   g.status,
      'game_phase',               g.game_phase,
      'seed_starters',            g.seed_starters,
      'final_score_us',           g.final_score_us,
      'final_score_opp',          g.final_score_opp
    ),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'team_side', r.team_side, 'jersey_number', r.jersey_number,
              'player_name', r.player_name, 'unit', r.unit,
              'position', r."position") order by r.team_side, r.jersey_number), '[]'::jsonb)
       from public.game_rosters r where r.game_id = p_source_game),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'quarter', p.quarter, 'sequence_number', p.sequence_number,
              'team_side', p.team_side, 'text', p.text, 'effect', p.effect,
              'roles', p.roles, 'unresolved', p.unresolved,
              'is_divider', p.is_divider, 'is_override', p.is_override
            ) order by p.sequence_number), '[]'::jsonb)
       from public.plays p where p.game_id = p_source_game),
    p_source_game,
    coalesce(p_note, 'captured ' || to_char(now(), 'YYYY-MM-DD'))
  )
  on conflict (only_row) do update
     set shell = excluded.shell, rosters = excluded.rosters,
         plays = excluded.plays, captured_from = excluded.captured_from,
         note = excluded.note, captured_at = now();

  select jsonb_array_length(plays) into v_count from public.sample_game where only_row;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The other three carry the same gate, changed the same way. Their bodies are
-- otherwise byte-identical to 028 and 030.
-- ---------------------------------------------------------------------------
create or replace function public.apply_sample_game(
  p_tenant     uuid,
  p_designator text default 'SAMPLE'
) returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  s        public.sample_game%rowtype;
  v_team   uuid;
  v_season integer;
  v_date   date;
  v_game   uuid;
begin
  if not public.platform_or_direct_sql() then
    raise exception 'Only the platform can seed a sample game.';
  end if;

  select * into s from public.sample_game where only_row;
  if s.only_row is null then
    raise exception 'There is no sample game yet. Run capture_sample_game() once first.';
  end if;

  select t.id, t.current_season_year into v_team, v_season
    from public.teams t
   where t.tenant_id = p_tenant and t.is_our_team
   order by t.created_at
   limit 1;
  if v_team is null then
    raise exception 'Tenant % has no team, so it has nothing to attach a game to.', p_tenant;
  end if;

  select g.id into v_game
    from public.games g
   where g.tenant_id = p_tenant
     and g.designator = p_designator
     and g.deleted_at is null;
  if v_game is not null then
    return v_game;
  end if;

  v_season := coalesce(v_season, extract(year from now())::integer);
  v_date := case
              when (s.shell->>'game_date') is null then null
              else make_date(v_season,
                             extract(month from (s.shell->>'game_date')::date)::integer,
                             extract(day   from (s.shell->>'game_date')::date)::integer)
            end;

  -- Still inserted in_progress and finalised at the end only if the source
  -- was final: plays_immutable_when_final refuses an insert into a final
  -- game, and it has no super-admin exemption.
  insert into public.games (
    tenant_id, team_id, designator, season_year, game_date,
    home_team_name, away_team_name, our_team_is_home,
    quarter_length_seconds, opponent_logo_url,
    opponent_primary_color, opponent_secondary_color,
    seed_starters, guided_state, status, game_phase,
    is_sample, is_preseason, is_broadcast, is_public
  )
  values (
    p_tenant, v_team, p_designator, v_season, v_date,
    s.shell->>'home_team_name', s.shell->>'away_team_name',
    (s.shell->>'our_team_is_home')::boolean,
    coalesce((s.shell->>'quarter_length_seconds')::integer, 720),
    s.shell->>'opponent_logo_url',
    s.shell->>'opponent_primary_color', s.shell->>'opponent_secondary_color',
    s.shell->'seed_starters',
    '{}'::jsonb,
    'in_progress', s.shell->>'game_phase',
    true, true, false, false
  )
  returning id into v_game;

  insert into public.game_rosters
    (game_id, tenant_id, team_side, jersey_number, player_name, unit, "position")
  select v_game, p_tenant, x.team_side, x.jersey_number, x.player_name, x.unit, x."position"
    from jsonb_to_recordset(s.rosters)
      as x(team_side text, jersey_number text, player_name text, unit text, "position" text);

  insert into public.plays
    (game_id, tenant_id, quarter, sequence_number, team_side, text, effect,
     roles, unresolved, is_divider, is_override)
  select v_game, p_tenant, x.quarter, x.sequence_number, x.team_side, x.text,
         x.effect, x.roles, x.unresolved, x.is_divider, x.is_override
    from jsonb_to_recordset(s.plays)
      as x(quarter integer, sequence_number numeric, team_side text, text text,
           effect jsonb, roles jsonb, unresolved boolean, is_divider boolean,
           is_override boolean);

  if (s.shell->>'status') = 'final' then
    update public.games
       set status = 'final',
           final_score_us  = (s.shell->>'final_score_us')::integer,
           final_score_opp = (s.shell->>'final_score_opp')::integer
     where id = v_game;
  end if;

  return v_game;
end;
$function$;

create or replace function public.sample_game_candidates(
  p_scope      text default 'trial',
  p_designator text default 'SAMPLE'
) returns table (
  tenant_id      uuid,
  tenant_name    text,
  status         text,
  created        date,
  their_own_games bigint,
  would_seed     boolean,
  reason         text
) language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_source uuid;
begin
  if not public.platform_or_direct_sql() then
    raise exception 'Only the platform can look at this.';
  end if;
  if p_scope not in ('demo','trial','both') then
    raise exception 'Scope must be demo, trial or both. Got "%".', p_scope;
  end if;

  select g.tenant_id into v_source
    from public.sample_game s join public.games g on g.id = s.captured_from
   where s.only_row;

  return query
  select
    t.id,
    t.name,
    case when t.is_demo                     then 'DEMO'
         when t.disabled_at is not null     then 'SUSPENDED'
         when t.subscription = 'lifetime'   then 'LIFETIME'
         when t.subscription in ('active','lapsed') then 'PAID'
         else 'TRIAL' end,
    t.created_at::date,
    (select count(*) from public.games g
      where g.tenant_id = t.id and g.deleted_at is null
        and g.is_sample is not true),
    (
      case when t.is_demo then p_scope in ('demo','both')
           when t.disabled_at is null
            and t.subscription is not distinct from 'trial' then p_scope in ('trial','both')
           else false end
      and t.id is distinct from v_source
      and not exists (select 1 from public.games g
                       where g.tenant_id = t.id and g.designator = p_designator)
      and exists (select 1 from public.teams tm
                   where tm.tenant_id = t.id and tm.is_our_team)
    ),
    case
      when t.id = v_source then 'skipped: the sample was captured from this tenant'
      when exists (select 1 from public.games g
                    where g.tenant_id = t.id and g.designator = p_designator
                      and g.deleted_at is not null)
        then 'skipped: had it and deleted it'
      when exists (select 1 from public.games g
                    where g.tenant_id = t.id and g.designator = p_designator)
        then 'skipped: already has it'
      when not exists (select 1 from public.teams tm
                        where tm.tenant_id = t.id and tm.is_our_team)
        then 'SKIPPED: no team row - this tenant is broken, look at it'
      when t.is_demo and p_scope not in ('demo','both') then 'out of scope (demo)'
      when not t.is_demo and t.subscription is not distinct from 'trial'
           and t.disabled_at is null and p_scope not in ('trial','both')
        then 'out of scope (trial)'
      when t.disabled_at is not null then 'out of scope (suspended)'
      when t.subscription = 'lifetime' then 'out of scope (lifetime)'
      when t.subscription in ('active','lapsed') then 'out of scope (paid)'
      else 'would be seeded'
    end
  from public.tenants t
  where t.deleted_at is null
  order by t.is_demo desc, t.created_at;
end;
$function$;

create or replace function public.seed_sample_game_into(
  p_scope      text default 'trial',
  p_designator text default 'SAMPLE'
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  r         record;
  v_added   integer := 0;
  v_skipped integer := 0;
begin
  if not public.platform_or_direct_sql() then
    raise exception 'Only the platform can seed sample games.';
  end if;
  if not exists (select 1 from public.sample_game where only_row) then
    raise exception 'There is no sample game yet. Run capture_sample_game() once first.';
  end if;

  for r in select * from public.sample_game_candidates(p_scope, p_designator)
            where would_seed
  loop
    begin
      perform public.apply_sample_game(r.tenant_id, p_designator);
      v_added := v_added + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      raise notice 'Skipped %: %', r.tenant_name, sqlerrm;
    end;
  end loop;

  if v_skipped > 0 then
    raise notice '% school(s) seeded, % skipped (see above).', v_added, v_skipped;
  end if;
  return v_added;
end;
$function$;

revoke all on function public.platform_or_direct_sql() from public, anon;
grant execute on function public.platform_or_direct_sql() to authenticated;

insert into public.schema_migrations (version, name)
values (31, '031_sample_game_direct_sql') on conflict (version) do nothing;
