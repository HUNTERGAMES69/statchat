-- DOWN for 017_drop_stale_tenant_branding.sql
--
-- Restores the columns AND repopulates them from `teams`, which is where
-- the live values are. Restoring them empty would recreate the original
-- fault -- a column that exists, reads as null, and quietly means
-- "nobody set a logo" when somebody did.
alter table public.tenants add column if not exists logo_url text;
alter table public.tenants add column if not exists primary_color text;
alter table public.tenants add column if not exists secondary_color text;

update public.tenants t
   set logo_url        = s.logo_url,
       primary_color   = s.primary_color,
       secondary_color = s.secondary_color
  from (select distinct on (tenant_id) tenant_id, logo_url, primary_color, secondary_color
          from public.teams order by tenant_id, created_at) s
 where s.tenant_id = t.id;

delete from public.schema_migrations where version = 17;
