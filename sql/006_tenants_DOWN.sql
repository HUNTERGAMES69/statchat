-- =====================================================================
-- DOWN for 006_tenants.sql
--
-- The plan requires a down script for anything that touches RLS or the
-- shape of the data, and requires it to be RUN rather than read. This
-- one has been.
--
-- 006 only ADDS, so the reversal is a series of drops and the data it
-- backfilled goes with the columns. Nothing that existed before 006 is
-- touched, which is why the expand/contract split matters: had 006 moved
-- the branding columns off `teams`, this file would have to restore
-- values rather than drop columns, and that is a restore rather than a
-- rollback.
--
-- WHAT THIS CANNOT UNDO: `create_profile_for_new_user` is replaced, not
-- versioned, so the original body is written out again below verbatim
-- from 000_baseline.sql. If the baseline is ever regenerated, check that
-- this copy still matches.
-- =====================================================================

drop index if exists public.teams_tenant_idx;
drop index if exists public.games_tenant_idx;
drop index if exists public.games_team_idx;
drop index if exists public.players_tenant_idx;
drop index if exists public.plays_tenant_idx;
drop index if exists public.game_rosters_tenant_idx;
drop index if exists public.profiles_tenant_idx;

alter table public.teams        drop constraint if exists teams_tenant_id_fkey;
alter table public.games        drop constraint if exists games_tenant_id_fkey;
alter table public.games        drop constraint if exists games_team_id_fkey;
alter table public.players      drop constraint if exists players_tenant_id_fkey;
alter table public.plays        drop constraint if exists plays_tenant_id_fkey;
alter table public.game_rosters drop constraint if exists game_rosters_tenant_id_fkey;
alter table public.profiles     drop constraint if exists profiles_tenant_id_fkey;

alter table public.teams        drop column if exists tenant_id;
alter table public.teams        drop column if exists sport;
alter table public.games        drop column if exists tenant_id;
alter table public.games        drop column if exists team_id;
alter table public.players      drop column if exists tenant_id;
alter table public.plays        drop column if exists tenant_id;
alter table public.game_rosters drop column if exists tenant_id;
alter table public.profiles     drop column if exists tenant_id;
alter table public.profiles     drop column if exists is_super_admin;

drop function if exists public.current_tenant_id();
drop function if exists public.is_super_admin();
drop table if exists public.tenants;

-- The signup trigger, restored to its pre-006 body.
create or replace function public.create_profile_for_new_user()
 returns trigger language plpgsql security definer set search_path to 'public', 'auth'
as $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'create_profile_for_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$function$;

delete from public.schema_migrations where version = 6;
