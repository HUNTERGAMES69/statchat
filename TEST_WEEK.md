# Test week — verifying StatChat before live use

Written 13 August 2026, at the end of the feature work. The app is
feature-complete by Andy's call; from here anything found is a bug or a
change of scope, and the difference matters a week out from a real game.

**Two rules for the week.**

1. **Log every defect, fix nothing on the spot.** Batch the fixes at the
   end of each night, then re-run the gate. Fixing mid-session is how you
   lose track of what you had already tested.
2. **No new features.** Holding this line is the point of doing the week
   at all.

**Enter everything under season year 2099** so the production reset can
clear it and nothing has to be untangled from real data later.

---

## The nightly gate — about 2.5 minutes, run it first, every night

```bash
for f in tests/*.js; do
  t=$(basename "$f" .js)
  case "$t" in harness|ui_driver|scripted_game|mutation_check) continue ;; esac
  node "$f" >/dev/null 2>&1 || echo "FAILED: $t"
done
echo done
```

Deliberately a glob rather than a list of names. The old version
enumerated 26 suites and was out of date within a week — there are 31
now, and a hand-written list silently stops running the ones added since
it was written, which is the worst possible failure for a gate.

`mutation_check` is excluded because it takes about four minutes and
mutates the working tree; it has its own line in Night 1. The other three
are helpers, not suites.

If it is red, that is the night's work. If it is green, it has told you
almost nothing new — which is the point of everything below.

**Be honest about what these 31 suites buy.** They check the app against
ITSELF: that a play entered produces the state the engine expects. Only
`nfl/run_qa.js` checks against the outside world. Nearly every bug found
on 13 August was found by using the app or by reading code, not by the
suite. The suite's job is to stop you re-breaking what is fixed. The
week's value is in the human nights.

---

## Night 1 — Baseline and plumbing (45 min)

- [ ] Run the gate. Record which suites fail and how long the run took.
- [ ] `node tests/mutation_check.js` (~4 min) — do the tests still catch
      real bugs? Triage anything that survives.
- [ ] `node tests/coverage_probe.js` (~25s) — can every UI path still be
      reached and saved?
- [ ] **Verify the foreign keys in the Supabase table editor.** Is
      `plays.game_id` ON DELETE CASCADE? Is `game_rosters.game_id`? This
      is the one thing no test can tell you, and both the production
      reset and the roster clear depend on it.
- [ ] **Dump the schema into the repo.** The tables, RLS policies, roles
      and the profiles trigger currently exist in the Supabase dashboard
      and NOWHERE ELSE. A schema that lives in exactly one place — and
      that place is somebody else's hosted web app — cannot be rebuilt
      and cannot be reviewed.

      Connection string: Supabase → Project Settings → Database.

      ```bash
      pg_dump "postgres://postgres:[PASSWORD]@db.pboushzlcyfkssojpuut.supabase.co:5432/postgres" \
        --schema-only --schema=public --no-owner --no-privileges \
        -f sql/schema.sql
      ```

      Then READ IT before committing, for two reasons. First, confirm the
      cascades from the item above appear in writing — that is a second,
      independent check of the same thing. Second, a schema dump can
      carry comments or defaults you would rather not publish; this repo
      is not public today, but the file outlives that assumption.

      Do this BEFORE Night 8. The reset deletes data, not schema, but a
      dump taken while the app still has real games in it is the one that
      proves the shape was right.

      From then on the schema stays current with every change — the
      procedure is in `sql/README.md`, and it is four steps: write a
      numbered migration, run it, re-dump, diff the dump.

**Backups are automated now** and no longer a checklist item. The
destructive tests that used to live here — Reset for production and Clear
roster — have moved to the very end of the week, for the reason set out
there: they delete the data the rest of the week is testing with.

**Pass:** gate green, cascade confirmed in writing, `sql/schema.sql`
committed.

---

## Night 2 — Entry trees, exhaustively (90 min)

Work the play panels, one branch at a time. **Read each log line aloud
and check it says what you meant** — the number being right is not the
same as the line being right.

- [ ] Rush: gain, loss, no gain, TD, safety, fumble (own / opponent /
      out of the end zone), with and without a tackler
- [ ] Pass: complete, incomplete, TD, sack, sack-fumble, interception
      with and without a return, receiver fumble
- [ ] Sack: yardage typed, yardage from the calculator, the calculator
      refusing a spot ahead of the ball, sack for no gain
- [ ] Penalty: on offence and defence, every group in the dropdown, with
      and without a type selected, automatic first down, dead-ball
