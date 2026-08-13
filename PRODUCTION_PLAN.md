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

**Re-verified 12 Aug 2026 against the final build** (engine consolidated,
RLS hardened, feed live, per-player tackles): 27 suites, fuzzer over 60
games, and **SIX** NFL weeks — 93 games, 15,341 plays, 10,140
state-progression pairs, all clean. Weeks 1-3 matched the earlier
baseline exactly.

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

- [x] GitHub **release tag** `v1.0-preseason`, with a note saying what it
      is and why. **Tag only after the 12 outstanding files are uploaded**
      — a tag of a half-uploaded repo is worse than no tag.
- [x] Record the current **Vercel deployment id**, written down where the
      crew can find it — so "promote this one" is a known target rather
      than a hunt under pressure.
- [x] **Rollback procedure** written: `ROLLBACK.md`. Two routes (Vercel
      promote, then the tagged ZIP), what a rollback does NOT undo, the
      paper fallback, and blanks for the deployment id and on-call name.
- [x] Filled in and **printed**, 12 Aug 2026. Nobody
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

- [x] Extract to `engine.js` with the dual export, so browsers and Node
      load the same file.
- [x] Replace the inline copies in `game.html`, `view.html`, `recap.html`,
      `stat_package.html`, `season_report.html` with `<script src>`.
- [x] Regenerate `broadcast.html` against the shared engine and delete
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

- [x] 19 suites pass  <!-- snapshot as of 12 Aug; 25 pass as of 13 Aug 2026 -->
- [x] Fuzzer clean over 60 games
- [x] Three NFL weeks: 48 games, 6,977 plays, **zero** issues
- [x] `broadcast.html` still renders
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

- [x] ~~ **Not green by end of day 4 → revert to the tag** and fall back to  (not triggered — it was green)
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

- [x] **A `broadcast` flag on the game row**, settable from the dashboard
      **as soon as a game is created** — not only once it starts.
- [x] The dashboard shows which game is flagged, so nobody wonders.
- [x] Automatic fallback to the most recent in-progress game only when
      nothing is flagged. Two games are never live at once (confirmed).
- [x] If we gate it at all, **one static key** — never per-game.

### The endpoint

- [x] `api/feed.js`, no authentication, **no-cache headers** — the
      classic cause of a vMix data source silently freezing after one
      fetch.
- [x] Eight views: `score`, `drive`, `lastplay`, `rushing`, `passing`,
      `receiving`, `defense`, `teamstats`. XML primary, JSON alongside.
- [x] **DONE 12 Aug 2026** — `tests/feed_coverage_check.js`.
      **It found four real gaps immediately**, which is the point:
      `possessions`, `turnovers` and `penalties` were missing from
      teamstats, and the entire `defense` view returned ZERO rows because
      its filter kept only players with tackles — so a defender with a
      sack and an interception was dropped. All four are fixed.
      The requirement had felt satisfied; the feed has a lot of fields and
      nothing was obviously absent.

---

## PHASE 4 — Rehearsal (days 11–12)

The part no test can replace.

- [ ] **A full scrimmage: real hardware, venue wifi, vMix live.** Enter a
      complete game start to finish.
- [ ] **Deliberately drop the connection mid-drive**, then restore it.
- [x] **Same laptop throughout.** Andy is the scorer and every session so
      far has been on that machine, so this was never an unknown — the
      concern applied to a crew with separate hardware.
- [ ] Let the device **sleep and wake** mid-game. Does realtime recover?
- [x] ~~ Have the broadcast crew set up the data sources themselves, from~~  (Andy: not required)
      the written instructions, without help.

---

## PHASE 4b — Per-player tackles — DONE 12 Aug 2026

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

- [x] **Solo versus assisted** — SINGLE NUMBER this release, as
      recommended. The panel takes one tackler, so every tackle is
      implicitly solo; splitting needs a second field on the
      fastest-moving screen in the app.
