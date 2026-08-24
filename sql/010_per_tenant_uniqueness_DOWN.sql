-- DOWN for 010_per_tenant_uniqueness.sql
--
-- WILL FAIL if a second school already exists and has reused a
-- designator, or has a game on air at the same time as another school.
-- That is correct: the down script cannot restore a global constraint
-- over data that violates it, and silently dropping the rows would be
-- very much worse than an error.
drop index if exists public.one_broadcast_game_per_tenant;
create unique index if not exists one_broadcast_game
  on public.games (is_broadcast) where is_broadcast;

alter table public.games drop constraint if exists games_tenant_designator_key;
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid='public.games'::regclass and contype='u'
                    and pg_get_constraintdef(oid)='UNIQUE (designator)') then
    alter table public.games add constraint games_designator_key unique (designator);
  end if;
end $$;

delete from public.schema_migrations where version = 10;
