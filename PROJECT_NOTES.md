# StatChat — project notes

Architectural decisions and the reasoning behind them. `TODO.md` tracks
what's left to do; this tracks *why things are the way they are*, so
that reasoning survives even if a chat is lost. Check this alongside
`TODO.md` at the start of any session touching the game engine, stat
computation, or reporting.

## STANDING RULE — read the existing code before proposing or writing anything

Before recommending an approach or writing a line of code, read the
actual `engine.js` and HTML source for the area being touched — the
real functions, the real effect shapes, the real precedent already
in the file — not a plan built from memory of a similar-looking pattern
elsewhere in the app. This applies to every change, however small it
looks going in.

This is not a style preference. On 17-18 August 2026 this exact
shortcut produced concrete, real bugs, caught only because the rule
was then enforced retroactively:

- A punt-return-fumble touchdown credited to the wrong team, because
  the score-crediting line was copied from the ordinary-return branch
  above it without checking whether that team assignment still held.
- The same play would have frozen the down/distance display on the
  punting team's old down, because `effect.newPossession` was assumed
  to reset state the way `effect.flip` does. It does not — read
  directly, `newPossession` is consumed only by drive-boundary
  detection; only `effect.endsDrive` (or a flip) nulls state in
  `computeState`. The muffed-punt branch had already hit this exact
  bug once, fixed it, and left a dated comment explaining why — a
  comment that would have prevented the repeat entirely if read first.
- A submit-side `td` checkbox was silently unwired on a new branch —
  built, referenced, never actually appended to the token string — an
  omission a first read of the surrounding submit code would have
  caught immediately.

Reading first is cheap. Reasoning from memory about how a similar
piece of the app "probably" works is the direct cause of every one of
the above, and of several earlier failures the same night: a deleted
tap-handler, a stale two-gate picker fix, a `view.html` guess standing
in for a fact the engine had started recording. See the dated entries
below for the fuller accounts. The rule exists because the pattern
repeated enough times in one session to be worth stating explicitly
rather than leaving as an implied best practice.

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

## The picker's ambiguous list is gated on the starters list (17 August 2026)

`offenseEligible()` builds two lists: resolved players, and the extra
candidates a shared jersey number creates. The resolved list has always
been gated on `visible` — seeded starters plus whoever has been
discovered during the game. The ambiguous list was not.

So it walked **every shared number on the roster** and admitted anyone
whose recorded position fitted the role. On a St. Thomas More roster with
92 players across 69 numbers, six seeded starters produced 28 buttons in
the ball-carrier picker, and none of the extras were players anybody had
named.

Position tells you *whether* a player could fill the role. `visible`
tells you whether anybody *expects* him to. Both are needed, and the
comment above the branch said as much about position while stopping one
step short.

Two overrides still outrank the seed, deliberately: a player who has
already filled the role in this game, and a seed that names him
specifically rather than by number. Both are stronger statements than
"not on the starters list", so they are tested first.

## Shared numbers are reported at import, split three ways (17 August 2026)

The roster importer validated each row on its own — number present, name
present, position recognised — and never compared rows. A roster with 22
shared numbers imported silently as "92 players loaded".

It now says so, and the split is what makes it worth reading:

- **A likely duplicate person** (`#81 Charles Tatman / Charlie Tatman`)
  is one player entered twice. The answer is to delete a row.
- **A same-side collision** (two receivers on `#89`) cannot be separated
  by any rule. The pickers will ask, and naming the player in the likely
  starters settles it for the game.
- **A cross-side collision** (a running back and a safety on `#21`) needs
  nothing at all. The position filter keeps them apart.

Twenty of the twenty-two on that roster were the third kind. Reporting
"22 shared numbers" would have been true and useless; the number that
matters is the six that need a decision.

## Touchbacks recorded on their own play (17 August 2026)

The guided start-of-game flow writes the kick before anybody knows where
the ball came down, so the outcome arrives as a separate play. The kickoff
carried the kicker and no touchback; the outcome carried the touchback and
no kicker. Neither play had both, so the stat package showed one kickoff
at 0%.

The outcome play now carries `kickoffTouchback: { team, num }`, read back
off the kickoff just written rather than threaded through the guided
state — the play *is* the record, and a second copy of the kicker in a
state object is a second thing that can disagree. The engine counts it as
a touchback only; the kickoff was already counted on the play that
recorded the kick.

`computeBoxScore` also infers a touchback from a `kickoff_return` play
whose text says TOUCHBACK. That is a compatibility path for games already
in the database, which cannot grow a role they were never saved with.
Reading play text is not a habit to form — the role is the mechanism, and
new plays use it — but the alternative was telling a scorer to re-enter
the opening kickoff of every affected game.

## A number nobody reads is a number nobody checks (17 August 2026)

The rush/pass/sack fumble split wrote two plays for one snap for two weeks.
Thirty-one suites, a property-based fuzzer and 93 NFL games ran over it
every time.

The instinct is to call that a coverage gap. It was not. `ui_driver.js`
drives all three fumble toggles and `coverage_probe.js` walked every one of
those paths on every run. The broken path was exercised constantly.

It survived because **the probe reports and nothing asserted**. Searching
the suite for `d3att`, `d4att` or `oppDowns` returns nothing: the
down-conversion table is computed, printed in the stat package, and checked
by no test. `full_game_check.js` computes a play count and `console.log`s
it. The bug was printed on every run, in output no assertion read.

**Exercising a path is not testing it.** A test that drives code and prints
the result is a demo; the assertion is the test. Coverage counts measure the
wrong thing — this bug sat inside covered code.

**And it produced plausible numbers.** Nothing crashed, nothing was NaN, no
known invariant broke. A phantom failed third down looks exactly like a real
one. Wrongness that looks like data can only be caught by checking a number
against something independent — the 14 Aug principle applied to the down
table, where it never had been.

`tests/accuracy_check.js` answers both in two layers. Invariants are
absolute and catch a number wrong the day it was written. The golden
snapshot is relative and catches a number that moves without anybody meaning
it to. Neither subsumes the other: a golden generated against a bug defends
that bug forever, which is exactly why the invariants sit beside it. It
freezes the box score, not only the roles feeding it — otherwise the sack
sign error made while writing the fix would have passed, since the roles
looked right and only the printed number was wrong.

## The fixture is kinder than the field (17 August 2026)

Four bugs got past `accuracy_check.js` on the day it was written. Every one
had the same cause: the test fixtures cannot express the conditions the app
actually meets.

- **`view.html` guessed rush-vs-pass from roster position.** The harness
  receiver has a proper `WR`, so the guess and the fact agreed and the
  golden ran green. A real opponent roster has players with no position.
- **The keypad dispatched only `input`.** `ui_driver.js` dispatches `input`
  AND `change`, as a real keyboard does. The driver emulated a keyboard
  faithfully; the pad emulated half of one, so no test could see it.
- **The picker's ambiguous list ignored the starters gate.** No fixture had
  a seeded team that also carried unseeded shared numbers.
- **Half-yardage splits in two report pages** dropped merged-fumble yardage.
  `accuracy_check` boots `game.html` and never opens a report page.

The pattern is not bad luck. A fixture is written by the same person, on the
same day, with the same picture in their head as the code — so it encodes
the assumptions the code makes rather than the mess the field supplies. The
cases that break things are the ones nobody thought to represent: a player
with no position, a roster uploaded twice, a number two brothers share, an
input method that fires half the events.

Practical consequences, in order of value:

1. **Fixtures should be built from real exports, not invented.** The
   opponent roster in `picker_behaviour_check.js` is the good example — it
   is deliberately awkward, and its comments say why each row is awkward.
   Everything else should look like that.
2. **Emulate the interface, not the intent.** `ui_driver` should fire what
   the real control fires. Where it fires more, it hides bugs.
3. **A check that only boots one page can only defend one page.** Three of
   the four above lived on surfaces `accuracy_check` never loads.

## Ask the play, do not guess from the roster (17 August 2026)

A fumble used to carry no record of what play it ended, so two places
inferred rush-vs-pass from the carrier's listed position. That is a guess
standing in for a fact that was simply not recorded.

Once the merged fumble play carried `roles.attempt`, the fact existed and
both guesses became wrong answers waiting to happen — a running back's
catch-and-fumble booked as a rush, a receiver with no position on file
booked as a rush. Both now read `attempt` and keep the position guess only
as a fallback for plays saved before the field existed.

