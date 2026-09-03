-- diagnose_anon_writes.sql
-- ============================================================================
-- Copyright 2026 StatChat. All rights reserved. Unauthorized copying,
-- modification or distribution of this software or its documentation is
-- prohibited.
-- ============================================================================
-- THE ONE QUESTION WORTH ASKING, asked properly and only once.
--
-- Not "does a policy mention anon" -- three of them do, deliberately, so
-- that a shared recap opens without an account. The question is whether an
-- unauthenticated request can WRITE anything, anywhere in public.
--
-- A write needs BOTH a grant and a permissive policy for the role. Row 1
-- checks the policy half across every table in the schema, which is the
-- half that was never audited by table name. Read only, one result set.
-- ============================================================================

select 'no policy anywhere in public lets anon write' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL -- read Part A of the other file' end as result,
       coalesce(string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', '), 'none') as detail
  from pg_policies
 where schemaname = 'public'
   and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   and permissive = 'PERMISSIVE'
   and 'anon' = any(roles)

union all

-- The `TO public` case, which is the one that catches people out: a policy
-- with no TO clause applies to every role including anon, and only its
-- predicate holds anon out. Any such policy whose predicate does NOT
-- mention auth.uid() or a role lookup deserves reading.
select 'every TO public write policy is gated on the caller''s identity',
       case when count(*) = 0 then 'PASS' else 'FAIL -- listed' end,
       coalesce(string_agg(tablename || '.' || policyname, ', '), 'none')
  from pg_policies
 where schemaname = 'public'
   and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   and permissive = 'PERMISSIVE'
   and 'public' = any(roles)
   and coalesce(qual, '') not like '%auth.uid()%'
   and coalesce(with_check, '') not like '%auth.uid()%'

union all

-- The five tables with no anon write grant at all, named rather than
-- counted -- the previous check guessed there would be two and there are
-- five, which is better than expected and worth seeing rather than
-- assuming.
select 'tables with NO anon write grant',
       'INFO',
       coalesce(string_agg(t.table_name, ', ' order by t.table_name), 'none')
  from information_schema.tables t
 where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
   and not exists (
     select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = t.table_name
        and g.grantee = 'anon'
        and g.privilege_type in ('INSERT','UPDATE','DELETE'))

union all

-- And confirmation that RLS is on for every table in public, which is what
-- makes the default grants inert everywhere rather than just on the four
-- already checked. A table with grants and NO RLS is the real hole shape.
select 'RLS is enabled on every table in public',
       case when count(*) filter (where not c.relrowsecurity) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(c.relname, ', ') filter (where not c.relrowsecurity),
                'all ' || count(*)::text || ' tables have RLS on')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';
