# StatChat — project notes

Architectural decisions and the reasoning behind them. `TODO.md` tracks
what's left to do; this tracks *why things are the way they are*, so
that reasoning survives even if a chat is lost. Check this alongside
`TODO.md` at the start of any session touching the game engine, stat
computation, or reporting.

## Sack yardage methodology (verified August 3-4, 2026)

**Team-level totals subtract sack yardage from Pass Yards, not
Rushing.** This was verified directly against a real, independently
documented NFL game (Bills 34, Cardinals 28, Sept. 8 2024) via
nflverse play-by-play data cross-checked with ESPN/Fox Sports box
scores. The gap between a QB's personal passing statline and the
team's official Pass Yards total was exactly that game's sack yardage
lost, in both directions (Buffalo and Arizona).

**The asymmetry that matters:** an individual passer's own row in the
Passing table (`stat_package.html`, `recap.html`, season player
tables) stays unadjusted — it matches the player's personal statline
convention, same as a real box score's "18-23, 232 yds" line for a QB.
Only the *team-level* total (Total Yards, Pass Yards tiles, chart
totals, XLS Game Totals sheet) subtracts sack yardage. Don't "fix" the
individual player rows to match the team total — they're correct as
they are.

**Known, deliberate inconsistency:** the XLS export's "Stats" sheet
still has a separate "Sacks and Bad Snaps" row tracking sack yardage
as a negative *rushing* line. This matches the user's original
reference spreadsheet's own convention, not the verified NFL
methodology — it predates the verification and was intentionally left
as-is to match that reference file's row structure. It is not summed
into the "Game Totals" sheet's Total Yards column (which correctly
uses the verified, sack-adjusted number instead). If asked to reconcile
these, that's the tension to explain — don't assume it's a bug.

## The sack engine bug (found August 3-4, 2026)

`game.html`'s sack panel is labeled "Yards lost," and a coach
naturally types the positive magnitude of that loss. Nothing in the
pipeline negated it before feeding the engine's actual field-position
and down-tracking logic — so entering a real 7-yard sack moved the
ball *forward* 7 yards and computed "2nd & 3" instead of "2nd & 17."

This went undetected by the extensive earlier NFL fuzz-testing for a
more precise reason than "it bypassed the UI": that testing's only
pass/fail signal was the *combined final score* matching the real
game. Scoring in the converted play data is driven by an explicit TD
flag lifted straight from the source data (appended as a `td` suffix
on each play string) — never by the engine's own field-position
tracking reaching the goal line. A sign error in field-position math
therefore had no way to affect the one thing the test actually
checked; down/distance/field position could be silently wrong for an
entire game without moving the final score at all. (It's also true
that this specific path — a human typing into the sack panel's HTML
field — was never exercised, since the converter feeds `parseInput()`
pre-built strings directly. But that alone wasn't why the *score*
still matched; the score's independence from field-position math is
the more precise reason.) This is the reasoning behind the "re-run the
NFL games through the actual UI" item in `TODO.md`, and also why the
"internal consistency" audit item now includes a direct down/distance
logical check, not just a yardage-totals cross-check — a wrong-signed
value can produce internally *consistent* wrong totals that a simple
double-computation check won't catch, but a rule like "distance-to-go
never decreases after a loss-of-yardage play" catches it directly.

Fixed in `parseInput()`'s sack branch: the parsed "yards lost" value is
kept positive for the display text ("sacked for 7 yds"), but negated
before being used as `netYards` for game-state purposes. Verified
directly: sack now moves the ball backward and calculates down/distance
correctly; a normal rush play was regression-tested and still works.

## The combined-score check is too weak (found August 4, 2026)

While building the real-UI-driven NFL re-run (see `TODO.md`), found that
the audit's pass/fail signal for score correctness -- "does the
*combined* score (both teams summed) match the real game" -- can pass
even when each team's individual score is wrong, as long as the two
errors happen to cancel out in the sum.

**Concrete proof**: `2024_01_DEN_SEA`. Real score: Seattle 26, Denver
20. Running the game's converted play codes through `parseInput()`
directly -- the same method trusted for the "only 3 mismatches, all
explained by laterals" conclusion reported earlier this session --
gives Seattle 24, Denver 22. Neither number matches its real
counterpart. But 24+22=46, and 26+20=46, so the combined check says
"match" and moves on, hiding a real per-team attribution bug entirely.

**Implication**: the "only 3 mismatches" claim from earlier in this
session was based on this same weak check, run across all 285 games.
It should be treated as unverified, not confirmed, until re-run with a
check that compares each team's own score to its own real score. The
three lateral-explained mismatches found under the weak check are
still correctly explained -- laterals are a real, known, deliberate
gap -- but there is no way to know from the weak check alone whether
other games have a hidden per-team error the sum happened to cancel
out, the way `2024_01_DEN_SEA` did.

This also means the ~18 games still showing a *combined* mismatch
after the UI-driver fixes (punt returns, blocked FG/PAT, real Safety
panel) should be treated as provisional findings, not confirmed bugs,
until re-checked with the corrected per-team comparison. Some of them
may turn out to be pre-existing per-team attribution issues unrelated
to the UI driver at all, the same way `2024_01_DEN_SEA` turned out to
be wrong even under the trusted `parseInput()`-direct method.

## Systematic per-team score mismatch across the NFL test dataset (found August 4, 2026)

> **RESOLVED 13 August 2026 — there is no swap, and the engine was
> never wrong.** Read the section "The score swap that wasn't" near
> the end of this file before acting on anything below. The reading
> recorded here — that team attribution was systematically inverted —
> turned out to be a misdiagnosis of a HARNESS limitation. The
> analysis of *why the combined check masked it* still stands and is
> still worth reading; the conclusion about the cause does not.

After fixing the combined-score check to compare each team's own
score instead of just the sum (see above), re-ran all 285 games. The
result was far larger than expected: **241 of 285 games (84.6%) have
a per-team mismatch**, and 223 of those were "masked" -- the old
combined check said "match" while at least one team's actual score
was wrong.

**This is one systematic pattern, not 241 separate bugs.** Confirmed
directly on `2024_01_ARI_BUF`, a game whose scores were already
independently verified earlier tonight (BUF 34, ARI 28, cross-checked
against ESPN/Fox Sports). The engine's own final scores: teamA=28,
teamB=34 -- exactly swapped, not off by an arbitrary amount. teamA is
supposed to be the home team (BUF) here; it ended up with the away
team's score instead.

**Root cause, not yet confirmed to be a real app bug or a test
limitation**: a play code like `"18r 15"` carries a jersey number and
a yardage, but never which team that player is on. Team attribution
for each play depends entirely on which team the engine currently
believes is on offense -- inferred purely from prior plays' effects
(turnovers, punts ending drives, scores, downs exhausted), never told
explicitly. The NFL converter never inserts an explicit possession
marker between plays. In the real app this is fine: a coach always
knows who's actually on offense and picks that team's own players from
the roster grid, supplying the ground truth the engine doesn't need to
infer. In this automated replay, there is no coach -- if even one
possession-change event isn't correctly signaled by the play sequence,
every subsequent play's team attribution silently inherits the drift,
persisting for the rest of the game without any way to self-correct.

**Open question, next thing to resolve**: is this a genuine bug in the
engine's possession-inference logic (something a real coach's live use
would also eventually hit), or is it purely an artifact of testing this
way -- the play codes genuinely don't carry enough information for an
unsupervised replay to stay correctly attributed, and doing this
properly would require the converter to also emit accurate
possession/drive-start markers matching the real game's actual drives
(nflverse's play-by-play data does have drive/possession columns this
could be built from). Until that's resolved, don't treat the earlier
"3 mismatches, all lateral-explained" or "18 games still mismatched"
findings from this session as settled -- they were investigated under
a check that couldn't see this class of error at all.

**What still holds despite this finding**: the down/distance logic
check (loss must increase distance-to-go, gain must decrease it) and
the yardage cross-check (box-score sum vs. raw play-log sum) are both
unaffected by which team a play gets attributed to -- they're
structural properties of the state transition and internal-consistency
comparisons within whatever attribution actually happened, not
comparisons against the real world's team labels. Their "zero
violations" / "zero mismatches" results stand independent of this
finding.

## Possession-relative labeling (the "own"/"opp" convention) -- a recurring source of real confusion this session, worth understanding fully

Field position throughout this app (`fieldPos`, 0-100) is always
relative to whoever currently has the ball -- NOT a fixed Neville
perspective. `markerLabel()` reads this directly: `fp <= 50` means
"still on my own half" (labeled "own"), `fp > 50` means "past midfield,
into the opponent's half" (labeled "opp"). Critically, "own"/"opp" here
means "the current offense's own/opponent's territory" -- when
possession flips, the SAME fieldPos value's own/opp label flips
meaning too, even though the number didn't change.

