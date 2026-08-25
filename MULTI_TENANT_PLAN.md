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

## Hazard 0 — `is_our_team`, and it is bigger than the other six

**Not previously listed, and it is the single-tenant assumption the whole
application is built on.**

`teams.is_our_team` is a boolean, and nineteen separate queries across
eighteen files ask for it the same way:

    .eq('is_our_team', true)

game.html, view.html, dashboard.html, create_game.html, customize.html,
roster.html, account.html, reports.html, recap.html, season_report.html,
stat_package.html, player_report.html, game_legacy.html, plus
api/feed.js, api/gamedata.js, api/seasondata.js, api/og.js and feed.js.

Every one of those means **"the school this installation belongs to"**.
With one tenant it is correct and free. With two it returns the wrong
school, or two rows, silently — there is no unique index on it, so
nothing stops both being true.

This is not a hazard that shows up as an error. `.limit(1)` on an
unordered query returns whichever row Postgres feels like, so a second
tenant produces a report with the right numbers under the wrong badge.

**It is also the shape of the whole migration.** Every one of those
nineteen call sites is a place where "our team" has to become "the team
belonging to the tenant of the signed-in user". That is the work. The
tenant column is a morning; this is the project.

Worth noting `teams` is effectively a one-row table today: opponents are
stored on `games` as `home_team_name` / `away_team_name` text plus
`opponent_*` columns, not as rows in `teams`. So `teams` is closer to
"the tenant's own identity" than to "a directory of teams", which is why
the tenant column probably belongs on `teams` rather than replacing it.

### The decision, 24 August 2026: branding belongs to the SCHOOL

Andy: **tenant = school**, applied to this question. A school has one
crest and one set of colours across every sport it fields, so branding is
school property, not team property.

Today's `teams` table splits in two:

    tenants          id, name, full_name, logo_url,
                     primary_color, secondary_color, created_at
                     (subscription state joins this later)

    teams            id, tenant_id, sport, current_season_year, created_at

`is_our_team` is DROPPED, not scoped — under tenancy it distinguishes
nothing. `icon_url` goes with it; nothing has read it since 22 Aug.

`current_season_year` stays on the TEAM. A school's football season and
its basketball season are different years, and that is exactly the case
this split exists to allow.

### What each of the nineteen becomes

Eleven ask only for `primary_color, secondary_color, logo_url`. They
become a read of the tenant with **no filter at all** — RLS returns
exactly one row, so the clause disappears rather than changing. The two
that want `id, name, current_season_year` split across both tables.

**And `.limit(1)` becomes `.single()`.** This is the most valuable line
in the whole migration and it is nearly free. `.limit(1)` on an unordered
query silently returns whichever row Postgres feels like — that is the
wrong-badge failure, and it never raises anything. `.single()` ERRORS
unless there is exactly one row. The change converts a silent
data-correctness bug into a loud one, on all nineteen call sites, in the
same edit that removes the filter.

### The four that do NOT get simpler

`api/feed.js`, `api/gamedata.js`, `api/seasondata.js` and `api/og.js`
hold the service key, so RLS does not scope them and there is no
`.single()` safety net — many rows is legitimate there. Each must pass a
tenant explicitly, which is why **hazard 0 cannot be finished before Q2
is answered**. They are the same work seen from two directions.

### A second SCHOOL and a second SPORT are different projects

Worth separating, because conflating them doubles the first one:

  * A second **school** needs `tenant_id` on every table, RLS rewritten,
    and the nineteen call sites. It does NOT need `teams.sport`, and it
    does not need `games` to know which team it belongs to — with one
    sport, tenant implies team.
  * A second **sport** needs `games.team_id`, which does not exist today
    (`games` has no FK to `teams` at all), plus a way to choose a sport
    in every report and picker.

Build the tenant split now because the column layout is hard to change
later. Do not build `games.team_id` until a second sport is real.

## The other hazards

These are live bugs waiting for a second tenant, not future work.
Hazards 4-6 were found by the Step 0 capture on 23 Aug.

1. **The broadcast flag is globally unique.** One game is "on air" for
   the whole system. With two schools broadcasting simultaneously, the
   second to go live takes the first off air. Must become per-tenant.

   **Enforced by the DATABASE, not the application** — `one_broadcast_game`
   is a partial unique index on `games (is_broadcast) WHERE is_broadcast`.
   So this is a migration replacing an index, not a change to
   `api/feed.js`. Cost it accordingly.

2. **The overlay endpoints bypass RLS — and there are NINE of them, not
   three.** This section named `api/gamedata.js`, `api/feed.js` and
   `api/seasondata.js`. Every one of these holds `SUPABASE_SECRET_KEY`
   and therefore bypasses row-level security entirely:

       api/feed.js          api/gamedata.js      api/seasondata.js
       api/og.js            api/share.js         api/feedkey.js
       api/invite-user.js   api/manage-users.js  api/contact.js

   Three of those are worse than the ones already listed.
   `api/invite-user.js` and `api/manage-users.js` write to identity;
   `api/share.js` serves a public recap by token and is the one path an
   anonymous stranger reaches on purpose. `api/contact.js` is the only
   safe member — it writes to `leads`, which has no tenant.

   **Every service-key endpoint is a place where tenant scoping must be
   re-implemented by hand**, because the mechanism that would otherwise
   enforce it is switched off. Counting them was the point: a design that
   secures three endpoints and leaves six is not a design.

   **Design this before any tenancy work**, not after.

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

6. ~~**`admins set game visibility` restricts nothing.**~~ **CLOSED
   24 Aug, and the answer was the opposite of the one assumed here.** The
   policy did indeed restrict nothing — it was PERMISSIVE alongside
   `games_update`, and permissive policies OR together. `004` dropped it
   and added an admin-only trigger; `005` removed the trigger again.
   Andy's call: **`game_entry` MAY publish**, because the crew who set the
   game up the day before are the crew who share the recap.

   The lesson is worth more than the fix: this section treated the
   policy's NAME as the specification and proposed making the code match
   it. Nobody had asked whether admin-only was wanted. **A rule that does
   not match its name is evidence the rule is wrong, not evidence the
   name is right.**

   What survives: the lying policy stays dropped, and the decision now
   lives in `comment on column` on `games.is_public` and
   `games.share_token` rather than only in a migration.

## What the schema actually looks like, and where a tenant hangs

