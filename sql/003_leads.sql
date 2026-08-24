-- =====================================================================
-- 003 — leads: enquiries from the public site
--
-- The brochure's contact form posts to /api/contact, which inserts here
-- with the service key. Storing them in our own database rather than
-- using a third-party form service means no new account, no data sitting
-- with a vendor, and nothing to renew.
--
-- NOT a tenant table. These are people who do not have an account yet,
-- which is the whole point of the form, so nothing here gets a tenant id
-- when multi-tenancy lands.
-- =====================================================================

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  organization text,
  message     text,
  -- What the form could observe without asking. Useful for telling a
  -- real enquiry from a bot run, and for knowing which page sent them.
  source      text,
  user_agent  text,
  -- Set by the endpoint when a submission trips a spam check. Kept
  -- rather than dropped: a false positive is a lost customer, and the
  -- only way to find out the filter is too strict is to be able to look.
  flagged     boolean not null default false,
  handled     boolean not null default false
);

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_unhandled_idx on public.leads (created_at desc) where not handled;

-- LOCKED DOWN. Every other table in this schema carries Supabase's
-- default wide grants with RLS as the gate; this one gets neither.
-- Writes arrive only through /api/contact using the service key, which
-- bypasses RLS, so no role needs a grant and no policy needs to exist.
-- RLS on with zero policies denies everyone else outright.
--
-- This matters more than it looks: the rows are names and email
-- addresses of people who have not consented to anything beyond being
-- contacted back. `anon` must never be able to read them, and the
-- default grants would have allowed exactly that once a policy existed.
alter table public.leads enable row level security;
revoke all on table public.leads from anon, authenticated;

comment on table public.leads is
  'Enquiries from the public brochure form. Written by /api/contact with the service key. Read from the SQL editor.';

-- Last statement, per sql/README.md: a migration that records itself
-- before doing the work leaves a lie behind when it fails halfway.
insert into public.schema_migrations (version, name) values (3, '003_leads')
on conflict (version) do nothing;
