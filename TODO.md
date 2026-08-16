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

- [x] **`gamePhase` and `guided_state` are stored, so they can disagree
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
- [x] `season_report.html` chart rendering (Chart.js is stubbed —
  numbers are checked, visuals are not).
  **Deferred by Andy to end of season** — needs several real games
  before it is worth looking at.
- [x] Multi-game season aggregation (only ever tested with one game).
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
  **KEPT ON THE LIST LONG-TERM, Andy 12 Aug 2026.** Not before the
  season: the mid-game workaround (enter it now, then Adjust
  Down/Distance) is adequate, and the post-game case has no workaround
  but also no evidence yet of how often it happens.

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

- [x] **DECIDED 12 Aug 2026: leave it as is.** No label, no required
  field. The receiver stays optional on completions AND incompletions,
  and the scorer decides play by play whether it is worth capturing.

  Andy's reasoning, and it is the right call: whoever is entering knows
  what they chose to track. A caveat under the table tells them something
  they already know, and a required field takes the decision away on the
  fastest-moving path in the app — an incompletion is the quickest play
  to log and the least likely moment to want an extra pick.

  **The consequence, stated once so nobody rediscovers it as a bug:**
  targets are a count of PASSES WHERE A RECEIVER WAS NAMED, not of passes
  thrown at someone. Catch% is therefore catches over named targets. If a
  scorer names the receiver on completions but not incompletions, catch%
  trends towards 100%. That is a property of how it was entered, not a
  fault in the arithmetic.

  Same shape as team TFL versus per-player TFL: the number answers
  exactly the question it was given, and the entry decides which question
  that is.

---

## 5c. Edit the roster during a game

Raised Aug 7, 2026, after two players sharing #5 left one of them
unreachable mid-game.

**The immediate cause is fixed** — shared numbers are now recorded as
ambiguous and both players are offered, so that specific case no longer
needs a roster edit. This item is about the general gap.

**What is still not possible mid-game:** adding a player who is not on
the roster at all under his own name, correcting a misspelling, or
fixing a wrong jersey number. The workaround is to type the number,
which records the play correctly but shows `#21` instead of a name for
the rest of the game and in every report.

- [x] **DECIDED 12 Aug 2026: allow it, and warn loudly.** Andy's call —
  cheap, and it trusts the scorer.

  The rejected alternatives, so nobody re-litigates them: snapshotting
  the name onto every play as it is entered would be *correct*, but it
  changes the shape of every play record for a problem that has a
  workaround. Additions-only would be safe and solve half of it. Neither
  is worth the cost when the person doing the editing is the person who
  knows what they meant.

- [ ] **BUILD: a roster panel on the game page**, writing to
  `game_rosters` for this game only.

  **The warning is the important half, not the form.** Plays store JERSEY
  NUMBERS and resolve them to names at display time, so renaming #5 from
  Reddick to Powell rewrites the history of every #5 play already
  entered — including the ones that really were Reddick. The dialog must
  say exactly that, with the count:

      "#5 already has 7 plays logged. Renaming it to Powell will show
       Powell on all of them, including plays that were really Reddick.
       Continue?"

  A generic "are you sure?" is no use here: the whole risk is not
  realising the change is retroactive.

- [ ] ADDING a number nobody has used carries no such risk and needs no
  warning. Only renaming or renumbering an in-use number does. Count the
  plays first and stay quiet when the count is zero — over-warning
  teaches people to click through.


---

## 5d. Individual tackler stats

Team TFL shipped Aug 7, 2026. Per-player tackles did not, and the gap is
worth stating plainly: **the app captures tackles and throws them away.**

"Tackled by" is filled in on most rushes and passes, stored as
`roles.defense`, and used to rank the tackler picker by credits. But
`computeBoxScore` only ever increments `int`, `sacks` and `fumRec` — a
plain tackle produces no stat at all. A defensive coordinator gets
nothing from this app today beyond three turnover-ish counts and the
team TFL.

- [x] **Count tackles per player.** `roles.defense` already carries who,
  on every scrimmage play. Counting it is the same shape as the targets
  work: a branch in `computeBoxScore` and a column in four report pages.
- [x] **Decide solo vs assisted first.** The panel takes ONE tackler, so
  today every tackle is implicitly solo. Real sheets split them, which
  means either a second field or accepting that the number is "tackles"
  with no split. Adding a second field slows the fastest-moving entry in
  the app — worth weighing against how often anyone reads the split.
- [x] **Per-player TFL** falls out for free once tackles are counted:
  a credited tackle on a play with negative yardage. Note this WILL
  disagree with the team TFL already shipped, which counts from the play
  and needs no tackler — the team number is a ceiling, the per-player
  numbers sum to something lower. Show both, or explain the difference,
  but do not let them silently contradict.

**The honest caveat, same as targets.** Naming the tackler is optional
and skipped at speed, so per-player tackles will undercount. That is
exactly why team TFL was built to count from the play log instead.
Decide whether per-player tackles are worth having as a known-incomplete
number before building them.

---

## 6. NFL-data QA harness — BUILT Aug 10, 2026

`tests/nfl/` — fetch.js, convert.js, run_qa.js. Not part of the normal
suite; `node tests/nfl/run_qa.js 5` takes about four minutes.

**THREE CONSECUTIVE CLEAN WEEKS — 2023 weeks 1, 2 and 3, Aug 10, 2026:**

| | |
|---|---|
| Games | 48 |
| Plays entered | 6,977 |
| State-progression pairs | 4,787 |
| Tier 0 / 1 / 2 / 3 issues | **0** |
| Entry failures | **0** |

Run: `node tests/nfl/run_week.js 1 2 3` (about 13 minutes, background it).

**Earlier single-week result, kept for the record:**

| | |
|---|---|
| Plays entered | 2,307 |
| Entry failures | 0 |
| State pairs checked | 1,572 |
| Tier 0 state mismatches | **0** |
| Tier 1 yardage mismatches | **0** |
| Tier 3 validateGame issues | **0** |

Run: `node tests/nfl/run_qa.js 16` (about 12 minutes).

- [x] Tier 1 — per-player rushing, receiving and passing yardage against
  nflverse. Convention-independent, so any mismatch is unambiguous.
- [x] Tier 3 — `validateGame()` must report zero issues. Needs no
  reference data, so no adjustment layer can hide a defect.
- [ ] Tier 2 — team totals, compared after normalising NFL→NFHS. Still
  deliberately NOT built. The adjustment layer is the main risk in the
  whole design, and tiers 1 and 3 being clean is the precondition.

**Three bugs it found on its first run, all in the harness rather than
the app** — which is itself the useful result, since it means 700 real
plays agreed with the engine:

1. `ui_driver` had no `loss` flag, so every negative rush was recorded as
   a gain. Fixed in the driver, and it benefits every other suite.
2. The harness never set POSSESSION, so plays were credited to whichever
   team held the ball from the previous row. Isolating one player's
   carries reproduced his total exactly, which is what pointed here.
3. The expected totals summed two-point conversion yardage, which is
   excluded from rushing and receiving totals by NFHS and the NFL alike.
   StatChat was right and the comparison was wrong.

### Tier 0 and Tier 2 added Aug 10, 2026

- [x] **Tier 0 — state progression.** Compares the down, distance, field
  position and possession the app COMPUTED against what the next
  nflverse row says they really were. This was the real gap: the harness
  re-asserted the situation before every play, so nothing ever tested
  that play N sets up play N+1. Only compares across genuinely
  consecutive pairs — same drive, same possession, no skipped row, no
  penalty on the play — then resyncs so one bad play cannot cascade.
**Both tiers mutation-tested Aug 10.** Requiring a first down to need
one extra yard is caught; making field position short by one yard is
caught on 97 of 97 pairs. An earlier "surviving" mutant turned out to
be a mutation that never applied — the string did not exist in the file
— which is worth remembering when a mutant appears to survive.

- [x] **Tier 2 — rendered output and cross-surface.** Reads the DOM to
  confirm the leading rusher actually appears on screen (everything else
  reads computeBoxScore, which would pass even if nothing rendered), and
  compares all four surfaces against each other over ~140 real plays
  instead of 19. Mutation-tested: halving recap's rushing yardage is
  caught immediately.

- [x] ~~4 Tier 0 mismatches in DAL_NYG, uninvestigated.~~ **Explained
  Aug 10.** All four were ONE cause, not four: a fumble recovered by the
  OWN team. nflverse's `yards_gained` covers the play only — a 7-yard
  catch, fumbled forward, recovered 8 yards on, still reports 7. That is
  the correct RECEIVING yardage, which is why tier 1 always passed; it
  is the field position that diverged, because the converter never
  entered the fumble. The two "Aborted" snaps were the same thing:
  `fumble=1, fumble_lost=0`. Those pairs are now excluded and counted
  separately, alongside penalties.
- [ ] **Model own-recovered fumbles in the converter** rather than
  excluding them, if tier 0 coverage is ever wanted on those ~8 pairs
  per game. Low value: tier 1 already proves the yardage is right.
- [x] **SIX WEEKS run Aug 12: 93 games, 15,341 plays, 10,140 state pairs,
  all clean.** Weeks 1-3 matched the earlier baseline exactly after the
  engine consolidation AND the per-player tackle work, which is the
  strongest evidence available that neither changed existing behaviour.

  **Week 4 found a real converter bug that three weeks never had.**
  A rusher was one yard out:

      B.Robinson left end to PHI 1 for no gain. FUMBLES,
      recovered by WAS-17-T.McLaurin at PHI -4. TOUCHDOWN.

  The converter tested `touchdown && td_team === posteam` -- both true --
  so it entered a RUSHING touchdown by Robinson. StatChat then correctly
  filled the yardage to reach the end zone, giving him a yard he never
  gained. The app was right; the harness handed it the wrong play. Now
  checks `td_player_id` matches the player being credited.

  **The lesson: new weeks keep finding things.** Three clean weeks did not
  mean the harness was correct, only that those three weeks contained no
  fumble-recovered-for-a-touchdown. Widening the data is worth more than
  re-running the same games.

