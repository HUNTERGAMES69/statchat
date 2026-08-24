-- DOWN for 012_soft_delete_games.sql
--
-- **THIS MAKES DELETION DESTRUCTIVE AGAIN.** It restores the 009/010
-- policies, under which a tenant admin can hard-delete a game and take
-- every play and roster row with it by cascade.
--
-- The `deleted_at` COLUMN IS KEPT, deliberately. Dropping it would
-- permanently destroy any game that was soft-deleted while 012 was in
-- force — the down script for a safety feature must not itself destroy
-- data. Rows already soft-deleted become visible again, which is the
-- correct outcome: they exist, and hiding them was 012's doing.
alter table public.games drop constraint if exists games_deleted_at_dummy;

drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (tenant_id = public.current_tenant_id() or public.is_super_admin());

drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated
  using      (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()))
  with check (public.current_user_role() = any (array['admin','game_entry'])
              and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

drop policy if exists games_delete on public.games;
create policy games_delete on public.games for delete to authenticated
  using (public.current_user_role() = 'admin'
         and (tenant_id = public.current_tenant_id() or public.is_super_admin()));

drop policy if exists "anon reads shared games" on public.games;
create policy "anon reads shared games" on public.games for select to anon
  using (status = 'final' and is_public = true);

drop policy if exists "anon reads shared game plays" on public.plays;
create policy "anon reads shared game plays" on public.plays for select to anon
  using (exists (select 1 from public.games g
                  where g.id = plays.game_id and g.status = 'final' and g.is_public = true));

drop policy if exists "anon reads shared game rosters" on public.game_rosters;
create policy "anon reads shared game rosters" on public.game_rosters for select to anon
  using (exists (select 1 from public.games g
                  where g.id = game_rosters.game_id and g.status = 'final' and g.is_public = true));

drop index if exists public.games_live_idx;
drop function if exists public.delete_game(uuid);
drop function if exists public.restore_game(uuid);

delete from public.schema_migrations where version = 12;
