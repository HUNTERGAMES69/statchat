# StatChat — outstanding work

Open items only. Completed work lives in `PROJECT_NOTES.md` (architecture
and the reasoning behind decisions) and in the repo's commit history — it
is deliberately not kept here so this stays readable as a work list.

Ordered roughly by how much it would hurt to leave undone.

---

## 1. Correctness — do these first

- [ ] **`converts` is stored on the play instead of derived.** The most
  consequential open bug. `effect.converts` and `effect.turnoverOnDowns`
  are decided at entry time and frozen, so deleting or changing a play
  does not re-derive whether *later* plays converted a first down.
  Concretely: 1st & 10 at own 25, rush 8, pass 15, rush 3 — delete the
  pass and the 3-yard rush should now convert 2nd & 2, but the state
  reads `3rd & 1` because that play was stored with `converts: false`.
  Field position recomputes correctly; the down does not.
  **Fix:** derive `converts` in `computeState` from `statYds >= distance`
  rather than trusting the stored flag. Five-file engine change; the
  stored flag may be load-bearing for 4th-down and turnover-on-downs
  cases, so run `mutation_check.js` against it.
  **This blocks mid-log correction from being trustworthy**, and
  correction is now confirmed post-game-only — the single workflow that
  exists is exactly the one that hits this.

---

## 1b. Derive game phase from the log, not the game row

- [ ] **`gamePhase` and `guided_state` are stored, so they can disagree
  with the plays.** Three separate bugs came from that in one session
  (see PROJECT_NOTES): undo stranding the phase at `secondHalf` with no
  second-half plays, undo past the divider stranding it at `halftime`
  with no divider, and a guided kickoff staying "active" after the plays
  it belonged to were undone — which disables every control.
  All three now self-heal on render, but the heals are patches on a
  stored-state design and a fourth variant is plausible.
  Deriving phase outright — no divider means first half, divider with no
  real play after means halftime, and so on — removes the whole class.
  Worth doing before the season, since the failure mode is a locked
  screen mid-game with Reset game as the only exit.

---

## 2. Test debt — five features verified only by hand

All work and were checked manually, but nothing guards them against
regression. Largest single block of open work.

- [ ] Offline sync queue (offline entry, reload recovery, drain,
  undo-while-queued, duplicate handling). `tests/harness.js` already
  gained a `seedStorage` option to make the reload case testable.
- [ ] Muffed punt and muffed kickoff — the RETURNED-FOR-A-TD variants and
  mutual exclusion with Blocked / Touchback. The takeover-spot cases are
  now covered by `tests/takeover_spot_check.js`.
- [ ] Manual-entry name confirmation, including shared-number conflicts.
- [ ] Timeout tracker (countdown, disabled at zero, halftime reset,
  replay on `view.html`).
- [ ] Unlock to edit, `validateGame()`, and play deletion — including
  that Delete controls are absent outside correction mode.

### Gaps the suite structurally cannot cover
- [ ] Anything depending on real layout measurement — `view.html`'s
  `--stat-scale` tile fitting and the `scale(scaleX, scaleY)` transform.
  jsdom has no layout engine; needs a human on a real screen.
- [ ] `season_report.html` chart rendering (Chart.js is stubbed —
  numbers are checked, visuals are not).
- [ ] Multi-game season aggregation (only ever tested with one game).

---

## 3. Correction tooling — unfinished

- [ ] **Edit a play in place.** Nicer than delete-and-re-enter, but needs
  a way to reopen the original entry panel with its values prefilled,
  which the code has no notion of today.
- [ ] **Make Insert-after carry a real effect and roles.** Today manual
  insert saves `effect: {}` and `unresolved: true` — a text note that
  cannot repair a down sequence.

---

## 4. Validation — needs a decision before building

- [ ] **Golden-scenarios test suite** — a committed file covering sack,
  safety, 2pt, muffed kickoff and so on, re-run before shipping any
  engine change. Overlaps heavily with section 3; may be better folded
  into the existing suites than built separately.

---

## 5. Reporting — larger pieces

- [ ] **Rework the season stat package** — graphics, grouping, visuals.
  The current grouped metric sections, data labels and brand-colour
  charts are a first pass.
