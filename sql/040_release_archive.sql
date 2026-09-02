-- Copyright 2026 StatChat. All rights reserved.
-- Unauthorized copying, modification or distribution of this software
-- or its documentation is prohibited.

-- 040_release_archive.sql
-- ============================================================================
-- SHELVING A NOTICE YOU ARE DONE WITH.
--
-- releases.js only grows. Every note ever written stays in the file, because
-- the id is what "I have read this" is recorded against and deleting one
-- would orphan every profiles.last_seen_release pointing at it. So the
-- console list grows too, and the notes that still need a decision get harder
-- to find among the ones already sent or deliberately never sent.
--
-- Archiving is a CONSOLE-SHELF action. It changes what Andy sees on this
-- page and nothing else: not the file, not what a coach reads, not who has
-- dismissed what.
--
-- ============================================================================
-- ARCHIVING A LIVE NOTE IS REFUSED, and that is the whole design.
--
-- Andy's call, 2 Sep 2026. The alternative -- archive hides it from the
-- console and leaves it published -- creates a note live on 31 schools'
-- dashboards that its author can no longer see. That is the same family as
-- `is_broadcast` and `status = 'in_progress'`: a state that means "until
-- somebody acts" wearing the face of a state that means "right now", and a
-- feature nobody can tell is on.
--
-- So the API refuses to archive a note whose published_at is set, and says
-- to take it down first. Two visible acts instead of one silent one.
--
-- Nothing here enforces that: it is a rule about what the console shows, and
-- it lives in api/send-release.js where the decision is made. This migration
-- only provides somewhere to write it down.
-- ============================================================================

begin;

alter table public.release_state
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

comment on column public.release_state.archived_at is
  'Shelved from the platform console. Cosmetic to that page only; it does not affect dashboards, and a published note cannot be archived (api/send-release.js refuses it).';
comment on column public.release_state.archived_by is
  'Which platform admin shelved it.';

-- ============================================================================
-- VERIFY -- runs inside the migration and prints a row.
-- "No rows returned" means nothing ran. Expect ONE ROW: 2, then true.
-- ============================================================================
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'release_state'
      and column_name in ('archived_at','archived_by'))          as new_columns,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'release_state'
      and column_name in ('release_id','published_at','emailed_at')) = 3
                                                                  as existing_intact;
-- EXPECT: new_columns = 2, existing_intact = true.

commit;

notify pgrst, 'reload schema';
