-- =====================================================================
-- AUDIT — anything one school can use up on another's behalf
-- =====================================================================
-- READ ONLY. Changes nothing. Run it in the Supabase SQL editor after any
-- migration that adds an index, a table, or a policy.
--
-- Written 31 Aug 2026 after "duplicate key value violates unique
-- constraint games_tenant_designator_key" was hit in Neville -- the third
-- appearance of one shape of fault. 010 fixed two of them; 027 fixed the
-- third.
--
-- THE FAULT: a UNIQUE key on a school's data where the key does not
-- reach a tenant. One school then consumes a value for everybody, and the
-- second gets an error naming a row it cannot see.
--
-- FIRST VERSION OF THIS FILE FLAGGED SEVEN THINGS THAT WERE FINE -- every
-- primary key, because it only looked for the literal string tenant_id.
-- A report that cries wolf teaches you to skip it, so this one classifies
-- properly and was tested against a real Postgres 16 with both a healthy
-- schema and the actual historical faults reinstated. On a correct
-- schema, sections 1's REVIEW lines and sections 2-4 are all empty.
-- =====================================================================

-- 1. EVERY UNIQUE KEY ON A SCHOOL'S DATA, AND WHETHER IT IS SCOPED ------
with scoped as (
  select c.oid, c.relname,
         exists (select 1 from information_schema.columns col
                  where col.table_schema = 'public' and col.table_name = c.relname
                    and col.column_name = 'tenant_id') as has_tenant
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
idx as (
  select c.relname as table_name, i.relname as index_name,
         x.indexrelid, x.indrelid, x.indisprimary,
         x.indkey::int2[] as keycols,
         pg_get_indexdef(x.indexrelid) as def,
         (select array_agg(a.attname order by k.ord)
            from unnest(x.indkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum) as colnames,
         -- A surrogate uuid key is generated per row. It cannot be taken.
         (select bool_and(t.typname = 'uuid')
            from unnest(x.indkey) k2(attnum)
            join pg_attribute a2 on a2.attrelid = x.indrelid and a2.attnum = k2.attnum
            join pg_type t on t.oid = a2.atttypid) as all_uuid,
         array_length(x.indkey::int2[], 1) as ncols
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class c on c.oid = x.indrelid
    join scoped s on s.oid = c.oid
   where x.indisunique
),
classified as (
  select idx.*,
         -- TRANSITIVE SCOPING, which the first version missed: plays are
         -- keyed by (game_id, sequence_number) and never mention a
         -- tenant, but game_id points at a row that has one, so two
         -- schools can never collide.
         exists (select 1 from pg_constraint fk
                  where fk.conrelid = idx.indrelid and fk.contype = 'f'
                    and fk.conkey && idx.keycols
                    and exists (select 1 from scoped s2
                                 where s2.oid = fk.confrelid
                                   and (s2.has_tenant or s2.relname = 'tenants'))) as reaches_tenant
    from idx
)
select table_name, index_name, array_to_string(colnames, ', ') as key_columns,
  case
    when reaches_tenant
      then 'scoped - the key includes tenant_id, or a reference to a tenant-scoped row'
    when indisprimary and ncols = 1 and all_uuid
      then 'scoped - a generated uuid primary key; every row gets its own and none can be taken'
    -- Named by COLUMN, not by index name: rename one of these and it
    -- flags, which is the safe direction to fail in.
    when colnames = array['feed_key']::name[]
      then 'EXPECTED global - an overlay key is the caller''s whole identity'
    when colnames = array['share_token']::name[]
      then 'EXPECTED global - a share token is a public URL secret'
    else '*** REVIEW *** global: one school can consume this value for every other school'
  end as verdict,
  def as definition
from classified
order by 4 desc, table_name, index_name;

-- 2. TENANT-SCOPED TABLES WITH RLS OFF ---------------------------------
-- A policy that is not enforced is a comment. Should return nothing.
select c.relname as table_name,
       '*** REVIEW *** carries tenant_id but row level security is DISABLED' as verdict
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
   and exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = c.relname
                  and col.column_name = 'tenant_id');

-- 3. RLS ON, NO POLICIES -----------------------------------------------
-- Safe (everything is denied) but almost always means something was
-- missed. Should return nothing.
select c.relname as table_name,
       'RLS on, but no policies - every read and write is denied' as verdict
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = c.relname
                  and col.column_name = 'tenant_id')
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname);

-- 4. ROWS THAT WOULD BREAK THE DESIGNATOR KEY --------------------------
-- Should be empty; if 027 is applied it cannot be otherwise.
select tenant_id, season_year, designator, count(*) as rows
  from public.games
 where deleted_at is null
 group by 1, 2, 3
having count(*) > 1;
