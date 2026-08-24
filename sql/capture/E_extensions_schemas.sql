-- E. EXTENSIONS AND SCHEMAS
select jsonb_pretty(jsonb_build_object(
  'extensions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', e.extname, 'schema', n.nspname, 'version', e.extversion) order by e.extname), '[]'::jsonb)
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace),
  'schemas', (
    select coalesce(jsonb_agg(nspname order by nspname), '[]'::jsonb)
    from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'),
  'roles', (
    select coalesce(jsonb_agg(rolname order by rolname), '[]'::jsonb)
    from pg_roles where rolname not like 'pg_%')
)) as capture;
