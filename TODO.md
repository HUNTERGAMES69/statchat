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

## 4. Live-entry (`game.html`) bug fixes and UI changes — this session (Aug 4-5, 2026)

All of the following are DONE and shipped. Listed here so a new session
doesn't re-investigate or re-fix any of these from scratch.

### Bug fixes
- [x] **Mobile responsiveness** for `recap.html`, `stat_package.html`,
  `season_report.html` — media queries below 700px, tables wrapped in
  horizontally-scrollable containers, `season_report.html`'s 2/3-column
  chart-rows collapse to one column using CSS `order` to preserve the
  metric-above-its-chart pairing (the DOM is flat siblings relying on
  grid column position — naively stacking in DOM order would have
  grouped all metrics together then all charts together). `view.html`
  and `game.html` already had their own separate mobile-responsive
  designs from before this session and were not touched here.
- [x] **Ambiguous "Our side"/"Their side" field-position labels** — these
  labels are relative to whoever's drive is being set up, not a fixed
  Neville perspective, but the wording made the natural (wrong) reading
  the opposite of what the underlying math needed. Fixed in
  `startingSpotFieldsHtml()` (used by kickoff/punt/interception/fumble
  return-spot fields and overtime setup) AND separately in the "New
  drive / correct down" utility, which had its own independent,
  hardcoded copy of the same ambiguous labels that the first fix missed
  entirely. Both now show the actual team names. See PROJECT_NOTES.md's
  "Possession-relative labeling" entry for the general pattern.
- [x] **Redundant "the" in field-position text** — "at the own 15"
  →"at own 15", since `markerLabel()` always returns "own X"/"opp X",
  never a bare number needing "the". Fixed in `game.html` (6 places,
  where this text is generated) and separately in `view.html` (1 place
  — it computes its own live banner independently rather than
  displaying stored text, so it had its own separate copy of this).
- [x] **Empty "Defense" stat tile for special-teams returners** — a
  kickoff/punt returner is credited via the same `roles.defense` field
  used for actual interception/sack/fumble-recovery credit, so
  `computeBoxScore` was creating an empty defensive-stat bucket entry
  for any returner even with zero actual defensive stats. Fixed in all
  four files that have their own copy of `computeBoxScore`
  (`view.html`, `recap.html`, `stat_package.html`, `season_report.html`)
  to only create the entry when the play type is actually int/sack/
  fumble.
- [x] **"Current drive"/"Previous drive" never updating past a turnover
  on downs** — that play type changes possession internally but never
  sets `effect.isReset`, which drive-boundary detection relied on
  exclusively. Added `findDriveStarts()` (detects any possession change
  directly, not just explicit `isReset` markers) in both `game.html`
  and `view.html`. Subtlety worth remembering: an explicit `isReset`
  marker IS the first play of its new drive (a dedicated announcement)
  and is included; a detected-but-unmarked possession change means the
  play that caused it still belongs to the *previous* possessor, so the
  new drive starts at the next play instead.
- [x] **Possessions count not incrementing after a turnover on downs** —
  identical root cause to the above, different function
  (`countPossessions`). Fixed with the same detect-any-possession-
  change approach in all four report/view files.
- [x] **Penalties never adjusting distance-to-go** — `computeState`'s
  penalty handling adjusted `fieldPos` but never `distance`, so a
  penalty could leave a stale down/distance and let a later play
  incorrectly convert (or fail to convert) a down. Fixed in all five
  files with a copy of `computeState` (`game.html`, `view.html`,
  `recap.html`, `stat_package.html`, `season_report.html`), including
  the real football rule this enables: if penalty yardage alone reaches
  or passes the marker, it's an automatic first down regardless of down.
- [x] **Penalty log text now always states the resulting down &
  distance** — e.g. "Penalty on Neville — 5 yds — 4th & 11", not just
  the yardage, mirroring the exact math in `computeState`'s (now-fixed)
  penalty handling. `game.html` only — this text is generated once at
  save time and stored; other pages just display it.
- [x] **Colon-less clock entry** — `clockToAbsSeconds()` now accepts
  "1156" as equivalent to "11:56" (last two digits are seconds,
  everything before is minutes; requires ≥2 digits so the split is
  never ambiguous). Colon format still works unchanged. All three clock
  input placeholders updated to "M:SS or MSS". `game.html` only.
