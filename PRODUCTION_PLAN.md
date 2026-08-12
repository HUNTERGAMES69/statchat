# StatChat — Production Readiness Plan

**Target: first real game, ~Friday 24 August 2026.**
Drafted 10 August 2026. **Status: APPROVED 10 August 2026. Phase 1 in progress.**

---

## 1. What we are agreeing to

Three criteria, in Andy's words:

1. **Protect a fallback point.** Nothing done to get production-ready may
   cause a regression or lose traction.
2. **Data integrity above all.** Do everything possible to avoid
   corruption or an in-game failure.
3. **vMix integration via a DATA SOURCE** (JSON/XML), with all game and
   view data available, without authentication.

**Standing instruction:** every check must be clear before shipping. Not
"probably fine". The full suite, the fuzzer, and three NFL weeks all
green and verified, every time.

### Explicitly out of scope for this release

- Two simultaneous scorers. **One scorer.**
- Two-factor authentication (comes after RLS, not before the season).
- Individual tackler stats, the roster-edit-during-a-game feature, and
  everything else in TODO not named below.

---

## 2. Where we are starting from

Worth stating plainly, because it is what makes this schedule realistic.

| | |
|---|---|
| Automated suites | 19, all passing |
| Property fuzzer | clean, ~1,500 generated plays |
| Real NFL games replayed | 48, across three weeks |
| Plays validated against an independent source | 6,977 |
| State-progression pairs checked | 4,787 |
| Mismatches | 0 |

The engine is well evidenced. **The gaps are everywhere else**: security,
offline behaviour, exports, realtime, and the fact that nobody has run a
game on the actual hardware yet.

---

## 3. Timeline

| Phase | Days | What |
|---|---|---|
| 1. Freeze the fallback | 1 | Tag, deployment id, rollback page |
| 2a. Engine consolidation | 2–4 | One `engine.js`, hard abort at day 4 |
| 2b. Data integrity | 2–6 | RLS, export, offline queue, phase derivation |
| 3. vMix feed | 4–10 | `api/feed.js`, broadcast toggle, eight views |
| 4. Rehearsal | 11–12 | Full scrimmage on real hardware and wifi |
| 4b. Per-player tackles | 12–13 | Last build work; droppable |
| 5. Freeze | 13–14 | No changes except rollback |

Phases 2a and 2b overlap; 3 begins once the engine is settled.

---

## PHASE 1 — Freeze the fallback (day 1, ~1 hour)

Everything after this is reversible. Do it first, do it properly.

**CERTIFIED 10 Aug 2026 — every check clear before tagging:**
18 suites pass · fuzzer clean (40 games, 1,568 plays, 0 findings) ·
three NFL weeks CLEAN (48 games, 6,977 plays, 4,787 state pairs, 0 issues).

- [ ] GitHub **release tag** `v1.0-preseason`, with a note saying what it
      is and why. **Tag only after the 12 outstanding files are uploaded**
      — a tag of a half-uploaded repo is worse than no tag.
- [ ] Record the current **Vercel deployment id**, written down where the
      crew can find it — so "promote this one" is a known target rather
      than a hunt under pressure.
- [x] **Rollback procedure** written: `ROLLBACK.md`. Two routes (Vercel
      promote, then the tagged ZIP), what a rollback does NOT undo, the
      paper fallback, and blanks for the deployment id and on-call name.
- [ ] Fill in the deployment id and on-call name, then **print it**. Nobody
      reads source at 7pm on a Friday. It must say: how to promote the
      previous Vercel deploy, how to restore the tag, and who to call.

**Exit criteria:** someone other than the developer can roll back using
only the printed page.

---

## PHASE 2a — Engine consolidation (days 2–4)

### Why this is in the plan rather than deferred

My first instinct was to avoid it — a five-file refactor two weeks out
looks like exactly the risk criterion 1 rules out. Andy pushed back, and
on the evidence he was right.

- **Drift has already happened, twice.** PROJECT_NOTES records possession
  counting diverging between copies and producing different numbers on
  different pages. `engine_parity.js` exists solely to detect this — a
  suite whose entire job is catching drift that should be impossible.
- **On 10 August alone, four engine changes each touched four or five
  files — and one was missed.** The `newPossession` check did not reach
  `view.html`, a drive tile silently failed to split, and it cost a
  debugging round trip. That was a calm day with the full suite
  available. In-season, at 6:30 on a Friday, it is worse.
- **The failure mode is the worst kind for broadcast:** two pages showing
  different numbers, both plausible, with no way to tell which is right
  without reading code.
- **70% of `view.html` is engine** — 1,003 of 1,431 script lines. Roughly
  4,000 duplicated lines across five files.