From `000_baseline.sql`. Six tables, and the foreign keys are shallow:

    teams            -> (no FK)          effectively ONE row today
    profiles         -> (no FK)          NO link to a team or a school
    players          -> teams
    games            -> (no FK)          the root of everything a game owns
    plays            -> games
    game_rosters     -> games, players

Two facts follow, and neither was in this plan:

**`profiles` has no team link at all.** Columns are `id`,
`display_name`, `avatar_url`, `role`, `is_admin`. There is today no way
to answer "which school does this user belong to" — which is the first
question every RLS policy will need to ask. `profiles.tenant_id` is the
keystone; nothing else can be scoped until it exists.

**`games` is a root, not a child.** It has no FK to `teams`. So a game is
not reachable from a school by joining; the tenant has to be stored on
`games` directly. The same is true of `teams` and `profiles`.

### Denormalise, do not join

`plays` and `game_rosters` can reach a tenant through `games`, and
`players` through `teams`. **They should still carry their own
`tenant_id`.** Not because a function call is expensive — see Q1, a
STABLE function is evaluated once per statement — but because a policy
that reaches the tenant by joining `plays -> games` makes the join part
of the security boundary. Every query against the busiest table in the
app then depends on that join being right, and an index being present,
for correctness as well as speed. The cost of the duplicate
column is one more thing to keep correct on insert; the cost of the join
is paid on every play entered during a live game.

The duplicate must then be defended: a `check` constraint or a trigger
asserting that a play's `tenant_id` matches its game's. Otherwise the
denormalised column is a second source of truth with no referee, which
is the fault already recorded for `teams.icon_url` and the two team
images.

## Open questions — these come BEFORE any migration

The order below is unchanged in shape, but step 1 has to answer more than
"overlay auth". These four are the design, and none is answered yet.

**Q1. How does a request know its tenant?** Three candidates:

  * *A JWT claim*, set by a Supabase custom access token hook. RLS then
    reads `auth.jwt()` with no table lookup — the fastest option, and the
    one that makes policies simple. Costs: a hook to write and deploy,
    and a claim that goes stale if a user's tenant changes mid-session.
  * *A lookup through `profiles`*, the way `current_user_role()` already
    works. No new infrastructure, always current.

    **The cost of this is smaller than it looks, and an earlier draft of
    this document overstated it.** `current_user_role()` is declared
    `stable`, and a STABLE function with no row-dependent arguments is
    evaluated ONCE PER STATEMENT, not once per row — Postgres folds it to
    a constant for the scan. It is a primary-key lookup on a table with
    as many rows as there are users.
  * *Both* — claim as the fast path, `profiles` as the authority.

  This decides the shape of all twenty-one policies. It is the first
  thing to settle, not the last.

  **DECIDED 24 August 2026: the `profiles` lookup.** Andy's call. The
  ground has nothing to do with performance. This document already decides that *a
  lapsed subscription goes read-only, not dark*. Put tenant or
  subscription state in a JWT claim and it is only as fresh as the token
  — up to an hour. That cuts both ways and the second direction is the
  bad one: a coach who PAYS mid-Friday still cannot score the game until
  their token refreshes. A lookup takes effect on the next query.

  A custom access token hook is also a deployed function in the auth
  path. If it errors, logins break — not reports, logins.

  The shape would mirror the function that already works:

      create or replace function public.current_tenant_id()
       returns uuid language sql stable security definer
       set search_path to 'public'
      as $function$
        select tenant_id from profiles where id = auth.uid() limit 1;
      $function$;

  `security definer` for the same reason it is on `current_user_role()`:
  `profiles` is behind RLS, so a plain function recurses into the policy
  that called it. **No `coalesce` default** — a null tenant must deny,
  not fall back to something.

  **Super admin sits BESIDE, in the policy text. Decided 24 Aug.**

      using (tenant_id = current_tenant_id() or is_super_admin())

  Not inside `current_tenant_id()`, where the override would be invisible
  to anyone reading the rule. This document promises the owner a full
  audit trail, and **an override that cannot be seen in the rule is one
  nobody thinks to log.** Written beside, "may I ignore my tenant" is a
  separate question with its own name — loggable, testable, and capable
  of being switched off. Tidier policy text is not worth much on the one
  rule that decides whether school A can read school B.

  Two things follow that are easy to get wrong:

  **`is_super_admin()` is not `profiles.is_admin`.** That column already
  exists and means "admin OF THIS SCHOOL" — it is generated from
  `role = 'admin'`, and every tenant will have one. Reusing it would give
  every customer's admin cross-tenant access. The platform owner needs a
  separate, sparsely-populated flag that no tenant user can set.

  **The clause goes on every policy, including the ones that look
  harmless.** A super admin who can read `games` but not `plays` cannot
  actually help anybody, and the half-applied case is worse than either
  extreme because it fails in the middle of a support call.

  **Note that Q1 does not touch the overlay.** `auth.uid()` is null for
  an unauthenticated vMix input, so this returns null and everything
  denies. That is correct default-deny. The tempting shortcut is to let
  the overlay pass its own tenant id — which is hazard 3 wearing a
  different hat. Q2 must be solved on its own.

**Q2. How does an UNAUTHENTICATED overlay prove its tenant?**
**DECIDED 24 August 2026: a per-tenant key, and the residual risk is
accepted.**

*What exists today.* `FEED_KEY` is a single static environment variable.
`api/feed.js` checks `q.key === FEED_KEY`, and `api/feedkey.js` hands
that one key to any signed-in staff member. **The key does not identify a
tenant.** With two schools it is not merely leaky, it is insufficient —
`feed.js` would have nothing to scope the query BY. That single fact is
most of hazards 2 and 3 together.

*The decision.* `tenants.feed_key` — random, rotatable, no expiry. The
four feed endpoints resolve it to a tenant with one lookup and scope
every query to that tenant. **The key IS the identity**, so there is no
second parameter a caller could forge or mismatch, and no code path where
the key says one thing and a tenant id says another.

*Why not a signed token with an expiry*, which is the textbook answer:
because this product promises the opposite. From statchat.co — "Your
broadcast software points at a URL that never changes — no game id, no
week number. Set the data sources up once in the pre-season and never
touch them again." An expiring URL means the overlay dies mid-season,
almost certainly during a game. **Expiry only makes sense where somebody
is present to refresh it, and a vMix browser input is precisely where
nobody is.** That would trade a bounded risk for an operational failure
at the worst possible moment.

