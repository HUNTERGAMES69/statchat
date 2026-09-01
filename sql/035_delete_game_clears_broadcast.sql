-- 035_delete_game_clears_broadcast.sql
-- ============================================================================
-- A DELETED GAME MUST NOT STILL CLAIM TO BE ON AIR.
--
-- delete_game() stamps deleted_at and nothing else, so a game deleted while
-- it was the broadcast game keeps is_broadcast = true forever. The row is
-- gone from every list and still answers "yes" to the one question the whole
-- broadcast stack asks.
--
-- WHAT IT ACTUALLY BREAKS TODAY, precisely, because the answer is smaller
-- than it first looks and the fix should not be sold as bigger than it is:
--
--   * RLS SAVES THE CLIENT. games_select hides deleted rows, so the queries
--     in dashboard.html and broadcast_setup.html return nothing for one.
--     Nobody sees a deleted game described as on air.
--   * THE SERVICE KEY HAS NO SUCH LUCK. api/feed.js and api/gamedata.js hold
--     BYPASSRLS, and both carry a hand-written `.is('deleted_at', null)`
--     with a comment naming this exact function as the reason. The overlays
--     go blank rather than wrong, which is the right failure -- but it is a
--     workaround, and every future service-key reader has to remember it.
--   * IT IS NOT A LOCKOUT. The tenant's one broadcast slot (010's partial
--     unique index on (tenant_id) where is_broadcast) is held by the deleted
--     row, but set_broadcast_game clears any previous holder without
--     filtering on deleted_at, so putting another game on air still works.
--
-- So: not an outage, but a value that lies, propped up by two filters
-- written specifically to survive it. Fixing the source lets those filters
-- become belt-and-braces instead of load-bearing.
--
-- ============================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- IT DOES NOT TOUCH broadcast_set_by / broadcast_set_at. clear_broadcast_game
-- overwrites both when a human takes a game off air, and copying that here
-- was tempting for consistency. It is wrong: those columns record who put the
-- game on air, deleting is not that decision, and delete_game does not record
-- who deleted anything -- so the write would replace real history with a
-- half-truth. deleted_at already says when it went.
--
-- IT DOES NOT PUT THE FLAG BACK ON RESTORE. restore_game clears deleted_at
-- and leaves is_broadcast false, so a restored game comes back OFF air and
-- somebody has to flag it deliberately. That is the safe direction: a restore
-- silently pushing a game onto a live broadcast is a worse surprise than
-- having to click "Set as ON AIR" once.
--
-- THE PERMISSION CHECKS ARE COPIED VERBATIM FROM 012. This replaces a
-- SECURITY DEFINER function, which is exactly where a rewrite quietly drops
-- a guard. Diff this against 012 before applying: the only changes below the
-- header are the two added lines in the UPDATE.
-- ============================================================================

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
  -- UNCHANGED FROM 012.
  if not (
    public.is_super_admin()
    or (g.tenant_id = public.current_tenant_id()
        and public.current_user_role() = any (array['admin','game_entry']))
  ) then
    raise exception 'Not permitted to delete that game.';
  end if;

  -- THE ONE CHANGE. Same statement, not a second UPDATE: a game is either
  -- deleted and off air or neither, and one statement cannot half-succeed.
  -- Clearing a row OUT of a partial unique index can never collide, so this
  -- adds no failure mode to a function that previously could not fail here.
  update public.games
     set deleted_at   = now(),
         is_broadcast = false
   where id = p_game_id;
  return true;
end;
$function$;

comment on function public.delete_game(uuid) is
  'Soft-deletes a game and takes it off air. A function rather than an UPDATE '
  'because a SELECT policy hiding deleted rows makes the equivalent update '
  'impossible - Postgres requires the post-update row to remain visible. '
  'is_broadcast is cleared as of 035; broadcast_set_by/at are left alone '
  'because deleting is not the decision those columns record.';

revoke all on function public.delete_game(uuid) from public, anon;
grant execute on function public.delete_game(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- THE GAMES ALREADY IN THAT STATE.
-- Same argument as 034: fixing the function forward leaves every row that
-- got there first. At most one per school -- 010's index guarantees it --
-- and all of them deleted, so there is nothing here a live game can lose.
-- ---------------------------------------------------------------------
update public.games
   set is_broadcast = false
 where is_broadcast
   and deleted_at is not null;

insert into public.schema_migrations (version, name)
values (35, '035_delete_game_clears_broadcast') on conflict (version) do nothing;
