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
node tests/receiver_targets_check.js      # ~8s  targets on catches, incompletions and interceptions
node tests/shared_number_check.js         # ~6s  two players on one number: both kept, both offered
node tests/onside_kick_check.js           # ~10s onside kicks on both trees, either side recovering
node tests/game_export_check.js           # ~5s  download-a-game backup, contents intact
node tests/offline_queue_check.js         # ~8s  plays survive going offline and a reload
node tests/phase_derivation_check.js      # ~8s  phase always matches the log; no lockups
node tests/realtime_check.js              # ~4s  live updates wired and reacting
node tests/chart_data_check.js            # ~5s  all 15 season charts: finite, labelled, aligned
node tests/engine_standalone_check.js     # ~1s  engine.js runs in Node with nothing undefined
node tests/feed_coverage_check.js         # ~2s  every view-page field reachable in the feed
node tests/fake_kick_check.js             # ~8s  fake punts and fake field goals
node tests/fuzz_check.js 60               # ~5m  property-based fuzzer (not in the normal suite)
node tests/full_game_check.js             # ~15s a WHOLE GAME through the UI, nothing injected

# Not in the normal suite -- slow, needs network on first run:
node tests/nfl/run_qa.js 5                # ~4m  five real NFL games through the real UI
node tests/nfl/run_week.js 1 2 3          # ~13m three whole NFL weeks (background it)
#   3 clean weeks as of Aug 10 2026: 48 games, 6,977 plays, 4,787 state pairs, 0 issues
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
| `receiver_targets_check.js` | Targets counted on completions, incompletions and interceptions, and NOT on two-point conversions (NFHS keeps conversion attempts out of season totals). Also asserts an unnamed incompletion credits nobody, and that the Tgt column reaches the rendered table. |
| `shared_number_check.js` | Two players wearing one number. Covers both halves of the Aug 7 fix: `create_game.html` keeps every player instead of forcing a choice at import, and `game.html` records the collision and offers each with a "?". Also asserts no bare third button (which silently meant whichever row loaded second) and that a clean roster raises no ambiguity. |
| `onside_kick_check.js` | Onside kicks on the manual panel AND the guided flow, with either side recovering. Asserts the play is logged as an onside kick rather than a muff (the only path that existed before), that recovering your own kick keeps possession, that the ball lands on the recovery spot, and that Onside / Touchback / Muffed stay mutually exclusive. Mutation-tested: all three ways it can break are caught. |
| `nfl/run_qa.js` | **Not part of the normal suite** — `node tests/nfl/run_qa.js 5`, roughly 30-60s per game. Drives real NFL games from nflverse play-by-play through the actual UI and checks against an independent source. Every other suite checks the app against itself; this one checks it against reality. Tier 1 asserts per-player rushing/receiving/passing yardage (convention-independent — NFHS and NFL disagree only about TEAM totals, never about what an individual gained). Tier 3 asserts `validateGame()` reports zero issues, which needs no reference data at all and so cannot be masked by a wrong adjustment. Tier 2 (team totals, normalised NFL→NFHS) is deliberately not built: the adjustment layer is the main risk in the design. |
| `full_game_check.js` | One complete game, opening kickoff to overtime, driven entirely through the UI with **nothing injected** — no `forcePossession`, no `setDrive`, no writes via `evalIn`. Every other suite (including the NFL harness) asserts the situation before each play, so none can tell you whether play N sets up play N+1 across a whole game. This does: chains moving, field position carried drive to drive, possession surviving a punt, an interception, a muffed punt and the interval, timeouts decrementing and resetting at halftime, a tie refused at the whistle. Also reaches what NFL data structurally cannot: the guided kickoff both halves, an onside kick, a muffed punt recovery, timeouts, overtime. Mutation-tested. |
| `fake_kick_check.js` | Fake punts and fake field goals on both panels: rush and pass variants, incompletion, touchdown, converting vs failing on downs, and that the yardage lands on the runner while the kicker gets NOTHING. Also asserts Fake clears Touchback — a fake is not a kick. **Worth reading the header**: it records why 48 NFL games and a full-game walkthrough never surfaced that fakes were unmodelled, and what that says about the limits of every suite here. |
| `fuzz_check.js` | **Property-based fuzzer.** Generates thousands of random but legal play sequences and asserts invariants that must hold whatever happened: fieldPos 0-100, down 1-4, distance >= 1, scores never decrease, completions never exceed attempts, catches never exceed targets, timeouts 0-3. Also does a RELOAD ROUND TRIP per game — state rebuilt from the saved rows must match the live page, which catches anything living only in memory. Seeded, so any failure replays with `node tests/fuzz_check.js 1 <seed>`. Mutation results are in the file header, including one surviving mutant investigated and shown to be equivalent. |
| `game_export_check.js` | The dashboard's "Download backup" item. Captures the Blob rather than downloading it, parses it back, and checks the plays survive intact — including administrative rows like quarter markers, which have `roles: null` and are easy to filter out by accident. Also checks the button is gated to admin and scorers (a view account should not download a whole game), that an empty game still exports (the moment you most want a backup is when something looks wrong, and wrong sometimes means empty) and that the filename identifies the game. Mutation-tested. |
| `offline_queue_check.js` | The offline play queue — the one feature that fails SILENTLY, and which had no automated test until 12 Aug 2026. Covers: a play entered offline is queued and stays on screen; the queue survives a reload (the realistic disaster — connection drops, scorer reloads, in-memory queue gone); it drains when the server returns; a duplicate-key error is treated as "already landed" rather than retried forever; a permanent refusal ("game is final") discards and TELLS the scorer instead of nagging; and the page shows that plays are unsaved. Needed `db.failNext` in the harness — a mock that always succeeds cannot test a queue. Mutation-tested. |
| `phase_derivation_check.js` | The game phase is now DERIVED from the play log rather than stored. Feeds the page game rows whose stored phase is a lie about the log — `secondHalf` with no plays, `halftime` with no divider — and asserts the page still offers a way forward. **Assertion shape matters here:** a lockup does not throw. The page renders, nothing errors, there is simply no button that moves the game on. So every scenario ends by asking "can a scorer still do something?" rather than "did it crash?". Mutation-tested: restoring the stored phase reproduces a lockup immediately. |
| `realtime_check.js` | Live updates on the view page — untested until 12 Aug 2026, and a broadcast-critical failure: if it breaks, the scoreboard freezes without erroring and nobody notices until the score is visibly wrong. Checks it subscribes, to the right game, for INSERT/UPDATE/DELETE, that INSERT and UPDATE are filtered by game_id — and that **DELETE deliberately is NOT**, because Postgres Changes cannot filter deletes server-side and adding a filter (which looks like tidying up) silently stops Undo propagating. Also fires an event and asserts the page reloads, and that a delete with no `game_id` (what a missing REPLICA IDENTITY FULL looks like) does not take the page down. Needed realtime recording in the harness. Mutation-tested. |
| `chart_data_check.js` | All 15 season-report charts. The harness now RECORDS each Chart.js config instead of discarding it, so the test can inspect what every chart was actually handed — "the chart drew" says nothing about whether it drew the right numbers. Checks: every chart constructs against a real canvas, no undefined or NaN in any series, no undefined labels, and series lengths match the labels and each other (the classic aggregation bug is one series built from a list that dropped a game — the chart still draws, and attributes values to the wrong column). **`null` is allowed on line charts only**, where it is a deliberate gap: a game with zero third-down attempts has no percentage, and plotting 0% would state something false. Mutation-tested. |
| `engine_standalone_check.js` | `engine.js` must run in Node, because `api/feed.js` requires it directly. The browser pages define several things the engine leans on (`isAdminMarker`, `RECEIVE_POS`, `TIMEOUTS_PER_HALF`…) and in Node nothing does. **This test SEARCHES rather than checking a list** — it parses engine.js, works out every identifier used but never defined, and fails on any. Written because I added the helpers from memory, declared the audit complete, and missed `RECEIVE_POS`; the feed's first real request returned `{"error":"RECEIVE_POS is not defined"}`. Also runs buildContext for real, since "nothing undefined" and "computes correctly" are different claims. |
| `feed_coverage_check.js` | Andy's Phase 3 requirement was "ALL data on the game and view screens must be available to broadcast software" — easy to believe without checking, because the feed has a lot of fields and FEELS complete. This enumerates what the view page displays and asserts each is reachable in one of the eight feed views. **It found four real gaps on its first run**: `possessions`, `turnovers` and `penalties` were absent from teamstats, and the whole `defense` view returned zero rows because its filter dropped players with sacks but no tackles. Also checks the no-cache header and that an unknown view lists the valid ones. Mutation-tested. |
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
