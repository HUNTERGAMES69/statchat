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

## Why the engine is duplicated across pages, not shared yet

`view.html`, `recap.html`, `stat_package.html`, and `season_report.html`
each carry their own copy of `computeState`, `computeBoxScore`,
`buildTeams`, etc., copied verbatim from `game.html`. This was a
deliberate choice earlier in the project — "port the proven engine
verbatim, don't rewrite it" — to avoid introducing subtle differences
between pages. The trade-off is real: a fix has to be manually,
correctly repeated in every copy, which is how both the sack-yardage
inconsistency and an earlier `RECEIVE_POS` omission bug happened.
Consolidating into one shared JS file is on `TODO.md`, not done yet.

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

## GameID

There's no dedicated GameID column in the database — it's parsed out
of `game.designator` via regex (`/(\d+)/`) wherever the XLS exports
need a numeric GameID. If a game's designator doesn't contain a
number, GameID falls back to the designator string itself.
