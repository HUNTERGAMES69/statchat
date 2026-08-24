-- =====================================================================
-- StatChat -- BASELINE SCHEMA
-- Captured 23 August 2026 from Supabase project pboushzlcyfkssojpuut
-- via sql/capture/A..G. See sql/capture/README.md for the method.
--
-- THIS IS THE FIRST TIME THE SHAPE OF STATCHAT'S DATA HAS EXISTED
-- OUTSIDE THE SUPABASE DASHBOARD. Before this file there was not one
-- CREATE TABLE statement in the repo.
--
-- It is written to be REPLAYABLE on an empty database. Every statement
-- is guarded so it can also be run against the live project without
-- doing anything -- that is how it gets proven, not a claim that it
-- should be run there.
--
-- WHAT IS DELIBERATELY NOT HERE
--   * Supabase platform objects: the auth/storage/realtime/graphql/vault
--     schemas, their tables and triggers, and six of the seven event
--     triggers (pgrst_*, issue_*). Those belong to the platform and are
--     recreated by it. Only `ensure_rls` is ours.
--   * Column ORDER in profiles. Live has a gap at attnum 3 from a column
--     dropped long ago; a rebuilt database numbers 1-5. Known, accepted,
--     invisible to the application. It WILL show in a capture diff.
--   * storage.buckets column defaults that vary by Supabase version
--     (versioning_status, avif_autodetection, type). The insert names
--     only id/name/public and lets the platform default the rest.
--
-- ORDER MATTERS: extensions, then functions (policies call them), then
-- tables, then indexes, then triggers, then RLS, then grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PREAMBLE -- present on Supabase, needed on a scratch rebuild
--
-- Three foreign keys point at auth.users, so a bare Postgres cannot
-- apply this file without a stand-in. On Supabase every one of these is
-- a no-op.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
    then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
    then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
    then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- auth.uid() and auth.role() are Supabase-provided. The stubs below are