This is correct and by design, but it created two real, separate bugs
this session because several UI widgets that feed a value into this
system used ambiguous "Our side"/"Their side" labels instead of stating
which team explicitly:

1. **`startingSpotFieldsHtml()`** (used by kickoff/punt/interception/
   fumble return-spot fields, and overtime setup) -- "Our side" read
   naturally as "Neville's side" (since Neville is "our" team
   everywhere else in the app), but the widget actually needed "our"
   to mean "whichever team's drive is being set up" (which is often
   the OTHER team, e.g. TEST OPP receiving a kickoff). Fixed by making
   the buttons show the actual team name, computed from whichever team
   the drive-start applies to.
2. **The "New drive / correct down" utility** had its own, completely
   separate, hardcoded copy of the same "Our side"/"Their side" labels
   -- missed entirely by the first fix since it doesn't call
   `startingSpotFieldsHtml()` at all. This utility never changes
   possession itself (no `forcePossession` in its effect) -- it only
   corrects down/distance/fieldPos for whoever currently has the ball,
   so its labels are relative to `computeState().possession` at the
   time it's opened.

**The general lesson for any future widget that lets a coach specify a
field-position/starting-spot value**: always show the actual team
name the label refers to, and always be explicit about *whose*
perspective "own"/"opp" is from at that specific widget -- never reuse
"our"/"their" as if there's one fixed perspective throughout the app.
Search for `startingSpotFieldsHtml` and for any other hardcoded
"Our side"/"Their side" or "own"/"their" pairs before assuming a fix
in one place covers every place this pattern appears.

## Drive-boundary and possession-change detection -- the `isReset`-only assumption was wrong (found August 4-5, 2026)

Several pieces of logic needed to know "when did the current drive
start" or "how many possessions has each team had." All of them
originally looked *only* for an explicit `effect.isReset` flag on a
play. That flag is set by two things: an explicit "New drive" marker
(from the return-spot fields, or the "New drive / correct down"
utility), or a kickoff/punt/etc. that includes one.

**The gap**: a turnover on downs changes possession via
`effect.turnoverOnDowns` + `effect.flipApplied` -- it never sets
`isReset` at all, and there's no separate "New drive" marker required
or auto-generated afterward. The very next scrimmage play's own
down/distance fallback logic (`state.down || 1`, `state.distance ||
10`) papers over this silently for stat-tracking purposes, which is
exactly why this went unnoticed for a long time: normal play entry
"looks fine" even though nothing ever marked where the new drive
began.

This broke two independent things the same way:
- **"Current drive"/"Previous drive" segmentation** (`game.html`,
  `view.html`) -- with no boundary to split on, "current drive" would
  silently span both teams' plays across the turnover.
- **`countPossessions`** (all four report/view files) -- a team that
  gained the ball via a turnover on downs and ran real plays would
  still show 0 possessions, since nothing ever incremented the count.

**The fix, `findDriveStarts()`**: instead of only checking `isReset`,
walk the play list computing `computeState()` on progressively longer
slices and detect any actual possession change directly, whether or
not it came with an explicit marker. One subtlety that took a couple
of iterations to get right: an explicit `isReset` marker play IS
itself the first play of the new drive (a dedicated announcement --
include it, same as before). But a *detected*, unmarked possession
change (like a turnover on downs) means the play that caused the
change still belongs to the *previous* possessor's drive -- the new
drive starts at the next play index, not that one. Getting this
backwards produces a boundary that's off by one play in the wrong
direction.

**If a future feature needs to know "who's possession is this" or
"where did this drive start" from the play list**, use this same
possession-change-detection approach, not a bare `isReset` check --
the fix currently lives duplicated in `game.html` and `view.html` (for
drive segmentation) and in all four report/view files (for
`countPossessions`), consistent with the rest of the engine being
duplicated rather than shared (see below). Consolidating the engine
into one file would also consolidate this fix into one place.

## Penalties never adjusted distance-to-go (found August 4-5, 2026)

`computeState`'s penalty handling adjusted `fieldPos` by the penalty's
`fieldDelta` but never touched `distance` at all -- so "4th & 7" plus
a 10-yard penalty on the offense stayed "4th & 7" instead of becoming
"4th & 17", and the next play would get evaluated against the wrong,
stale distance-to-go (a 12-yard gain incorrectly converting a down
that a real 4th-and-17 should not have converted).

Fixed by adjusting `distance` by the same `fieldDelta`, in the opposite
direction of possession's progress (subtracting it, so a penalty on
offense -- negative `fieldDelta` -- increases distance, and a penalty
on defense -- positive `fieldDelta` -- decreases it). While fixing
this, also implemented the actual football rule this naturally enables
and that was previously entirely unhandled: if penalty yardage alone
reaches or exceeds the remaining distance, it's an automatic first
down regardless of what down it was. `game.html`'s penalty-text
generation (a separate, save-time-only concern, not shared with the
other files) now also always states the resulting down & distance in
the log line itself (e.g. "Penalty on Neville -- 5 yds -- 4th & 11"),
mirroring this same math, so a reader never has to compute it by hand
from the yardage alone.

This bug and the drive-boundary bug above share a lesson worth naming
explicitly: `computeState`'s per-play-type branches each need to fully
update *every* piece of state a play can affect (down, distance,
fieldPos, possession) -- a branch that only updates some of them can
look correct in isolation while leaving stale state that a later,
unrelated play then reads and gets wrong.

## `roles.defense` is overloaded between real defensive credit and special-teams return credit (found August 4-5, 2026)

`roles.defense` is set in ten different places in `game.html` -- some
are genuine defensive credit (interception, sack, fumble recovery),
and some are a kickoff/punt returner's "Returned by" credit, which is
a special-teams role, not a defensive one. `computeBoxScore` (in all
four report/view files) was treating any `roles.defense`-tagged player
as deserving a defensive-stat bucket entry regardless of play type,
so a returner with zero actual interceptions/sacks/fumble-recoveries
still got an empty bucket entry created -- which was enough for
`view.html`'s "does this team have any defensive stats to show" check
to render an empty "Defense" tile.

Fixed at the single, central point where the bucket actually gets
created: only do so when the play type is actually `int`, `sack`, or
`fumble`. Deliberately not touched: the ten places that set
`roles.defense` itself, since a returner legitimately needs to be
tagged with *some* role for name-resolution purposes elsewhere, and
retagging all ten call sites with a new, separate field (e.g.
`roles.returner`) would have been a much larger, higher-risk change for
the same result. If a future feature needs to distinguish "actually
credited on defense" from "credited as a special-teams returner" for
some other purpose, remember this overload exists rather than assuming
`roles.defense` always means defense.

## Name resolution: one shared `rosterName()` across all three units (fixed August 5, 2026)

`game.html` generates each play's log text **once, at save time**, and
stores that finished string. Every other page -- `view.html`,
`recap.html`, `stat_package.html`, `season_report.html` -- displays the
stored string verbatim and never re-resolves it. Two consequences worth
keeping in mind:

1. **Only `game.html`'s name resolution affects log text.** If a name
   renders wrong in the log, look in `game.html`, not in the page you
   happen to be looking at. This bit once already: the four display
   pages had a cross-roster fallback that `game.html` lacked, so the
   *better* versions were the ones that never ran.
2. **Fixing the code does not fix history.** Plays already saved keep
   their original text forever. Any future name-resolution change needs
   a deliberate decision about backfilling existing rows.

All five files now share one helper:

```js
rosterName(teamKey, num, order)   // order e.g. ['defense','special','offense']
```

It searches all three roster units with the play's expected unit first,
so `nameInOffense` / `nameInDefense` / `nameInSpecialTeams` differ only
in search order. The safety property that makes this a low-risk change:
**a fallback can only ever turn "#25" into a name -- it can never change
a name that already resolved**, because the expected unit is always
searched first. Behaviour is therefore monotonic; no previously-correct
output moves.

The bug that prompted it: kick and punt returners are credited via
`roles.defense` (the overload documented above) and resolved with
`D(ret)`, which read `rosterDefense` only -- a roster a dedicated KR/PR
is never on. So the `roles.defense` overload costs a *name* in the log,
not just the phantom "Defense" stat tile. Worth remembering that this
overload has now caused two distinct, unrelated-looking defects.

Note the picker side of this is deliberately **not** fixed:
`defenseEligible()` still lists only already-discovered defenders, so
the "Returned by" grid is empty on the first kickoff of a game and the
coach must type the number. That path now resolves names correctly, so
it is cosmetic. It was left alone because `defBlock()` is shared with
the sack, interception and fumble-recovery credit pickers, and widening
`defenseEligible()` would clutter all of them with kickers and punters.
A dedicated returner picker is the right fix when it is worth doing.

## Every display page just renders the stored string -- there is no formatting layer (established August 6, 2026)

