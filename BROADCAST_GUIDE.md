# StatChat broadcast feed — production guide

**For the production team.** How to get live scores and stats out of
StatChat and into your graphics.

You do not need a StatChat account to use the feed. You need one web
address per graphic, and those addresses never change.

---

## What this is

StatChat publishes the live game as data at a web address. Your software
polls it every second or two and updates the text in your own titles. You
design the graphics; StatChat supplies the numbers.

Nothing is installed and nothing "connects". Your software simply
re-reads a small file, the way a browser reloads a page.

---

## The addresses

Ask Andy for the **Broadcast setup** link. It lists every address with a
copy button, and shows which game is currently on air.

Each looks like this:

```
https://nevillestatchat.vercel.app/api/feed?view=score&format=xml&key=...
```

Only `view=` changes between them:

| view | One row? | What you get |
|---|---|---|
| `score` | 1 row | Score, quarter, down & distance, ball on, possession, timeouts |
| `drive` | 1 row | Plays, yards, time of possession on the drive in progress |
| `lastplay` | 1 row | The text of the most recent play |
| `teamstats` | 2 rows | One per team: yards, first downs, third downs, turnovers |
| `rushing` | one per player | Attempts, yards, longest, touchdowns |
| `passing` | one per player | Completions, attempts, yards, touchdowns, interceptions |
| `receiving` | one per player | Targets, catches, yards, touchdowns |
| `defense` | one per player | Tackles, sacks, interceptions, fumble recoveries |

Add `&format=json` instead of `xml` if your software prefers JSON.

**The player feeds are sorted best first**, so a "leading rusher" graphic
can simply use row 1.

---

## Setting it up in vMix

1. **Add Input → Data Sources → XML**
2. Paste the address
3. **Set the refresh interval to 1–2 seconds** — bottom right of the
   dialog
4. Build or open your title, then map each column onto a text field

Repeat per graphic. A data source returns a table; a title shows one row.

### The one setting people forget

**The refresh interval.** A data source that fetches once looks exactly
like a frozen feed — the graphic appears, the numbers are right at
first, and then nothing ever changes. If a graphic goes stale mid-game,
check this before anything else.

---

## Other software

The feed is a plain web address returning XML or JSON, so anything that
can poll a URL will read it.

- **OBS** — browser source, or a script polling the JSON
- **Singular.live** — JSON data source
- **CasparCG** — XML, or a template fed from it
- **Wirecast** — JSON

Nothing about the feed is vMix-specific.

---

## A ready-made overlay

If you would rather not build graphics, there is a finished transparent
scoreboard:

```
https://nevillestatchat.vercel.app/broadcast.html
```

Add it as a **web browser input at 1920×1080**. The background is
transparent, so it keys straight over the programme feed. Add
`?layout=bug` for score only.

The trade-off: you cannot restyle it, and the numbers are not available
to your other graphics — your software receives a picture, not data.

---

## Which game does the feed show?

Whichever game is set **ON AIR** in StatChat. That is why the address
never changes — it follows the flag rather than naming a game.

Andy or a scorer sets this, and it can be done the day before. The
Broadcast setup page shows what is on air at any moment.

**If no game is flagged**, the feed falls back to the most recent game in
progress. That is usually right, but it is a guess — worth confirming
before kickoff rather than during.

---

## Things worth knowing before game night

**The feed is only as live as the entry.** If the scorer is three plays
behind, so are your graphics. Nothing at your end can fix that.

**Undo reaches you within a couple of seconds.** When a scorer corrects a
mistake, your graphics correct themselves. No need to work around a wrong
play.

**The feed shows the flagged game whatever its state.** A finished game
shows its final score; one that has not started shows 0–0. Neither is a
fault — but check the right game is flagged.

**Every response carries an `updated` timestamp.** If you want a graphic
that hides itself when the feed goes stale, that is the field to use.

---

## If the graphics stop updating

**1. Open a feed address in a browser.**

Shows current data → the feed is fine, the problem is at your end. Go to
step 2.

Says `No game is on air` → nothing is flagged and no game is in
progress. Ask for a game to be set ON AIR.

Will not load at all → tell Andy; that is a StatChat problem.

**2. Check the refresh interval is set.** This is the usual cause.

**3. Check the graphic is reading the right feed.** Each one has its own
address; a scoreboard bound to the rushing feed will look empty rather
than wrong.

**4. Re-copy the address.** A truncated one often still returns
something, which makes the fault hard to see.

---

## Between seasons

Nothing to redo. The addresses do not change, so last season's setup
still works. Someone flags the first game of the new season and your
graphics follow.

---

## Who to ask

Andy — he built StatChat and enters the plays. If the feed is showing
data and the graphics are not, the problem is almost certainly in the
broadcast software rather than in StatChat, and the browser check above
will tell you which.