- [x] ~~Run more than five games.~~ **Full week run Aug 10: 16 games,
  2,307 plays, clean.** It found one more harness bug on the way (see
  below). Next step if wanted is a full season, which is ~285 games and
  several hours — a nightly job rather than something to sit through.

**The bug the wider run found, and why it matters.** One game in sixteen
showed nine consecutive possession mismatches. The harness resynced
possession only when the EXPECTED team changed, so once the engine's
possession drifted, nothing corrected it and the same single drift got
reported nine times as nine faults. Now it compares the app's ACTUAL
possession every play and corrects on difference.

Generalise from that: a run of consecutive similar failures is usually
ONE fault plus a missing resync, not N faults. The same shape produced
the four DAL_NYG "mismatches" that turned out to be one fumble rule.

**The bug week 3 found, and it is the best one.** TEN_CLE reported a
receiver with 48 yards in nflverse and ZERO in StatChat. Cause: two
different people named **D.Hopkins** — DeAndre receiving for Tennessee,
Dustin kicking for Cleveland. `buildRoster` keyed by NAME, so they
collapsed into one player filed as a kicker, and the receiver's seven
catches went nowhere.

That is the same lesson the app itself learned about jersey numbers, in
the same session, and the harness still made the mistake: **a label is
not an identity.** The roster now keys on nflverse `player_id`.

Worth carrying forward: `computeBoxScore` currently keys buckets by
DISPLAY NAME. That is right for a high-school app where two players
almost never share a name and jersey collisions are common — but it has
the same theoretical weakness. If it ever bites, the answer is a stable
per-player id, not another label.
- [ ] Kickoffs are skipped by the converter — StatChat models the ensuing
  spot through its own flow. Worth revisiting if kick coverage stats
  ever matter.
- [ ] No nflverse equivalent exists for the high-school-specific paths:
  muffed punts and kickoffs, onside kicks, the guided flow, timeouts.
  Those stay covered by the hand-written suites.

---

## 6b. Synthetic full-game UI test — BUILT Aug 10, 2026

The third leg of end-to-end testing, agreed Aug 10, 2026 and not yet
started.

**Why NFL data cannot cover it.** The harness skips kickoffs, penalties
and anything it cannot model, and it injects possession and the spot
before every play. So the paths that are most specific to this app are
completely untested by it: the guided kickoff flow, muffed punts and
kickoffs, onside kicks, timeouts, halftime, overtime, the clock prompts,
and correction mode.

- [x] **`tests/full_game_check.js`** — 43 plays, opening kickoff to
  overtime, nothing injected. Passing and mutation-tested.

**Three findings on its first run, and only one was the app's:**

1. My assertion said only a kickoff should be offerable after a
   TOUCHDOWN. Wrong: the restriction applies after the TRY, and the PAT
   has to be enterable first. The app was right.
2. `ui_driver` had no support for the penalty panel's automatic-first-down
   or dead-ball toggles, so the driver could only ever enter the plain
   case. Added — this widens every other suite too.
3. **`validateGame` caught the test.** The scripted game punted on THIRD
   down and the checker objected: "punted 2 times but only 1 failed third
   down was recorded". The heuristic was right and my game was
   unrealistic. Good evidence that check earns its place.

**A robustness lesson worth keeping.** A divergent run can leave a click
handler queued inside the jsdom VM that fires after teardown, surfacing
as a process-level crash that no promise-level catch can see. A genuine
fault therefore looked like a broken test. Now caught with
`process.on('uncaughtException')` and reported as a failure. Any
long UI-driving test needs that guard.

- [x] ~~Hand-author ONE complete game driven entirely through the UI,
  with no state injection at all.~~ Opening kickoff through final
  whistle. Every play type, both halves, a penalty, a muff, an onside
  kick, a turnover, overtime.
  The point is not coverage breadth — the hand-written suites already
  cover each feature in isolation. The point is that nothing is
  asserted between plays: the game state has to flow from one play to
  the next for a full game, the way it does on a Friday night.
  Deterministic, so a failure points at one line.

---

## 7. Apply the whitelist pattern to the other hiding behaviours

`fake_kick_check.js` asserts that ONLY the allowed controls are live on a
fake, rather than listing the ones to hide. That inversion found a fifth
stray immediately and would have prevented four round trips.

The same shape exists elsewhere and can drift the same way:

- [x] **Phase gating after a score** — only a kickoff should be offerable.
  Currently enumerated; a play type added later would be live by default.
- [x] **The guided kickoff flow** — touchback, muffed and onside each hide  (tests/whitelist_check.js)
  a different set of fields.
- [ ] **Correction mode** — Delete controls must be absent outside it.
- [x] The punt and kickoff panels' own outcome toggles, which already hide
  fields by enumeration.

Each is a small test: enumerate the live controls, compare to a
whitelist, fail by name on anything unexpected.

---

## 8. Live data feed for vMix (and the shared engine it needs)

Raised Aug 10, 2026. Andy's broadcast setup is **vMix**, and he wants it
to pull live game data from StatChat for on-screen graphics. Nothing is
built. This section is the whole design so it can be picked up cold.

### 8a. Why this needs the engine extraction first

vMix needs COMPUTED state — score, down, distance, possession — not raw
play rows. That computation is ~666 lines (`computeState`,
`computeBoxScore`, `findDriveStarts`, `countPossessions` and friends),
currently duplicated inline across **five** HTML files. Nothing outside a
browser page can produce a feed today.

So the feed forces the fix that has been outstanding all along, and pays
for it twice.

- [x] **Extract the engine to a single `engine.js`.** Same file loaded by
  the browser pages AND by Node, using the standard dual export:

      if (typeof module !== 'undefined' && module.exports) {
        module.exports = { computeState, computeBoxScore, findDriveStarts,
                           countPossessions, parseInput, /* ... */ };
      }

  Browsers get the globals as now; `require()` works server-side.
- [x] Replace the inline copies in `game.html`, `view.html`, `recap.html`,
  `stat_package.html`, `season_report.html` with `<script src="engine.js">`.
- [x] **`engine_parity.js` becomes trivial or unnecessary** — it exists
  only to detect drift between the five copies. Keep it until the
  extraction is proven, then retire it deliberately rather than deleting
  it by accident.
- [x] Re-run the NFL harness (`node tests/nfl/run_week.js 1 2 3`) after
  the extraction. 48 games with zero issues is the baseline to match; it
  is the strongest evidence available that nothing was lost in the move.

**Risk to respect:** this touches the most-exercised code in the app
across five files at once. Do it in a quiet session, not the week of a
game. The suite (25 as of 13 Aug 2026) plus three clean NFL weeks are what makes it
survivable.

### 8b. The feed endpoint

- [x] **`/api/feed`** — a Vercel serverless function beside the existing
  `manage-users.js` and `invite-user.js`.

      GET /api/feed?game=<id>&view=score&format=xml

  Reads the plays for that game from Supabase, runs the shared engine,
  renders the requested view in the requested format. Roughly 80 lines
  once `engine.js` exists.

**Format: XML.** Confirmed against vMix's own documentation Aug 10, 2026.
vMix's spreadsheet source (CSV/XLSX) is oriented at files on disk —
"browse for the file on your computer or network" — whereas XML is
explicitly the URL one: "Select any XML compliant web site or file to
use as a data source", with an XPath setting to choose the element. JSON
also works and appears in vMix forum threads, but XML has the clearest
documented path. Build XML first; `format=json` is a cheap extra.

**Structure — vMix treats a data source as a TABLE and a title binds to a
ROW.** So repeated elements, flat attributes:

    <feed updated="2026-08-10T20:14:03Z">
      <game home="Neville" homeScore="21" away="Ruston" awayScore="14"
            quarter="3" down="2" distance="6" spot="own 34"
            possession="Neville" homeTimeouts="2" awayTimeouts="3" />
    </feed>

**Separate endpoint per graphic**, because each needs a different number
of rows:

| view | rows | for |
|---|---|---|
| `score` | 1 | the scoreboard bug |
| `drive` | 1 | plays / yards / TOP on the current drive |
| `lastplay` | 1 | ticker text |
| `rushing` | one per player | leaders graphic |
| `passing` | one per player | leaders graphic |
| `receiving` | one per player | leaders graphic |
| `defense` | one per player | leaders graphic |
| `teamstats` | 2 (one per team) | side-by-side comparison |

### 8c. The failure mode to design against

- [x] **Send no-cache headers.** There is a recurring vMix complaint of
  data sources fetching once and then never updating, and it is almost
  always HTTP caching between the host and vMix:

      Cache-Control: no-store, no-cache, must-revalidate
      Pragma: no-cache

  Get this wrong and it works perfectly in testing and freezes on game
  night. Worth an explicit test that the header is present.

### 8d. Decisions still open

- [x] **Authentication.** The feed cannot require a login or vMix cannot
  read it. A live scoreboard is public information, but the endpoint
  would expose any game by id. Either accept that, or add a per-game
  feed token (`&token=...`) generated on the game row.
- [x] **Staleness signalling.** The feed is only as live as the entry. If
  the scorer is three plays behind, so is the broadcast — and if their
  device sleeps, the feed silently freezes. Include `updated` and a
  `secondsSinceLastPlay` attribute so a graphic can grey itself out or a
  producer can notice.
- [x] **Polling cost.** At 1-2s over a two-hour game that is ~5,000
  invocations. Fine on Vercel's free tier, but consider a short
  `s-maxage` so bursts are absorbed — balanced against 8c above.

### 8e. How vMix actually consumes this — and a SECOND, much cheaper route

Worth understanding before committing to 8a, because one of these needs
almost none of it.

**Route 1 — Data Source (what 8a-8d describe).** vMix never sees a page
of ours. It reads raw values and injects them into a graphic designed
INSIDE vMix:

1. The graphic is built in vMix GT Title Designer — artwork, fonts,
   positions. Each changeable piece of text is a named field.
