# StatChat — session handoff, 20 August 2026

This file exists because a chat filled up mid-flight. It records what was
in progress at the moment it ended, so the next session resumes rather
than restarts.

`PROJECT_NOTES.md` holds the durable reasoning and `TODO.md` the work
list. **This file is different: it is the state of things that were still
moving.** Once the open decisions below are settled, fold anything worth
keeping into those two and delete this.

**The previous version of this file (17-19 August) has been folded in and
replaced, not appended to.** Everything durable from those sessions —
the fumble-entry fix, the picker bugs, the attribution-chain audit, the
guided kickoff work — is already in `PROJECT_NOTES.md`'s own dated
entries and `TODO.md`'s "Shipped" / dated-session sections. Nothing below
duplicates it. If something from an earlier session seems to be missing
here, it is because it already has a permanent home elsewhere and this
file no longer needs to carry it.

---

## Where things stand

Everything from tonight's session is deployed. All 40 test suites pass,
plus the golden snapshot (50/50 paths) and all five fuzzers, run fresh
at the end of the session rather than trusted from earlier in it.

### Season-scoped rosters — the big piece, done and verified

Requested directly: retain past seasons' rosters instead of losing them
to "Clear roster." Built as a real schema change, not a workaround —
`players` gained a `season_year` column.

- `roster.html`: a season picker; the current season fully editable,
  every other season fully read-only (no controls rendered at all, by
  Andy's explicit decision — not merely disabled ones). "Clear roster"
  rescoped to only ever touch the currently-viewed season, with its
  existing unlink-before-delete safety step preserved exactly, just
  correctly scoped now. Upload's duplicate-name check is scoped to the
  current season only, so a returning player is never silently skipped
  because his name matches someone from a past year.
- `create_game.html`: "our roster" now resolves against **that specific
  game's own** `season_year`, not whichever season is current today —
  the piece that actually protects an old game from being silently
  corrupted by a later season's roster if it is ever reopened to fix an
  unrelated field. See `PROJECT_NOTES.md`'s dated entry for the full
  reasoning and the risk this closes.
- Explicitly declined, confirmed with Andy: no retroactive additions to
  a past season, no "copy last season's roster forward."
- Verified by deliberately breaking the two highest-stakes lines (the
  Clear Roster delete's season scope, and `create_game.html`'s season
  filter) and confirming the new tests caught each specific break before
  restoring. `tests/season_scoped_roster_check.js` is new; required
  extending `tests/harness.js` with real `players`-table support and a
  generic `.in()` method, neither of which existed before (`roster.html`
  had never been exercised by this harness at all until this feature).

### Preseason game exclusion — done and verified

A checkbox at game setup, `is_preseason`, excludes a game from
`season_report.html` and `player_report.html` while leaving its own
recap and stat package untouched. Dashboard shows a PRESEASON tag.
Required extending `tests/harness.js` with a real (not no-op) `.or()`
implementation, since the exclusion filter has to treat `NULL` and
`false` as the same thing — every game that existed before this column
did is `NULL`, not `false`, and `NULL = false` is itself `NULL` in SQL,
not `true`. Both migrations (`is_preseason`, `players.season_year`)
are documented in the chat, not committed to the repo as `.sql` files —
`sql/schema.sql` is still the standing gap noted in `TODO.md` section
19; both new columns should be added to it whenever that gap is closed.

### Sack-fumble defense credit — done, in eight places

A sack that also produced a fumble recovered by the defense recorded
the fumble but not the sack. Fixed in `engine.js`, then found
independently un-fixed in seven more places across five files
(`view.html`, `broadcast.html`, `stat_package.html`,
`season_report.html`) that each reimplement "count sacks from the play
log" by hand instead of sharing the engine's logic. Full account in
`PROJECT_NOTES.md` — it is the same "one blind spot in many places"
lesson from 19 August, recurring with a different field.

### Smaller fixes, all shipped and tested this session

- **Opponent roster reload on edit.** Reopening an existing game's
  setup showed every seeded starter as "not on the roster loaded here,"
  even when the roster was genuinely still saved — the edit-load path
  only ever fetched a *count* of the opponent's saved roster, never the
  actual data `oppResolved` needs. Fixed in `create_game.html`.
- **Needs-assignment resolution now updates the starter seed live.**
  Assigning a unit to a player whose position wasn't recognized on
  import already fixed the underlying data immediately; the "not on the
  roster" message already on screen just never refreshed until
  something unrelated triggered a re-render. One added call closes it.
- **Dashboard game-ID column** was 28px wide with no overflow handling,
  so a longer designator visually overlapped the opponent name.
  Widened with ellipsis on desktop; removed entirely on mobile rather
  than truncated, since a CSS width-based character cutoff isn't exact.
- Sterlington roster (94 players, no positions) generated as an
  importable `.xlsx`; the import-time behavior of an unpositioned
  roster with seeded starters was traced and confirmed directly against
  the actual resolution code before delivering it, not assumed.

---

## Not yet done — a genuinely open decision, unchanged from prior sessions

**The `game.html` input-method prototype decision (keypad vs field
strip vs tap-the-field) is still open and was not touched this
session.** `gametest.html`, `gametest2.html`, `gametest3.html` remain
untouched, three-way comparisons awaiting a full-game rehearsal on each.
See `TODO.md`'s "Input prototypes" entry for the specifics — launchers
attached at runtime by a `MutationObserver`, the keypad committing only
on Done, the shared keypad/keyboard buffer, `inputmode="none"`'s Safari
risk in `gametest3`. Nothing here has changed since it was last written
up; it is repeated in this handoff only so the next session does not
have to go hunting for which file has the answer.

---

## Resuming

The repo is the source of truth, and the code carries its own reasoning
in comments. Start by reading `TODO.md` and `PROJECT_NOTES.md`, then
this file, then pull the current files from
`raw.githubusercontent.com/HUNTERGAMES69/statchat/main/` — GitHub can
lag behind Andy's local copies if an upload was skipped, so verify
against what he last downloaded rather than assuming.

**Two SQL migrations exist only as the commands given directly to Andy
in chat, not as committed files:** `players.season_year` and
`games.is_preseason`. If `sql/schema.sql` is ever built (`TODO.md`
section 19, still outstanding), both belong in it.
