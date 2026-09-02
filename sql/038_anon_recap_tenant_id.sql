-- Copyright 2026 StatChat. All rights reserved.
-- Unauthorized copying, modification or distribution of this software
-- or its documentation is prohibited.

-- 038_anon_recap_tenant_id.sql
-- ============================================================================
-- THE PUBLIC RECAP LINK IS BROKEN. This restores it.
--
-- SYMPTOM: https://statchat.co/g/<token> renders and then fails with
--          "permission denied for table games".
--
-- CAUSE: `anon` does not hold a blanket SELECT on public.games -- it holds a
-- COLUMN-LEVEL grant naming fourteen columns (sql/000_baseline.sql:510, first
-- written in sql/history/001_public_recap_sharing.sql). Postgres answers a
-- select touching ANY column outside that list with "permission denied for
-- table games" -- not an empty result, a hard error, so the whole page dies.
--
-- recap.html asks for `tenant_id`, which is not in the list. It was added to
-- fix a real bug -- the branding query reads `game.tenant_id`, and without it
-- a school's own colors fell back to grey while the opponent's (which live on
-- the game row) survived. That fix was correct and the grant was never
-- widened to match it.
--
-- The comment above that query in recap.html already states the rule:
--   "This list must stay a subset of the grant in
--    sql/public_recap_sharing.sql."
-- Nothing enforced it. tests/anon_recap_grant_check.js does now -- it reads the
-- granted column list out of this directory and the select list out of
-- recap.html, and fails if the second is not a subset of the first.
--
-- ============================================================================
-- IS EXPOSING tenant_id A PROBLEM?
--
-- No. It is an opaque UUID, and the anon role can already read a tenant's
-- branding (sql/009_tenant_rls.sql:212, "anon reads tenant branding") and its
-- team colors -- which is exactly what recap.html uses it for and what is
-- already painted on the page a visitor is looking at.
--
-- It grants no wider read: every other anon policy on games, plays and
-- game_rosters is filtered on the SHARED GAME, not on the tenant, so knowing
-- the id does not open a school's other games. Checked before writing this.
-- ============================================================================

begin;

grant select (tenant_id) on table public.games to anon;

-- ============================================================================
-- THE VERIFY IS PART OF THE MIGRATION, NOT A COMMENT UNDER IT.
--
-- First delivery of this file put the check in a trailing comment block. It
-- came back "14" -- the grant above had not run at all, and the editor had
-- still said "Success. No rows returned", which is the same banner a real
-- success shows. That is the second time in a week a no-op has been reported
-- as a success (the 037 _DOWN incident was the first).
--
-- A comment cannot defend itself, and neither can a statement that returns
-- nothing. This select CANNOT succeed without printing a row, so from here
-- on "no rows returned" means the migration did not run. Note also that this
-- file is mostly commentary: running a SELECTION in the editor rather than
-- the whole file can execute nothing but comments and report success.
--
-- has_column_privilege is asked rather than information_schema, because it
-- answers the question the page actually asks -- may anon read this column --
-- and accounts for table-level and column-level grants together.
-- ============================================================================
select
  has_column_privilege('anon','public.games','tenant_id','SELECT') as tenant_id_ok,
  has_column_privilege('anon','public.games','id','SELECT')        as id_still_ok,
  not has_column_privilege('anon','public.games','share_token','SELECT')
                                                                   as share_token_still_private;
-- EXPECT ONE ROW: true, true, true.
--   tenant_id_ok false ................ the grant did not apply; nothing ran
--   id_still_ok false ................. the baseline grant is gone; stop and ask
--   share_token_still_private false ... anon can read share links; stop and ask

commit;

-- ============================================================================
-- Then reload the share link. No app files change; this is a grant only, so
-- there is no redeploy -- the link works the moment the row above reads true.
--
-- tests/anon_recap_grant_check.js keeps the grant and recap.html's select
-- list in agreement from here on.
-- ============================================================================
