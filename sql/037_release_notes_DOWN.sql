-- 037_release_notes_DOWN.sql
-- Reverses 037. Dropping last_seen_release loses every "I have read this"
-- mark, so re-running 037 shows every published note again -- annoying, not
-- damaging. Dropping release_state loses BOTH which notes were published and
-- which were emailed; the second one matters, because it is what stops a
-- release being mailed twice. Note the emailed ids first if that is a risk.

begin;
drop table if exists public.release_state;
alter table public.profiles
  drop column if exists last_seen_release,
  drop column if exists release_email_opt_out;
commit;
