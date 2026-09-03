-- 045_feedback.sql
-- ============================================================================
-- Copyright 2026 StatChat. All rights reserved. Unauthorized copying,
-- modification or distribution of this software or its documentation is
-- prohibited.
-- ============================================================================
-- BUG REPORTS AND FEATURE REQUESTS FROM INSIDE THE APP
--
-- A signed-in user opens the form from the account page, picks bug or
-- feature, types a title and a description, and submits. /api/feedback
-- writes the row here with the service key and then emails support@ or
-- features@ depending on which they chose.
--
-- ============================================================================
-- WHY A TABLE AND NOT JUST AN EMAIL
--
-- The email is best-effort and always will be. It can fail because the
-- Resend key is missing or rotated, because Resend is down or rate
-- limiting, because DKIM for statchat.co lapsed, or because a Vercel
-- function timed out on a cold start. None of those are visible to the
-- person who has just typed three paragraphs, and both ways of handling
-- it are bad: tell them it failed and they have lost what they wrote, or
-- tell them it worked when it did not.
--
-- So the row is the record and the email is a notification on top of it,
-- exactly as public.leads and /api/contact already work. If the send
-- fails, the request is still here:
--
--     select created_at, kind, tenant_name, user_email, title, body
--       from feedback where not handled order by created_at desc;
--
-- The `notified` column says whether the email actually left, so a
-- Resend outage is visible afterwards rather than silent:
--
--     select * from feedback where not notified and not handled;
--
-- ============================================================================
-- WHAT THIS MIGRATION DOES NOT DO -- worth checking before you run it
--
-- It does not touch a single existing object. No alter table, no index on
-- an existing table, no data movement, nothing in the scoring path.
--
-- In particular there is NO schema-wide grant here: no
-- `grant ... on all tables in schema public`, and no
-- `alter default privileges`. Those are the two statements that reach
-- every table you own, and neither appears below. Every grant and revoke
-- names public.feedback and nothing else.
-- ============================================================================

begin;

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- WHICH INBOX IT WENT TO, stored rather than derived. The routing lives
  -- in the endpoint today; if it ever changes, rows written before the
  -- change still say where they were actually sent.
  kind        text not null check (kind in ('bug', 'feature')),

  title       text not null,
  body        text not null,

  -- WHO SENT IT. Taken from the verified session on the server, never
  -- from the request body -- the same rule /api/invite-user follows for
  -- the tenant. A browser cannot claim to be somebody else.
  --
  -- on delete set null, not cascade: a request outlives the account that
  -- filed it. Deleting a user must not silently delete the bug report
  -- that led to a fix.
  user_id     uuid references public.profiles (id) on delete set null,
  tenant_id   uuid references public.tenants  (id) on delete set null,

  -- SNAPSHOTS, deliberately duplicated from the two tables above. A
  -- report is read weeks later, often after a user has left or a trial
  -- tenant has been deleted, and "who reported this" must still answer
  -- itself without a join to a row that may be gone.
  user_email  text,
  user_name   text,
  tenant_name text,

  -- Context the form can observe without asking for it. Half of bug
  -- triage is knowing the browser and the page.
  user_agent  text,
  source      text,

  -- Did the notification email actually leave? Set by the endpoint after
  -- Resend answers. false with a row present means the request arrived
  -- safely and nobody was told -- which is the case this table exists for.
  notified    boolean not null default false,

  handled     boolean not null default false
);

create index if not exists feedback_created_idx
  on public.feedback (created_at desc);
create index if not exists feedback_unhandled_idx
  on public.feedback (created_at desc) where not handled;
-- The rate-limit lookup in /api/feedback: this user, recently.
create index if not exists feedback_user_recent_idx
  on public.feedback (user_id, created_at desc);

