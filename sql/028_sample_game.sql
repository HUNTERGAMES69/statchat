-- 028_sample_game.sql
-- ============================================================================
-- A SAMPLE GAME, SEEDED INTO A SCHOOL'S OWN DASHBOARD.
--
-- A brand-new school signs in to an empty dashboard, which is the worst
-- possible first screen: every report is blank, nothing can be clicked into,
-- and the only way to see what the app does is to go and score a game. This
-- puts one game there on day one -- openable, with a real box score, recap,
-- stat package and player reports behind it.
--
-- FINISHED OR STILL IN PROGRESS, WHICHEVER THE SOURCE IS. Andy's call, 31
-- Aug 2026, revised: a game left mid-play is the better teacher, because the
-- school can open it and actually enter a snap rather than only read about
-- one. It is also the choice 021 already made for the demo tenant -- captured
-- through Q2 "so the demo opens at halftime with real accumulated stats
-- rather than an empty sheet" -- so the two now agree.
--
-- Nothing here decides that. The copy is whatever the source is, so it is
-- settled by how the sample game is left, not by a parameter to remember.
--
-- ============================================================================
-- WHY THIS IS NOT 021's demo_seed, AND DOES NOT REUSE IT
--
-- 021's seed is a SINGLETON BOUND TO ONE GAME. `demo_seed.target_game_id`
-- names the game reset_demo() rebuilds, and reset_demo() checks it with
-- assert_demo_game() every time. That is exactly right for what it does --
-- one demo environment, one button, structurally incapable of touching a
-- real school.
--
-- What this needs is the opposite shape: a TEMPLATE with no target, applied
-- to a tenant that does not have the game yet. Bending demo_seed into that
-- would mean loosening assert_demo_game, which is the one gate standing
-- between the demo tooling and a real season. So this is its own table and
-- its own pair of functions, and 021 is left exactly as it is.
--
-- ============================================================================
-- WHY A TEMPLATE RATHER THAN COPYING THE LIVE GAME EACH TIME
--
-- Andy's call, 31 Aug 2026. Copying straight from a live source game makes
-- that game load-bearing forever: editing it changes what future schools
-- receive, and deleting it breaks seeding with no warning. A captured
-- template can be re-captured deliberately, the source can then be changed
-- or thrown away, and there is a record of what was actually handed out.
--
-- ============================================================================
-- ON REAL NAMES
--
-- capture_sample_game() refuses any source outside a demo tenant, via
-- assert_demo_game(). It does NOT scrub, because it is not built to: the
-- intended source is a game hand-scored with invented names, which is the
-- only approach with no failure mode.
--
-- That decision came out of reading 021's scrub closely and finding three
-- ways a real name survives it, all of which stop mattering the moment the
-- source has no real name in it:
--
--   1. `roles` is copied verbatim, and CAN carry a name. When two players
--      share a jersey number the picker records which one, by name, into
--      roles.<role>.name -- and the box score prefers that over the roster
--      lookup, so the name renders as well as being stored. 021's comment
--      says roles holds "jersey numbers and yardage, never names"; that
--      stopped being true when shared numbers were fixed.
--   2. Both SCHOOL names sit in every line of play text -- "(Neville)",
--      "(Ruston)" -- and rewrite_demo_play_text builds its map from roster
--      player names only. School names are not in it.
--   3. That map pairs source to target by jersey ORDER and inner joins on
--      the row number, so if the two rosters differ in length the surplus
--      names are silently never replaced.
--
-- A scrub is a denylist and fails quietly. An invented source cannot leak
-- what it never contained.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- HOW A SAMPLE GAME IS RECOGNISED AFTERWARDS.
-- ---------------------------------------------------------------------------
-- The dashboard has to tell a seeded game apart from a real one, twice over:
-- its Getting-started card marks "Create your first game" done from the mere
-- existence of a game, which a sample would satisfy on day one -- telling a
-- school it had done something this migration did for it -- and the card's
-- last step is a reminder to delete the sample, which needs to know whether
-- it is still there.
--
-- A COLUMN RATHER THAN A DESIGNATOR MATCH. apply_sample_game takes the
-- designator as a parameter with a default, so a page matching on the string
-- 'SAMPLE' would silently stop recognising a sample seeded under any other
-- name -- and the failure would be the checklist quietly lying again, which
-- is the exact thing it is being added to stop. A column cannot drift from
-- the thing it names.
--
-- NULLABLE with a false default, matching is_preseason beside it rather than
-- the NOT NULL of is_broadcast. The inconsistency is noted in 000_baseline
-- and is not settled here; what matters is that `not is_sample` and
-- `is_sample is not true` differ on a null, so every reader below uses
-- `is distinct from true`.
alter table public.games add column if not exists is_sample boolean default false;

