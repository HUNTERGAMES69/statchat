-- 035_delete_game_clears_broadcast_DOWN.sql
-- ============================================================================
-- Restores 012's delete_game verbatim: deleted_at only, is_broadcast left
-- as it was.
--
-- THE BACKFILL IS NOT REVERSED, and cannot honestly be. Once the flag is
-- cleared there is no record of which deleted game held it, and inventing one
-- would put a deleted game back on air. Nothing reads is_broadcast on a
-- deleted row except code that already filters deleted_at, so leaving those
-- rows false costs nothing.
-- ============================================================================

create or replace function public.delete_game(p_game_id uuid)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  g public.games%rowtype;
begin
  select * into g from public.games where id = p_game_id;
  if not found then
    return false;
  end if;
  if g.deleted_at is not null then
    return false;
  end if;

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

delete from public.schema_migrations where version = 35;
