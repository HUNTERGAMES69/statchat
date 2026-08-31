-- =====================================================================
-- 025 DOWN  -- remove the lifetime subscription state
-- =====================================================================
-- Any row sitting at 'lifetime' has to go somewhere the old constraint
-- allows before that constraint can come back, or the ALTER fails and
-- leaves the table with no check at all. 'active' with no renewal date
-- is the closest honest equivalent: not billed, not lapsed.
-- =====================================================================

update public.tenants set subscription = 'active'
 where subscription = 'lifetime';

alter table public.tenants drop constraint if exists tenants_lifetime_has_no_renewal;

alter table public.tenants drop constraint if exists tenants_subscription_check;
alter table public.tenants add constraint tenants_subscription_check
  check (subscription = any (array['trial'::text,'active'::text,'lapsed'::text]));

comment on column public.tenants.subscription is null;

delete from public.schema_migrations where version = 25;