*What this does NOT solve, and that is accepted.* Anyone holding a
school's URL still reads that school's live game. What changes is blast
radius — one school rather than all of them — and revocability, since a
key on a row can be rotated without touching an environment variable or
redeploying.

Andy accepted that residual on 24 Aug, and the reason it is defensible is
what the feed actually exposes: live scores, team stats and player names.
**That is the same data as the public recap link, which this product now
encourages coaches to send to local media.** Treating one as a secret
while publishing the other would be incoherent.

*The work.* A column, a generator, a lookup in `api/feed.js`,
`api/gamedata.js`, `api/seasondata.js` and `api/og.js`, and a **Rotate
key** control on `broadcast_setup.html` — which must warn that rotating
breaks every existing vMix input until they are re-pasted. A rotation
that silently kills a broadcast is worse than no rotation.

*Settled within Q2, 24 August 2026: NO MASTER KEY. The environment
`FEED_KEY` is retired.* Andy's call, and the right one: a key that opens
every school is exactly what the per-tenant decision just abolished, and
keeping one for support convenience would have reintroduced it under a
friendlier name. **A master key that is never used is an unaudited
liability; one that is used becomes a habit.**

Support access to another school's feed goes through the same route as
any other cross-tenant access — the super-admin path, which is auditable
— not through a shared secret in an environment variable.

Retiring it is also a real deletion, not a rename: `api/feed.js` currently
does `if (FEED_KEY && q.key !== FEED_KEY)`, so leaving the variable unset
disables the check entirely rather than failing closed. **That branch has
to become a required per-tenant lookup, or removing the variable opens
the feed to everyone.**

**Q3. What happens to `current_user_role()`?**
**DECIDED 24 August 2026: nothing. A separate `current_tenant_id()` sits
beside it.**

Counted rather than assumed: of the policies in `000_baseline.sql`, only
**six** call `current_user_role()` — `games_insert/update/delete` and
`plays_insert/update/delete`. Every other policy is either `using (true)`
for a signed-in user, an `anon` read gated on publication state, or an
own-row check on `profiles`.

That count decides it. **Every policy will need a tenant check; only six
need a role check.** Folding the tenant into `current_user_role()` — a
composite return, or a second column — would force a role lookup into the
eleven policies that have no use for one, and make all seventeen
destructure a value where they want a single comparison.

Two functions, two questions, each answerable alone:

    current_user_role()   -> 'admin' | 'game_entry' | 'view'   (unchanged)
    current_tenant_id()   -> uuid                              (new)

`current_user_role()` is not touched. It is captured in the baseline,
proven by every policy that already uses it, and the smallest possible
new surface is a second function of identical shape rather than a change
to a working one.

### The four `anon` policies must NOT get a tenant check

This is the trap, and it would be easy to walk into while doing a
mechanical pass over seventeen policies.

`anon reads shared games`, `anon reads shared game plays`, `anon reads
shared game rosters` and `anon reads our branding` are scoped by
PUBLICATION STATE — `status = 'final' and is_public = true` — not by
tenant. An anonymous reader has no `auth.uid()`, so `current_tenant_id()`
returns null for them, and **adding a tenant check to these policies
denies every row and breaks public recap links entirely.**

They are already correctly scoped: the share token identifies one game,
and a published game is published to everyone by definition. Scoping a
public thing to a tenant is a category error that reads like diligence.

`anon reads our branding` is the one that does need thought, because it
currently returns the row where `is_our_team` is true. Once branding
moves to `tenants` it has to return the branding of the tenant that owns
the game being viewed — which is reachable from the share token, not from
the reader.

**Q4. What is the tenant of the EXISTING data?**
**DECIDED 24 August 2026: one tenant, backfilled in the same migration
that adds the columns.**

There is one school in the database. The sequence, in a single migration
so the schema is never briefly inconsistent:

    1. create `tenants`; insert one row from the existing `teams` row
       (name, full_name, logo_url, primary_color, secondary_color)
    2. add `tenant_id uuid` to teams, profiles, games, players, plays,
       game_rosters -- NULLABLE
    3. update every one of those, setting tenant_id to the single row
    4. THEN `alter ... set not null` and add the foreign keys
    5. add an index on tenant_id per table

**Step 4 cannot come before step 3.** Adding a `not null` column to a
populated table fails outright, and adding it nullable and forgetting to
tighten it leaves a column that RLS will happily read as null — which
denies nothing and everything depending on how the policy is written.

The backfill is trivial today and will never be this easy again. It is
worth doing while it is six `update` statements with no `where` clause.

## What must NOT be tenant-scoped

Worth stating so nobody scopes them by reflex:

  * **`schema_migrations`** — a property of the instance, not a tenant.
  * **`leads`** — enquiries from people who have no account and no
    school. Already locked down with no grants and no policies.
  * **`auth.users`** — Supabase-managed. The link is `profiles.tenant_id`.
  * **The `team-logos` bucket itself** — one bucket, scoped by PATH
    prefix rather than by having a bucket per tenant. See hazard 5.

## Order

    0. Version the schema          <- DONE 23 Aug 2026
    1. Answer Q1-Q4                <- design, no code.
         Q1 tenant resolution   -- DECIDED: profiles lookup (24 Aug)
         Q2 overlay auth        -- DECIDED: per-tenant key (24 Aug)
         Q3 current_user_role   -- DECIDED: leave it; add a sibling (24 Aug)
         Q4 backfill            -- DECIDED: one tenant, same migration (24 Aug)

    STEP 1 IS CLOSED, 24 August 2026. Every question answered:
      Q1  tenant from a profiles lookup, super admin beside it in policy
      Q2  per-tenant feed key, no master key, residual risk accepted
      Q3  current_user_role() untouched; current_tenant_id() alongside
      Q4  one tenant, backfilled in the same migration as the columns

    Step 2 is the first migration and can be written.
    2. tenants table + tenant_id everywhere + backfill
    3. RLS rewritten against the tenant, all 21 policies
    4. Replace `is_our_team` at all 19 call sites   <- hazard 0
    5. Re-scope the nine service-key endpoints      <- hazard 2
    6. Per-tenant broadcast flag and designator     <- hazards 1, 4
    7. Storage path scoping                         <- hazard 5
    8. Subscription state + read-only lapse
    9. Super admin + audit trail

Steps 2 and 3 are one deployment, not two: a tenant column with the old
policies still in place is a column nothing reads, and new policies
without the column break every query.

## Sign-in, the super admin, and the screens (24 August 2026)

