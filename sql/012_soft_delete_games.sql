-- =====================================================================
-- 012 — deleting a game stops destroying it
--
-- THE THREAT MODEL, corrected. Guarding against data destruction was the
-- reason 2FA and password rules came up, and both aim at the LESS LIKELY
-- cause: someone stealing a coach's password and choosing to delete
-- things. That requires an attacker to target a high school football
-- stats app, obtain credentials, and prefer destruction to looking.
--
-- The likely cause is a coach clicking the wrong button, and it is not a
-- risk — it is a certainty on a long enough timeline. No password
-- strength prevents it.
--
-- Today `games.delete()` is a HARD delete, and `plays` and
-- `game_rosters` both cascade. A season disappears and the only route
-- back is last night's backup, losing everything entered since.
--
-- THE CASCADE IS WHY THIS WORKS. Because the children hang off the
-- parent row, NOT deleting the parent leaves every play and roster entry
-- exactly where it is. Restoring is one column set back to null; nothing
-- has to be rebuilt.
--
-- ---------------------------------------------------------------------
-- WHY THE FILTER LIVES IN RLS
-- ---------------------------------------------------------------------
-- Seventeen files read `games`. Filtering in the application means
-- finding and changing every one of them, and missing one shows deleted
-- games somewhere nobody thought to look. In a policy it is enforced
-- once, for every query that exists and every query written later.
--
-- The cost is that a tenant admin cannot SEE a deleted game to restore
-- it. That is deliberate: restoration is a support action, the super
-- admin can do it, and the alternative is a "recently deleted" view in
-- every one of those seventeen files.
-- =====================================================================

alter table public.games add column if not exists deleted_at timestamptz;

comment on column public.games.deleted_at is
  'Soft delete. NULL means live. RLS hides non-null rows from everyone except the platform, so a deleted game is recoverable rather than gone. plays and game_rosters cascade from games, so they are untouched and restoring is one update.';

create index if not exists games_live_idx on public.games (tenant_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- SELECT — deleted games are invisible, except to the platform
-- ---------------------------------------------------------------------
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (
    (tenant_id = public.current_tenant_id() and deleted_at is null)
    or public.is_super_admin()
  );

-- ---------------------------------------------------------------------
-- UPDATE
--
-- `using` allows a live game in my tenant, or anything if I am the
-- platform. That second clause is what lets a deleted game be restored.
--
-- NOTE WHAT THIS POLICY CANNOT DO: it cannot perform the soft delete.
-- See the long note above delete_game() below — a SELECT policy that
-- hides deleted rows makes `update games set deleted_at = now()`
-- impossible, whatever the UPDATE policy says.
-- ---------------------------------------------------------------------
drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated
  using (
    (public.current_user_role() = any (array['admin','game_entry'])
     and tenant_id = public.current_tenant_id()
     and deleted_at is null)
    or public.is_super_admin()
  )
  with check (
    (public.current_user_role() = any (array['admin','game_entry'])
     and tenant_id = public.current_tenant_id())
    or public.is_super_admin()
  );

-- ---------------------------------------------------------------------
-- DELETE — kept, and now almost unreachable
--
-- A hard delete is still possible for the platform, because a tenant
-- that has genuinely gone and had its retention period expire has to be
-- purgeable. A tenant admin can no longer hard-delete anything: the
-- application calls an UPDATE now, and if some future code path calls
-- delete() it is refused rather than quietly destroying a season.
-- ---------------------------------------------------------------------
drop policy if exists games_delete on public.games;
create policy games_delete on public.games for delete to authenticated
  using (public.is_super_admin());

-- ---------------------------------------------------------------------
-- The anonymous recap must not serve a deleted game
-- ---------------------------------------------------------------------
drop policy if exists "anon reads shared games" on public.games;
create policy "anon reads shared games" on public.games for select to anon
  using (status = 'final' and is_public = true and deleted_at is null);

-- A published game that is later deleted must stop serving its plays and
-- rosters too. Those policies reach the game by subquery already, so the
-- condition goes in the same place.
drop policy if exists "anon reads shared game plays" on public.plays;
create policy "anon reads shared game plays" on public.plays for select to anon
  using (exists (select 1 from public.games g
                  where g.id = plays.game_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null));

drop policy if exists "anon reads shared game rosters" on public.game_rosters;
create policy "anon reads shared game rosters" on public.game_rosters for select to anon
  using (exists (select 1 from public.games g
                  where g.id = game_rosters.game_id and g.status = 'final'
                    and g.is_public = true and g.deleted_at is null));

-- =====================================================================
-- DELETING AND RESTORING GO THROUGH FUNCTIONS, AND HERE IS WHY
--
-- The obvious implementation is `update games set deleted_at = now()`.
-- IT DOES NOT WORK, and the reason is a PostgreSQL behaviour that is easy
-- to miss:
--
--   **When a table has SELECT policies, an UPDATE requires the RESULTING
--   row to still be visible under them.**
--
-- games_select hides rows where deleted_at is not null. So the moment the
-- update sets deleted_at, the new row fails the SELECT policy and
-- Postgres rejects the whole statement with "new row violates row-level
-- security policy" — pointing at the UPDATE policy, which is innocent.
-- Confirmed by experiment: with the deleted_at clause removed from
-- games_select the identical update succeeds.
--
-- Three ways out, and only one is good:
--
--   1. Stop filtering in games_select and filter in the app instead.
--      Seventeen files read `games`; missing one shows deleted games
--      somewhere nobody thought to look.
--   2. Let games_select show deleted rows to their owner. Then every
--      existing query returns them and the dashboard lists deleted games.
--   3. Do the write in a SECURITY DEFINER function, where RLS does not
--      apply, and check the caller's rights explicitly inside it.
--
-- Three, and it is better than the update it replaces: the permission
-- test is written out in one place rather than inferred from the
-- interaction of two policies, and both actions have NAMES — which is
-- what an audit trail will need to record.
-- =====================================================================

create or replace function public.delete_game(p_game_id uuid)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  g public.games%rowtype;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    return false;                       -- already gone, or never existed
  end if;
  if g.deleted_at is not null then
    return false;                       -- already deleted; not an error
  end if;

  -- SECURITY DEFINER means RLS is not doing this for us. Every check the
  -- policies would have made has to be made here, explicitly.
  if not (
    public.is_super_admin()
    or (g.tenant_id = public.current_tenant_id()
        and public.current_user_role() = any (array['admin','game_entry']))
  ) then
    raise exception 'Not permitted to delete that game.';
  end if;

  update public.games set deleted_at = now() where id = p_game_id;
  return true;
end;
$function$;

comment on function public.delete_game(uuid) is
  'Soft-deletes a game. A function rather than an UPDATE because a SELECT policy hiding deleted rows makes the equivalent update impossible - Postgres requires the post-update row to remain visible.';

revoke all on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Restoring, for the platform only. Same mechanism, same reason.
-- ---------------------------------------------------------------------
create or replace function public.restore_game(p_game_id uuid)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform can restore a deleted game.';
  end if;
  update public.games set deleted_at = null where id = p_game_id;
  return found;
end;
$function$;

revoke all on function public.restore_game(uuid) from public, anon;
grant execute on function public.restore_game(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values (12, '012_soft_delete_games') on conflict (version) do nothing;
