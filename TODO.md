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
- [x] **Internal consistency checks** — DONE (Aug 4, 2026). Extended the
  NFL fuzz-test harness with a yardage cross-check (box-score sum vs.
  raw play-log sum) across all 285 available 2024-season games: zero
  mismatches. Also added a direct down/distance logical check (loss of
  yardage must increase distance-to-go, gain must decrease it) — this
  is the check that would have caught the sack bug directly, unlike a
  yardage-totals check, which wouldn't have (see the sack bug note
  below for why). 18,358 logic checks run, zero violations.
- [x] **Sign-convention review** — DONE (Aug 4, 2026). Read through every
  "yards"-type field across every play panel in `game.html`. Findings:
  Rush/Pass's generic "Yards" label correctly expects signed input, and
  the code reads it as signed with no adjustment needed. Sack's "Yards
  lost" (magnitude-implying) is now correctly negated after the earlier
  fix. Penalty's "Yards" field is safe by design — direction comes from
  a separate "On offense/On defense" toggle, not from the sign of the
  number typed. Every "Return yards (optional)" field on turnovers and
  special-teams plays is consistently display-only, never fed into
  field-position math at all — a deliberate pattern, not an omission.
  No new sign bugs found.
- [~] **Re-run NFL games through the actual UI** — IN PROGRESS, substantial
  build done (Aug 4, 2026), but not safe to trust yet -- see the
  critical finding below before treating any of this as verified.
  - What's built: a real UI-driving test (`ui_code_driver.js`,
    `full_ui_audit.js`, `full_ui_batch_runner.js` in `/home/claude/stat_tracker/`,
    though that's a sandbox path that won't survive to a fresh
    session -- these need to be committed to the repo, not left there)
    that actually opens each play panel, types into real `<input>`
    fields, dispatches real `input` events, and clicks the real Review
    and Save buttons -- not `parseInput()` shortcuts. Supports rush,
    pass, incomplete, sack (incl. safety), interception, kickoff (incl.
    returns), punt (incl. blocked, both recovery cases, incl. returns),
    field goal (incl. blocked), PAT (incl. blocked), and both 2-point
    conversion types. Standalone fumbles and bare safety supported.
    Fumble-during-rush/pass/sack sub-flows and the fumble-recovered-by-
    own-team sub-case are NOT yet supported (will show up as
    `standalone-fumble-not-yet-supported` or similar in skip counts if
    hit -- they weren't hit in the current NFL dataset, but that's
    coincidence, not coverage).
  - While building this, found and fixed three genuine bugs in the test
    driver itself (not the app): punt returns/return-TDs were silently
    dropped (never wired the returner/return-yards/TD fields at all);
    FG-blocked and PAT-blocked weren't wired up; and bare "sf" was
    being faked by writing directly to a hidden internal `#code` field
    instead of driving the real Safety panel -- which doesn't actually
    test anything, since a coach has no way to do that.
  - Found one code pattern the test converter produces that has NO
    corresponding real UI action at all: direct score-adjustment
    commands (`score teamA +6` etc.), used for rare edge cases like a
    fumble-recovery TD with no jersey number on the ball carrier. No
    button or field produces this in the real app. Now correctly
    skipped rather than faked -- but it means those specific games will
    always show a combined-score gap unless/until an alternate real
    path is found for the underlying event.
  - **Critical finding, not yet acted on**: the "combined score match"
    check this whole audit (both the old `parseInput()`-direct version
    and the new UI-driven version) has been relying on is too weak. It
    only checks the *sum* of both teams' scores, not which team scored
    what. Confirmed concretely on `2024_01_DEN_SEA`: even the
    `parseInput()`-direct method gives 24-22, matching neither team's
    real score (26-20) -- but 24+22=46 equals the real *combined* total
    (26+20=46), so the earlier batch run's "combinedMatch: true" passed
    anyway, completely masking a real per-team attribution error. This
    means the earlier "only 3 mismatches, all explained by laterals"
    conclusion (see `PROJECT_NOTES.md`) was based on an incomplete
    check and should not be trusted as-is.
  - **Update (Aug 4, 2026)**: the per-team check was built and the full
    285-game batch re-run with it. Result: 241/285 games (84.6%) have a
    per-team mismatch, 223 of them masked by the old check. This is one
    systematic pattern (a home/away score swap, confirmed on
    `2024_01_ARI_BUF`), not 241 separate bugs -- full root-cause
    analysis in `PROJECT_NOTES.md`'s "Systematic per-team score
    mismatch" entry. **Not yet resolved**: whether this is a real
    engine bug in possession-inference, or an inherent limitation of
    testing with play codes that never state which team a player is
    on (team attribution is inferred purely from prior plays' effects,
    with no explicit possession marker from the converter). Next step
    is determining which, most likely by having the converter also
    emit accurate possession/drive-start markers from nflverse's own
    drive data and checking whether that eliminates the mismatches --
    if it does, this was a test-data gap, not an app bug.
- [~] **Re-verify team-level stats against real box scores** — PARTIAL
  (Aug 4, 2026). Turnovers verified exactly against the same real,
  published game used for the sack-yardage verification (1-1, matches
  official box score exactly). **Found a real gap while doing this**:
  the NFL play-by-play converter never generates penalty codes at all
  — it explicitly treats "penalty-only plays" as out of scope and skips
  them. This means penalties have never actually been exercised by any
  of this NFL-based testing, ever. Possessions also untested this way
  (no natural nflverse equivalent to check against cheaply). Extending
  the converter to handle penalties (nflverse has `penalty_team` /
  `penalty_yards` per play) is a real, moderate-scope follow-up, not
  done yet — added as its own item below.
  - [ ] Extend the NFL converter to generate penalty codes (`po`/`pd`)
    from nflverse's `penalty_team`/`penalty_yards` columns, then
    re-verify penalty counts/yards against real box scores the same
    way sack yardage and turnovers were verified.
  - [ ] Possessions has no cheap real-world check available; falls
    back to careful logical review rather than data verification.

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
