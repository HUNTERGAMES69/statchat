-- =====================================================================
-- 017 — one source of truth for branding
--
-- 006 copied branding into `tenants` and left `teams` holding it too,
-- with a note: "a later migration drops the originals", once the
-- application had been repointed at `tenants`.
--
-- **The application was never repointed.** Every page still reads and
-- writes `teams` — customize.html saves the logo there, and sixteen files
-- read it from there. The copy on `tenants` has been stale since the day
-- it was made.
--
-- It surfaced the way stale copies always do. A tenant admin uploaded a
-- logo on Customize; it saved to `teams`. The platform console read
-- `tenants.logo_url` and showed the crest it had been given in August.
-- Identical in shape to the full-name bug fixed an hour earlier: written
-- to one table, read from another.
--
-- SO THE CONTRACT STEP RUNS THE OTHER WAY. 006 predicted dropping the
-- columns from `teams`; reality decided `teams` is where branding lives,
-- and the copy to remove is the one on `tenants`.
--
-- **A duplicated column is a bug with a delay on it.** Both copies are
-- correct on the day they are made, and nothing tells you which one a
-- given reader used until they disagree.
--
-- name AND full_name STAY on tenants. They are not duplicates: a tenant
-- is the customer and a team is a sport within it, and those names can
-- legitimately differ ("Neville" the account, "Neville Varsity" the
-- team). create_tenant seeds both, deliberately.
-- =====================================================================

alter table public.tenants drop column if exists logo_url;
alter table public.tenants drop column if exists primary_color;
alter table public.tenants drop column if exists secondary_color;

comment on table public.tenants is
  'One row per customer. Branding (logo and colours) lives on public.teams and NOT here - it was duplicated by 006 and the copy went stale immediately, because the application writes teams. See 017.';

insert into public.schema_migrations (version, name)
values (17, '017_drop_stale_tenant_branding') on conflict (version) do nothing;
