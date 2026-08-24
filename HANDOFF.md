# StatChat — session handoff
### Last updated 23 August 2026. Start with "WHERE TO PICK UP" at the foot of this file.

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

## THIS FILE IS STALE — read `TODO.md` first (noted 23 August 2026)

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

**Next task: finish the password reset flow — it is small and stuck on
configuration, not code. Then multi-tenancy step 1, the overlay auth.**
See `TODO.md`, section "RESUME HERE".

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

## Standing constraints

- **Do not run anything against the production database.** Andy's call.
  The baseline exists to be committed and to build scratch databases.
- **The harness cannot see anything visual.** jsdom has no layout
  engine, ignores `@media` entirely, and cannot settle `!important`.
  Batch visual work and ask for one look; do not iterate blind.
- **Nothing is written to `tests/` during a session** — ad-hoc
  verification, then one batch at wrap-up. A batch is currently OWED;
  see TODO.md.
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
