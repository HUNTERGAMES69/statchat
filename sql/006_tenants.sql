-- =====================================================================
-- 006 — tenants, and a tenant_id on everything
--
-- Step 2 of MULTI_TENANT_PLAN.md. This migration ADDS; it removes
-- nothing and rewrites no policy, so the application keeps working
-- exactly as it does today the moment it lands.
--
-- EXPAND, MIGRATE, CONTRACT — and this file is only the EXPAND.
-- The plan says `teams` splits into `tenants` + `teams`, with branding
-- moving across. Nineteen call sites read `teams.primary_color` and the
-- rest of that set, so MOVING the columns breaks all nineteen at the
-- instant the migration runs. Instead the branding is COPIED into
-- `tenants`, `teams` keeps its columns, and both are correct until the
-- app has been repointed. A later migration drops the originals.
--
-- The cost is a fortnight of two sources of truth for a school's colours
-- — the exact fault recorded for teams.icon_url. It is accepted here
-- because the alternative is a flag day, and it is bounded: the contract
-- migration is written at the same time as the app patch, not left to
-- be remembered.
--
-- RLS IS NOT TOUCHED. Policies are 007, deliberately separate: a wrong
-- policy does not error, it returns fewer rows or more, and it needs its
-- own tested DOWN script. Adding columns is reversible in a way that
-- rewriting seventeen policies is not.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE TENANT
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  full_name         text,
  logo_url          text,
  -- NULL means "not chosen yet", and the app falls back to the neutral
  -- greys. Not defaulted here: a default would make "never set" and
  -- "deliberately grey" indistinguishable, and the first-login flow
  -- needs to know which it is.
  primary_color     text,
  secondary_color   text,
  -- The overlay's whole identity. See MULTI_TENANT_PLAN Q2: the key IS
  -- the tenant, so there is no second parameter that could disagree
  -- with it. Rotatable without touching an environment variable.
  -- SCHEMA-QUALIFIED. pgcrypto is installed into `extensions`, not
  -- `public` (see 000_baseline), so a bare gen_random_bytes() is not on
  -- the search path and this column default fails at CREATE TABLE.
  -- gen_random_uuid() above is fine because it is core Postgres.
  feed_key          text not null unique
                    default encode(extensions.gen_random_bytes(24), 'hex'),
  subscription      text not null default 'trial',
  renews_on         date,
  created_at        timestamptz not null default now(),
  constraint tenants_subscription_check
    check (subscription = any (array['trial'::text,'active'::text,'lapsed'::text]))
);

comment on table public.tenants is
  'One row per SCHOOL. A school may field several teams; see public.teams.';
comment on column public.tenants.feed_key is
  'Identifies the tenant to the unauthenticated overlay endpoints. Rotatable. There is deliberately no master key - see MULTI_TENANT_PLAN.md Q2.';
comment on column public.tenants.primary_color is
  'NULL until the school chooses. The app falls back to neutral grey, never to another school''s colours.';

-- Seed from the existing single team. `is_our_team` is what identifies
-- it today; this is the last migration in which that is true.
insert into public.tenants (name, full_name, logo_url, primary_color, secondary_color)
select name, full_name, logo_url, primary_color, secondary_color
  from public.teams
 where is_our_team = true
   and not exists (select 1 from public.tenants)
 limit 1;

-- A database with no `is_our_team` row would otherwise silently produce
-- no tenant and then fail at the NOT NULL below with a confusing error.
do $$ begin
  if not exists (select 1 from public.tenants) then
    raise exception 'No tenant could be seeded: no teams row has is_our_team = true. Fix that first; this migration has changed nothing.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. THE COLUMNS — nullable first, always
-- ---------------------------------------------------------------------
alter table public.teams        add column if not exists tenant_id uuid;
alter table public.games        add column if not exists tenant_id uuid;
alter table public.players      add column if not exists tenant_id uuid;
alter table public.plays        add column if not exists tenant_id uuid;
alter table public.game_rosters add column if not exists tenant_id uuid;
alter table public.profiles     add column if not exists tenant_id uuid;

