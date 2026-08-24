-- =====================================================================
-- DOWN for 009_tenant_rls.sql
--
-- Restores every policy VERBATIM from 000_baseline.sql. Not "close
-- enough" -- a policy that is subtly different from the one it replaced
-- is exactly the failure this whole migration was split apart to avoid.
--
-- The one policy NOT restored is "admins set game visibility". 004
-- dropped it and 005 confirmed that as correct: it was permissive
-- alongside games_update, granted nothing, restricted nothing, and its
-- name claimed a guarantee it did not provide. Bringing it back here
-- would undo a settled decision.
-- =====================================================================

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated using (true);
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all to authenticated
  using (current_user_role() = 'admin'::text) with check (current_user_role() = 'admin'::text);

drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated using (true);
drop policy if exists players_write on public.players;
create policy players_write on public.players for all to authenticated
  using (current_user_role() = 'admin'::text) with check (current_user_role() = 'admin'::text);

drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated using (true);
drop policy if exists games_insert on public.games;
create policy games_insert on public.games for insert to authenticated
  with check (current_user_role() = 'admin'::text);
drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated
  using (current_user_role() = any (array['admin'::text,'game_entry'::text]));
drop policy if exists games_delete on public.games;
create policy games_delete on public.games for delete to authenticated
  using (current_user_role() = 'admin'::text);

drop policy if exists plays_select on public.plays;
create policy plays_select on public.plays for select to authenticated using (true);
drop policy if exists plays_insert on public.plays;
create policy plays_insert on public.plays for insert to authenticated
  with check (current_user_role() = any (array['admin'::text,'game_entry'::text]));
drop policy if exists plays_update on public.plays;
create policy plays_update on public.plays for update to authenticated
  using (current_user_role() = any (array['admin'::text,'game_entry'::text]));
drop policy if exists plays_delete on public.plays;
create policy plays_delete on public.plays for delete to authenticated
  using (current_user_role() = any (array['admin'::text,'game_entry'::text]));

drop policy if exists game_rosters_select on public.game_rosters;
create policy game_rosters_select on public.game_rosters for select to authenticated using (true);
drop policy if exists game_rosters_write on public.game_rosters;
create policy game_rosters_write on public.game_rosters for all to authenticated
  using (current_user_role() = 'admin'::text) with check (current_user_role() = 'admin'::text);

-- tenants is a 006 table; unwinding 009 leaves it readable to nobody
-- rather than to everybody. RLS stays ON with no policies, which denies
-- all -- the same lockdown schema_migrations and leads use.
drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_update on public.tenants;
drop policy if exists "anon reads tenant branding" on public.tenants;
drop trigger  if exists tenants_billing_guard on public.tenants;
drop function if exists public.protect_tenant_billing_columns();
revoke select on public.tenants from anon, authenticated;
revoke update on public.tenants from authenticated;

delete from public.schema_migrations where version = 9;