### Sign-in does not change, and the reason is worth knowing

**There is no self-registration anywhere in the app** — no `signUp()` call
exists. A user comes into being only when an admin calls
`api/invite-user.js`. So the tenant is assigned AT INVITE TIME, and the
sign-in page never has to ask which school somebody belongs to. Email,
password, done. `current_tenant_id()` reads `profiles.tenant_id`
afterwards.

The work is at the other end: `api/invite-user.js` must stamp the new
profile with **the inviting admin's tenant**, and must refuse any other.
That endpoint is the moment a bug would let one school add users to
another, and it holds the service key, so RLS will not catch it.

### There is exactly ONE login page, and it cannot be school-branded

A login page cannot carry a school's crest, because **it does not know
which school you are until after you have signed in**. The only ways
round that are a subdomain per school or a token in the URL, and the
second is a worse subdomain. Neither is worth building.

`statchat.co/login.html`, StatChat-branded, for everybody. School
branding begins the moment they are through. That is also the right
product answer: the page says whose software this is, and everything
after it says whose team it is.

### The super admin is `statchatadmin@statchat.co`

**A SEPARATE ACCOUNT, with `is_super_admin` and NO tenant.** Andy's call,
24 Aug, and it matches the decision already in this document that the
platform owner is not a tenant user.

The alternative — one account carrying both the super-admin flag and
Neville's tenant — is more convenient and destroys the audit trail's
only useful property. Every action would be ambiguous between "Andy the
Neville admin" and "Andy the platform", which is the exact question an
audit trail exists to answer. A separate account is cheap now, with one
school and one person, and expensive to introduce later.

It follows that this account has **no dashboard to land on**. It belongs
to no school, so the school list IS its landing page.

### The tenant landing page, and the team that does not exist yet

A school will one day field several teams. The governing principle,
decided while mocking it:

**With one team there is no picker.** A school that only fields football
must never be asked to choose football. But the team context exists
structurally from the first day — a strip below the app header showing
school and team — so a second sport is a row in a table rather than a
redesign. With one team the strip renders as a line of text and no
interaction at all.

The strip sits ABOVE the page, in the reading path, rather than beside
the account menu. The school and the team decide what every number on the
page means, and a control that decides the meaning of a page should not
be found by accident.

### THIS REVISES AN EARLIER RECOMMENDATION IN THIS DOCUMENT

Above, under "A second SCHOOL and a second SPORT are different projects",
this plan says to add `tenant_id` now and defer `games.team_id` until a
second sport is real. **Mocking the screens showed that to be
inconsistent.** The argument for backfilling the tenant now is that it
will never be this easy again — six UPDATEs with no WHERE clause. Exactly
the same is true of `team_id`, and the header above cannot scope a game
list by team without it.

`games.team_id` goes in the SAME migration. One column now against a data
migration later, on the largest table in the application.

### The screens are mocked

`tenant_screens_mockup.html` — super-admin console, the tenant header in
both states, add-a-school, and invite-a-user. Not wired, not to be
uploaded over any app page. Two things it settled:

  * **"Open" on the school list is not "Act As".** This document defers
    impersonation until the audit trail is real, and that screen must not
    quietly become it. Open means reading a school's data AS THE
    PLATFORM, logged as the platform. If the difference is not obvious on
    screen it survives only in the code, which is where distinctions go
    to die.
  * **A tenant record needs**: name, full name, logo, two colours, feed
    key, subscription state, renewal date. A team needs: tenant, sport,
    current season year.

### Creating a school asks for as little as possible

Andy, 24 Aug: **no colours on the create form.** The platform creates the
account; the school decides how it looks. `customize.html` already owns
exactly that set of fields — team name, full name, current season, logo,
primary and secondary colour — and it belongs to the tenant's own admin.

The create form takes the two NAMES only, because an invite has to say
what it is an invite to, plus the first team and the admin's email. Those
names carry through and appear pre-filled on Customize, where the school
can change them.

### Invites carry a NAME, and that is how the tenant travels too

Andy, 24 Aug: the create-school form takes the admin's **name** as well
as their email.

It exposes something already wrong today. `api/invite-user.js` calls
`inviteUserByEmail(email)` with no metadata, and
`create_profile_for_new_user()` sets `display_name` to `new.email`. **So
every user in this system is displayed as an email address** — including
on the manage-users screen an admin reads to decide who to remove.

The fix is the same mechanism that should carry the tenant:

    inviteUserByEmail(email, { data: { display_name, tenant_id } })

writes into the user's metadata, and the signup trigger reads both when
it builds the profile row.

**That is strictly better than patching the profile after the invite is
accepted.** The tenant is present from the instant the row exists, so
there is no window in which a user has a profile and no school — which
matters because `profiles.tenant_id` must stay nullable for the trigger's
sake, and a nullable tenant that is briefly null for real is how a user
ends up seeing nothing and nobody knowing why.

The trigger change is a migration, and it belongs in step 2 with the rest.

### Self-deletion is ALREADY guarded — verified, not assumed

Andy asked for a guarantee that a tenant admin cannot delete their own
account. `api/manage-users.js` already enforces it server-side, in three
places: `delete`, `setDisabled` and `setRole` each refuse when
`userId === callerId`. The comment there gives the right reason — "the
button being greyed out stops a mis-tap, not someone calling the API
directly."

They also produce a stronger guarantee by accident: **a school can never
reach zero admins**, because the last admin cannot remove or demote
themselves. Worth knowing it is accidental rather than designed, so it is
not casually removed.

### HAZARD 7 — `manage-users.js` is not tenant-scoped, and it is the worst one

Not previously listed. The endpoint authorises like this:

    if (profileRows[0].role !== 'admin') { 403 }

**Any admin of ANY school passes.** It then calls `listUsers()`, which
returns every user in the system, and exposes `setPassword` on any of
them.

So the moment a second tenant exists, an admin at one school can list
another school's users and **set their admin's password**. That is total
cross-tenant account takeover through a button in the interface, not an
exploit. RLS cannot catch it because the endpoint holds the service key.

It is not a bug today only because "any admin" and "our admin" describe
the same set of people. It fails open the instant that stops being true,
which is the definition of the class of hazard this document exists to
list.

Every action needs the TARGET's tenant checked against the caller's, not
just the caller's role: `list` filtered to the caller's tenant, and
`delete`, `setRole`, `setPassword`, `setDisabled` and `resendInvite` each
verifying the target belongs to it. `api/invite-user.js` needs the same.

