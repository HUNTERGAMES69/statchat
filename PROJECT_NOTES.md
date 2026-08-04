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