comment on column public.games.is_sample is
  'True on a game seeded by apply_sample_game - an example handed to the '
  'school, not something they created. Excluded from the Getting-started '
  'checklist''s "create your first game", and what its delete-the-sample step '
  'is counted from.';

create index if not exists games_sample_idx on public.games (tenant_id)
  where is_sample and deleted_at is null;

create table if not exists public.sample_game (
  -- SINGLETON, the same way demo_seed is: there is one sample game, and a
  -- second row would introduce the question of which one a tenant gets.
  only_row      boolean primary key default true check (only_row),
  -- The `games` row's own fields -- team names, colours, quarter length,
  -- final score. Stored because a finished game is not only its plays: the
  -- dashboard draws its W/L badge and score straight off final_score_us and
  -- final_score_opp, so a copy without them is a finished game showing
  -- nothing.
  shell         jsonb not null,
  rosters       jsonb not null,
  plays         jsonb not null,
  captured_from uuid,
  captured_at   timestamptz not null default now(),
  note          text
);

comment on table public.sample_game is
  'The one sample game handed to a school on day one. Captured from a '
  'hand-scored game in a demo tenant, then applied to any tenant that does '
  'not have it yet. Holds no real name because its source has none.';

alter table public.sample_game enable row level security;
revoke all on public.sample_game from anon, authenticated;

