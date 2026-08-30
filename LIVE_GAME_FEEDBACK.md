<!-- Copyright 2026 StatChat. All rights reserved. Unauthorized copying,
     modification or distribution of this software or its documentation
     is prohibited. -->

# Live game feedback — to do

Things noticed while a real game was being scored, to be decided on and then
executed **together, in one pass** rather than one at a time. Nothing here is
agreed yet unless it says so.

Opened 27 August 2026, during the first weekend two tenants ran live games.

---

## Agreed — to build

### 8. Drop the previous-drive tile, replace with four series tiles

**Decided**, mocked and approved 27 Aug. The previous-drive card goes; four
tiles take the space, all read from the current series:

| Tile | Shows |
| --- | --- |
| Long pass | yards, then the receiver's name |
| Long rush | yards, then the carrier's name |
| Penalties | BOTH teams, one row each: team, count, yards |
| Sacks | count, then yards lost |

**The number and the name share a baseline**, 40pt against 21pt. Stacked,
the right half of every tile sat empty; on one line the tile fills its
width.

**Penalties list both teams** because 2-15 against your own defence and
against theirs are different facts, and a crew reads them differently. The
two rows also keep that tile looking populated when the count is zero,
which takes the first-play-of-a-series state from four empty tiles down to
two.

**Every tile is 110px**, so nothing jumps as the numbers change. Names
truncate rather than wrap, which is what holds the height. Tested against
"Ouachita Robicheaux" and "Ouachita Christian" at 760, 900 and 1100px wide
-- nothing clipped at any of them.

**No new data.** All four derive from plays already in the log; the crew
view has drive boundaries from `findDriveStarts`, so "this series" is the
plays since the current drive began.

The situation line stays at its current 24px. Noted while mocking: the play
line above it renders at 20px, so the situation line is already the larger
of the two and the hierarchy is inverted. Left alone for now -- if it ever
reads wrong on air, the fix is probably to lift the play line rather than
to shrink this one.

Mock: `series_tiles.html`.

---



*(add here as they come up)*

---

---

## Under discussion

### 1. Player identity is frozen at entry

`roles` stores a player's name as it read when the play was entered, and the
box score keys off that stored name. Correcting a roster spelling afterwards
therefore splits one player into two rows in the season report — the games
before the correction under the old spelling, the games after under the new.

The same mechanism protects history: a graduated player's stats are not
rewritten when a sophomore takes his number the following year.

**Proposed:** key on the jersey number and resolve the name at render time
*when that number still maps to someone on that season's roster*, falling
back to the stored name when it does not. Corrections self-heal; graduated
players keep their names. Also fixes the case where the wrong number was
picked during entry, which is the same failure from a different direction.

Touches the bucket keying in `engine.js`. Needs a test across a season where
a number is reused.

**Not decided:** whether to do this, or the cheaper pair below.

- Warn on the roster page when renaming a player who already has plays this
  season, and offer to apply the correction to existing plays.
- Flag near-duplicate rows in the season report — names one or two edits
  apart, or sharing a jersey number.

The cheap pair turns a support call into a self-serve action. The structural
fix means there is no call.

---

### 2. No tackler credit on any kicking tree

Guided kickoff, kickoff and punt offer no **Tackled by**. A cover tackle is
often the most notable thing a special-teams player does all night and
cannot be credited at all.

The UI half is easy and was written on 27 Aug, then reverted: `defBlock`
drops straight into the kickoff and punt trees, and the guided kickoff needs
its own picker because `defBlock` lives inside `renderPlayPanel` and is not
in scope there. It sits below the return calculator and above the ending
spot, matching the order the play is described in.

**Why it was held.** The credit would go nowhere. `TACKLE_TYPES` in
`engine.js` is `['rush', 'pass', 'sack']` — the engine does not credit a
tackle on a kicking play at all. A scorer would fill the field in and see
nothing appear, which is worse than not offering it.

Making it count means adding `kickoff`, `punt` and `kickoff_return` to
`TACKLE_TYPES`, and that runs into two things:

