-- Public recap sharing
-- =====================================================================
-- Lets a FINISHED game's recap be read without an account, one game at a
-- time, controlled by a switch on the recap page itself.
--
-- READ THIS BEFORE RUNNING IT. Every statement below widens what an
-- anonymous visitor can see. The scoping is the whole point.
--
-- Run the checks in section 0 first. If RLS turns out to be disabled on
-- any of these tables, that is a live problem TODAY -- the anon key is in
-- the page source by design, and RLS is the only thing standing between
-- it and the table.


-- 0. CHECK WHAT IS TRUE NOW ------------------------------------------
-- Every one of these must come back with rowsecurity = true. If any is
-- false, stop and fix that first: no policy below matters on a table
-- that is not enforcing them.

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('games', 'plays', 'game_rosters', 'teams', 'profiles')
order by tablename;

-- And read the columns on games before granting a whole row. select('*')
-- means anon can query ANY column here, not only the ones the recap
-- renders. If anything on this list should not be public, the recap
-- should be changed to select named columns first.

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'games'
order by ordinal_position;


-- 1. THE SWITCH -------------------------------------------------------
-- Defaults to false, so every game that already exists stays private and
-- nothing becomes visible by running this file.

alter table public.games
  add column if not exists is_public boolean not null default false;


-- 1a. THE SHARE TOKEN -------------------------------------------------
-- The url a coach sends carries this, not the game's primary key.
--
-- It is not a password: RLS still decides whether the data may be read,
-- and the game id is visible in the served page anyway. What the token
-- buys is REVOCATION. Clearing it kills that specific link for good, and
-- sharing again mints a new one -- so a link somebody kept does not come
-- back to life the next time the game is shared. Toggling is_public
-- alone would revive it.
--
-- Nullable, and null means "not shared". No default: tokens are minted
-- by the share control when sharing is switched on.

alter table public.games
  add column if not exists share_token text;

-- Unique among the tokens that exist. The partial index is deliberate --
-- every unshared game has a null token, and nulls must not collide.
create unique index if not exists games_share_token_key
  on public.games (share_token)
  where share_token is not null;


-- 1b. COLUMN GRANTS ---------------------------------------------------
-- RLS is ROW-level. A policy alone hands over the whole row, so anon
-- could query created_by and broadcast_set_by -- account ids a public
-- scoreboard has no use for -- along with guided_state and seed_starters,
-- which are the app's own working state.
--
-- These grants cut it to the fourteen columns the recap renders.
-- `authenticated` is untouched: the app's other pages keep using
-- select('*') exactly as before.
--
-- recap.html asks for these fourteen by name. If this list changes, that
-- query changes with it.
--
-- share_token is deliberately NOT granted to anon. Nothing anonymous
-- needs it -- api/share.js looks the game up with the service key, and a
-- visitor already holds the token, it is in their url. Granting it would
-- let anyone read every live share token in one query.

revoke select on public.games from anon;

grant select (id, designator, game_date, home_team_name, away_team_name,
              our_team_is_home, quarter_length_seconds, status,
              opponent_logo_url, opponent_primary_color,
              opponent_secondary_color, final_score_us, final_score_opp,
              is_public)
  on public.games to anon;


-- 2. READ POLICIES ----------------------------------------------------
-- The condition is always BOTH final AND is_public, never is_public
-- alone. That pairing is what stops a shared game becoming visible while
-- it is unlocked for corrections: unlocking moves it out of 'final' and
-- the public read stops matching until it is finalized again.

drop policy if exists "anon reads shared games" on public.games;
create policy "anon reads shared games"
  on public.games for select
  to anon
  using (status = 'final' and is_public = true);

drop policy if exists "anon reads shared game plays" on public.plays;
create policy "anon reads shared game plays"
  on public.plays for select
  to anon
  using (exists (
    select 1 from public.games g
    where g.id = plays.game_id
      and g.status = 'final'
      and g.is_public = true
  ));

drop policy if exists "anon reads shared game rosters" on public.game_rosters;
create policy "anon reads shared game rosters"
  on public.game_rosters for select
  to anon
  using (exists (
    select 1 from public.games g
    where g.id = game_rosters.game_id
      and g.status = 'final'
      and g.is_public = true
  ));

-- Our own branding only: the recap needs colours and a logo to render.
-- Restricted to the row, not the table, and the recap only ever asks for
-- three columns of it.

drop policy if exists "anon reads our branding" on public.teams;
create policy "anon reads our branding"
  on public.teams for select
  to anon
  using (is_our_team = true);


-- 3. WHO CAN FLIP THE SWITCH ------------------------------------------
-- Admins only. Without this, any signed-in account -- including a 'view'
-- account, which exists precisely so somebody can look without changing
-- anything -- could publish a game.
--
-- This assumes an existing UPDATE policy on games for authenticated
-- users. If yours is broader than the admin check below, tighten it:
-- a policy that allows updating any column allows updating this one.

drop policy if exists "admins set game visibility" on public.games;
create policy "admins set game visibility"
  on public.games for update
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));


-- 4. WHAT THIS DOES NOT DO --------------------------------------------
-- No INSERT, UPDATE or DELETE is granted to anon anywhere above, and
-- nothing here touches profiles.
--
-- Realtime rides on the same policies, so an anon subscription to plays
-- would be possible for a shared game. That game is final, so its plays
-- do not change -- but it is worth knowing the channel exists.
--
-- Turning sharing off stops FUTURE reads. It cannot retract anything
-- already fetched, cached, screenshotted or indexed.


-- 5. VERIFY -----------------------------------------------------------
-- Expect 14. If this drops, anon has lost a column the recap asks for by
-- name and the page will fail for signed-out visitors.

select count(*) as anon_columns_on_games
from information_schema.column_privileges
where grantee = 'anon' and table_schema = 'public'
  and table_name = 'games' and privilege_type = 'SELECT';

-- Expect: shared_games = 0 immediately after running this file, because
-- the column defaults to false and nothing has been shared yet.

select count(*) filter (where is_public) as shared_games,
       count(*) filter (where is_public and status <> 'final') as shared_but_not_final
from public.games;

-- shared_but_not_final should ALWAYS be 0 in practice. It is not an
-- error if it is not -- the policy already refuses those -- but it means
-- a game was unlocked while shared, and it will go public again the
-- moment it is finalized. Worth knowing rather than discovering.
