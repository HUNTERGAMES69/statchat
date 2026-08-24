# 000_baseline.sql — what it is and how it was proven

Captured 23 August 2026 from Supabase project `pboushzlcyfkssojpuut`
using `sql/capture/A..G`. Before this file the repo contained no
`CREATE TABLE` statement at all: the shape of StatChat's data existed
only inside a hosted dashboard.

## Proven, not asserted

Applied to an EMPTY Postgres 16 database, twice (it is idempotent), then
captured with the same seven queries and compared field by field against
the live capture:

    21 constraints      identical, including every ON DELETE rule
    16 indexes          identical, including both partial ones
    21 policies         identical roles, command, USING and WITH CHECK
    14 columns          anon SELECT on games — exactly the live set,
                        and NO table-level SELECT
     8 functions        same names, same 6 SECURITY DEFINER
    is_admin            GENERATED STORED with the live expression
    sequence_number     numeric, not integer
     6 tables / 70 columns, RLS enabled on all six

Then each of those checks was shown to FAIL: sequence_number narrowed to
integer, the one-broadcast-game index dropped, is_admin turned into a
plain writable boolean, an extra anon SELECT column added, a policy
dropped, current_user_role stripped of SECURITY DEFINER, and RLS switched
off on teams. All seven were caught and reverted.

## One ordering fault, found by the rebuild

The first version put functions before tables. `current_user_role()` is
`language sql`, whose body Postgres validates at CREATE time, so it could
not be created before `public.profiles` existed. On the live database
this was invisible — the table was already there. Nothing but an actual
rebuild would have found it, which is the argument for doing one.

Sections are now: tables, functions, indexes, triggers, RLS, grants,
event trigger, storage.

## Accepted deltas — expect these in a capture diff

* **profiles column numbering.** Live has a gap at attnum 3 from a column
  dropped long ago; a rebuild numbers 1–5. Invisible to the application.
* **storage.buckets extra columns.** `versioning_status`,
  `avif_autodetection` and `type` vary by Supabase version, so the insert
  names only id/name/public and lets the platform default the rest.
* **Six platform event triggers** (`pgrst_*`, `issue_*`) and the
  realtime/storage triggers are not recreated. Only `ensure_rls` is ours.

## Two things captured unchanged that are WRONG

A baseline records what is. Both of these want a numbered migration:

1. **`admins set game visibility` restricts nothing.** It and
   `games_update` are both PERMISSIVE, and permissive policies OR
   together, so the effective rule is just (admin or game_entry) — a
   game_entry user can set `is_public` and publish a recap. It would have
   to be `AS RESTRICTIVE`.
2. **`plays` carries a redundant index.** `plays_game_sequence_idx`
   duplicates the unique `plays_game_seq_unique` on the same columns, and
   `plays_game_idx` is covered by both. `plays` is the highest-write
   table in the app.

## Tenancy hazards this capture added to MULTI_TENANT_PLAN.md's three

4. **`games.designator` is globally unique.** Two schools cannot both
   create "2025-W1". Fails at insert, so it is visible rather than
   silent, but it blocks the second tenant.
5. **Storage is one flat world-readable bucket** with no size limit, no
   MIME allowlist, no DELETE policy and no path scoping.

Also worth knowing: hazard 1 (one game on air system-wide) is enforced by
the `one_broadcast_game` unique index, not by application code. Making it
per-tenant is a migration, not a change to `api/feed.js`.
