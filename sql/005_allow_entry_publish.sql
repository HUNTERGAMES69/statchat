-- =====================================================================
-- 005 — game_entry may publish. Reverts 004.
--
-- Andy's call, 24 Aug 2026, made once the effect of 004 was described in
-- plain terms rather than as a policy bug: the crew who set a game up the
-- day before are the crew who share the recap afterwards, and requiring
-- an admin for that puts Andy in the loop on a Friday night for no gain.
--
-- WHY THIS REVERTS RATHER THAN WIDENS. The obvious edit is to change the
-- trigger's test from `= 'admin'` to `in ('admin','game_entry')`. That
-- would leave a trigger that CAN NEVER FIRE: `games_update` already
-- restricts updates to exactly those two roles, so a `view` user cannot
-- reach the trigger at all and the other two would always pass it.
--
-- **A guard that cannot fail is worse than no guard.** It reads as
-- protection in every future audit of this schema, costs a function call
-- on every single row update of the busiest table in the app, and the
-- day somebody widens `games_update` it silently stops covering the case
-- it appears to cover.
--
-- WHAT 004 GOT RIGHT AND KEEPS. The policy `admins set game visibility`
-- stays dropped. It was PERMISSIVE alongside `games_update`, and
-- permissive policies are OR'd, so it granted nothing and restricted
-- nothing while its NAME claimed a guarantee. Removing it is correct
-- whichever way the publish decision goes — the fault was a rule that
-- lied, not a rule that was too strict.
--
-- WHAT THIS DOES NOT DECIDE. Under multi-tenancy the question comes back
-- in a different shape: not "which role may publish" but "may this user
-- publish THIS school's game". That is tenant scoping, which every table
-- needs anyway, and it is not a reason to keep a role check here now.
-- =====================================================================

drop trigger if exists games_visibility_admin_only on public.games;
drop function if exists public.prevent_visibility_change_by_non_admin();

-- Recorded as a decision, not just an absence, so nobody re-derives it:
comment on column public.games.is_public is
  'Publishes a finalised game to anonymous readers. Settable by admin AND game_entry (decided 24 Aug 2026) - the crew that runs the game shares the recap. Restricted only by games_update RLS.';
comment on column public.games.share_token is
  'The token in /g/<token>. Settable by admin AND game_entry, same reasoning as is_public.';

insert into public.schema_migrations (version, name)
values (5, '005_allow_entry_publish')
on conflict (version) do nothing;