- [ ] Kneel, bad snap (own recovery and defence recovery)
- [ ] Yardage calculator on every panel that has one
- [ ] Undo and redo after each kind of play

**Watch for:** anything you had to think about twice. At game speed,
hesitation is how mis-entries happen, so a confusing panel is a defect
even when the number it produced was right.

---

## Night 3 — Special teams and phases (90 min)

- [ ] Kickoff, all four outcomes — normal return, touchback, onside,
      out of bounds — on the play panel AND the guided half-start flow
- [ ] Kickoff returned for a touchdown; muffed, both recoveries
- [ ] Punt: normal, touchback, blocked, muffed, returned for a touchdown
- [ ] Field goal made and missed; PAT; 2PT run and 2PT pass; safety
- [ ] Fake punt and fake field goal
- [ ] The mandatory takeover spot: confirm it refuses a half-filled one
- [ ] Quarter marker in Q1 and Q3; greyed out in Q2, Q4 and overtime
- [ ] End 1st half (check the score in the prompt), start 2nd half
- [ ] Play into overtime and end the game there — **run the full
      overtime sequence in `GOLDEN_GAME.md`**, which is now eight steps.
      The first live test of that button found nine separate faults, so
      it gets a deliberate pass rather than a glance
- [ ] Punt muffed, recovered by the kicking team, **with and without
      naming the recoverer**. Both must charge the receiving team a
      turnover — the version that only worked when a recoverer was named
      shipped and passed its test
- [ ] Punt muffed, recovered by the kicking team **in their own end
      zone**: the safety toggle is the third control in that branch
- [ ] Enter a touchdown and confirm the clock is asked THERE, and that
      the PAT does not ask again

**Untested code paths to hit deliberately:** the out-of-bounds kickoff,
and the kickoff outcome toggles in several orders — a deselected toggle
used to keep its tick.

---

## Night 4 — Pickers, rosters and shared numbers (60 min)

- [ ] Type a jersey number that is NOT on the roster, then use
      **Add to roster** on the confirm box. Check the name appears on
      plays entered BEFORE you named him, and on the view page on a
      second device
- [ ] Upload a roster with positions for the starters only — blank
      column C is accepted now, and the import says how many arrived
      without one
- [ ] Upload a real opponent roster from a programme. Confirm the format
      card appears first and the error box names any bad rows.
- [ ] Include two players on one number and at least one blank position.
- [ ] Seed starters; resolve the shared number in the quick-picks.
- [ ] In the game: the seeded player appears alone, without a "?".
- [ ] Type the shared number — it defaults to the seeded starter and
      offers the other.
- [ ] Give the OTHER player a carry. He joins the picker afterwards.
- [ ] **Hard-reload the page and re-check the box score.** This is the
      case that was broken and looked fine live.
- [ ] A halfback pass: a running back throws, then appears in the passer
      picker.

**Pass:** every stat lands on the player you meant, after a reload.

---

## Night 5 — The golden game, at speed (2 hours)

The most valuable night. See `GOLDEN_GAME.md`.

- [ ] Enter all of it without pausing to think, as you would in a game.
- [ ] Then reconcile every number against the expected box score.
- [ ] Check the view page live as you go — on a second device if you can.
- [ ] Finalise, then check the recap.

**Pass:** the box score matches, exactly. Any difference is either a bug
or an error in the chart, and both are worth knowing.

---

## Night 6 — Reports and exports (90 min)

- [ ] **Export both PDFs and count the pages.** No section may split
      across a page break, the recap's box score and team block must share
      page one, and the opponent must start a new page. This is the one
      area no test can check — jsdom has no layout engine, so the rules
      are verified as present and nothing more
- [ ] If the game went to overtime, check the OT column appears and the
      quarter row adds up to the final score
- [ ] Season report: **time of possession is in the Efficiency section**,
      not with Penalties. Keeping the ball is not a mistake

**The biggest coverage hole in the app.** PDF and XLS export have no
automated coverage at all, and the stat package is what coaches actually
receive.

- [ ] Stat package: on screen, then PDF, then XLS
- [ ] Season report with at least two finished games: charts, totals,
      PDF, XLS
- [ ] Check totals ADD UP across games, not just within one
- [ ] Open the exports on another machine, and on a phone
- [ ] Recap page against the same game
- [ ] Reports hub: season selector with more than one season present

**Pass:** a coach could read the PDF and find nothing to query.

---

## Night 6b — Public sharing (45 min)