2. A Data Source is added pointing at our URL. vMix fetches it and shows
   a table: columns from our attribute names, rows from our elements.
3. Each column is mapped to a title field ("Mapping a Data Source to a
   Title" in the vMix docs).
4. vMix re-polls on its interval and rewrites the text in place.

Division of labour: **we own the numbers, vMix owns the look.** Andy can
redesign the scoreboard without touching StatChat. vMix can also bind an
IMAGE field to a column holding a URL, so team logos could populate
automatically rather than being baked into each template.

**Route 2 — vMix Web Browser input.** vMix can render a live web page as
a video layer. A transparent-background scoreboard page served by
StatChat would work **today**, with no engine extraction, no endpoint and
no field mapping — it is one HTML page reusing code that already exists.

| | Data Source | Web Browser input |
|---|---|---|
| Who designs the look | Andy, in vMix | us, in HTML/CSS |
| Build cost | 8a + 8b (engine extraction + endpoint) | one HTML page |
| Compositing / keying / transitions | full vMix control | a flat layer |
| Changing the design later | drag in Title Designer | a code change |
| Fits existing vMix templates | yes | no |

**Andy wants BOTH (decided Aug 10, 2026).**

- [x] **`broadcast.html` BUILT Aug 10, 2026** — a transparent score bug,
  live via the existing realtime subscription. **Generated** by
  `tools/make_broadcast.py` from `view.html` rather than hand-written, so
  the engine is byte-identical rather than drifting. Regenerate; do not
  hand-edit.

  **This is deliberate debt.** It is a SIXTH copy of the engine — exactly
  what 8a exists to remove. Taken this way so something could be in vMix
  today. When `engine.js` lands, delete the generator and have
  `broadcast.html` load `engine.js` like everything else.

  The generator makes three targeted substitutions, each of which is a
  thing view.html needs and an overlay does not: the page-fitting
  `applyDisplayScale`, the resize handler, and the **auth gate** (vMix
  cannot sign in, so the redirect would bounce it to the login page).

  **The black-page bug, Aug 10.** First vMix attempt showed nothing. The
  login *redirect* had been stripped, but the DATABASE was still gated —
  every RLS policy is `auth.role() = 'authenticated'`, so an
  unauthenticated browser input got empty results from all three queries
  and drew a transparent canvas. Fixed with **`api/gamedata.js`**: a
  read-only endpoint that reads server-side with the service key and
  returns one game's game/roster/plays/branding. The overlay no longer
  touches Supabase directly, and **polls every 2s** because realtime also
  needs a session.

  Narrower than the alternative, which was public-read RLS policies —
  those would open every game to anyone with the anon key. But it IS a
  deliberate decision to make part of a game publicly readable by id.

- [ ] **Still to do on Route 2:** more layouts than `bug` and `full`
  (drive summary, last play ticker, leaders), and a decision on whether
  the overlay should require a per-game token (8d) now that it is
  reachable without signing in.
- [x] ~~Build Route 2 first.~~ It is a fraction of the work, needs none of
  the engine extraction, and puts something usable on screen while the
  larger piece is done properly. It also flushes out the real questions
  early — what a producer actually wants on a scoreboard, refresh
  behaviour, how it looks over live video.
- [x] **A transparent scoreboard page**, e.g. `broadcast.html?game=<id>`.
  Body background transparent (vMix keys it), no chrome, no navigation,
  large high-contrast type, and a layout that assumes it is overlaid on
  moving footage rather than sitting on a white page. Reuses `view.html`'s
  engine copy as-is — no extraction needed for this route.
- [ ] Decide what goes on it: score bug only, or score plus down and
  distance plus clock. Probably a couple of variants
  (`?layout=bug`, `?layout=full`) rather than one crowded design.
- [x] Confirm vMix's Web Browser input honours CSS transparency in Andy's
  version before building to it.
- [ ] **Then Route 1** per 8a-8d, for graphics that must live inside his
  existing vMix templates.

---

### 8f. What either route can expose (verified against the engine Aug 10)

Everything `view.html` computes:

- **Situation:** possession, quarter, scores, down, distance, fieldPos,
  timeouts, possessionTime (per team), drive direction
- **Team:** total/rush/pass yards, completions and attempts, total plays,
  possessions, turnovers, penalties (count and yards), 3rd and 4th down
  conversions and percentages, explosive plays
- **Passing:** att, comp, yds, long, td, int, sacks
- **Rushing:** att, yds, long, td (including the TEAM bucket)
- **Receiving:** tgt, rec, yds, long, td
- **Defense:** int, fumRec, sacks, team TFL
- **Special teams:** fgAtt/fgMade, patAtt/patMade, punts and average,
  kickoffs and TB%
- **Branding:** team names, logos, colours, so a graphic can style itself
- **Play text** for a ticker

---

## 9. ROAD TO FIRST REAL GAME — agreed Aug 10, 2026

**First real game: ~Aug 24, 2026.** Andy's three criteria, in his words:
protect a fallback point and do not go backwards; do everything possible
for data integrity; and a vMix DATA SOURCE integration (JSON/XML), with
ALL game and view data available, no authentication.

**Standing instruction: every check must be clear before shipping.** Not
"probably fine" — the 19 suites, the fuzzer, and three NFL weeks all
green, verified, every time.

### Phase 1 — freeze the fallback (day 1)

- [x] GitHub **release tag** `v1.0-preseason`. Permanent, labelled, and
  restorable without hunting.
- [x] Record the current **Vercel deployment id** so "promote this one"
  is a known target under pressure.
- [x] **Write the rollback procedure down**, one page, in the repo.
  Nobody reads code at 7pm on a Friday.

Nothing after this point is irreversible.

### Phase 2a — engine consolidation (days 2-4, FIRST)

Argued through on Aug 10 and agreed. The deciding evidence:

- **Drift has already happened twice** (see PROJECT_NOTES ~line 477:
  possession counting diverged between copies and produced different
  numbers on different pages). `engine_parity.js` exists only because of
  it — a suite whose whole job is detecting drift that should not be
  possible.
- **Four engine changes on Aug 10 each touched 4-5 files, and one was
  missed** — the `newPossession` check did not reach `view.html`, which
  is why a drive tile failed to split, and cost a debugging round trip.
  That was a calm day with a full suite. In-season it is worse.
- **70% of view.html is engine** (1,003 of 1,431 script lines); ~4,000
  duplicated lines across five files.
- **The vMix feed needs a server-side engine anyway.** Without this we
  generate a SEVENTH copy. The choice is one copy or seven.

**Measured before deciding:** all five copies are currently byte-identical
for computeState, computeBoxScore, findDriveStarts, countPossessions,
rosterName and playerName. So this is pure deduplication — no variant
"wins", nothing is forced to change. That is what makes it safe.

- [x] Extract to `engine.js` with the dual export (see 8a).
- [x] Replace the inline copies in all five pages with `<script src>`.
- [x] **Load order matters more than anything else here.** If engine.js
  loads after inline code that uses it the page breaks — loudly, but
  jsdom is more forgiving than a browser. **Open all five pages in a
  real browser** and check the console.
- [x] Retire `engine_parity.js` deliberately.

**ACCEPTANCE, all of it:** 19 suites pass · fuzzer clean over 60 games ·
three NFL weeks match 48 games / 6,977 plays / zero issues ·
`broadcast.html` still renders · all five pages clean in a real browser.

- [x] **HARD ABORT:** not green by end of day 4, revert to the tag and
  fall back to the generator approach. Three days lost, ten in hand.

### Phase 2b — data integrity (days 2-6, parallel)

- [x] **RLS role enforcement** — the items under BEFORE GOING TO
  PRODUCTION below. Highest value on this list: a `view` account can
  currently delete plays via the API. Do this even if everything else
  slips.
- [x] **Export a game to JSON** — a download button. If anything goes
  wrong you still have the plays.
- [x] **Test the offline queue, and rehearse it.** Confirmed by hand,
  NO automated test, and it fails silently — you find out plays are
  missing after the game. Airplane mode mid-drive, then reconnect.
- [x] **Derive game phase from the log** (1b). Three lockups came from
  stored phase; all self-heal now, but a fourth variant locks the UI
  mid-game.
- [x] ~~Two simultaneous scorers~~ — **excluded from this release** by
  Andy, Aug 10. One scorer.

### Phase 3 — vMix data source (days 4-10)

- [x] `api/feed.js` — **the URL must NOT change game to game.** The
  broadcast team sets it up once, the day before, and never touches it.
  Andy's team starts the day before kickoff, so this cannot depend on a
  game being in progress.
- [x] **Broadcast toggle on the game row**, settable from the dashboard
  as soon as a game is CREATED. Dashboard shows which game is flagged so
  nobody has to wonder. Automatic fallback (most recent in-progress) only
  when nothing is flagged. Two games are never live at once (confirmed).

  **DECIDED 12 Aug: admin AND game_entry can set it** — the crew sets up
  the day before and Andy may not be there.

  **But it must be hard to change by accident.** This flag decides what
  the whole broadcast is showing. Toggling it mid-game points every vMix
  graphic at a different game, live on air, and the person who did it may
  not realise. Protections to build:

  - [ ] **Not a toggle.** A confirm step naming the game:
    "Broadcast Neville vs Ruston, 24 Aug? This is what the vMix graphics
    will show." A single tap must not be able to do it.
  - [ ] **Exclusive by construction.** Setting it clears the flag on
    every other game in the same transaction, so two games can never
    both claim it. Do this in SQL, not in the page — two people on two
    laptops would otherwise race.
  - [ ] **Much harder once the game has started.** Before kickoff a
    mistake is harmless; during play it is a live failure. Require a
    second, differently-worded confirmation if the flagged game has any
    plays entered — or refuse outright and make them clear it first.
  - [ ] **Visible everywhere it matters.** A clear "ON AIR" marker on the
    dashboard row and in the game page header. The most likely accident
    is someone not realising which game is flagged.
  - [ ] **Log who changed it and when.** One row, or a column on the
    game. When the wrong game is on air at 19:30, the first question is
    who changed it — and there is currently no audit trail anywhere in
    the app.
  - [ ] Consider whether clearing the flag needs protection too. A game
    accidentally UNflagged mid-broadcast means the feed falls back to
    "most recent in-progress", which may well be the same game — or may
    be nothing at all.

- [x] **A single STATIC key — decided 12 Aug.** Never per-game, so the
  vMix URL is set up once and never touched. Notes for building it:
  - [ ] Store it as a Vercel environment variable, NOT in the repo.
  - [ ] `api/feed.js` compares `?key=` against it and returns 401
    otherwise. The vMix Data Source URL simply carries the key.
  - [ ] It is a shared secret in a URL, which is weak — it will sit in
    vMix config and possibly in a browser history. It stops casual
    discovery, not a determined person. Acceptable: the data is a live
    scoreboard, and RLS still protects everything that matters.
  - [ ] Write down how to rotate it, and remember that rotating means
    editing every vMix data source. Rotate between seasons, not during.
- [x] The eight views from 8b, XML and JSON.
- [x] **No-cache headers** (8c) — the classic vMix "stopped updating".
- [x] **A test asserting every field the view page shows appears in some
  feed view.** That is Andy's "ALL data" requirement made checkable
  rather than assumed.

### Phase 4 — rehearsal (days 11-12)

- [ ] **A full scrimmage on the real hardware, on the venue wifi, with
  vMix live.** Enter a complete game. Deliberately drop the connection
  mid-drive. This finds what no test can.
- [x] **Same laptop throughout** — Andy is the scorer and every session has been on that machine.
- [x] Let the device **sleep and wake** mid-game. Does realtime recover?

### Phase 5 — freeze (days 13-14)

- [ ] **No code changes in the final 48 hours** except a rollback.
- [ ] Final full regression, fallback tag re-verified, rollback page
  printed on paper.

### GAPS FOUND Aug 10 that were not previously on any list

- [x] **Supabase free-tier projects pause after inactivity.** VERIFY the
  plan and the policy. If it pauses the week before a game, the first
  request of the night is a cold start or an outage. Cheap to rule out,
  catastrophic to discover at kickoff.
- [x] **No service worker: reloading while genuinely offline fails.**
  Already noted below, but reframed — a scorer who reloads on bad stadium
  wifi gets nothing. Decide whether that is acceptable or needs a cache.
- [x] ~~ **What happens if the scorer's device dies mid-game?** Plays are in~~  (Andy: not required)
  the database so another device can take over — but the pending queue is
  in that device's localStorage and would be lost. Document the
  handover, and know how many plays are at risk.
- [x] ~~ **A paper fallback.** If the app is unavailable at kickoff, what~~  (Andy: not required)
  does the crew do? One printed sheet.
- [x] **Who is on call, and what do they do?** A named person and a
  one-page runbook beats improvisation.
- [x] **Real rosters loaded**, 12 Aug 2026 — Neville's squad and the week-one
  opponent — well before game day, not on the night.
- [ ] **PDF and XLS export are completely untested.** Post-game rather
  than in-game, so lower priority, but they will be used.
- [x] **Realtime sync has no automated test.** If the view page stops
  updating live, the broadcast freezes. Worth one test.

---

## 10. Cosmetic tidy-ups for the freeze week

Found while checking browser consoles on 12 Aug. None affect function;
all three appear on every page and clutter the console, which makes a
real error harder to spot.

- [x] **Add a `favicon.ico`** to the repo root. Currently a 404 on every
  page load — harmless, but it is a red error in the console and red
  errors should mean something.
- [x] **Add `<meta name="mobile-web-app-capable" content="yes">`**
  alongside the Apple one. Apple renamed it; the old tag is deprecated
  and warns on every page.
- [x] ~~ **Supabase "Multiple GoTrueClient instances"** — `createClient` runs~~ (Andy: not worth acting on — Supabase says it is not an error)
  more than once per tab. Supabase says outright it is not an error, but
  it warns that concurrent use under the same storage key can produce
  undefined behaviour. Worth understanding before the season rather than
  wondering about it during one.

---

## 11. A "Game Supervisor" role — scoped 12 Aug 2026, NOT scheduled

Andy asked how big a job this is. Answer: **2-3 hours, mostly testing.**
Deliberately not scheduled before the first game — see the timing note.

**What it would be:** a tier between `game_entry` and `admin` that can
create games, upload opponent rosters and edit the team roster, but
cannot manage users or change roles. Effectively "admin minus account
management".

**Why it is small:** the codebase already uses a ROLE_RANK ladder rather
than scattered `=== 'admin'` checks, so a new tier slots in:

    const ROLE_RANK = { view: 0, game_entry: 1, supervisor: 2, admin: 3 };

Every existing `guardMinRoleOrRedirect(..., 'game_entry')` call keeps
working unchanged, because a supervisor outranks a scorer automatically.

- [ ] `ROLE_RANK` in six files: `create_game.html`, `customize.html`,
  `game.html`, `recap.html`, `roster.html`, and any other copy.
- [ ] `api/manage-users.js` — add `'supervisor'` to `validRoles`.
- [ ] `account.html` — role badge, dropdown option, label (3 small edits).
- [ ] `dashboard.html` — the New Game button is gated on
  `currentIsAdmin`; it needs a `currentCanManageGames` that includes
  supervisors.
- [ ] RLS: `in ('admin','supervisor')` on `games` insert (and delete, if
  decided), and on the `game_rosters`, `players` and `teams` write
  policies.

**The design question to settle first:** can a supervisor DELETE a game?
Creating one implies being able to fix a mistake, and if they cannot,
the admin is back in the loop for exactly the case this role exists to
solve. Recommendation: yes for games they can create, no for anything
else.

**Timing — why not now.** This is a permissions change days after
permissions were carefully hardened and verified, touching six files
plus the policies we just proved correct. That is how careful work gets
quietly undone. Pick it up after Phase 3 or after the rehearsal, by
which point real use will have shown whether the crew actually needs it.

---

## 12. Entry is laptop-only — decided 12 Aug 2026

Andy will never enter game data from a phone. **Laptop only.** Worth
recording, because several open items were scoped around mobile risk
that does not apply.

**What this removes from the risk list:**

- iOS suspending a background tab mid-game
- Android killing the page under memory pressure
- Mobile Safari clearing localStorage, which would take the offline
  queue with it
- Touch-target sizing on the entry panels

**What it does NOT remove:** stadium wifi still drops, on any device. The
offline queue matters just as much; it is only the device-level hazards
that are gone.

- [ ] Consider whether the entry pages should be laptop-optimised rather
  than responsive. Nothing is broken today — this is about whether
  effort spent on small-screen layout is effort wasted.
- [ ] The VIEW page is a different question: it may well be watched on a
  phone by someone not entering data, and `broadcast.html` runs inside
  vMix on a desktop. Neither is affected by this decision.

---

## 13. Season stats must come from ENDED games only

Raised by Andy 12 Aug 2026. **Currently correct, but untested** — which
is the reason to write it down rather than tick it off.

`season_report.html` line ~501 filters `.eq('status', 'final')`, and
`reports.html` does the same when listing seasons. So today an
in-progress game does not pollute season totals.

**Why it needs a test rather than trust.** The consequence of losing that
filter is subtle and one-directional: a game in progress would fold its
partial numbers into season averages, per-game charts, and every player's
season line. Nothing would look broken. Yards per game would just be
quietly wrong all season, and the error would grow as the game went on
and then vanish when it finalised — so it would be maddening to
reproduce after the fact.

- [x] **A test asserting the season report ignores non-final games.**
  Seed one `final` game and one `in_progress` game in the same season,
  and assert every season total, chart series and player line reflects
  ONLY the final one. Mutation-test it by removing the filter.
- [x] Check the same for `reports.html`'s season list — a season
  containing only in-progress games should not offer a report at all.
- [x] Decide the edge case: a game that was finalised, then UNLOCKED for
  correction, reverts to in-progress. Its stats then disappear from the
  season report until it is re-finalised. That is probably right, but it
  will look like data loss to anyone who does not know why, so it should
  at least be documented in `help.html`.

Related: the vMix feed (section 8) reads a LIVE game deliberately, which
is the opposite requirement. Do not let a fix for one break the other.

---

## 14. Keep the broadcast feed vendor-neutral

Andy, 12 Aug 2026: **this will eventually feed multiple broadcast
suites, not just vMix.** Decided then rather than discovered later.

**No per-app code is needed, and none should be written.** The ON AIR
flag is a database column saying "this is the game to broadcast". It
knows nothing about who reads it. What varies between suites is FORMAT
and TRANSPORT, both handled by one query parameter:

| Suite | Typical consumption |
|---|---|
| vMix | XML or JSON over HTTP, Data Source |
| OBS | browser source, or a text file |
| Singular.live | JSON over HTTP |
| CasparCG | XML, or a template push |
| Wirecast | JSON |

**One flag, one feed, several renderings** — `?format=xml|json|csv`.

- [x] User-facing wording says "the broadcast graphics", never "vMix"
  (done 12 Aug, dashboard prompts and the game-page banner).
- **RULE:** **Never name a field after a vendor.** No `vmix_score`, no
  `obs_ticker`. The feed describes FOOTBALL; each suite maps it to its
  own template. A vendor name in the data is how a format becomes
  impossible to change later.
- **RULE:** Keep `?format=` the only thing that varies. If a suite ever seems
  to need special-case logic, that is a signal the data shape is wrong,
  not that it needs a branch.
- **RULE:** `broadcast.html` is the exception and should stay one: it is a
  rendered overlay for a browser-source input, not data. Do not try to
  make it serve both purposes.
- **RULE:** CSV is worth adding when something needs it — several suites take
  it, and it is trivial once the views exist. Not before.

---

## 15. Five stray files in the repo — left deliberately

Noted 12 Aug 2026. **Harmless, and deleting them fought the GitHub web UI**
(a delete reported success but never reached `main`, probably committing to
a new branch instead), so they stay for now.

| File | What it is |
|---|---|
| `feed.js` *(root)* | Copy of `api/feed.js`, uploaded to the wrong place. Now STALE — still contains the abbreviation fields that were removed 12 Aug. |
| `api/engine.js` | Copy of the root `engine.js`, same story, also stale. |
| `API/invite-user.js` | The old uppercase folder. Only lowercase `api/` is live on Vercel. |
| `test` | Empty leftover directory. |
| `BROADCAST_GUIDE.md` | Superseded by `help.html#broadcast`, which is public and gets updated with the app. |

**Nothing loads any of them.** `api/feed.js` requires `./_engine.js` which
points at the root `engine.js`; the root `feed.js` is not in `api/` so
Vercel never treats it as a function.

**The one real cost:** grepping the repo for something like `homeAbbr` now
finds hits in stale copies, which will make someone think a change did not
land when it did.

- [x] ~~ Delete them at some point. If the web UI keeps refusing, the likely~~ (Andy: inconsequential)
  cause is the delete committing to a new branch rather than `main` —
  check the Pull requests tab and the branch dropdown for stray
  `patch-N` branches.
- [x] ~~ When deleting, do the files individually; git tracks files, not~~ (Andy: inconsequential)
  folders, so `API/` and `test` disappear once empty.

---

## 16. Multi-tenant, if this is ever sold — DISCUSSION ONLY

Raised 12 Aug 2026. **Nothing to build. Do not act on any of this before
a season has been run.**

### The wall is not where you would expect

Storage is a non-issue: a play row is ~525 bytes, a team-season ~3 MB, so
Supabase Pro's 8 GB holds roughly **2,700 team-seasons**.

**Vercel function invocations are the wall**, and Pro's 1,000,000/month
is a HARD CAP with no overage — unlike every other line on the bill.

    per game, 2s refresh          51,300 invocations
     1 school                    205,200 / month
     5 schools                 1,026,000 / month   OVER
    20 schools                 1,026,000 IN ONE FRIDAY NIGHT

**It breaks at about five customers.** And the shape is brutal: high
school football is all on Friday night, so an entire month's load arrives
in three hours. Serverless bills for exactly that pattern.

### Three fixes, cheapest first

1. **Edge cache with a 1-second TTL.** Eight data sources hitting one URL
   get served from cache; only one request per second reaches the
   function. ~8x, for a header change. It bends the no-cache rule, but a
   1s TTL is invisible at a 2s refresh.
2. **A `view=all` endpoint** returning every view in one response.
   Another ~8x, and it composes with the above.
3. **Stop using serverless for the feed.** One always-on container
   (Fly.io, Railway, ~$5/month) polling Supabase and serving from memory.
   Fixed cost, unlimited requests. **This is the one that actually
   scales** — marginal cost per school drops to about zero.

### A separate free environment per school: NO

Andy's suggestion, and the instinct is sound — the app is already
single-tenant, which is exactly what a silo needs. Three things kill it:

- **Vercel Hobby prohibits commercial use.** Selling this means every
  school needs Pro at $20/month, which is worse than sharing.
- **Supabase free allows two projects per org** and pauses after 7 days.
  Twenty schools means ten orgs, and every database sleeps during a bye
  week. Zero backup retention too.
- **Deployment.** We hit stale-file problems repeatedly with ONE
  deployment in a single session. Twenty means a Thursday bug fix is
  twenty uploads, and you learn which ones you got wrong on Friday night.

### The hybrid, which IS good

**One shared frontend, one Supabase project per school.** Deploy once;
each school selects its database by subdomain (`neville.statchat.app`).

- Data isolation by construction — no RLS tenant bugs are possible
- A school leaving is a project you delete
- Does NOT fix invocations; combine with fix 1 or 3 above

~$25/month per school in Supabase Pro plus a fixed frontend. At $200 a
season that works.

### The parts that are not about cost

- **The schema has single-tenant assumptions baked in** —
  `teams.is_our_team = true`, and the feed resolving "the on-air game"
  globally rather than per tenant.
- **RLS is role-based, not tenant-based.** Every signed-in user can read
  every game. Correct for one school; a data breach for many.
- **Support.** Twenty schools is twenty scorers ringing on a Friday
  night. That is the real cost of the business and it is on no invoice.

**Summary: silo the DATA, share the CODE.**

---

## BEFORE GOING TO PRODUCTION

Everything here is fine for a test app and **not** fine once real users
have accounts. Nothing in this section should be attempted the week of a
game — each item wants test accounts for `view`, `game_entry` and
`admin`, and a full pass through the app afterwards.

Audited Aug 6, 2026. RLS is enabled on all five tables, but **every
policy is just `auth.role() = 'authenticated'`** — "are you signed in."
There is no role enforcement in the database at all.

- [x] **Any signed-in user can delete any play.** `plays` has
  authenticated-only INSERT / UPDATE / DELETE / SELECT. A `view` account
  can wipe a game's log. Replace with role-aware policies.
- [x] **Any signed-in user can edit any game.** `games` has
  authenticated-only UPDATE and DELETE — status, final score, deletion.
  Includes reopening a finalized game: the admin check on Unlock to edit
  is browser-side only. A `guard_game_unlock` trigger would close that
  one path cheaply (see below), but the rest needs real policies.
- [x] **Any signed-in user can write rosters, teams and players.**
  Same authenticated-only pattern on `game_rosters`, `teams`, `players`.
- [x] **Write a `current_user_role()` SECURITY DEFINER helper** reading
  `profiles.role`, and rebuild the policies on top of it. Doing this
  wrong fails closed and stops the app dead, so it needs a test account
  per role and a deliberate pass — not a quick edit.
- [x] **Game-status and phase writes are not covered by the sync **DONE 12 Aug: game-row writes now merge pending fields and retry every 5s, and flush on wake/reconnect. Handled differently from plays on purpose — the play queue is a LIST of events, the game row is one record where only the LATEST value matters.**
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
- [x] **No service worker.** Reloading while genuinely offline fails —
  the page itself cannot be fetched, so a coach who refreshes at the
  wrong moment is locked out until the connection returns. Queued plays
  survive, but entry stops.
- [x] ~~ **Optional quick win: `guard_game_unlock` trigger** — mirrors~~ (Andy: RLS already restricts games UPDATE to admin and scorer)
  `profiles_role_guard` and makes Unlock to edit admin-only in the
  database. Two minutes, low risk, but only closes one path; not a
  substitute for real policies.
- [x] ~~Confirm no other self-write path to `profiles.role`.~~ **Verified
  12 Aug 2026.** The trigger `profiles_role_guard` runs
  `prevent_self_role_change()`: it blocks ANY role change unless the
  caller is already an admin. It is SECURITY DEFINER and tests
  `auth.uid() is not null`, so a service-key call bypasses it — which is
  how `api/manage-users.js` legitimately changes roles.

- [x] ~~ **An admin can DEMOTE THEMSELVES, and nothing stops it.** The~~ **Closed 12 Aug: the UI greys out your own role dropdown, and the threat here is accident rather than malice. With two admins it is recoverable. Andy judged the UI the right level for an accident-only risk, and he is right.**
  trigger only guards against non-admins changing roles; it happily
  allows an admin to set their own role to `view`. The account page
  greys out the self-row, but the UI is not a security boundary — a
  direct API call would go through.

  **Why it matters:** with a small number of admins, a self-demotion
  leaves nobody able to promote anyone back. The app itself offers no
  way out; it would need SQL against the database. A second admin
  account exists as of 12 Aug, which reduces this from fatal to
  annoying — but it is still a hole.

  **The fix** is a few lines added to `prevent_self_role_change()`:
  refuse when `new.id = auth.uid()` and the role is changing, so nobody
  alters their own role by any route, admin or not. Role changes then
  always come from someone else, or from the service key.

  Worth doing in the same session as the RLS work, since it is the same
  trigger and the same testing.

### Two-factor authentication for admin accounts

- [x] **TOTP MFA — BUILT 12 Aug 2026, at SIGN-IN.**

  Andy chose login-level over step-up: *"once I'm in, I'm in."* He is
  never without his phone at a game, and one predictable challenge is
  easier to live with than a prompt appearing at unpredictable moments.

  **That choice REMOVED code rather than adding it.** The step-up design
  needed a `has_mfa()` helper, an MFA-gated policy on `games` DELETE, and
  a `reset_game()` function invented purely because Reset and Undo are
  the same database operation and RLS could not tell them apart. Login
  MFA is entirely Supabase's own mechanism — being signed in *means* the
  code was entered — so none of it is needed. **No SQL at all.**

  Enrolment on the account page, challenge on the login page. See
  `sql/MFA_SETUP.md` for the procedure and the recovery command.

  **Enabled and tested 12 Aug 2026** — both admin accounts enrolled,
  sign-out/sign-in confirmed prompting for a code.

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
- **Receiver targets** on catches, incompletions and interceptions; 2PT
  excluded. Live view shows a receiver only once he has a catch.
- **Shared jersey numbers** are recorded as ambiguous and both players
  offered. The pickers always read `ambiguousOffense`; nothing had ever
  written it, so the mechanism was dead code.
- **Team tackles for loss** on all four surfaces, counted from the play
  log (sacks included, no tackler required).
- **Onside kicks** on both the manual kickoff panel and the guided flow.
  Previously there was no path: the closest was "muffed kickoff, kicking
  team recovers", which got the state right but logged a deliberate call
  as a mistake. Reuses the muff machinery -- same live-ball shape, same
  two spot fields -- but defaults to the RECEIVING team recovering,
  because most onside kicks fail.
- Three new suites: `takeover_spot_check.js`,
  `yardage_calculator_check.js`, `receiver_targets_check.js`.
  **14 suites total.**

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

---

## 15. Session of 13 August 2026 — what changed and what it left open

A working session, not a planned phase. Recorded here because several
items closed and a few new ones opened.

### Closed

- [x] **Sack never produced a tackle for loss.** A real, shipped bug:
  every sack credited a tackle and a sack but no TFL. The TFL check read
  `roles.passer.yards`, which is a POSITIVE loss magnitude, and concluded
  a seven-yard sack gained seven yards. It now reads `effect.statYds`,
  which is signed by definition and is already what the team TFL counts
  from — so the per-player floor and the team ceiling finally measure the
  same thing.
- [x] **`tackles_check.js` rewritten to drive the real UI.** It passed
  against the bug above. See `PROJECT_NOTES.md`.
- [x] **Colour helpers consolidated.** `game.html` was shadowing the
  engine's `luminance` and `safeTextColor` with its own hardened copies
  (its inline script loads after `engine.js`, so the duplicates won).
  Both now live in `engine.js` behind a new `normalizeHex`, which also
  fixes a latent white-on-white bug: `#fff` parsed as `NaN`, and
  `NaN > 0.55` is false, so a shorthand hex silently chose white text.
  **Not currently reachable** — every colour reaching the database comes
  from an `<input type="color">`, which normalises to six digits — so
  this is hardening, not a live fix.
- [x] **`markerLabel` consolidated, and midfield renamed.** Three
  byte-identical copies became one in `engine.js`. The 50 now reads
  "the 50" rather than "own 50".
- [x] **The "home/away score swap" resolved — there is no swap.** See
  section 6 above and `PROJECT_NOTES.md`. `run_qa.js` gained a per-team
  score assertion (Tier 1.5) so this cannot go unmeasured again.
- [x] **`tools/make_broadcast.py` now owns the favicon links**, which had
  been hand-added to the generated `broadcast.html` and would have been
  silently deleted on the next regeneration. `broadcast.html` regenerated
  and is no longer stale.
- [x] Yardage calculator added to the Sack panel, with a guard: a spot
  ahead of the current one is refused rather than recorded as a loss.
- [x] Sack log wording routed through `gainPhrase` — "sacked for a loss
  of 12". It was building its own string, which is exactly the drift
  `gainPhrase` exists to prevent.
- [x] Optional NFHS penalty-type dropdown, filtered by side; log line
  reworked to `PENALTY, <type>, on <team>, <±N> yards`.
- [x] Takeover spot now REQUIRED on kickoffs and punts, including the
  guided half-start flow. A half-filled spot used to be discarded in
  silence.
- [x] Last kicker and punter pre-selected, scoped three ways (kickoff /
  FG+PAT / punt).
- [x] "End 1st half" confirms, with the score in the prompt.
- [x] Quarter marker whitelisted to the one legal next quarter, and the
  button greyed out when none is legal.
- [x] View page: the down-and-distance slot is blank between drives
  rather than reading "no active drive".

### Opened

- [ ] **`normalizeHex` has no committed test.** It was verified across
  `#fff`, `#FFF`, `  #AbC  `, `red`, `''`, `null`, `undefined`, `42`,
  `#ffff` during the session, but none of that is in `tests/`. It now
  sits under every colour decision on six pages. Wants a small
  `tests/color_check.js` plus an entry in `mutation_check.js` — a suite
  that is not in the mutation runner is unproven.
- [ ] **`convert.js` drops defensive/return touchdowns and two-point
  conversions.** Documented in section 6. Tier 1.5 deducts them for now;
  fixing the converter would be strictly better, and `ui_driver` already
  drives a `twopt` panel, so that half is cheap.
- [ ] **`2023_01_GB_CHI` hangs the NFL harness.** Every other game
  finishes in ~20s; this one ran seven minutes and was killed. Unknown
  whether it is a genuine stall or sandbox contention. A game that hangs
  is worse than one that reports a wrong number, because a batch run just
  looks slow.
- [ ] **The safety clause in `expectedScore()` is unverified** — no
  safety occurred in the eight games checked, so that branch has never
  run. Suspect the clause before the engine if it ever fires.
- [ ] `create_game.html` and `customize.html` each carry a local
  `contrastingColor(hex)` with the same unguarded parsing. Neither page
  loads `engine.js`, so wiring them up means adding a dependency they do
  not currently have. Latent only — `toHex()` always emits six digits.
  A decision, not a bug.
- [ ] `tools/make_broadcast.py` still exists. Its own docstring says the
  end state is to delete it and let `broadcast.html` be a normal
  hand-maintained page loading `engine.js`, now that the engine has
  landed. Deferred, not decided.

---

## 16. Later on 13 August 2026 — entry fixes and the connection test

Continues section 15. Everything below landed the same day, after the
documentation pass, which is why section 15 does not mention it.

### Closed

- [x] **Bad-snap fumble asked for no clock.** `needsClock` tested
  `flipEligible` (ask the coach whether possession changed) and
  `endsDrive`/`newPossession`, but not `effect.flip` — a turnover that
  applies the flip ITSELF rather than offering it. The new drive got no
  start event and accrued zero time of possession. Now covers all four.
- [x] **Undo treats a half/game divider and its clock row as one unit.**
  "End 1st half" writes two rows; undo removed one, and as soon as the
  divider went the banner read first half again, so a scorer stopped
  there and left the clock row orphaned. Redo restores the group in
  order; the server delete covers every row in it.
- [x] **Manual "Set clock" button** on the corrections row, with the
  warning ONLY USE THIS ON A NEW POSSESSION in red. Writes the same
  `start` clock row the guided kickoff does. Gated with the other
  corrections, but deliberately NOT on awaiting-kickoff — the gap after
  a score is when a missing clock gets noticed.
- [x] **Shared jersey numbers: the choice is now recorded on the play.**
  See `PROJECT_NOTES.md`. Covers carrier, passer, receiver AND tackler.
  An earlier note claiming the tackler could not be fixed without
  changing the play-code format was wrong: the code string carries the
  tackler for the LOG TEXT only, and the role is built from `sel.credit`
  in the save path like every other.
- [x] **Same-unit duplicates are reachable by typing.** `playerCandidates`
  reads the ambiguous maps, not just the roster.
- [x] **Picker ordering and yardage labels key on identity**, so two #7s
  no longer both show one carry's yards.
- [x] **Seeds reach narrow roles for shared numbers** — the empty passer
  picker. **Recency outranks the seed** once anyone has played the role.
- [x] **A shared-number player who plays out of position joins the
  picker** (the halfback pass), keyed by identity so only the man who
  did it is promoted.
- [x] **Out of bounds on kickoffs**, both the normal panel and the
  guided half-start flow. Receiving team's own 35, prefilled and still
  editable. No returner or return yardage — nobody touched the ball.
- [x] **Kickoff outcome toggles are one exclusive group.** Fixed a live
  bug where a deselected toggle kept its gold tick, so two outcomes
  looked selected at once.
- [x] **The mock database now performs deletes** (`tests/harness.js`),
  recorded in `db.deleted`. No test could verify a row removal before.
- [x] **A failed play read no longer wipes the log.** See
  `PROJECT_NOTES.md` — the connection-loss test found this.
- [x] **Undo is refused offline for plays the server already has**, and
  allowed for plays entered during the outage.

### Opened

- [ ] **A `pendingDeletes` queue — considered and DELIBERATELY DEFERRED,
  not overlooked.** It would let any play be undone offline and apply
  the deletion on reconnection, which is the complete answer. Judged not
  worth the mechanism now; the precise refusal above covers the harm.
  Roughly 30 lines plus cases in `offline_queue_check.js`. Do not
  rediscover this as an oversight.
- [ ] **Re-run the connection-loss rehearsal.** The blanking bug would
  have masked anything else in that scenario, so the earlier run is not
  a clean pass. Also test what was not tested: an outage lasting past
  the 8-second connection poll, and SLEEPING the laptop rather than
  alt-tabbing.
- [ ] **`seed_starters` cannot name a specific player.** It is
  `{QB: "7"}` — slot to jersey NUMBER — so with two #7s nothing records
  which one is the starter. Everything downstream now handles ambiguity
  correctly; this is the last place that cannot state it. Would need
  `{QB: {num, name}}`, a UI confirm at seeding time reusing the
  `attachNameConfirm` pattern, and readers that accept both shapes so
  existing games keep working. Half a day. **Do not let seeding narrow
  the picker to the seeded player** — both must stay offered.
- [ ] `seedOrder` is role-ordered (QB, RB1, RB2, WR1…), so a seeded QB
  sorts ahead of the seeded RB1 even in the CARRIER picker. Pre-existing
  and consistent with the resolved list, but if the carrier picker
  should prefer a seeded RB, that is a separate deliberate change.
- [ ] The out-of-bounds path and the toggle-repaint fix have no test.
  `whitelist_check.js` already covers kickoff outcome exclusivity and is
  the natural home.
- [ ] `normalizeHex` still has no committed test (from section 15).

---

## 17. 14 August 2026 — closing the test gaps

Five items from the Night 1 list. Four closed, one half closed, and one
of them was not a defect at all.

### Closed

- [x] **`normalizeHex` has a test** — new `tests/color_check.js`. Covers
  shorthand expansion, every malformed input, luminance never returning
  NaN, readable text on every background, and `colorDistance` returning
  Infinity for unreadable input. It also guards the FIVE position lists
  against drift, which is the cheap check that would have caught the
  `SLOT` divergence.
- [x] **Out of bounds and the toggle repaint have tests** — added to
  `whitelist_check.js`. Exclusivity is checked in BOTH orders across all
  four outcomes (12 pairs), the button text must agree with its
  checkbox, and the out-of-bounds spot must move a prefilled 20 to a 35.
- [x] **`2023_01_GB_CHI` does NOT hang.** 21 seconds, zero issues, clean
  exit. Seven games in one process: all ~20s, heap flat, no degradation.
  The original report was an artefact of how it was being run in a
  shared sandbox, not a defect. **Nothing to fix — finding withdrawn.**
- [x] **The safety clause in `expectedScore()` is verified**, against
  `2023_03_IND_BAL` and `2023_03_NE_NYJ`. In both, the two points land on
  the right side and StatChat's score is exactly the real score minus the
  safety, zero issues.
- [x] **Two-point conversions are converted.** They arrived as
  `play_type` run/pass with `two_point_attempt` set and fell through to
  the ordinary branches, so the points were never scored AND the attempt
  was entered as a scrimmage play, inflating rushing and receiving totals
  with yardage NFHS excludes. `run_qa` no longer deducts for them.
  `2023_01_CIN_CLE` now reproduces its real score 24-3 exactly.
- [x] Four new mutants in `mutation_check.js`, and **three suites added
  to its SUITES list** — mutants aimed at suites the runner never ran
  would have been reported as survivors, which is worse than no mutant.

### Opened

- [ ] **`convert.js` still drops defensive and return touchdowns.**
  `scoredIt()` requires `td_team === posteam`, so a fumble return,
  interception return or punt return score is not emitted. Still
  deducted, still measured. `2023_01_GB_CHI` is the standing example
  (6 points).
- [ ] **`convert.js` does not emit safeties either.** Same shape as the
  above: known, measured, deducted rather than fixed. Both are now the
  only two deductions left in `expectedScore()`.
- [ ] **Four mutants in `mutation_check.js` are SKIPPED** because their
  anchor text no longer exists: `penalty-distance`, `returner-overload`,
  `engine-drift`, `returner-name`. A skipped mutant is counted as a
  survivor, but it is really a stale fixture — the code moved under it.
  They need re-anchoring, and `engine-drift` may be meaningless now that
  the engine is consolidated.

### Closed later the same day — the converter gaps

- [x] **Defensive and return touchdowns are converted.** All five ways
  they happen: an interception taken back, a fumble returned off a run,
  a catch stripped and returned, a STRIP-SACK returned, a punt returned,
  and a blocked field goal returned. Each needed its own branch because
  each is a different StatChat play; `scoredIt()` refuses them all by
  design, so a `defensiveTd` test was added alongside it.
- [x] **Safeties are converted** — on a run and on a sack, which is how
  both real examples occur.
- [x] **Every deduction in `expectedScore()` is gone.** Tier 1.5 now
  compares StatChat's score against the REAL score with no adjustment
  layer between them. **16 of 16 week-1 2023 games reproduce the real
  final score exactly, plus the two week-3 safety games — 18 for 18,
  zero issues.** Nine of those were never looked at while writing the
  code.

  This is what the harness was for. A deduction that covers a gap also
  hides it; with none left, any future divergence is a real finding.

### The mutation fixtures — 14 August 2026

- [x] **Ten stale mutant anchors re-pointed, not four.** The first run
  stopped before reaching the rest. Nine had simply moved into
  `engine.js` during the consolidation. A SKIPPED mutant is reported as
  a survivor, so ten stale fixtures were reading as ten blind spots —
  the opposite of the truth: the code had moved and nobody re-pointed
  the fixture.
- [x] **`engine-drift` retired.** It changed `recap.html`'s own copy of
  `computeBoxScore` to prove the copies had diverged. There are no
  copies now, so it had nothing to bite on. Replaced by a mutant
  guarding the shared-number identity fix.
- [x] **`engine_parity.js` removed from every `expectCaughtBy`** — it is
  a passing tombstone and can never catch anything, so listing it
  implied coverage that does not exist.
- [x] Four suites added to the runner: `color_check`, `tackles_check`,
  `whitelist_check`, `shared_number_check`. A mutant aimed at a suite
  the runner never runs is reported as a survivor.
- [x] **Every anchor now appears EXACTLY ONCE**, and that is checked.
  The runner uses `original.replace()`, which mutates only the first
  occurrence, so an anchor with sixteen matches mutates one branch and
  probably not the one under test. The first `shared-number` mutant did
  exactly that and survived — weak mutant, not blind suite. **Any new
  mutant must use text that appears once.**

### The runner corrupted the working tree, twice

- [x] **`mutation_check` now recovers from being killed.** It edits real
  source files and restores them in a `finally`, which covers an
  exception and does NOT cover the process being killed or running out
  of memory. It died mid-mutation twice, each time leaving a deliberate
  bug written into `game.html`.

  The second time did real damage: the corrupted file was mistaken for
  the real one and reasoned from, producing confident wrong conclusions
  about which anchors were stale. **Every diagnosis made while that run
  was in the background had to be thrown away and redone against files
  re-fetched from the repo.**

  Three changes: a breadcrumb (`tests/.mutation-in-flight.json` and a
  `.bak` of the untouched file) written BEFORE each mutation and removed
  on restore; a recovery pass at startup that puts back anything a
  previous run left in flight; and SIGINT/SIGTERM/SIGHUP handlers.
  Nothing covers SIGKILL, which is why the breadcrumb is a file on disk
  rather than a variable in memory. Verified by corrupting `game.html`
  by hand and watching the next run restore it.
- [x] **Per-suite timeout, 2 minutes.** A mutant can make a suite HANG
  rather than fail, and `execFileSync` with no timeout waits for ever,
  taking the run with it and leaving the mutation on disk. A timeout
  counts as CAUGHT: a suite that never returns has certainly noticed
  something, and the alternative is calling a hang a pass.
- [x] `.gitignore` added so the breadcrumbs never reach the repo.

**Two working rules from this.** Never run `mutation_check` in the
background while editing — it rewrites the files underneath you. And any
conclusion drawn from a source file while it is running is suspect until
re-checked against a clean copy.

### Genuine blind spots, confirmed on a clean run

- [ ] **`returner-overload` survives.** Broadening the defensive-credit
  test in `engine.js` to `if (r.defense)` — crediting a returner with an
  interception, a sack and a fumble recovery — is no longer caught by
  `cross_surface.js`. It was, before the engine moved.
- [ ] **`returner-name` survives.** Dropping the cross-roster fallback in
  `playerName` (the Aug 5 bug) is no longer caught by `run_scripted.js`.

  Both are real coverage gaps rather than stale fixtures, and both
  concern returners. One scenario using a special-teams-only returner,
  checking his defensive stats, would close both.

---

## 18. 14 August 2026 — entry polish and cross-checks

Feature work resumed briefly at Andy's request, after he called the app
feature-complete. All of it is entry ergonomics or a visible cross-check;
none of it changes how a stat is computed except the Unknown bucket.

### Closed

- [x] **The last clock entered is shown beside every clock box** — all
  four: the confirm card, the guided kickoff return, the standalone
  clock prompt and the Set clock utility. Shows the quarter too, and
  flags it in amber when it is not the current one, because the same
  8:42 is a different moment in Q1 and Q3. One helper,
  `renderLastClockHint(elId)`, a no-op when the element is absent, so a
  future panel with a clock box costs one line and cannot half-work.
  Needed `absSecToClockStr`, the inverse of `clockToAbsSeconds`: absSec
  counts up from kickoff, a clock counts down within its quarter.
- [x] **The pass outcome switches stay put.** They called
  `renderPlayPanel(...)`, which rebuilt the panel without the switch row,
  so they vanished on use. All three panels now carry the same row from
  one helper, with the current one gold and ticked, plus a third button
  ("Completed / incomplete") so Pass is a destination rather than
  somewhere you can only leave.
- [x] **Interception downed in the end zone — touchback.** Defence takes
  over at their own 20; returner, return yards and TD are hidden. The
  spot is supplied through `currentSpotGetter` like every other fixed
  spot, reusing `touchbackReset`. Previously this took 0 return yards
  plus a hand-typed spot: two chances to get it wrong on a play with a
  fixed answer.
- [x] **A completion with no receiver named now buckets to Unknown**, so
  passing yards equal total receiving yards, attempts equal targets and
  completions equal receptions. See `PROJECT_NOTES.md`.
- [x] **Time of possession is displayed** — view page (stacked under the
  timeouts, right-justified), recap, stat package, and season report
  with a per-game average. It was always computed; nothing showed it.
- [x] **Category totals beside the Passing / Rushing / Receiving headers**
  on the view page, as a check against the team tiles. Summed from the
  whole bucket, not the rows on screen.
- [x] `formatDuration` moved into `engine.js`. Three pages had a copy and
  the report pages had none, so adding TOP to the recap would have meant
  a fourth.
- [x] `coverage_probe` is at **48/48**, including the new interception
  touchback. It was 42/47 before this session: five paths were reading
  as unreachable UI when they were really stale fixtures that predate
  the mandatory takeover spot.

### Answered, no change needed

- [x] **A pass intercepted, returned, then fumbled** is enterable today
  as two plays: the interception (with the takeover spot set to WHERE
  THE FUMBLE HAPPENED, not where the return ended), then the standalone
  Fumble panel with the interceptor typed as the carrier. Verified end
  to end — possession goes A → B → A, both turnovers are counted, the
  interception and the fumble recovery are both credited, and the QB is
  charged with the pick. **Worth adding to `GOLDEN_GAME.md` as a Night 5
  case:** it happens about once a season, is entered under pressure, and
  getting the spot convention backwards is silent.

### Still open from earlier

- [ ] `tests/README.md`, `tests/nfl/run_qa.js`, `tests/nfl/convert.js`
  and `.gitignore` have not been uploaded yet.
- [ ] `returner-overload` and `returner-name` mutants still survive — one
  scenario with a special-teams-only returner would close both.
- [ ] The Night 1 items that need the live Supabase instance: verify the
  foreign-key cascade, take a backup, run Reset for production against a
  throwaway 2099 game, and clear the roster and confirm a finished game
  keeps its names.

---

## 19. 15 August 2026 — overtime, print output, and a first real roster

The longest session so far. Andy ran the first live test of the overtime
button and most of this came out of it.

### Overtime — closed

- [x] **Series flow.** Overtime is played in series; the app treated it as
  continuous football, so the second team inherited the ball wherever the
  first team's drive died and no new drive began. The guided panel now
  returns by itself when a series ends, names the team, and prefills the
  opponent's 10.
- [x] **`otSeriesTeam` tracked separately from possession** — they
  disagree constantly. See `PROJECT_NOTES.md`.
- [x] **OT1 / OT2 / OT3 in both headers**, via a shared `quarterLabel()`
  in `engine.js` so the two banners cannot drift. Play rows in the drive
  log say `OT` rather than `Q5`.
- [x] **`otSeriesStart` flag** so a manual possession flip no longer
  advances the round.
- [x] **End of regulation** divider written when overtime starts.
- [x] **End game from between series** — the panel disables the rest of
  the page, so there was no way to finish. `finalizeGame()` extracted
  rather than copied; offered only when one side is ahead.
- [x] **Kickoff and Punt greyed out in overtime.** Field goal left live —
  it is how most series end.
- [x] **Time of possession stops at the end of regulation**, and the
  clock prompt is suppressed there entirely.
- [x] **OT column** in the recap and stat package quarter lines. Both had
  been folding overtime points into Q4; the stat package's XLS export had
  it right, so the spreadsheet and the page disagreed.
- [x] **Feed reports overtime properly** — `quarter` gives OT1/OT2/OT3,
  `lastplay` says OT not Q5, and a new `overtimeRound` field.

### Entry and reporting — closed

- [x] Clock asked at the **touchdown**, not the try, so a scoring drive's
  time is the drive's rather than the drive plus the PAT
- [x] After a touchdown, only PAT and 2PT are available. Keyed on six
  points, not `effect.td` — returned touchdowns do not set that flag
- [x] A muffed punt recovered by the kicking team is a **turnover**
- [x] **Name an unknown number mid-game**, written to `game_rosters`, and
  it applies to plays already entered
- [x] **Blank positions accepted on roster import** — a real 95-player
  roster had positions for 26
- [x] Punt calculator fills the takeover spot, flipped
- [x] Fake punt has a calculator, moved into the fake block
- [x] Incomplete pass hides the calculator and clears what it held
- [x] Previous drive tile shows plays/yards
- [x] Comp/Att and Rec/Tgt order on all four surfaces
- [x] `safeTextColor` uses **WCAG contrast**, not a luminance gap
- [x] Drive cards coloured for whoever had the ball
- [x] Picker buttons lead with the number; yardage labels dropped
- [x] Stat package group headings 19px in a gutter, Possession last
- [x] PDF: sections never split; recap keeps the team block on page one
- [x] Roughing the passer moved to Personal foul / conduct

### Public recap sharing — closed 15 Aug 2026

- [x] `games.is_public`, defaulting to false, plus anon SELECT policies on
  `games`, `plays`, `game_rosters` and `teams`. Every read policy requires
  **`status = 'final'` AND `is_public = true`** — never `is_public` alone,
  so unlocking a shared game for corrections takes it out of `final` and
  the public read stops matching.
- [x] **Column grants**, not just a policy. RLS is row-level, so a policy
  alone handed anon the whole `games` row — including `created_by` and
  `broadcast_set_by`, which are account ids. Anon now has fourteen named
  columns; `authenticated` is untouched. `recap.html` asks for those
  fourteen by name and must stay a subset of the grant.
- [x] Admin-only UPDATE policy, so a `view` account cannot publish.
- [x] Share control on the recap page beside Download PDF. The admin gate
  fails closed — an errored role lookup is not read as permission.
- [x] Signed-out visitors are no longer redirected. An unshared game
  returns no rows and says so.
- [x] `noindex, nofollow` on the recap: the link should reach the people
  it was sent to, not become a searchable page of minors' names.
- [x] SHARED badge on the dashboard row. The recap page can tell you about
  the game you are looking at; only the list tells you which games are
  still public in March.
- [x] Open Graph tags so a shared link previews as StatChat with a logo
  rather than a bare domain.
- [x] SQL kept in `sql/public_recap_sharing.sql`, checks first.

### Also closed 15 Aug 2026

- [x] Season report: time of possession moved from Discipline to
  **Efficiency**. Keeping the ball describes how a team controlled a
  game, the same question third and fourth down conversion answers --
  it was sitting with Penalties and Sacks allowed, which are mistakes.
- [x] `TEST_WEEK.md` gains **Night 6b — Public sharing**. The feature
  shipped with no automated coverage, and it is the only part of the app
  where a mistake is visible outside the building.

- [x] `TEST_WEEK.md` restructured, 15 Aug 2026. **Reset for production
  cannot be rehearsed** — it deletes every game in every season, so the
  old Night 1 instruction to run it "against a throwaway 2099 game"
  would have destroyed the week's test data on the first evening. It and
  Clear roster now form Night 8, which is going live. The backup line is
  gone: backups are automated.

### On the horizon — a second instance for beta testing

- [ ] **Make the deployment clonable, so another organisation can beta
  test alongside Neville.** Agreed 15 Aug 2026. Do this AFTER the test
  week: it touches all fourteen pages, and the thing being tested should
  stop moving first.

  **The shape: a second INSTANCE, not multi-tenancy.** One GitHub repo,
  two Vercel projects, two Supabase projects. Same code, different
  environment. Separate database, separate users, separate rosters —
  nothing the other organisation does can reach Neville's data, and both
  run whatever is on `main`.

  Real multi-tenancy — an `org_id` on every table, RLS scoped by it — is
  the commercial path and the wrong shape for one beta partner. It would
  touch every query, every policy, the roster, the teams table and the
  feed, and it would put two organisations' data one policy mistake apart.

  **Blocker 1 — credentials are hardcoded in 14 files.**

      const SUPABASE_URL = 'https://pboushzlcyfkssojpuut.supabase.co';

  in account, broadcast, broadcast_setup, create_game, customize,
  dashboard, game, index, recap, reports, roster, season_report,
  stat_package and view. A second deployment would need all fourteen
  edited, which means two divergent copies of the code — exactly what
  makes shipping a fix to both painful.

  Fix: extract to a single `config.js` that every page loads. Better
  still, have a tiny Vercel function emit it from environment variables,
  so both deployments run BYTE-IDENTICAL code and differ only in Vercel
  env vars. That is the difference between "clone" and "fork".

  **Blocker 2 — there is no schema in the repo.** `sql/` holds only the
  sharing migration. The tables, RLS policies, roles and the profiles
  trigger exist in the Supabase dashboard and nowhere else. A new project
  has nothing to build from.

  Fix: `pg_dump --schema-only` committed as `sql/schema.sql`, plus a
  `sql/seed.sql` with the minimum that makes an empty instance usable —
  one team row and the roles. **This is worth doing on its own merits.**
  The schema currently exists in exactly one place, and that place is a
  hosted dashboard.

  The schema dump half is NOT waiting for the test week — it is on the
  Night 1 checklist, because it costs half an hour and protects something
  that currently cannot be rebuilt. `seed.sql` and `config.js` are the
  parts that wait.

  **Subdomains of statchat.co.** Andy's call: Neville stays on the apex
  or `neville.statchat.co`, the beta partner gets their own subdomain.
  Each Vercel project takes its own domain, so nothing is shared but the
  code.

  Two things to check when doing it, both already half-handled:
    - `api/share.js` and `api/og.js` derive the origin from the request
      headers, so share links and preview cards follow the subdomain with
      no change.
    - `recap.html` still has `https://nevillestatchat.vercel.app/logo.png`
      hardcoded in its fallback og tags, and `broadcast.html` has the same
      host in a comment. The fallback tags only show when api/share.js is
      bypassed, but on a second instance they would advertise Neville.

  **Environment values a new instance needs** (five):
  `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FEED_KEY` on the server; and
  the Supabase URL plus publishable key on the client, which is what
  `config.js` exists to carry.

  **Deliverable:** a `DEPLOYING.md` that reads: create a Supabase project,
  run `sql/schema.sql` then `sql/seed.sql`, create a Vercel project from
  the same repo, set five environment variables, point the subdomain at
  it. Twenty minutes, repeatable, and the same procedure for a third
  organisation later.

  Rough size: a couple of hours, most of it mechanical.

- [x] **Standing rule: the schema is committed with every change**
  (15 Aug 2026). `sql/README.md` sets out the four steps — numbered
  migration, run it, re-dump `sql/schema.sql`, diff the dump. RLS
  policies, grants, roles and indexes all count. The existing sharing SQL
  is renamed `001_public_recap_sharing.sql`; migrations are numbered from
  here and never edited once run.

### Still open

- [x] **Server-rendered share route — done 15 Aug 2026.** `/g/<id>`,
  rewritten by `vercel.json` to `api/share.js`, which looks the game up
  with the service key, checks final AND is_public itself (the service
  key bypasses RLS, so the condition is written out rather than relied
  upon), and returns recap.html with the game's own tags injected:
  *Neville 28 — Sterlington 21*.

  Three things that were not obvious:
    - **`<base href>` is required.** The recap loads `engine.js`,
      `team-icon.js` and `logo.png` by relative path; at `/g/<id>` those
      resolve to `/g/engine.js` and 404. Without it the page is blank.
    - **The id has no query string to come from.** It is injected as
      `window.__SHARE_ID` and recap.html falls back to it.
    - **The file's own og: tags are stripped first.** Two sets in one
      head is undefined — some scrapers take the first, some the last.

  Serves the page rather than redirecting: a redirect after the scraper
  has taken the tags is cloaking, and some scrapers follow it and preview
  the destination anyway.

  `recap.html?id=` still works, so links already sent are unaffected.

- [ ] `.gitignore` and `tests/ui_driver.js` are not uploaded.
  **ui_driver matters**: the repo copy is missing the punt-muff branch
  that the uploaded `coverage_probe.js` depends on, so the gate is red
  against the repo until it lands.
- [ ] **Fake FIELD GOAL still has no calculator.** The FG panel never had
  one to retarget. Same need as the fake punt.
- [ ] Clipping and Tripping are personal fouls in NFHS and still sit under
  "During the play". Andy's call.
- [ ] Two players named "Kevin Anderson" (#44, #85) in the Sterlington
  roster. The box score buckets by name, so they merge silently — the app
  cannot detect it. One needs a distinguishing name before use.
- [ ] `returner-overload` and `returner-name` mutants still survive
- [ ] The Night 1 items that need the live Supabase instance
