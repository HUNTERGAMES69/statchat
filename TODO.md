# StatChat — engineering TODO

Living list. Check this at the start of any session touching the game
engine, stat computation, or reporting. Update it as items get done.

## 1. Shared engine JS file

**Status: not started.**

Right now `view.html`, `recap.html`, `stat_package.html`, and
`season_report.html` each carry their own copy of the core engine
functions (`computeState`, `computeBoxScore`, `buildTeams`, etc.),
copied verbatim from `game.html`. A fix has to be manually, correctly
repeated in every file that has a copy — this is exactly how the
sack-yardage inconsistency happened earlier, and how the
`RECEIVE_POS` omission bug happened too.

**The fix:** pull these functions into one shared file (same pattern
as the existing `team-icon.js`), loaded via `<script src="...">` by
every page instead of each page carrying its own copy. One bug, one
fix, everywhere, automatically.

Doing this *before* the audit work below would mean testing one engine
instead of four near-identical copies — worth considering as the
first step, though not required to start the audit.

## 2. Auditing what's already logged, and ongoing validation

Trigger: the sack-yardage bug found on August 3, 2026. Sacks entered
through the *actual UI* were moving the ball forward instead of
backward — undetected by earlier fuzz-testing because that testing
called `parseInput()` directly, bypassing the real HTML input fields
where the bug actually lived.

### Can do without further input from Andy
- [ ] **Internal consistency checks** — for a batch of test games, verify
  total yardage computed two independent ways (sum of individual
  player stats vs. sum of raw play-log yardage) always agree.
- [ ] **Sign-convention review** — go through every "yards"-type input
  field on every play panel in `game.html` one at a time: does the
  label imply a signed number or a magnitude, and does the code
  reading it agree? This is the class of review that would have
  caught the sack bug by inspection alone.
- [ ] **Re-run the ~440 real NFL games through the actual UI** — extend the
  existing UI-driving test harness (`ui_test_harness.js` /
  `ui_driver.js` / `ui_game_runner.js` / `ui_batch_runner.js`, or
  their equivalents) so it actually populates real HTML fields on
  each play panel, rather than calling `parseInput()` directly. This
  is the single biggest, most valuable piece here, and the most
  mechanical/time-consuming.
- [ ] **Re-verify team-level stats against real box scores, deliberately**
  — same method used to verify the sack-yardage methodology, applied
  to every team-level metric (turnovers, penalties, possessions,
  etc.) rather than only the one someone happened to ask about. Note:
  StatChat-specific metrics with no real NFL equivalent (e.g. the
  exact 20yd+ "explosive play" threshold) can't be checked this way —
  those need careful logical review instead.

### Need a decision from Andy before building
- [ ] **Golden-scenarios test suite** — a committed file (e.g.
  `tests/golden_scenarios.js`) covering sack, safety, 2pt, muffed
  kickoff, etc., re-run before shipping any engine change. Needs to
  live in the repo, not just my sandbox, to actually be useful across
  sessions.
- [ ] **"Validate this game" check** — a real feature, not just a dev
  test. Needs: where does it live (stat package page? 3-dot menu?),
  and what does a flagged mismatch actually do (warning only, or
  blocks something)?
- [ ] **In-app sanity checks during entry** — needs actual thresholds
  decided (how many yards on one play is "too many" to flag?) and a
  strictness call (soft warning you can click past, vs. blocking the
  save). Too strict risks flagging a real, rare play.

## 3. Reporting module — further work

- [ ] **Rework the season stat package** — graphics, grouping, and
  visuals. Tonight's work (grouped metric sections, data labels,
  brand-color charts) is a first pass; revisit for further
  refinement.
- [ ] **Potential AI analysis plugin** — explore adding AI-generated
  analysis/insights on top of the stats (exact scope TBD).
- [ ] **Multi-game comparison report** — a report that compares and
  analyzes any 2 games, or an arbitrary subset of games, side by
  side (distinct from the existing single-game and full-season
  reports).

## Other known-outstanding items (from earlier sessions, may be stale)

- [ ] Offline-durable sync queue for failed saves
- [ ] User invitation flow (needs a server-side service-role key)

Worth re-confirming these are still accurate before picking them up —
this list was carried over from before tonight's reporting-module work
and may not reflect the current state of the app.
