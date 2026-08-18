# StatChat — session handoff, 17 August 2026

This file exists because a chat filled up mid-flight. It records what was
in progress at the moment it ended, so the next session resumes rather
than restarts.

`PROJECT_NOTES.md` holds the durable reasoning and `TODO.md` the work
list. **This file is different: it is the state of things that were still
moving.** Once the open decisions below are settled, fold anything worth
keeping into those two and delete this.

---

## Where things stand

Everything from this session is deployed except where noted. All 31 test
suites pass.

### Reports — finished

The game recap, the single-game stat package and the season report were
reworked and Andy signed each off in turn:

- **Scoring summary** added to the recap and the stat package, built by
  `scoringSummary()` in `engine.js` so the two cannot disagree. A
  touchdown and its try are one entry. The quarter is derived from
  `setQuarter` markers, not the play's own column, which is null on older
  rows.
- **Section headers**: an eyebrow naming the document, a large title and
  an optional subtitle for document sections; a team-coloured band for
  anything belonging to a team. `sectionHead()` and `teamBand()` in each
  report page. The eyebrow is print-only.
- **Print**: backgrounds forced with `print-color-adjust`, a running
  footer on every page, a logo end mark on the last, team blocks that
  start their own sheets, and sizing tuned to fill pages rather than
  strand them.
- **Player report** (`player_report.html`, new) — one player's season,
  reachable from `reports.html`. Categories he never appears in are
  omitted. Sections are ordered by **volume**, so a punter who threw once
  on a fake leads with punting.

### Broadcast — finished

- `broadcast_leaders.html` (new) with six season-leader overlays, and
  `api/seasondata.js` (new) feeding it server-side.
- Loads once, no polling. Finished games do not change during a
  broadcast.
- A season with no finished games shows nothing and does **not** fall
  back to a previous season. `?debug=1` explains a blank panel.

### Play entry — finished

- Calculators added to the **bad snap** panel and the **field goal tee**
  (distance = tee yard line + 10), and an **interception takeover-spot**
  calculator.
- The punt takeover spot now follows calculator corrections instead of
  filling once.
- The field goal spot fields hide unless the kick is missed or blocked.

### Roster and picker — finished

- The offensive picker's **ambiguous list is now gated on the starters
  list**. It previously admitted every shared number on the roster whose
  position fitted the role. On the St. Thomas More roster that turned six
  seeded starters into 28 buttons; it is 7 now, the extra being a genuine
  same-side collision.
- The importer **reports shared numbers**, split three ways: likely
  duplicate people, same-side collisions that need a decision, and
  cross-side collisions that need nothing.

### Touchbacks — finished, with a compatibility path

The guided start-of-game flow writes the kick and its outcome as two
plays, so `roles.kicker.touchback` was never set and the stat package
showed 0%. New plays carry `kickoffTouchback` on the outcome play; the
engine also infers a touchback from a `kickoff_return` play whose text
says TOUCHBACK, which recovers games already in the database.

---

## Still open — Andy is testing three input prototypes

**This is the live question.** `game.html` is untouched by any of it.

| File | Yardage / position | Jersey and clock |
|---|---|---|
| `gametest.html` | keypad button beside every field | keypad |
| `gametest2.html` | field strip button beside every field | keypad |
| `gametest3.html` | **tap the field** opens the keypad, no button; strip button on yardage and yard-line fields | keypad |

He is entering a full game on each. The decision is whether yardage is
better expressed as **a number** (keypad) or **a place** (field strip),
and whether tapping the field beats a button.

Things worth knowing before changing any of them:

- Launchers are attached at **runtime** by a `MutationObserver`, not
  written into each markup site. Ids are built by concatenation, several
  fields only exist once a toggle is ticked, and a hand-written list was
  tried and abandoned.
- `PICKER_MODE` is the only difference between `gametest` and
  `gametest2`.
