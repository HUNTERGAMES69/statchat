-- 036_broadcast_starters.sql
-- ============================================================================
-- THE FULL STARTING LINEUP, FOR GRAPHICS ONLY.
--
-- Three overlays -- offensive, defensive and special-teams starters -- need
-- eleven, eleven and four named players. Nothing in the app held that: the
-- roster says who is on the team, seed_starters says who six of them are,
-- and neither says who lines up where on a Friday.
--
-- ============================================================================
-- WHY NOT JUST WIDEN seed_starters
--
-- Because seed_starters is not a lineup. It is what the OFFENSE PICKER opens
-- with during play entry -- the six names a scorer sees before anyone has
-- touched the ball -- and it grows as the game goes on. Putting eleven
-- linemen and a defence into it would change what a scorer meets on every
-- play of every game, to serve a graphic.
--
-- Andy's words were "broadcast purposes only", and a separate column is the
-- only way to keep that promise structurally rather than by convention. Play
-- entry reads seed_starters and never reads this.
--
-- ============================================================================
-- THE SHAPE IS seed_starters', DELIBERATELY
--
--   { "QB": { "num": "7", "name": "Devin Whitfield" }, ... }
--
-- `name` is present only where it was needed -- two players wearing one
-- number is why seed_starters moved to this shape on 13 Aug, and the same
-- resolver in create_game.html fills both. Readers accept a bare string too,
-- exactly as seedNum()/seedName() already do, so one reader handles both.
--
-- POSITIONS ARE LABELS ON ROWS, NOT KEYS. A slot's label is chosen per game
-- from a dropdown, so a Wing-T team stores FB where a spread team stores SB,
-- and neither needs a schema change.
--
--   { "offense": [ { "pos": "QB", "num": "7", "name": "Devin Whitfield" },
--                  { "pos": "RB", "num": "22" } ],
--     "defense": [ { "pos": "DE", "num": "91" }, { "pos": "DT", "num": "55" },
--                  { "pos": "DT", "num": "77" }, { "pos": "DE", "num": "44" } ],
--     "special": [ { "pos": "PK/P", "num": "12", "name": "Jake Smith" } ] }
--
-- ============================================================================
-- WHY AN ARRAY AND NOT AN OBJECT  (corrected 1 Sep 2026)
--
-- This column shipped keyed by position label -- { "DE": {...} } -- and that
-- is the wrong model for a lineup. Position labels are NOT unique on a
-- football field. The default defensive set is
--
--     DE  DT  DT  DE  WLB  MLB  SLB  CB  CB  FS  SS
--
-- so DE, DT and CB each appear twice, and each one overwrote the one before
-- it. A coach who filled all eleven slots saw eleven on screen and stored
-- EIGHT -- silently, with the overlay then showing an eight-man defence.
-- Offense did the same with its three WR slots, keeping one receiver.
--
-- A lineup is ordered and repeats positions by nature, so the array is what
-- this always should have been. Row order is the order the card reads down.
-- No schema change was needed: jsonb holds either shape, and all three
-- readers (create_game.html, broadcast_starters.html, api/feed.js) still
-- accept the old object form so anything stored before the correction
-- renders unchanged.
--
-- `unit` says which card a list belongs on. A special-teams player filling
-- more than one job is ONE row with a combined label -- "PK/P" -- matched on
-- his NUMBER, since that is what makes them the same person.
--
-- ============================================================================
-- NO CONSTRAINT ON THE CONTENTS, AND THAT IS NOT AN OVERSIGHT
--
-- The rules this data must obey -- a number starts once per unit, eleven
-- slots, a two-way starter appearing on both cards -- are enforced where the
-- person is, in create_game.html, with the roster in hand to say WHO a number
-- is. A check constraint here could only re-state the shape, would reject a
-- row at save time with no way to say which slot was wrong, and would be one
-- more place to update when a formation gains a position. jsonb with a
-- comment is the honest choice.
-- ============================================================================

begin;

-- THE ADD COMES FIRST. A pre-flight SELECT naming broadcast_starters cannot
-- run before the column exists -- the first cut of this file did exactly
-- that and aborted the transaction on its own opening statement. `add column
-- if not exists` is the idempotent part; the report below it is what says
-- whether anything was already there.
alter table public.games
  add column if not exists broadcast_starters jsonb;

comment on column public.games.broadcast_starters is
  'Full starting lineup for the three starter overlays. BROADCAST ONLY - play '
  'entry reads seed_starters and never this. Shape: {unit: {POSITION: {num, name}}} '
  'where unit is offense|defense|special; name is present only where a shared '
  'jersey number needed it, same as seed_starters. NULL means the coach did not '
  'fill it in, which is the normal case.';

-- NOTHING IS BACKFILLED. There is no source to backfill it from: seed_starters
-- holds six skill players and this wants twenty-six slots with positions the
-- coach picks. A guess here would put invented lineups on air.

-- WHAT IS THERE NOW. On a first run every game reads null, which is correct:
-- nothing is backfilled, because there is no source to backfill from.
select
  count(*) filter (where broadcast_starters is not null) as games_with_a_lineup,
  count(*)                                               as games_total
from public.games;

insert into public.schema_migrations (version, name)
values (36, '036_broadcast_starters') on conflict (version) do nothing;

commit;