- [x] **`view.html` wasted space on non-16:9 screens** — the whole page
  is built at a fixed 1920×1080 reference size and scaled by one
  `transform` to fit the real screen. The old scale was
  `Math.min(scaleX, scaleY)`, which preserves the fixed 16:9 shape and
  always leaves the leftover space empty on whichever axis doesn't
  match. Changed to independent `scale(scaleX, scaleY)` so the whole
  canvas — and everything inside it — stretches to exactly fill any
  screen, on any aspect ratio. Very slightly non-uniform on screens far
  from 16:9, but unnoticeable for text/tables/tiles, which is nearly
  everything on this page.
- [x] **Fumble-recovery default changed to "Recovered by opponent"** —
  was "Recovered by own team" in all four places this choice appears
  (standalone Fumble, and the fumble sub-flows within Rush/Pass/Sack).
  Important subtlety: flipping which radio is `checked` alone was NOT
  enough — each panel also has a static initial-visibility setting on
  the two sub-field `<div>`s (which player recovered, return yards,
  etc.) that doesn't react until a radio is actually clicked. Both the
  `checked` attribute AND the initial `display:none` placement had to
  be swapped together, in all four panels.

### UI restructuring (`game.html` only, no engine/logic changes)
- [x] Sack and Interception removed as top-level Scrimmage buttons;
  now reached via two new buttons ("Sacked"/"Intercepted") at the top
  of the Pass panel, which simply re-trigger the existing, unmodified
  Sack/Interception panels. Deliberately done this way — lowest risk,
  reuses fully-tested logic rather than rebuilding it.
- [x] Fumble and Safety moved from Scrimmage into the Utilities row.
- [x] "Quarter marker" moved out of Utilities into the game-control
  row, directly between "End 1st half" and "Start 2nd half" (so it
  always sits adjacent to whichever game-phase button is currently
  visible, since only one of Start game/End 1st half/Start 2nd half/
  End game is ever shown at once). Styled green (`.primary`).
  Utilities row order: Penalty, Fumble, Safety, New drive/correct down,
  Flip possession.
- [x] "Flip possession" moved from the floating-actions corner into the
  Utilities row (last position). Styled black (default button, no
  class) — was white/outline (`.secondary`) before.
- [x] "Penalty" moved to first position in the Utilities row, styled
  penalty-flag yellow (`#ffc72c` background, dark text).

### Investigated, not reproduced, not confirmed as a bug
- Andy reported "Previous drive" showing no stats after an
  interception (just the Clock event, attributed to the wrong team).
  Rebuilt the exact scenario twice, including the full multi-play drive
  with a penalty, through the real save flow — both times it worked
  correctly. Most likely explanation: Andy was testing against a
  `view.html` from before the `findDriveStarts` fix above (an
  interception without an explicit "New drive" marker is exactly the
  kind of possession change that fix was built for). Andy said to
  disregard. **If this recurs after confirming the latest `view.html`
  is actually deployed, it's worth a fresh, careful look** — don't
  assume it's the same stale-file explanation twice.

## 5. UI-driven test suite — BUILT AND COMMITTED (Aug 5, 2026)

The previously sandbox-only scripts were lost when the sandbox reset, as
section 5 warned they would be. They have been **rebuilt from scratch and
now live in `tests/` in the repo**, so this cannot happen again. See
`tests/README.md` for how to run them.

- `harness.js` — boots any real page in jsdom against a mock Supabase
- `ui_driver.js` — clicks real buttons, types into real inputs
- `scripted_game.js` / `run_scripted.js` — 19-step game, expectations
  written from the rules of football (not copied from app output)
- `cross_surface.js` — game.html -> DB -> all four report pages must agree
- `coverage_probe.js` — all 47 play types/sub-flows
- `engine_parity.js` — compares every duplicated engine function
- `mutation_check.js` — proves the suite actually catches real bugs

**Current status: all green, and the suite has teeth.** The mutation
check re-introduces five known bugs (including the original sack sign
error) and all five are caught. This matters because the previous
audit's pass/fail signal was demonstrably blind to real errors.