- [ ] **Multi-game comparison report** — compare any 2 games, or an
  arbitrary subset, side by side. Distinct from the existing single-game
  and full-season reports.
- [ ] **AI analysis plugin** — AI-generated analysis on top of the stats.
  Scope undefined.

---

## 5b. Track targets for receivers

- [ ] **Record a target on every pass attempt**, not just completions.
  Today an incomplete pass stores the passer and, if named, the
  intended receiver — but nothing counts it as a target, so the
  receiving line shows catches only. Targets are the standard
  companion stat: 4 catches on 5 targets says something 4 catches
  alone does not, and catch rate falls out of it for free.
  The data is already being captured on incompletions (`roles.receiver`
  is set when the intended receiver is named), so this is mostly a
  matter of counting it in `computeBoxScore` and adding a column.
  Note the receiver is optional, so targets will undercount whenever
  nobody was named — same caveat as every other optional-player stat.

---

## 6. NFL-data QA harness — designed, not built

Reopens the NFL-validation idea that was closed earlier (the old
converter stalled because it never handled penalties). This is a
different shape: it drives the REAL UI and compares against an
independent source of truth, rather than checking the app against
itself.

**Reachability confirmed** (Aug 7, 2026): nflverse release assets are
downloadable from this sandbox — `release-assets.githubusercontent.com`
is allowlisted. `play_by_play_2023.csv.gz` is ~19 MB.

### Shape
```
nflverse play-by-play
  -> convert each row to a UI action
  -> enterPlay() through the real DOM (ui_driver)
  -> game.html -> mock DB rows
  -> view.html / recap.html / stat_package.html
  -> compare against nflverse player_stats + official final score
```

Exercises `parseInput`, every entry panel, `computeState`,
`computeBoxScore` and cross-surface agreement against ~150 plays per
game instead of the 19-step scripted game.

### Files
- [ ] `tests/nfl/fetch.js` — download and cache `play_by_play_YYYY.csv.gz`
  and `player_stats_YYYY.csv.gz` to /tmp. One-time cost, cached after.
- [ ] `tests/nfl/convert.js` — one PBP row to one `enterPlay()` spec.
  Columns that matter: `play_type`, `yards_gained`, `rusher/passer/
  receiver_player_id`, `sack`, `interception`, `fumble_lost`,
  `touchdown`, `penalty_team`, `penalty_yards`, `yardline_100`, `down`,
  `ydstogo`, `qb_kneel`.
- [ ] `tests/nfl/expected.js` — expected box score from `player_stats`,
  with an EXPLICIT convention-adjustment layer.
- [ ] `tests/nfl/run_qa.js` — drive N games, diff, report per game.

### Convention differences that must be normalised
StatChat now uses NFHS, nflverse is NFL, so a raw comparison fails every
game for reasons that are not bugs:

| | NFL / nflverse | StatChat (NFHS) |
|---|---|---|
| Sack yardage | off team PASSING | off team RUSHING |
| QB kneel | individual QB rush | TEAM rush |

**That adjustment layer is the main risk in this whole design** -- a
wrong "adjustment" can hide a real bug. Hence the tiering below.

### Assertion tiers -- build 1 and 3 first
- [ ] **Tier 1, convention-independent, must match exactly.** Final
  score, per-player rushing yards, receiving yards, individual passing
  yards, touchdowns, interceptions, total plays. No adjustment applies,
  so any mismatch is unambiguous.
- [ ] **Tier 3, signal rather than comparison.** `validateGame()` must
  report ZERO issues on every game. Across 150 real plays that is a
  strong check on down continuity, impossible gains and touchdown
  distances, and it needs no reference data at all.
- [ ] Tier 2 (team rushing/passing totals, compared after normalising)
  only once tiers 1 and 3 are clean.

### Cost and limits
- ~30-60s per game in jsdom; 10 games is roughly 10 minutes. A nightly
  or pre-release run, not part of the normal suite.
- Cannot cover layout or rendering (no layout engine in jsdom),
  realtime, RLS, or the offline queue.
- No nflverse equivalent for the high-school-specific paths: muffed
  punts and kickoffs, the guided kickoff flow, timeouts.

---

## BEFORE GOING TO PRODUCTION