- **The vMix feed needs a server-side engine regardless.** Without this
  we generate a seventh copy. The real choice is one copy or seven.

### Why it is safe to do now

**Measured before deciding:** all five copies are currently
byte-identical for `computeState`, `computeBoxScore`, `findDriveStarts`,
`countPossessions`, `rosterName` and `playerName`.

That matters more than anything else here. The failure I feared was a
silent behaviour change — five variants, consolidation picks a winner,
some page quietly behaves differently. **There are no variants.** This is
pure deduplication: the same bytes loaded from one place instead of five.

### The work

- [ ] Extract to `engine.js` with the dual export, so browsers and Node
      load the same file.
- [ ] Replace the inline copies in `game.html`, `view.html`, `recap.html`,
      `stat_package.html`, `season_report.html` with `<script src>`.
- [ ] Regenerate `broadcast.html` against the shared engine and delete
      the generator's duplication.
- [x] Retired `engine_parity.js` — left as a passing no-op with an
      explanation rather than deleted, so anyone running it by name gets
      a reason instead of a missing-file error.

**What actually changed:** 13 functions, 501 lines, extracted to
`engine.js` and removed from five pages (58 removals in total). The
engine set was determined by MEASUREMENT, not judgement — only functions
that were top-level AND byte-identical across all four report pages were
moved. `bucket` and `keyFor` were correctly left behind: they are nested
inside `computeBoxScore` and extracting them would have broken the
closure. `buildTeams`, `init` and `showView` stayed because they
legitimately differ per page.

Two tests needed updating, both scraping rather than logic:
`drive_boundary_check` pulled `findDriveStarts` out of the page HTML,
and the harness had to inline `engine.js` the way a browser fetches it.

### The one real risk

**Script load order.** If `engine.js` loads after inline code that uses
it, the page breaks. It breaks *loudly* — but jsdom is more forgiving
than a browser, so the suite may not see it.

- [x] **Opened all six pages in a real browser, 12 Aug 2026 — clean.**
      This is not optional and cannot be delegated to the test suite.

### Acceptance — ALL of it

- [ ] 19 suites pass
- [ ] Fuzzer clean over 60 games
- [ ] Three NFL weeks: 48 games, 6,977 plays, **zero** issues
- [ ] `broadcast.html` still renders
- [x] All six pages clean in a real browser, 12 Aug 2026: dashboard,
      game, view, recap, stat_package, season_report — ZERO errors on
      every one. No `engine.js` failure, no `is not defined`. This was
      the one check the suite could not make, because jsdom is more
      forgiving about script load order than Chrome is.
      Only pre-existing warnings remain, none related to the
      consolidation: a missing favicon, Supabase's "multiple
      GoTrueClient instances" notice (which states outright it is not
      an error), and Apple's renamed meta tag.

### Hard abort

- [ ] **Not green by end of day 4 → revert to the tag** and fall back to
      generating `api/_engine.js` for the feed instead. Three days lost,
      ten still in hand.

This clause is what makes doing it in-window defensible rather than brave.

---

## PHASE 2b — Data integrity (days 2–6, parallel)

Ranked by what can actually ruin a game night.

### Highest value: RLS role enforcement

- [x] **DONE 12 Aug 2026.** Every table is role-aware; a final check for
      any surviving `auth.role()` policy returns ZERO rows. Verified at
      the API in a browser console, not just through the UI: a `view`
      account's INSERT is refused outright, and a `game_entry` DELETE
      against a real game id removed 0 rows.
      See `sql/rls_hardening.sql` for what was run and why.

      Two things the draft got wrong, both caught by listing the real
      state first: the drops used invented policy names and would have
      silently done nothing, and it rewrote `profiles`, which was already
      correct and was the one step that could have locked the only admin
      out.
- [x] `current_user_role()` written, SECURITY DEFINER, falling back to
      `view` so a failed lookup loses access rather than granting it.
- [x] Role-aware policies on plays, games, game_rosters, players, teams.
      **Scorers keep DELETE on plays** — Undo is a delete, and admin-only
      would have broken it mid-game.
- [x] Confirmed: `profiles_role_guard` blocks role changes by non-admins.
      It does NOT stop an admin demoting themselves — logged in TODO, and
      a second admin account was created as mitigation.

**Do this even if everything else slips.** It is the only item that can
lose data permanently.

### The rest

- [x] **Export a game to JSON — DONE 12 Aug 2026.** "Download backup" on
      each dashboard row: the game row, its rosters and every play,
      exactly as stored. **Admin and scorers only** — Andy's rule: a
      `view` account views. Exporting is technically a read, but a backup
      is the whole game in one file, and "view" should not mean "can walk
      off with everything". Scorers keep it because they are the ones at
      the stadium when something looks wrong.
      Covered by `tests/game_export_check.js`, mutation-tested including
      a check that removing the role gate fails the suite.
