-- =====================================================================
-- 007 — the database supplies the tenant, not the browser
--
-- Four column defaults, and they replace what was going to be eleven
-- edits across four application files.
--
-- WHY THIS IS BETTER THAN PATCHING THE INSERTS, in order of weight:
--
--   1. IT IS MORE SECURE. A client that supplies tenant_id is a client
--      that could supply the WRONG one. Taking it from
--      current_tenant_id() means the value comes from the session and
--      never from the browser — the same reasoning that makes
--      api/invite-user.js ignore a tenantId in the request body.
--
--   2. IT FIXES THE OFFLINE QUEUE. game.html keeps unsent plays in
--      localStorage and replays them later. Rows queued BEFORE the
--      migration carry no tenant_id, and patching the insert call sites
--      would not help them — those rows are already serialised. A column
--      default fills them in at insert time, so a queue that survives
--      the migration replays cleanly. That was the sharpest risk on the
--      step-2 list and it disappears.
--
--   3. Eleven fewer edits, four of them in game.html.
--
-- WHAT IT DEPENDS ON: auth.uid() being present. It is, for every
-- insert the browser makes. It is NOT for the service-key endpoints —
-- and none of them insert into these tables, verified: every api/*.js
-- only reads games, plays, players, game_rosters and teams.
--
-- If that ever changes, a server-side insert would evaluate the default
-- to NULL and hit the NOT NULL constraint — a loud, immediate failure
-- rather than a row filed under the wrong school. That is the right way
-- round.
--
-- SAFE ON ITS OWN. Nothing observable changes today: every row already
-- belongs to the single tenant, and a default only fires on an insert
-- that OMITS the column, which nothing currently does. RLS is untouched;
-- policies are 008, deliberately separate, because a wrong policy does
-- not error — it returns fewer rows, or more.
-- =====================================================================

alter table public.games        alter column tenant_id set default public.current_tenant_id();
alter table public.plays        alter column tenant_id set default public.current_tenant_id();
alter table public.players      alter column tenant_id set default public.current_tenant_id();
alter table public.game_rosters alter column tenant_id set default public.current_tenant_id();

-- teams is deliberately NOT given a default. A team is created when a
-- SCHOOL is created, by the platform, not by a signed-in member of the
-- school it belongs to — so current_tenant_id() would be null at exactly
-- the moment it matters. That insert states its tenant explicitly.
comment on column public.teams.tenant_id is
  'Set explicitly at school creation. No default: the platform creates teams, and current_tenant_id() is null for the super admin.';

comment on column public.plays.tenant_id is
  'Defaulted from current_tenant_id(). The browser never sends this - it cannot then send the wrong one, and plays queued offline before 006 still replay correctly.';

insert into public.schema_migrations (version, name)
values (7, '007_tenant_defaults') on conflict (version) do nothing;