Verified through the real UI this session: the sack fix (ball moves
backward, distance-to-go grows), penalty distance adjustment in both
directions including automatic first downs, possession changes on
punt/interception/fumble, and returners correctly NOT receiving a
defensive stat bucket. All four report pages produce byte-identical box
scores from the same saved rows.

### Still not covered by any test
- [ ] Anything depending on real layout measurement — `view.html`'s
  `--stat-scale` tile fitting and the `scale(scaleX, scaleY)` canvas
  transform. jsdom has no layout engine; these need a human on a real
  screen.
- [ ] RLS policies. Missing policies fail *silently* in production and
  nothing in this suite would notice.
- [ ] Multi-game season aggregation (only tested with one game).
- [ ] `season_report.html` chart rendering (Chart.js is stubbed; numbers
  are checked, visuals are not).

## 6. Name resolution in the play log — FIXED (Aug 5, 2026)

Found by the coverage probe: a kick or punt returner rendered in the
play log as "#25" instead of their name, for any returner rostered as
KR/PR on special teams rather than on defense.

- [x] **Root cause.** Returners are resolved with `D(ret)` ->
  `nameInDefense()`, which read `rosterDefense` only. A dedicated
  returner is never on that roster, so the name never resolved. Same
  `roles.defense` overload already documented in `PROJECT_NOTES.md` — it
  cost a name here, not just a phantom stat tile.
- [x] **Also fixed: the asymmetry that made this worse.**
  `nameInOffense()` and `nameInSpecialTeams()` were the *weaker* version
  in `game.html` than in the four display pages. That was backwards:
  `game.html` is the only file whose version matters, because it
  generates the log text once at save time and stores the string.
- [x] **The fix.** All five files now share one `rosterName(teamKey,
  num, order)` helper that searches all three roster units, with the
  expected unit first. A fallback can only ever turn "#25" into a name;
  it can never change a name that already resolved. Verified: `#25`
  (special teams) now resolves, and defense/offense lookups are
  unchanged. `engine_parity.js` confirms all five copies identical, and
  `mutation_check.js` has a mutant guarding it.

### Still outstanding from this bug
- [ ] **The "Returned by" picker is still empty at kickoff time.**
  `defenseEligible()` lists only players already *discovered* with a
  defensive credit, so the first kickoff of a game shows "no one
  credited yet — type a number below". Manual entry now resolves names
  correctly, so this is a UX annoyance rather than a correctness bug.
  Deliberately NOT fixed here: `defBlock()` is shared by the sack,
  interception and fumble-recovery credit pickers too, so widening
  `defenseEligible()` would clutter all of them with kickers and
  punters. The right fix is a dedicated returner picker for
  kickoff/punt that unions the defensive and special-teams rosters —
  a small, self-contained change, but a UI change rather than a
  one-line fix, so it wants its own pass.
- [ ] **Decide whether to backfill.** Stored log text never
  re-resolves, so every return logged before this fix still reads
  "#25" permanently. Fixing the code does not repair history.

## 7. `view.html`'s stale `clockToAbsSeconds` — FIXED (Aug 5, 2026)

- [x] `view.html` carried the pre-Aug-4 version (no colon-less entry, no
  `secs > 59` rejection, no quarter-length bound). It was dead code, so
  not a live bug, but a live trap. Now synced with `game.html` rather
  than deleted, so the invariant "every copy of the engine core is
  identical" holds — that is the property the eventual shared-engine
  file will formalise, and a function missing from one copy would make
  that consolidation more confusing, not less.

## 8. Colon-less clock display bug — FIXED (Aug 6, 2026)

Reported directly: on `view.html`, some clock mentions in the play log
were missing the colon (e.g. "1156" instead of "11:56"). This looked
like a `view.html` display bug but wasn't -- there is no reformatting
step anywhere downstream of `game.html`. Every page (`view.html`,
`recap.html`, `stat_package.html`, `season_report.html`) just renders
whatever string is stored, verbatim.

- [x] **Root cause.** `clockToAbsSeconds()` was correctly built to accept
  colon-less entry ("1156" reads as "11:56"), but the coach's RAW typed
  text was then embedded directly into the stored play text at **seven**
  separate call sites, across two different flows: the main play-confirm
  card's clock field, and a second, entirely separate `showClockPrompt`
  standalone card that hadn't been touched by the earlier clock-parsing
  fix. Once a colon-less value was saved, it stayed colon-less on every
  surface, forever -- fixing display logic later could not have helped,
  because there was no display logic to fix.
