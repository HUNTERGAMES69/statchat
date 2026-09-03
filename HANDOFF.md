<!-- Copyright 2026 StatChat. All rights reserved. Unauthorized copying,
     modification or distribution of this software or its documentation
     is prohibited. -->

# StatChat — session handoff
### Last updated 3 September 2026, evening. Everything above the first `---` is current; the rest is history kept for reference.

## WHERE THINGS STAND — 3 September 2026, the night before game two

**Sixteen tenants score live tomorrow, Friday 4 September.** The first live
regular-season weekend was 29 August; this is the second and much the
larger one.

Nothing in the app's scoring path changed today except one deliberate
correction, described first because it is the only thing that alters
numbers already in the database.

### The correction that matters

**Sack yardage now lands on the quarterback's own rushing line**, not on a
`TEAM` row. NFHS charges "that player" a time carried and minus rushing
yards; NCAA agrees; the NFL is the outlier that takes it out of team
passing. Our code and three of our documents had said the opposite. Found
by an outside review, verified against the Statisticians' Manual.

Six lines, in both `computeBoxScore` and the independent `auditBoxScore`
oracle. **Team rushing totals are unchanged by construction** — the same
attempt and the same loss on a different row inside the same team — so no
tile, feed or report moved.

**What tenants will notice:** a quarterback now appears in the rushing
table even if he never chose to run. Sacked three times for 21 shows
`3 att, −21 yds`. That is correct and it is what MaxPreps shows. It is
worth a line in Friday's email, because it will look new.

The box score is computed at read time, so this repaired every game already
stored, not only tomorrow's.

### Also closed today

- **The known gap named in the 30 August handoff is fixed.** A completed
  pass with no receiver that is then fumbled no longer builds a code the
  parser refuses. The panel now requires the receiver on that one path and
  says why; the engine's `Unknown` fallback was corrected as well, so the
  two completion branches agree.
- **Migration 044** — three privilege paths RLS does not cover. Applied,
  verified, ON AIR confirmed working afterwards.
- **Migration 045** — in-app bug reports and feature requests. Applied.
- Platform can delete a user and invite one into a tenant.
- Overtime scoring plays no longer stamp a clock reading.
- `scoresummary.html` shows FINAL on a finalized game.
- Terms of Service live and linked from login and account.
- `statrules.html`, the public stat rule book, and `help.html` retitled to
  the how-to so the two stop competing for one search.
- `support.html` on the brochure, reachable from the header on mobile too.

### The kneel — half-addressed on purpose

NFHS credits the player with a kneel's rushing loss; we charge `TEAM`.
Fixing it properly needs the entry panel to ask **who took the snap**, and
the `kn N` play code has no room for a player. Instead the panel now says
in amber that the button is only for a true clock-killing kneeldown taken
at the spot, and that anything which actually lost ground belongs on the
Rush tree under the quarterback's number.

That reduces the entire divergence to **one 0-yard rushing attempt**. It is
documented as a StatChat choice on both public pages rather than dressed up
as a rule. A bad snap stays on `TEAM` and is correct — the manual says so.

### What is NOT done, and none of it is urgent

- **The golden fixture.** `accuracy_check` gained four correct sack diffs
  today and was **already red with fifteen unblessed ones** predating this
  session. `--update` is all-or-nothing, so blessing mine would accept
  those too. It has been stale since at least 24 August and is currently
  giving no signal at all. Half an hour, worth doing properly.
- **`link_check`** — a test that every internal `href` resolves to a file
  that exists. Would have caught today's filename break in one run.
- **`.vercelignore`**, written and held for a quiet day.
- **An admin view of the feedback backlog.** SQL editor only; `handled` is
  set by hand.
- Charging the kneel to the player, if it is ever wanted.

### Two things only a person can do

1. **`support@statchat.co` and `features@statchat.co` must actually receive
   mail.** Three paths point at them now — the account form, the brochure
   support page, and a mailto. Resend does not need them verified to send
   *to* them, so if the aliases do not exist nothing will fail loudly and
   the rows will simply pile up in the database with `notified = true`.
   One test send each settles it.
