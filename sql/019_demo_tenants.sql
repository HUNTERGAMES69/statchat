-- 019_demo_tenants.sql
-- ============================================================================
-- A DEMO TENANT WITH A REAL GAME IN IT, THAT CAN BE RESET.
--
-- Red Stick is a demo school -- branding and rosters, no games. Showing the
-- product needs a game with plays in it, and rebuilding that by hand before
-- every demo is the thing this exists to stop.
--
-- Three pieces:
--   1. tenants.is_demo          marks a school as a demo. Nothing here will
--                               touch a tenant without it.
--   2. seed_demo_game()         copies a source game's plays into a demo
--                               game, remapped onto the demo roster, and
--                               saves that state as the baseline.
--   3. reset_demo_game()        throws away everything since and restores
--                               the baseline exactly.
--
-- ============================================================================
-- WHY is_demo IS A HARD GATE AND NOT A CONFIRMATION DIALOG
--
-- reset_demo_game() is a bulk DELETE of a game's plays. Pointed at the wrong
-- game it destroys a school's season, and a season cannot be re-entered from
-- memory. A dialog protects against a mis-tap; it does not protect against a
-- wrong id in a fetch call, a copied-and-pasted uuid, or a future button
-- wired to the wrong row.
--
-- Both functions raise unless the target game belongs to a tenant with
-- is_demo = true. A demo feature should be structurally incapable of
-- touching real data, not merely discouraged from it.
--
-- ============================================================================
-- WHY THE BASELINE IS A SNAPSHOT, NOT A RE-COPY
--
-- The obvious reset is "copy from the source game again". That silently ties
-- the demo to a real game forever: change that game, or delete it, and the
-- demo changes or breaks with it, at the worst possible moment.
--
-- seed_demo_game() therefore stores the seeded plays and rosters as JSONB in
-- demo_baselines. Reset restores from that. The source game is read once and
-- never again.
--
-- It also handles the case a flag would miss. Marking seeded rows and
-- deleting the unmarked ones fails as soon as somebody EDITS a seeded play
-- during a demo -- the row is still marked, so reset leaves the edit in
-- place. Deleting everything and re-inserting from the snapshot cannot.
--
-- ============================================================================
-- NAMES: WHY ALMOST NOTHING NEEDS SCRUBBING
--
-- plays.roles stores JERSEY NUMBERS, not names, and every stat table
-- resolves names from game_rosters at render time. So writing a demo roster
-- for the game changes every box score, leader board and report at once.
--
-- Two things still carry real names and are handled explicitly:
--   * plays.text -- the human-readable description, rendered at entry time.
--     Rewritten below, name by name.
--   * team_side 'teamB' rosters -- real players from a real opposing school.
--     Replaced wholesale with generated names.
--
-- The mapping is BY POSITION IN THE ROSTER, not by jersey number, because a
-- demo roster will not have the same numbers as the source. Every play
-- therefore resolves to a real demo player, and the numbers written into
-- plays.text agree with the numbers the tables show.
-- ============================================================================

alter table public.tenants
  add column if not exists is_demo boolean not null default false;

comment on column public.tenants.is_demo is
  'A demo school. seed_demo_game() and reset_demo_game() refuse to run '
  'against any game whose tenant does not carry this flag -- reset is a bulk '
  'delete of plays and must be incapable of reaching a real season.';

create table if not exists public.demo_baselines (
  game_id     uuid primary key references public.games(id) on delete cascade,
  plays       jsonb not null,
  rosters     jsonb not null,
  source_note text,
  created_at  timestamptz not null default now()
);

comment on table public.demo_baselines is
  'The state a demo game returns to on reset. One row per demo game, so a '
  'tenant can hold several demos and each resets independently.';

alter table public.demo_baselines enable row level security;

-- Only the platform reads or writes these, and only through the SECURITY
-- DEFINER functions below. No policy is granted to anyone else, so the table
-- is unreachable from the browser.
revoke all on public.demo_baselines from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The guard both functions share.
-- ---------------------------------------------------------------------------
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

  -- THE LINE THAT MATTERS. Everything else here is convenience.
  if not v_is_demo then
    raise exception 'That game belongs to a real school. Seeding and resetting '
                    'are only possible on a tenant marked is_demo.';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- SEED. Reads a source game once, writes the demo game, saves the baseline.