The general form: when a heuristic exists because information was missing,
adding that information does not retire the heuristic. Someone has to go
back and remove it, and the place to look is wherever the old comment
explains why the guess was necessary.

## Two lists glued are not one list sorted (17 August 2026)

The offensive picker returned `ambiguousList.concat(resolved)`. Each half
was correctly ordered by recency; the whole was not. Every shared-number
player outranked every resolved one, so the man who caught a pass on the
previous snap sat below two players who had not touched the ball.

Nobody chose that rule. It fell out of building the list in two passes, and
it survived because both halves were individually right and the tests only
ever asserted within a half.

Merging needs care, because the halves measure recency differently for a
good reason: a shared number must be attributed by IDENTITY or one catch
promotes both men wearing the jersey. Both indexes store a play index into
`plays`, so they compare directly — but the branch must be keyed on whether
the NUMBER is shared, not on the shape of the list item. The first attempt
branched on `typeof item === 'object'`; both lists hold objects, so every
resolved player was looked up in the identity index, every rank came back
undefined, and the sort ran and changed nothing. It failed silently and
looked like the merge had simply not worked — the same "guard that quietly
does nothing" as the three bugs recorded in HANDOFF.

## The strip is parked, not discarded (17 August 2026)

`gametest3.html` no longer contains the field strip. Andy's call: the
prototype tests one proposition — the pop-up numeric keypad, on every input
field, opened by tapping the box — and a second control beside the yardage
boxes muddied it. Removing the strip took about 23KB out of the file:
`buildStrip`, `openStrip`, the `.stripBtn` click branch, the launcher entry
and the button injected next to yardage and yard-line fields.

**Where the code went.** Nowhere — `gametest2.html` still carries the full
implementation, byte-identical to what was removed, and git holds it either
way. Nothing needs reconstructing if the strip comes back; it needs copying.
That is the reason it was deleted outright rather than left dormant behind a
flag: dead code in a file under test is how `attachPickersLegacy` and the
stale `PICKER_MODE` comment came about.

A few strip declarations survive in `gametest3` — `stripEl`, `stripTarget`,
`stripTargetId`, `stripSuppressClose` and `closeStrip` itself, which is
still called from six defensive close sites. With nothing to build a strip,
`closeStrip` is a no-op guard. Left in place deliberately: removing it means
editing six unrelated call sites for no behavioural gain. It should go when
the prototype is promoted or retired, not before.

## Default to the pad, list the exceptions (17 August 2026)

`fieldKind` matched jersey fields with `/_manual$/`, anchored. That silently
missed EIGHT live fields: `pp_credit_manual_rushfum`, `_passfum`, `_sackfum`,
`_pb` and `_fgb` all carry a suffix after `_manual`, and `pp_muff_rec`,
`pp_ko_onside_rec` and `pp_ko_muff_rec` matched nothing at all. Those boxes
had no picker whatsoever — on a touchscreen, nothing to tap.

It is now inverted: everything is a jersey field unless it matches clock,
yard line or yardage, or appears on a two-name exception list. `manualText`
describes a play in words and `code` is the hidden staging field the review
step reads; on a touch device a classified field also becomes `readOnly`, so
misclassifying either would make it impossible to fill rather than merely
awkward.

The point is which way the mistake falls. Matching patterns means a field
nobody thought about gets NO pad, which is invisible until a scorer needs it
mid-drive. Defaulting means it gets a pad it may not want, which is visible
the first time anyone opens the panel. Same class of reasoning as the
whitelist checks: prefer the failure someone will notice.

`pp_calc_yardline` still reports no kind, correctly — it is `disabled` until
the calculator is in use, and `attachPickers` sets `pickerDone` only AFTER a
kind is found, so the MutationObserver picks it up the moment it is enabled.

## Bind the event the user actually generates (17 August 2026)

`attachNameConfirm` was bound to `blur` and `change`. Neither fires while
you are still in the box, so typing a jersey number showed nothing: the only
way to see who #80 was, or to be offered the choice between two men wearing
it, was to tab out. A scorer entering a number between snaps does not tab.

Binding `input` as well fixes it. `render()` rebuilds the box from the
field's current value, so it is idempotent — firing per keystroke costs a
redraw and settles on the same answer `blur` would have reached. Typing 8
then 0 resolves #8 briefly and then #80, which is the live feedback wanted.
Ordering is safe because the manual field's own `input` listener is
registered first and has already set the number and cleared the stale name
before `render` runs.

This is the third bug this session from the same root: **the code listened
for an event the interface never produced.** The keypad dispatched `input`
but not `change`, so `attachNameConfirm` never resolved a name from the pad.
`attachNameConfirm` listened for `change` but not `input`, so it never
resolved one from the keyboard either. Both halves were individually
defensible and together they left a gap that no test could see, because
`ui_driver.js` dispatches both events on every write and therefore
satisfies any listener regardless of which one the real control fires.

The rule worth keeping: when wiring a listener, name the actual user action
that produces it. "Types a number" is `input`. "Leaves the field" is `blur`.
"Taps a pad key" is whatever the pad dispatches — go and read it.

## gametest3 became game.html (17 August 2026)

The keypad prototype won and was promoted. The old entry page is preserved
verbatim as `game_legacy.html`.

**The URL had to stay `game.html`.** `dashboard.html` navigates to
`game.html?id=`, and beyond that are bookmarks, open tabs and deep links
nobody has an inventory of. So the CONTENTS moved and the address did not;
the fallback is the file you have to ask for by name, not the one everyone
lands on by accident.

**One real gap had to be reconciled first.** `gametest3` forked from
`game.html` at 06:34 on 17 Aug, and commit `0b2ee9f` at 08:40 changed
`game.html` alone — it added the starters gate to the picker's ambiguous
list. Promoting without noticing would have silently reverted it. Worse,
the same bug was independently re-fixed in the prototypes later that day,
so `game.html` briefly carried TWO equivalent gates. The promoted file
keeps `0b2ee9f`'s: it sits after the two overrides, and its comment
explains why that ordering matters.

A function-level diff was the thing that made this safe to do — zero
functions existed in `game.html` that were missing from `gametest3`, so the
only possible losses were statement-level, which narrowed the search to one
commit.

**Prototype scaffolding was stripped before promotion, not after.** Gone:
`attachPickersLegacy` (never called), `launcherFor` and `PICKER_MODE` (only
reachable through it), `buildWheel` / `openWheel` / `closeWheel` and the
`.wheelBtn` branch (no wheel button was created any more, so the whole
yardage wheel was unreachable), `closeStrip` and the orphaned strip state.
Roughly 8KB. Shipping it would have repeated the exact mistake that made
`attachPickersLegacy` a puzzle in the first place.

Removing it took two attempts. The first deleted the functions and their
call sites in one pass and broke the parse, because two calls were the
BODY of an `if` — `if (...) closeWheel();` — so removing the call left a
dangling condition. The second went one function at a time with a syntax
check after each and reverted anything that failed, which found it
immediately. Bulk edits to code with no tests are worth doing in single
steps you can bisect.

**The strongest evidence the promotion was safe** was the golden snapshot:
all 50 UI paths produced byte-identical play data, roles, effects, state
transitions and box scores before and after. The input method changed
completely; nothing downstream moved at all. That is exactly the question a
golden file is good at answering, and the one nobody can answer by reading.

`gametest.html` and `gametest2.html` are marked DEAD PROTOTYPE in a banner
at the top of each. `gametest2` is worth keeping specifically because it
still holds the field strip.

## Read the file, not your memory of the file (18 August 2026)

The standing rule at the top of this document exists because of tonight,
specifically. Building touchdown handling for a punt-return fumble, the
first draft was written by pattern-matching against the rush/pass/sack
merge from earlier the same session — a similar-looking problem, solved
correctly, a few hours before. It produced three real bugs, all avoidable
by reading the actual file instead of a memory of a related fix in it:

**The score went to the wrong team.** `score = { team: def, points: 6 }`
was copied unedited from the branch above it, where a clean punt return
can only ever belong to the receiving team. The new branch had two
possible recovering teams. Reading `engine.js`'s `countTurnovers` and the
muffed-punt (`pm`) branch directly showed the correct shape immediately:
`recTeam = kickingRecovers ? off : def`, and the score credited to
whichever team actually recovered — the exact pattern `pm` already used,
sitting a few hundred lines away, unread until asked to check.

