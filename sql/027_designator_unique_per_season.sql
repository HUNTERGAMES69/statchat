-- =====================================================================
-- 027  A DESIGNATOR IS UNIQUE PER SEASON, AND A DELETED GAME RELEASES IT
-- =====================================================================
-- Reported by Andy, 31 Aug 2026, creating a game in Neville:
--
--   duplicate key value violates unique constraint
--   "games_tenant_designator_key"
--
-- 010 made that constraint per-tenant: unique (tenant_id, designator).
-- Correct at the time. Two migrations later 012 made deletion SOFT --
-- the row stays with deleted_at set -- and nobody came back to this.
-- The consequences compound:
--
--   * A DELETED GAME KEEPS ITS NAME FOREVER. The row is invisible to the
--     tenant (012's SELECT policy hides it) but the constraint still
--     sees it, so "G6" is refused with an error naming a game the person
--     cannot find anywhere in their own app. That is this report.
--
--   * A DESIGNATOR IS CONSUMED ACROSS ALL SEASONS. `season_year` is not
--     in the key, so this year's "G1" blocks next year's "G1" -- and
--     numbering games G1..G10 every autumn is the obvious thing to do.
--     Nobody has hit it yet only because no tenant has run two seasons.
--
-- Both are the same fix: the key is (tenant_id, season_year, designator)
-- and it only applies to rows that still exist.
--
-- A PARTIAL INDEX, NOT A CONSTRAINT. Postgres has no partial UNIQUE
-- CONSTRAINT -- the WHERE clause is only available on an index -- which
-- is why the constraint is dropped rather than altered. Inserts are
-- refused the same way either way; only the error's constraint name
-- changes, and 027 also stops that name reaching a person (see
-- create_game.html).
--
-- SAFE TO RE-RUN. If two rows already collide under the new key the
-- CREATE INDEX fails and the old constraint is already gone -- so the
-- check below reports them and refuses to proceed instead.
-- =====================================================================

do $$
declare
  dupes text;
begin
  select string_agg(format('tenant %s / %s / "%s" (%s rows)',
                           tenant_id, season_year, designator, n), '; ')
    into dupes
    from (select tenant_id, season_year, designator, count(*) n
            from public.games
           where deleted_at is null
           group by 1, 2, 3
          having count(*) > 1) d;
  if dupes is not null then
    raise exception 'Cannot apply 027: these live games already share a designator within a season -- rename or delete one of each pair first: %', dupes;
  end if;
end $$;

alter table public.games drop constraint if exists games_tenant_designator_key;

drop index if exists public.games_tenant_season_designator_idx;
create unique index games_tenant_season_designator_idx
  on public.games (tenant_id, season_year, designator)
  where deleted_at is null;

comment on index public.games_tenant_season_designator_idx is
  'A game designator is unique within a school AND within a season, and only among games that still exist. Replaced games_tenant_designator_key (010), which spanned every season and counted soft-deleted rows - so a deleted game held its name forever and this year''s "G1" blocked next year''s.';

insert into public.schema_migrations (version, name)
values (27, '027_designator_unique_per_season') on conflict (version) do nothing;