- The keypad **commits only on Done**. Committing per tap put half-typed
  values into fields that drive other fields.
- The keypad and the physical keyboard share one buffer, in both
  directions.
- The strip mirrors itself to match `state.driveDir`, and says so with an
  arrow and chevrons. Only the drawing flips; positions stay
  possession-relative.
- `inputmode="none"` in `gametest3` suppresses the soft keyboard. If
  Safari raises it anyway, change that one attribute to `numeric`.

**If the strip wins it replaces more than the wheel** — it answers the
same question as the four spot calculators, so it would fold those in
too.

---

## Not yet done

- **Four calculators, written separately.** The shared one in
  `renderPlayPanel` cannot be reached from outside it; hoisting it out was
  tried and broke every play panel, and was reverted. Bad snap, FG tee and
  interception each have their own copy of the arithmetic.
- **`ATH` in the picker-ranking list** at `game.html:1975` predated it
  being in `OFFENSE_POS`. Fixed, but it is the kind of half-knowledge
  worth watching for elsewhere.
- **A paste-a-table roster importer** was proposed and not built. It
  would handle MaxPreps, Hudl and an emailed spreadsheet without
  depending on any site's markup. A built-in converter and a MaxPreps
  integration were both considered and rejected — the reasoning is in
  `PROJECT_NOTES.md`.

---

## Two traps this session, both worth remembering

**A guard that silently does nothing.** Three separate bugs were a
condition that was quietly false: `padWriting` left true by an exception,
`typeof panel !== 'undefined'` in a scope where `panel` does not exist,
and an outside-click handler closing a popover in response to the
popover's own programmatic click. None of them threw. All three looked
like a feature that had stopped working.

**The standalone engine checker cannot parse regex literals.** It scans
for SCREAMING_CASE identifiers, so `/GOOD|CONVERSION/` and `/TOUCHBACK/`
both read as undefined globals. Use string matching in `engine.js`. An
attempt to teach the checker to skip regexes ate real code and was
reverted — the guard is worth more than the tidier expression.

---

## Resuming

The repo is the source of truth, and the code carries its own reasoning
in comments. Start by reading `TODO.md` and `PROJECT_NOTES.md`, then this
file, then pull the current files from
`raw.githubusercontent.com/HUNTERGAMES69/statchat/main/` — GitHub can lag
behind Andy's local copies if an upload was skipped, so verify against
what he last downloaded rather than assuming.

---

# SESSION 2 — 17 August 2026

Everything above predates this section. **Two claims in it are false — see
"Corrections" below before trusting it.**

## Fumble entry — FIXED

A fumble ending a rush, pass or sack wrote TWO plays. That put a down on
the board the game never reached (fumble on 2nd & 11 left the rush reading
"3rd & 11") and, because 'fumble' is a scrimmage type, the second half was
counted as its own down attempt — inventing a failed third down in the
conversion table. Silent, and it reached the stat package.

**Not a regression.** Dated to 3 Aug, confirmed four ways: first appearance
of its comment, a byte-identical block diff against 16 Aug, block hashes
across every commit since 1 Aug, and the 14 Aug commit contents. The 14 Aug
TODO entry verifying interception → return → fumble as two plays is a
DIFFERENT path and correctly two plays; it is very likely why fumbles had
always seemed fine, because it documents the standalone Fumble panel, which
was never broken.

**The fix.** `parseInput` gained an attempt token, `a:<kind>:<yards>[:<passer>]`,
stripped by search not position (same pattern as `oob`). The three panels
pass it instead of pre-pushing. Effect on a LOST fumble is deliberately
unchanged — `computeState` skips the flip for stat plays, so marking it
`isStat` would silently cancel the turnover; the yardage rides on `roles`
and the spot comes from the panel. Own-team recovery IS a stat play, so the
down advances exactly once. `roles.attempt` carries the credit; `playType`
stays 'fumble' because 11 files key on it.

