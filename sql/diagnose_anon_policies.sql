-- diagnose_anon_policies.sql
-- ============================================================================
-- Copyright 2026 StatChat. All rights reserved. Unauthorized copying,
-- modification or distribution of this software or its documentation is
-- prohibited.
-- ============================================================================
-- The three policies that name anon: what do they actually permit?
--
-- Anonymous READ on games, plays and tenant branding is the public recap
-- and the share link -- recap.html needs no account, which is the point of
-- it. So "a policy names anon" is not a finding on its own; "a policy lets
-- anon WRITE" would be. The previous check asserted the first and called
-- it the second.
--
-- Part A prints them verbatim. Part B is the question that matters, asked
-- across the whole schema rather than four tables. Read only.
-- ============================================================================

-- ---- PART A: every policy anywhere in public that names anon -------------
select tablename,
       policyname,
       cmd,
       permissive,
       roles::text                    as applies_to_roles,
       coalesce(qual, '(none)')       as using_expression,
       coalesce(with_check, '(none)') as with_check_expression
  from pg_policies
 where schemaname = 'public'
   and 'anon' = any(roles)
 order by cmd, tablename, policyname;
