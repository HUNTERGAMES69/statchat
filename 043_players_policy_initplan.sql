-- Copyright 2026 StatChat. All rights reserved.
-- Unauthorized copying, modification or distribution of this software
-- or its documentation is prohibited.

-- 043_players_policy_initplan.sql
-- ============================================================================
-- THE DASHBOARD'S 3.6-SECOND QUERY.
--
-- Measured in Andy's browser, 2 Sep 2026, from performance.getEntriesByType:
--
--     /storage/v1/obj...      704ms start    318ms
--     /rest/v1/profiles...    705ms start    268ms
--     /rest/v1/games?...      974ms start    250ms
--     /rest/v1/release...     974ms start    827ms
--     /rest/v1/teams?...      975ms start    820ms
--     /rest/v1/players...     975ms start   3591ms   <-- this one
--     /rest/v1/tenants...     975ms start    839ms
--
-- Seven calls fire together (the boot fix works). Six finish inside a second.
-- One runs for three and a half, and 975 + 3591 = 4.6s is the pause.
--
-- The query is the dashboard's roster count:
--     .from('players').select('id', { count: 'exact', head: true })
--
-- ============================================================================
-- WHY A COUNT OF SIXTY-FIVE ROWS TAKES THREE AND A HALF SECONDS
--
-- players_select (sql/009_tenant_rls.sql) reads:
--
--     using (tenant_id = public.current_tenant_id() or public.is_super_admin())
--
-- Both helpers are correctly `stable security definer`. That is NOT enough.
-- STABLE lets the planner cache a call within a scan; it does not hoist the
-- call out of a row filter. And the OR makes the whole predicate
-- unindexable, so Postgres sequentially scans every player row ON THE
-- PLATFORM and evaluates both functions for each one -- each of which is
-- itself a lookup into `profiles`.
--
-- Reproduced on PostgreSQL 16 with 32 schools and 2,080 players, which is
-- roughly the live shape:
--
--   Aggregate
--     Buffers: shared hit=8210
--     ->  Seq Scan on players  (actual rows=65)
--           Filter: ((tenant_id = current_tenant_id()) OR is_super_admin())
--           Rows Removed by Filter: 2015
--   Execution Time: 35.065 ms
--
-- 8,210 buffer reads to return 65 rows -- about 64 pages per row answered.
-- 35ms on a warm local socket; on a shared instance across a network, the
-- 3.6s Andy measured.
--
-- ============================================================================
-- THE FIX: SAME FUNCTIONS, EVALUATED ONCE
--
-- Wrapping a call in a scalar subquery makes it an InitPlan -- computed once
-- before the scan, then compared as a constant:
--
--   Aggregate
--     Buffers: shared hit=119
--     InitPlan 1 (returns $0) -> Result
--     InitPlan 2 (returns $1) -> Result
--     ->  Seq Scan on players  (actual rows=65)
--           Filter: ($0 OR (tenant_id = $1))
--   Execution Time: 1.089 ms
--
--   35.065ms -> 1.089ms.   8,210 buffers -> 119.
--
-- (select f()) returns exactly what f() returns for a STABLE function, so
-- this changes no semantics whatsoever. Verified rather than asserted: with
-- 32 schools seeded, every one of the 32 users saw exactly the same 65 rows
-- under both policies, and a platform admin saw all 2,080 under the new one.
--
-- ============================================================================
-- WHY ONLY `players`, WHEN 28 POLICIES CARRY THIS
--
-- Every tenant-scoped policy in sql/009 has the same shape and the same
-- penalty. This migration deliberately fixes ONE TABLE.
--
-- The reason is not caution for its own sake. Several of those policies have
-- been REDEFINED by later migrations -- games_select gained `deleted_at is
-- null` in 012, the tenant policies were rewritten again in 016 -- so
-- retyping them from 009's text would silently revert those changes and put
-- deleted games back in front of customers. A safe sweep has to derive each
-- new expression from the LIVE catalog (pg_policies), not from a file, and
-- that is a separate piece of work that deserves its own testing.
--
-- players_select and players_write appear ONLY in sql/009 and sql/000. There
-- is no later definition to lose, which is what makes rewriting them by hand
-- safe here and unsafe elsewhere.
--
-- The measured effect of this one change should be visible on its own: if
-- the ~820ms readings on teams, tenants and release_state were queueing
-- behind the 3.6s players call, they drop too. If they do not, they need
-- the same treatment and we will know that rather than guess it.
-- ============================================================================

begin;

-- ALTER, not drop-and-create: the policy is never absent, not even for the
-- instant inside this transaction, and nothing else about it changes.
alter policy players_select on public.players
  using ((select public.is_super_admin())
         or tenant_id = (select public.current_tenant_id()));

-- The write path has the same trap. Rarely hit from the dashboard, but a
-- roster save walks it, and it is the same table with the same provenance.
alter policy players_write on public.players
  using      ((select public.current_user_role()) = 'admin'
              and ((select public.is_super_admin())
                   or tenant_id = (select public.current_tenant_id())))
  with check ((select public.current_user_role()) = 'admin'
              and ((select public.is_super_admin())
                   or tenant_id = (select public.current_tenant_id())));

-- ============================================================================
-- VERIFY -- runs inside the migration and prints a row.
-- "No rows returned" means nothing ran. Expect ONE ROW, all true.
--
-- The test is that each expression now contains a SELECT -- that is what an
-- InitPlan looks like in pg_policies -- and that both policies still exist.
-- ============================================================================
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'players')            = 2  as both_policies_present,
  (select qual  from pg_policies where policyname = 'players_select') like '%SELECT%'
                                                                            as select_is_initplan,
  (select qual  from pg_policies where policyname = 'players_write')  like '%SELECT%'
                                                                            as write_using_is_initplan,
  (select with_check from pg_policies where policyname = 'players_write') like '%SELECT%'
                                                                            as write_check_is_initplan;
-- EXPECT: true, true, true, true.

commit;

-- ============================================================================
-- AFTER RUNNING, MEASURE THE THING THAT WAS REPORTED, not the catalogue.
-- Reload the dashboard and run this in the browser console:
--
--   console.table(performance.getEntriesByType('resource')
--     .filter(r=>r.name.includes('supabase.co'))
--     .map(r=>({path:r.name.replace(/^https:\/\/[^/]+/,'').slice(0,58),
--               start:Math.round(r.startTime), ms:Math.round(r.duration)})))
--
-- The /rest/v1/players row should drop from ~3600ms to the same range as its
-- neighbours. If it does not, the cause is elsewhere and this was not it.
-- ============================================================================
