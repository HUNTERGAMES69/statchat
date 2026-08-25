-- 021_static_demo_seed.sql
-- ============================================================================
-- ONE STATIC SEED, ONE BUTTON.
--
-- 019 made seeding a per-game operation that asked which source, which
-- target and how far -- three decisions, every time, for something that has
-- exactly one right answer. Resetting a demo should be one click and no
-- questions.
--
-- So:
--   demo_seed              a SINGLE row holding the demo's first half.
--                          Captured once, by hand, and then left alone.
--   capture_demo_seed()    the one-time script. Run it in the SQL editor
--                          when the demo is first built, or if you ever want
--                          to rebuild it from a different game.
--   reset_demo()           no arguments. Clears the demo game and re-applies
--                          the seed. This is what the button calls.
--
-- ============================================================================
-- THE SEED CONTAINS NO REAL NAMES, BECAUSE THEY ARE SCRUBBED AT CAPTURE
--
-- 019 copied plays into the demo game and rewrote the names there, which
-- meant every reset re-did that work and the correctness of it depended on
-- the source game still existing.
--
-- Capturing once and scrubbing at that moment is better in three ways: the
-- stored seed holds no real name at all, so the database itself is clean;
-- reset is a straight restore with no string work; and the source game can
-- be deleted afterwards without touching the demo.
--
-- ============================================================================
-- WHY THE TARGET GAME IS RECORDED IN THE SEED
--
-- reset_demo() takes no arguments -- that is the whole point -- so it has to
-- know which game to rebuild. Storing the target beside the plays means the
-- capture step decides it once, and the button can never be pointed at
-- anything else. It is also checked against is_demo on every reset, so
-- moving the demo to a real tenant does not quietly make the button
-- dangerous.
-- ============================================================================

create table if not exists public.demo_seed (
  -- SINGLETON. The check constraint is what makes it one: there is one demo
  -- environment, and a second row would introduce the question of which.
  only_row       boolean primary key default true check (only_row),
  target_game_id uuid not null references public.games(id) on delete cascade,
  plays          jsonb not null,
  rosters        jsonb not null,
  captured_from  uuid,
  captured_at    timestamptz not null default now(),
  note           text
);

comment on table public.demo_seed is
  'The one static demo dataset. Captured once by capture_demo_seed() with all '
  'real names already replaced, then restored by reset_demo() as often as '
  'needed. Holds no real player name.';

