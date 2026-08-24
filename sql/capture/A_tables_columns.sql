-- A. TABLES AND COLUMNS
select jsonb_pretty(coalesce(jsonb_agg(t order by t->>'table'), '[]'::jsonb)) as capture
from (
  select jsonb_build_object(
    'table', c.relname,
    'kind',  case c.relkind when 'r' then 'table' when 'p' then 'partitioned' when 'v' then 'view'
                            when 'm' then 'matview' else c.relkind::text end,
    'rls_enabled', c.relrowsecurity,
    'rls_forced',  c.relforcerowsecurity,
    'comment', obj_description(c.oid, 'pg_class'),
    'columns', (
      select jsonb_agg(jsonb_build_object(
        'n', a.attnum, 'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'notnull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid),
        'identity', nullif(a.attidentity, ''),
        'generated', nullif(a.attgenerated, ''),
        'comment', col_description(c.oid, a.attnum)) order by a.attnum)
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
  ) as t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
) s;
