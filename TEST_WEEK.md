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

## The nightly gate — 133 seconds, run it first, every night

```bash
for t in run_scripted cross_surface picker_check clock_display_check drive_boundary_check \
         possession_and_drive_check optional_players_check entry_integrity_check \
         picker_behaviour_check takeover_spot_check yardage_calculator_check \
         receiver_targets_check shared_number_check onside_kick_check game_export_check \
         offline_queue_check phase_derivation_check realtime_check chart_data_check \
         tackles_check season_filter_check whitelist_check fake_kick_check \
         full_game_check engine_standalone_check reset_check; do
  node tests/$t.js || echo "FAILED: $t"
done
```

If it is red, that is the night's work. If it is green, it has told you
almost nothing new — which is the point of everything below.

**Be honest about what these 26 suites buy.** They check the app against
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
- [ ] **Take a database backup.** Before any of the destructive tests.
- [ ] Create a throwaway 2099 game and run **Reset for production**
      against it. It has never been run for real.
- [ ] Upload a roster, then **Clear roster for new season**, then confirm
      a previously finished game still shows every player name.

**Pass:** gate green, cascade confirmed in writing, backup exists.

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
- [ ] Play into overtime and end the game there

**Untested code paths to hit deliberately:** the out-of-bounds kickoff,
and the kickoff outcome toggles in several orders — a deselected toggle
used to keep its tick.

---

## Night 4 — Pickers, rosters and shared numbers (60 min)

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

## Definition of done

- Seven nights complete, every defect logged
- Gate green on the final run
- The golden game reconciles exactly
- A PDF stat package you would hand a head coach
- Cascade behaviour confirmed and written down
- No code changes in the final 48 hours before the first real game