alter table public.demo_seed enable row level security;
revoke all on public.demo_seed from anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE ONE-TIME CAPTURE. Run by hand:
--
--   select capture_demo_seed(
--     '<source game uuid>',      -- a real, finalised game to copy
--     '<demo game uuid>',        -- the game in the demo tenant to fill
--     2);                        -- through Q2, so the demo opens at halftime
--
-- Running it again replaces the seed. That is the intended way to rebuild
-- the demo from a different game later.
-- ---------------------------------------------------------------------------
create or replace function public.capture_demo_seed(
  p_source_game uuid,
  p_demo_game   uuid,
  p_through_quarter integer default 2
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_count integer;
  v_tenant uuid;
begin
  perform public.assert_demo_game(p_demo_game);

  if p_source_game = p_demo_game then
    raise exception 'The source and the demo game cannot be the same game.';
  end if;

  select tenant_id into v_tenant from public.games where id = p_demo_game;

  -- Build the demo game once, exactly as a reset will later restore it.
  delete from public.plays        where game_id = p_demo_game;
  delete from public.game_rosters where game_id = p_demo_game;

  -- Our squad: the demo tenant's own players, so every name in the demo is
  -- somebody a viewer can click into and find.
  insert into public.game_rosters (game_id, team_side, jersey_number, player_name, unit)
  select p_demo_game, 'teamA',
         coalesce(pl.default_jersey_number, '0'), pl.name,
         coalesce(pl.unit_override, 'offense')
    from public.players pl
    join public.teams t on t.id = pl.team_id
   where t.tenant_id = v_tenant;

  -- The opposing squad is INVENTED. The source game's teamB rows are real
  -- players from a real school; only their jersey numbers are kept, so the
  -- plays still resolve.
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

  -- The plays. roles and effect copy verbatim: jersey numbers and yardage,
  -- never names.
  insert into public.plays
    (game_id, quarter, sequence_number, team_side, text, effect, roles,
     unresolved, is_divider, is_override)
  select p_demo_game, p.quarter, p.sequence_number, p.team_side,
         p.text, p.effect, p.roles, p.unresolved, p.is_divider, p.is_override
    from public.plays p
   where p.game_id = p_source_game
     and p.quarter <= p_through_quarter;

  get diagnostics v_count = row_count;

  -- plays.text was rendered with the SOURCE roster's names, so it is the one
  -- place a real name survives the copy. Scrubbed HERE, before the snapshot
  -- is taken, so no real name is ever stored in demo_seed.
  perform public.rewrite_demo_play_text(p_demo_game, p_source_game);

  insert into public.demo_seed (only_row, target_game_id, plays, rosters, captured_from, note)
  values (
    true, p_demo_game,
    (select coalesce(jsonb_agg(to_jsonb(p) - 'id' - 'game_id' - 'created_at' - 'created_by'), '[]'::jsonb)
       from public.plays p where p.game_id = p_demo_game),
    (select coalesce(jsonb_agg(to_jsonb(r) - 'id' - 'game_id'), '[]'::jsonb)
       from public.game_rosters r where r.game_id = p_demo_game),
    p_source_game,
    'captured through Q' || p_through_quarter
  )
  on conflict (only_row) do update
     set target_game_id = excluded.target_game_id,
         plays = excluded.plays, rosters = excluded.rosters,
         captured_from = excluded.captured_from, note = excluded.note,
         captured_at = now();

  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- THE BUTTON. No arguments, no questions.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo()
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_game uuid;
  v_plays jsonb;
  v_rosters jsonb;
  v_count integer;
begin
  select target_game_id, plays, rosters
    into v_game, v_plays, v_rosters
    from public.demo_seed where only_row;

  if v_game is null then
    raise exception 'There is no demo seed yet. Run capture_demo_seed() once first.';
  end if;

  -- CHECKED EVERY TIME, not just at capture. If the demo game were ever moved
  -- to a real tenant, this button would otherwise start wiping a real season.
  perform public.assert_demo_game(v_game);

  delete from public.plays        where game_id = v_game;
  delete from public.game_rosters where game_id = v_game;

  insert into public.game_rosters (game_id, team_side, jersey_number, player_name, unit)
  select v_game, x.team_side, x.jersey_number, x.player_name, x.unit
    from jsonb_to_recordset(v_rosters)
      as x(team_side text, jersey_number text, player_name text, unit text);

  insert into public.plays
    (game_id, quarter, sequence_number, team_side, text, effect, roles,
     unresolved, is_divider, is_override)
  select v_game, x.quarter, x.sequence_number, x.team_side, x.text,
         x.effect, x.roles, x.unresolved, x.is_divider, x.is_override
    from jsonb_to_recordset(v_plays)
      as x(quarter integer, sequence_number numeric, team_side text, text text,
           effect jsonb, roles jsonb, unresolved boolean, is_divider boolean,
           is_override boolean);

  get diagnostics v_count = row_count;

  -- Back to mid-game. is_broadcast is deliberately left alone: a demo game
  -- has full functionality and clearing it would pull the overlay off air
  -- mid-demonstration.
  update public.games
     set status = 'in_progress', game_phase = 'inProgress', guided_state = '{}'::jsonb
   where id = v_game;

  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 019's per-game entry points are superseded. Dropped rather than left in
-- place: two ways to reset a demo is one too many, and the old one asks
-- questions this one has already answered.
-- rewrite_demo_play_text and assert_demo_game are KEPT -- both are used above.
-- ---------------------------------------------------------------------------
drop function if exists public.seed_demo_game(uuid, uuid, integer);
drop function if exists public.reset_demo_game(uuid);
drop function if exists public.seeded_demo_games(uuid);
drop table if exists public.demo_baselines;

revoke all on function public.capture_demo_seed(uuid, uuid, integer) from public, anon;
revoke all on function public.reset_demo() from public, anon;
grant execute on function public.capture_demo_seed(uuid, uuid, integer) to authenticated;
grant execute on function public.reset_demo() to authenticated;

insert into public.schema_migrations (version, name)
values (21, '021_static_demo_seed') on conflict (version) do nothing;