2. **Publish the release note.** `releases.js` carries a note dated
   3 September about the feedback form. Uploading the file makes it a
   draft; a platform admin has to press Publish for anyone to see it. That
   separation is deliberate — see migration 037.

### If something goes wrong tomorrow

The scoring path — `game.html`, `engine.js` — changed today only for the
sack re-attribution and comments. If a tenant reports numbers that look
wrong, check whether it is the quarterback's rushing line before assuming a
regression: that one is intended and correct.

`ROLLBACK.md` is the procedure. Migration 044 and 045 are both additive and
neither touches the scoring path.

### Lessons this session, worth reading before the next one

**A code comment asserting an external rule is a claim, not a citation.**
The sack error reached three documents because it was read out of two
comments that named a rule book without citing one. This project already
had *where a comment and the code disagree, the code wins* — and it did not
help, because comment and code agreed with each other and were both wrong
about the world outside the repo. **A stat engine's correctness is defined
by documents that are not in this repository.**

**A verify query must be able to support its own label.** Migration 045's
row 6 was labelled "nothing outside public.feedback was touched" and asked
whether `anon` holds write privileges on four core tables. It does, and has
since those tables were created. It reported FAIL on a migration that
granted nothing to anybody, and three follow-up checks repeated the mistake
by asserting absolutes where the property was conditional.

**Say when a filename is load-bearing.** `statrules.html` has no hyphens on
purpose: it shipped twice as `how-stats-are-counted.html` and lost them in
transit both times, leaving 404s behind every link, a 404 in the sitemap
and a canonical pointing nowhere. Do not tidy it back.

---

## WHERE THINGS STOOD — 30 August 2026, evening

**The first live regular-season game has not happened yet.** Everything in
the database up to now is development and demo data.

### Closed today

- **Item 8, series tiles.** Four tiles replaced the Previous Drive card on
  the crew view. They survive a PAT — that took two goes, and the fix in
  the end was dropping the tiles 110px → 96px, because the quad had been
  fitting its contents in exactly 524px of 524px with zero slack.
- **Item 2, tackler credit on the kicking trees.** Kickoff and punt
  coverage tackles credit correctly on all three entry paths — panel,
  picker and guided — and the log line now names the tackler.
- **Item 4, time of possession.** Eight of nine decided lines shipped. The
  possession-complete view was dropped; the reason is written into
  `LIVE_GAME_FEEDBACK.md` and is worth reading before anyone rebuilds it.
- **Print formatting.** Every label on the recap and stat package was below
  the accessibility threshold; all now at 6.0:1. The stat package's scoring
  summary could never break across pages — a rule three lines below its own
  documented opt-out was silently overriding it.

### Still open on the live list

`LIVE_GAME_FEEDBACK.md` remains the live list. **1** needs a decision
between the structural fix and the cheap pair; **3** is decided and not
built; **5** and **6** are raised but not designed — though item 6 now
names a bounded first slice, found while closing item 4.

### The known gap  — CLOSED 3 September 2026, see the top of this file

A **completed pass with no receiver that is then fumbled** builds a code
the parser refuses: "Unrecognized entry", and nothing saves. All three
recovery choices are affected. It predates this session. Workaround: put a
number in the receiver box before marking the fumble.

*(The panel now requires the receiver on that path and says why. The
underlying parser limitation — a leading player token must be numeric — is
still there and is tracked in TODO §5b2.)*

### Tests

Six repo tests were updated today. About ten in `tests/` still fail for
reasons predating this session, and several of them are not tests at all
(`convert.js`, `coverage_probe.js`, `RECOVER_STRANDED_PLAYS.js`).

Eighteen verified suites live OUTSIDE the repo, in a scratch directory, and
have no standing coverage — the series tiles surviving a PAT, NO RECEIVER
SELECTED, the cover tackle reaching both the box score and the rendered
package, the guided kickoff, the clock moments and prefill, the partition
check, and the message checks that assert what a message must NOT say.
**They pass and they are not in `tests/`.** Porting them is the single
biggest piece of unbanked work.

### What today should have taught