**The state would have frozen on a stale down.** The kicking-team-recovers
case uses no flip — the ball never changes hands, so there is nothing to
hand over — and was written with `effect.newPossession: true` on the
assumption that this resets state the way a flip does. It does not.
Grepping `engine.js` for every consumer of `newPossession` found exactly
one: drive-boundary detection in `findDriveStarts`, which affects reporting,
not live state. The ONLY thing that nulls `down`/`distance`/`fieldPos` on a
score without a flip is `effect.endsDrive`, read directly out of
`computeState`'s effect-handling block. The muffed-punt branch had hit this
same bug once already and fixed it, with a comment that says so verbatim:
*"A touchdown ends the drive whichever side recovered. Without this a
kicking-team recovery returned for a score left the old down and distance
sitting on screen."* That sentence, read before writing rather than after
being asked to check, would have prevented the bug outright.

**The checkbox did nothing.** The submit-side code built a `fumrec:`
token and never appended `td` to it at all — so checking "Touchdown" on
this branch would have silently done nothing, regardless of how correctly
`parseInput` handled the token once present. A single read of the
surrounding submit code, which was already open, would have shown the
omission immediately; it was found only because the other two bugs
prompted a full re-read.

All three were caught before shipping, this time, because the person
using the app said stop treating this as urgent and re-read the code you
are extending — not because the process caught itself. The lesson kept
this session, repeatedly, in different shapes (`view.html`'s position
guess standing in for a fact the engine could by then state directly; the
picker's ambiguous list never actually gated on the starters list despite
a comment claiming it was; a deleted tap handler that passed every syntax
check because deleting live code produces syntactically valid code) is the
same one: a plausible, similar-looking pattern is not evidence about what
a specific piece of this codebase actually does. The file is authoritative.
Memory of the file is not.

## One blind spot in many places is not many bugs (19 August 2026)

Fifteen branches of `parseInput` shared one hardcoded assumption:
`team: off`, regardless of `td`. Fixing the first one and then checking
every sibling — rather than treating the reported bug as isolated —
found the other fourteen in the same sitting. The pattern repeated at a
second level: `computeDriveSummary`'s scoring capture, `renderLogLines`'s
bold-highlighting, and `playsFor` in four separate files all broke for
variants of the same reason, once the first fix started correctly
flipping a field three unrelated pieces of code were all silently
reading the same way.

The practical lesson: when a bug turns out to be "this field was wrong
in a way nobody had ever exercised," the next question is never "is
this fixed now" — it's "what else reads this exact field, and does IT
make the same assumption." A codebase-wide grep for the pattern, not
just the one reported symptom, is what actually closes it.

## A test that has not been shown to fail is not verified (19 August 2026)

Twice this session, a "passing" test turned out to prove nothing. The
attribution fuzzer's phantom-drive check initially generated a fumble-
recovery spec with no takeover-spot field, leaving `fieldPos: null` —
which the fuzzer's own loop then "fixed" by attempting a kickoff, which
made no sense there at all, and produced a finding that looked like an
app bug and was entirely the fuzzer's own generator. Separately, the
FIRST version of `tests/guided_kickoff_check.js`'s `endsDrive` test
passed with the fix deliberately removed, because it started from a
fresh game where `down`/`distance`/`fieldPos` were already `null` —
there was nothing stale for a missing fix to leave behind, so the test
could not have told a working fix from a broken one either way.

Both were only caught by deliberately reverting the fix and watching
the test — expecting red, watching for it to actually turn red, not
assuming it would. A green test against unmodified code is not
evidence. The only real evidence is a test shown to fail against the
SPECIFIC broken version it exists to catch. This is now the standing
check for every new fixture in this project, not a one-off habit for
one session — including double-checking earlier manual verification
done before a permanent test existed, since it can carry the identical
blind spot.

## Mutation testing distinguishes a stale fixture from a real gap (19 August 2026)

Running all 23 known mutants against the live suite (not just trusting
that a prior pass had) surfaced three different outcomes, and they are
NOT the same finding: one mutant could not even be applied, because its
anchor text was the exact line before a fix made earlier the same
night — a maintenance gap in the test file, not a defect in the app.
One survived genuinely, and turned out to be dead code
(`returnerRank()`, never called) — a real gap, but with zero actual
risk, since nothing exercises the code it would protect. The other 21
were caught immediately by their expected suite. Treating all three as
"the mutation suite found problems" would have been wrong in two of
three cases. The fix for each is different: update the fixture, decide
whether to finish or delete the dead code, and do nothing at all — and
conflating them wastes the part of this signal that's actually
diagnostic.

## The guided flow is not a copy of `parseInput` — it never calls it (19 August 2026)

`TODO.md` has tracked `parseInput` duplication across four HTML files
as a known cost since at least 17 August. The guided kickoff flow is a
fifth instance and a structurally worse one: it does not duplicate
`parseInput`, it replaces it — every outcome's `text`/`effect`/`roles`
is hand-built inline in the guided-flow handler, with no shared
function at all. That is why an upgrade to the ordinary kickoff panel
(the "fielded at / returned to" calculator, a real `endsDrive` bug fix)
never reached it: there was no code connecting the two for the fix to
travel through. The 18 August handoff had already named this exact
gap — "kickoff has its own guided flow... that difference has not been
checked yet" — and it still took a live-game report to surface it,
because a standing note in a handoff file is not the same thing as a
test that fails when the two diverge. Consolidating `parseInput` into
one shared place, reachable from both the ordinary panel and any guided
flow, would not just reduce edit sites — it would make this specific
class of drift structurally impossible instead of merely documented.

## One blind spot in many places, a second time — the sack-fumble defense credit (20 August 2026)

The same shape as "One blind spot in many places is not many bugs"
above, five days later, with a different field. A sack that also
produced a fumble recovered by the defense recorded the fumble but not
the sack itself, in `engine.js`'s `computeBoxScore` — the defense
sacks check tested `type === 'sack'` directly and never had the
`type === 'fumble' && r.attempt === 'sack'` exception the passer's own
"sacked" credit already carried.

Fixing `engine.js` was not the end of it, and the reason is the same
one 19 August already stated: **the next question after a wrong field
is fixed is never "is this fixed now" — it is "what else reads this
exact field, and does it make the same assumption."** Grepping for
`playType === 'sack'` found it independently reimplemented, un-fixed,
in seven more places across five files: `view.html` and `broadcast.html`'s
own `defTotals.sacks` accumulators (both live, both feeding what a
scorer or a broadcast overlay sees mid-game), `stat_package.html` and
`season_report.html`'s XLSX "Sacks and Bad Snaps" rows, and dead
`sackYardsLost` calculations in three files that were fixed for
consistency even though nothing currently reads them. One false
positive was checked and correctly left alone: `view.html`'s own
per-drive rush/pass breakdown already had its own, separate
fumble-combined branch, added at a different time for a different
reason, and already correct.

**The generalizable lesson, restated because it recurred rather than
because it is new:** a fix inside the shared engine does not
automatically reach a display surface that reimplements the engine's
own logic locally instead of calling it. Every one of these seven was
an independent, duplicate "count sacks from the play log" written by
hand rather than shared — the same root cause `engine.js`'s own
extraction (section 8a, `TODO.md`) exists to remove for the five
computation functions it already covers, and a live argument that the
same treatment is worth extending to any other logic still duplicated
by hand across the report surfaces.

## Season-scoped rosters — why `players` needed a `season_year`, and the risk that motivated it (20 August 2026)

Andy asked for a way to keep last season's roster around instead of
losing it to "Clear roster," so he could keep working with past
seasons' games. Investigating the actual risk, not just the stated
request, surfaced something sharper than "the old data gets deleted":

