-- =====================================================================
-- 004 — only an admin may publish a game
--
-- NUMBERED 004, NOT 003. `003_leads` was applied to production on 24 Aug
-- and holds version 3. Reusing the number would have created the trigger
-- and then hit `on conflict (version) do nothing` on its own insert —
-- leaving the change applied and unrecorded, which is precisely the lie
-- schema_migrations exists to prevent. The table caught it; the numbering
-- rule in sql/README.md is what made the table able to.
--
-- THE BUG. `games` carries two PERMISSIVE UPDATE policies:
--
--     games_update                 USING current_user_role()
--                                        = ANY('admin','game_entry')
--     "admins set game visibility" USING exists(admin)
--
-- Permissive policies are OR'd. The effective rule is therefore
-- (admin OR game_entry) OR admin — which is just (admin OR game_entry).
-- The second policy grants nothing the first does not, and a game_entry
-- user can set is_public and share_token and publish a recap to the
-- world. Whatever public_recap_sharing.sql intended, admin-only
-- visibility is not what has been enforced.
--
-- **A second permissive policy can only ever ADD permission. It cannot
-- take any away.** That is the whole bug in one sentence.
--
-- WHY NOT `AS RESTRICTIVE`. A restrictive policy applies to EVERY update
-- on the table, so restricting the visibility policy would require every
-- ordinary edit — a score correction, a status change — to satisfy the
-- admin test too. That locks game_entry users out of the app.
--
-- WHY NOT A COLUMN GRANT. Column privileges are granted to a Postgres
-- ROLE, and admins and game_entry users are both `authenticated`. The
-- grant cannot tell them apart.
--
-- WHY A TRIGGER. The rule is "these two columns may not CHANGE unless
-- you are an admin", and that is a comparison between the old row and
-- the new one. An RLS policy cannot see both: USING gets the old row,
-- WITH CHECK gets the new one, and nothing gets to compare them.
-- A BEFORE UPDATE trigger does — and it is the mechanism this schema
-- already uses twice, for prevent_self_role_change and
-- prevent_unfinalize_by_non_admin. This is the third of the same shape.
-- =====================================================================

create or replace function public.prevent_visibility_change_by_non_admin()
 returns trigger language plpgsql
as $function$
begin
  -- `is distinct from` rather than <>, so a NULL on either side is
  -- handled: share_token is nullable and starts out NULL, and
  -- NULL <> 'abc' is NULL, which is not true, which would let the very
  -- first publish through unchecked.
  if (new.is_public   is distinct from old.is_public)
     or (new.share_token is distinct from old.share_token) then
    if coalesce(current_user_role(), 'view') <> 'admin' then
      raise exception 'Only an admin can publish or unpublish a game.';
    end if;
  end if;
  return new;
end;
$function$;

comment on function public.prevent_visibility_change_by_non_admin() is
  'LOAD-BEARING SECURITY. The RLS policies allow game_entry to update games; this is the only thing stopping them publishing one.';

drop trigger if exists games_visibility_admin_only on public.games;
create trigger games_visibility_admin_only
  before update on public.games
  for each row execute function public.prevent_visibility_change_by_non_admin();

-- The policy that never restricted anything. Removing it is safe --
-- games_update already permits exactly the same set -- and leaving it
-- would keep a rule on the table whose name states a guarantee it does
-- not provide, which is how this was missed for a fortnight.
drop policy if exists "admins set game visibility" on public.games;

insert into public.schema_migrations (version, name)
values (4, '004_restrict_game_visibility')
on conflict (version) do nothing;
