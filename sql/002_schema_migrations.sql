-- =====================================================================
-- 002 — schema_migrations: let an instance be ASKED what it is missing
--
-- `sql/README.md` has specified this since 15 August and deferred it
-- until there was more than one deployment. Multi-tenancy is that second
-- deployment, and MULTI_TENANT_PLAN.md makes schema versioning the gate
-- on everything else, so it is due now.
--
-- Numbering: 000 is the baseline, 001 was public_recap_sharing, and this
-- is 002. Numbers are never reused and never reordered, even when a file
-- moves — see sql/README.md.
-- =====================================================================

create table if not exists public.schema_migrations (
  -- The numeric prefix of the file: 0, 1, 2. Not the whole filename, so
  -- a file can be renamed without the record of it having run changing.
  version     integer     primary key,
  name        text        not null,
  applied_at  timestamptz not null default now(),
  -- Who ran it. Nullable because the baseline is backfilled below with
  -- nobody to credit, and because the SQL editor may run as a role with
  -- no auth.uid().
  applied_by  uuid
);

comment on table public.schema_migrations is
  'One row per migration file that has run. Insert from the migration itself, last statement.';

-- LOCKED DOWN, unlike every other table here. The Supabase default is to
-- grant everything to anon and authenticated and let RLS decide; that is
-- the wrong default for a table whose whole job is to be trustworthy.
-- Nothing in the application reads it — it is for whoever is holding the
-- SQL editor — so no role needs access and RLS has no policies at all,
-- which means it denies everyone except service_role and the owner.
alter table public.schema_migrations enable row level security;
revoke all on table public.schema_migrations from anon, authenticated;

-- Backfill what has already run. `on conflict do nothing` so this file
-- is idempotent and so re-running it on an instance that is further
-- ahead cannot rewrite history.
insert into public.schema_migrations (version, name) values
  (0, '000_baseline'),
  (1, '001_public_recap_sharing'),
  (2, '002_schema_migrations')
on conflict (version) do nothing;

-- Two notes for whoever writes 003:
--
--   * The LAST statement of every migration from here on is its own
--     insert into this table. Not the first — a migration that records
--     itself before doing the work leaves a lie behind when it fails
--     halfway.
--
--   * broadcast_flag.sql and rls_hardening.sql get NO version number.
--     They ran before the baseline was captured, so their effects are
--     already inside 000. Numbering them would mean an instance built
--     from 000 would appear to be missing two migrations it has in fact
--     already got. They live in sql/history/ for that reason.
