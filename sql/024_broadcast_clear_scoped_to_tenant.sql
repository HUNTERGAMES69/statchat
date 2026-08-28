-- 024_broadcast_clear_scoped_to_tenant.sql
-- ============================================================================
-- SCOPE THE "ON AIR" CLEAR TO ONE SCHOOL.
--
-- `set_broadcast_game` clears the flag before setting it, so that only one
-- game is ever on air. That clear has no tenant filter:
--
--     update games set is_broadcast = false
--      where is_broadcast and id <> p_game_id;
--
-- Every game, every school. It was written when the constraint WAS global --
-- migration 010 replaced `one_broadcast_game` with
-- `one_broadcast_game_per_tenant` and updated the index without updating the
-- function that exists to satisfy it.
--
-- ============================================================================
-- WHY THIS HAS NOT BITTEN
--
-- The function is SECURITY DEFINER, so RLS does not narrow it -- but in
-- practice only one school has been broadcasting at a time, so the extra
-- rows the clear could match have not existed. That stops being true the
-- moment a second customer goes live on a Friday night, and the symptom
-- would be the worst kind: their overlay goes blank mid-game, with nothing
-- in their own tenant to explain it.
--
-- ============================================================================
-- WHAT CHANGES
--
-- The clear is limited to the tenant that owns p_game_id. The set is
-- unchanged. Everything else about the function -- the role check, the
-- clear-then-set ordering, the single transaction -- stays exactly as it was.
--
-- A game id that does not exist now leaves the function doing nothing rather
-- than clearing the world and setting nothing, which is the safer failure.
-- ============================================================================

create or replace function public.set_broadcast_game(p_game_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller_role text;
  target_tenant uuid;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  -- Admin AND game_entry, decided 12 Aug: the crew sets up the day
  -- before and Andy may not be there.
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can set the broadcast game.';
  end if;

  -- WHOSE GAME IS THIS. Read first, so the clear below cannot reach past
  -- the school that owns it.
  select tenant_id into target_tenant from games where id = p_game_id;
  if target_tenant is null then
    raise exception 'No such game, or it has no school: %', p_game_id;
  end if;

  -- Clear first, set second, one statement each, same transaction. The
  -- unique index would reject the second write otherwise.
  --
  -- SCOPED, as of 024. Without `tenant_id = target_tenant` this clears every
  -- school's broadcast game, and the index it exists to satisfy has been
  -- per-tenant since 010.
  update games set is_broadcast = false
   where is_broadcast
     and tenant_id = target_tenant
     and id <> p_game_id;

  update games
     set is_broadcast = true,
         broadcast_set_by = auth.uid(),
         broadcast_set_at = now()
   where id = p_game_id;
end $function$;

comment on function public.set_broadcast_game(uuid) is
  'Put one game on air, clearing any other game FOR THE SAME SCHOOL. The '
  'clear was unscoped until 024: it was written when one_broadcast_game was '
  'a global index, and 010 made that index per-tenant without revisiting '
  'this.';

insert into public.schema_migrations (version, name)
values (24, '024_broadcast_clear_scoped_to_tenant') on conflict (version) do nothing;