The list filter matters most — an admin cannot act on a user they cannot
see, so scoping the list removes most of the surface before any action
runs. But it is not sufficient on its own: this endpoint is callable
directly, so each mutating action needs its own check.

### THE SUPER ADMIN HAS NO RESTRICTIONS. Decided 24 Aug.

Same shape as the policies: the tenant check passes if the tenants match
**or the caller is the platform**. `statchatadmin@statchat.co` has no
tenant of its own, so a naive `target.tenant_id === caller.tenant_id`
would refuse it everything — including resetting a locked-out coach's
password, which is the main reason support access exists at all.

Two consequences worth stating rather than discovering:

**Impersonation already exists, informally.** A caller who can set any
user's password can become that user. So the deferral of "Act As"
elsewhere in this document does not withhold the capability — it only
withholds a tidy interface for it. **That makes the audit trail more
important, not less**, and it makes `manage-users.js` the first place
auditing has to actually record something rather than the last.

**ONE CARVE-OUT WORTH KEEPING: self-deletion.** The endpoint's
`userId === callerId` guard currently applies to everybody, and it should
keep applying to the super admin too. Deleting the only platform account
is unrecoverable from inside the application — the way back is the
Supabase dashboard. That is not a restriction in the sense intended here;
it is the same class as not sawing the branch you are sitting on, and it
is the reason the guard exists for tenant admins as well.

**Confirmed by Andy, 24 Aug: no self-delete for the super admin
either.** So the rule is uniform and needs no exception written into it —
`userId === callerId` refuses everybody, platform included. The one place
"no restrictions" does not reach is the one action with no undo.

The interface should match, the way `account.html` now does for tenant
admins: **the Delete button is not rendered on your own row at all**,
rather than rendered and refusing. A control that can only ever produce
an error is not a control.

### The open question this creates, and it is not a detail

A school created with no colours has none at first login — and
`game.html` currently falls back to `'#1a1a2e'` and `'#8B0000'`. **Those
are Neville's colours, hardcoded.** A new customer would open the app
wearing another school's branding, which is worse than wearing none.

This is the same item already recorded in TODO.md under the tokenization
work: *"the team-branding fallbacks are a TENANT default question."* Two
candidate answers:

**DECIDED 24 Aug: both.** Neutral greys as the fallback, AND the tenant
admin's first login lands on Customize with the two names filled in.

**DONE 24 Aug: the neutrals are in.** Thirty fallbacks across thirteen
files — including both copies of `engine.js` — replaced:

    our team    '#1a1a2e'  navy      ->  '#2b3440'  slate
    opponent    '#8B0000'  dark red  ->  '#6e7885'  grey

Two neutrals rather than one, so home and away stay distinguishable when
neither school has set a colour, separated by lightness rather than hue
so nothing reads as a team identity. Both carry white text, which is what
the `secondary_color` fallback supplies.

**Done NOW precisely because it changes nothing.** Neville has colours
set, so every one of these `||` branches is dead code today. Landing it
during the tenancy migration would have meant no way to tell a colour
problem caused by the neutrals from one caused by the tenant work.

Only `primary_color ||` and `secondary_color ||` expressions were
touched; a blanket replace would have hit unrelated navy in stylesheets
and chart palettes. Every file verified as reversible — putting the old
values back reproduces the original byte for byte.

Both rather than either, and Andy's reason is the right one: landing on
Customize handles the ordinary case, and the greys protect the case where
somebody skips it. A default that is only correct if a screen gets
visited is not a default. The greys must also replace the hardcoded
`'#1a1a2e'` and `'#8B0000'` in `game.html`, which are Neville's colours
and would otherwise dress a new customer in another school's branding.

## Step 2 in plain English, and what it risks

Written out before any SQL, at Andy's request, 24 Aug.

### How it proceeds

**Step 2 — the columns.** One migration, one deployment.

  * Create `tenants`, holding what a SCHOOL is: name, full name, logo,
    primary and secondary colour.
  * Insert one row, copied from the existing `teams` row. That is Neville.
  * Add a NULLABLE `tenant_id` to teams, games, players, plays,
    game_rosters and profiles.
  * Backfill all six to that tenant — six UPDATEs, no WHERE clause.
  * THEN `set not null` and add the foreign keys. Never before the
    backfill: a NOT NULL column on a populated table fails outright.
  * Index `tenant_id` on every table; every future query filters on it.
  * Add `profiles.is_super_admin`, default false, true for Andy only.
  * Add `tenants.feed_key`, random — and SEED NEVILLE'S WITH THE CURRENT
    `FEED_KEY` VALUE so no vMix input breaks the moment this lands.

**`profiles.tenant_id` STAYS NULLABLE, permanently.** The signup trigger
`create_profile_for_new_user` inserts a profile the instant an auth user
is created, long before any app code knows which school they belong to.
Make that column NOT NULL and **signup breaks completely**. A null tenant
sees nothing until an admin assigns one, which is the correct behaviour
anyway — but it has to be a decision rather than an oversight, because
the failure appears at a new customer's first login, not in testing.

**Step 3 — the policies**, same deployment. Rewrite all seventeen as
"your tenant, or you are the platform owner". Leave the four `anon`
policies alone. Add `current_tenant_id()` and `is_super_admin()`; do not
touch `current_user_role()`.

**Step 4 — the writes.** Fourteen insert call sites must start sending
`tenant_id`: seven in `plays`, four in `game_rosters`, two in `games`,
one in `players`.

**Step 5 — `is_our_team`.** Nineteen queries, eighteen files. Filter
removed, `.limit(1)` becomes `.single()`.

### Risks to the app as it stands

  * **Signup stops working** unless `profiles.tenant_id` is nullable.
  * **THE OFFLINE QUEUE IS THE SHARPEST.** `game.html` keeps unsent plays
    in localStorage and replays them later. Rows queued BEFORE the
    migration carry no tenant_id, so on replay the insert is rejected —
    mid-game, and reported to the scorer as a connection problem.
    **Migrate only when no game is in progress and `statchat_pending` is
    empty.**
  * **A missed insert site fails almost silently**: the write is rejected
    and the offline handler calls it a network failure. Same wrong-message
    class as the concurrent-scorer bug fixed on 24 Aug.
  * **The nine service-key endpoints keep working throughout**, because
    they bypass RLS. Convenient and dangerous: the app can look entirely
    healthy while the policies are wrong, since the feed and the public
    recap never exercise them.
  * **A wrong policy does not error.** It returns fewer rows, or more. A
    report showing nothing is obvious; one showing slightly fewer plays
    is not.
  * **vMix inputs survive step 2** only because Neville's `feed_key` is
    seeded with the existing value.