-- LOCKED DOWN, the same posture as public.leads.
-- ---------------------------------------------------------------------
-- RLS on with ZERO policies denies every role outright. Writes arrive
-- only through /api/feedback using the service key, which bypasses RLS,
-- so no role needs a grant and no policy needs to exist.
--
-- The revoke is not redundant. Supabase's default privileges grant anon
-- and authenticated wide access to new tables in public, and those
-- grants become live the moment anybody adds a policy "just to let users
-- see their own". Taking them away now means that a future policy has to
-- grant deliberately rather than inherit silently.
--
-- These rows carry a user's email and free text they may have written
-- about their own school. `anon` must never read them.
alter table public.feedback enable row level security;
revoke all on table public.feedback from anon, authenticated;

comment on table public.feedback is
  'Bug reports and feature requests from the in-app form. Written by /api/feedback with the service key, read from the SQL editor. kind routes the notification: bug -> support@statchat.co, feature -> features@statchat.co.';
comment on column public.feedback.notified is
  'The notification email left successfully. false means the request is safely stored and nobody was emailed -- check these after any Resend outage.';
comment on column public.feedback.tenant_name is
  'Snapshot of the school name at submission. Deliberately duplicated: a request outlives the tenant row, and triage weeks later must not depend on a join that may no longer resolve.';

-- Last statement, per sql/README.md: a migration that records itself
-- before doing the work leaves a lie behind when it fails halfway.
insert into public.schema_migrations (version, name) values (45, '045_feedback')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- VERIFY -- returns rows, one result set
-- ============================================================================
-- ONE query, not five. The Supabase SQL editor shows only the LAST result
-- set, so separate SELECTs would run and their answers would be invisible.
--
-- Every row must read PASS. Row 4 is the important one: it asserts that
-- anon and authenticated hold NO privilege on this table, which is what
-- makes RLS-with-no-policies an actual lock rather than a formality.
--
-- Safe to re-run at any time; it reads catalogs and changes nothing.
-- ============================================================================

select 'feedback table exists' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result,
       count(*) as detail
  from pg_class
 where oid = to_regclass('public.feedback')

union all

select 'row level security is enabled',
       case when bool_or(relrowsecurity) then 'PASS' else 'FAIL' end,
       count(*) filter (where relrowsecurity)
  from pg_class
 where oid = to_regclass('public.feedback')

union all

select 'zero policies, so RLS denies everyone',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*)
  from pg_policies
 where schemaname = 'public' and tablename = 'feedback'

union all

select 'anon and authenticated hold no privilege',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'feedback'
   and grantee in ('anon', 'authenticated')

union all

select 'kind is constrained to bug or feature',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*)
  from pg_constraint
 where conrelid = to_regclass('public.feedback')
   and contype = 'c'
   and pg_get_constraintdef(oid) like '%kind%'

union all

-- THE CHECK THAT USED TO BE HERE WAS WRONG, and it is worth recording why
-- rather than quietly deleting it. It was labelled "nothing outside
-- public.feedback was touched" and asked whether `anon` holds
-- INSERT/UPDATE/DELETE on games, plays, profiles and tenants. It does, and
-- has since those tables were created: that is Supabase's default
-- privilege grant on public, with RLS as the actual gate. So it returned
-- FAIL, 12 -- four tables times three privileges -- on a migration that
-- granted nothing to anyone.
--
-- The label and the query were asking different questions. Postgres keeps
-- no DDL timestamp, so "did this migration touch anything else" cannot be
-- answered from the catalogs at all; the way to establish it is to read
-- the statements, every one of which names public.feedback.
--
-- Replaced with a check that the query can actually support: the default
-- grants that DO land on a new table were taken off this one. Row 4 above
-- proves the revoke worked; this proves it was needed, which is the same
-- fact from the other side.
select 'RLS is on for the four core tables, so their default grants are inert',
       case when count(*) filter (where relrowsecurity) = 4 then 'PASS' else 'FAIL' end,
       count(*) filter (where relrowsecurity)
  from pg_class
 where oid in (to_regclass('public.games'), to_regclass('public.plays'),
               to_regclass('public.profiles'), to_regclass('public.tenants'))

union all

select 'migration recorded',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*)
  from public.schema_migrations
 where version = 45;