Worth stating plainly because it looks wrong the first time you see it:
`view.html`, `recap.html`, `stat_package.html` and `season_report.html`
do not reformat, re-derive, or reinterpret a play's text in any way.
Whatever string `game.html` wrote into `plays.text` at save time is
exactly what shows up everywhere, forever.

This means a "display bug" reported on any of those four pages is almost
never a bug in that page. It's a bug in whatever `game.html` code path
generated the stored string. The colon-less-clock bug is the second time
this exact misdirection has happened (the first was the returner-name
bug) -- both looked like display issues and both were actually
generation issues, entirely inside `game.html`, that happened to only
become visible on the other pages. The tell, in both cases:
`game.html`'s own on-screen log showed the same problem once looked at
directly, instead of a page-specific glitch.

The corollary that matters more the second time: **fixing the parsing
function is not the same as fixing every place that calls it.**
`clockToAbsSeconds()` was fixed (Aug 4) to accept colon-less clock entry
correctly. That fix was necessary but not sufficient -- it validates and
converts, it doesn't format for storage. Seven separate lines of code
took the coach's raw typed string and interpolated it directly into
`text: 'Clock - ' + clockVal + ...`, in two different UI flows (the main
confirm card, and a second, easy-to-miss `showClockPrompt` card). A grep
for the literal pattern is what found all seven; fixing the ones noticed
first and moving on would have left some live.

Input is deliberately permissive (colon optional, because it's faster to
type mid-game); display is deliberately strict (always `M:SS`).
`normalizeClockStr()` is what bridges the two, and it must be applied at
every point where a clock value becomes stored text.

## Administrative markers are not plays (established August 6, 2026)

The play log is a single flat list, but not everything in it is a
football play. Clock lines, quarter/half dividers, "New drive"
announcements and manual possession flips all live in `plays` alongside
real snaps. They carry no `roles` and no yardage.

Anything that reasons about "what happened on this drive" therefore has
to filter them out, and forgetting to do so fails in a characteristic
way: a marker becomes a one-play drive whose every counter is zero.
`isAdminMarker(p)` in the engine core is the single definition — clock
events, `setQuarter`, `forcePossession`, and dividers are
administrative; `isReset` is deliberately NOT, because a "New drive"
line is an explicit, legitimate drive start.

Two consequences worth remembering, both of which bit at once:

1. **Only the last two drives are ever displayed.** A phantom drive
   doesn't just render badly, it *evicts* a real drive from the visible
   window. The reported symptom was an empty "Previous Drive"; the
   actual damage was that a completed scoring drive vanished from the
   page entirely. When a panel looks empty, check whether something
   upstream silently consumed the slot.
2. **Time of possession is a boundary check in disguise.** TOP is
   derived from the clock events bracketing a drive, so it reads 0:00
   whenever the drive split is wrong. A TOP of 0:00 on a drive that
   obviously took time is a symptom of bad boundaries, not of a clock
   bug.

Note also that `flipBtn` is followed by a clock prompt rather than a
"New drive" marker, so the manual-flip path produces a different play
shape than a kickoff or punt does. It had the same bug and nothing else
would have caught it — worth exercising explicitly whenever drive
detection changes.

## Stored text is a snapshot; state is recomputed. They must be built at the same moment (August 6, 2026)

Every play carries two things: a `text` string frozen at save time, and
an `effect` that gets replayed by `computeState` forever after. The
whole log depends on those two describing the *same* situation.

They can come apart, and when they do nothing surfaces it. The confirm
card is built when Review is pressed but nothing is written until Save,
so a state change in between -- Undo is the easy one -- left the text
describing a down & distance that no longer existed while the effect
applied to the new state. The stored log then contained an impossible
jump (2nd & 10 straight to 4th & 11), and the third-down attempt hidden
inside that jump stopped being counted. It surfaced only when a coach
questioned a season stat days later.

The fix is to re-parse at Save rather than reuse the Review-time result.
`parseInput` is deterministic given `(code, state)`, so re-parsing costs
nothing when nothing changed. **Any future "review then commit" flow
needs the same treatment** -- building the artifact early and writing it
late is the bug, not Undo specifically.

A useful diagnostic that fell out of this: walk the log and compare each
line's stated down & distance against `computeState` replayed to that
point. Any disagreement is a corrupted play, and the down sequence
around it will show a jump no single play could produce. That check
found the bug in a real game log in seconds after manual counting had
gone nowhere.

## When the scorer is not the possessor (August 6, 2026)

Clock and drive attribution repeatedly assumed the team that scored is
the team that had the ball. That holds for a touchdown or a field goal
and fails for a **safety**, where the defense scores. Keying the
end-of-possession clock off `effect.score.team` credited a team that
never had possession, left the real possessor's clock running, and stuck
its time of possession at 0:00.

The rule: the possession that just ended always belongs to
`preState.possession`. Reach for the pre-play state, not the scoreboard,
whenever the question is "whose possession was this".

Related, and worth remembering as a category: `roles.defense` was also
being used as the only signal that a fumble was LOST rather than
recovered by the offense. That is an inference, not a fact, and it broke
the moment naming the recoverer became optional. Lost fumbles now carry
an explicit `roles.lost`. **When a field is doing double duty as an
implicit flag, making that field optional silently changes behaviour
somewhere else.**

## Possessions and drives are the same thing (August 6, 2026)

`countPossessions` used to reimplement drive-boundary detection instead
of deriving from `findDriveStarts`. The two drifted, and the copy in
`countPossessions` counted both the detected possession change AND the
explicit "New drive" marker that follows it -- so an ordinary kickoff ->
clock line -> new drive credited the receiving team twice. A brand-new
game where each side had had the ball once read 2 possessions apiece.

It now derives from `findDriveStarts`, which required hoisting that
function to the top level of all five files. Possessions and drives now
agree by construction rather than by keeping two implementations in
step, and a test asserts that the possession total equals the drive
count.

A reset marker also no longer opens a drive by itself; it only opens the
game's FIRST one. Every later drive begins at a real possession change,
which is detected independently. That is what makes "Adjust
Down/Distance" free to use mid-drive -- correcting the chains twice in a
row used to register two possessions.

## A failed write is not a failed play (August 6, 2026)

`persistPlay` used to report a sync failure and move on. That is the
worst possible handling, because everything on the entering screen keeps
working: the play is in `plays`, so every later play's down and distance
computes correctly *in that tab*. Nothing looks wrong until someone
reloads, opens the spectator view, or reads a report — by which point
the log has a gap and the down sequence around it is unreconstructable.

Two things make this class of bug nasty. The failure is silent to the
one person who could fix it immediately, and the damage is invisible
where it happens and only visible somewhere else, later.

The queue is built around ordering. Plays must reach the server in
sequence order, so: draining stops at the first failure rather than
skipping ahead, and once anything is queued, later plays queue behind it
instead of going straight through. A queue that "catches up" out of
order would interleave plays and produce exactly the corruption it
exists to prevent.

Two details that are easy to get wrong:

- **`TypeError: Failed to fetch` is thrown, not returned.** The Supabase
  client returns `{ error }` for server-side errors but throws on a
  network failure. Code that only checks the returned `error` will
  propagate the throw. Every insert path needs try/catch as well.
- **A duplicate key on retry means success.** An insert can land while
  the response is lost, so a blind retry sees a unique-constraint
  violation. Treating that as a failure would wedge the queue forever on
  a row that is already saved.

## `updatePhaseUI` is an allow-list, not a default (August 6, 2026)

Controls are only disabled between phases if they are named explicitly
in `updatePhaseUI`. Anything not listed stays live in every phase --
before kickoff, at halftime, during a guided flow, and after the game is
finalized.

That is how Flip possession stayed clickable on a completed game for as
long as it existed, and the Timeout button inherited the same gap the
day it was added. Both write straight to the log, so using them on a
final game appends plays after the final score.

**Any new control that writes a play needs a line in `updatePhaseUI`.**
Undo and Redo are the deliberate exceptions: a coach has to be able to
correct a mistake at halftime or after the whistle.

## Testing must go through the real DOM (established August 5, 2026)

`tests/` now drives the actual pages: real button clicks, real `<input>`
typing, real `input` events. Nothing calls `parseInput()` or
`buildAndReview()` directly.

The reason is specific, not stylistic. The sack-yardage bug lived in the
HTML input path, and the earlier fuzz-testing fed `parseInput()`
pre-built strings, so it could never have found it. A test that bypasses
the UI is testing a different program than the one a coach uses.

Two rules that follow, both learned the hard way:

- **If a path cannot be reached by clicking and typing, do not fake it.**
  An earlier harness simulated a bare safety by writing to the hidden
  `#code` field. A coach has no way to do that, so the test verified
  nothing. `ui_driver.js` throws `UnreachableByUI` instead.
- **Write expectations from the rules of football, not from current
  output.** Copying what the app prints today produces a test that
  certifies today's bugs.

