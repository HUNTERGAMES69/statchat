-- 023_tenant_sponsor_bar.sql
-- ============================================================================
-- WHO GETS THE SPONSOR BAR, DECIDED BY THE SERVER.
--
-- broadcast_stats.html carries a black bar across the top with a sponsor's
-- domain, logo and phone number hardcoded into it. It was built during
-- development for one school and shipped to every tenant, which is wrong in
-- a multi-tenant product: another school's broadcast should not be carrying
-- somebody else's sponsor.
--
-- ============================================================================
-- WHY A COLUMN RATHER THAN A URL PARAMETER
--
-- The obvious fix is to default the bar off and turn it on with something
-- like ?sponsor=nettech. That hides it; it does not restrict it. Anyone who
-- sees the parameter can add it to their own overlay URL and put another
-- school's sponsor on their broadcast.
--
-- api/gamedata.js already resolves the tenant FROM THE OVERLAY KEY and
-- validates it -- an overlay is a browser source in vMix with no session, so
-- the key is the only identity it has. Reading the flag there means it
-- arrives with data that could only be fetched by a caller holding that
-- tenant's key. A URL cannot override it.
--
-- ============================================================================
-- WHY A BOOLEAN AND NOT THE SPONSOR'S DETAILS
--
-- Storing the domain, image and phone here would be the start of a sponsor
-- FEATURE -- letting any school configure their own. Nobody has asked for
-- that, and designing it now means guessing at what it needs.
--
-- This column answers the only question being asked today: does this tenant
-- see the bar that already exists. Turning it on for a second school later
-- is an UPDATE. Making the bar configurable is a separate piece of work that
-- this does not block.
-- ============================================================================

alter table public.tenants
  add column if not exists sponsor_bar boolean not null default false;

comment on column public.tenants.sponsor_bar is
  'Show the sponsor banner on broadcast_stats.html for this tenant. Default '
  'FALSE: the banner is hardcoded to one school''s sponsor, so every other '
  'tenant must not see it. Read by api/gamedata.js, which resolves the tenant '
  'from the overlay key -- so a URL parameter cannot switch it on.';

-- Neville, the school the bar was built for. Matched by name because the
-- tenant id differs between environments; if the name has changed, this
-- updates nothing and the flag stays false, which is the safe direction.
update public.tenants set sponsor_bar = true where name = 'Neville';

insert into public.schema_migrations (version, name)
values (23, '023_tenant_sponsor_bar') on conflict (version) do nothing;
