# StatChat tests

Automated checks that drive the **real** app, not a reimplementation of it.

```bash
npm install jsdom      # one-time, from the repo root
node tests/engine_parity.js       # ~1s   are the duplicated engine copies still in sync?
node tests/run_scripted.js        # ~2s   does a realistic game produce correct state?
node tests/cross_surface.js       # ~4s   does one play look the same on every page?
node tests/picker_check.js        # ~1s   is the returner picker populated and isolated?
node tests/clock_display_check.js # ~1s   does a colon-less clock entry always DISPLAY with a colon?
node tests/coverage_probe.js      # ~25s  can every UI path be reached and saved?
node tests/mutation_check.js      # ~4min do these tests actually catch real bugs?
```

Every suite exits non-zero on failure, so they can be chained:

```bash
for t in engine_parity run_scripted cross_surface picker_check clock_display_check coverage_probe; do
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
| `mutation_check.js` | Re-introduces nine known bugs and confirms the suite goes red for each. |

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