- [x] ~~Solo versus assisted.~~ The panel takes ONE tackler, so every
      tackle is implicitly solo today. Real stat sheets split them, which
      means either a second field — slowing the fastest-moving entry in
      the app — or accepting a single "tackles" number with no split.
      **Recommendation: single number for this release.** Revisit after
      a season of real use.
- [x] **Per-player TFL will disagree with the team TFL already shipped.**
      Team TFL counts from the play log and needs no tackler, so it is a
      ceiling; per-player numbers will sum to less. Show both and label
      the difference, or show only one. **Do not let them silently
      contradict on the same page.**

### The work

- [x] Counted in `computeBoxScore` from `roles.defense`, on any scrimmage
      play with a credited defender. A sack counts as a tackle as well as
      a sack.
- [x] Per-player TFL falls out for free: a credited tackle on a play with
      negative yardage.
- [x] `view.html`, `recap.html`, `stat_package.html` and
      `season_report.html` all show a Tackles section, each in its OWN
      table beside the existing team row — not merged, because the two
      TFL numbers legitimately differ and merging would make the report
      look like it contradicts itself.
      `season_report` aggregates by NAME across games, a different code
      path from displaying one box score; mutation-tested by removing
      the aggregation.
- [x] XLS export: `D-Tackle` and `D-PlayerTFL` columns plus one row per
      tackler, added 12 Aug 2026.
- [x] `tests/tackles_check.js`, mutation-tested.

### The honest caveat, which must reach the reports

Naming the tackler is **optional** and gets skipped at speed, so
per-player tackles will **under-count**. That is exactly why team TFL was
built to count from the play log instead.

- [x] Labelled on every surface: "Counts only plays where a tackler was
      named. The team TFL above counts every play for a loss, so it may be
      higher."
      undercount as a complete figure.

### Acceptance

- [x] Full suite green. (NFL weeks not re-run — the tackle change adds a
      new stat and touches no existing computation.)
- [x] The new suite mutation-tested (sack-as-tackle, gain-as-TFL, and the
      season aggregation).
- [x] Team TFL and per-player TFL are in SEPARATE tables on all four
      surfaces, each with a note. The test asserts team TFL exceeds
      per-player when a loss had no tackler named.

---

## PHASE 5 — Freeze (days 13–14)

- [ ] **No code changes in the final 48 hours** except a rollback.
- [ ] Final full regression: suites, fuzzer, three NFL weeks.
- [ ] Fallback tag re-verified as restorable.
- [x] Rollback page printed, 12 Aug 2026.

---

## 4. Open questions needing answers before or during the work

- [x] **RESOLVED 12 Aug 2026 — upgraded to Pro.** The project WAS on the
      free plan, which pauses after 7 days without database activity.
      That is exactly StatChat's shape: heavy on a Friday, then possibly
      nothing for a week. A paused project means ~30 seconds of dead air
      on the first request at kickoff.

      Pro also brings 7-day backup retention. **The free tier has ZERO** —
      no snapshot is kept at all — so until today the only protection for
      game data was the export button, and it only covered games somebody
      remembered to download.

      Usage at the time of upgrading, after all development testing:
      egress 489 MB / 5 GB, database 29 MB / 500 MB, 13 monthly users,
      file storage 2 MB. Nothing was near a limit; the pause was the only
      real problem.

- [ ] **Check egress after the FIRST REAL GAME.** This is the one number
      the feed changes. Eight data sources polling every second for three
      hours is roughly 86,000 requests a game — small responses, but a
      pattern that has never run. One game's figure multiplied by twelve
      answers the question. Pro allows 250 GB, so almost certainly fine.
- [ ] **USE A 2-SECOND REFRESH INTERVAL, not 1.** Andy is handling the
      wording change. This is not a preference — Vercel Pro allows
      1,000,000 function invocations and the HARD CAP IS ALSO 1,000,000.
      Every other line has overage headroom (transfer 100 GB / 1 TB,
      duration 100 / 1,000 GB-Hrs); invocations show 1M / 1M.

          per game  @1s :    94,500      12 games : 1,134,000  OVER CAP
          per game  @2s :    51,300      12 games :   615,600

      At 1 second the allowance runs out around game 11. Inside one
      billing period that may not bite, but if the reset falls mid-season
      the failure arrives at kickoff.

      Baseline before the first game: 47 invocations, 2.1 MB transfer,
      0 GB-Hrs duration. Everything except invocations has enormous room.