Everything here is fine for a test app and **not** fine once real users
have accounts. Nothing in this section should be attempted the week of a
game — each item wants test accounts for `view`, `game_entry` and
`admin`, and a full pass through the app afterwards.

Audited Aug 6, 2026. RLS is enabled on all five tables, but **every
policy is just `auth.role() = 'authenticated'`** — "are you signed in."
There is no role enforcement in the database at all.

- [ ] **Any signed-in user can delete any play.** `plays` has
  authenticated-only INSERT / UPDATE / DELETE / SELECT. A `view` account
  can wipe a game's log. Replace with role-aware policies.
- [ ] **Any signed-in user can edit any game.** `games` has
  authenticated-only UPDATE and DELETE — status, final score, deletion.
  Includes reopening a finalized game: the admin check on Unlock to edit
  is browser-side only. A `guard_game_unlock` trigger would close that
  one path cheaply (see below), but the rest needs real policies.
- [ ] **Any signed-in user can write rosters, teams and players.**
  Same authenticated-only pattern on `game_rosters`, `teams`, `players`.
- [ ] **Write a `current_user_role()` SECURITY DEFINER helper** reading
  `profiles.role`, and rebuild the policies on top of it. Doing this
  wrong fails closed and stops the app dead, so it needs a test account
  per role and a deliberate pass — not a quick edit.
- [ ] **Game-status and phase writes are not covered by the sync
  queue.** `games.update` (one call site, reached from `persistUiState`
  and `setGameStatus`) fails silently offline. Nothing destructive —
  plays are already protected, so stats and score are never at risk —
  but the resume position and the final status can be lost, each
  recoverable by pressing the button again once connected.
  The work is small in itself (one merged pending-update, last-write-
  wins, reusing the existing retry timer and banner) but has a real
  ordering constraint: **it must drain strictly AFTER the play queue.**
  The `plays_immutable_when_final` trigger rejects play inserts on a
  final game, so applying `status='final'` while plays are still queued
  would permanently reject them — the exact failure fixed on Aug 6.
  Unlock (`status='in_progress'`) wants the opposite ordering, so the
  clean answer is to exclude it from queueing entirely and refuse it
  offline with a clear message.
- [ ] **No service worker.** Reloading while genuinely offline fails —
  the page itself cannot be fetched, so a coach who refreshes at the
  wrong moment is locked out until the connection returns. Queued plays
  survive, but entry stops.
- [ ] **Optional quick win: `guard_game_unlock` trigger** — mirrors
  `profiles_role_guard` and makes Unlock to edit admin-only in the
  database. Two minutes, low risk, but only closes one path; not a
  substitute for real policies.
- [ ] **Confirm no other self-write path to `profiles.role`.** The
  self-promotion hole is closed by a trigger; worth re-checking there is
  no second route once more policies change.

---

## Shipped August 7, 2026

Recorded so the reasoning is not re-argued. Details in PROJECT_NOTES.

- **NFHS conventions replace NFL ones.** Sack yardage charged to rushing;
  QB kneels and bad snaps as TEAM rushes; no defensive score on a try;
  missed FG defaults to the 20.
- **Yardage calculator** on rush, pass and punt — enter the spot, get the
  gain, including across midfield.
- **Bad snap** utility, with an offense-or-defense recovery.
- **Muffed hold** on FG and PAT — aborts the attempt without charging the
  kicker.
- **Goal-to-go** in the play text, not just the banner.
- **Half and overtime end a drive**, even when the same team keeps the
  ball. Overtime possessions excluded from game totals.
- **Only a kickoff is offerable** after a PAT, 2PT or made FG.
- **Picker rules**: seeded starters always appear for the roles their slot
  plays; hand-typed players stick; all four picker families sort by
  recency; the returner picker starts empty and builds.
- Two new suites: `takeover_spot_check.js`, `yardage_calculator_check.js`.
  **13 suites total.**

---

## Standing decisions (settled — do not re-litigate)

- **No backfill of historical data.** Every game recorded so far is a
  test, so stale returner names, colon-less clock text and the one
  corrupted play from Aug 6 are all being left alone. Revisit only if a
  real game is ever affected.
- **`validateGame()` warns, never blocks**, and runs only on End game
  plus the "Run checks again" button on a finalized game.