**`create_game.html` always re-derives "our" team's roster from the
live `players` table on every save of an existing game, unconditionally
— this was already true before tonight, and it is still true now.**
The comment in the file says so directly: *"Our roster is always
freshly resolved from the current team roster, so it always gets
replaced."* The opponent roster already had an exception for this
("only replaced if actually touched this session"); "our" side never
did. So the real risk was never just "old data gets deleted" — it was
that reopening an OLD game months later, to fix nothing more than a
typo in its designator, would silently overwrite that game's roster
snapshot with whatever the CURRENT season's roster happens to contain,
corrupting a game that nobody was touching on purpose. Confirmed the
`players` `id` is never actually joined back from `game_rosters` at
display time anywhere in the app — every finished game's stats are
already fully self-contained in its own snapshot — so this specific
risk is narrower than "any past game," but it is real for the one path
(re-saving an old game's setup) that does re-derive from `players`.

**The design, in order of how much it changes:** add `season_year` to
`players`; a season selector on `roster.html`, current season fully
editable and every other season fully read-only (Andy's explicit
call — no controls rendered at all for a past season, not merely
disabled ones); `create_game.html`'s roster query resolves against
*that specific game's own* `season_year`, not the team's "current"
one — which is what actually closes the corruption risk above, since a
re-save now correctly re-derives from the game's own historical
season regardless of what season is active today. Confirmed with Andy
before touching anything: players overlap between seasons constantly
and their numbers can change year to year, and this design handles
that for free, structurally — each season's roster is its own,
independent set of rows, with nothing linking a number's meaning
across two different years, so there is no scenario where the season
scoping itself could confuse two different people who happened to
share a number in different years.

**Explicitly decided against, and worth recording so neither gets
rebuilt as an oversight:** no way to retroactively add a player to a
past season's roster, and no "copy last season's roster forward" as a
starting point for a new one. Both were asked about directly and
declined.

**The migration detail that mattered more than it looked.** The
backfill for existing rows could not simply use `teams.current_season_year`
— confirmed directly with Andy that what was still loaded in the live
`players` table, at the moment of migration, was last season's roster,
not yet replaced. Using the team's own "current" pointer would have
mislabeled an entire season's real roster as belonging to whichever
year the team record already pointed at. The backfill instead uses the
literal year Andy confirmed, not a value derived from anything else in
the database.

**A second, adjacent SQL gotcha, worth stating plainly since it would
have silently broken every existing game's inclusion in season
stats.** `is_preseason` (a related, smaller feature shipped the same
session — see below) is `NULL`, not `false`, on every game that
existed before that column did. `NULL = false` is itself `NULL` in
SQL, not `true` — so a plain `.eq('is_preseason', false)` filter would
have quietly excluded every pre-existing game from every season
report the moment it shipped. Both exclusion filters
(`season_report.html`, `player_report.html`) use an explicit
`.or('is_preseason.is.null,is_preseason.eq.false')` instead, which
treats null and false identically and only ever excludes a genuine
`true`.

## A test harness gap is a blind spot for every future test, not just the one that found it (20 August 2026)

Testing the season-scoped roster feature required the shared mock
Supabase backend (`tests/harness.js`) to support things it never had
before: the `players` table at all, `.in()`, and a `teams` row shaped
the way `roster.html` needs (`id`/`name`/`current_season_year`,
alongside the colour fields other pages already read from the same
mocked row). None of this was a gap introduced tonight — `roster.html`
had simply never been tested against this harness before, so nothing
had ever needed it.

**The same principle already established for `delete()` and `.or()`
applies here too, and is worth restating because it keeps recurring: a
mock that silently returns nothing for an operation it does not
implement is worse than one that throws.** The `players` table's
`select`/`insert`/`update`/`delete` handling, and the new `.in()`
method, all evaluate real filters rather than approximating — because
the entire point of testing a season-scoping feature is verifying that
a season filter actually narrows what a query returns, and a mock that
quietly ignored the filter would have let the exact bug this feature
exists to prevent pass every test while still being broken in
production. Confirmed this reasoning holds by deliberately breaking
the real fix (the season filter on the roster query, and separately
the season filter on the "Clear roster" delete) and watching the new
tests catch each one specifically, not just watching them fail to
notice anything was wrong.

Ran the entire existing suite — every other test, the golden
snapshot, all five fuzzers — against the modified harness before
trusting any of it, since a shared mock used by forty-odd other tests
is exactly the kind of file where a well-intentioned addition can
silently change behaviour nothing else was checking for.

## The rail layout became game.html (22 August 2026)

The second promotion, and it followed the first one's procedure
deliberately: contents move, the address does not. `dashboard.html` still
navigates to `game.html?id=`, so bookmarks, open tabs and deep links keep
working, and the fallback is the file you have to ask for by name.

**The fallback was replaced, not added to.** `game_legacy.html` already
existed — the pre-keypad page frozen on 17 August — and it had none of the
fixes made since: not the guided kickoff return-touchdown deadlock, not
the half/game-end clock entry, not the clock keypad. A fallback that can
itself deadlock is not a fallback, so it now holds the 22 August
`game.html` instead, fully patched, with a banner at the top saying what
it is and that it is frozen. The older file is in git history if it is
ever wanted, which it should not be.

**The same two safety checks as last time, and they earned their keep.**
The function-level diff found zero functions in `game.html` missing from
the prototype (113 → 114; `shortPickerName` was the addition), and the
golden snapshot held all 50 paths byte-identical — the entry layout
changed completely and nothing downstream moved at all.

**Promotion surfaced a real bug that testing on the prototype had not.**
Surname-only picker labels reduced an AMBIGUOUS shared number to nothing:
those entries carry a trailing `?` inside the name string itself, so
taking the last whitespace token returned the question mark and discarded
the name. Both players on a shared number rendered as an identical
`7 ?` — precisely the case where the name is the only thing telling them
apart. `shortPickerName` now splits the marker off, shortens the name in
front of it, and puts it back.

**And a test-harness fault that had been reading as an application fault.**
`ui_driver.pickPlayer` matched `textContent.includes(opts.name)` and fell
back to `candidates[0]` when it found nothing. Once labels showed
surnames the match stopped working, the fallback quietly clicked the WRONG
player, and the roster fuzzer duly reported bad stat attribution — the one
thing it exists to catch — while the app was innocent. It now matches
title as well as text, and THROWS rather than falling back: asking for a
specific player and being handed whoever happens to be first is how a
broken selector disguises itself as a broken engine.

`picker_behaviour_check` was updated the same way, reading identity from
title-plus-text rather than the visible label. The two tests that pointed
at `gametest3.html` now point at `game_legacy.html`, so the fallback is
exercised as a first-class page rather than drifting unwatched.

`gametest3.html` is now a duplicate of `game.html` and should be deleted
from the repo.


## Halftime ends at "Start 2nd half", and the marker is cleaned up (22 August 2026)

Two changes that only make sense together.

`view.html` sat on its HALFTIME card until a real second-half play was
entered, so the whole guided kickoff ran under a HALFTIME banner while the
teams were visibly lining up. It now ends halftime on the Q3 quarter
marker, which "Start 2nd half" writes immediately. The interval header
also carries who kicks off next, in smaller print to the left of the word
-- derived from the OPENING kickoff (whoever kicked to start the game
receives now), not from possession, which at halftime belongs to whoever
last had the ball and says nothing about what happens next.

**That change alone would have reintroduced a documented bug**, and the
comment saying so was still in the file: undoing the opening plays of a
half leaves the Q3 marker behind, so a page keying off the marker insists
on Q3 while `game.html` -- whose `derivePhase()` requires a real play --
has gone back to halftime.

So the residue is now removed at source. Undo already had the idea: a
divider pulls its companion clock row. It now also pulls a stranded Q3
marker, but only when NOTHING real remains after the interval, and only
trailing markers -- a Q3 marker with plays behind it is a genuine record
of when the quarter turned and is left alone. It joins `removedRows`, so
the existing server-delete loop takes it too and "Redo last" puts it back
with the play it left with.

The alternative was to teach every reader of the log to ignore a marker
that means nothing. A marker for a half with no plays in it is not a fact
about the game, it is left-over state, and deleting it is cheaper than
documenting it in three places.

`tests/stranded_quarter_marker_check.js` covers all four cases: undo
immediately after Start 2nd half, undo back across a completed kickoff,
a legitimate marker surviving, and redo restoring a removed one.

---

## 23 August 2026 — eleven reported bugs, then the iPad

Andy played a game through the UI and reported eleven faults, then two
more, then a run of layout problems on an iPad. What follows is the
reasoning worth keeping, not a changelog.

### fieldDelta and statYds are genuinely different numbers

The engine has always carried both on an effect: `statYds` credits the
player, `fieldDelta` moves the ball. Every caller had been passing the
same value to both, so the distinction was theoretical until now.

A runner's yardage is measured to the SPOT OF THE FUMBLE, not to where
his team fell on it. Gain 8, fumble, recover 3 back: the rusher is
credited 8 while the ball sits 5 ahead of the snap. That is the first
place in the app where the two must differ, and no engine change was
needed to do it -- only the entry layer had been conflating them.

Distance-to-go had to follow `fieldDelta` too. It measures the ball, not
the stat sheet.

### The own-recovery fumble never awarded a first down

Found while adding the above, and much worse than it. The effect never
set `converts`, so the engine advanced the down but could not convert:
2nd & 7 at own 30, rush for 8, own recovery came out 3rd & 1 instead of
1st & 10. Verified against the live build before touching anything, so it
long predated the work. Every own-recovery fumble that reached the marker
had been scored a down short.

### NFHS: the defence cannot score or take possession on a try

The 2PT tree offered "Fumbled, turned over" and "Intercepted, turned
over", with an NFHS note directly above them saying the try ends the
moment the defence gains possession. The tree contradicted itself. Both
removed; the PARSER still understands the old codes so stored games keep
rendering.

### A game must use the roster of ITS OWN season

Reported entering a 2025 game and getting the 2026 roster. The query
always filtered by season correctly -- but it ran once inside `init()`,
reading the year field at that moment, which on a new game is the team's
CURRENT season. Changing the year afterwards re-fetched nothing.

This mattered more than a display bug: `create_game` snapshots the roster
into `game_rosters`, and that snapshot is what `game.html` reads for the
rest of that game's life. A wrong roster at creation is wrong in every
report afterwards. Any 2025 games created before the fix have the wrong
snapshot baked in.

Andy confirmed prior-year rosters are already read-only, so the three
protections now line up: the roster is frozen per season, the game keeps
its own snapshot, and the snapshot comes from the right season. Making a
whole past season read-only would add nothing and would block entering a
past game, which is a normal thing to do.

### FIVE LESSONS FROM THE LAYOUT WORK, which took far longer than it should

**1. jsdom cannot see media queries at all.** `matchMedia` is undefined
and `@media` blocks are ignored, so every responsive rule reports as
though it does not exist. Its cascade also cannot settle `!important`
conflicts reliably. A whole afternoon of iPad fixes tested correct here
and did nothing in the browser. Anything scoped to a media query must be
asserted from the SOURCE TEXT, not from getComputedStyle, or the check
cannot fail.

**2. Style the element, not its container.** Three separate bugs, all the
same shape: a rule scoped to where an element used to live, applied to an
element that had been moved.

  * `#onAirBanner` carried `position:absolute` itself, so wrapping it in a
    flex container changed nothing -- an absolutely positioned child
    ignores its parent's layout.
  * `.hdr-btn`'s metrics are `!important` and shared with controls that
    want a different shape.
  * `#topActions a { color:#fff }` stopped matching the moment the links
    moved, and they fell back to the browser's default link colour --
    purple, in a header full of dark tiles.

The point of MOVING elements rather than duplicating them is that they
keep their behaviour. Their appearance has to be attached to them too.

**3. An inline style beats any stylesheet rule.** `syncAir` writes `top`
and `height` inline onto the positioned header element. Two CSS fixes had
no visible effect whatsoever because of it. When a style change does
nothing at all, look for script writing to that element FIRST, not third.

**4. `removeProperty` on a shorthand leaves the longhands behind.**
`margin` set via `setProperty` expands to four longhands, each still
`!important`; removing `margin` clears none of them. Tablet styles rode
back to desktop this way.

**5. Move the children, not the wrapper.** Relocating `#topActions` into
the header row put a nested flex CONTAINER inside it, which was squeezed
for width and stacked its three buttons into a column -- then the row's
`align-items:stretch` made everything else as tall as that column. Moving
the three links individually gives one flat row that wraps as a row
should.

### The card was silently widened

The entry card is 760px and every rail offset is written against it. It
was widened to 860 at some point during the responsive work, which
squeezed both rails and the top row -- and made several header fixes look
like they had failed when they had not. A test already asserted the rail
sits at `calc(50% + 398px)`; it had been failing and was read past.
Reverted, and the declared value and all four fallbacks now agree.

### Layout that must be reliable is set from script

After the CSS route failed repeatedly, the header is now positioned by
`layoutHeader()` rather than by media queries: it reads the width (or
`(hover: none) and (pointer: coarse)`, which catches an iPad reporting a
desktop width in "Request Desktop Website" mode) and sets inline styles.
The trade is that the layout lives in two places, so the rule is: the
stylesheet describes DESKTOP, and `layoutHeader` is the only thing that
changes it for touch.

It runs again after the game row loads. Broadcast Setup is revealed only
once the user's role is known, which is asynchronous -- so on a first
visit the row was short, and appeared correct after a refresh purely
because the second load won the race.

### The 0-9 pad needed a SIZE change, not a colour change

Reported: pressing a number gave no feedback beyond the value appearing
in the box, which on a touchscreen leaves a scorer unsure the tap
registered -- and the box is not always where they are looking.

A lit state rather than a flash, because a press REPLACES the value
rather than appending: the box holds one digit, so the lit key is an
accurate picture of what is entered. It follows the box however the box
changes -- typed, filled by the calculator, cleared on collapse, negated
by LOSS -- because a key lit while the box disagreed would be worse than
no indicator.

**Three colour-only attempts were all reported as "no change".** Each was
verified deployed, unopposed by any CSS, and confirmed applying the
inline style. The code was right every time. A navy fill on a 36px key
simply was not legible as feedback on that screen; the moment it also
changed SIZE it read instantly.

**Final form: the standard gold, and no size change.** `button.picked` is
#ffc72c with an inset 2px #8a6a00 ring, and that is what a scorer already
reads as "chosen" everywhere else on the page.

Two intermediate versions were wrong and are worth naming. A NAVY fill
matched nothing else on the page -- it was reached by asking "what will
be visible" instead of "what does selected already look like here". And
GROWING the key made it the only control in the app that moves when
pressed; it read as an animation rather than a state, and on a 36px grid
with a 4px gap it crowded its neighbours.

The values are repeated in script rather than toggling the class, because
these keys carry their colours as inline styles from the markup and an
inline style beats any class. Same colours as the shared rule, so they
stay in step.

Asserted in the tests: the gold, the inset ring, and that the key does
NOT change size.

Two real bugs did surface on the way, both worth remembering:

  * The repaint was scoped to `panel` and reached only the key just
    clicked, one of ten -- so the previously lit key never went out.
    Scoped to `document` now; the pad is unambiguous by `data-for`.
  * It used `var(--sc-navy, #1a1a2e)` in a JS-set inline style. A custom
    property there is one more thing that can resolve to nothing, and
    when it does the assignment fails silently -- indistinguishable from
    the feature not working. Literal values in script-set styles.

### WHAT COST THE MOST TIME TODAY, and how to avoid it

The harness cannot see anything visual. jsdom has no layout engine,
ignores `@media` entirely, and cannot settle `!important` conflicts -- so
for a styling change it reports "correct" almost regardless. Treating
that as verification and handing the result over to be tested turned Andy
into the test harness, repeatedly, on work that could not be checked
here.

The rule that follows: **functional work can be verified here and should
be; visual work cannot.** Batch visual changes and ask for one look, or
leave them. Do not iterate blind, and say plainly when the harness cannot
settle a question rather than reporting a green test as though it had.

### Return stats — built the same day, and what the design bought

Kickoff and punt returns, kept SEPARATE. Scope narrowed by Andy: kickoff,
guided kickoff and punt only. NOT muffed-kick or blocked-kick recoveries
-- those are loose balls, not returns, and counting them would inflate
the average that makes the stat worth having.

**`roles.returner` is a role of its own**, not the `defense` key that
returners used to share with tacklers, interceptors and fumble
recoverers. Sharing that key is why a kick returner appeared in the
"Tackled by" picker for the rest of a game, and it meant return yardage
could not be told apart from anything else a defender did. `defense` is
still written alongside it, unchanged, so no existing report counts
differently.

The role carries `kind: 'kick' | 'punt'` from the first commit. That one
field is why splitting the combined stat into two, later the same day,
cost about an hour instead of a re-entry -- worth remembering as an
argument for recording the distinction even when the immediate
requirement does not need it.

**No backfill, by nature.** Roles are stored with each play in the
database rather than re-derived on load, so anything recorded before this
shipped has no returner role and never will. Worth knowing before
promising a stat retroactively: the play TEXT carries the returner and
the yardage, so a backfill is possible by re-parsing, but it is real work.

Two bugs found while building it, both instructive:

  * The leaders helper `top` only accepts a value above zero -- right for
    rushing, wrong for returns. A punt returned for a LOSS vanished
    entirely. Found because Andy's first real test entered **-39**; the
    fixtures used 24 and 11, and would have missed it. A fixture kinder
    than reality tests nothing.
  * `mergeInto` in season_report and view kept a HARDCODED list of "long"
    keys to take the max of. `retLong` was not on it, so a season would
    have SUMMED the longs -- three 20-yard returns reporting a long of
    60. Both now use a `/Long$/` suffix test, as player_report already
    did. Any future "long" stat is handled automatically.

Shown in recap, stat package, season report and player report, LAST in
each special teams section. Deliberately NOT in the Live totals tile or
on the view page: a RET line was added to Live totals only so the new
stat was visible enough to verify while being built, and removed once the
reports carried it.

**The interception's intended receiver was already fixed.** Listed in
TODO as an open bug; the app records it correctly and always did. The gap
was in `ui_driver`, which never filled the field -- so no test could see
it either way and the entry stayed open long after the code was right.
Now pinned in tackles_check. Worth a general lesson: an untested feature
and a broken one look identical from the outside.

## The season report had two layouts and only half of it knew (23 August 2026)

A 10-game PDF was the first look at the season report at real length. The
reported symptoms were wrapping and charts too small. The cause underneath
them was that the report was being laid out one way and drawn another.

**The printed report was running the PHONE stylesheet.** `.chart-row` is a
two-column grid holding metrics, metrics, chart, chart -- side by side that
is metrics|metrics over chart|chart. The PDF instead showed metrics, chart,
metrics, chart, stacked. Exactly one thing in the file produces that
interleaving: the `order` rules inside `@media (max-width: 767px)`. US
Letter is 816 CSS px and the print dialog's default side margins take the
layout width under 767, so every grid in the document collapsed. Nothing
in eight pages was side by side.

**But the canvases did not follow.** Chart.js measures a canvas from its
container when the chart is CONSTRUCTED and re-measures only on a resize
event. A print pass fires none. So the containers became full width while
the bitmaps kept the widths they were given against a 912px screen column,
which is why every chart sat in the left part of its slot with dead space
to the right -- worst in Discipline, frozen at a third of 912.

The fix is not to re-measure mid-print; browsers disagree about whether
print styles are applied before `beforeprint`, so that cannot be relied on
to produce the right width. The fix is to **make the screen content width
equal the printable width** so there is nothing to re-measure. `.wrap` is
now 780px (732px of content), just inside A4 at 8mm margins (733px) as well
as Letter (755px), and `@page` declares its own side margins rather than
leaving the printable width to the print dialog. A `beforeprint` resize
remains as a guard against unforeseen paper, explicitly labelled a safety
net rather than the mechanism.

### The lesson worth carrying: a document should render at document width

A report is paper that happens to be viewable in a browser. Showing it at
960px on screen and then printing it at 740 guaranteed a mismatch in every
element whose size is computed once, and a canvas is exactly that. Matching
the two widths removes the whole class of bug rather than the instance of
it, and it makes the screen an honest preview.

### A five-child row in a four-child rule

The phone rules set `order` on `.chart-row > :nth-child(1)` through `(4)`.
The first Efficiency row had FIVE children -- three metric groups then two
charts. The fifth got no `order`, defaulted to 0, and jumped to the front:
the printed report showed the 4th-down chart sitting above the "3rd down %"
heading with its own number stranded underneath it.

This is the `#mainView` bug of the previous day repeating exactly -- `order`
applies to ALL children and the ones without it go to the top. It survived
because the rule and the markup it describes were far apart, and because
nothing counted the children. The rules are gone now: the DOM emits each
metric group immediately before the chart it describes, so the pairing is
structural and no CSS has to restore it. **A layout that needs a rule per
child is a layout waiting for one more child.**

### TODO.md was wrong about two charts, and the output is what showed it

`chartPassByHalf` and `chartRushByHalf` were listed among six "aggregate --
leave them alone" charts, with a suggestion to reclaim their full width for
a per-game chart that needed it. Both are built from the per-game `labels`
array with four series each; they run G1..Gn and grow all season. They are
two of the densest charts in the report and needed MORE room, not less.

So it is eleven per-game charts, not nine, and four true aggregates. The
brief was written from the id names -- `ByGame` marks a per-game chart --
and these two are per-game without saying so in their names. **A naming
convention is evidence, not proof; the two charts that broke the rule are
the two the rule got wrong.** Worth the reminder that TODO entries written
from reading code are hypotheses until output confirms them.

### Autoskip was dropping games silently

"Sacks allowed by game" printed G1 G3 G5 G7 G9. Chart.js drops tick labels
that will not fit and gives no sign it has done so, and the even-numbered
games were still plotted -- so a reader counting bars against labels would
misread every one of them. `autoSkip:false` on the per-game axis makes a
cramped axis look cramped instead of looking wrong. At full width fifteen
labels need about 450px of the 732 available, so it should not arise; the
point is that when it does it must be visible.

### Bar thickness is capped, not chart width

The layout has to hold from game 1 to game 15. Full width is what fifteen
games need; at one game the same chart would draw a single bar a third of a
page wide. Andy's call was to cap the BAR rather than shrink the chart, so
the axis stays full width and game 1 and game 15 are the same chart with
more or fewer bars, rather than two differently-shaped objects.

### Page breaks: the avoid moved down to units that can honour it

`.section { break-inside: avoid }` is a hope about space (see 15 August). A
chart section holding four full-width per-game charts is taller than a
sheet, so the hope is unsatisfiable and the browser broke it wherever it
liked -- half an empty page and a heading parted from its chart. The avoid
now sits on `.chart-unit`, which CAN be honoured: a metric strip never
parts from the chart it describes, a heading never parts from what follows,
and the section breaks between charts, which is the only boundary where a
break reads as deliberate. Table sections still fit and keep the old rule.

### What could not be verified here

Structure was verified: 15 canvases, each in its own unit, metrics before
chart in every one, every chart section marked breakable -- and each of
those assertions was mutation-tested to confirm it can fail. The
media-query and print rules were asserted from SOURCE TEXT, because jsdom
ignores `@media` and `getComputedStyle` cannot fail those checks.

None of that says how it LOOKS. Chart density at 15 games, whether 240px is
tall enough, whether a section border cut by a page break is acceptable,
and whether 732px feels too narrow on a desktop screen are all questions
only a printed PDF can answer.


## Versioning the schema — what a capture is worth, and what it caught (23 August 2026)

`MULTI_TENANT_PLAN.md` made schema versioning step zero, and understated
the gap. Three change-scripts were committed, but there was **not one
`CREATE TABLE` statement anywhere in the repo**. Every table, column,
constraint, index, policy and function existed only inside a hosted
dashboard. `sql/README.md` had described `sql/schema.sql` since 15 August
as "the only copy of the schema that exists outside a hosted dashboard";
that file had never been created.

### pg_dump was not available, and the catalog answered instead

`pg_dump` needs a direct database connection, which was not on hand and
which Supabase has been moving behind a pooler anyway. The database can
describe itself: `sql/capture/A..G` are seven read-only queries that run
in the SQL editor and return one cell of JSON each, covering columns,
constraints, indexes, policies, grants down to the column level, function
bodies, triggers, extensions, storage and event triggers.

**They were written against a scratch Postgres 16 built to mirror
StatChat's shape, not written and hoped for.** Six mutations were then
applied one at a time — a dropped policy, a revoked COLUMN grant, a
changed default, a dropped PARTIAL index, RLS switched off, a column
added by hand — and every one was caught, then reverted.

Seven queries rather than one because a single result is easy to truncate
on paste with no way to tell a short answer from a complete one.

### The gap was found by READING the output, not by a check

D returned `rls_auto_enable()`, which `RETURNS event_trigger`, and
`create_profile_for_new_user()`, a trigger function with no trigger on
any public table. Both were captured; neither of the things that FIRE
them was, because an event trigger is a database-wide object and the
signup trigger hangs off `auth.users`. A baseline built from A-F would
have created both functions and wired up neither: new tables would
silently not get RLS enabled, and a new user would get no profile row and
therefore no role. Both failures are quiet.

Query G exists because someone read a capture instead of feeding it
straight into a generator. **A capture tool cannot tell you what it did
not think to ask for.**

### The rebuild found a fault nothing else would have

`current_user_role()` is `language sql`, and Postgres validates SQL
function bodies at CREATE time. The first baseline put functions before
tables, so the function could not be created — `public.profiles` did not
exist yet. On the live database this was invisible, because the table was
already there.

The fix was to order the file properly (tables, functions, indexes,
triggers, RLS, grants, event trigger, storage) rather than to set
`check_function_bodies = off`, which is what a dump does and which would
have hidden a genuinely broken body later. **A file that has only ever
been run against a database that already satisfies it has not been
tested.**

### The deltas that are accepted, and why naming them matters

A rebuilt database differs from live in three known ways: `profiles`
column numbering (live has a gap at attnum 3 from a column dropped long
ago), `storage.buckets` columns that vary by Supabase version, and six
platform event triggers that are not ours to recreate. All three are
written into the baseline header. An unnamed accepted delta is
indistinguishable from a regression the next time somebody runs the diff.

### Four things the capture found that nobody had listed

Worth noting that all four were invisible from the application code —
they are properties of the database, and nothing but reading the database
would have surfaced them.

1. **`profiles.is_admin` is a GENERATED STORED column** whose expression
   is `role = 'admin'`. A hand-written baseline would have made it a
   plain boolean with a default, and every policy keying on it would have
   diverged from production while still passing a smoke test.
2. **`admins set game visibility` restricts nothing.** It and
   `games_update` are both PERMISSIVE policies on `games` UPDATE, and
   permissive policies OR together, so the effective rule is just
   (admin or game_entry). A `game_entry` user can set `is_public` and
   publish a recap. To restrict rather than widen, a policy has to be
   `AS RESTRICTIVE`. **A second permissive policy can only ever add
   permission; it cannot take any away.**
3. **`games.designator` is globally UNIQUE**, so two schools cannot both
   create "2025-W1" — a fourth tenancy hazard, and one that fails loudly
   at insert rather than leaking quietly.
4. **Hazard 1 is enforced by the database, not the application.**
   `one_broadcast_game` is a partial unique index. Making broadcast
   per-tenant is a migration replacing an index, not a change to
   `api/feed.js`, and should be costed that way.

### `plays.sequence_number` is numeric, and that changes a TODO estimate

Fractional sequence numbers let a play be inserted between two existing
ones without renumbering. TODO section 3 costs "insert a genuinely missed
play" as a REAL GAP worth scoping; the schema already supports it.

### The rule that came out of it

**A baseline records what IS.** Both known-wrong things above were
captured unchanged, with comments saying so and pointing at the migration
that should fix them. A baseline that quietly corrects things is not a
baseline — it is an undocumented migration, and the first time it is used
to rebuild a database it will produce something that never existed.

## Two verification habits that failed today (23 August 2026)

**A CSS assertion must strip comments first.** Two source-text checks
matched `order:` and `margin-inline` inside the explanatory comments that
had just been written above the rules being tested, and reported failures
that were not real. Both were rewritten to strip `/* ... */` before
testing declarations. A check that a comment can pass or fail is not a
check.

**`raw.githubusercontent.com` lies about recent commits, and a
cache-buster does not fix it.** Twice a file was reported as still
present after it had been deleted, because the raw CDN was serving a
stale copy — and `?v=<timestamp>` did not defeat it. The codeload tarball
is better but also lags by up to a minute. The habit: fetch the tarball,
and if the answer is "the step did not happen", WAIT and re-check before
saying so. Sending someone back to redo work they already did correctly
costs more than the wait.


## Splitting the brochure from the app (23 August 2026)

`statchat.co` served `index.html`, which was the app's sign-in page. A
public marketing site had to live at the root without moving the app,
because moving the app is expensive in ways that are easy to miss.

### What reading the code changed about the plan

Andy's instinct was to put the brochure on GoDaddy hosting. That would
have forced the app onto a subdomain, and a grep found why that is
costly: **28 redirects across 15 pages point at bare `/`**, and NOTHING
references `index.html` by name. Every "no session" path relies on `/`
BEING the sign-in page.

Moving the app would also have broken three things already out in the
world: the `/g/:token` share links parents hold (a `vercel.json` rewrite
to `api/share`), the vMix browser-input URLs configured on a production
machine, and Supabase's per-domain auth redirect list.

So: keep everything on Vercel, make `/` the brochure, move sign-in to
`login.html`, and repoint the 28 redirects. Every other URL is untouched.
GoDaddy stays the registrar and nothing more.

**The generalisation: before recommending against a hosting change, find
out what is pinned to the current URLs.** The answer was 28 redirects, a
rewrite rule, a vMix config and an auth allow list — none of it visible
from the file being replaced.

### Upload ORDER was the load-bearing detail

`login.html` first (new file, breaks nothing), then the 14 patched app
files, then `index.html` last. Replacing the root while the redirects
still point at `/` would have sent every session timeout to the sales
page. At no point in the sequence is the app broken.

### One commit per file is one DEPLOY per file

Uploading through GitHub's pencil-edit path makes a separate commit, and
therefore a separate Vercel build, for every file. Between the site
files, the sql capture files, the moves and the doc revisions, this
session crossed Vercel's free-tier limit of 100 deployments per day and
the brochure could not ship.

**Use Add file → Upload files and drag the whole batch: one commit, one
deploy.** Presenting files one at a time — which was the right call for
avoiding a README name collision — is the wrong call for the deploy
budget, and both costs have to be weighed at once.

### Three wrong theories, and what they have in common

The brochure did not appear after the push. In order, the explanations
offered were: the deploy cap, then Vercel's Redeploy button rebuilding
the commit it was clicked on rather than the newest. Both were plausible
and neither was checked. What actually fixed it was Andy re-uploading the
files as one batch, which produced a fresh commit and a fresh build.

Every one of those theories was offered without looking at the
Deployments list, which was the one place that would have said. **When a
deploy does not appear, read the deployment log before explaining why.**

## Password reset: half of it was already built (23 August 2026)

Andy reported the missing "Forgot password" link as a bug. It was, and
reading the page showed the shape of it precisely: `login.html` has
detected `type=recovery` in the URL hash and offered a set-password
screen since the invite flow was built. The RECEIVING half worked. The
SENDING half — a link, an email box, a `resetPasswordForEmail` call — did
not exist, so nothing could ever reach it.

Worth remembering as a category: **an unreachable feature and an absent
one look identical from the outside**, and the same lesson is already
recorded for the interception receiver field in `ui_driver`.

Four decisions, each with a reason:

  * **`redirectTo` is `window.location.origin + '/login.html'`**, not a
    constant. The app answers on three hostnames — apex, `www`, and the
    vercel.app deploy URL — and a hardcoded value bounces anyone who
    started on the other two.
  * **The reply never says whether the account exists.** "If there is an
    account for that address..." either way. Otherwise the box is a way
    to enumerate who has an account, and a school's staff list is not
    ours to confirm to a stranger. The real error is logged to the
    console so a genuine outage is not silently reported as success.
  * **The send button stays disabled afterwards.** Only the newest link
    works; five taps produce four dead links and no way to tell which is
    which.
  * **The set-password screen stops claiming "you're accepting an
    invite"** when the arrival was a recovery. One screen serving two
    arrivals must not lie about which one this is.

### The gap the errors exposed, NOT yet fixed

`login.html` parses `type` out of the hash and ignores `error` entirely.
A banned account, an expired link and an already-consumed link all
produce the same thing: a plain sign-in form and no explanation. Andy
only learned what had happened by copying the URL out of the address bar.

That matters because expired links are ROUTINE — reset links are
single-use, and corporate mail scanners commonly fetch every link in an
email before the recipient sees it, burning the token. The user then sees
a normal login screen, assumes nothing was sent, and requests another.

### Diagnosing it: the URL in the address bar was the whole answer

Four different causes produce "I landed on login but not the reset
screen", and the hash distinguishes all four: `#access_token=...` (a
routing bug), `?code=...` (PKCE flow, unhandled), `#error=...` (auth
refused), or nothing at all (the redirect was stripped). Asking for the
URL settled in one step what several rounds of theorising had not.