And the meta-rule, from the combined-score failure: **a passing test is
worthless until you have watched it fail.** `mutation_check.js` exists
to re-introduce known bugs and confirm the suite goes red. Run it after
adding any assertion; a surviving mutant is a blind spot in the tests,
not a curiosity.

Note also that `game.html` uses two *different* checkbox patterns: most
toggles are a hidden `<input type=checkbox>` plus a styled button
(`#pp_td` + `#pp_td_toggle`), but the 2-point "returned all the way" box
is a plain visible checkbox with no toggle button. Clicking a checkbox
toggles it, so setting `.checked = true` and then clicking silently
turns it back off -- which is exactly what made the defensive 2-point
return appear to score zero during this session's testing.

## `view.html`'s fixed-1920x1080-plus-transform-scale architecture

The entire live-view page is built at a fixed 1920x1080 reference
size (`.wrap { width:1920px; height:1080px; }`), then a JS function
(`applyDisplayScale`, tied to `window.resize`) scales the whole thing
with a CSS `transform` to fit whatever the real screen is. This keeps
every internal size (fonts, padding, gaps) as fixed px values that
stay proportional to each other automatically, without needing to
rewrite the whole stylesheet in relative units.

The scale factor used to be `Math.min(scaleX, scaleY)` -- one uniform
number preserving the fixed 16:9 aspect ratio, which necessarily
leaves the leftover space empty on whichever axis doesn't match the
real screen's actual ratio (confirmed concretely on a real 2496x1664
screen: 260px of wasted vertical space). Changed to independent
`scale(scaleX, scaleY)`, stretching non-uniformly to exactly fill any
screen on any aspect ratio. The trade-off is a very slight, usually
imperceptible distortion on screens far from 16:9 -- acceptable here
specifically because almost everything on this page is text, tables,
and tiles, not shapes or images where aspect ratio would visibly
matter.

Separately, there's a second, independent scaling mechanism just for
the stat-category tiles within the bottom two quadrants (`--stat-scale`
CSS custom property, computed in `renderBoxScore()`), which grows or
shrinks tile font-size/padding based on *vertical* fit only (available
quadrant height vs. actual rendered content height) so a team with
modest stats doesn't render tiny and leave empty space, and a team
with a lot of stats doesn't overflow. This mechanism does not consider
horizontal fit at all -- it was not touched or extended during the
scaleX/scaleY fix above, since the primary fix (making the whole
canvas correctly fill the real screen) addresses the bulk of any
wasted-space problem on its own. If a similar "text too small/too
large for the available space" issue is reported specifically within
the stats tiles after confirming the canvas-level fix is deployed,
this second, separate mechanism is where to look next.

## `game.html`'s Pass panel now also reaches Sack and Interception

Sack and Interception used to be their own top-level "Scrimmage"
buttons. They're now reached from two buttons ("Sacked"/"Intercepted")
at the top of the Pass panel instead, since both are really outcomes
of a pass attempt. Deliberately implemented as the lowest-risk option
available: clicking either button simply calls `renderPlayPanel('sack')`
/ `renderPlayPanel('int')` directly -- the exact same, unmodified panels
and save logic as before, just reached from a different entry point.
No merging, no rebuilding of the sack/interception HTML or logic
happened. If Sack or Interception need a change in the future, they're
still just `renderPlayPanel('sack')`/`renderPlayPanel('int')`,
unaffected by how a coach gets there.

## Why the engine WAS duplicated across pages (resolved 12-13 August 2026)

`view.html`, `recap.html`, `stat_package.html`, and `season_report.html`
each carry their own copy of `computeState`, `computeBoxScore`,
`buildTeams`, etc., copied verbatim from `game.html`. This was a
deliberate choice earlier in the project — "port the proven engine
verbatim, don't rewrite it" — to avoid introducing subtle differences
between pages. The trade-off is real: a fix has to be manually,
correctly repeated in every copy, which is how both the sack-yardage
inconsistency and an earlier `RECEIVE_POS` omission bug happened.
**This is now done.** All six pages load a single `engine.js`; the
per-page copies are gone and `tests/engine_parity.js`, which existed
only to detect drift between them, is a passing tombstone.

The clean-up was not finished by the consolidation itself. Three
helpers survived it as duplicates because they were small enough to
look harmless -- `luminance` and `safeTextColor` in `game.html`
(which SHADOWED the engine's, since the inline script loads after
it), and `markerLabel` as three byte-identical copies in `game.html`,
`view.html` and `broadcast.html`. Both were found only when something
needed changing and the change had to be made in three places. The
lesson is that consolidation is not complete when the big functions
move; it is complete when a `grep` for `^function` finds each name
once.

## Season report chart/metric layout

Metrics that summarize what a chart shows are placed directly above
that chart, not in one long flat list at the top of a section
(`stat_package.html`'s team-stats tiles and `season_report.html`'s
season-level tiles both follow this). Where a section has multiple
charts side by side, the HTML emits all the metric-groups as flat
sibling grid items first, then all the charts as flat sibling grid
items after — *not* nested per-column — so CSS Grid's row
auto-placement naturally equalizes each row's height across columns.
Nesting metrics+chart together per column was tried first and broke
alignment whenever one column's metrics wrapped to more rows than
its neighbor's.

Chart colors are derived from the team's actual branded primary/
secondary colors (account settings), not a fixed palette. Text sitting
inside a colored fill (donut slices, stacked-bar segments) picks black
or white dynamically based on that specific fill color's luminance —
never assume brand colors are dark enough for white text by default;
Neville's own brand color is a light gold, which is exactly the case
that assumption gets wrong.

## NFHS is not NFL, and the difference is load-bearing (established August 7, 2026)

The app was quietly using NFL statistical conventions. High-school football
is NFHS, which follows NCAA on the points below. Each of these changes
where a number lands, not merely how it is worded:

- **Sack yardage is charged to RUSHING, not deducted from passing.** Team
  passing is the sum of completions; the sack yards go into a `TEAM`
  rushing bucket. The quarterback's individual passing line is untouched
  under either convention -- only the team total moves.
- **A QB kneel is a TEAM rush.** The individual is charged with no attempt
  and no yardage, which is why college quarterbacks do not accumulate
  ugly rushing lines from victory formation.
- **A bad snap is likewise a TEAM rush**, for the same reason: nobody
  carried it, and pinning it on the quarterback or the centre misstates
  both.
- **The defense cannot score on a try.** NFHS ends the try the instant the
  defense gains possession. NCAA and the NFL allow a two-point return;
  those controls were removed from the blocked-PAT and both 2PT paths.
- **A missed field goal that reaches the end zone is a touchback**, so the
  20 is the right DEFAULT spot -- but a short miss is dead where it lies,
  so it stays editable.

The `TEAM` bucket now carries kneels, bad snaps and sack yardage. It is a
stat bucket, never a player: it must be excluded from every picker, which
was missed once and put "#TEAM TEAM" in the ball-carrier list.

---

## Stored phase versus derived phase -- three bugs from one cause (August 7, 2026)

`gamePhase` lives on the game row rather than being derived from the play
log, so it can disagree with the plays. That disagreement produced three
separate failures in one session:

1. Undoing back across the interval left the phase at `secondHalf` with no
   second-half plays -- the banner still read Q3 and the guided kickoff
   never returned.
2. Undoing past the half divider itself left the phase at `halftime` with
   no divider present: no End 1st half button, no Start 2nd half, every
   control disabled. Reset game was the only way out.
3. `guided_state` is stored the same way, so a second-half kickoff that
   was started and then undone stayed "active" -- and an active guided
   flow disables everything.

All three now self-heal from the log on every render: **no half divider
means the first half is still on.** The underlying design is still stored
state, so a fourth variant is plausible. Deriving phase outright is in
TODO.

---

## A filled-in form can still return null (August 7, 2026)

Three different causes, all of which left a takeover spot silently unset
while the panel looked correctly filled in:

- **No spot field at all** on the rush / pass / sack fumble paths. Only the
  dedicated Fumble play type had one, and the toggle on a rush is how a
  fumble usually gets entered.
- **A radio that defaults checked but wires on `change`.** "Recovered by
  opponent" is pre-selected, so opening the fumble fields never ran the
  handler that installs the spot getter.
- **A re-render discarding listeners.** Switching the pass panel to
  "Sacked" rebuilds it, throwing away the click handlers
  `wireStartingSpot` had attached, so the side button recorded nothing.

The general shape: several panels rely on a change handler to wire
something up while defaulting to the state that handler would produce.
Any of them can have this gap. `tests/takeover_spot_check.js` now drives
all 11 change-of-possession flows and asserts the SAVED RESULT, because
presence of the fields was never the problem.

**Debugging note.** Three attempts were spent guessing at how the spot was
produced before a one-line probe showed the getter returning null with the
form visibly complete. Probe the value, not the plumbing.

