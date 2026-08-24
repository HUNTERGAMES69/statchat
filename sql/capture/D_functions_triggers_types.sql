-- D. FUNCTIONS, TRIGGERS, TYPES, SEQUENCES
select jsonb_pretty(jsonb_build_object(
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'security_definer', p.prosecdef,
      'definition', pg_get_functiondef(p.oid)) order by p.proname), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f','p')),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid)) order by c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal),
  'types', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', tt.typname,
      'values', (select jsonb_agg(e.enumlabel order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = tt.oid)) order by tt.typname), '[]'::jsonb)
    from pg_type tt join pg_namespace n on n.oid = tt.typnamespace
    where n.nspname = 'public' and tt.typtype = 'e'),
  'sequences', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', sequence_name, 'type', data_type, 'start', start_value, 'increment', increment)
      order by sequence_name), '[]'::jsonb)
    from information_schema.sequences where sequence_schema = 'public')
)) as capture;
