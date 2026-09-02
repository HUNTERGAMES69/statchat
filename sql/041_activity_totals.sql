-- Copyright 2026 StatChat. All rights reserved.
-- Unauthorized copying, modification or distribution of this software
-- or its documentation is prohibited.

-- 041_activity_totals.sql
-- ============================================================================
-- HOW MUCH FOOTBALL HAS BEEN LOGGED ON STATCHAT.
--
-- Four numbers: games and plays this week, games and plays ever. Read by the
-- Numbers tab in platform.html, through api/stats.js.
--
-- SEPARATE FROM 040 ON PURPOSE. Archiving a notice and counting football have
-- nothing to do with each other, and a migration that does two unrelated
-- things cannot be rolled back for one of them.
--
-- ============================================================================
-- WHAT COUNTS, AND WHY THE ANSWER MATTERS MORE THAN USUAL
--
-- Andy's call, 2 Sep 2026: real football only. This number is going on the
-- brochure site and into social posts, so it has to be a claim that survives
-- somebody asking what it means. Four exclusions:
--
--   tenants.is_demo      demo schools. Their games exist to be shown to
--                        prospects and re-seeded; counting them would be
--                        counting the sales pitch.
--   games.is_sample      the SAMPLE game seeded into every new school so its
--                        first dashboard is not empty. Nobody scored it.
--   games.deleted_at     soft-deleted games. Already invisible everywhere.
--   tenants.deleted_at   deleted schools.
--
-- And one exclusion inside plays:
--
--   plays.is_divider     a divider is a period marker, not a play. Counting
--                        them would inflate every game by roughly four.
--
-- Everything else counts, including preseason and in-progress games. A play
-- entered on a Friday night is football that happened whether or not anybody
-- has pressed Finalize.
--
-- ============================================================================
-- THE WEEK IS MONDAY TO SUNDAY, US CENTRAL. Andy's call.
--
-- date_trunc('week', ...) in Postgres starts on MONDAY, which is what was
-- asked for. It is applied to the CENTRAL wall clock and converted back, so
-- the boundary is midnight in Monroe rather than midnight in UTC.
--
-- WHERE THE TIME ZONE ACTUALLY BITES, measured rather than assumed. A first
-- draft of this comment claimed Friday nights were the hazard. They are not:
--
--   Friday 11:40pm Central  = Sat 04:40 UTC  -> same Monday-start week
--   Sunday 11:40pm Central  = Mon 04:40 UTC  -> DIFFERENT WEEK
--
-- With a Monday start it is SUNDAY night that diverges, and a UTC boundary
-- would file it under the week that has not begun yet. Sunday football is
-- rare in high school, so this is a small window -- but it is a window in
-- which the counter would be reporting a number nobody could reproduce, and
-- the whole point of these figures is that they are quotable.
--
-- 'America/Chicago', not a fixed offset: it carries daylight saving, and the
-- season crosses the November change. Verified across it -- the boundary
-- stays Monday 00:00 Central on both sides.
-- ============================================================================

begin;

create or replace function public.statchat_activity_totals()
returns table (
  week_start  timestamptz,
  week_end    timestamptz,
  games_week  bigint,
  plays_week  bigint,
  games_total bigint,
  plays_total bigint
)
language sql
stable
as $function$
  with win as (
    select date_trunc('week', (now() at time zone 'America/Chicago'))
             at time zone 'America/Chicago'                      as ws,
           date_trunc('week', (now() at time zone 'America/Chicago'))
             at time zone 'America/Chicago' + interval '7 days'  as we
  ),
  -- ONE DEFINITION OF "a real game", used by all four counts. Writing the
  -- filter twice is how the weekly number and the total drift apart.
  real_games as (
    select g.id, g.created_at
      from public.games g
      join public.tenants t on t.id = g.tenant_id
     where g.deleted_at is null
       and coalesce(g.is_sample, false) = false
       and t.is_demo = false
       and t.deleted_at is null
  ),
  real_plays as (
    select p.created_at
      from public.plays p
      join real_games rg on rg.id = p.game_id
     where p.is_divider = false
  )
  select
    (select ws from win),
    (select we from win),
    (select count(*) from real_games rg, win
      where rg.created_at >= win.ws and rg.created_at < win.we),
    (select count(*) from real_plays rp, win
      where rp.created_at >= win.ws and rp.created_at < win.we),
    (select count(*) from real_games),
    (select count(*) from real_plays);
$function$;

comment on function public.statchat_activity_totals() is
  'Games and plays logged this week (Monday to Sunday, America/Chicago) and ever, excluding demo tenants, sample games, soft-deleted games, deleted tenants and play dividers. Read by api/stats.js for the platform Numbers tab.';

-- SERVICE ROLE ONLY. These are cross-tenant totals; no signed-in customer has
-- any business calling this, and api/stats.js is the only caller. Not
-- SECURITY DEFINER: the service role already bypasses RLS, so a definer
-- function would add a privilege escalation route and buy nothing.
revoke all on function public.statchat_activity_totals() from public, anon, authenticated;
grant execute on function public.statchat_activity_totals() to service_role;

-- The weekly counts filter on created_at across every play ever. Cheap now;
-- these keep it cheap as the play table grows.
create index if not exists plays_created_at_idx on public.plays (created_at);
create index if not exists games_created_at_idx on public.games (created_at);

-- ============================================================================
-- VERIFY -- runs inside the migration and prints a row.
-- "No rows returned" means nothing ran.
--
-- EXPECT ONE ROW. week_start is a MONDAY at 00:00 Central (shown in UTC, so
-- it reads 05:00 or 06:00 depending on daylight saving). The four counts are
-- whatever is true today; games_total should look like the number of real
-- games you have, NOT counting your demo schools or the SAMPLE games.
-- ============================================================================
select
  t.week_start,
  to_char(t.week_start at time zone 'America/Chicago', 'Dy YYYY-MM-DD HH24:MI') as week_starts_central,
  t.games_week, t.plays_week, t.games_total, t.plays_total,
  has_function_privilege('service_role','public.statchat_activity_totals()','EXECUTE') as service_role_can_run,
  not has_function_privilege('authenticated','public.statchat_activity_totals()','EXECUTE') as customers_cannot_run
from public.statchat_activity_totals() t;
-- week_starts_central MUST read "Mon". The last two MUST be true.

commit;

notify pgrst, 'reload schema';