- [x] **The fix.** A new `normalizeClockStr(quarter, clockStr)` in
  `game.html`, using the identical parsing rules as `clockToAbsSeconds`
  (colon-less entry, two-digit seconds, quarter-length bound), always
  returns `M:SS`. All seven embed sites now call it instead of
  interpolating the raw input. Input is unrestricted (colon or not);
  every display now always shows the colon.
- [x] Verified directly through the real UI: typing `1156` now stores
  `Clock — 11:56 ...`; typing `3:07` stores `3:07` unchanged (confirms
  round-tripping through the normalizer doesn't corrupt already-correct
  input).
- [x] Guarded by `tests/clock_display_check.js` (4 cases: the
  change-of-possession embed, the drive-ending-score embed, the separate
  `showClockPrompt` flow, and an already-colon-formatted input that must
  survive unchanged) and a mutation-check entry.
- [ ] **No backfill.** Exactly like the returner-name bug in section 6,
  any clock line already saved without a colon stays that way
  permanently. Fixing the code does not repair history. Worth deciding
  once, alongside that backfill question, rather than separately.

### Process note: a test file silently failed to upload last session

While re-verifying this fix against the live repo, `tests/picker_check.js`
was discovered to be a 404 error page on GitHub instead of the real file
-- a previous upload silently failed. This disabled 2 of the 9
mutation-check mutants without any visible error (they reported
"SURVIVED" rather than a hard failure, which is easy to misread as a
real regression instead of a missing test file). A working copy was
recovered and confirmed still passing against current `game.html`.
**When uploading `tests/`, spot-check at least one file's size on GitHub
against the local copy** -- a silent partial upload is worse than an
error, because everything downstream (this TODO, the mutation-check
output) assumes the file is actually there.

## 9. Drive boundaries broken by administrative markers — FIXED (Aug 6, 2026)

Reported from screenshots: on `view.html`, "Previous Drive" showed 0/0
in every tile and listed "Clock — 5:00 at change of possession" instead
of a drive summary. `game.html`'s "Previous drive" panel had the same
problem.

- [x] **Root cause.** `findDriveStarts()` begins a new drive at the play
  immediately after a detected possession change. When a kickoff flipped
  possession, the very next entry was the `Clock — ... at change of
  possession` line — an administrative marker, not a football play. That
  created a phantom one-play "drive" containing only the clock marker.
  Its tiles were all zero (markers carry no `roles`), and because only
  the last two drives are ever displayed, the real 99-yard touchdown
  drive was pushed out of the "previous drive" slot entirely.
- [x] **The fix.** New top-level `isAdminMarker(p)` in the engine core of
  both `game.html` and `view.html`: clock events, quarter/half dividers
  and manual possession flips are announcements, not plays. A detected
  possession change now starts the drive at the next REAL play.
  `isReset` markers are deliberately excluded from the definition —
  they are explicit "new drive" announcements and remain valid starts.
  Start indices are deduped, because skipping markers now often lands a
  possession change exactly on the reset marker that follows it.
