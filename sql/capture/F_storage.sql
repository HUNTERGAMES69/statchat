-- F. STORAGE BUCKETS AND THEIR POLICIES
-- A bucket and its policies are schema: they differ between instances and
-- are set by clicking, which is exactly the category the 15 Aug rule names.
select jsonb_pretty(jsonb_build_object(
  'buckets', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from storage.buckets b),
  'storage_policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'roles', roles,
      'command', cmd, 'using', qual, 'with_check', with_check)
      order by tablename, policyname), '[]'::jsonb)
    from pg_policies where schemaname = 'storage')
)) as capture;
