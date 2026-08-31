-- =====================================================================
-- 025  LIFETIME TENANTS
-- =====================================================================
-- Some tenants are never going to be billed: StatChat's own, and the
-- school whose people helped design the thing. Before this there was no
-- way to say so. Their rows sat at subscription='trial' with no renewal
-- date, which is indistinguishable from a customer nobody has invoiced
-- yet -- so every screen that chases an unpaid season would have chased
-- them, forever, and the person reading the console had to remember
-- which two rows to ignore.
--
-- A STATE, NOT A FLAG. The obvious alternative was a boolean beside
-- is_demo. It was rejected because `subscription` would still have to
-- hold something, and a row reading is_lifetime=true with
-- subscription='trial' has two columns answering the same question and
-- disagreeing. Lifetime is not a property of a subscription; it IS the
-- subscription. A CHECK constraint that enumerates states is exactly the
-- thing you extend when a state is added.
--
-- WHAT IT MEANS EVERYWHERE ELSE:
--   * renews_on is NULL and stays null. There is nothing to renew, and a
--     date on a lifetime row would eventually pass and start warning.
--   * No expiry warning, on the console or on the school's own Account
--     page, ever.
--   * It does NOT grant anything. Access is unaffected -- a lifetime
--     tenant that is suspended is still suspended, because disabled_at
--     remains the only thing that stops a write (014). Suspended
--     outranks lifetime on every screen, for the same reason it outranks
--     'active': a status line that reads Lifetime beside an account that
--     cannot write is lying about the one thing it is read to find out.
--
-- Reversible: 025_lifetime_tenants_DOWN.sql puts the old constraint back,
-- after moving any lifetime rows to 'active'.
-- =====================================================================

alter table public.tenants drop constraint if exists tenants_subscription_check;

alter table public.tenants add constraint tenants_subscription_check
  check (subscription = any (array['trial'::text,'active'::text,'lapsed'::text,'lifetime'::text]));

-- BELT AND BRACES on the pairing above. Nothing in the application sets a
-- renewal date on a lifetime row, but the application is not the only
-- thing that can write here -- this migration exists precisely because
-- somebody was editing these rows by hand.
alter table public.tenants drop constraint if exists tenants_lifetime_has_no_renewal;
alter table public.tenants add constraint tenants_lifetime_has_no_renewal
  check (subscription <> 'lifetime' or renews_on is null);

comment on column public.tenants.subscription is
  'trial | active | lapsed | lifetime. Lifetime means never billed - StatChat''s own tenant and the design partners. It grants no access of its own: disabled_at is still the only thing that stops a write.';

insert into public.schema_migrations (version, name)
values (25, '025_lifetime_tenants') on conflict (version) do nothing;