- [x] **Second symptom, same root cause.** `computeDriveSummary()` chose
  its summary line by walking backwards and skipping only dividers, so a
  drive ending in a punt summarized as the trailing clock line rather
  than the punt. It now skips all administrative markers. This was
  literally the other half of the report ("lists the change of
  possession, not a drive summary").
- [x] **Manual flip had the identical bug**, not reported but found while
  verifying: `flipBtn` is followed by a clock prompt rather than a "New
  drive" marker, so it produced the same phantom drive. Fixed by the
  same change.
- [x] Verified: the reported sequence now shows PASS 1/99, YARDS 99 with
  the touchdown as the summary. A punt drive with clock events at both
  ends shows RUSH 1/12, PASS 1/20, YARDS 32, TOP 3:30 and summarizes as
  the punt. Time of possession only computes correctly once the drive
  boundaries are right, so TOP doubles as a boundary check.
- [x] Guarded by `tests/drive_boundary_check.js` (4 scenarios) and three
  mutants. Both copies of `findDriveStarts` and `isAdminMarker` verified
  byte-identical.

## 10. Live-entry fixes and features — Aug 6, 2026 (second session)

All verified through the real UI and covered by
`tests/possession_and_drive_check.js`, `tests/optional_players_check.js`
and `tests/entry_integrity_check.js`, with a mutant each.

### Bugs
- [x] **Possessions were double-counted.** `countPossessions` had its own
  copy of drive-boundary logic and counted both the detected possession
  change AND the explicit reset marker that follows it. A new game where
  each side had had the ball once reported 2 apiece. It now derives from
  `findDriveStarts`, so possessions and drives agree by construction
  rather than by keeping two implementations in step.
- [x] **Incomplete passes were not counted as 3rd/4th-down attempts.**
  The conversion loop's play-type list omitted `'incomplete'` -- and only
  that one list; every other definition in the codebase included it. An
  incomplete pass is the most common 3rd-down outcome in football, so
  every conversion rate ever recorded was inflated (denominator too
  small). Fixed in all four report files. Because reports recompute from
  play data, **re-opening an old game now shows corrected numbers** -- no
  backfill needed.
- [x] **Safety credited the clock to the wrong team.** The
  end-of-possession clock event used `effect.score.team`, which is the
  same as the possessing team for a touchdown or field goal but is the
  DEFENSE on a safety. The real possessor's clock was left running and
  its time of possession stuck at 0:00. Now always uses
  `preState.possession`.
- [x] **Stale confirm text (the significant one).** The confirm card is
  built on Review but nothing is written until Save. Any state change in
  between -- Undo being the easy one, and the new Redo button makes it
  easier to reach -- left the stored text describing a down & distance
  that no longer existed, while the effect was applied to the current
  state. The log then showed an impossible jump (2nd & 10 straight to
  4th & 11) and the third-down attempt inside it stopped counting.
  Invisible until someone read the log back. The play is now re-parsed
  against the current state at Save; `parseInput` is deterministic, so
  this is a no-op when nothing changed.

### Features
- [x] Time of possession tile added to Current Drive. Reads 0:00 until
  the drive's closing clock event is entered -- possession time only
  accumulates on an `end` or `transition` event and there is no live
  game clock to measure against mid-drive.
- [x] Penalty "no down change" checkbox, for a dead-ball foul or one
  assessed after a kick or change of possession. Moves the ball, keeps
  down AND distance (keeping only the down would still turn 1st & 10
  into 1st & 20). Caps for goal-to-go.
- [x] "New drive / correct down" renamed **"Adjust Down/Distance"** and
  no longer registers a possession. A reset marker now only opens the
  game's FIRST drive; every later drive begins at a real possession
  change. (The first-drive case is kept deliberately -- without it a game
  that opens with an adjustment would show no active drive.)
- [x] Passer picker pre-selects the last quarterback to throw for that
  team, on Pass / Sack / Interception / 2PT pass. Note
  `offenseEligible` filters the passer grid by QB position, so a non-QB
  who throws gets the number pre-filled into the manual field instead of
  a highlighted button.
- [x] **Redo last** button. Restores the play with its original id,
  roles, effect and sequence number. Entering any new play clears the
  redo stack, since redoing after that would splice a play in behind
  ones that already followed it.
- [x] **Kick/punt returner optional.** It was already skippable, but the
  return YARDAGE was silently discarded along with the unknown returner.
  Also fixed the blocked-punt recoverer and the guided-kickoff returner,
  both of which hard-blocked Review with no message.
- [x] **Interceptor and fumble recoverer optional** (standalone plus the
  rush/pass/sack sub-flows) -- all previously hard-blocked. Lost fumbles
  now carry `roles.lost`, because `roles.defense` used to be the only
  signal distinguishing a lost fumble from one recovered by the offense;
  without it, unnamed recoveries would have silently stopped counting as
  turnovers. `countTurnovers` checks `(r.lost || r.defense)` so games
  already recorded keep counting.

### Known-imperfect, deliberately left
- [ ] The `?` sentinel for an unknown player is a positional token in the
  code string. It works, but a structured field would be cleaner if the
  code format is ever revisited.
- [ ] Corrupted plays already saved cannot be repaired by any of the
  above. In the Aug 6 game one West Monroe third down is permanently
  uncounted (they should read 1 of 7, not 1 of 6).

## 11. Offline-durable sync queue — BUILT (Aug 6, 2026)

Triggered by a real failure during live entry:
`TypeError: Failed to fetch`. The old handler announced the problem once
and then forgot about it. The play lived on in that tab's memory, so
every later play still computed correctly on that screen, but the server
never received it — reloading dropped it silently, and the spectator
view and every report were quietly missing a snap. **This is the most
likely cause of the corrupted West Monroe drive** (a down sequence no
single play could produce), and of any past game whose stats looked
slightly off.

- [x] Failed inserts go into a queue persisted to `localStorage`, keyed
  per game, so **a reload no longer loses the play**. On load, queued
  plays are merged back into `plays` before anything reads them.
- [x] Merge dedupes against what the server already has — an insert can
  succeed while the response is lost, and that row must not be re-added.
- [x] Queue drains FIFO and **stops on the first failure**: uploading out
  of order would place a play on the server ahead of ones that happened
  before it.
- [x] Once anything is queued, later plays queue behind it rather than
  going straight through, for the same ordering reason.
- [x] Before draining, the queue asks the server which sequence numbers
  it already has and drops those. A duplicate-key error on retry is also
  treated as success, but that only fires if the table actually has a
  unique constraint on `(game_id, sequence_number)` — the pre-check does
  not depend on one.
- [ ] **Verify that unique constraint exists** on `plays`
  `(game_id, sequence_number)`. Without it nothing at the database level
  stops a duplicate row; the app-side pre-check is currently the only
  guard.
- [x] Undo of a still-queued play removes it from the queue instead of
  trying to delete a row the server has never seen.
- [x] Retries every 5s while anything is outstanding, immediately on the
  browser's `online` event, and on demand via a "Retry now" button.
- [x] Persistent banner shows how many plays are unsaved. `localStorage`
  failures (private browsing, quota) are swallowed — the queue still
  works in memory for the session.
- [x] `TypeError: Failed to fetch` is a thrown exception, not a returned
  error, so every insert path is wrapped in try/catch. The old code only
  checked the returned `error` and would have propagated the throw.

### Still outstanding
- [ ] The queue only covers play inserts. Game-status updates, roster
  writes and the guided-state save still fail silently offline.
- [ ] No test coverage yet — verified ad hoc this session (offline
  entry, reload recovery, drain, undo-while-queued, duplicate handling).
  `tests/harness.js` gained a `seedStorage` option to make the reload
  case testable; the suite itself is still to be written.

## 12. Passing/rushing picker changes — Aug 6, 2026

- [x] **Receiver optional** on Pass, incomplete and 2PT pass. Records as
  `pass for 14` / `incomplete` / `2PT pass — GOOD` with no name. No
  receiver role is created, so nobody gets phantom receiving yards; the
  passer's attempt, completion and yardage all still count.
- [x] **The auto-selected quarterback can now be cleared.** Tapping a
  committed pick de-selects it, and typing in the "or type #" field
  clears a stale highlight.
- [x] **The pre-selected QB is shown as a SUGGESTION, not a committed
  pick.** This mattered: with the naive toggle, the coach's first tap on
  the auto-selected quarterback read as "tap the selected player" and
  de-selected him — the opposite of confirming. The suite caught this
  as a hard failure (sacks and incompletes stopped saving entirely).
  Tap now confirms; a second tap clears.
- [x] **Offense pickers order by most recently used**, not by season
  yardage. Football is streaky — the back who just carried is far more
  likely to carry again than the one with the most yards an hour ago.
  Applies to carrier, passer and receiver, since they share
  `offenseEligible`.
- [x] **A player who has performed a role is always offered in it**,
  regardless of the position filter. A tight end who carried used to
  never appear in the carrier list, so recency ordering could never
  surface him and the number had to be typed every time.

## Other known-outstanding items (from earlier sessions, may be stale)

- [ ] Offline-durable sync queue for failed saves
- [ ] User invitation flow (needs a server-side service-role key)

Worth re-confirming these are still accurate before picking them up —
this list was carried over from before tonight's reporting-module work
and may not reflect the current state of the app.