-- created ONLY if absent, so the real ones always win.
do $$ begin
  if to_regprocedure('auth.uid()') is null then
    execute $f$ create function auth.uid() returns uuid language sql stable
             as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid' $f$;
  end if;
  if to_regprocedure('auth.role()') is null then
    execute $f$ create function auth.role() returns text language sql stable
             as 'select nullif(current_setting(''request.jwt.claim.role'', true), '''')' $f$;
  end if;
end $$;

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.teams (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  is_our_team         boolean not null default false,
  created_at          timestamptz not null default now(),
  logo_url            text,
  primary_color       text,
  secondary_color     text,
  current_season_year integer,
  full_name           text,
  -- Nothing reads this. Kept because dropping a column is a migration
  -- and this file is the mechanism that makes one possible -- see the
  -- teams.icon_url item in TODO.md.
  icon_url            text
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  role         text not null default 'view'::text,
  -- GENERATED, not a plain boolean with a default. Policies and
  -- prevent_unfinalize_by_non_admin read it, and if it were writable
  -- it could disagree with `role`.
  is_admin     boolean generated always as (role = 'admin'::text) stored,
  constraint profiles_role_check check (role = any (array['view'::text,'game_entry'::text,'admin'::text]))
);

create table if not exists public.players (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null references public.teams(id) on delete cascade,
  name                  text not null,
  primary_position      text,
  created_at            timestamptz not null default now(),
  default_jersey_number text,
  season_year           integer,
  unit_override         text
);

create table if not exists public.games (
  id                       uuid primary key default gen_random_uuid(),
  -- Globally unique. This is a TENANCY HAZARD not listed in
  -- MULTI_TENANT_PLAN.md: two schools cannot both create "2025-W1".
  designator               text not null unique,
  season_year              integer not null,
  game_date                date,
  home_team_name           text not null,
  away_team_name           text not null,
  our_team_is_home         boolean not null,
  quarter_length_seconds   integer not null default 720,
  status                   text not null default 'setup'::text,
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  finalized_at             timestamptz,
  opponent_logo_url        text,
  opponent_primary_color   text,
  opponent_secondary_color text,
  -- Nullable and UNCONSTRAINED, unlike status. See TODO.md 1b: phase
  -- should be derived from the play log, not trusted from this column.
  game_phase               text default 'notStarted'::text,
  guided_state             jsonb default '{}'::jsonb,
  seed_starters            jsonb,
  final_score_us           integer,
  final_score_opp          integer,
  is_broadcast             boolean not null default false,
  broadcast_set_by         uuid,
  broadcast_set_at         timestamptz,
  is_public                boolean not null default false,
  share_token              text,
  -- Nullable, where is_broadcast and is_public are NOT NULL with the
  -- same default. An inconsistency worth settling in a later migration.
  is_preseason             boolean default false,
  constraint games_status_check check (status = any (array['setup'::text,'in_progress'::text,'final'::text]))
);

create table if not exists public.plays (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games(id) on delete cascade,
  quarter         integer not null,
  -- NUMERIC, not integer, and that is deliberate: a fractional sequence
  -- number lets a missed play be inserted between two existing ones
  -- without renumbering the rest. See TODO.md section 3.
  sequence_number numeric not null,
  team_side       text,
  text            text not null,
  effect          jsonb not null default '{}'::jsonb,
  roles           jsonb,
  unresolved      boolean not null default false,
  is_divider      boolean not null default false,
  is_override     boolean not null default false,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- 4 quarters plus 6 overtime periods.
  constraint plays_quarter_check   check ((quarter >= 1) and (quarter <= 10)),
  constraint plays_team_side_check check (team_side = any (array['teamA'::text,'teamB'::text])),
  constraint plays_game_seq_unique unique (game_id, sequence_number)
);

create table if not exists public.game_rosters (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  team_side     text not null,
  jersey_number text not null,
  player_name   text not null,
  unit          text,
  "position"    text,
  -- SET NULL, not CASCADE: deleting a player must not erase the roster
  -- snapshot of a game they played in. The recorded name survives.
  -- NOTE: nullable, so a snapshot row can exist with no link back to a
  -- player -- which is why the wrong-season-roster query in TODO.md
  -- cannot find every affected game.
  player_id     uuid references public.players(id) on delete set null,
  constraint game_rosters_team_side_check check (team_side = any (array['teamA'::text,'teamB'::text])),
  constraint game_rosters_unit_check      check (unit = any (array['offense'::text,'defense'::text,'special'::text]))
);

-- ---------------------------------------------------------------------
-- 2. FUNCTIONS
--
-- AFTER the tables, BEFORE the policies. Both halves of that matter:
-- current_user_role() is `language sql`, whose body Postgres validates
-- at CREATE time, so it cannot be created before public.profiles
-- exists. On the live database that was invisible -- the table was
-- already there. The policies below then call it, so it must exist by
-- the time they are created.
-- The plpgsql functions would not have complained either way; only the
-- SQL one is checked. Ordering the whole section is clearer than
-- turning check_function_bodies off and hoping.
-- ---------------------------------------------------------------------

-- The role lookup every policy depends on. SECURITY DEFINER because it
-- reads profiles, which is itself behind RLS -- a plain function would
-- recurse into the policy that called it.
create or replace function public.current_user_role()
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select role from profiles where id = auth.uid() limit 1),
    'view'
  );
$function$;

create or replace function public.set_broadcast_game(p_game_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller_role text;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  -- Admin AND game_entry, decided 12 Aug: the crew sets up the day
  -- before and Andy may not be there.
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can set the broadcast game.';
  end if;

  -- Clear first, set second, one statement each, same transaction. The
  -- unique index above would reject the second write otherwise.
  update games set is_broadcast = false
   where is_broadcast and id <> p_game_id;

  update games
     set is_broadcast = true,
         broadcast_set_by = auth.uid(),
         broadcast_set_at = now()
   where id = p_game_id;
end $function$;

create or replace function public.clear_broadcast_game(p_game_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  caller_role text;
begin
  caller_role := coalesce(
    (select role from profiles where id = auth.uid() limit 1), 'view');
  if caller_role not in ('admin','game_entry') then
    raise exception 'Only an admin or game entry user can change the broadcast game.';
  end if;

  update games
     set is_broadcast = false,
         broadcast_set_by = auth.uid(),
         broadcast_set_at = now()
   where id = p_game_id;
end $function$;

-- LOAD-BEARING SECURITY, not tidiness. `authenticated` holds a
-- column-level UPDATE grant on profiles.role and the UPDATE policy lets
-- a user write their own row -- so this trigger is the ONLY thing
-- stopping any user promoting themselves to admin. It cannot be
-- expressed as a policy. Do not remove it without replacing what it does.
create or replace function public.prevent_self_role_change()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and coalesce((select role from profiles where id = auth.uid()), 'view') <> 'admin' then
    raise exception 'Only an admin can change a user role.';
  end if;
  return new;
end $function$;

-- Also load-bearing: the sole guard on reopening a finalized game.
-- Deliberately NOT security definer -- it reads profiles under the
-- caller's own RLS, and a user can always see their own row, which is
-- all this needs.
create or replace function public.prevent_unfinalize_by_non_admin()
 returns trigger language plpgsql
as $function$
begin
  if old.status = 'final' and new.status <> 'final' then
    if not exists (
      select 1 from profiles where id = auth.uid() and is_admin = true
    ) then
      raise exception 'Only an admin can re-open a finalized game.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.prevent_writes_to_finalized_game()
 returns trigger language plpgsql
as $function$
declare
  target_game_id uuid;
  game_status text;
begin
  target_game_id := coalesce(new.game_id, old.game_id);
  select status into game_status from games where id = target_game_id;
  if game_status = 'final' then
    raise exception 'Game % is final -- plays cannot be modified.', target_game_id;
  end if;
  return coalesce(new, old);
end;
$function$;

-- Fires from auth.users, not from anything in public. Without it a new
-- user gets no profile row and therefore no role -- current_user_role()
-- falls back to 'view' and they can read but never enter a play.
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

-- Fired by the `ensure_rls` EVENT trigger at the foot of this file.
create or replace function public.rls_auto_enable()
 returns event_trigger language plpgsql security definer set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. INDEXES
-- ---------------------------------------------------------------------
create index if not exists games_season_idx on public.games using btree (season_year);
create index if not exists games_status_idx on public.games using btree (status);
create unique index if not exists games_share_token_key
  on public.games using btree (share_token) where (share_token is not null);

-- HAZARD 1 IN MULTI_TENANT_PLAN.md, AND IT IS ENFORCED HERE, NOT IN THE
-- APPLICATION. Exactly one game in the entire database may be on air.
-- Making broadcast per-tenant is a migration replacing this index, not a
-- change to api/feed.js.
create unique index if not exists one_broadcast_game
  on public.games using btree (is_broadcast) where is_broadcast;

create index if not exists plays_game_idx          on public.plays using btree (game_id);
create index if not exists plays_game_quarter_idx  on public.plays using btree (game_id, quarter);
create index if not exists plays_game_sequence_idx on public.plays using btree (game_id, sequence_number);
create index if not exists game_rosters_game_idx   on public.game_rosters using btree (game_id);

-- ---------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------
drop trigger if exists games_unfinalize_admin_only on public.games;
create trigger games_unfinalize_admin_only before update on public.games
  for each row execute function public.prevent_unfinalize_by_non_admin();

drop trigger if exists plays_immutable_when_final on public.plays;
create trigger plays_immutable_when_final before insert or delete or update on public.plays
  for each row execute function public.prevent_writes_to_finalized_game();

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard before update on public.profiles
  for each row execute function public.prevent_self_role_change();

-- On auth.users, which is why capture D never saw it.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.teams        enable row level security;
alter table public.profiles     enable row level security;
alter table public.players      enable row level security;
alter table public.games        enable row level security;
alter table public.plays        enable row level security;
alter table public.game_rosters enable row level security;

drop policy if exists "teams_select"          on public.teams;
drop policy if exists "teams_write"           on public.teams;
drop policy if exists "anon reads our branding" on public.teams;
create policy "teams_select" on public.teams for select to authenticated using (true);
create policy "teams_write"  on public.teams for all    to authenticated
  using (current_user_role() = 'admin'::text) with check (current_user_role() = 'admin'::text);
create policy "anon reads our branding" on public.teams for select to anon
  using (is_our_team = true);

drop policy if exists "users read own profile"   on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
-- Role `public`, not `authenticated`. There is deliberately NO insert
-- policy: rows arrive only via create_profile_for_new_user(), which is
-- SECURITY DEFINER and bypasses RLS.
create policy "users read own profile"   on public.profiles for select using (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "players_select" on public.players;
drop policy if exists "players_write"  on public.players;
create policy "players_select" on public.players for select to authenticated using (true);
create policy "players_write"  on public.players for all    to authenticated
  using (current_user_role() = 'admin'::text) with check (current_user_role() = 'admin'::text);

drop policy if exists "games_select" on public.games;
drop policy if exists "games_insert" on public.games;
drop policy if exists "games_update" on public.games;
drop policy if exists "games_delete" on public.games;
drop policy if exists "anon reads shared games"    on public.games;
drop policy if exists "admins set game visibility" on public.games;
create policy "games_select" on public.games for select to authenticated using (true);
create policy "games_insert" on public.games for insert to authenticated
  with check (current_user_role() = 'admin'::text);
create policy "games_update" on public.games for update to authenticated
  using (current_user_role() = any (array['admin'::text,'game_entry'::text]));
create policy "games_delete" on public.games for delete to authenticated
  using (current_user_role() = 'admin'::text);
create policy "anon reads shared games" on public.games for select to anon
  using ((status = 'final'::text) and (is_public = true));
-- CAPTURED AS-IS, AND IT DOES NOT DO WHAT ITS NAME SAYS. Both this and
-- games_update are PERMISSIVE, and permissive policies OR together, so
-- the effective rule is just (admin or game_entry) -- a game_entry user
-- can set is_public and share_token and publish a recap. To restrict
-- rather than widen it would have to be AS RESTRICTIVE. Recorded here
-- unchanged because a baseline records what IS; fixing it is a
-- numbered migration.
create policy "admins set game visibility" on public.games for update to authenticated
  using  (exists (select 1 from profiles p where ((p.id = auth.uid()) and (p.role = 'admin'::text))))
  with check (exists (select 1 from profiles p where ((p.id = auth.uid()) and (p.role = 'admin'::text))));

drop policy if exists "plays_select" on public.plays;
drop policy if exists "plays_insert" on public.plays;
drop policy if exists "plays_update" on public.plays;
drop policy if exists "plays_delete" on public.plays;
drop policy if exists "anon reads shared game plays" on public.plays;
create policy "plays_select" on public.plays for select to authenticated using (true);
create policy "plays_insert" on public.plays for insert to authenticated
  with check (current_user_role() = any (array['admin'::text,'game_entry'::text]));
create policy "plays_update" on public.plays for update to authenticated
  using (current_user_role() = any (array['admin'::text,'game_entry'::text]));
create policy "plays_delete" on public.plays for delete to authenticated
  using (current_user_role() = any (array['admin'::text,'game_entry'::text]));
create policy "anon reads shared game plays" on public.plays for select to anon
  using (exists (select 1 from games g
                 where ((g.id = plays.game_id) and (g.status = 'final'::text) and (g.is_public = true))));

drop policy if exists "game_rosters_select" on public.game_rosters;
drop policy if exists "game_rosters_write"  on public.game_rosters;
drop policy if exists "anon reads shared game rosters" on public.game_rosters;
create policy "game_rosters_select" on public.game_rosters for select to authenticated using (true);
create policy "game_rosters_write"  on public.game_rosters for all    to authenticated
  using (current_user_role() = 'admin'::text) with check (current_user_role() = 'admin'::text);
create policy "anon reads shared game rosters" on public.game_rosters for select to anon
  using (exists (select 1 from games g
                 where ((g.id = game_rosters.game_id) and (g.status = 'final'::text) and (g.is_public = true))));

-- ---------------------------------------------------------------------
-- 6. GRANTS
--
-- Supabase's default posture: wide table grants, with RLS as the actual
-- gate. Captured rather than tightened. Two notes for whoever revisits:
--   * TRUNCATE is NOT subject to RLS. Not reachable through PostgREST,
--     so not a live hole, but it should not be granted to anon.
--   * games is the exception -- anon has NO table-level SELECT, only
--     column-level SELECT on the fourteen columns a public recap needs.
--     season_year, game_phase, guided_state, seed_starters, share_token,
--     created_by/at, finalized_at, is_broadcast, is_preseason and the
--     broadcast_set_* pair are correctly excluded.
-- ---------------------------------------------------------------------
grant all on table public.teams, public.profiles, public.players,
                   public.plays, public.game_rosters
  to anon, authenticated, service_role;

grant all on table public.games to authenticated, service_role;
grant insert, update, delete, truncate, references, trigger
  on table public.games to anon;
grant select (
  id, designator, game_date, home_team_name, away_team_name,
  our_team_is_home, quarter_length_seconds, status,
  opponent_logo_url, opponent_primary_color, opponent_secondary_color,
  final_score_us, final_score_opp, is_public
) on table public.games to anon;

-- ---------------------------------------------------------------------
-- 7. EVENT TRIGGER
--
-- Ours; the other six on this database (pgrst_*, issue_*) are the
-- platform's. Creating an event trigger needs superuser, which the
-- Supabase `postgres` role may not have -- so this is guarded and will
-- skip with a notice rather than abort the whole file.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    begin
      create event trigger ensure_rls on ddl_command_end
        when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
        execute function public.rls_auto_enable();
    exception when insufficient_privilege then
      raise notice 'ensure_rls not created: needs superuser. Create it by hand.';
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. STORAGE
--
-- storage.buckets is platform-managed, so the table is not created here
-- -- only the row and the policies, which are ours. Skipped entirely on
-- a scratch database with no storage schema.
--
-- NOTE for tenancy: one flat world-readable bucket, no size limit, no
-- MIME allowlist, no DELETE policy, and no path scoping. A fifth hazard
-- alongside the three in MULTI_TENANT_PLAN.md.
-- ---------------------------------------------------------------------
do $$ begin
  if to_regclass('storage.buckets') is null then
    raise notice 'no storage schema; skipping bucket and storage policies';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('team-logos', 'team-logos', true)
  on conflict (id) do nothing;

  drop policy if exists "anyone can view team logos" on storage.objects;
  drop policy if exists "authenticated users can upload team logos" on storage.objects;
  drop policy if exists "authenticated users can update team logos" on storage.objects;

  create policy "anyone can view team logos" on storage.objects
    for select using (bucket_id = 'team-logos'::text);
  create policy "authenticated users can upload team logos" on storage.objects
    for insert with check ((bucket_id = 'team-logos'::text) and (auth.role() = 'authenticated'::text));
  create policy "authenticated users can update team logos" on storage.objects
    for update using ((bucket_id = 'team-logos'::text) and (auth.role() = 'authenticated'::text));
end $$;