### Timeline

    now              write steps 2-3 as one migration, prove on scratch
    now              write the paired DOWN script and RUN it
    same day         patch 14 insert sites + 19 is_our_team sites
    quiet day        confirm no pending offline queue, then migrate
    immediately      upload the patched app files
    same session     enter a full test game, export a recap, load a vMix input
    before selling   create a second tenant, confirm it sees none of Neville's

**THAT LAST CLAIM IS NOW WRONG, and 007 is why.** It said steps 2 to 5
had to land together — "a tenant column with the old policies is a column
nothing reads; new policies without patched inserts break every save."
That was written when the application was going to supply `tenant_id` on
every insert.

**007 gives the four tables a column DEFAULT of `current_tenant_id()`,
so the application never sends a tenant at all.** Eleven insert call
sites needed no edit. The premise for bundling has gone with them, and
the steps can now land one at a time — which is much better, because
each can be verified alone.

Three reasons the default beats patching the call sites, in order of
weight:

  1. **It is more secure.** A client that supplies a tenant is a client
     that could supply the wrong one. The value now comes from the
     session and never from the browser — the same reasoning that makes
     `api/invite-user.js` ignore a `tenantId` in the request body.
  2. **It fixes the offline queue**, which was the sharpest risk on the
     list above. Plays sitting in localStorage from before the migration
     carry no tenant_id, and patching the insert sites would not have
     helped them — those rows are already serialised. A column default
     fills them at insert time, so a surviving queue replays cleanly.
  3. Eleven fewer edits, four of them in `game.html`.

It depends on `auth.uid()` being present, which it is for every browser
insert and for none of the service-key endpoints — and none of those
insert into these tables, verified. If that ever changed, the default
would evaluate to NULL and hit the NOT NULL constraint: a loud failure
rather than a row filed under the wrong school, which is the right way
round.

`teams` deliberately gets NO default. A team is created when a SCHOOL is
created, by the platform, and `current_tenant_id()` is null for the super
admin at exactly that moment.

### WHAT HAPPENED WHEN 006-008 WERE RUN — 24 August 2026

Run against production in one sitting, with no games in progress. Pre-flight
first: trigger name, pgcrypto schema, exactly one `is_our_team` row, no
triggers outside the baseline, 2,724 plays. All clean.

**006** — 5,372 rows backfilled with no losses: games 14, plays 2724,
players 200, game_rosters 2426, profiles 7, teams 1. Every table showed
`rows = with_tenant`. `plays_immutable_when_final` came back ENABLED,
which was the one thing that could have been left dangerously open.

**007** — four defaults in place, `teams` and `profiles` correctly
without. Then the test that mattered: three plays saved from a real
browser, none sending a tenant, all three stamped from the session. That
proved the whole chain — `current_tenant_id()` resolving from a live
Supabase JWT, through `security definer`, past RLS on `profiles`, inside
a column default. Everything before that was simulation.

**008 — A FIX FOR A MISS IN 007, found in production within minutes.**
Creating a game failed outright: `null value in column "team_id"`.

`006` made `games.team_id` NOT NULL. `007` was written and NAMED "the
tenant defaults", and that framing is exactly what hid it — `team_id` is
not a tenant column, so it was not on the list, even though the same
migration had just made it required. Three paragraphs in `007` explain
why `teams` gets no default, and none of them looked at the column
immediately beside it.

**A new NOT NULL column needs a default or a writer. Every time.** After
the fix, every NOT NULL column across all seven tables was audited:
`games.team_id` was the only gap, and everything else was a column the
application has always sent.

Two things reduced the cost. It failed LOUDLY and immediately rather than
silently — a wrong tenant_id would have been far worse than a missing
team_id. And `current_team_id()` orders by `created_at` rather than
taking an unordered `limit 1`, because an unordered limit returns
whichever row Postgres feels like, which is the precise fault that made
`is_our_team` Hazard 0.

Verified from a browser after 008: game creation, play entry, roster
additions.

### THE vMIX FEED WILL NOT BREAK AT 009 — a correction, 24 Aug

An earlier note in this document said the feed had to be tested BEFORE
009, on the reasoning that a policy of `tenant_id = current_tenant_id()`
would deny every row to a caller with no session and take the overlay
blank on air.

**That was wrong, and the mistake is worth keeping.** The reasoning
stopped at "no session, so the function returns null" without asking
whether the policy would be consulted at all. It will not be.

All five read endpoints — `feed.js`, `gamedata.js`, `seasondata.js`,
`og.js`, `share.js` — use `SUPABASE_SECRET_KEY`, which is the service
role, and `000_baseline.sql` line 44 creates that role with **BYPASSRLS**.
Demonstrated rather than assumed: with a tenant policy in force, a
BYPASSRLS role still saw every row while an ordinary role with no session
saw none.

So 009 cannot blank the overlay. RLS is not in that path.

**The real problem is the opposite one, and it is worse.** Because those
endpoints bypass RLS, 009 gives them NO PROTECTION AT ALL. With a second
school, `api/feed.js` would serve their live game to anyone who asked.
That is Hazard 2, and it means tenant isolation for the feed has to be
written BY HAND, in code, against `tenants.feed_key`.

RLS will cover the whole application EXCEPT these five files.

- [ ] **Test a vMix browser input when hardware is available.** No longer
  a gate on 009 — it is a gate on selling to a SECOND SCHOOL, which is
  weeks away rather than days.

### 009 RAN, 24 August 2026 — the app is isolated

Pre-flight: all seven profiles carried a tenant, so nobody lost access.

Verified in the live app afterwards: dashboard (all 14 games), opening a
game, entering a play, the roster page, adding a player, a recap, and a
season report. **The recap mattered most** — it is the path deliberately
left untouched, and a tenant clause leaking into those anon policies
would have shown a published recap as empty. That is the failure a coach
finds rather than the developer.

Proven in scratch with two schools before it went near production:

    Neville   sees games 3, plays 3, teams 1, tenants 1
    Riverside sees games 1, plays 1, teams 1, tenants 1
    Platform  sees games 4, plays 4, teams 2, tenants 2