Verified: Andy's sequence gives `att=2 yds=3 fum=1`. Standalone Fumble panel
byte-unchanged.

### Downstream surfaces — three more places, two found late

`playType` is keyed on in eleven files. Fixing the engine was not enough:

- **`view.html` drive summary** GUESSED rush-vs-pass from the carrier's
  roster position. A completion to a receiver with no position on file
  landed in RUSHING. Same guess at `engine.js:804`. Both now read
  `r.attempt`, keeping the guess only for plays saved before it existed.
- **`view.html` drive yardage** read `statYds`, which a lost fumble does
  not carry, so the gained yards vanished from the drive line. Falls back
  to `attemptYards`.
- **`stat_package.html` and `season_report.html` half splits** keyed on
  `playType === 'rush'/'pass'`, so a merged fumble's yardage dropped out of
  the half totals. **This was a regression introduced by the fumble fix**
  and found only by sweeping every surface afterwards.

`recap/stat_package/season_report/broadcast` each define a `RECEIVE_POS`
constant that is NEVER USED (one def, zero uses). They have drifted — those
four include `SB`, `engine.js` does not. Worth deleting.

## Picker — three separate bugs, all in the opponent's list

Symptom: recency sorting appeared dead for St. Thomas More and fine for
Neville. **Andy HAD seeded the starters** — that was never the problem, and
two wrong diagnoses were given before the real one.

1. **The ambiguous list was not gated on the starters list.** It walked
   EVERY shared number on the roster and narrowed only on position and on
   *named* seeds. A number nobody seeded and nobody had used was still
   offered, twice, with `?`. On an opponent roster uploaded offense-and-
   defense-separately that is most of the squad. Fixed with `if (!visible[num]) return;`
   after the has-played check. Unseeded games are unchanged, because
   `visible` falls back to the whole roster when no seeds exist.
2. **The two lists were glued, not merged.** `ambiguousList.concat(resolved)`
   put every shared-number player ahead of every resolved one, so recency
   only competed within a bucket. Now one list sorted once: identity ranking
   for shared numbers, number ranking for everyone else, concat order kept
   as the tiebreak so the pre-kickoff picker is unchanged. Only the man who
   actually played is promoted — `['80','83','80']`, not both #80s.
3. **The keypad dispatched only `input`, never `change`.** `attachNameConfirm`
   binds `blur` and `change`, so a jersey number entered on the pad set the
   number and never resolved the NAME. Not the cause of the sort problem,
   but it is why hand-entered players get a name at all, which shared-number
   attribution and box-score bucketing depend on. All picker writers now
   dispatch both, as a real keyboard does.

## Prototypes

1. **Shared keypad/keyboard buffer** backported to `gametest`/`gametest2`.
   Opening the pad then typing meant Done committed a stale buffer over the
   typed value. Clock affected too.
2. **`gametest3` uses `readonly` on touch devices**, not `inputmode="none"`,
   gated on `(hover: none) and (pointer: coarse)`. `?softkb=1` opts out on
   the device. NOTE: this makes the pad the ONLY entry route on iPad, which
   is what made bug 3 above unavoidable there.
3. **`touch-action:manipulation`** on the global `button` rule — 122 buttons
   per page had the double-tap-zoom defect, only three were covered.

## Corrections to the section above this one

- **"The offensive picker's ambiguous list is now gated on the starters
  list" is FALSE.** It was gated on named seeds only. This wrong claim cost
  several rounds of misdiagnosis. Now true as of this session.
- **"PICKER_MODE is the ONLY difference between gametest and gametest2" is
  FALSE.** gametest2 also has the strip's position mode and the
  `applyOutcome` extraction — 163 lines gametest lacks. gametest's strip is
  older AND unreachable. If the strip wins, promote gametest2/3's.
- `attachPickersLegacy` in gametest3 is dead code, never called.
- `tests/ui_driver.js`, `README.md`, `run_qa.js`, `convert.js` ARE uploaded;
  only `.gitignore` is missing. `sql/schema.sql` still absent.

