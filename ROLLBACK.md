# StatChat — rollback procedure

**Print this. Keep a copy in the booth.**
Written for someone who is not the developer, at 7pm on a Friday.

---

## Symptoms that call for a rollback

- The game page will not load, or loads blank
- Plays are not saving, or are saving wrong
- The view page or the vMix overlay shows numbers that disagree with the
  game page

**Not** a rollback: a single play entered incorrectly (use Undo), or a
graphic in the wrong position in vMix (that is a vMix setting).

---

## Option 1 — Vercel instant rollback  (FASTEST, try this first)

Roughly 30 seconds. Nothing is lost — game data lives in Supabase, not in
the deployment.

1. Go to **vercel.com** and sign in
2. Open the **statchat** project
3. Click **Deployments**
4. Find the deployment marked below as the last known good one
5. Click the **⋯** menu on that row → **Promote to Production**
6. Confirm, then hard-refresh the game page (Ctrl-Shift-R)

### Last known good deployment  —  TRY THIS FIRST

**Direct link — click it, it lands on the right row:**

https://vercel.com/andy-martin-fitness/statchat/CTyiMXvnfC2c7FBnQCkWbyHWQTdi

> **Deployment id:** `CTyiMXvnfC2c7FBnQCkWbyHWQTdi`
> **Tag:** `v1.1-consolidated`
> **Date:** 12 August 2026
> **Verified on this build:** 18 suites · fuzzer (40 games, 1,568 plays)
> · 3 NFL weeks (48 games, 6,977 plays, 0 issues) · all six pages clean
> in a real browser · rush entry, view and recap checked by hand

### Second fallback — one step further back

If v1.1 is itself the problem, go back to the state before the engine
was consolidated into `engine.js`:

https://vercel.com/andy-martin-fitness/statchat/4jat5dUzYBEoFe1maKPf6P9asrqN

> **Deployment id:** `4jat5dUzYBEoFe1maKPf6P9asrqN`
> **Tag:** `v1.0-preseason`
> **Date:** 10 August 2026
> **Verified on this build:** 18 suites · fuzzer · 3 NFL weeks, 0 issues

Both are fully verified builds. v1.1 is newer and preferred; v1.0 exists
because a fault could have been introduced BEFORE the consolidation, in
which case rolling back to v1.1 would not help.

**Keep this current.** Every time a new version is verified and promoted,
move v1.1 down to the second slot and put the new one on top. A stale
entry here is worse than none — it sends someone confidently back to the
wrong build.

---

## Option 2 — Restore the tagged snapshot  (if Vercel rollback is not enough)

1. Go to **github.com/HUNTERGAMES69/statchat**
2. Click **Releases**
3. Open **`v1.1-consolidated`** (or `v1.0-preseason` for the older one)
4. **Download the source ZIP**
5. Upload those files over the current ones, replacing them
6. Vercel redeploys automatically; wait for it to go green

Slower — several minutes — but it restores a state that was fully
verified.

---

## What a rollback does NOT undo

**Game data is not affected.** Plays, rosters and games live in Supabase
and are untouched by either option. Rolling back the code does not lose a
single play.

If the DATA is wrong rather than the app, do not roll back — use **Unlock
to edit** on the game page to correct plays.

---

## If the app is unavailable at kickoff

1. Record the game on paper
2. Enter it afterwards — the app does not need to be live during a game
3. The vMix overlay will show nothing; run the broadcast without it

---

## Who to call

Andy — he built it and he is the one entering plays.

If Andy is the one with the problem, the app is not required to run the
game: record on paper and enter it afterwards. Nothing is lost by playing
a game without StatChat live.

---

## What "known good" means

Both tagged snapshots passed, on the day each was tagged:

- 18 automated suites
- The property fuzzer: 40 games, 1,568 generated plays, zero findings
- Three full NFL weeks replayed through the real UI:
  **48 games, 6,977 plays, 4,787 state-progression pairs, ZERO issues**
- (v1.1 additionally) all six pages opened in a real browser with zero
  console errors, and rush entry / view / recap checked by hand

That is the bar any future release must also clear. **Nothing gets
promoted to production without all of it green.**
