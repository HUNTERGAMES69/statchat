# StatChat — session handoff, 22 August 2026

## The headline: the rail layout is now the live entry page

`gametest3.html`'s rail prototype was promoted into `game.html`. The URL did
not change — `dashboard.html` still navigates to `game.html?id=`, so
bookmarks, open tabs and deep links keep working.

`game_legacy.html` is the fallback: the previous entry page, verbatim, with
a banner at the top saying so. It **replaced** an older `game_legacy.html`
that predated the keypad and carried none of the recent fixes — a fallback
that can itself deadlock is not a fallback. The older file is in git
history.

**`gametest3.html` should be deleted from the repo.** It is now a
byte-level duplicate of `game.html` and will drift the moment either is
edited. Tracked in `TODO.md`.

---

## What the entry page looks like now

- **Ladder** in a fixed left column. Every tree opens beside it and locks
  to the top of the frame, so the panel never moves depending on which
  button was pressed. Nothing open reads "Make a selection to begin".
- **Left margin** holds the current drive with Undo/Redo.
- **Right margin** holds two new panels: **Checks** (live `validateGame`,
  debounced 400 ms because it is quadratic in play count) and **Live
  totals** (both teams' figures, per-team leaders, team defence).
- **Top row**: Dashboard, ON AIR, BROADCAST SETUP, HELP!, CREW VIEW — all
  sized from the banner so the five blocks across the top match.
- **Review** collapses the tree to just the confirm box; **Edit** restores
  it with values intact. There is a Clear on the confirm box and another on
  the phase row.
- Kicker and punter collapse to one name plus `+N more`; the passer folds
  to a chip once picked. No suggestion prefills a manual box any more — the
  highlight says who is suggested.
- Long picker lists (carrier, receiver, kicker, punter) run full width with
  the `or type #` box at the end rather than in a reserved column.

## Spectator and broadcast

- `view.html`: halftime ends on "Start 2nd half" rather than on the
  kickoff; the scoring summary takes the quad at halftime and reads GAME
  FINAL at the end; the second-half kicker is named under it; play text
  breaks at its own clauses; the down line uses **team names** rather than
  own/opp.
- **New**: `broadcast_stats.html` — team stats plus leaders, landscape and
  `?layout=portrait`, with the Nettech sponsor bar. Needs
  `sponsor_nettech_white.png` in the repo root.

## Engine and correctness fixes this session

- Guided kickoff **return touchdown deadlock**: `awaitingKickoff` and
  `awaitingTry` could both fire, disabling every play type. Resolved in
  favour of the try.
- **Quarter boundary off-by-one**: 0:00 at the end of a quarter read as
  12:00 of the next one, so a finalized game reported "12:00 (Q5)" and
  invented an overtime. Applied at every quarter end, not just the last.
- Undo now removes a **stranded Q3 marker** so `game.html` and `view.html`
  cannot disagree about halftime.
- Penalties show in the Current Drive tile whoever they were called on.
- Bad snap recovered by the defence says "fumble"; an incompletion reads
  "pass incomplete".
- Flip possession asks first.
- Clear now closes the manual entry panel, which it never did.

---

## Not yet done

**Return stats.** Agreed and scoped, not started. `roles` does not persist
return yardage — it exists only inside the play text — so that is the
blocker and the first step. Then count it in `computeBoxScore`, then
display in recap, stat package, season report, view, and a leader overlay.
Andy's calls: kickoff and punt returns **combined**, and **yes** to the
broadcast overlay. History will not backfill.

**Roster quick reference** — discussed, not designed.

**Duplicate surnames.** Picker buttons show surname only, so two players
with the same surname read alike at a glance. Worth checking the real
roster before the beta.

---

## Resuming

Pull from `raw.githubusercontent.com/HUNTERGAMES69/statchat/main/` first —
do not assume the working copy is current.

**Do not run `tests/mutation_check.js` unless it can finish.** It
deliberately breaks source files and restores them at the end; an
interrupted run leaves `game.html` broken. This happened once this session
and the stranded mutant looked like a real engine bug.