- **A check can be green for the wrong reason.** Five times today. The tell
  each time was printing the underlying value beside the verdict — a pass
  with a suspicious value next to it is worth more than a pass alone.
- **Shared DOM elements keep the last play's content.** Three separate bugs,
  same shape: a label or note written for one play and not reset for the
  next. Hidden is not reset — one display toggle away from visible.
- **Specificity beats source order, and CSS does not warn you.** The stat
  package's scoring summary carried a documented opt-out that had never once
  taken effect, because an equally specific rule sat three lines below it.
- **Say the facts; the scorer decides what they mean.** Four messages
  written today guessed at causes or gave instructions. The people using
  this know the game better than the app does.

---

## The headline: the rail layout is now the live entry page

`gametest3.html`'s rail prototype was promoted into `game.html`. The URL did
not change — `dashboard.html` still navigates to `game.html?id=`, so
bookmarks, open tabs and deep links keep working.

`game_legacy.html` is the fallback: the previous entry page, verbatim, with
a banner at the top saying so. It **replaced** an older `game_legacy.html`
that predated the keypad and carried none of the recent fixes — a fallback
that can itself deadlock is not a fallback. The older file is in git
history.

**`gametest3.html` should be deleted from the repo.** It is now a
byte-level duplicate of `game.html` and will drift the moment either is
edited. Tracked in `TODO.md`.

---

## What the entry page looks like now

- **Ladder** in a fixed left column. Every tree opens beside it and locks
  to the top of the frame, so the panel never moves depending on which
  button was pressed. Nothing open reads "Make a selection to begin".
