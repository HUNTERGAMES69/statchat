-- DOWN for 008_team_default.sql
-- Dropping the default makes games.team_id required from the app again,
-- which breaks game creation — the state 007 left production in. Only
-- useful as part of unwinding 006 and 007 together.
alter table public.games alter column team_id drop default;
drop function if exists public.current_team_id();
delete from public.schema_migrations where version = 8;