- **The guided kickoff already writes the RETURNER into the `defense`
  slot** (`game.html`, in the `kickoff_return` roles). It is inert today
  because the engine ignores `defense` on that play type. Add
  `kickoff_return` to `TACKLE_TYPES` and every returner in every past game
  is suddenly credited with a tackle, on the receiving team, against
  himself.
- **Those roles are already saved.** Fixing the code stops it happening
  again; it does not clean up what is stored. Existing guided-kickoff rows
  would need a migration or would stay wrong.

**Order of work, when it happens:**

1. Fix the returner-in-`defense` slot in the guided kickoff roles.
2. Decide whether to migrate existing rows, or accept that games already
   played carry it.
3. Add the three types to `TACKLE_TYPES`.
4. Then the UI, which is the easy part and should go last.

Also worth checking at the same time: whether a special-teams tackle should
appear in the defensive table or a special-teams one, and whether the
box-score auditor needs the same three types added — it currently mirrors
`TACKLE_TYPES` exactly, and the sweep on 27 Aug found five faults in it, so
it should be re-swept after any change here.

---

### 3. Game flow preferences — what a tenant tracks

**Decided.** Individual tackle credits become a setting with three states:
`none` / `ours` / `both`. Stored as text, not two booleans that can
contradict each other.

Time of possession is **not** a setting. Always tracked.

**Team defensive statistics are unaffected by this.** Interceptions, sacks
and fumble recoveries already fall to the TEAM row when no defender is
named, and team tackles for loss now do the same (fixed 27 Aug). So turning
individual credits off for the opponent leaves every team number intact.

`teamA` is always our team, so the rule at entry is one condition: show the
tackled-by block only when the defending team is `teamA`. That holds on
every tree including kick coverage, where the tacklers are the kicking team.

**Where it lives.** No new page.

- **Customize team** — the tenant default, in a new section below the
  colours. Colours are the visual half of setup; this is the operational
  half.
- **New game** — a per-game override, beside quarter length and the
  preseason checkbox, prefilled from the tenant default.

**The per-game value is COPIED at creation, not read live from the tenant.**
A school that changes its default in October must not have games already
played reinterpreted — otherwise a report reads a blank as "missed" when it
meant "not tracked". Impossible to retrofit cleanly, so it has to be right
in the migration.

**Secondary benefit:** with `ours`, the opponent's defensive roster is not
needed at all, which is the fiddliest part of game setup and the most likely
to be wrong.

**Open:** how a report shows an untracked opponent — it cannot be zeros,
which reads as "they made no tackles".

---

### 4. Time of possession — making the live number trustworthy

TOP is displayed live and goes to air, so checks have to be at entry. A
post-game audit is too late.

**Decided.**

- **A backwards or negative time check at entry.** Time cannot run backwards
  within a game. Warn rather than block: a correction to an earlier mistaken
  entry is legitimate.
- **A possession-complete view, always available**, showing that drive's
  total time with the start and end correctable there and then.
- **Prefill the clock on every kickoff, not just a touchback**, editable,
  with text suggesting the prefilled value is usually right.
- **Start of a half prefills the quarter length**, not the last value from
  the previous period.
- **Quarter markers carry no possession change** and no time attribution.
  They are markers only.

**Why the kickoff prefill is correct in general.** The clock stops on a
score, does not run during a try, and restarts only when the ball is legally
touched by the receiving team. So the clock at the catch IS the clock at the
previous stoppage. The touchback prefill was never a special case -- it was
the general case, noticed first.

That also removes the entry that was causing the trouble. Every clock prompt
in the app says only "Clock", which everywhere else means *after the play*.
On a kickoff it has to mean *when the ball was fielded* -- the one place the
natural reading is wrong, and the rule lives in the help file rather than at
the point of entry. Prefilling removes the question instead of relabelling
it.

**Prefill source:** the last clock event **in the current quarter**. If
there is none, the quarter length. That gives the opening kickoff 12:00, a
second-half kickoff 12:00, and a kickoff after a mid-quarter score the clock
at that score.

**The accounting hole this closes.** A kickoff writes a `start` event for
the receiving team at whatever clock is entered. Enter the catch time and
the return's seconds fall inside their possession, correctly. Enter the
tackle time and those seconds fall *before* the start and are attributed to
nobody.

