# Multi-tenancy — the plan

Planning only. **Nothing here is built.** Decisions were taken with Andy
on 22 Aug 2026; this file exists so they are not re-litigated from
memory. Where a decision could reasonably have gone the other way, the
reasoning is recorded with it.

RECONSTRUCTED 23 Aug from session notes after the original was found to
be missing from the repo. If anything here contradicts what Andy
remembers deciding, HIS memory wins — flag it rather than proceeding.

---

## The goal

Sell StatChat to schools other than Neville. Everything below serves
that; nothing here is worth doing for its own sake.

## Step 0 — VERSION THE SCHEMA — **DONE 23 August 2026**

*This section previously said the work belonged in `supabase/migrations`.
That is the Supabase CLI default, not this repo's convention: migrations
live in `sql/`, settled 15 Aug and written up in `sql/README.md`.
Following the old wording would have created a second migrations
directory beside the one that already existed.*

The gap was real and worse than stated. Three change-scripts were
committed, but there was **not one `CREATE TABLE` statement anywhere in
the repo** — every table, column, constraint and index existed only in
the dashboard.

What was built:

    sql/capture/A..G      seven READ-ONLY queries that dump the live
                          schema from the SQL editor. pg_dump needs a
                          direct connection; these need a browser.
    sql/000_baseline.sql  the schema, captured. 562 lines.
    sql/002_schema_migrations.sql
                          an instance can be asked what it is missing.

**Proven, not asserted.** The baseline was applied to an empty Postgres
16 twice (it is idempotent), captured with the same seven queries, and
compared field by field against the live capture: 21 constraints, 16
indexes, 21 policies with identical USING and WITH CHECK, the 14
column-level `anon` SELECT grants on `games`, 8 functions with the same
6 SECURITY DEFINER, `is_admin` generated-stored, `sequence_number`
numeric. Each of those checks was then broken to confirm it can fail.

The rebuild found a fault nothing else would have: `current_user_role()`
is `language sql`, whose body Postgres validates at CREATE time, so it
could not be created before `profiles` existed. Invisible on the live
database, where the table was already there.

Still open, and all repo work rather than database work: the visibility
policy fix (see hazard 6 below) and the redundant `plays` indexes.

## The decisions

**Tenant = SCHOOL, not team.** A school may field more than one team
(football, and later other sports). Scoping to the team would force a
second tenant for the same institution and split its users, its billing
and its roster.

**One user per school**, for now. Multi-user within a school is a real
requirement eventually; it is not the thing standing between StatChat
and a second customer, and it multiplies the permission surface.

**The platform owner is a SUPER ADMIN, not a tenant user.** Full access
across schools, with a full audit trail of anything touched. Making the
owner a member of each tenant would blur "I administer this system"
with "I am a user of this school".

**"Act As" is DEFERRED.** Being able to impersonate a school's user is
the natural support tool, and it is also the feature most likely to
write data under the wrong identity. Not until the audit trail is real.

**Subscriptions are ANNUAL, PER TEAM.** A school with two teams pays
twice; the school is the tenant, the team is the billable unit.

**A lapsed subscription goes READ-ONLY, not dark.** A coach who has not
renewed still needs last season's reports. Locking them out of their own
history is how a lapse becomes a cancellation.

**Data retention: one year after a tenant goes inactive, then purge.**
Long enough that a late renewal loses nothing; short enough that dormant
data is not kept indefinitely.

**Two tenants playing each other: accept the duplication.** Both schools
record the same game from their own side. Trying to merge them means
deciding whose entry is authoritative during a live broadcast, which is
a much worse problem than two rows.

## Six hazards that exist TODAY

These are live bugs waiting for a second tenant, not future work.
Hazards 4-6 were found by the Step 0 capture on 23 Aug.

1. **The broadcast flag is globally unique.** One game is "on air" for
   the whole system. With two schools broadcasting simultaneously, the
   second to go live takes the first off air. Must become per-tenant.

   **Enforced by the DATABASE, not the application** — `one_broadcast_game`
   is a partial unique index on `games (is_broadcast) WHERE is_broadcast`.
   So this is a migration replacing an index, not a change to
   `api/feed.js`. Cost it accordingly.

2. **The overlay endpoints bypass RLS.** `api/gamedata.js`,
   `api/feed.js` and `api/seasondata.js` read with elevated rights
   because a vMix browser input cannot authenticate. That is acceptable
   for one tenant and a data leak across tenants. **Design this before
   any tenancy work**, not after.

3. **vMix URLs are shared secrets.** Anyone with the URL sees the feed.
   Fine within one school; across tenants it means a URL guessed or
   forwarded exposes another school's game.

4. **`games.designator` is globally UNIQUE.** Two schools cannot both
   create a game designated "2025-W1" — the second insert is rejected by
   the database. More visible than the others, because it fails loudly at
   game creation rather than leaking quietly, but it blocks the second
   tenant outright. Must become unique per tenant.

5. **Storage is one flat, world-readable bucket.** `team-logos` is
   `public: true` with no size limit, no MIME allowlist, no DELETE policy
   and no path scoping — the read policy is `bucket_id = 'team-logos'`
   and nothing else. Any authenticated user can upload a file of any type
   and any size, and every school's logos share one namespace. Per-tenant
   isolation needs a path prefix and a policy that checks it. The size
   cap and MIME allowlist are dashboard settings and worth doing now,
   independently of tenancy.

6. **`admins set game visibility` restricts nothing.** It and
   `games_update` are both PERMISSIVE policies on `games` UPDATE, and
   permissive policies OR together — so the effective rule is just
   (admin or game_entry), and a `game_entry` user can set `is_public` and
   `share_token` and publish a recap. Whatever `public_recap_sharing.sql`
   intended, admin-only visibility is not what is enforced. It would have
   to be `AS RESTRICTIVE`, or `is_public`/`share_token` come out of the
   column-level UPDATE grant. **This one is wrong regardless of tenancy**
   and is the only hazard worth fixing before a second school exists.

## Order

    0. Version the schema          <- DONE 23 Aug 2026
    1. Design the overlay auth     <- hazard 2, before tenancy touches it
    2. Tenant column + RLS
    3. Per-tenant broadcast flag   <- hazard 1
    4. Subscription state + read-only lapse
    5. Super admin + audit trail

Anything that adds a NEW page (the school list, the subscription view)
should use the three agreed breakpoints from the start — see the
breakpoint note at the head of `statchat.css`.