It read `error_code=user_banned`. Not a code bug at all — `banned_until`
was set on the account, and Supabase refuses every route in for a banned
user including a valid recovery token.

## Getting ahead of the evidence — a pattern from this session (23 August 2026)

Four theories were offered before their evidence: the Vercel deploy cap,
the Redeploy button, the free-tier email rate limit, and an apex-versus-
www recommendation that the first reset link immediately contradicted.
Two were wrong outright and one was contradicted by a fetch already sat
in the transcript showing every request landing on `www`.

The pattern is the same each time: a plausible mechanism was available,
and the cheap check that would have settled it — the Deployments list,
the Auth Logs, the address bar — was skipped in favour of explaining.
This is the same failure the standing rule already names for code ("read
the exact code path before proposing a cause"); it applies to
infrastructure identically, and the check is usually one click.


## Tokenization and dark mode — measured, then deferred (24 August 2026)

Asked whether the app could be restyled to match the new marketing site,
and whether a dark-mode selector was possible. Both come down to the same
question, so both were measured rather than estimated.

### The count, and why the total is misleading

1,730 hardcoded hex values across 21 pages:

    page                     <style>   attr    js
    game.html                     97    231   203
    game_legacy.html              36    234   189
    view.html                     48     26    19
    dashboard.html                39     29     6
    create_game.html              18     35     6
    ...13 more pages under 40 non-<style> values each
    TOTAL                        592    618   520

`game.html` and `game_legacy.html` are 83% of the non-`<style>` cost
between them. The other thirteen pages are an hour or two in total.

### FOUR different kinds of hex, and only one should become a token

The raw count is misleading because it lumps together things that must be
treated differently. Reading a sample of `game.html`'s JS values settled
it:

  * **Field-diagram colours** — `#639922`, `#97C459`, `#3B6D11` for grass
    and hash marks, `#4A1B0C` for the ball. Illustration, not theme. A
    dark mode must NOT invert the grass.
  * **Team-branding fallbacks** — `TEAMS.teamA = { bg:
    ourBranding.primary_color || '#1a1a2e' }` and `|| '#8B0000'` for the
    opponent. These are the answer to "this school has not set a colour
    yet". Tokenizing them would make a school's own branding follow the
    app theme, which is backwards.
  * **Generic greys** — `#fff` ×46, `#ccc` ×27, `#555` ×26. These are the
    real candidates.
  * **`<style>` block values** — the tractable 592, and the only ones the
    standing rule permits converting mechanically.

**A count of hardcoded colours is not a measure of work until you know
what each colour is FOR.** The same six characters can be a theme value,
a piece of customer data, or a picture of grass.

### The app already themes at runtime, which is the interesting part

Team colours are applied from `teams.primary_color` and
`games.opponent_primary_color` at run time. So the app has had a form of
dynamic theming since before any of this was asked — it just themes by
TEAM rather than by preference. Worth remembering when multi-tenancy
lands: those two fallbacks are a multi-tenant default question, not a CSS
one, and a navy default may be wrong once the tenant is not Neville.

### Why it was deferred

Not a prerequisite for multi-tenancy — presentation and data isolation do
not touch. None of the six hazards in `MULTI_TENANT_PLAN.md` involves CSS.

The real cost is not the editing, it is the VERIFICATION. jsdom has no
layout engine and cannot tell you a panel went white-on-white, so every
converted page needs a human look. That is 21 pages of Andy's attention,
which is the scarcer resource. Deferred on that basis rather than on
effort.

### The entry-screen mockup, and what it showed

A mockup of the game entry screen in the marketing site's palette
answered a narrower question: **the colours transferred and the
typography did not.**

Gold-means-selected, red-means-on-air and green-means-affirmative moved
across without argument — because they were taken FROM the app when the
site was built. But condensed tracked uppercase is elegant and slower to
read, and it survives only on small static labels. Everything a scorer
reads at speed went back to Inter and the mono at full size.

The number that mattered most: **48px minimum for anything a finger hits,
against roughly 28px for the equivalent chip on the marketing site.**
That single value is most of the difference between an illustration of a
control and a control. A style built for reading a page cold does not
transfer unaltered to a tool used at speed in the dark.

Two smaller adjustments for the medium: hairlines lightened from
`#2b333d` to `#323c47` and labels brightened, because the site is read on
a phone held close and the entry screen is read at arm's length in a lit
press box, where the site's values disappear.


## Two scorers in one game — what actually happens (24 August 2026)

Asked whether a warning is needed when two people have the same game open
in entry. Read the path rather than guessing, and the answer is in three
parts.

### The DATA is safe, and the database is what makes it safe

`nextSequenceNumber++` in `game.html` is a LOCAL counter, seeded from the
play log when the page loads. Two scorers on the same game therefore
compute the same next number, and the second insert is rejected by
`plays_game_seq_unique UNIQUE (game_id, sequence_number)` — captured in
`000_baseline.sql`. No play silently overwrites another and the log
cannot interleave into nonsense.

Worth noticing that this protection is a database constraint nobody wrote
for this purpose. It exists to keep the log ordered, and it happens to be
the only thing standing between two scorers and a corrupted game.

### The MESSAGE is wrong, and that is the real defect

`persistPlay` catches any insert failure and calls `enqueuePlay`, then
shows:

    "No connection to the server — this play is saved on this device and
     will upload automatically when the connection comes back. Keep
     entering plays as normal."

For a unique violation every clause of that is false. The connection is
fine. The play will never upload, because the sequence number stays taken
and the retry hits the same constraint forever. And "keep entering plays
as normal" is the worst possible advice: the scorer works through a
quarter accumulating a queue that can never land.

**A catch-all error handler that names ONE cause will eventually be wrong
about a different one.** The offline path was written when connectivity
was the only plausible failure; the unique violation arrives through the
same door wearing the same coat. The fix is to read the error code and
say something true — Postgres returns `23505` for a unique violation —
and it is small.

### Nothing detects a second scorer

`game.html` contains no realtime subscription, no presence channel and no
locking: zero matches for `.channel(`, `presence`, `postgres_changes` or
`subscribe(`. So the first anyone knows is a failed save.

A presence warning is a genuinely useful feature and a bigger piece of
work — it needs Supabase Realtime, a decision about what to do when two
people are present (warn both? lock the second to read-only?), and a
story for what happens when a laptop sleeps mid-game and the channel
drops.

### NOT a barrier to multi-tenancy

Deliberately recorded rather than fixed. Multi-tenancy is about isolating
one school from another; this is two people inside one school's single
game, which is the same problem before and after tenancy and no harder to
fix later. Nothing in the tenancy plan depends on it.

The one thing tenancy DOES change is the blast radius: today a bad
concurrent-entry experience is Andy's own crew and Andy can explain it.
With paying customers it is a support call from a school mid-game.

## The icon that was NOT working as designed (24 August 2026)

An iPhone home-screen icon showing the school's logo instead of
StatChat's was reported as a bug. The root copy of `team-icon.js` set
both `icon` and `apple-touch-icon` from `teams.icon_url` on eighteen
pages, and reading only that file, the honest conclusion was that it was
deliberate and simply out of date.

It was not. `tests/team-icon.js` records the feature as REMOVED on 22
August, on Andy's call, with the reasoning written out at length. The
file was neutered rather than deleted — twenty-one pages carry
`<script src="team-icon.js">`, and an empty file is one upload where
removing the tags is twenty-one. **That neutered file was never
uploaded.** The root copy stayed the working version and the feature
carried on.

### The lesson, and it is the important one

Before finding that file, this was "fixed" as a favicon/home-icon SPLIT:
team logo on the tab, StatChat on the home screen. It was reasoned,
tested, mutation-tested, and written into TODO.md and PROJECT_NOTES.md as
a fresh decision. It also **reversed a decision already made and argued
on multi-tenancy grounds** — `is_our_team` picks exactly one row, which
is the whole problem with a per-team icon once there are two schools.

**A file that contradicts a documented decision is more likely to be a
failed upload than a change of mind.** The documented decision is the
thing to check first, and the check is one grep. Three uploads have
silently failed on this project already; that history should have been
the first hypothesis rather than the last.

It also produced a second wrong entry. `TODO.md` said "Drop
`teams.icon_url`. Nothing reads it." Reading only the stale root file
made that look false, so it was marked WRONG — when it was right, and is
right again now the neutering is restored. **Correcting a document
against a stale artifact makes the document worse.**

### Where the decisions actually live

`tests/` contains its own `PROJECT_NOTES.md` (28KB) and `tests_README.md`
(31KB) which are STALE DUPLICATES of the root documents — no mention of
anything from the last two days. `tests/team-icon.js`, by contrast, held
a live decision nothing else recorded. So the tests directory is both a
place where old copies go to rot AND a place where real reasoning is
kept, with nothing to distinguish them. Same duplicate-drift pattern that
produced `sql_README.md` and `sql/history/README.md`.

- HANDOFF.md points a new session at TODO.md and PROJECT_NOTES.md. It
  does not mention that a neutered source file may carry the only record
  of why a feature is gone.
