# StatChat tests

Automated checks that drive the **real** app, not a reimplementation of it.

```bash
npm install jsdom      # one-time, from the repo root
node tests/engine_parity.js       # ~1s   are the duplicated engine copies still in sync?
node tests/run_scripted.js        # ~2s   does a realistic game produce correct state?
node tests/cross_surface.js       # ~4s   does one play look the same on every page?
node tests/picker_check.js        # ~1s   is the returner picker populated and isolated?
node tests/clock_display_check.js # ~1s   does a colon-less clock entry always DISPLAY with a colon?
node tests/drive_boundary_check.js # ~4s   do drives start on real plays, not clock markers?
node tests/possession_and_drive_check.js  # ~10s possessions == drives; downs count incompletes?
node tests/optional_players_check.js      # ~5s  returner/interceptor/recoverer optional?
node tests/entry_integrity_check.js       # ~10s does the saved text match the engine?
node tests/picker_behaviour_check.js      # ~8s  starters present, manual entries stick, recency order
node tests/takeover_spot_check.js         # ~12s every change of possession records a takeover spot
node tests/yardage_calculator_check.js    # ~8s  tackled-on spots convert to yardage, incl. across midfield
node tests/coverage_probe.js      # ~25s  can every UI path be reached and saved?
node tests/mutation_check.js      # ~4min do these tests actually catch real bugs?
```

Every suite exits non-zero on failure, so they can be chained:

```bash
for t in engine_parity run_scripted cross_surface picker_check clock_display_check \
         drive_boundary_check possession_and_drive_check optional_players_check \
         entry_integrity_check coverage_probe; do
  node tests/$t.js || echo "FAILED: $t"
done
```

## The one rule

**Nothing here may call `parseInput()`, `buildAndReview()` or
`pushAndPersist()` directly.** Tests click real buttons and type into
real `<input>` fields.

This is not fussiness. The sack-yardage bug (Aug 3, 2026) lived in the
HTML input path itself, and the extensive earlier fuzz-testing missed it
entirely *because* that testing fed `parseInput()` pre-built strings and
never touched the fields a coach actually uses. If a path can't be
reached by clicking and typing, a coach can't reach it either, and the
driver throws `UnreachableByUI` rather than faking it — an earlier
harness faked a bare safety by writing to the hidden `#code` field,
which tested nothing at all.

## What each file does

| File | Purpose |
|---|---|
| `harness.js` | Boots any StatChat page in jsdom against a mock Supabase. Records everything the app persists. |
| `ui_driver.js` | Performs genuine coach actions: `enterPlay()`, `setDrive()`, panel navigation, player pickers. |
| `scripted_game.js` | A 19-step game with hand-written expectations for down, distance, field position, possession and score. |
| `run_scripted.js` | Runs that game and compares actual state to those expectations. |
| `cross_surface.js` | Enters plays in `game.html`, then re-opens all four report pages against the saved rows and demands they agree — with each other and with what was typed. |
| `coverage_probe.js` | Drives all 47 play types and sub-flows in isolation and reports what each one did. |
| `engine_parity.js` | Extracts every duplicated engine function from all five files and compares them. |
| `picker_check.js` | Checks the kickoff/punt returner picker is populated and correctly ranked, and that the other credit pickers stay defense-only. |
| `clock_display_check.js` | Checks that a colon-less clock entry ("1156") is normalized to "M:SS" before being stored, across all seven places `game.html` embeds a clock value into play text. |
| `drive_boundary_check.js` | Checks that a drive never starts on an administrative marker (clock line, divider, manual flip), and that a drive's summary line reports a real play rather than the trailing clock marker. |
| `possession_and_drive_check.js` | Possessions equal drives; "Adjust Down/Distance" registers none; Current Drive has a TOP tile; 3rd/4th-down conversions count incomplete passes. |
| `optional_players_check.js` | Kick/punt returner, interceptor and fumble recoverer are all optional, without losing return yardage, turnovers, or gaining phantom players. |
| `entry_integrity_check.js` | The saved log text always matches the recomputed engine state; redo, QB pre-selection, penalty no-down-change and safety clock attribution. |
| `picker_behaviour_check.js` | Every likely starter appears in the pickers for the roles that slot plays and no others; a hand-typed player joins the list from then on; all four picker families order by most recent use. |
| `takeover_spot_check.js` | Drives all 11 change-of-possession flows through the real panels and asserts the takeover spot reaches the log as a New drive marker. Three separate causes of a silently-null spot were found on 2026-08-07: missing spot fields on the rush/pass/sack fumble paths, a recovery radio that defaults checked but only wires its getter on `change`, and the Sacked outcome switch re-rendering away the listeners `wireStartingSpot` had attached. All three left a filled-in form returning null. |
| `yardage_calculator_check.js` | The "or tackled on" input on the rush and pass panels. Asserts the arithmetic in both directions across midfield (own 20 to opp 20 is +60), that a negative result drives LOSS rather than leaving both settable, that typing yards hands control back, that a touchdown hides the calculator and a fumble relabels it, and that an unknown spot disables it. |
| `mutation_check.js` | Re-introduces nineteen known bugs and confirms the suite goes red for each. |

## Writing expectations

Expectations in `scripted_game.js` are written **from the rules of
football**, never copied from what the app currently outputs. Copying
current output produces a test that certifies present behaviour, bugs
included — which is the failure mode that let the sack bug survive.

## About `mutation_check.js`

It **edits real app files in place** and restores them in a `finally`
block. If it is interrupted mid-run, verify the working tree before
committing:

```bash
git diff --stat
```

A green suite proves nothing on its own. The previous audit's
combined-score check passed on a game where *both* teams' scores were
wrong, because it only compared the sum. Run `mutation_check.js` after
adding any new assertion, and treat a surviving mutant as a blind spot
in the tests rather than a curiosity.

**Suite order in `mutation_check.js` is deliberate.** `engine_parity`
fires on *any* single-file edit to a duplicated function, so if it ran
first it would short-circuit almost every mutant and hide whether the
behavioural tests can actually detect the broken behaviour. It runs
last, as a backstop. The runner also stops at the first suite that
catches a mutant -- running all nine against all nineteen takes long
enough to hit tool timeouts.

**If the run is interrupted, check the working tree before doing
anything else.** The runner restores files in a `finally` block, but a
hard timeout kills it mid-mutation and leaves a file modified. This has
already happened once.

**"SURVIVED" can also mean a test file failed to upload, not that the
fix is broken.** This happened once already: `picker_check.js` silently
uploaded as a 404 page, and its two mutants reported "SURVIVED" for a
run where the actual fix in `game.html` was fine. Before trusting a
survivor, confirm the file it should have been caught by is actually
present and correct-sized in `tests/` — `wc -l tests/*.js` against what
this README lists is a fast sanity check.

## Known limitations

- **jsdom has no layout engine.** Anything depending on real measured
  heights is not meaningfully tested — notably `view.html`'s
  `--stat-scale` tile fitting and its `scale(scaleX, scaleY)` canvas
  transform. Those still need a human on a real screen.
- **Chart.js is stubbed**, so `season_report.html`'s charts are never
  actually drawn. Its *numbers* are checked; its visuals are not.
- **The mock Supabase ignores filters.** `.eq()` is recorded but not
  applied, so tests must not depend on server-side filtering.
- **RLS is not exercised at all.** Missing policies fail silently in
  production and nothing here would notice.
- **Multi-game season aggregation** is only tested with a single game.
