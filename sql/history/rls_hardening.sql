-- ============================================================
-- StatChat — RLS role enforcement
-- ============================================================
-- APPLIED 12 August 2026. This file is the RECORD OF WHAT WAS RUN,
-- rewritten afterwards to match reality. The first draft was wrong in
-- two ways that are worth knowing about:
--
--   1. IT WOULD HAVE DONE NOTHING. The draft dropped policies named
--      `plays_delete`, `games_insert` and so on. The real policies were
--      named `authenticated delete plays`, `authenticated insert games`.
--      The drops would have missed, the new strict policies would have
--      been added ALONGSIDE the old permissive ones, and Postgres ORs
--      permissive policies together -- so everything would still have
--      been allowed while appearing to be fixed.
--
--      Always list the real policy names before writing drops:
--          select tablename, policyname, cmd from pg_policies
--           where schemaname = 'public' order by tablename, cmd;
--
--   2. IT INCLUDED AN UNNECESSARY AND DANGEROUS STEP. The draft
--      rewrote `profiles`, which was already correct -- self-read and
--      self-update only. Rewriting it was the one step that could have
--      locked the only admin out. It was skipped.
--
-- Roles: 'admin', 'game_entry', 'view'
-- ============================================================


-- ------------------------------------------------------------
-- 1. The role helper
-- ------------------------------------------------------------
-- SECURITY DEFINER is load-bearing. This reads `profiles`, and
-- `profiles` is itself protected by RLS. Without SECURITY DEFINER the
-- function's own read would be blocked by the policies that call it and
-- everything would fail closed.
--
-- The fallback is 'view' -- the LEAST privilege. If role lookup ever
-- fails, people lose access rather than gain it.
--
-- Note: called from the SQL editor this returns 'view', because the
-- editor has no logged-in user and auth.uid() is null. That is expected.
-- It returns the real role when the app calls it.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from profiles where id = auth.uid() limit 1),
    'view'
  );
$$;

grant execute on function public.current_user_role() to authenticated;


-- ------------------------------------------------------------
-- 2. plays
-- ------------------------------------------------------------
-- DELETE INCLUDES game_entry, deliberately. The UNDO button deletes the
-- play row (game.html, undoBtn handler), and so does "Delete &
-- re-enter" in correction mode. Admin-only delete would have broken
-- Undo for every scorer -- a core in-game action that would have failed
-- for the first time on a Friday night.
--
-- The real boundary is not "who may delete" but "who may enter plays at
-- all". A `view` account can do neither.

drop policy if exists "authenticated read plays"   on plays;
drop policy if exists "authenticated insert plays" on plays;
drop policy if exists "authenticated update plays" on plays;
drop policy if exists "authenticated delete plays" on plays;

create policy "plays_select" on plays for select
  to authenticated using (true);
create policy "plays_insert" on plays for insert
  to authenticated with check (public.current_user_role() in ('admin','game_entry'));
create policy "plays_update" on plays for update
  to authenticated using (public.current_user_role() in ('admin','game_entry'));
create policy "plays_delete" on plays for delete
  to authenticated using (public.current_user_role() in ('admin','game_entry'));

-- VERIFIED 12 Aug: admin enter+undo OK; game_entry enter+undo OK;
-- view INSERT refused at the API --
--   "new row violates row-level security policy for table plays".


-- ------------------------------------------------------------
-- 3. games
-- ------------------------------------------------------------
-- Only admins create or delete a game. Andy's decision, 12 Aug: nobody
-- but the admin sets up games. Revisit if the production crew ever needs
-- to create Friday's fixture without him -- they would be blocked, and
-- would discover it at the worst possible moment.
--
-- Scorers MUST be able to update: starting a game, ending it, and every
-- score change during play are all updates to this row.

drop policy if exists "authenticated read games"   on games;
drop policy if exists "authenticated insert games" on games;
drop policy if exists "authenticated update games" on games;
drop policy if exists "authenticated delete games" on games;

create policy "games_select" on games for select
  to authenticated using (true);
create policy "games_insert" on games for insert
  to authenticated with check (public.current_user_role() = 'admin');
create policy "games_update" on games for update
  to authenticated using (public.current_user_role() in ('admin','game_entry'));
create policy "games_delete" on games for delete
  to authenticated using (public.current_user_role() = 'admin');