- **Timeouts cannot be given back** except via Undo. Accepted; a
  dedicated give-back effect is not worth another play type.
- **NFL-data validation is closed.** The converter will not be extended
  to generate penalty codes, and possessions will not get a real-world
  data check. Validation now rests on the UI-driven suites and
  `validateGame()` instead.
- **Some sync failures are permanent, not transient.** The database
  refuses play changes on a finalized game. A row rejected for that
  reason is discarded from the queue with an explanation rather than
  retried forever. Only transient failures keep retrying.
- **Database hardening done Aug 6, 2026:** unique constraint
  `plays_game_seq_unique (game_id, sequence_number)` added (no duplicates
  existed); `profiles_role_guard` trigger blocks a non-admin changing any
  role, closing a confirmed privilege-escalation hole where any signed-in
  user could promote themselves to admin. Both guard triggers include
  `auth.uid() is not null` so the SQL editor stays usable as an escape
  hatch — without it, demoting yourself locks you out of fixing it.
- **Timeouts are shown on the live view only.** `view.html` (TOL in each
  team's header) and the `game.html` banner. Deliberately not surfaced on
  recap, stat package or season report — timeouts remaining is a live
  coaching number, not a post-game stat.
- **Entry-UI quirks accepted as-is** (Aug 6, 2026). All reviewed and
  fine in practice: the "Returned by" picker being empty on the opening
  kickoff (manual entry resolves names correctly anyway); the muff
  recoverer being a plain number field rather than a picker; no fumble
  or recovery stat being recorded for a muff; a shared-number choice
  persisting for the session rather than per play; and the `?` sentinel
  for an unknown player being a positional token in the code string.
  None of these affect correctness of the recorded stats.
- **The only sanity check wanted is "gain larger than the distance to
  the goal line"** (Aug 6, 2026), and it is done — warned at Review time
  on the entry screen, and reported by `validateGame()` at End game for
  anything saved past that warning. No threshold-based checks are
  wanted: nothing that guesses whether a play is merely *implausible*,
  only what is arithmetically impossible.
- **Kickoffs do not record a kick distance** (Aug 6, 2026). Nothing
  reported it — the box score counts kickoffs and touchbacks only — so
  the field was removed from both the kickoff panel and the guided
  kickoff flow, where it had been required. Punts still record distance.
- **Play text wording** (Aug 6, 2026): zero yardage reads "for no gain",
  negative reads "for a loss of N". Generated at save time by one
  `gainPhrase()` helper, so rush and pass cannot drift apart. Sacks are
  left as "sacked for N yds" — the loss is implicit in the word.
- **Adjust Down/Distance takes any subset** (Aug 6, 2026). Down,
  distance and spot each fall back to the current value, so the spot can
  be corrected without restating the down. It refuses only when there is
  no current spot to keep.
- **A scrimmage play is refused when the ball's spot is unknown**
  (Aug 6, 2026). rush / pass / incomplete / sack only — the plays that
  advance the ball from a known spot. Interceptions, fumbles, kickoffs,
  punts, field goals and PATs are all still allowed, because those are
  the plays that ESTABLISH a spot after a change of possession; blocking
  them would deadlock entry. This closes the hole where a play entered
  with no spot resumed down tracking at 2nd down with no field position,
  silently switching the impossible-gain check off for the rest of the
  game.
- **A turnover on downs keeps the spot** (Aug 6, 2026). The ball does
  not move — it is spotted where the play ended and the new team starts
  1st & 10 from there. `fieldPos` is possession-relative, so the same
  physical spot is mirrored to `100 - fieldPos`. Previously the spot was
  cleared, which forced an Adjust for a position the app already knew.
- **Reset game** (Aug 6, 2026) is admin-only, in the dashboard 3-dot
  menu above Delete game. Clears the play log but keeps the game record,
  roster and settings; requires typing the designator; reopens a
  finalized game first (the database refuses play changes otherwise) and
  clears that game's offline queue so old plays cannot upload into the
  fresh one. Emptying the log IS a full reset, because score, downs,
  drives, timeouts and direction are all derived from it.
- **Play correction is post-game only.** Delete controls appear solely
  after an admin unlocks a finalized game — never during live entry,
  where a mis-tap could destroy a play.