-- A team is a SPORT within a school. One row today, and the column that
-- makes a second one possible.
alter table public.teams add column if not exists sport text not null default 'football';

-- WHICH TEAM A GAME BELONGS TO. Added now, while the backfill is one
-- UPDATE with no WHERE clause, rather than later when it is a data
-- migration on the largest table in the application. `games` has never
-- had a foreign key to `teams` at all.
alter table public.games add column if not exists team_id uuid;

-- The platform owner. Sparsely populated, and deliberately NOT the
-- existing `profiles.is_admin`, which is generated from role = 'admin'
-- and means "admin OF THIS SCHOOL" — every tenant will have one.
alter table public.profiles add column if not exists is_super_admin boolean not null default false;
comment on column public.profiles.is_super_admin is
  'Platform owner. NOT the same as is_admin, which is per-school. Grants cross-tenant access; see MULTI_TENANT_PLAN.md.';

-- ---------------------------------------------------------------------
-- 3. BACKFILL — before any NOT NULL
-- ---------------------------------------------------------------------
update public.teams        set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.games        set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.players      set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
-- THE PLAYS BACKFILL HAS TO STEP AROUND A TRIGGER, and finding out why
-- is the reason this migration was tested against realistic data rather
-- than an empty schema.
--
-- `plays_immutable_when_final` refuses ANY update to a play belonging to
-- a game whose status is 'final' — which is most games, and correctly so:
-- it is the guard that stops a finished game being edited. It cannot
-- tell "somebody is rewriting history" from "the schema is being
-- migrated", and it should not have to.
--
-- So it is disabled for the length of the backfill and re-enabled
-- immediately, INSIDE AN EXPLICIT TRANSACTION. DDL is transactional in
-- Postgres, so if anything in here fails the rollback restores the
-- trigger too. Disabling it outside a transaction would risk leaving
-- finalised games editable if the migration stopped halfway.
begin;
alter table public.plays disable trigger plays_immutable_when_final;
update public.plays        set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
alter table public.plays enable trigger plays_immutable_when_final;
commit;
update public.game_rosters set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.profiles     set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.games        set team_id   = (select id from public.teams where is_our_team limit 1) where team_id is null;

-- ---------------------------------------------------------------------
-- 4. NOW tighten
-- ---------------------------------------------------------------------
alter table public.teams        alter column tenant_id set not null;
alter table public.games        alter column tenant_id set not null;
alter table public.players      alter column tenant_id set not null;
alter table public.plays        alter column tenant_id set not null;
alter table public.game_rosters alter column tenant_id set not null;
alter table public.games        alter column team_id   set not null;

-- PROFILES.TENANT_ID STAYS NULLABLE, PERMANENTLY.
-- `create_profile_for_new_user` inserts a profile the instant an auth
-- user exists — before the invite metadata has necessarily been read,
-- and before anything knows which school they belong to. NOT NULL here
-- breaks signup outright, and the failure appears at a new customer's
-- first login rather than in testing.
-- A null tenant sees nothing, which is the correct default-deny.
comment on column public.profiles.tenant_id is
  'NULLABLE ON PURPOSE. The signup trigger creates a profile before a tenant is known; NOT NULL here breaks signup. Null = no access.';

-- ---------------------------------------------------------------------
-- 5. KEYS AND INDEXES
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'teams_tenant_id_fkey') then
    alter table public.teams add constraint teams_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'games_tenant_id_fkey') then
    alter table public.games add constraint games_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'games_team_id_fkey') then
    alter table public.games add constraint games_team_id_fkey
      foreign key (team_id) references public.teams(id); end if;
  if not exists (select 1 from pg_constraint where conname = 'players_tenant_id_fkey') then
    alter table public.players add constraint players_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'plays_tenant_id_fkey') then
    alter table public.plays add constraint plays_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade; end if;
  if not exists (select 1 from pg_constraint where conname = 'game_rosters_tenant_id_fkey') then
    alter table public.game_rosters add constraint game_rosters_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade; end if;
  -- profiles: SET NULL, not CASCADE. Deleting a school must not delete
  -- the people; it must leave them with no access and a name still
  -- attached to the plays they entered.
  if not exists (select 1 from pg_constraint where conname = 'profiles_tenant_id_fkey') then
    alter table public.profiles add constraint profiles_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete set null; end if;