-- VERIFIED 12 Aug: game_entry start+end OK; admin create+delete OK;
-- view INSERT blocked; game_entry DELETE against a real game id
-- returned "rows deleted: 0" -- the policy filtered it out.
--
-- Note on testing deletes: a plain .delete() returns no error whether it
-- was blocked or simply matched nothing. Add .select() and count the
-- rows returned, or the test proves nothing.


-- ------------------------------------------------------------
-- 4. game_rosters, players, teams
-- ------------------------------------------------------------
-- Reference data: everyone reads, only admins write. Rosters are built
-- before kickoff, not during a game, and a scorer accidentally
-- rewriting one mid-game would be unpleasant.

drop policy if exists "authenticated read rosters"  on game_rosters;
drop policy if exists "authenticated write rosters" on game_rosters;
drop policy if exists "authenticated read players"  on players;
drop policy if exists "authenticated write players" on players;
drop policy if exists "authenticated read teams"    on teams;
drop policy if exists "authenticated write teams"   on teams;
drop policy if exists "authenticated update teams"  on teams;

create policy "game_rosters_select" on game_rosters for select
  to authenticated using (true);
create policy "game_rosters_write" on game_rosters for all
  to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "players_select" on players for select
  to authenticated using (true);
create policy "players_write" on players for all
  to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "teams_select" on teams for select
  to authenticated using (true);
create policy "teams_write" on teams for all
  to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- VERIFIED 12 Aug: admin roster edit OK; game_entry players INSERT
-- blocked.


-- ------------------------------------------------------------
-- 5. profiles — DELIBERATELY UNCHANGED
-- ------------------------------------------------------------
-- Already correct before any of this:
--     "users read own profile"    SELECT  (auth.uid() = id)
--     "users update own profile"  UPDATE  (auth.uid() = id)
--
-- That is self-only, not wide open. It works because:
--   * current_user_role() is SECURITY DEFINER and reads profiles
--     regardless of these policies;
--   * the account page lists users through api/manage-users.js using the
--     SERVICE KEY, which bypasses RLS entirely;
--   * the trigger `profiles_role_guard` already blocks any role change
--     by a non-admin.
--
-- KNOWN GAP, see TODO: the trigger does NOT stop an ADMIN demoting
-- THEMSELVES. The account page greys out the self-row, but the UI is not
-- a security boundary. A second admin account was created 12 Aug, which
-- reduces this from fatal to annoying.


-- ------------------------------------------------------------
-- 6. Final check
-- ------------------------------------------------------------
-- Must return ZERO rows: no "just be signed in" policy left anywhere.

select tablename, policyname, cmd, qual::text
  from pg_policies
 where schemaname = 'public'
   and qual::text like '%auth.role()%'
 order by tablename;

-- CONFIRMED 12 Aug 2026: zero rows.


-- ============================================================
-- UNDO — back to "any signed-in user can do anything"
-- ============================================================
-- Not secure. This is the pre-12-Aug state, kept only as an escape
-- hatch. The SQL editor bypasses RLS, so this always runs however
-- locked-down things get.
--
-- do $$
-- declare r record;
-- begin
--   for r in select tablename, policyname from pg_policies
--             where schemaname='public'
--               and tablename in ('plays','games','game_rosters','teams','players') loop
--     execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
--   end loop;
-- end $$;
--
-- create policy "plays_open"        on plays        for all to authenticated using (true) with check (true);
-- create policy "games_open"        on games        for all to authenticated using (true) with check (true);
-- create policy "game_rosters_open" on game_rosters for all to authenticated using (true) with check (true);
-- create policy "teams_open"        on teams        for all to authenticated using (true) with check (true);
-- create policy "players_open"      on players      for all to authenticated using (true) with check (true);
--
-- Leave `profiles` alone -- it was never changed.


-- ============================================================
-- WHAT THIS DOES NOT COVER
-- ============================================================
-- * api/gamedata.js uses the SERVICE ROLE key and bypasses RLS by
--   design -- that is how the vMix overlay reads a game without signing
--   in. Unchanged by any of this.
-- * api/manage-users.js likewise; its own admin check remains the only
--   guard on user management.
-- * A compromised admin password still gets everything. This limits
--   blast radius by role; it is not defence against a stolen
--   credential. That is what MFA is for, and MFA comes after this.
