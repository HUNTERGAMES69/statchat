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

- [ ] **Decide whether this is worth building.** The workaround is not
  terrible — the stats are right, only the display is bare. Weigh that
  against a real piece of work before starting.
- [ ] If yes, the scope is: a panel on the game page that writes to
  `game_rosters` for this game, plus a decision on the awkward part —
  **what happens to plays already logged against a number whose meaning
  changes.** Renaming #5 from Reddick to Powell silently rewrites the
  history of every #5 play already entered, because the log resolves
  names at render time rather than storing them. That is fine when
  correcting a typo and wrong when the number genuinely changed hands.
  Options: allow renames only for numbers with no plays yet; or store
  the resolved name on the play at entry so history is immutable (a
  bigger change, and it would also fix the same latent issue for the
  existing shared-number picker).
- [x] ~~The opponent roster upload does not warn about duplicate
  numbers.~~ **Fixed Aug 7:** it no longer needs to. Setup keeps every
  player sharing a number instead of making the coach pick one, and the
  game page offers each of them per play. A shared number is a fact
  about the team, not a conflict.

**One consequence worth knowing.** Games created BEFORE this fix have
only the chosen player in `game_rosters` — the other was never written.
Re-uploading the roster on the setup page will now save both. For a game
already in progress, inserting the missing row directly into
`game_rosters` also works: the game page re-reads that table on every
load rather than working from a snapshot.

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

- [ ] **Count tackles per player.** `roles.defense` already carries who,
  on every scrimmage play. Counting it is the same shape as the targets
  work: a branch in `computeBoxScore` and a column in four report pages.
- [ ] **Decide solo vs assisted first.** The panel takes ONE tackler, so
  today every tackle is implicitly solo. Real sheets split them, which
  means either a second field or accepting that the number is "tackles"
  with no split. Adding a second field slows the fastest-moving entry in
  the app — worth weighing against how often anyone reads the split.
- [ ] **Per-player TFL** falls out for free once tackles are counted:
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

- [ ] **Phase gating after a score** — only a kickoff should be offerable.
  Currently enumerated; a play type added later would be live by default.
- [ ] **The guided kickoff flow** — touchback, muffed and onside each hide
  a different set of fields.
- [ ] **Correction mode** — Delete controls must be absent outside it.
- [ ] The punt and kickoff panels' own outcome toggles, which already hide
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

- [ ] **Extract the engine to a single `engine.js`.** Same file loaded by
  the browser pages AND by Node, using the standard dual export:

      if (typeof module !== 'undefined' && module.exports) {
        module.exports = { computeState, computeBoxScore, findDriveStarts,
                           countPossessions, parseInput, /* ... */ };
      }

  Browsers get the globals as now; `require()` works server-side.
- [ ] Replace the inline copies in `game.html`, `view.html`, `recap.html`,
  `stat_package.html`, `season_report.html` with `<script src="engine.js">`.
- [ ] **`engine_parity.js` becomes trivial or unnecessary** — it exists
  only to detect drift between the five copies. Keep it until the
  extraction is proven, then retire it deliberately rather than deleting
  it by accident.
- [ ] Re-run the NFL harness (`node tests/nfl/run_week.js 1 2 3`) after
  the extraction. 48 games with zero issues is the baseline to match; it
  is the strongest evidence available that nothing was lost in the move.

**Risk to respect:** this touches the most-exercised code in the app
across five files at once. Do it in a quiet session, not the week of a
game. The 18 suites plus three clean NFL weeks are what makes it
survivable.

### 8b. The feed endpoint

- [ ] **`/api/feed`** — a Vercel serverless function beside the existing
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

- [ ] **Send no-cache headers.** There is a recurring vMix complaint of
  data sources fetching once and then never updating, and it is almost
  always HTTP caching between the host and vMix:

      Cache-Control: no-store, no-cache, must-revalidate
      Pragma: no-cache

  Get this wrong and it works perfectly in testing and freezes on game
  night. Worth an explicit test that the header is present.

### 8d. Decisions still open

- [ ] **Authentication.** The feed cannot require a login or vMix cannot
  read it. A live scoreboard is public information, but the endpoint
  would expose any game by id. Either accept that, or add a per-game
  feed token (`&token=...`) generated on the game row.
- [ ] **Staleness signalling.** The feed is only as live as the entry. If
  the scorer is three plays behind, so is the broadcast — and if their
  device sleeps, the feed silently freezes. Include `updated` and a
  `secondsSinceLastPlay` attribute so a graphic can grey itself out or a
  producer can notice.
- [ ] **Polling cost.** At 1-2s over a two-hour game that is ~5,000
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
- [ ] **A transparent scoreboard page**, e.g. `broadcast.html?game=<id>`.
  Body background transparent (vMix keys it), no chrome, no navigation,
  large high-contrast type, and a layout that assumes it is overlaid on
  moving footage rather than sitting on a white page. Reuses `view.html`'s
  engine copy as-is — no extraction needed for this route.
- [ ] Decide what goes on it: score bug only, or score plus down and
  distance plus clock. Probably a couple of variants
  (`?layout=bug`, `?layout=full`) rather than one crowded design.
- [ ] Confirm vMix's Web Browser input honours CSS transparency in Andy's
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

- [ ] GitHub **release tag** `v1.0-preseason`. Permanent, labelled, and
  restorable without hunting.