Shipped 15 Aug 2026 and covered by no automated test at all. It is also
the only part of StatChat where a mistake is visible OUTSIDE the
building, so it gets a pass of its own rather than being folded into
reports.

Every one of these is a two-window job: signed in on one, and a
**private / incognito window** on the other. A normal second window still
carries your session and will happily show you a game that is not
actually shared — which is the exact failure this is looking for.

- [ ] Share a finished game. The button should read **Shared** and show a
      `/g/<token>` link
- [ ] Open that link in a **private window**. The recap must load, with
      no sign-in prompt and no "Back to dashboard" link
- [ ] Confirm the private window shows **no Share button**. If it does,
      the admin gate is failing open
- [ ] Turn sharing off. Reload the private window: expect the neutral
      "not shared" page, and check it does NOT name either team
- [ ] Share the SAME game again. The new link must **differ** from the
      first, and the first must still be dead — that is the whole point
      of the token
- [ ] Try a made-up token, and the game's raw UUID as a token. Both
      should give the same neutral page
- [ ] Open a game that is **unlocked for corrections** while shared. It
      must not be publicly readable — the policy needs final AND public
- [ ] Check the **dashboard SHARED badge** appears on the right game, and
      only on shared ones
- [ ] `select count(*) from games where is_public` — does the number match
      what you believe you have shared?

**The link preview** — the part that cannot be tested from a browser tab:

- [ ] `https://statchat.co/api/og?t=<token>` in a browser. The card should
      render: both teams white, the winner's rule in their colour, the
      date legible
- [ ] Send the `/g/` link to yourself in **iMessage**. Expect the score as
      the title and the scoreboard image
- [ ] Paste it into **Slack**, which shows the description where iMessage
      does not
- [ ] Send a link for an **unshared** game and confirm the card gives
      nothing away
- [ ] A game with a **dark opponent colour** (navy, black): the mark
      should keep the true colour and gain a ring, not turn pale

**If a preview looks stale**, that is caching, not a bug — iMessage keys
on the url. Test with a different game rather than chasing it.

## Night 7 — Resilience, then freeze (90 min)

- [ ] **Re-run the connection-loss test.** The earlier run is not a clean
      pass: the log-blanking bug would have masked anything else.
- [ ] An outage lasting past the 8-second connection poll, not a blip
- [ ] **Sleep the laptop mid-drive** and wake it — not just alt-tab
- [ ] Reload the page mid-drive
- [ ] Undo while offline: a play from during the outage (allowed) and one
      from before it (refused, with a message)
- [ ] Two devices on the same game; the ON AIR flag; vMix overlay
- [ ] Then: final gate run, tag the fallback, and **freeze**.

---

## Night 8 — Going live. Do these LAST, in this order (30 min)

These two delete the data every other night is testing with, which is why
they are last rather than first.

**RESET FOR PRODUCTION CANNOT BE REHEARSED.** There is no way to run it
against a throwaway game and leave the rest alone — it takes EVERY game
in the table, in every season, unfinalizes the finished ones, deletes
them all, then clears the roster and the season year:

```js
const ids = (allGames || []).map(g => g.id);   // no season filter
await supabaseClient.from('games').delete().in('id', ids);
```

So running it IS going live. The earlier plan had it on Night 1 against a
"throwaway 2099 game", which would have wiped the 2025 test games on the
first evening and taken the week's material with them.

- [ ] Everything from Nights 1–7 passes, and every defect is logged
- [ ] You have read the season-report and stat-package exports you care
      about, or exported them to PDF. **After the reset they are gone**
- [ ] Confirm a recent automatic backup exists in Supabase → Database →
      Backups. Not as a checklist ritual — as the thing you would restore
      from if the delete goes wrong halfway
- [ ] Note which games are shared: `select designator from games where
      is_public`. Those links die with the games
- [ ] **Run Reset for production.** Password, then the typed agreement
- [ ] Confirm afterwards: no games, no roster, no season year — and that
      the team name, colours, logo and every user account survived
- [ ] Set the season year for the real season
- [ ] Upload the real roster
- [ ] **Clear roster for new season** is the OTHER destructive one. It is
      not needed today — it belongs to next August — but test it now if
      you want it proven: upload a throwaway roster, clear it, and confirm
      a previously finished game still shows every player name from its
      snapshot. Then upload the real roster again
- [ ] Final gate run. Freeze

---

## Definition of done

- Nights 1–7 complete, every defect logged
- Gate green on the final run
- The golden game reconciles exactly
- A PDF stat package you would hand a head coach
- Cascade behaviour confirmed and written down
- No code changes in the final 48 hours before the first real game