---

## The yardage calculator, and why crossing midfield is free (August 7, 2026)

Rush, pass and punt panels accept either a yardage or the spot the play
ended on. Because `fieldPos` is possession-relative, the gain is simply
`newFieldPos - currentFieldPos` -- own 20 to opp 20 is `80 - 20 = 60`, with
no special case for midfield. What it does need is the SIDE, since "the 20"
names two places; the current side is pre-selected so a short gain stays
one number.

The interaction rules matter as much as the sum:

- a negative result drives LOSS automatically -- letting both be set
  double-negates, the same trap as typing `-5` and tapping LOSS
- typing yards directly clears the calculator, so the two inputs can never
  describe one play differently
- a touchdown fills the box with `100 - fieldPos` and locks it; there is
  exactly one possible gain
- a fumble relabels it ("ball came loose on"), a punt muff likewise
- a punt touchback or block voids it and says why, rather than leaving a
  stale sum beside a hidden calculator

Layout: the yardage question and the calculator own one row; the outcome
toggles sit on a second. They shared a row originally and wrapped
unpredictably once the calculator arrived. The working is rendered INSIDE
the calculator column so it starts at the dividing rule whatever width the
yards box happens to be -- several attempts to match that with a fixed
indent were guessing at a measurement the browser already knows.

---

## Inline styles beat classes (August 7, 2026)

Repeatedly: a control sets `background` in a `style` attribute, then code
toggles a `.picked` class that can never override it. The LOSS button, the
Incomplete toggle and the 2PT sub-type switcher all looked unselected
while being selected. The 2PT case was worse -- it toggled `primary` while
the markup also set `secondary`, same specificity, so the later rule won.

**Rule: the unselected look belongs in a CSS class (`ptoggle`), never in an
inline style, so `.picked` can win.**

---

## Box-score buckets are keyed by NAME, not jersey number (August 7, 2026)

`computeBoxScore` keys every player bucket by the display name, not the
number. This was a deliberate refactor after two players shared #5 and
their lines merged.

**Numbers are not identity.** Keying on the number meant Powell's carries
and Reddick's carries landed in one bucket, displayed under whichever
roster row loaded last. The log text was right -- it is generated at
entry -- so the two disagreed on screen, which is how it was noticed.

An intermediate fix used a composite `5<US>Powell` key. It worked, but
composite keys are contagious: `playerName` had to unpack them, and so
would anything else iterating buckets. Resolving to the name once, in
`keyFor`, means **a bucket key IS its label** and nothing downstream
resolves anything.

It also matches how `season_report.html` has always aggregated across
games (by `playerName`), so a player's season line merges for free
instead of needing a second scheme.

Consequences worth knowing:

- A play records `roles.<role>.name` when the picker resolved an
  ambiguous number. That name wins over the roster.
- Otherwise the roster answers, falling back to `#21` for a player
  entered by hand who was never rostered.
- Renaming a player mid-season splits their line. Two players with the
  same NAME would merge. Both are rarer and less damaging than the
  number collision this replaced.
- Plays entered before this change carry no name, so they key by whatever
  the roster says today.
- Tests that assert stats must look up by name. Three had to be updated
  (`cross_surface`, `optional_players_check`, `receiver_targets_check`)
  -- if a stat assertion fails with the right numbers under an
  unexpected key, that is why.

---

## Tests verify what exists; they cannot report what is missing (August 10, 2026)

Andy asked why 48 NFL games and a full-game UI walkthrough had never
surfaced that fake punts and fake field goals were unmodelled. The
answer bounds what the whole test suite can tell you, so it is worth
keeping.

- **The NFL harness dispatches on `play_type`.** nflverse labels a fake
  by its ACTUAL play type -- a fake punt arrives as `"run"` -- so the
  converter entered them as ordinary rushes, StatChat handled them
  perfectly, and every tier passed. "Punt formation" exists only in the
  description text, which the harness never reads.
- **The full-game walkthrough contains what was written down.** No fake
  was written, so none was tested.
- **`coverage_probe` sounds like it should catch this** -- it reports
  47/47 paths -- but that list was enumerated from the app's own panels.
  It is a mirror of the implementation, not a specification, and it
  would keep reporting 47/47 with half the rulebook missing.

**There is no oracle for "features that should exist."** Closing that
gap needs a checklist from outside the code: the NFHS rulebook, a real
stat sheet, or someone who knows football looking at the app and asking
where something is. That is exactly how this gap was found.

---

## Whitelist the expected UI, do not blacklist the unwanted (August 10, 2026)

The fake punt / fake field goal panels produced FOUR round trips in a
row. Each report named one stray control -- the yardage calculator, then
the takeover spot, then a duplicate Touchdown button, then Good/Missed --
and each fix hid exactly the one named.

That is a **blacklist**: a list of ids to hide. Anything not on the list
stays visible, and the list only grows when a human notices. It cannot
converge, because nothing in the code knows what the complete set is.

**The fix was to invert the assertion.** `fake_kick_check.js` now
enumerates every live control on the panel and compares it against a
list of what is ALLOWED. Anything else fails by name. Writing that test
immediately found a fifth stray -- the kick distance field, hidden from
me because it was disabled rather than removed, which still reads as
something you were meant to fill in.

Mutation-tested: adding a new kick control without hiding it fails with
`these are still live on a fake and should not be: pp_newkickthing_toggle`.

**But a whitelist has a blind spot, and it bit immediately.** A FIFTH
report followed: "Returned by (optional)" still sat at the foot of every
fake punt, and the new test had passed. The returner controls are
`pp_credit_*`, and when writing the ALLOWED list I had annotated those as
"who made the tackle" -- a reasonable-sounding guess that was wrong for
that panel.

So: **a whitelist catches controls nobody thought about; it cannot catch
one that was thought about and filed under the wrong heading.** When
writing such a list, verify what each id actually IS on that specific
panel rather than inferring from its name. `pp_credit_*` is the tackler
on a rush panel and the returner on a punt panel.

**Generalise this.** Any "hide the irrelevant controls" behaviour should
be tested as a whitelist. The same shape applies to the guided flows,
correction mode, and the phase gating after a score -- all of them
currently hide by enumeration, and all of them can drift the same way.
The test does not just catch the bug; it turns "did I get them all?"
from a memory exercise into a failing assertion that names the answer.

---

## Realtime DELETE events carry only the primary key (August 12, 2026)

Reported from real use: undoing a play on the game page did not update
the view page until the next play was entered.

**Diagnosed from the browser, not guessed.** A raw subscription printed:

    EVENT: DELETE {id: 'ff81c957-...'} {}

The event arrives. `payload.old` contains ONLY the id — no `game_id` —
even though `plays` has `REPLICA IDENTITY FULL` and is in the
`supabase_realtime` publication. Both were verified in SQL.

**Why:** Supabase Realtime strips non-key columns from DELETE events when
RLS is enabled on the table. It cannot evaluate a row-level policy
against a row that no longer exists, so it sends the primary key and
nothing else. Replica identity does not override this — the restriction
is in Realtime, not in Postgres.

So `if (payload.old.game_id === currentGameId)` could NEVER have been
true. Undos have never propagated. It stayed invisible because the next
entered play triggered a reload that hid the gap.

**Fixed two ways, deliberately:**

1. The delete handler no longer checks `game_id` — it reloads on any
   delete to `plays`. One wasted reload if another game is edited, which
   in practice never happens.
2. **A reconciliation poll on the view page**, every 4 seconds: compare
   the server's play count with what is on screen and reload on a
   mismatch. This is the pattern `broadcast.html` already used, and the
   reason that page never had the problem.

**The general lesson.** Realtime failures are INVISIBLE — the page looks
fine and is simply wrong, which on a broadcast is worse than an obvious
error. Anything that depends on every event arriving needs a backstop
that does not. Treat realtime as an optimisation for responsiveness, not
as the source of truth.

Also observed: one undo emits THREE delete events — the play plus its
clock and marker rows.

---

## GameID

There's no dedicated GameID column in the database — it's parsed out
of `game.designator` via regex (`/(\d+)/`) wherever the XLS exports
need a numeric GameID. If a game's designator doesn't contain a
number, GameID falls back to the designator string itself.

---

## The score swap that wasn't (resolved August 13, 2026)

The finding recorded earlier in this file -- a systematic home/away
score swap across most of the NFL replay dataset -- was **wrong**. Not
partly wrong: there is no swap, and `teamA` tracked the home team
correctly in every game re-checked.

What is actually happening is that `tests/nfl/convert.js` DROPS POINTS,
and it always drops them from the team that did not have the ball --
which is exactly what an aggregate comparison reads as a swap. Two
causes:

1. **Touchdowns scored by the defence are never converted.**
   `scoredIt()` requires `td_team === posteam`, so a fumble return,
   interception return or punt return score is not emitted at all.
   Six points, to the team without possession.
