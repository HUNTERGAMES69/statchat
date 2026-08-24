-- DOWN for 007_tenant_defaults.sql
--
-- Dropping a default cannot fail and cannot lose data: rows already
-- inserted keep the value the default gave them. What it DOES mean is
-- that every insert must supply tenant_id again from the moment this
-- runs — so if 007 is reverted while the app is live, saves start
-- failing on the NOT NULL constraint.
--
-- That is the correct behaviour and worth stating: there is no state in
-- which a tenant_id is quietly wrong. It is either supplied, defaulted,
-- or refused.
alter table public.games        alter column tenant_id drop default;
alter table public.plays        alter column tenant_id drop default;
alter table public.players      alter column tenant_id drop default;
alter table public.game_rosters alter column tenant_id drop default;

delete from public.schema_migrations where version = 7;
