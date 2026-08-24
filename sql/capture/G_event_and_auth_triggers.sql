-- G. EVENT TRIGGERS AND TRIGGERS OUTSIDE public
-- Two things D missed, both found by reading D's own output:
--   * rls_auto_enable() RETURNS event_trigger. The FUNCTION was captured;
--     the EVENT TRIGGER that fires it is a database-wide object in
--     pg_event_trigger, not in any schema, so D never saw it. A baseline
--     without it silently loses the rule that new public tables get RLS
--     turned on automatically.
--   * create_profile_for_new_user() is a trigger function with no trigger
--     on any public table -- it hangs off auth.users, and D was scoped to
--     public. Without it a rebuilt database creates no profile row on
--     signup, and every new user is left with no role.
select jsonb_pretty(jsonb_build_object(
  'event_triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', evtname, 'event', evtevent, 'enabled', evtenabled,
      'tags', evttags, 'function', p.proname) order by evtname), '[]'::jsonb)
    from pg_event_trigger et join pg_proc p on p.oid = et.evtfoid),
  'triggers_outside_public', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid)) order by n.nspname, c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname not in ('public','pg_catalog','information_schema'))
)) as capture;