2. **Successful two-point conversions are entered as ordinary plays.**
   They arrive as `play_type` run/pass with
   `two_point_conv_result = success`, so the converter enters a rush and
   the two points vanish.

The evidence that settles it is not that the theory explains the
games -- the swap theory "explained" them too. It is that a model
deducting 6 per non-offensive touchdown and 2 per conversion PREDICTED
six of six games to the point, including one game (`2023_01_CAR_ATL`)
with no such plays that reproduced the real score exactly as a control.

**The transferable lesson is about the shape of the original mistake.**
The audit compared a number the app produced against a number from the
real world, and when they disagreed it blamed the app. The third
possibility -- that the harness feeding the app was lossy -- was never
enumerated, and it was the right one. A comparison against an
independent source is only as trustworthy as the pipeline in between,
and that pipeline deserves the same suspicion as the code under test.

A secondary lesson: `run_qa.js` had no score assertion at all, which is
why the finding lived in a separate uncommitted script and then
outlived the sandbox it was written in. It has one now (Tier 1.5).

## A test can pass against the bug it exists to prevent (August 13, 2026)

`tests/tackles_check.js` asserted that a sack produces a tackle for
loss. The assertion was correct, the suite was green, and the app had
never credited a TFL on any sack in its life.

The fixture hand-wrote a seven-yard sack as `passer.yards: -7`. The app
writes `7` -- a positive loss magnitude. So the suite asserted the right
thing about data the app does not produce. Reverting the engine fix
still leaves it green; that was verified, not assumed.

**This is the same failure as the August 3rd sack-yardage bug**, which
also lived in the input path and also survived testing that fed the
engine pre-built values. The rule in `tests/README.md` -- nothing may
construct a play by hand -- existed *because* of that bug, and this
suite quietly broke it by building play rows as object literals instead
of calling `parseInput`. The rule was read as "don't call the parser"
when it means "don't invent data the app would never produce."

The suite now drives `game.html`'s real panels and reads back what was
persisted, and it pins the sign convention explicitly rather than
depending on it accidentally. Mutation-tested against five
re-introduced bugs, all caught.

## Sign conventions are load-bearing, and each one needs exactly one owner (August 13, 2026)

Three separate bugs this session were one shape: a number whose sign
meant different things to different readers.

**Sack yardage** is stored as a POSITIVE magnitude -- a seven-yard sack
is `passer.yards = 7`. Six writers and readers agree on that: the panel,
the play code, the team-rushing charge (which SUBTRACTS it), and the
sack-yards tiles on four report pages. One reader disagreed -- the TFL
check read it as signed, concluded a sack gained seven yards, and
credited nothing. The fix was not to flip the sign. It was to stop
deriving the loss from role yardage at all and read `effect.statYds`,
which is signed by definition and is already what the team TFL counts
from. **When two conventions exist, prefer the field that cannot be
misread over the field that happens to be right.**

**The sack panel's yards box** is the one place the yardage calculator
runs with no LOSS toggle beside it, because "Yards lost" is always a
loss. That means the sign cannot be SHOWN, so a spot entered ahead of
the current one would have silently recorded a loss of that many yards
from an entry that plainly meant a gain. It is refused instead. The
guard keys off play type, not off the absence of the LOSS button --
punt and field goal also lack one, and a "gain" there is a kick
distance.