Six attacks, all repelled: reading another school's play by exact id,
updating their game, inserting into it while naming their tenant,
**moving one's own game into their tenant** (which is what `with check`
exists for), and setting one's own subscription to 'active'. Editing
one's own branding still works.

The DOWN was run and proven rather than read: afterwards Riverside saw
all four games again, so the original `using (true)` policies were
genuinely restored and not approximately.

Two things were added that this plan had not anticipated:

  * **`tenants` needed its own policies.** It is a 006 table and RLS had
    never been enabled on it.
  * **A billing guard trigger.** `tenants_update` lets a school edit its
    own row, which must not reach `subscription`, `renews_on` or
    `feed_key`. Postgres has no column-level WITH CHECK, so a trigger is
    the only mechanism. A customer able to set their own subscription to
    'active' is not a business.

Also noted: `statchatadmin@statchat.co` does not exist yet and no account
carries `is_super_admin`. 009 works without one — it just means the
super-admin path is untested against production, and no account can
currently reach across schools. Academic with one school; do it before
the second.

### 010 RAN, 24 August 2026 — hazards 1, 2 and 4 closed

The last real security gap. RLS secured the whole application except the
five service-key endpoints; this is the hand-written half.

**What it found on the way.** Only `feed.js` checked a key at all.
`gamedata.js` served the on-air game to anyone with the URL and
`seasondata.js` served an ENTIRE SEASON — no key, no token, nothing. With
one school that was a known and accepted position. With two it is a
cross-tenant leak with nothing behind it.

`feed.js` also read branding through `is_our_team`. That is Hazard 0
inside a service-key endpoint, where it is worse than in the app: RLS
would have scoped it there and nothing does here. With two schools it
matches a row in EACH, and an unordered `limit(1)` returns whichever
Postgres feels like — the overlay would have worn the wrong school's
colours with no error anywhere.

`og.js` and `share.js` needed no change: a share token identifies one
game, and a game belongs to one tenant.

**The schema half.** `one_broadcast_game` became per-tenant and
`games.designator` unique per tenant. Tested both ways — two schools can
each run a game called "2026-W1" and each be on air at once, but one
school still cannot broadcast two games simultaneously.

**Verified end to end in production**: `broadcast_setup.html` served the
tenant's key, the feed URL returned data with it, and altering one
character returned `Invalid or missing key`.

### THE BUG THIS SHIPPED WITH, AND WHY

`feedkey.js` was rewritten to return the tenant's key and reached
production throwing a ReferenceError. It used `adminClient` and
`profileRows` — **the variable names from `manage-users.js`, copied
without reading the file being edited**, where the client is `admin` and
the profile result is `profile`. The surrounding `catch` swallowed it
into a 500, the page fell back to keyless addresses, and the only visible
symptom was a feed URL with no key on it.

Two failures, and the second is the one that matters:

  * naming conventions were carried across from a neighbouring file
    rather than read from this one;
  * **the endpoint was never executed.** Every other change that day got
    a functional test; this one got `node --check`, which will happily
    pass a file full of undefined variables.

It also shipped stale advice: `broadcast_setup.html` told the reader to
set a `FEED_KEY` environment variable — the exact thing 010 retired. Same
shape as the `team-icon.js` miss: the mechanism changed and the
documentation describing the old one was left in place.

- [ ] **Delete `FEED_KEY` from Vercel.** Nothing reads it; 010 replaced
  the only branch that did. A retired secret in the config is the thing
  this migration existed to abolish.

### THE CALLERS 010 FORGOT — found in production, 24 Aug

010 scoped the API endpoints and gave the raw feed addresses a key. It
did **not** touch the three pages that CALL those endpoints, nor the
overlay addresses handed out on the same setup page. So the feed URLs
worked and every overlay returned 401.

**Scoping an endpoint is half the job. Finding its callers is the other
half.** Nothing in the test suite looked for callers, which is why the
fix shipped with `tests/overlay_key_check.js` rather than a note.

The three overlays now read `?key=` from their own URL and pass it
through. That is the only mechanism available: an overlay is a browser
source in vMix with no session, so its key must travel in the address it
was opened with, exactly like a feed's.

### A bulk edit that got fourteen of fifteen right

`broadcast_setup.html` builds the overlay addresses TWICE — ten for the
on-screen list, five more for the emailed setup instructions. Andy
noticed the screenshot showed ten while the conversion reported fifteen,
and asking about the difference found a bug.

One of the five was written differently:

    overlayUrl('/broadcast_leaders.html?view=') + v

which put the key in the MIDDLE — `?view=&key=abc...rushing` — so the
email would have handed out six dead addresses. The on-screen list built
each URL whole and was fine, which is precisely how it would have gone
unnoticed until somebody followed the emailed instructions.

**A mechanical edit is only as safe as the assumption that every call
site has the same shape**, and that assumption was never checked before
the regex ran. The check now rejects any concatenation onto
`overlayUrl()`.

### Two checks that were wrong rather than the code

Worth recording together, because they are the same mistake:

  * `overlay_key_check.js` first read only the 220 characters AFTER each
    fetch and reported three failures against correct code — the query
    string is assembled on the lines ABOVE, which is the ordinary way to
    write it. **A check that only passes when the code is written the way
    the check imagined is worse than no check.**
  * `feedkey.js` was verified with `node --check`, which will happily
    pass a file full of undefined variables. It reached production
    throwing a ReferenceError.

Verified in production: page links and emailed links both render.

### THE PLATFORM CONSOLE, AND A SECOND TENANT — 24/25 August 2026

**013** creates a tenant and its first team ATOMICALLY. A tenant without
a team is invisibly broken: twelve pages read the team to find out who
"we" are, and every one comes back empty. Proven by forcing the team
insert to fail in scratch — zero rows of either survived.

**014** lets the platform suspend a tenant. A suspended tenant READS
everything and WRITES nothing. Cutting reads was the obvious reading and
the wrong one: an overlay is a read, and a crew losing its scoreboard
mid-broadcast loses it in front of an audience over a decision reversible
in seconds. Enforced by TRIGGERS rather than policies, because RLS does
not refuse — it makes rows invisible or matches nothing, and a coach
would see a silent no-op instead of "This account is currently suspended."

`subscription` and `disabled_at` are separate columns on purpose. The
first question in the support call is which one it is.

**platform.html** — Tenants, Users, Recovery tools. Tenants shows crests,
status and counts, and creates or suspends. Users is grouped by tenant
and READ-ONLY: acting on a customer's staff from here would be the
platform changing a tenant's people with nothing recording it, and that
waits for the audit trail.