## QC — `tests/accuracy_check.js` (new)

Invariants (one entry writes one play; log text and state agree on the down;
possession change starts a new series; every saved play has a playType) plus
a golden snapshot of 50 paths including the BOX SCORE, not just the roles
feeding it. Both watched to fail before being trusted.

**It did not catch any of the four bugs found after it was written.** See
PROJECT_NOTES, "The fixture is kinder than the field".

## Next

1. Full suite + NFL corpus. `run_scripted.js` and **`cross_surface.js`**
   have NOT run this session — the latter is the one built to catch exactly
   the multi-surface bugs that got through.
2. Probe case: a carrier with NO position on file, and a seeded team
   carrying UNSEEDED shared numbers. Neither is representable in the current
   fixtures.
3. Prototype decision (keypad vs strip) is still open and untouched.

---

# SESSION 2, CONTINUED — 18 August 2026

## New standing rule — read this first, every session

**Read the actual `engine.js` and HTML source for the area being touched
before proposing an approach or writing any code.** Not a memory of a
similar pattern elsewhere in the app — the real functions, the real
effect shapes, the real precedent already in the file. Recorded in full,
with the evidence, in `PROJECT_NOTES.md`'s opening section and in "Read
the file, not your memory of the file (18 August 2026)."

This was stated explicitly after three real bugs shipped in a single
draft, all from pattern-matching against an EARLIER fix in the same
session rather than reading the file being extended: a touchdown credited
to the wrong team, a state-machine assumption (`newPossession` resets
state like `flip` does) that is false and had already bitten the muffed-
punt branch once with a comment saying so, and a checkbox silently
unwired because the submit code that would have shown the gap was never
re-read. All three were caught before shipping, only because asked to
check rather than proceed.

## Punt fumble-during-return — feature complete, NOT YET TEST-COVERED

Built and verified this session, on top of the fumble-merge and picker
work already in HANDOFF:

- Return yardage is measured to where the ball was lost (fielded → fumble
  spot), independent of where it is recovered. Andy confirmed this
  explicitly: the recovery spot sets only the NEXT drive's starting spot.
- Receiving team recovers their own fumble: ordinary flip, same as any
  clean return, new-drive marker at the RECOVERY spot rather than the
  return-end spot.
- Kicking team recovers: NO flip (`flipEligible: false`), `newPossession:
  true` instead, mirroring the muffed-punt branch exactly. Charged as a
  turnover BY THE RECEIVING TEAM via `roles.recovery` — the same field and
  mechanism `countTurnovers` already uses for a muffed punt the kicking
  team recovers (dated 14 Aug 2026). No new turnover-counting code needed.
- A touchdown on either recovery path is credited to WHOEVER RECOVERED
  (`recTeam`, not hardcoded), and carries `effect.endsDrive: true`
  alongside the score — required specifically for the kicking-team-
  recovers case, since that path has no flip to null state otherwise.

**Andy is now implementing and testing punts thoroughly himself before
kickoff treatment is requested.** Do not build kickoff-return-fumble
handling until asked. When it is asked for, the punt design is not a
template to copy blind — re-read `computeState`'s kickoff-specific
branches (onside recovery, kickoff touchback) before assuming the same
flip/newPossession split applies unchanged; kickoff has its own guided
flow (`gr_*` fields, `guided.receivingTeam`) that punt does not, and that
difference has not been checked yet.

**Not covered by any test suite.** Every scenario above was verified by
hand this session — real UI drives, `computeState` and `countTurnovers`
checked before and after, golden re-confirmed unchanged (50/50, byte-
identical, since the feature is opt-in). None of it is a permanent
regression case. `coverage_probe.js`'s CASES list is the right home for
it: fielded either side of the 50, a fumble recovered by each team, a
fumble-recovery touchdown on each side, and a negative/backward return.