**Penalty yardage** was signed the wrong way first, and the correction
is the useful part. Signing it against the penalised team ("always
negative") is defensible in isolation and wrong in context: the log line
sits next to the resulting down and distance, so `-25 yards — 1st & 10`
claimed a loss on a play that gained twenty-five and moved the chains.
The sign now comes from `fieldDelta` -- which way the BALL moved -- so
the two figures on the line share a frame of reference. **A number's
sign is not decided by what it is about; it is decided by what it will
be read next to.**

## Nobody owns the 50 (August 13, 2026)

`markerLabel` rendered midfield as "own 50", because the branch was
`fp <= 50`. It is `fp < 50` now, and 50 returns "the 50".

Small, but it is the possession-relative convention leaking: the whole
point of own/opp is to say whose half the ball is in, and the 50 is in
neither. Claiming it for the offence contradicts the convention at the
one yard line everybody can name on sight.

Fixing it required editing three files, because `markerLabel` existed as
three byte-identical copies. That is the real cost of leftover
duplication -- not that the copies disagree, but that a one-character
fix becomes a three-file change with two chances to forget one.

## Required entry beats a silently discarded one (August 13, 2026)

`wireStartingSpot`'s getter returns `null` if EITHER the side or the
yard line is missing, and every caller wrote `if (reset)`. A
half-filled spot was therefore discarded without a word: the kick saved,
no drive marker was written, and the ball had no position.

The failure surfaced several taps later, as a refusal to enter a play
from scrimmage, with a message about the spot not being set that pointed
nowhere near the kickoff that caused it. **A missing input that produces
a delayed, relocated error is worse than one that produces no error at
all, because it sends you to the wrong place.**

Kickoffs and punts now refuse at Review and name which half is missing.
Touchbacks pass automatically (the spot is prefilled), a return for a
touchdown is exempt (there is no ensuing spot), and the check reads
whichever spot block is VISIBLE, so onside and muff recoveries validate
their own field rather than a hidden one.

Four test suites went red on this change, and two of them reported the
wrong cause -- `optional_players_check` said "the returner was not
optional" and `clock_display_check` said "the confirm card did not ask
for a clock". Both were the missing spot. Worth remembering the next
time a fixture fails for a reason that makes no sense: a new required
field upstream will impersonate almost any downstream failure.

## Grey it out; do not let it refuse (August 13, 2026)

The quarter-marker picker was first fixed by opening it and explaining
that no quarter could be marked. That is worse than it sounds. **A
control that is available and then refuses costs a tap to discover and
reads as the app being broken**; one that is plainly unavailable
communicates the same thing for free. The button is disabled now, with
the explanation in its `title`, so it is still not a dead end.

The button and the picker read the SAME whitelist, so they cannot drift
into disagreeing about what is legal. The picker keeps its refusal as an
unreachable backstop rather than trusting the disable to be perfect.

One implementation trap worth recording: the whitelist was originally a
`const` declared near the picker, which is far below `updatePhaseUI` in
the file. `updatePhaseUI` runs on first render, hit the const in its
temporal dead zone, and would have thrown on a cold page load while
working fine in every warm test. Function declarations hoist; the tables
are functions now.

## Defaults should be scoped as narrowly as the thing they predict (August 13, 2026)

Pre-selecting the last kicker is the same feature as pre-selecting the
last quarterback, but the scoping question is different. One shared
"kicker" memory across kickoffs, field goals and PATs would be wrong on
every team that uses a kickoff specialist -- and **a wrong default is
worse than none, because it looks deliberate and gets confirmed with a
tap.**

Split three ways: kickoff, FG+PAT together, punt. FG and PAT share
because that genuinely is the same player answering the same question,
which is the same reasoning that puts Pass, Sack, Interception and
2PT-pass on one passer memory. The asymmetry is deliberate: splitting
costs one extra selection the first time each kind of kick comes up,
while sharing costs a wrong name on a real play.

All of them are marked `suggested`, never `picked`. A committed pick
would turn the coach's confirming tap into a de-select.

## Confirm anything that closes a phase (August 13, 2026)

"End game" had a confirmation; "End 1st half" did not, despite sitting
in the same row as "Quarter marker", writing two rows, and changing what
the rest of the app allows. It has one now, with the score in the
prompt -- a missed PAT noticed at that moment is a ten-second fix, and
noticed after the interval it is an unlock and a re-entry.

## A failed read is not an empty game (August 13, 2026)

`reloadPlaysFromServer()` destructured only `data` and ignored `error`:

```js
const { data: existingPlays } = await supabaseClient.from('plays').select(...)
plays = (existingPlays || []).map(...)
```

Offline that returns `data: null` with an error set, `(null || [])`
becomes `[]`, and **the entire in-memory play log is replaced with
nothing.** Down, distance, field position and the score all recompute
from an empty log. Every drive tile empties. Plays cannot be undone
because they are no longer in the array to pop.

The trigger is ordinary: the `visibilitychange` handler calls this on
every alt-tab, so losing the connection and switching windows makes the
game look erased mid-drive. Found by running the connection-loss test
on the production plan, which is exactly what that test is for.

Nothing was ever lost -- the rows are on the server and a reload once
online brings them back -- but there is no way to know that while
watching the board go blank.

**`|| []` on a value that can fail is a fallback that silences an
error.** It reads as defensive and is the opposite: the empty array is
indistinguishable from a real empty game, so the failure is laundered
into a plausible-looking state. `init()` twelve lines below handles
`gameError` properly; the plays read was the one place it was dropped.

## An action that cannot be applied must not be offered (August 13, 2026)

Undo removes a play locally and then deletes the row. Offline the delete
fails, nothing retries it, and the row is still on the server -- so the
next successful reload brings the undone play BACK. A silent reversion
twenty minutes later with nothing connecting it to the undo.

The first instinct was a warning in the offline banner. That is weaker
than it sounds: **a warning leaves the button working**, and under
pressure it gets pressed. Documenting a trap is not the same as removing
it.

Blanket "no undo while offline" is too strong the other way, because
half of undo is perfectly safe: a play entered DURING the outage never
reached the server, and dropping it from the device queue is the whole
job. That is also the undo a scorer actually needs mid-drive.

So it is refused precisely -- only for rows the server already has.

**The gating flag has to be positive knowledge, not an inference.** The
first version asked "is it in the pending queue?", which is a race: for
the moment between pressing Save and the insert failing, a play is in
neither the queue nor the server, and undo refused the very play just
typed. It now keys on `_onServer`, set when an insert succeeds, when a
queued row drains, and on rows loaded at page load. **Known-landed, not
not-known-local.** The negative form has a window; the positive form
does not.

## A jersey number is not a person (August 13, 2026)

The whole shared-number family of bugs is one confusion: the number was
doing two jobs, an INPUT TOKEN (what you type, what is on the shirt) and
an IDENTITY KEY (which human gets the stat). Identical until two players
share a number, and then every place that conflates them is a bug.

Both ends were already right. The roster ingest keeps both players in
`ambiguousOffense/Defense/SpecialTeams` with their own positions, and
`keyFor()` in the box score prefers a name over a number lookup. **What
was missing was the middle: nothing ever put a name on the play**, so
`keyFor` always fell through to the roster map -- which holds one name
per number and keeps whichever row loaded last.

Four fixes, all making the resolved name the identity once known:

- `playerCandidates()` consults the ambiguous maps, so two players
  sharing a number INSIDE ONE UNIT are offered. Before, the second was
  unreachable by typing -- the confirm box showed one name as settled.
- `attachNameConfirm()` reports the choice through an `onResolve`
  callback, on the chosen alternate AND on an accepted default. Before,
  the choice lived only in a temporary roster override that is
  deliberately reverted for the next play, which is why the picker then
  offered the OTHER player.
- The name is stored on the play at all 16 role-building sites.
- Picker recency and yardage labels key on `num + name`.

The symptom that proves it: before, picking the non-default player gave
a correct log line and a box score crediting the other man **after any
reload**. Live it looked right, because the temporary override was still
in memory. Any test asserting on the live page would have passed.

## The three overrides, and a branch that had none of them (August 13, 2026)

`offenseEligible()` decides who gets a button. The RESOLVED list has
three ways in, in order of strength:

1. **Has actually filled this role this game** -- a tight end who has
   carried is a ball carrier, whatever the roster says.
2. **Seeded as a likely starter** -- an explicit statement by the coach.
3. **Recorded position** matches the role.

Ambiguous numbers are excluded from that list on the first line
(`if (ambiguous[num]) return false`) so a shared number is not offered
both as two "?" entries and as one bare button. They come back through
`ambiguousList` -- which checked only position, and so had **none of the
other two overrides**. Two live consequences:

- Seeding QB to a shared number did nothing, and with no positions
  recorded the passer picker came up **EMPTY**. Opponent rosters typed
  from a programme have no positions, so this is the ordinary case.
- A shared-number back could throw a halfback pass, have it recorded
  perfectly, and still not appear in the passer picker next snap. The
  number had to be typed every time.

Both now honour all three. The has-played check is keyed by IDENTITY, so
throwing promotes the man who threw, not both players wearing his shirt
-- a distinction only possible because the play now carries a name.

**Ordering rule, decided deliberately:** recency wins outright once
anyone has actually filled the role; the starters list only breaks ties
before the first touch. A seed is a guess made in August; a carry is a
fact.

## Exclusive groups, not pairwise rules (August 13, 2026)

The kickoff outcome toggles (Touchback / Muffed / Onside) each cleared
the others BY NAME, so the rules lived in three handlers and adding a
fourth meant editing all of them. Adding "Out of bounds" replaced them
with one `KO_OUTCOMES` array; a fifth outcome is now one entry.

It also fixed a live bug. Clearing another toggle set its hidden
checkbox to false and fired `change`, but **nothing repainted the
button** -- the paint lives in the click handler. Picking Onside after
Touchback left "✓ Touchback" lit in gold beside "✓ Onside kick": two
outcomes apparently selected, one of them a lie, with the saved play
silently following the checkbox.

Worth noting how it was found: not by looking for it, but by reading the
existing exclusivity code closely enough to add a fourth case. The bug
had been visible on screen the whole time.

## A mock that ignores an operation cannot test it (August 13, 2026)

`tests/harness.js` had `delete() { this._op = 'delete'; return this; }`
and `then()` never acted on it. `db.plays` was insert-only, so **no test
could verify that a row was ever removed.** Undo "passed" by never being
checked: the page dropped the play from its in-memory array, the mock
reported success, and whether the delete reached the server was
unobservable.

The sibling lesson is already in `tests/README.md` -- "a mock that always
succeeds cannot test a queue", which is why `db.failNext` exists. This is
the same shape one level down: a mock that silently accepts a call it
does not implement reports success for work it never did.

Deletes are now performed against both `db.plays` and `db.existingPlays`
(a delete that misses the latter looks fine until a reload brings the row
back) and recorded in `db.deleted`, so a test can assert WHAT went, not
merely that the table shrank.

## A number that cannot be cross-checked is a number nobody trusts (14 August 2026)

The receiver on a completed pass is optional, deliberately: a deep ball is
exactly the play where a scorer does not catch the number, and refusing
to save it would be worse than not knowing who caught it.

But leaving the yardage out of the receiving table entirely broke the
check a stat sheet lives by -- **passing yards should equal the sum of
receiving yards**. A coach reading Passing 245 against Receiving 198 has
no way to tell a missing entry from a bug in the app.

Andy's call, and the better one: bucket it to **Unknown** rather than
footnote the gap. Two consequences worth keeping:

- **It is derived in `computeBoxScore`, not written onto the play.** No
  invented player reaches the database, and every game already entered
  reconciled the moment it shipped. Nothing to migrate.
- **Unknown is NOT the TEAM bucket.** TEAM in rushing means "credited to
  nobody BY RULE" -- a sack, a kneel, a bad snap. Unknown means "this
  happened to a player we did not record". Conflating them would hide a
  data-entry gap behind a rule. They share a sort treatment (both last,
  neither can be a "leader") and nothing else.

Targets and receptions were bucketed the same way, or attempts would
still have disagreed with targets.

**The test that had to change is the interesting part.**
`receiver_targets_check` asserted an unnamed pass created NO receiving
row. That was right about the danger and wrong about the remedy: the
danger is a REAL PLAYER credited with a catch nobody saw him make. The
assertion now reads "an unnamed pass goes to Unknown OR NOWHERE, never
to a real player", which is the original intent stated precisely.

**And the first mutation test of it survived.** The fixture had an
unnamed incompletion but no unnamed COMPLETION, so removing the whole
bucket still reconciled and the new assertions proved nothing. A
reconciliation check only means something when the fixture contains the
thing that would break it.

## Put the cross-check where the eye already is (14 August 2026)

The category totals now sit beside the Passing / Rushing / Receiving
headers on the view page, and time of possession under the timeouts.
Neither is new information -- both were already computable -- and that is
the point: the value is in having two numbers that must agree visible at
the same time, computed by different paths.

Two rules came out of placing them:

**Sum the whole bucket, never the rows on screen.** Those tables show the
top five plus anyone with a touchdown. A total added from the visible
rows would quietly disagree with the tile it exists to check -- and would
look exactly like the bug it was put there to catch.

**Absent beats zero for a derived figure.** Time of possession is built
entirely from optional clock entries, so a game with none would show a
confident 0:00. That says "they never had the ball"; the truth is
"nobody recorded it". It is omitted instead, and the season average is
over the games that actually recorded a clock and says how many.

## A control that vanishes when you use it (14 August 2026)

The Sacked and Intercepted switches on the pass panel called
`renderPlayPanel('sack')`, which rebuilt the panel WITHOUT the switch
row. So the buttons disappeared on the way to the thing they selected: no
tick, no gold, and no way back to Pass except closing the panel and
starting again.

Fixed by giving all three panels the same row, from one helper, with the
current one ticked -- and by adding a third button, "Completed /
incomplete", so Pass is a destination rather than somewhere you can only
leave.

Worth noticing how it hid: every OTHER toggle in the app stays put and
lights up, so the inconsistency was invisible to anyone who had not just
used a different panel. A convention is only as good as its exceptions.

---

# 14–15 August 2026

## Overtime is not football with the clock off (15 August 2026)

The app treated overtime as ordinary play in a fifth quarter. Almost
everything that went wrong followed from that one assumption.

Overtime is played in **series**. When one ends, the other team starts a
fresh one from the same spot. Before this, the second team simply
inherited the ball wherever the first team's drive died -- on their own 3
in the first test -- and no new drive began at all.

**The series is the unit, not the possession.** `otSeriesTeam` is tracked
separately from `state.possession`, because they disagree constantly: an
interception hands the ball over WITHOUT ending the series, and a score
leaves it with the team that just scored. Whose series it is has to be
recorded at the START and carried, not inferred from who holds the ball
when it ends.

Three things were got wrong on the way, each worth keeping:

- **A series ends in two shapes.** The ball changes hands, OR the series
  scores. The first attempt keyed on `down === null`, which only catches
  the second -- after a turnover on downs the app hands the other team a
  fresh 1st & 10, so `down` is 1 and the trigger never fired once.
- **`forcePossession` is not a series marker.** "Manual flip possession"
  writes the same effect, so a correction mid-series advanced the round.
  The guided marker now carries an explicit `otSeriesStart` flag and the
  counter reads only that. **An effect that two different actions write
  cannot be used to tell them apart.**
- **A guided self-heal cancelled the panel.** Any flow tagged
  `targetPhase: 'secondHalf'` is torn down when no half divider exists --
  right for a second-half kickoff, fatal for overtime. It left the
  correct words on screen with the flow already dead behind them. Both
  overtime flows now use their own target phase. This was a LATENT bug in
  the existing Start-overtime button, not something the new work
  introduced.

**And the panel had no way out.** It opens automatically and disables the
rest of the page, so after the deciding series the only way forward was
to set up a series nobody was going to play. `finalizeGame()` was
extracted from the End game button's handler -- rather than copied -- and
the panel now offers it once one side is ahead.

## Measure the thing you actually mean (14 August 2026)

`safeTextColor` compared two LUMINANCE values and kept a team's colour if
they differed by 0.35. Grey on a navy banner differs by 0.41, so it
shipped, and it was unreadable. The threshold was not the problem; the
measure was. `luminance()` is Rec.601 luma -- right for "is this light or
dark", wrong for contrast.

It now uses WCAG contrast ratio: channels linearised, contrast as a RATIO
from 1:1 to 21:1, floor at 4.5. Team colours are still used whenever they
can be read; this only rescues pairs that cannot be.

**The test had the same bug.** `color_check` asserted a luminance gap of
0.3 -- mirroring the implementation's own rule rather than the
requirement. Both were wrong in the same direction, so the suite stayed
green while grey text shipped. *A fixture that repeats the
implementation's rule cannot catch the rule being wrong.*

## A correct fix with nothing to work on (14 August 2026)

A muffed punt recovered by the kicking team is a turnover and nothing
counted it. `countTurnovers` was fixed, shipped, and still did not work
in a real game -- because the recovery role was only written when a
RECOVERER'S NUMBER had been typed. Leaving that blank, which the panel
invites, threw away the TEAM the coach had chosen on a radio button.

The log line read "recovered by Neville" while the saved data said
nothing at all.

Same shape as the returner and tackler fixes before it: **an optional
field left blank must not discard the information given alongside it.**
The number is optional; the team is not. My test named the recoverer, so
it passed. Andy did not, so it did not.

## A mutation test caught a comment lying (14 August 2026)

Time of possession now stops at the end of regulation. The first version
also cleared the pending clock starts when overtime began, with a comment
explaining why that mattered -- and the mutant that removed the clearing
SURVIVED. Nothing could tell the difference: the guard already skips the
whole block, and the quarter never decreases within a replay.

The code was dead and the comment described work it was not doing. Both
removed. Worth remembering as the failure mode where the suite passes and
the file still misleads the next reader.

## Print is a different medium (15 August 2026)

Two PDF problems, and the second was the instructive one.

**A section split across pages** was fixed with `break-after: avoid` on
headings and `break-inside: avoid` on tables -- in CSS rather than by
wrapping eight call sites whose shapes differ. But Special Teams is not
one table: it is a heading and SEVERAL, and the group still split between
its own subsections. Kickoffs on one page, Punting alone on the next
under no heading. That one needed a real wrapper.

**`break-inside: avoid` is a hope about space; `break-after: avoid` is a
rule about a boundary.** Removing the forced page break did not put the
team block back on page one -- every section avoids breaking internally,
so the browser was free to decide it did not fit and move the whole thing
over. Only forbidding a break at that specific boundary fixed it.

## Naming things after what they hold (15 August 2026)

Every leader card read "#Parker Robinson". `playerName()` looks a jersey
NUMBER up on the roster and falls back to `'#' + num` -- correct on its
own terms. It was being handed a BOX SCORE KEY, and since the
shared-number work those keys are display names, not numbers.

The fallback did exactly what it says; the caller was wrong about what it
was passing. Checked the other pages afterwards: they pass `r.kicker.num`
straight off the play roles, which is right.

## Standing conventions added this session

- A control that vanishes when you use it is worse than one that refuses
- Sum the whole bucket, never the rows on screen
- Absent beats zero for a derived figure
- An effect two different actions write cannot distinguish them
- A test that repeats the implementation's rule cannot catch it being wrong


## A policy is not a column grant (15 August 2026)

Public recap sharing needed both, and only one of them is obvious.

**RLS is ROW-level.** A policy saying "anon may read this game" hands over
the entire row -- `created_by`, `broadcast_set_by`, `guided_state`,
`seed_starters`, every column the table has and every column it gains
later. Restricting what `recap.html` asks for would not have helped:
anyone can query the columns directly with the anon key, which is in the
page source by design.

So the policy is paired with a Postgres column grant: anon has SELECT on
fourteen named columns of `games` and nothing else. `authenticated` is
untouched, so the app's own pages keep using `select('*')`.

The consequence to remember: **`recap.html` must ask for those fourteen
by name.** `select('*')` now fails outright for a signed-out visitor,
and the two lists have to be kept in step -- which is why the grant and
the query each carry a comment pointing at the other.

**The condition is `status = 'final' AND is_public = true`, never
is_public alone.** Unlocking a shared game for corrections moves it out
of final, and the public read stops matching until it is finalized again.
Keying on the flag by itself would have made a LIVE game public the
moment somebody unlocked one that had been shared.

## The scraper has already gone (15 August 2026)

A shared link previewed as "Game Recap / statchat.co" and the obvious fix
-- set `document.title` from the game -- does nothing at all. iMessage,
Slack and the rest build that card with a scraper that does not run
JavaScript: it fetches the file, reads the `<head>`, and leaves before
any Supabase call has been made.

Static Open Graph tags fix the branding. Naming the GAME needs the HTML
built on the server, which is now a TODO rather than a guess.

Worth noting how the attempt failed: setting `document.title` earlier in
`init()` broke seven suites, because `TEAMS` is not populated yet at that
point. The page already set a per-game tab title further down -- so the
line was redundant as well as misplaced, and the tests found both.


## An instance is not a tenant (15 August 2026)

Andy wants another organisation beta testing alongside Neville. The
obvious reading is multi-tenancy — an `org_id` on every table, RLS scoped
by it — and it is the wrong answer for this.

Two organisations in one database are one policy mistake apart. Two
organisations in two databases cannot reach each other at all, whatever
anybody writes. For a beta with one partner, isolation is worth more than
the convenience of a single instance, and the cost is a second Supabase
project.

**What makes a deployment clonable is not the database, it is the
configuration.** The Supabase url and publishable key are currently
hardcoded in fourteen HTML files, which means a second deployment is a
FORK — fourteen edits, a divergent copy, and every future fix applied
twice. Extract them to one file and it becomes a CLONE: identical code,
different environment variables.

The other thing missing is the schema. `sql/` holds one migration; the
tables, policies and roles live in the hosted dashboard and nowhere else.
That is worth fixing regardless of cloning — a schema that exists in
exactly one place, and that place is somebody else's web app, is a
backup with extra steps.


## The schema is committed, every time (15 August 2026)

Standing rule, recorded in `sql/README.md` and repeated here because it is
the kind of thing that decays quietly:

**Every database change is committed before the session ends** — a
numbered migration in `sql/`, and a re-dumped `sql/schema.sql`. That
includes RLS policies, grants, roles and indexes, not just tables. Those
are the ones that get clicked in a dashboard and forgotten.

The step that earns the procedure is **diffing the dump afterwards**.
`git diff sql/schema.sql` should show exactly what the migration claimed
and nothing else. It catches two things nothing else will: a change made
by hand in the table editor weeks ago, and a migration that did more than
it said.

A migration is never edited once it has run. If it was wrong, write
another. An edited migration is a file that says one thing and did
another, and any instance that ran the old version is now silently
different — survivable with one deployment, not with three.