**A SECOND TENANT NOW EXISTS IN PRODUCTION**, created through the app,
defaulting to the neutral greys because it has no colours yet. That is
the proof the whole plan was building toward — and it changes the status
of everything below from theoretical to live.

### THE SERVICE ROLE HAS NO auth.uid(), AND THAT COST TWO BUGS

`restore_game()` refused from the SQL editor. Correct — `postgres` has no
`auth.uid()`, so `is_super_admin()` is false. Diagnosed, explained, moved
on.

Then `create_tenant()` refused the platform account in production, for
**exactly the same reason**: `api/create-tenant.js` called it with the
service key. It is the only function in the app invoked from a SERVER
rather than a browser, which is why it is the only one that hit it.

Fixed by building a second client carrying the caller's own JWT, so
`auth.uid()` resolves and the function's check means what it says from
either side. **A lesson learned in one context did not get carried to the
next one an hour later.**

### 015 — THE ANON BRANDING POLICY, 25 August 2026

`anon reads our branding` on `teams` used `is_our_team = true`, written
when that meant "the only team". Every tenant's team carries the flag, so
with a second tenant it meant "every team on the platform" — and
recap.html, which anonymous viewers open, then took whichever row came
first.

**A public recap could already be wearing the wrong school's colours.**
Demonstrated in scratch: under the old policy an anonymous reader saw all
three tenants' teams; under 015, exactly the one with a published game.

009 had got this right for `tenants` and left `teams` on the old flag,
because at the time the flag still described reality. That is the shape
of the whole `is_our_team` problem: rules that were true when written and
quietly stopped being true.

### 015-017, AND THE END OF is_our_team — 25 August 2026

**015** rewrote the anon branding policy on `teams`. It used
`is_our_team = true`, which meant "the only team" when it was written and
"every team on the platform" once there were two — so a public recap could
show another school's colours. Demonstrated in scratch before the fix:
three tenants' teams visible to an anonymous reader.

**016** made deleting a tenant a SOFT delete. `tenants` cascades to five
tables, so a real DELETE destroys everything that customer ever entered.
Enforced in one line — `current_tenant_id()` returns NULL for a deleted
tenant, and NULL never equals anything, so all seventeen policies deny at
once. The first version had the games policy query `tenants` while the
tenants policy queried `games`, and Postgres reported **infinite recursion
in policy for relation "games"** — every public recap would have errored.
Broken with a SECURITY DEFINER function: two RLS-protected tables that
reference each other cannot do it by subquery.

**017** dropped `logo_url`, `primary_color` and `secondary_color` from
`tenants`. 006 copied branding there intending to repoint the app later;
the app was never repointed, so the copy went stale the day it was made and
the console showed a logo from August. **A duplicated column is a bug with
a delay on it** — both copies are right when made, and nothing says which
one a reader used until they disagree.

**is_our_team is gone from every read.** Twelve files, not the ten a first
grep found: two queries spanned two lines. `api/og.js` read it with the
service key, so a shared recap's link-preview card — the image iMessage and
Slack show — could be painted in another school's colour.

### The order now

    006  columns, backfill, functions, signup trigger   <- DONE 24 Aug
    007  column defaults                                <- DONE 24 Aug
    008  games.team_id default                          <- DONE 24 Aug, fixing 007
    ---  test the vMix feed                             <- OPEN, before 009
    009  RLS rewritten                                  <- DONE 24 Aug
    ---  REMAINING, in order of what blocks a second school:
    010  feed key scoping + per-tenant uniqueness      <- DONE 24 Aug

    011  storage scoping                              <- DONE
    012  soft delete for games                        <- DONE
    013  create a tenant atomically                   <- DONE 25 Aug
    014  suspend a tenant                             <- DONE 25 Aug
    ---  platform.html console                        <- DONE 25 Aug
    ---  a second tenant in production                <- DONE 25 Aug

    WHAT REMAINS. No hazard is open, but two items below stopped being
    theoretical the moment a second tenant existed:

    1. IS_OUR_TEAM, and it is now sharper than 'presentation only'.
       Twelve files still read `.eq('is_our_team', true)`. For a TENANT
       user that is harmless: RLS scopes `teams` to their own row, so the
       query returns the right team. For the PLATFORM it is not. Every
       tenant's team has the flag TRUE, teams_select returns all of them,
       and limit(1) picks whichever Postgres feels like -- so
       customize.html, roster.html and reports.html would show the
       platform an ARBITRARY tenant's data, and customize.html would let
       it edit that tenant's branding.
       The dashboard bounce keeps the platform off those pages by
       accident, not by design. Fixing this properly is the next real
       piece of work.

    2. THE SWEEP for unfiltered queries safe only because RLS narrowed
       them. Three found by accident so far. Same root cause as above.

    3. VIEW A TENANT as the platform -- the Open button. `?as=` is wired
       into dashboard.html as a named bypass but does NOTHING yet: no
       scoping, no banner. Both are required before it ships.

    4. AUDIT TRAIL. Every write policy ends `or is_super_admin()`, so the
       platform can already write into any tenant. Deferring 'Act As'
       withheld the interface, not the capability.

    5. SUBSCRIPTION AND LAPSE. 014 gives the platform a suspend switch;
       nothing yet acts on `subscription = 'lapsed'` automatically.

    6. TEST A vMIX BROWSER INPUT when hardware allows.

**008 is held until a real game has been run through 007.** A wrong
policy does not error; it returns fewer rows, or more. Separating it
means anything that breaks afterwards has exactly one possible cause.

### The rule for each step

Every migration from step 2 onward is proven the way `000_baseline.sql`
was: applied to an empty Postgres, captured with `sql/capture/A..G`,
diffed against the expectation, and each assertion broken to confirm it
can fail. **Do not run any of them against production first.** The
baseline exists so that a scratch database is available; that is the
whole reason it was built.

### The rollback that must exist before step 2

Adding `tenant_id` is reversible. Rewriting twenty-one policies is
reversible on paper and terrifying in practice, because a policy that is
subtly wrong does not error — it returns fewer rows, or more. The
migration that rewrites RLS must be paired with a `DOWN` script that
restores the captured policies verbatim from `000_baseline.sql`, and that
down-script must be tested by running it, not by reading it.

Anything that adds a NEW page (the school list, the subscription view)
should use the three agreed breakpoints from the start — see the
breakpoint note at the head of `statchat.css`.
