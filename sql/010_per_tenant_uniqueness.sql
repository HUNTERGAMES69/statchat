-- =====================================================================
-- 010 — two uniqueness constraints that are global and must be per-tenant
--
-- Hazards 1 and 4 from MULTI_TENANT_PLAN.md. Both block a second school
-- outright, and both are database constraints rather than application
-- code — which is why they were costed wrongly at first.
--
-- HAZARD 1: `one_broadcast_game` is a partial unique index on
-- (is_broadcast) WHERE is_broadcast. ONE game is on air for the whole
-- system. Two schools broadcasting on a Friday night means the second to
-- go live takes the first OFF AIR, mid-game, with no warning and nothing
-- in either app to explain it.
--
-- HAZARD 4: `games.designator` is globally UNIQUE. Two schools cannot
-- both create a game called "2026-W1". This one fails loudly at game
-- creation rather than leaking quietly, which makes it the more visible
-- and the less dangerous of the two.
--
-- Both become unique WITHIN a tenant. Neither has any effect today: with
-- one school, "unique per tenant" and "unique globally" describe the same
-- constraint.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hazard 1 — one game on air PER SCHOOL
-- ---------------------------------------------------------------------
drop index if exists public.one_broadcast_game;
create unique index if not exists one_broadcast_game_per_tenant
  on public.games (tenant_id) where is_broadcast;

comment on index public.one_broadcast_game_per_tenant is
  'One game on air per SCHOOL. Was global until 010 - two schools broadcasting meant the second knocked the first off air.';

-- ---------------------------------------------------------------------
-- Hazard 4 — a designator is unique WITHIN a school
--
-- The constraint is a column-level UNIQUE from the original CREATE TABLE,
-- so Postgres named it games_designator_key. Dropped by that name, with a
-- guard in case an older database named it differently.
-- ---------------------------------------------------------------------
do $$
declare
  con text;
begin
  select conname into con
    from pg_constraint
   where conrelid = 'public.games'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (designator)';
  if con is not null then
    execute format('alter table public.games drop constraint %I', con);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.games'::regclass
                    and conname = 'games_tenant_designator_key') then
    alter table public.games
      add constraint games_tenant_designator_key unique (tenant_id, designator);
  end if;
end $$;

comment on constraint games_tenant_designator_key on public.games is
  'A designator is unique WITHIN a school. Was globally unique until 010, which stopped a second school ever using "2026-W1".';

insert into public.schema_migrations (version, name)
values (10, '010_per_tenant_uniqueness') on conflict (version) do nothing;