--
-- p_through_quarter defaults to 2 so the demo opens AT HALFTIME with a real
-- first half behind it -- which is the state worth demonstrating, because it
-- shows accumulated stats rather than an empty sheet.
-- ---------------------------------------------------------------------------
create or replace function public.seed_demo_game(
  p_demo_game   uuid,
  p_source_game uuid,
  p_through_quarter integer default 2
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_count integer;
  v_tenant uuid;
begin
  perform public.assert_demo_game(p_demo_game);

  if p_demo_game = p_source_game then
    raise exception 'The source and the demo game cannot be the same game.';
  end if;

  select tenant_id into v_tenant from public.games where id = p_demo_game;

  -- Start clean. Seeding twice must not stack two halves on top of each other.
  delete from public.plays        where game_id = p_demo_game;
  delete from public.game_rosters where game_id = p_demo_game;

  -- OUR SQUAD: the demo tenant's own roster, so every player in the demo is
  -- somebody the viewer can click into and find.
  -- The roster lives on `players`, keyed by TEAM not tenant, with columns
  -- `name` and `default_jersey_number` -- not the roster_players/player_name
  -- shape a first draft of this assumed. Scoped by season so a demo seeded
  -- next year does not pull last year's squad.
  insert into public.game_rosters (game_id, team_side, jersey_number, player_name, unit)
  select p_demo_game, 'teamA',
         coalesce(pl.default_jersey_number, '0'), pl.name,
         coalesce(pl.unit_override, 'offense')
    from public.players pl
    join public.teams t on t.id = pl.team_id
   where t.tenant_id = v_tenant
     and (pl.season_year is null
          or pl.season_year = (select season_year from public.games where id = p_demo_game));

  -- THE OPPOSING SQUAD IS INVENTED. The source game's teamB rows are real
  -- players from a real school. Numbers are taken from the source so the
  -- plays still resolve; only the names are replaced.
  insert into public.game_rosters (game_id, team_side, jersey_number, player_name, unit)
  select p_demo_game, 'teamB', gr.jersey_number,
         (array['A. Fontenot','B. Guidry','C. Hebert','D. Landry','E. Broussard',
                'F. Thibodeaux','G. Comeaux','H. Melancon','I. Savoie','J. Richard',
                'K. Dupre','L. Arceneaux','M. Trahan','N. Bergeron','O. Doucet',
                'P. Leblanc','Q. Chauvin','R. Prejean','S. Naquin','T. Boudreaux'
               ])[1 + (abs(hashtext(gr.jersey_number)) % 20)],
         gr.unit
    from public.game_rosters gr
   where gr.game_id = p_source_game
     and gr.team_side = 'teamB';

  -- THE PLAYS. roles and effect copy verbatim: they hold jersey numbers and
  -- yardage, never names.
  insert into public.plays
    (game_id, quarter, sequence_number, team_side, text, effect, roles,
     unresolved, is_divider, is_override)
  select p_demo_game, p.quarter, p.sequence_number, p.team_side,
         p.text, p.effect, p.roles, p.unresolved, p.is_divider, p.is_override
    from public.plays p
   where p.game_id = p_source_game
     and p.quarter <= p_through_quarter;

  get diagnostics v_count = row_count;

  -- plays.text was rendered with the SOURCE roster's names at entry time, so
  -- it is the one place a real name survives the copy. Rewritten against the
  -- demo roster, matched by position in each squad -- the numbers will not
  -- line up between two different schools.
  perform public.rewrite_demo_play_text(p_demo_game, p_source_game);

  -- And the baseline, saved from what is now in the tables rather than from
  -- the source -- so a reset restores exactly what the seed produced,
  -- rewritten text and all.
  insert into public.demo_baselines (game_id, plays, rosters, source_note)
  values (
    p_demo_game,
    (select coalesce(jsonb_agg(to_jsonb(p) - 'id' - 'game_id' - 'created_at' - 'created_by'), '[]'::jsonb)
       from public.plays p where p.game_id = p_demo_game),
    (select coalesce(jsonb_agg(to_jsonb(r) - 'id' - 'game_id'), '[]'::jsonb)
       from public.game_rosters r where r.game_id = p_demo_game),
    'seeded from ' || p_source_game::text || ' through Q' || p_through_quarter
  )
  on conflict (game_id) do update
     set plays = excluded.plays, rosters = excluded.rosters,
         source_note = excluded.source_note, created_at = now();

  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The name rewrite, kept separate because it is the fiddly part and the part
-- most likely to need adjusting.
-- ---------------------------------------------------------------------------
create or replace function public.rewrite_demo_play_text(
  p_demo_game uuid, p_source_game uuid
) returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record;
begin
  -- Longest names first. Replacing "Smith" before "Smith Jr." would leave
  -- " Jr." dangling on the end of a substituted name.
  for r in
    select src.player_name as old_name, dst.player_name as new_name
      from (select player_name, team_side,
                   row_number() over (partition by team_side order by jersey_number) rn
              from public.game_rosters where game_id = p_source_game) src
      join (select player_name, team_side,
                   row_number() over (partition by team_side order by jersey_number) rn
              from public.game_rosters where game_id = p_demo_game) dst
        on dst.team_side = src.team_side and dst.rn = src.rn
     where src.player_name <> dst.player_name
     order by length(src.player_name) desc
  loop
    update public.plays
       set text = replace(text, r.old_name, r.new_name)
     where game_id = p_demo_game
       and text like '%' || r.old_name || '%';
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------------
-- RESET. Everything since the seed is discarded.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo_game(p_demo_game uuid)
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_plays jsonb;
  v_rosters jsonb;
  v_count integer;
begin
  perform public.assert_demo_game(p_demo_game);

  select plays, rosters into v_plays, v_rosters
    from public.demo_baselines where game_id = p_demo_game;

  if v_plays is null then
    raise exception 'That demo game has no baseline yet -- seed it first.';
  end if;

  delete from public.plays        where game_id = p_demo_game;
  delete from public.game_rosters where game_id = p_demo_game;

  insert into public.game_rosters (game_id, team_side, jersey_number, player_name, unit)
  select p_demo_game, x.team_side, x.jersey_number, x.player_name, x.unit
    from jsonb_to_recordset(v_rosters)
      as x(team_side text, jersey_number text, player_name text, unit text);

  insert into public.plays
    (game_id, quarter, sequence_number, team_side, text, effect, roles,
     unresolved, is_divider, is_override)
  select p_demo_game, x.quarter, x.sequence_number, x.team_side, x.text,
         x.effect, x.roles, x.unresolved, x.is_divider, x.is_override
    from jsonb_to_recordset(v_plays)
      as x(quarter integer, sequence_number numeric, team_side text, text text,
           effect jsonb, roles jsonb, unresolved boolean, is_divider boolean,
           is_override boolean);

  get diagnostics v_count = row_count;

  -- The game itself goes back to where the seed left it. A demo taken ON AIR
  -- and finished must not come back still marked final -- and is_broadcast is
  -- deliberately NOT reset, because a demo game is allowed full broadcast
  -- functionality and clearing it mid-demo would pull the overlay.
  update public.games
     set status = 'in_progress', game_phase = 'inProgress', guided_state = '{}'::jsonb
   where id = p_demo_game;

  return v_count;
end;
$function$;

revoke all on function public.assert_demo_game(uuid) from public, anon;
revoke all on function public.seed_demo_game(uuid, uuid, integer) from public, anon;
revoke all on function public.rewrite_demo_play_text(uuid, uuid) from public, anon;
revoke all on function public.reset_demo_game(uuid) from public, anon;
grant execute on function public.seed_demo_game(uuid, uuid, integer) to authenticated;
grant execute on function public.reset_demo_game(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values (19, '019_demo_tenants') on conflict (version) do nothing;
