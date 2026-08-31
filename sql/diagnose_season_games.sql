-- READ ONLY. Nothing here changes anything.
-- ============================================================================
-- NO auth.uid() ANYWHERE IN THIS FILE, and that is the whole reason it was
-- rewritten. The first version scoped every query with
--
--     where g.tenant_id = (select tenant_id from public.profiles
--                           where id = auth.uid())
--
-- which returns "Success. No rows returned" in the Supabase SQL editor --
-- not because there is nothing wrong, but because the editor has no JWT.
-- auth.uid() is NULL there, `tenant_id = NULL` is NULL rather than false, and
-- every row is filtered out. Migration 031 exists because of this same trap.
--
-- The editor runs as a superuser and bypasses RLS, so these queries name the
-- school directly instead.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. THE WHOLE PLATFORM, AT A GLANCE. No parameters -- run it as it is.
--
-- One row per school. `counted_now` is what the season overlays are reading
-- today; `deleted_but_counted` is how many of those are games somebody
-- deleted. Any school with a number in that last column is showing wrong
-- data on air right now.
-- ----------------------------------------------------------------------------
select
  t.name                                   as school,
  tm.current_season_year                   as season,
  count(*) filter (where g.status = 'final')                              as counted_now,
  count(*) filter (where g.status = 'final' and g.deleted_at is not null) as deleted_but_counted,
  count(*) filter (where g.status = 'final' and g.deleted_at is null)     as correct_after_fix,
  count(*) filter (where g.status <> 'final')                             as not_final_ignored
from public.tenants t
join public.teams tm on tm.tenant_id = t.id and tm.is_our_team
left join public.games g
       on g.tenant_id = t.id
      and g.season_year = tm.current_season_year
where t.deleted_at is null
group by t.name, tm.current_season_year
having count(*) filter (where g.status = 'final' and g.deleted_at is not null) > 0
    or count(*) filter (where g.status = 'final') > 0
order by deleted_but_counted desc, school;


-- ----------------------------------------------------------------------------
-- B. ONE SCHOOL, GAME BY GAME. Change the name on the next line.
-- ----------------------------------------------------------------------------
with school as (
  select t.id, tm.current_season_year as season
    from public.tenants t
    join public.teams tm on tm.tenant_id = t.id and tm.is_our_team
   where t.name = 'Neville'          -- <<< the school you are looking at
   limit 1
)
select
  g.designator,
  g.game_date,
  g.status,
  g.is_broadcast,
  g.deleted_at,
  case
    when g.deleted_at is not null and g.status = 'final'
      then 'DELETED, and being counted -- this is the bug'
    when g.deleted_at is not null then 'deleted, not final anyway'
    when g.status <> 'final'      then 'not final -- correctly excluded'
    else 'counted, correctly'
  end as verdict,
  (select count(*) from public.plays p where p.game_id = g.id) as plays
from public.games g, school s
where g.tenant_id = s.id
  and g.season_year = s.season
order by (g.deleted_at is null), g.game_date;


-- ----------------------------------------------------------------------------
-- C. ONE PLAYER, TWO SPELLINGS -- the second fault in the screenshot.
--
-- Any name that differs from another only by case or spacing. Each one of
-- these splits a player's season across two rows on a leader board. Covers
-- both the rosters and the names typed onto plays, since either can reach
-- the box score.
-- ----------------------------------------------------------------------------
with names as (
  select t.name as school, r.player_name as spelling, g.deleted_at
    from public.game_rosters r
    join public.games g  on g.id = r.game_id
    join public.tenants t on t.id = g.tenant_id
  union all
  select t.name,
         coalesce(
           p.roles -> 'passer'  ->> 'name',
           p.roles -> 'carrier' ->> 'name',
           p.roles -> 'receiver'->> 'name'),
         g.deleted_at
    from public.plays p
    join public.games g  on g.id = p.game_id
    join public.tenants t on t.id = g.tenant_id
   where p.roles is not null
)
select
  school,
  lower(regexp_replace(btrim(spelling), '\s+', ' ', 'g')) as normalised,
  array_agg(distinct spelling)                            as spellings,
  count(distinct spelling)                                as how_many,
  -- DELETED GAMES ARE COUNTED IN THIS SECTION ON PURPOSE, unlike everywhere
  -- else in this file. The duplicate on the leader board came from the two
  -- deleted games, so leaving them out explained everything except the thing
  -- being looked at. This column separates "already on screen" from "will
  -- bite once you have two real games".
  bool_or(deleted_at is not null)                         as includes_a_deleted_game,
  bool_or(deleted_at is null)                             as includes_a_live_game
from names
where spelling is not null and btrim(spelling) <> ''
group by school, 2
having count(distinct spelling) > 1
order by how_many desc, school, normalised;