- [x] **Automated test written 12 Aug 2026** —
      `tests/offline_queue_check.js`, six scenarios, mutation-tested.
      The queue turned out to be genuinely well built: dedup against
      server state before pushing, duplicate-key errors treated as
      "already landed", and permanent refusals discarded with an
      explanation rather than retried forever. All of that is now
      protected rather than merely true.
      Needed a new harness capability (`db.failNext`) — a mock that
      always succeeds cannot exercise a queue.
- [ ] **STILL TO DO: the offline rehearsal, ON A LAPTOP.** Andy confirmed
      12 Aug: **entry is laptop only, never mobile.** That removes the
      worst offline risks — iOS suspending a background tab, Android
      killing the page, mobile Safari clearing localStorage under memory
      pressure. A laptop browser keeps the tab alive and keeps
      localStorage.
      Still worth rehearsing, because wifi at a stadium drops regardless
      of the device: turn wifi off mid-drive, enter three plays, reload
      while still offline, reconnect, confirm all three landed.
- [x] **DONE 12 Aug 2026.** `derivePhase()` reads the log on every
      render: final status → ended; no real plays → notStarted; no half
      divider → firstHalf; divider with nothing after → halftime;
      otherwise secondHalf. The stored column is now a cache that is
      always overwritten.
      **Two self-heal blocks deleted**, not added to — undoing across the
      interval, or past the divider, now lands correctly with no repair
      logic at all. The guided-flow repair stays, because guided_state is
      genuinely not derivable ("kickoff in progress" and "kickoff never
      started" look identical in the log).
      Covered by `tests/phase_derivation_check.js`, mutation-tested:
      reverting to the stored phase reproduces a lockup immediately.
- [x] **DONE 12 Aug 2026** — `tests/realtime_check.js`, mutation-tested.
      The most valuable assertion turned out to be a negative one: the
      DELETE handler must NOT have a server-side filter. Postgres Changes
      cannot filter deletes, so adding one — which looks exactly like
      tidying up — stops the events arriving and Undo silently stops
      propagating to the broadcast. Nothing in the app would say so.
      Also covers a delete event with no `game_id`, which is what a
      missing REPLICA IDENTITY FULL looks like in practice.
- [x] **DONE 12 Aug 2026, in two halves.**
      **Andy, by eye, in a real browser:** all 15 charts draw and have
      data. That rules out the crude failures a test cannot see.
      **`tests/chart_data_check.js`:** covers the half eyes are worst at.
      The harness now records every Chart.js config rather than
      discarding it, so the test inspects what each chart was actually
      handed — no NaN or undefined, no undefined labels, and series
      lengths matching the labels and each other.
      Its first finding was its OWN bug: it flagged the `null` values in
      the 3rd/4th-down charts, which are correct — a game with zero
      third-down attempts has no percentage, and plotting 0% would state
      something false. `null` is now allowed on line charts only.

---

## PHASE 3 — vMix data source (days 4–10)

### The requirement that shapes the design

**The URL must not change from game to game.** The broadcast team sets it
up the day before and never touches it again. Andy's team starts the day
before kickoff, so it cannot depend on a game being in progress.

```
https://nevillestatchat.vercel.app/api/feed?view=score&format=xml
```

- [ ] **A `broadcast` flag on the game row**, settable from the dashboard
      **as soon as a game is created** — not only once it starts.
- [ ] The dashboard shows which game is flagged, so nobody wonders.
- [ ] Automatic fallback to the most recent in-progress game only when
      nothing is flagged. Two games are never live at once (confirmed).
- [ ] If we gate it at all, **one static key** — never per-game.

### The endpoint

- [ ] `api/feed.js`, no authentication, **no-cache headers** — the
      classic cause of a vMix data source silently freezing after one
      fetch.
- [ ] Eight views: `score`, `drive`, `lastplay`, `rushing`, `passing`,
      `receiving`, `defense`, `teamstats`. XML primary, JSON alongside.
- [ ] **A test asserting every field the view page displays appears in
      some feed view.** This turns "ALL data is available" from an
      assumption into a check.

---

## PHASE 4 — Rehearsal (days 11–12)

The part no test can replace.

- [ ] **A full scrimmage: real hardware, venue wifi, vMix live.** Enter a
      complete game start to finish.
- [ ] **Deliberately drop the connection mid-drive**, then restore it.
- [ ] Test on **the actual device the scorer will use.** Nobody has yet.
- [ ] Let the device **sleep and wake** mid-game. Does realtime recover?
- [ ] Have the broadcast crew set up the data sources themselves, from
      the written instructions, without help.

---

## PHASE 4b — Per-player tackles (days 12–13)

Added at Andy's request, 10 August. Sequenced **last of the build work**
so it can be dropped without disturbing anything else if earlier phases
run over.

### Why it is worth doing

**The app already captures tackles and throws them away.** "Tackled by"
is filled in on most rushes and passes, stored as `roles.defense`, and
used to rank the tackler picker — but `computeBoxScore` only ever
increments `int`, `sacks` and `fumRec`. A plain tackle produces no stat
at all. A defensive coordinator currently gets three turnover counts and
a team TFL, and nothing else.

Counting it is the same shape as the receiver-targets work: a branch in
`computeBoxScore` and a column in four report pages. **After Phase 2a it
is a ONE-file engine change**, which is part of why it sits here.

### Two decisions to settle before writing code

- [ ] **Solo versus assisted.** The panel takes ONE tackler, so every
      tackle is implicitly solo today. Real stat sheets split them, which
      means either a second field — slowing the fastest-moving entry in
      the app — or accepting a single "tackles" number with no split.
      **Recommendation: single number for this release.** Revisit after
      a season of real use.
- [ ] **Per-player TFL will disagree with the team TFL already shipped.**
      Team TFL counts from the play log and needs no tackler, so it is a
      ceiling; per-player numbers will sum to less. Show both and label
      the difference, or show only one. **Do not let them silently
      contradict on the same page.**

### The work

- [ ] Count tackles per player in `computeBoxScore` from `roles.defense`.
- [ ] Per-player TFL falls out for free: a credited tackle on a play with
      negative yardage.
- [ ] Add the columns to `view.html`, `recap.html`, `stat_package.html`
      and `season_report.html`, and to the XLS export.
- [ ] Add them to the vMix `defense` feed view (Phase 3).
- [ ] A test suite, mutation-tested like the others.

### The honest caveat, which must reach the reports

Naming the tackler is **optional** and gets skipped at speed, so
per-player tackles will **under-count**. That is exactly why team TFL was
built to count from the play log instead.

- [ ] Decide how to label that on the reports so nobody reads an
      undercount as a complete figure.

### Acceptance

- [ ] Full suite green, fuzzer clean, three NFL weeks unchanged.
- [ ] The new suite mutation-tested.
- [ ] Team TFL and per-player TFL do not contradict on any page.

---

## PHASE 5 — Freeze (days 13–14)

- [ ] **No code changes in the final 48 hours** except a rollback.
- [ ] Final full regression: suites, fuzzer, three NFL weeks.
- [ ] Fallback tag re-verified as restorable.
- [ ] Rollback page printed and in the booth.

---

## 4. Open questions needing answers before or during the work

- [ ] **Does the Supabase plan pause on inactivity?** Free-tier projects
      are believed to. If it pauses the week before a game, the first
      request of the night is a cold start or an outage. **Verify the
      plan and the policy** — cheap to rule out, catastrophic to discover
      at kickoff.
- [ ] **No service worker: reloading while genuinely offline fails.** A
      scorer who reloads on bad stadium wifi gets nothing. Accept, or
      cache?
- [ ] **If the scorer's device dies mid-game**, another device can take
      over because plays are in the database — but the pending queue is
      in that device's localStorage and is lost. Document the handover
      and know how many plays are at risk.
- [ ] **Paper fallback** if the app is unavailable at kickoff.
- [ ] **Who is on call**, and what do they do?
- [ ] **Load the real rosters** — Neville's squad and the week-one
      opponent — well before game day.

---

## 5. What gets cut if we run short

In this order:

1. **Per-player tackles (Phase 4b)** — sequenced last precisely so it can
   go. The app has run without them all season so far.
2. Feed views beyond `score` and the leaders
3. Phase derivation from the log
4. Realtime test
5. PDF and XLS testing (post-game, not in-game)

**Not cut under any circumstances:**

- **RLS** — the only item that can lose data permanently
- **The rehearsal** — the only thing that finds what tests cannot
- **The fallback tag** — everything else depends on it

---

## 6. Known limitations we are shipping with

Stated so nobody discovers them on the night.

- **PDF and XLS export are untested.** They will be used post-game.
- **Targets are a floor, not a count** — the receiver is optional on an
  incompletion, so the number under-reports.
- **Per-player tackles will under-count** where the tackler was not
  named. Team TFL, which counts from the play log, does not.
- **No audit trail** — plays do not record who entered them.
- **Correction of a mid-drive deletion needs the checker run manually**;
  `validateGame` reports it but does not fix it.

---

## 7. Approval

- [x] Andy has read this and approves the scope, the sequence and the cut list. **10 Aug 2026.**
- [x] Phase 1 may begin.
