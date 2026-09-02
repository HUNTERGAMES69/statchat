-- Copyright 2026 StatChat. All rights reserved.
-- Unauthorized copying, modification or distribution of this software
-- or its documentation is prohibited.

-- 042_mfa_prompt_expiry.sql
-- ============================================================================
-- THE TWO-FACTOR STEP STOPS NAGGING AFTER TEN DAYS.
--
-- Andy, 2 Sep 2026: "Doesn't look like any of the admins are going to setup
-- 2FA, and we can't force it. Is there a way to suppress the 2FA notice on
-- their dashboard after 10 days of ignoring it?"
--
-- The getting-started card hides itself once every step is done. Two-factor
-- is the one step an admin can decline indefinitely, so for an admin who has
-- set colours, a roster and a game, the card never goes away -- it becomes a
-- permanent one-item reminder at the top of the dashboard. A notice that
-- cannot be satisfied and cannot be dismissed stops being read.
--
-- ============================================================================
-- A TIMESTAMP, NOT A FLAG. This is the pattern the project settled on after
-- `is_broadcast` and `status = 'in_progress'` each gated a feature on
-- something that meant "until somebody acts": prefer a condition that
-- EXPIRES ON ITS OWN over one that waits on a human. Ten days from first
-- sight, and it is over -- no dismiss button to press, nothing to forget.
--
-- STAMPED WHEN THE STEP IS FIRST SHOWN, not at signup. profiles has no
-- created_at, and keying off the account age would silence the notice
-- instantly for every admin who already has one -- which is most of them,
-- and it would make the change impossible to observe. Starting the clock at
-- first sight gives everyone the same ten days from the day this ships.
--
-- WHAT THIS DOES NOT DO: it does not turn anything off, and it is not a
-- decision about two-factor. The permanent control on account.html is
-- unchanged and always available; only the repeated prompt expires. The
-- platform console still reports who has a verified factor (sql/033), so
-- "nobody set it up" stays a question Andy can answer.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists mfa_prompt_first_shown_at timestamptz;

comment on column public.profiles.mfa_prompt_first_shown_at is
  'When the dashboard first showed this admin the two-factor step. The step stops being shown 10 days later (dashboard.html, MFA_PROMPT_DAYS). Null means it has never been shown. Does not affect account.html, where two-factor can always be set up.';

-- ============================================================================
-- VERIFY -- runs inside the migration and prints a row.
-- "No rows returned" means nothing ran. Expect ONE ROW: true, then a count.
-- ============================================================================
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles'
             and column_name = 'mfa_prompt_first_shown_at')      as column_added,
  (select count(*) from public.profiles)                          as profiles_total,
  (select count(*) from public.profiles
    where mfa_prompt_first_shown_at is not null)                  as clocks_started;
-- EXPECT: column_added true, profiles_total your user count, clocks_started 0.
-- clocks_started rises as admins open their dashboards, and each of them
-- stops seeing the step 10 days after their own first sight.

commit;

notify pgrst, 'reload schema';
