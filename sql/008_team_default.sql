-- =====================================================================
-- 008 — games.team_id needs a default too
--
-- A FIX FOR A MISS IN 007, found in production within minutes of running
-- it: creating a game failed outright.
--
-- 006 added `games.team_id` and made it NOT NULL. 007 then gave a
-- default to `tenant_id` on four tables and did not give one to
-- `team_id` — so every game insert failed on a column the application
-- has never heard of. The reasoning in 007 explains at length why
-- `teams` gets no default, and never looked at the column immediately
-- beside it.
--
-- **A new NOT NULL column needs a default or a writer. Every time.**
-- 007 was written as "the tenant defaults" and that framing is what hid
-- team_id: it is not a tenant column, so it was not on the list, even
-- though it was made NOT NULL by the same migration.
--
-- WHY A FUNCTION AND NOT A SUBQUERY. Postgres column defaults cannot
-- contain a subquery, so "the team belonging to my tenant" has to be
-- wrapped in a function to be usable as a default. Same shape as
-- current_tenant_id(), for the same reasons.
-- =====================================================================

-- Returns the caller's team. With one sport per school this is exact.
-- ORDER BY created_at, not an unordered limit: an unordered `limit 1`
-- returns whichever row Postgres feels like, which is the precise fault
-- that made `is_our_team` a hazard in the first place. When a school
-- has two sports this becomes wrong rather than arbitrary, and by then
-- the application must send team_id explicitly — the default is a
-- bridge, not a permanent answer.
create or replace function public.current_team_id()
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select id from public.teams
   where tenant_id = public.current_tenant_id()
   order by created_at
   limit 1;
$function$;

comment on function public.current_team_id() is
  'The signed-in user''s team. Correct while a school fields one sport; when there are two, the app must send games.team_id explicitly and this default should be dropped.';

alter table public.games alter column team_id set default public.current_team_id();

comment on column public.games.team_id is
  'Which team (sport) the game belongs to. Defaulted from current_team_id() so the app need not send it. Added NOT NULL in 006 and given this default in 008, after the omission broke game creation in production.';

insert into public.schema_migrations (version, name)
values (8, '008_team_default') on conflict (version) do nothing;