end $$;

create index if not exists teams_tenant_idx        on public.teams (tenant_id);
create index if not exists games_tenant_idx        on public.games (tenant_id);
create index if not exists games_team_idx          on public.games (team_id);
create index if not exists players_tenant_idx      on public.players (tenant_id);
create index if not exists plays_tenant_idx        on public.plays (tenant_id);
create index if not exists game_rosters_tenant_idx on public.game_rosters (tenant_id);
create index if not exists profiles_tenant_idx     on public.profiles (tenant_id);

-- ---------------------------------------------------------------------
-- 6. THE TWO FUNCTIONS THE POLICIES WILL CALL
-- ---------------------------------------------------------------------

-- Mirrors current_user_role() exactly: `stable` so Postgres evaluates it
-- once per statement rather than once per row, `security definer`
-- because profiles is behind RLS and a plain function would recurse into
-- the policy that called it.
--
-- NO coalesce DEFAULT. A null tenant must deny, not fall back to
-- something — that is the whole reason profiles.tenant_id may be null.
create or replace function public.current_tenant_id()
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select tenant_id from profiles where id = auth.uid() limit 1;
$function$;

-- BESIDE current_tenant_id(), never inside it. An override that cannot
-- be seen in the policy text is one nobody thinks to log, and this
-- system promises the platform owner a full audit trail.
create or replace function public.is_super_admin()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select is_super_admin from profiles where id = auth.uid() limit 1), false);
$function$;

comment on function public.is_super_admin() is
  'Platform owner. Used BESIDE current_tenant_id() in policy text so the override is visible where it applies.';

-- ---------------------------------------------------------------------
-- 7. THE SIGNUP TRIGGER LEARNS ABOUT INVITES
--
-- inviteUserByEmail(email, { data: { display_name, tenant_id } }) puts
-- those into raw_user_meta_data. Reading them here means the tenant is
-- present from the instant the profile row exists, rather than patched
-- afterwards — so there is no window in which a user has a profile and
-- no school.
--
-- It also fixes something already wrong: display_name was set to the
-- email address, so every user in the system displays as an email.
-- ---------------------------------------------------------------------
-- The trigger below reads `new.raw_user_meta_data`. Real Supabase always
-- has that column; the STUB auth.users created by 000_baseline for
-- scratch rebuilds does not, so without this the trigger cannot be
-- exercised on a test database — which is precisely where it needs
-- exercising, since the alternative is finding out at a customer's first
-- signup.
--
-- On real Supabase this is a no-op (the column exists) or fails on
-- ownership, and either is fine — hence the swallowed exception. It must
-- never stop the migration.
do $$ begin
  begin
    alter table auth.users add column if not exists raw_user_meta_data jsonb;
  exception when others then
    raise notice 'auth.users.raw_user_meta_data not added (%). Expected on hosted Supabase, where it already exists.', sqlerrm;
  end;
end $$;

create or replace function public.create_profile_for_new_user()
 returns trigger language plpgsql security definer set search_path to 'public', 'auth'
as $function$
declare
  meta_name   text;
  meta_tenant uuid;
begin
  meta_name := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  begin
    meta_tenant := nullif(new.raw_user_meta_data->>'tenant_id', '')::uuid;
  exception when others then
    -- A malformed tenant in metadata must not stop the account being
    -- created. No tenant means no access, which is recoverable; a failed
    -- signup is not.
    meta_tenant := null;
  end;

  insert into public.profiles (id, display_name, tenant_id)
  values (new.id, coalesce(meta_name, new.email), meta_tenant)
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'create_profile_for_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$function$;

insert into public.schema_migrations (version, name)
values (6, '006_tenants') on conflict (version) do nothing;
