-- DOWN for 013_create_tenant.sql
-- Drops the function only. Schools already created keep their rows: a
-- down script for a creation tool must not delete what it created.
drop function if exists public.create_tenant(text, text, integer);
delete from public.schema_migrations where version = 13;
