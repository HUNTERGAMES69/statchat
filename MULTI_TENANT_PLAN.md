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

## Step 0 — VERSION THE SCHEMA. Do this before anything else.

`supabase/migrations` does not exist in this repo. The tables, the RLS
policies and the database functions live **only** in the live Supabase
project (id `pboushzlcyfkssojpuut`).

Tenancy IS a schema change, and it has to be applied identically to dev,
staging and production. Without migration files there is no mechanism to
do that — and no way to review a change before it lands on live data.

It is also a standalone risk, independent of tenancy: **if the Supabase
project were lost today, the application code would survive and the
shape of the data would not.**

The work: capture tables, policies and functions into
`supabase/migrations`, verify by rebuilding a scratch database from
those files alone, and commit. Nothing else in this document should
start first.

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

## Three hazards that exist TODAY

These are live bugs waiting for a second tenant, not future work:

1. **The broadcast flag is globally unique.** One game is "on air" for
   the whole system. With two schools broadcasting simultaneously, the
   second to go live takes the first off air. Must become per-tenant.

2. **The overlay endpoints bypass RLS.** `api/gamedata.js`,
   `api/feed.js` and `api/seasondata.js` read with elevated rights
   because a vMix browser input cannot authenticate. That is acceptable
   for one tenant and a data leak across tenants. **Design this before
   any tenancy work**, not after.

3. **vMix URLs are shared secrets.** Anyone with the URL sees the feed.
   Fine within one school; across tenants it means a URL guessed or
   forwarded exposes another school's game.

## Order

    0. Version the schema          <- gate on everything
    1. Design the overlay auth     <- hazard 2, before tenancy touches it
    2. Tenant column + RLS
    3. Per-tenant broadcast flag   <- hazard 1
    4. Subscription state + read-only lapse
    5. Super admin + audit trail

Anything that adds a NEW page (the school list, the subscription view)
should use the three agreed breakpoints from the start — see the
breakpoint note at the head of `statchat.css`.