- **Left margin** holds the current drive with Undo/Redo.
- **Right margin** holds two new panels: **Checks** (live `validateGame`,
  debounced 400 ms because it is quadratic in play count) and **Live
  totals** (both teams' figures, per-team leaders, team defence).
- **Top row**: Dashboard, ON AIR, BROADCAST SETUP, HELP!, CREW VIEW — all
  sized from the banner so the five blocks across the top match.
- **Review** collapses the tree to just the confirm box; **Edit** restores
  it with values intact. There is a Clear on the confirm box and another on
  the phase row.
- Kicker and punter collapse to one name plus `+N more`; the passer folds
  to a chip once picked. No suggestion prefills a manual box any more — the
  highlight says who is suggested.
- Long picker lists (carrier, receiver, kicker, punter) run full width with
  the `or type #` box at the end rather than in a reserved column.

## Spectator and broadcast

- `view.html`: halftime ends on "Start 2nd half" rather than on the
  kickoff; the scoring summary takes the quad at halftime and reads GAME
  FINAL at the end; the second-half kicker is named under it; play text
  breaks at its own clauses; the down line uses **team names** rather than
  own/opp.
- **New**: `broadcast_stats.html` — team stats plus leaders, landscape and
  `?layout=portrait`, with the Nettech sponsor bar. Needs
  `sponsor_nettech_white.png` in the repo root.

## Engine and correctness fixes this session

- Guided kickoff **return touchdown deadlock**: `awaitingKickoff` and
  `awaitingTry` could both fire, disabling every play type. Resolved in
  favour of the try.
- **Quarter boundary off-by-one**: 0:00 at the end of a quarter read as
  12:00 of the next one, so a finalized game reported "12:00 (Q5)" and
  invented an overtime. Applied at every quarter end, not just the last.
- Undo now removes a **stranded Q3 marker** so `game.html` and `view.html`
  cannot disagree about halftime.
- Penalties show in the Current Drive tile whoever they were called on.
- Bad snap recovered by the defence says "fumble"; an incompletion reads
  "pass incomplete".
- Flip possession asks first.
- Clear now closes the manual entry panel, which it never did.

---

## Not yet done

**Return stats.** Agreed and scoped, not started. `roles` does not persist
return yardage — it exists only inside the play text — so that is the
blocker and the first step. Then count it in `computeBoxScore`, then
display in recap, stat package, season report, view, and a leader overlay.
Andy's calls: kickoff and punt returns **combined**, and **yes** to the
broadcast overlay. History will not backfill.

**Roster quick reference** — discussed, not designed.

**Duplicate surnames.** Picker buttons show surname only, so two players
with the same surname read alike at a glance. Worth checking the real
roster before the beta.

---

## Resuming

Pull from `raw.githubusercontent.com/HUNTERGAMES69/statchat/main/` first —
do not assume the working copy is current.

**Do not run `tests/mutation_check.js` unless it can finish.** It
deliberately breaks source files and restores them at the end; an
interrupted run leaves `game.html` broken. This happened once this session
and the stranded mutant looked like a real engine bug.

---

## THIS SECTION IS STALE — kept as history (noted 23 August, still true of what follows)

Everything above is the 22 August picture. Three items in it were already
overtaken the next day:

- **`gametest3.html` deletion** — done and verified; it, `gametest.html`,
  `gametest2.html` and the three `layout_mockup*.html` files all 404 from
  GitHub. The mentions left in `game.html` are comments recording where the
  rail layout came from, and stay accurate as history.
- **Return stats** — listed above as "not started". They were built the
  same day and appear in recap, stat package, season report and player
  report.
- **Kickoff and punt returns are kept SEPARATE**, not combined as stated
  above. Split later the same day; cheap because `roles.returner` carried
  `kind: 'kick' | 'punt'` from the first commit.

Nothing above covers the 23 August session: eleven play-through bugs, iPad
portrait, `statchat.css` reaching 15 of 18 pages, or the season report
rebuild. `TODO.md` is the current work list; `PROJECT_NOTES.md` carries the
reasoning. Read those two and treat this file as background.


---

# WHERE TO PICK UP — end of 23 August 2026

**Next task: multi-tenancy step 1 — design the overlay auth.**
See `MULTI_TENANT_PLAN.md`, and `TODO.md` section "RESUME HERE".

Password reset is DONE and proven end to end (24 Aug): link, email,
landing page, new password. Custom SMTP was never outstanding — Resend
was already configured, and an entry claiming otherwise has been
corrected.

## What closed on 23 August

**Season report.** The per-game charts did not scale from game 1 to
game 15. Rebuilt as one column at every width; checked against a real
PDF and accepted. The root cause was not the one in the brief — the
PRINTED report was running the phone stylesheet, because Letter minus
default margins falls under 767px, while the Chart.js canvases kept the
widths they were built at on screen. Screen and printable width are now
made equal so there is nothing to re-measure.

**Multi-tenancy step 0, versioning the schema.** The real gap was worse
than the plan said: there was not one `CREATE TABLE` statement in the
repo. `sql/` now holds a proven baseline, a `schema_migrations` table,
seven read-only capture queries that work from the Supabase SQL editor
without a direct connection, and a `history/` folder for the
pre-baseline scripts.

The capture found four things nobody had listed, including a policy that
does not restrict what its name says it does — `admins set game
visibility` is PERMISSIVE alongside `games_update`, and permissive
policies OR together, so a `game_entry` user can publish a recap.
`MULTI_TENANT_PLAN.md` now lists six hazards rather than three.

## Also closed on 23 August — the public site

`statchat.co` is now a one-page brochure; the app's sign-in moved from
`index.html` to `login.html`, and 28 redirects across 14 pages were
repointed from `/` to `/login.html`. Verified live.

Everything else stayed where it was on purpose: the `/g/:token` share
links parents already hold, the vMix input URLs, and every deep link.
That is why the brochure went on Vercel rather than GoDaddy — moving the
app would have broken all three.

`login.html` also gained a password reset. The code is done and tested;
the flow is NOT yet proven end to end — see TODO.

## What closed on 24–25 August — multi-tenancy, and then the polish

**Migrations 006 to 017 all ran against production.** Tenant columns and
backfill, column defaults, RLS rewritten, per-tenant uniqueness, storage
scoping, soft delete for games, create-a-tenant, suspend-a-tenant,
delete-a-tenant, and the stale branding copy dropped. Every one has a DOWN
script that was RUN rather than read. A second tenant exists in production,
created through the app.

**The platform console** (`platform.html`) — Tenants with create, suspend
and delete; Users grouped by tenant, read-only; Recovery tools for deleted
games and deleted tenants. `statchatadmin@statchat.co` lands there rather
than on a tenant's dashboard.

**No security gap remains.** `is_our_team` is gone from every read — it
meant "the only team" and was true for every tenant once there were two.
That reached twelve files, two service-key endpoints and one anon policy.

Then a run of interface work: the StatChat mark on eight pages, uniform
Dashboard buttons, the dashboard header rebuilt, roster upload guidance
with a picture of the spreadsheet, hard caps on roster imports, logo type
and size validation, halftime totals on the crew view, and the season
carried back from a report.

### Read before touching the game page's top bar

`PROJECT_NOTES.md` has a section on it. Adding a 32px logo there took seven
attempts, all of them correct in the file and wrong in the browser, because
`#headerLeft > *` sets `flex:1 1 0` at specificity (1,0,0) and no class
rule can outrank it. The width of that row is also derived from the
viewport and is over budget at 1280px before anything is added.

**When a style is not applying, instrument the page rather than re-reading
the file.** `gamemock.html` is a copy of `game.html` kept for exactly that.

## Standing constraints

- **Do not run anything against the production database.** Andy's call.
  The baseline exists to be committed and to build scratch databases.
- **The harness cannot see anything visual.** jsdom has no layout
  engine, ignores `@media` entirely, and cannot settle `!important`.
  Batch visual work and ask for one look; do not iterate blind.
- **Nothing is written to `tests/` during a session** — ad-hoc
  verification, then one batch at wrap-up. The 23-24 Aug batch is
  WRITTEN: four site checks, listed in `tests/README.md`.
- **A source file that contradicts a documented decision is more likely
  a failed upload than a change of mind.** `team-icon.js` at the repo
  root was still the pre-22-Aug version and nearly caused a settled
  decision to be reversed. Three uploads have silently failed on this
  project; check the document before "fixing" the file.
- **Verify uploads from the codeload tarball**, not
  `raw.githubusercontent.com`, and wait a minute before concluding a
  step failed.
- **Upload a batch as ONE commit** — GitHub's Add file → Upload files,
  not the pencil icon per file. One commit is one Vercel deploy; editing
  16 files individually is 16 builds, and that hit the deploy limit on
  23 Aug and blocked a release.
- **`www.statchat.co` is the canonical hostname.** The apex redirects to
  it. Anything configured against the bare apex — Supabase Site URL, vMix
  inputs, share links — should be checked.
- **Read the log before explaining a failure.** Vercel Deployments,
  Supabase Auth Logs, the browser address bar. Four theories were offered
  ahead of their evidence on 23 Aug and two were simply wrong.

---

# WHERE TO PICK UP — end of 26 August 2026

Reasoning for all of this is in `PROJECT_NOTES.md`; this is the short list
of what changed and what needs doing.

## Needs running at Supabase

- [ ] **`sql/023_tenant_sponsor_bar.sql`** — adds `tenants.sponsor_bar`
  (default false) and switches Neville on. Already run once; noted here so
  a fresh environment gets it. A migration reporting **"no rows returned"
  is success** — `ALTER`/`UPDATE`/`INSERT` return no rows, and mistaking
  that for failure cost a round trip on 26 Aug.

## What closed on 26 August

- **Return yards.** Twelve typed boxes; three kept hidden as calculator
  output with the answer shown below, nine removed as uncredited. Every
  play code verified backward-compatible against saved history. `Or enter`
  labels dropped where nothing is an alternative any more.
- **Spot enforcement.** A change of possession is refused without a
  complete spot, from `showConfirm()` so every Review button is covered.
  Overtime states its own message. Hidden fields and touchdowns exempt.
- **Sponsor bar** is per-tenant via the overlay key, not a URL parameter.
- **Re-import roster** button in `create_game.html` edit mode, with a diff
  before committing. Our team only; refuses once a game has plays.
- **Pre-game controls.** Penalty and Timeout looked lit while disabled
  (inline fills beat `:disabled`); Manual entry was never disabled at all.
- **Guided kickoff** requires kicker and direction, and now says so — the
  guided panel had no message slot, so refusals had been silent.
- **Phone warning** on `game.html`: an overlay over a working app, not a
  block.
- **Text fields** recessed across six dark pages, including the autofill
  override that would otherwise have repainted them.

- **Manual entry removed entirely** — button, panel, handlers and its CSS
  class. The `unresolved` column and its seven readers stay; nothing creates
  one now. The rail keeps the row it occupied so no other button moves.

- **Crew view: the fourth tile row is back.** Penalties and 3rd Down were
  being rendered and clipped -- the dark conversion raised the tile value
  from 34px to 39px and nobody checked the column. Two `min-height:0`
  releases let the rows compress; the value is now
  `clamp(26px, 3.1vh, 39px)` so it cannot spill instead.
- **Crew view: field goals and PATs are separate rows.** They shared one
  five-column line guarded by a single condition, so a PAT-only kicker
  filled three columns with dashes. 42% narrower.
- **Crew view: the football and TOL disappear at halftime and final**, the
  same two states the drive cards already hide on, reading the same `phase`.
- **The clock keypad no longer opens over a touchback prefill.**

- **Penalties can be enforced from the spot of the foul.** A toggle beside
  Dead Ball, with a side and yard line. The play is still nullified -- enter
  the penalty INSTEAD of the play, not as well as it. On a kickoff, enter the
  kickoff first with its ending spot where the penalty will be enforced from.
- **`sql/024`: the on-air clear is scoped to one tenant.** It was clearing
  every school's broadcast game; the index has been per-tenant since 010 and
  the function was never updated to match.

- **TOP accuracy depends on WHEN the clock is read on a kickoff.** The change
  of possession is the catch, not the tackle. A late reading charges the whole
  return to the kicking team and moves TOP by twice the return time. Nothing
  can detect it -- documented in help.html section 7 and tips.html.

## Open, and worth knowing

- **The `maybeSingle` gap is FIXED** (26 Aug) and cleared several suites.
  What it uncovered: `cross_surface` says the season report and crew view
  disagree -- on LABELS, not numbers (`#22` vs `N Runningback`). Probably
  fixture shape; confirm against a live report before dismissing.
  **Measure the suite at a 45-second timeout**, not less: several legitimately
  need 25-45s, and a short timeout reports them as failures and makes any
  fix look like a regression.
- **Remaining red suites are harness gaps, not the app** — `maybeSingle`
  unstubbed, `supabaseClient` out of scope in `RECOVER_STRANDED_PLAYS`.
  Verified identical against the pre-session file. Several other suites are
  merely slow: `whitelist_check` needs about 41 seconds and passes.
- **Four Red Stick players carry `LUKE HENDERSON` as their position** — a
  column misalignment in the source spreadsheet. Fix the file, not the rows.
- **The demo game's roster snapshot predates the position upload.** Edit it
  and use Re-import to fix the missing kicker.

## Lessons worth carrying

- **An id can be overloaded across panels without being overloaded within
  one.** `pp_yards` means kick distance on a punt and the return on an
  interception. Checking per panel unblocked two changes that had looked
  dangerous for several steps.
- **A default in a render loop is not a default.** `renderAll()` runs on
  every poll, so anything it sets overrides the server on the next refresh.
- **An inline fill defeats every disabled rule on the page.** Enumerate the
  buttons; do not reason about which ones probably have one.
- **Adding a guard and a message in one edit needs the message checked
  separately.** `showReviewMsg` writes to an element `renderPlayPanel()`
  builds, so every refusal raised from the guided flow went nowhere.
- **Comment-anchored slices over-ran three times** on a file that builds
  HTML from concatenated strings, and `node --check` cannot see the damage
  because the result is still valid JavaScript. Count `<div>` against
  `</div>` in the affected branch, or slice by line number with assertions
  on the boundaries.
- **A test asserting a thing EXISTS is not asserting it is USED.** Four
  separate audits passed on mutations that left the shape intact and
  removed the behavior.


## Adding a platform account (noted 26 August 2026)

There is no button for it, deliberately: `invite-user` requires a tenant and
`manage-users` has no create action. See `sql/grant_platform_admin.sql`.

Two steps. **Create the auth user in the Supabase dashboard** (Authentication
-> Users -> Add user) -- not by inserting into `auth.users`, which carries
password hashes and identity rows that have to stay consistent. Then run the
UPDATE in that script to set `is_super_admin`, `tenant_id = null` and
`role = 'admin'`.

Edit the email in all three statements: `\set` does not work in the Supabase
SQL editor, and a variable it ignores is sent literally, matching nothing
while reporting success. Run the SELECT at the top first -- an UPDATE that
matches no rows is not an error.


# WHERE TO PICK UP — end of 29 August 2026

The first weekend two tenants ran live games. Everything below came from
watching a real game being scored or from a bug reported during one.

## Deployed and working

- **Bad snap records a fumble.** Was `playType: 'rush'`, so no fumble, no
  recovery credit, no turnover. Fixed at the PARSER, which is where the roles
  actually come from -- the click handler builds them as
  `pending.roles = pending.roles || {...}` and `parseInput` had already
  supplied them, so the first fix changed dead code and shipped broken.
- **Team tackles for loss.** An unattributed TFL vanished from the box score
  while the crew view counted it -- three on air against one in the stat
  pack. The engine now credits the TEAM row, and `view.html` and
  `broadcast_stats.html` read the box score instead of each reducing the
  plays themselves.
- **Defensive picker**: jersey order, stacked number-over-name at 72px, and
  shared numbers offer the picker's own unit first.
- **Tackled by** opens on render on the rush and pass trees.
- **Penalty quick row**: four buttons under the team choice, side-specific.
- **Kicker recency scoped per tree.** TWO mechanisms had to be fixed --
  `specialTeamsEligible` for the ordering and `KICK_DEFAULTS` for the
  preselection. Fixing one left the field goal kicker preselected on the PAT.
- **Player report printed a blank first page** for receivers: a 991px section
  card against ~958px of printable height, with `page-break-inside: avoid`.
  Cards may now break; the parts inside them may not.
- **view2.html** (renamed `scoresummary.html`, 30 Aug) -- a second crew
  view showing every scoring play with the
  drive behind it, two columns of nine, sized so eighteen fit at 1920x1080
  without scrolling. Nothing links to it yet; the entry point is undecided.

## Reverted deliberately

**Tackled by on the kicking trees.** The UI was written and pulled:
`TACKLE_TYPES` is `['rush','pass','sack']`, so the credit would reach
nothing. Item 2 in `LIVE_GAME_FEEDBACK.md` records the order of work.

## Read this next  (superseded — see WHERE THINGS STAND at the top)

`LIVE_GAME_FEEDBACK.md` is the live list, and still is. The counts below
were true on 23 August and have moved: items 2, 4, 7 and 8 are closed as of
30 August. Kept as written rather than edited in place, because the top of
this file carries the current position.

> Eight items: one agreed and ready to build, four with decisions recorded,
> three raised but not designed.

## What this session should have taught, and cost me time by not knowing

- **A test that asserts what you REMEMBER is worthless.** Twice: a check for
  "pages whose body centres with flex" was given a list I typed out, and
  `login.html` was not on it and had exactly the fault. Sweep the directory;
  derive the exceptions from the CSS.
- **Verifying a fix is not verifying THE fix.** The kicker ordering genuinely
  changed and the reported problem persisted, because a second mechanism
  decided the preselection. When a report survives a verified fix, look for
  the other thing that does the same job.
- **An assertion can be true and describe dead code.** The bad-snap test
  checked the click handler, which was correct and never ran.
- **A fixture where two rules give the same answer proves neither.** The
  punter was numbered 9, the lowest on the roster, so a numeric fallback and
  a working recency both put him first.
- **Adding a footer to nineteen pages is nineteen layout changes.** The
  copyright sweep broke `view.html` and `login.html`, both of which centre
  their body with flex, and the crew view is the page that goes on air.
- **`quarterLabel` takes a state, not a number.** `(state && state.quarter)
  || 1` means a bare integer silently becomes Q1.