- [ ] Record the current **Vercel deployment id** so "promote this one"
  is a known target under pressure.
- [ ] **Write the rollback procedure down**, one page, in the repo.
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

- [ ] Extract to `engine.js` with the dual export (see 8a).
- [ ] Replace the inline copies in all five pages with `<script src>`.
- [ ] **Load order matters more than anything else here.** If engine.js
  loads after inline code that uses it the page breaks — loudly, but
  jsdom is more forgiving than a browser. **Open all five pages in a
  real browser** and check the console.
- [ ] Retire `engine_parity.js` deliberately.

**ACCEPTANCE, all of it:** 19 suites pass · fuzzer clean over 60 games ·
three NFL weeks match 48 games / 6,977 plays / zero issues ·
`broadcast.html` still renders · all five pages clean in a real browser.

- [ ] **HARD ABORT:** not green by end of day 4, revert to the tag and
  fall back to the generator approach. Three days lost, ten in hand.

### Phase 2b — data integrity (days 2-6, parallel)

- [ ] **RLS role enforcement** — the items under BEFORE GOING TO
  PRODUCTION below. Highest value on this list: a `view` account can
  currently delete plays via the API. Do this even if everything else
  slips.
- [ ] **Export a game to JSON** — a download button. If anything goes
  wrong you still have the plays.
- [ ] **Test the offline queue, and rehearse it.** Confirmed by hand,
  NO automated test, and it fails silently — you find out plays are
  missing after the game. Airplane mode mid-drive, then reconnect.
- [ ] **Derive game phase from the log** (1b). Three lockups came from
  stored phase; all self-heal now, but a fourth variant locks the UI
  mid-game.
- [x] ~~Two simultaneous scorers~~ — **excluded from this release** by
  Andy, Aug 10. One scorer.

### Phase 3 — vMix data source (days 4-10)

- [ ] `api/feed.js` — **the URL must NOT change game to game.** The
  broadcast team sets it up once, the day before, and never touches it.
  Andy's team starts the day before kickoff, so this cannot depend on a
  game being in progress.
- [ ] **Broadcast toggle on the game row**, settable from the dashboard
  as soon as a game is CREATED. Dashboard shows which game is flagged so
  nobody has to wonder. Automatic fallback (most recent in-progress) only
  when nothing is flagged. Two games are never live at once (confirmed).
- [ ] One **static** key if we want any gate at all — never per-game.
- [ ] The eight views from 8b, XML and JSON.
- [ ] **No-cache headers** (8c) — the classic vMix "stopped updating".
- [ ] **A test asserting every field the view page shows appears in some
  feed view.** That is Andy's "ALL data" requirement made checkable
  rather than assumed.

### Phase 4 — rehearsal (days 11-12)

- [ ] **A full scrimmage on the real hardware, on the venue wifi, with
  vMix live.** Enter a complete game. Deliberately drop the connection
  mid-drive. This finds what no test can.
- [ ] Test on **the actual device the scorer will use** — nobody has yet.
- [ ] Let the device **sleep and wake** mid-game. Does realtime recover?

### Phase 5 — freeze (days 13-14)

- [ ] **No code changes in the final 48 hours** except a rollback.
- [ ] Final full regression, fallback tag re-verified, rollback page
  printed on paper.

### GAPS FOUND Aug 10 that were not previously on any list

- [ ] **Supabase free-tier projects pause after inactivity.** VERIFY the
  plan and the policy. If it pauses the week before a game, the first
  request of the night is a cold start or an outage. Cheap to rule out,
  catastrophic to discover at kickoff.
- [ ] **No service worker: reloading while genuinely offline fails.**
  Already noted below, but reframed — a scorer who reloads on bad stadium
  wifi gets nothing. Decide whether that is acceptable or needs a cache.
- [ ] **What happens if the scorer's device dies mid-game?** Plays are in
  the database so another device can take over — but the pending queue is
  in that device's localStorage and would be lost. Document the
  handover, and know how many plays are at risk.
- [ ] **A paper fallback.** If the app is unavailable at kickoff, what
  does the crew do? One printed sheet.
- [ ] **Who is on call, and what do they do?** A named person and a
  one-page runbook beats improvisation.
- [ ] **Load the real rosters** — Neville's squad and the week-one
  opponent — well before game day, not on the night.
- [ ] **PDF and XLS export are completely untested.** Post-game rather
  than in-game, so lower priority, but they will be used.
- [ ] **Realtime sync has no automated test.** If the view page stops
  updating live, the broadcast freezes. Worth one test.

---

## 10. Cosmetic tidy-ups for the freeze week

Found while checking browser consoles on 12 Aug. None affect function;
all three appear on every page and clutter the console, which makes a
real error harder to spot.

- [ ] **Add a `favicon.ico`** to the repo root. Currently a 404 on every
  page load — harmless, but it is a red error in the console and red
  errors should mean something.
- [ ] **Add `<meta name="mobile-web-app-capable" content="yes">`**
  alongside the Apple one. Apple renamed it; the old tag is deprecated
  and warns on every page.
- [ ] **Supabase "Multiple GoTrueClient instances"** — `createClient` runs
  more than once per tab. Supabase says outright it is not an error, but
  it warns that concurrent use under the same storage key can produce
  undefined behaviour. Worth understanding before the season rather than
  wondering about it during one.

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
