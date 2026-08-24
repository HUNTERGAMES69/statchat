-- B. CONSTRAINTS AND INDEXES
select jsonb_pretty(jsonb_build_object(
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', rel.relname, 'name', con.conname,
      'type', case con.contype when 'p' then 'primary key' when 'f' then 'foreign key'
                               when 'u' then 'unique' when 'c' then 'check'
                               when 'x' then 'exclude' else con.contype::text end,
      'definition', pg_get_constraintdef(con.oid)) order by rel.relname, con.conname), '[]'::jsonb)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', indexname, 'definition', indexdef)
      order by tablename, indexname), '[]'::jsonb)
    from pg_indexes where schemaname = 'public')
)) as capture;