-- ---------------------------------------------------------------------------
-- CAPTURE. Run by hand, once, after scoring the sample as far as you want
-- schools to receive it -- part-played or finished, both are kept:
--
--   select public.capture_sample_game('<source game uuid>', 'first sample');
--
-- Re-running replaces the template. Schools already seeded keep what they
-- were given -- this changes only what the NEXT one receives.
-- ---------------------------------------------------------------------------
create or replace function public.capture_sample_game(
  p_source_game uuid,
  p_note        text default null
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  g       public.games%rowtype;
  v_count integer;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can capture the sample game.';
  end if;

  -- THE SOURCE MUST BE A DEMO GAME. This is the whole safety model: there
  -- is no scrub, so the only thing standing between a real Friday-night
  -- roster and every new school is that the source cannot be a real game.
  -- assert_demo_game already says exactly this, and says it the same way
  -- 019 and 021 do.
  perform public.assert_demo_game(p_source_game);

  select * into g from public.games where id = p_source_game;
  if g.id is null then
    raise exception 'No such game: %', p_source_game;
  end if;
  -- IN PROGRESS OR FINISHED, BOTH ALLOWED. What is refused is a game that
  -- has not started: 'setup' means no plays and nothing to show, which is
  -- the empty dashboard this exists to avoid, only with an extra click in
  -- front of it.
  if g.status = 'setup' then
    raise exception 'The sample game has not been started. Score some of it first -- a game in setup has nothing to show.';
  end if;
  select count(*) into v_count from public.plays where game_id = p_source_game;
  if v_count = 0 then
    raise exception 'The sample game has no plays in it. There is nothing to hand a school.';
  end if;
  -- Only a FINISHED game needs a score. An in-progress one has none by
  -- definition -- the app writes final_score_us/opp when the game is
  -- finalised -- and demanding one here would rule out exactly the case
  -- this was just relaxed to allow.
  if g.status = 'final' and (g.final_score_us is null or g.final_score_opp is null) then
    raise exception 'This game is marked final but has no final score recorded. Finish it through the app so final_score_us and final_score_opp are written.';
  end if;

  insert into public.sample_game (only_row, shell, rosters, plays, captured_from, note)
  values (
    true,
    -- CAPTURED, NOT INVENTED. Every one of these is taken from the source
    -- rather than defaulted here, so what a school receives is exactly the
    -- game that was scored and reviewed -- including game_phase, which the
    -- app writes separately from status and which nothing here should guess.
    --
    -- Deliberately ABSENT: designator, season_year, tenant_id, team_id and
    -- created_by, which belong to the receiving school; is_broadcast, which
    -- must never arrive true; and is_public/share_token, because a sample
    -- carrying a live public share token would publish six schools' sample
    -- games to the open web on one uuid.
    jsonb_build_object(
      'home_team_name',           g.home_team_name,
      'away_team_name',           g.away_team_name,
      'our_team_is_home',         g.our_team_is_home,
      'quarter_length_seconds',   g.quarter_length_seconds,
      'game_date',                g.game_date,
      'opponent_logo_url',        g.opponent_logo_url,
      'opponent_primary_color',   g.opponent_primary_color,
      'opponent_secondary_color', g.opponent_secondary_color,
      -- STATUS IS CARRIED, so the copy is whatever the source is rather
      -- than whatever this file assumes. game_phase alone is not enough:
      -- the app writes the two separately, and the dashboard, the season
      -- queries and the entry lock all read status, not phase.
      'status',                   g.status,
      'game_phase',               g.game_phase,
      'seed_starters',            g.seed_starters,
      'final_score_us',           g.final_score_us,
      'final_score_opp',          g.final_score_opp
    ),
    -- player_id IS DROPPED, and that is not tidiness. It points at a row in
    -- the demo tenant's `players` table; carried into another school's game
    -- it becomes a foreign key into a squad they do not own, and view.html's
    -- click-through-to-player would walk straight across the tenant
    -- boundary. The recorded name is what a roster snapshot is for.
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
-- APPLY. Gives one tenant the sample game, if it does not already have it.
--
--   select public.apply_sample_game('<tenant uuid>');
--
-- Returns the game's id -- the existing one if it was already there, so it
-- is safe to run repeatedly.
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
  if not public.is_super_admin() then
    raise exception 'Only the platform can seed a sample game.';
  end if;

  select * into s from public.sample_game where only_row;
  if s.only_row is null then
    raise exception 'There is no sample game yet. Run capture_sample_game() once first.';
  end if;

  -- THE SCHOOL'S OWN TEAM, matched the way thirteen pages already match it.
  -- 013 creates every tenant with exactly one team carrying is_our_team;
  -- a tenant without one is broken in a way that predates this and should
  -- be said out loud rather than seeded around.
  select t.id, t.current_season_year into v_team, v_season
    from public.teams t
   where t.tenant_id = p_tenant and t.is_our_team
   order by t.created_at
   limit 1;
  if v_team is null then
    raise exception 'Tenant % has no team, so it has nothing to attach a game to.', p_tenant;
  end if;

  -- ALREADY THERE? Return it and change nothing. This is what makes the
  -- backfill re-runnable, which matters because the sample will be
  -- re-captured a few times before it reads well.
  select g.id into v_game
    from public.games g
   where g.tenant_id = p_tenant
     and g.designator = p_designator
     and g.deleted_at is null;
  if v_game is not null then
    return v_game;
  end if;

  -- THE SCHOOL'S CURRENT SEASON, not the source game's. The dashboard
  -- filters by season, so a sample stamped with the year it was captured
  -- would exist, belong to them, and be invisible behind the season picker
  -- -- the least useful possible outcome for a game whose entire job is to
  -- be seen on first login.
  v_season := coalesce(v_season, extract(year from now())::integer);
  -- Month and day from the sample, year from their season, so it reads as a
  -- date inside the season they are looking at. No leap-day case to handle:
  -- football runs August to December.
  v_date := case
              when (s.shell->>'game_date') is null then null
              else make_date(v_season,
                             extract(month from (s.shell->>'game_date')::date)::integer,
                             extract(day   from (s.shell->>'game_date')::date)::integer)
            end;

  -- ALWAYS INSERTED AS in_progress, WHATEVER THE SOURCE WAS, and finalised
  -- at the end only if the source was final.
  -- -----------------------------------------------------------------------
  -- plays_immutable_when_final refuses every insert into a game whose status
  -- is 'final' -- and unlike the suspension guard in 014 it has no
  -- super-admin exemption, so it applies to the platform too. Creating this
  -- game final and then filling it fails on the very first play.
  --
  -- Writing in_progress unconditionally rather than branching keeps one path
  -- through the inserts: an in-progress sample simply never reaches the
  -- update at the foot of this function and is already in the state it
  -- should be in.
  insert into public.games (
    tenant_id, team_id, designator, season_year, game_date,
    home_team_name, away_team_name, our_team_is_home,
    quarter_length_seconds, opponent_logo_url,
    opponent_primary_color, opponent_secondary_color,
    seed_starters, guided_state, status, game_phase,
    -- THE MARKER. Set here and nowhere else: nothing in the app writes this
    -- column, so a true value always means this row came from a seed.
    is_sample,
    -- PRESEASON, Andy's call 31 Aug 2026. Every season-wide aggregate
    -- already excludes preseason games and the dashboard already draws a
    -- PRESEASON badge, so the sample is visibly marked and structurally out
    -- of their real season totals with no new code and no new column. Their
    -- season report stays empty and honest until they play a real game.
    --
    -- STILL SET EVEN WHEN THE SAMPLE IS UNFINISHED, where it looks
    -- redundant: season_report, view's Season Stats tile and player_report
    -- every one of them filter on status = 'final', so an in-progress game
    -- is already excluded without this. The flag is what covers the case
    -- that follows -- a school playing with the sample, entering a few
    -- snaps and pressing Finish. The moment they do, status stops
    -- protecting them and this is the only thing keeping an invented game
    -- out of their real season.
    is_preseason,
    -- Never on air, never public. A sample arriving live in front of an
    -- audience, or reachable on a share link, are both worse than no sample.
    is_broadcast, is_public
  )
  values (
    p_tenant, v_team, p_designator, v_season, v_date,
    s.shell->>'home_team_name', s.shell->>'away_team_name',
    (s.shell->>'our_team_is_home')::boolean,
    coalesce((s.shell->>'quarter_length_seconds')::integer, 720),
    s.shell->>'opponent_logo_url',
    s.shell->>'opponent_primary_color', s.shell->>'opponent_secondary_color',
    s.shell->'seed_starters',
    -- NOT the source's guided_state. A stored guided step would try to
    -- resume mid-kickoff on a game that is already over.
    '{}'::jsonb,
    'in_progress', s.shell->>'game_phase',
    true,
    true, false, false
  )
  returning id into v_game;

  -- tenant_id ON THE ROWS, NOT ONLY ON THE GAME.
  -- -----------------------------------------------------------------------
  -- plays and game_rosters each carry their own tenant_id and RLS scopes
  -- them by it. Copied with the DEMO tenant's id these rows are invisible to
  -- the school that owns the game: the platform console shows the game
  -- correctly, the dashboard row appears, and the game opens completely
  -- empty. It fails silently and only on their screen, which is why it is
  -- spelled out here rather than left to the reader.
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

  -- FINISHED ONLY IF THE SOURCE WAS. An in-progress sample stops here and
  -- stays in_progress, which is the whole point of carrying status.
  --
  -- When it does run, the scores are written in the same statement as the
  -- status, the way setGameStatus() does it in the app, so the row is never
  -- briefly final-with-no-score -- the one state the dashboard's W/L badge
  -- cannot render.
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

-- ---------------------------------------------------------------------------
-- THE BACKFILL. Every demo tenant that does not already have it.
--
--   select public.seed_sample_game_into_demos();
--
-- Returns how many schools were seeded -- not how many were considered, so
-- running it twice returns 0 the second time and that is the correct answer.
-- ---------------------------------------------------------------------------
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
       -- NOT THE TENANT THE SAMPLE CAME FROM. It already has the original,
       -- hand-scored, under its own designator; giving it a SAMPLE copy of
       -- its own game is clutter in the one dashboard that most needs to
       -- stay legible, and makes "which one am I looking at" a question.
       and id is distinct from (
             select g.tenant_id from public.games g
               join public.sample_game sg on sg.captured_from = g.id
              where sg.only_row)
     order by created_at
  loop
    -- DELETED COUNTS AS HAVING HAD IT. A school that threw the sample away
    -- did so on purpose, and a backfill that hands it back the next time it
    -- runs is the app overruling them -- quietly, and repeatedly, since this
    -- will be re-run every time the sample is re-captured.
    --
    -- This is why the check here is deliberately NOT the one inside
    -- apply_sample_game: that one looks only at live games, because calling
    -- apply on a single named tenant is an explicit instruction to give that
    -- school the sample, deleted history or not. The sweep is not explicit
    -- about any one school, so it errs the other way.
    select g.id into v_game
      from public.games g
     where g.tenant_id = t.id and g.designator = p_designator;
    if v_game is null then
      -- ONE BAD TENANT MUST NOT STOP THE OTHER FIVE.
      -- -------------------------------------------------------------------
      -- apply_sample_game raises rather than shrugs -- a tenant with no team
      -- is broken and saying so is right when somebody asked for that ONE
      -- school. But this is a sweep, and an exception here propagates out of
      -- the loop and rolls back every school already seeded in the
      -- transaction. Found in testing 31 Aug 2026: a single teamless tenant
      -- meant the backfill did nothing at all and reported an error about a
      -- school nobody was asking about.
      --
      -- So the sweep catches, counts and NAMES the ones it could not do. The
      -- notice reaches the SQL editor's output, so a skip is visible rather
      -- than merely absent from the total.
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

comment on function public.capture_sample_game(uuid, text) is
  'Snapshots a finished game from a DEMO tenant as the sample every school '
  'is given. Refuses a non-demo source: there is no scrub, so the source '
  'having no real names in it is the entire safety model.';
comment on function public.apply_sample_game(uuid, text) is
  'Gives one tenant the sample game if it does not already have it. Idempotent '
  '- returns the existing game id when there is one.';
comment on function public.seed_sample_game_into_demos(text) is
  'Backfill: applies the sample game to every demo tenant that has never had '
  'it - skipping the tenant it was captured from, and any school that deleted '
  'its own copy. Returns the number newly seeded.';

revoke all on function public.capture_sample_game(uuid, text)       from public, anon;
revoke all on function public.apply_sample_game(uuid, text)         from public, anon;
revoke all on function public.seed_sample_game_into_demos(text)     from public, anon;
grant execute on function public.capture_sample_game(uuid, text)    to authenticated;
grant execute on function public.apply_sample_game(uuid, text)      to authenticated;
grant execute on function public.seed_sample_game_into_demos(text)  to authenticated;

insert into public.schema_migrations (version, name)
values (28, '028_sample_game') on conflict (version) do nothing;