**The clock on every change of possession names the moment.** Verified 27
Aug: a punt writes a `transition` -- one clock value that both ends the
kicking team's possession and starts the receiving team's. Interceptions and
fumble recoveries use the same mechanism. In all three, possession changes
PARTWAY THROUGH the play, not at the whistle:

| Tree | Possession changes at |
| --- | --- |
| Punt or kickoff returned | the catch |
| Interception returned | the interception |
| Fumble returned | the recovery |
| Turnover on downs | the whistle -- the same as the play's end |

Only the last matches the natural reading of "Clock". On the other three,
entering the clock after the play hands the whole return to the team that
just lost the ball.

So the prompt names the moment, per tree, from one rule -- *the clock when
possession changed*:

- punt: "when the punt was fielded"
- kickoff: "when the ball was fielded"
- interception: "when the ball was intercepted"
- fumble: "when it was recovered"

Same sentence, same underlying rule, and it reads as a fact about football
rather than a quirk of the app. A punt-only note would fix a quarter of the
problem and leave interception and fumble returns wrong in exactly the same
way.

The possession view then double-checks it: "Red Stick: fielded at 11:52 to
7:23 = 4:29" shows a scorer who entered the tackle time a drive that is too
short, and lets them fix it there. The label and the verification reinforce
each other rather than the label carrying the whole burden.

**Also worth doing:**

- `possessionTime[team] += Math.max(0, absSec - pendingClockStart[team])`
  silently contributes **zero** for a negative delta. A bad entry produces a
  short drive rather than a loud error. Count what the clamp swallows and
  report it.
- **The partition check.** TOP(us) + TOP(them) must equal elapsed game time,
  because every second belongs to exactly one team. Run it after every clock
  entry, not at finalize: the moment a gap opens, the entry that caused it
  is the one just made. Reported as "1:20 of game time is not attributed to
  either team".

**Open:**

- Whether the possession view interrupts every time or only on a failed
  check. A possession changes 20-25 times a game, and everything else this
  session has been about removing taps.
- Whether a punt should be prefilled as well. It cannot be: the clock is
  RUNNING before a punt, so real time passes between the snap and the catch
  and the value is not derivable. A kickoff is prefillable only because the
  clock is stopped beforehand. Punts get the note instead.

---

## Raised, not yet discussed

### 5. Scorebug overlay — drop the Q1 version, adjust the score-only one

The full scoreboard with the quarter panel goes entirely. The score-only
version stays but needs work; what specifically is not yet settled.

Both were rebuilt on 27 Aug -- equal columns, scores outboard, identity
centred, two digits reserved. Whatever the adjustment turns out to be, it
lands on top of that rather than starting again.

**Open:** what the adjustment is.

---

### 6. Edit a play in place, after a game is finalized

Today a wrong play can be deleted and re-entered, which puts it back at the
end of the log with the order wrong even when the totals come right. A
finalized game has no correction path at all short of that.

Worth noting alongside: `roles` is stored as jsonb and read back verbatim,
so an edit means rewriting that column on one play row. Nothing re-derives
it. The 27 Aug bad-snap fault is a live example -- a play already saved
keeps its old shape and the only fixes are delete-and-re-enter or SQL.

**Open:** whether editing is restricted to a finalized game or offered
throughout; whether it re-runs the checks; whether it is admin-only.

---

### 7. A second crew view: scoring summary, large, one page

A separate view page showing the scoring summary at a size a camera can
read, scaled to fit on one screen with no scrolling.

The existing crew view already switches its top-right quad to a scoring
summary at halftime and at the final whistle, so the content exists -- this
is a different presentation of it, not a new calculation.

Note: the crew view scales a fixed 1920x1080 `.wrap` to the viewport. A
second page should do the same rather than inventing its own sizing, or the
two will drift apart on the same monitor.

**Open:** whether it replaces the halftime behaviour on the main crew view or
sits beside it as its own URL.

## Notes

- A play already saved keeps its stored `roles` verbatim. Nothing re-derives
  them on load, so any fix here is forward-looking unless paired with a
  migration over existing rows.
- Verified 27 Aug: changing a stored `playType` moves only the box score and
  turnover count. Down, distance, possession, field position, score, drive
  starts and possession counts all read `effect`, not `roles`.
