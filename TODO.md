# StatChat — outstanding work

Open items only. Completed work lives in `PROJECT_NOTES.md` (architecture
and the reasoning behind decisions) and in the repo's commit history — it
is deliberately not kept here so this stays readable as a work list.

Ordered roughly by how much it would hurt to leave undone.

---

## 1. Correctness

### `converts` is stored, not derived — DOWNGRADED Aug 7, 2026

This was listed as "the most consequential open bug" and "do first".
Re-examined on Aug 7 and that is no longer the right call.

**The bug is real.** `effect.converts` and `effect.turnoverOnDowns` are
decided at entry and frozen, so deleting a play mid-drive does not
re-derive whether *later* plays converted. Concretely: 1st & 10 at own
25, rush 8, pass 15, rush 3 — delete the pass and the 3-yard rush should
convert to 2nd & 2, but the state reads `3rd & 1`. Field position
recomputes; the down does not.

**But it is no longer silent.** `validateGame()` catches it exactly,
verified Aug 7:

> Play 3 reads "2 & 7" but recomputes to "3 & 1" — N Runningback rush for 3

That check did not exist when this entry was written. With it, the cost
side of the trade looks much worse than the benefit:

| | Fix it | Leave it |
|---|---|---|
| Change | ~6 lines × 5 files, in the branch EVERY scrimmage play uses |  none |
| Failure mode if wrong | downs drift subtly across a drive | none |
| QA | replay real game logs before and after | none |
| Exposure | mid-drive delete during post-game correction, and only when the yardage changes | same, but reported |

- [ ] **Cheap mitigation instead:** one line on the correction-mode
  banner — "after deleting a play mid-drive, run the checks; later downs
  may need re-entering." Five minutes, closes the practical gap.
- [ ] **Only do the full fix if this bites repeatedly in real use.** The
  approach if it does: derive both flags in `computeState` from
  `statYds >= state.distance` and `state.down >= 4`. Two traps —
  `turnoverOnDowns` is paired with `flipApplied`, so a newly-derived
  turnover would reset the down without changing possession (leave
  possession alone and let `validateGame` flag it, rather than silently
  moving the ball); and the automatic-first-down penalty path sets
  `down = 1` separately, so confirm the two do not interact. Write the
  failing test first, then run `mutation_check.js`.

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

## 2. Test debt

### Confirmed working by hand — closed Aug 7, 2026

Andy confirmed all five in live use. Closed as features.

- [x] Offline sync queue (offline entry, reload recovery, drain,
  undo-while-queued, duplicate handling).
- [x] Muffed punt and muffed kickoff, including the returned-for-a-TD
  variants and mutual exclusion with Blocked / Touchback. The
  takeover-spot cases also have automated cover in
  `tests/takeover_spot_check.js`.
- [x] Manual-entry name confirmation, including shared-number conflicts.
- [x] Timeout tracker (countdown, disabled at zero, halftime reset,
  replay on `view.html`).
- [x] Unlock to edit, `validateGame()`, and play deletion — including
  that Delete controls are absent outside correction mode.

**One thing these ticks do not mean.** They record that the features
work, not that anything guards them. None has automated cover, so a
future engine change can break any of them silently — and the offline
queue in particular fails in a way nobody notices until plays are
missing after a game. If a regression ever turns up in one of these,
write the test then rather than re-fixing blind.

### Gaps the suite structurally cannot cover
- [ ] Anything depending on real layout measurement — `view.html`'s
  `--stat-scale` tile fitting and the `scale(scaleX, scaleY)` transform.
  jsdom has no layout engine; needs a human on a real screen.
- [ ] `season_report.html` chart rendering (Chart.js is stubbed —
  numbers are checked, visuals are not).
  **Deferred by Andy to end of season** — needs several real games
  before it is worth looking at.
- [ ] Multi-game season aggregation (only ever tested with one game).
  **Deferred to end of season**, same reason: the bugs here only appear
  with real multi-game data, so testing it now would prove little.

---

## 3. Correction tooling

The two items here look similar and are not. Reviewed Aug 7, 2026.

### Edit a play in place — DEFERRED, low value

- [ ] Nicer than delete-and-re-enter, but that flow already works and is
  two taps rather than one. It needs a way to reopen the original entry
  panel with its values prefilled, which the code has no notion of —
  every panel builds itself from the current game state, not from a
  stored play. That is a real piece of work for a convenience.
  **Do not build this unless correction becomes a frequent workflow.**

### Insert a genuinely missed play — REAL GAP, worth scoping

- [ ] **There is currently no way to add a play that was never entered
  and have it count.** Manual entry inserts `effect: {}` with
  `unresolved: true` — a text note carrying no stats, no yardage and no
  down change. Delete-and-re-enter cannot help, because there is nothing
  to delete.
  Mid-game the workaround is fine: enter the play now, then Adjust
  Down/Distance. Post-game there is no workaround at all — the yardage
  is simply lost from the box score.
  **How often this matters is unknown.** It depends entirely on how
  often a play gets missed during live entry, which real games will
  answer. Worth watching for during the season rather than building
  speculatively — but if it happens even a couple of times a game, the
  stat accuracy the whole app exists for is being quietly eroded, and
  this jumps the queue.

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

## 5b. Receiver targets — DONE Aug 7, 2026

- [x] Intended-receiver field added to the interception panel.
- [x] `tgt` counted in `computeBoxScore` on completions, incompletions
  and interceptions; two-point conversions excluded per NFHS.
- [x] `Tgt` column on all four report pages, with `Catch %` on recap,
  stat package and season report.
- [x] `tests/receiver_targets_check.js`.

**Still open, deliberately.** The receiver is optional and on an
incompletion is often genuinely unknown, so **targets are a floor, not a
count** — 4 from 4 can really be 4 from 7. Not yet decided whether to
label that in the reports or make the intended receiver required on
incompletions, which would slow the fastest-moving entry in the app.

- [ ] Decide how to handle the undercount: label it, or require the
  field. Worth deciding after a real game shows how often the receiver
  actually goes unnamed.

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

### Two-factor authentication for admin accounts

- [ ] **TOTP MFA on admin accounts — do this AFTER the RLS work above,
  not before.** Supabase Auth has it built in (`auth.mfa.enroll`,
  `auth.mfa.challengeAndVerify`), authenticator-app based rather than
  SMS. Once a factor is verified the session carries an assurance
  level: `aal1` for password-only, `aal2` after the second factor.

  **The ordering is the whole point.** Every policy today is
  "are you signed in", so any authenticated account can already delete
  plays or edit games by calling the API directly, without ever loading
  a page. A second factor on the login screen does not help while that
  is true — it adds friction for the coaches and changes nothing an
  attacker would rely on.

  Done in the right order, the assurance level becomes enforceable in
  the same role-aware policies: require `aal2` for the destructive
  operations specifically — delete a game, reset a game, change a role
  — while ordinary play entry stays at `aal1` so a scorer is not
  challenged mid-drive.

  Also decide before building: what happens when an admin loses their
  phone. Supabase does not ship a recovery-code flow, so either a
  second enrolled admin can clear the factor, or you keep a documented
  SQL escape hatch.

  Verify the API shape against
  `supabase.com/docs/guides/auth/auth-mfa` first — it has changed
  before, and these notes predate any check.

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
