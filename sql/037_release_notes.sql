-- 037_release_notes.sql
-- ============================================================================
-- TELLING PEOPLE WHAT CHANGED -- AND DECIDING WHEN.
--
-- StatChat has shipped features all season with no way to tell anyone. A coach
-- finds the broadcast starters section by stumbling into it, or never.
--
-- ============================================================================
-- THE CONTENT IS A FILE. THE DECISION TO SHOW IT IS A ROW.
--
-- The notes live in `releases.js` in the repo. Every feature already ships as
-- a file upload; the note describing it rides in the same batch, so the note
-- and the thing it describes go live together or not at all.
--
-- But uploading a file must NOT be what publishes it. Andy, 2 Sep 2026: "does
-- it just show up if new things are in the uploaded notes file? I don't know
-- if i like that." He is right not to. Uploading is how the app is deployed --
-- it happens for bug fixes, for a stylesheet change, for anything -- and an
-- act that routine should not also be the act that speaks to every customer.
--
-- So a note in the file is a DRAFT. It reaches nobody until a platform admin
-- presses Publish, which writes the row below. Two separate deliberate acts,
-- and the second one is only ever taken on purpose.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists last_seen_release text,
  -- CAN-SPAM. Product news is marketing, not transactional: a person must be
  -- able to stop receiving it. PER PERSON, not per school -- one admin opting
  -- out must not silence the others. Opting out of email does NOT hide the
  -- in-app card, which is the point of having both.
  add column if not exists release_email_opt_out boolean not null default false;

comment on column public.profiles.last_seen_release is
  'Newest release id from releases.js this person has dismissed. Notes newer than it are unread. NULL = has never dismissed one.';
comment on column public.profiles.release_email_opt_out is
  'This person has asked not to receive release emails. Does not affect the in-app card.';

-- ============================================================================
-- ONE ROW PER RELEASE, HOLDING THE TWO DECISIONS
--
--   published_at  the note is live on dashboards. Reversible.
--   emailed_at    the note has been mailed. NOT reversible, and its only job
--                 is to make a second press a no-op: a duplicate
--                 announcement to every school cannot be taken back.
--
-- A release with no row here has been written and not published. That is the
-- normal state of a fresh upload.
-- ============================================================================
create table if not exists public.release_state (
  release_id      text primary key,
  published_at    timestamptz,
  published_by    uuid references auth.users(id) on delete set null,
  emailed_at      timestamptz,
  emailed_by      uuid references auth.users(id) on delete set null,
  recipient_count integer not null default 0
);

alter table public.release_state enable row level security;

-- EVERY SIGNED-IN USER READS THIS, because every dashboard has to ask "which
-- notes are live". The table holds release ids and timestamps -- no tenant
-- data, no personal data, nothing one school could learn about another.
drop policy if exists release_state_select on public.release_state;
create policy release_state_select on public.release_state
  for select to authenticated using (true);

-- NO INSERT OR UPDATE POLICY, deliberately. Only api/send-release.js writes
-- here, under the service role. A browser that could write this row could
-- publish a note to every customer, or mark a release emailed without
-- emailing it -- which reads as "already done" and suppresses the
-- announcement for good.

grant select on table public.release_state to authenticated;
grant all    on table public.release_state to service_role;

commit;

-- ============================================================================
-- CHECK
--
--   select column_name from information_schema.columns
--    where table_name = 'profiles'
--      and column_name in ('last_seen_release','release_email_opt_out');
--   -- expect 2 rows
--
--   select count(*) from public.release_state;   -- expect 0: nothing published yet
-- ============================================================================
