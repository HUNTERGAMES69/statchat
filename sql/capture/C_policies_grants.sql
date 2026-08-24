-- C. RLS POLICIES AND GRANTS
select jsonb_pretty(jsonb_build_object(
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname,
      'permissive', permissive, 'roles', roles, 'command', cmd,
      'using', qual, 'with_check', with_check) order by tablename, policyname), '[]'::jsonb)
    from pg_policies where schemaname = 'public'),
  'table_grants', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type)
      order by table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC')),
  'column_grants', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'grantee', grantee, 'privilege', privilege_type)
      order by table_name, column_name, grantee), '[]'::jsonb)
    from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC'))
)) as capture;
