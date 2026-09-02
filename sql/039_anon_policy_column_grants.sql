-- Copyright 2026 StatChat. All rights reserved.
-- Unauthorized copying, modification or distribution of this software
-- or its documentation is prohibited.

-- 039_anon_policy_column_grants.sql
-- ============================================================================
-- THE REST OF THE PUBLIC RECAP FIX. 038 was necessary and not sufficient.
--
-- After 038 the anon role could read `games` -- confirmed against the live
-- database, a real row came back. The share link still failed, because the
-- page does not only read `games`. Measured as anon, with the publishable
-- key, after 038:
--
--   GET /rest/v1/games?select=id,tenant_id   ->  200, a row
--   GET /rest/v1/plays?select=id             ->  401
--   GET /rest/v1/game_rosters?select=id      ->  401
--   GET /rest/v1/teams?select=primary_color  ->  401
--
-- ============================================================================
-- WHY READING `plays` FAILS WITH "permission denied for table GAMES"
--
-- The anon SELECT policies on plays, game_rosters, teams and tenants all
-- reach into games by subquery (sql/016_delete_tenant.sql):
--
--   using (exists (select 1 from public.games g
--                   where g.id = plays.game_id and g.status = 'final'
--                     and g.is_public = true and g.deleted_at is null
--                     and public.tenant_is_live(g.tenant_id)))
--
-- A policy expression is evaluated AS THE INVOKING ROLE. When that expression
-- touches a DIFFERENT table it is an ordinary cross-table reference and the
-- invoker's column privileges on that other table are checked normally. So
-- reading one row of `plays` requires anon to hold SELECT on games.id,
-- games.status, games.is_public, games.tenant_id AND games.deleted_at.
--
-- games.deleted_at has never been granted. Hence the error naming `games` on
-- a query that never mentioned games.
--
-- This is also why 038 alone looked like it worked and did not: a policy on
-- games referencing its OWN columns is not column-privilege checked -- that
-- check would make column grants and RLS impossible to combine -- so the
-- direct games query passed while every dependent table stayed denied.
--
-- The five columns anon policies need are id, status, is_public, tenant_id
-- and deleted_at. Four are granted. This grants the fifth.
--
-- ============================================================================
-- IS EXPOSING deleted_at A PROBLEM?
--
-- No, and less than 038 was. The anon policy on games is
--   status = 'final' and is_public = true and deleted_at is null
-- so the only rows anon can read are rows where this column IS NULL. The
-- grant lets the policy machinery read a value that is null in every row the
-- reader is permitted to see. A deleted game does not become visible; it
-- fails the policy exactly as before.
-- ============================================================================

begin;

grant select (deleted_at) on table public.games to anon;

-- ============================================================================
-- VERIFY -- runs inside the migration and prints a row. "No rows returned"
-- means nothing ran. Expect ONE ROW, all five true.
-- ============================================================================
select
  has_column_privilege('anon','public.games','id','SELECT')         as id_ok,
  has_column_privilege('anon','public.games','status','SELECT')     as status_ok,
  has_column_privilege('anon','public.games','is_public','SELECT')  as is_public_ok,
  has_column_privilege('anon','public.games','tenant_id','SELECT')  as tenant_id_ok,
  has_column_privilege('anon','public.games','deleted_at','SELECT') as deleted_at_ok;
-- Any false above is the column that will keep the recap link broken.

commit;

-- ============================================================================
-- AFTER RUNNING, TEST THE THING THAT WAS BROKEN, not the catalogue. In a
-- private window, signed out, open the share link. It must render the plays
-- and the school's colours -- both come from tables this grant unblocks.
--
-- tests/anon_recap_grant_check.js now reads every anon policy in sql/ and
-- fails if a policy references a column of games that anon cannot read.
-- That is the general form of this bug; 038 fixed only the instance of it
-- that recap.html's own select list made visible.
-- ============================================================================