- [ ] **If invocations ever get tight**, the lever is a `view=all`
      endpoint returning every view in ONE response. Eight data sources
      currently hit /api/feed separately; combining them cuts invocations
      eightfold — about 6,400 a game instead of 51,300. Not worth
      building speculatively, but worth knowing it exists.
- [x] **RESOLVED 12 Aug 2026 — warned against, not cached.**

      **The risk turned out to be smaller than first stated.** Refreshing
      while offline does NOT lose data: queued plays live in localStorage
      and survive a failed page load. Verified — three plays queued, tab
      closed, reopened, all three drained. The cost is DOWNTIME, not loss:
      the page cannot fetch itself without a network, so entry is blocked
      until the connection returns.

      A service worker was rejected. It would fix it, but caching
      aggressively enough to serve the app offline brings a stale-code
      failure mode — uploading a fix that never reaches the browser —
      which is worse mid-season than the problem it solves. Self-hosting
      the Supabase library was rejected too: not scalable.

      **Built instead:**
      - A live connectivity indicator that probes the DATABASE every 8s.
        `navigator.onLine` alone is not enough — it reports whether a
        network interface exists, not whether anything is reachable, so a
        laptop on stadium wifi with a dead uplink reports online all
        night.
      - The warning says plainly that plays are safe AND not to refresh,
        because a scorer who thinks data is being lost will do something
        drastic.
      - A `beforeunload` guard, armed ONLY when plays are queued, so the
        browser's own "leave site?" dialog catches a reflexive Ctrl-R.
        Deliberately silent otherwise: nagging on every navigation
        teaches people to click through it.
- [x] ~~ **If the scorer's device dies mid-game**, another device can take~~  (Andy: not required)
      over because plays are in the database — but the pending queue is
      in that device's localStorage and is lost. Document the handover
      and know how many plays are at risk.
- [x] ~~ **Paper fallback** if the app is unavailable at kickoff.~~  (Andy: not required)
- [x] On call is Andy — he built it and enters the plays. Recorded in
      ROLLBACK.md, along with the point that matters if HE is the problem:
      the app is not required to run the game. Record on paper, enter
      afterwards.
- [x] **Real rosters loaded**, 12 Aug 2026 — Neville's squad and the week-one
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

---

## Status note — 13 August 2026

Working session against Phases 2–4. Nothing in the phase order changed;
this records where the plan now stands.

**Test suite is 25 passing**, up from the 19 recorded in the Phase 2a
acceptance above. That figure was a snapshot taken before several suites
landed on 12 August and is left in place as the historical record.

**Phase 3 (vMix data source)** is unchanged and still ahead of us, but
two of its dependencies moved: `run_qa.js` now asserts the final score
per team (Tier 1.5), and `broadcast.html` is regenerated and no longer
stale — its generator owns the favicon links that had been hand-added to
the output and would have been lost on the next run.

**Phase 4b (per-player tackles)** is complete and its suite has been
rebuilt to drive the real UI, after the original was found to pass
against the exact bug it was written to prevent.

**One real bug shipped and was fixed today**: no sack had ever produced a
tackle for loss. Everything else this session was hardening, wording, or
entry-flow gating. The detail is in `TODO.md` section 15 and
`PROJECT_NOTES.md`.

**Nothing in Phase 4's rehearsal checklist has been ticked.** Every
remaining item there needs Andy, hardware and a field — the offline
rehearsal, the scrimmage on venue wifi with vMix live, the mid-drive
connection drop, device sleep/wake, and the 48-hour freeze. The code side
is closer to done than the length of that list suggests; the rehearsal
side has not started.

The one unchecked item still squarely in code and squarely on the path to
a first game is **PDF and XLS export, which remain completely untested**
(`TODO.md`). The stat package is what coaches actually receive.
