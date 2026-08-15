# The golden game

A fixed script of plays with a **hand-computed expected box score**, for
Night 5 of `TEST_WEEK.md`. Enter it exactly as written, at game speed,
then reconcile.

**Why it exists.** The automated suites check that the app agrees with
itself. This checks it against football. The expected numbers below were
worked out by hand from the play list, then confirmed by entering the
whole game through the real UI — so a disagreement on the night is a
genuine finding, not a typo in the chart.

**Teams.** Neville (home) vs Ruston. Ruston kicks off to start.

## Rosters to load

| Neville | | Ruston | |
|---|---|---|---|
| 7 Sam Hartwell QB | 22 Ray Roberson RB | 12 Jed Doyle QB | 30 Abe Carr RB |
| 80 Wes Young WR | 84 Tim Ellis WR | 88 Lou Reed TE | |
| 44 Cal Sledge LB | 99 Moe Frank DE | 55 Gus Lane LB | 99 Ed Boone DE |
| 3 Kip Nolan K | 15 Pat Dunn P | 3 Ty Nash K | 15 Sid Vale P |
| 21 Ron Vick DB | | 21 Max Pine DB | |

## The script

**Opening kickoff** — Ruston kicks (#3), returned 22 by Neville #21,
Neville takes over at own 25.

*Neville drive 1*
1. #22 rush 6
2. #7 pass to #80 for 12
3. #22 rush, LOSS 3, tackled by Ruston #55
4. #7 sacked for 7 by Ruston #99
5. #7 pass to #80, incomplete
6. #15 punt 40 — Ruston takes over own 27

*Ruston drive 1*
7. #30 rush 5, tackled by Neville #44
8. #12 pass to #88 for 15, tackled by Neville #44
9. #30 rush 4
10. **Quarter marker — start of Q2**
11. #12 pass INTERCEPTED by Neville #44, returned 10 — Neville ball at own 50

*Neville drive 2*
12. #22 rush 8
13. #22 rush 3
14. #7 pass to #84 for 20
15. #7 pass to #80 for 13
16. *(drive reset to Ruston 6-yard line)* #22 rush 6, TOUCHDOWN
17. #3 PAT good — **Neville 7–0**
18. #3 kickoff, TOUCHBACK — Ruston own 20

*Ruston drive 2*
19. #30 rush 2
20. #12 sacked for 6 by Neville #99
21. #15 punt 35 — Neville takes over own 41
22. #22 rush 5
23. **End 1st half** — halftime, Neville 7–0

**Second-half kickoff** — Neville kicks (#3), returned 18 by Ruston #21,
Ruston takes over at own 23.

*Ruston drive 3*
24. #30 rush 7
25. #30 rush 4
26. #12 pass to #88 for 9, **FUMBLED**, recovered by Neville #44 at Ruston 43

*Neville drive 3*
27. #22 rush 4
28. **PENALTY on Neville — Holding, 10 yards**
29. #7 pass to #80 for 16
30. #7 pass to #80, incomplete
31. #3 field goal 42, GOOD — **Neville 10–0**
32. #3 kickoff, OUT OF BOUNDS — Ruston own 35
33. **Quarter marker — start of Q4**

*Ruston drive 4*
34. #30 rush 3
35. **PENALTY on Ruston — False start, 5 yards**
36. #12 pass to #88, TOUCHDOWN
37. #3 PAT good — **Neville 10–7**
38. #3 kickoff, returned 20 — Neville own 22
39. #22 rush 2

**Final: Neville 10, Ruston 7**

> **On play 36:** do NOT pre-decide the yardage. A touchdown pass is as
> long as the distance to the goal line, so the app computes it from
> where the ball is. The first draft of this chart said "25-yard TD" and
> the app recorded 67 — the app was right and the chart was wrong. If
> your field position differs from the run below, Ruston's passing
> yardage will differ with it, and that is correct.

## Expected box score

**NEVILLE**

| Rushing | Att | Yds | Long | TD |
|---|---|---|---|---|
| Ray Roberson | 8 | 31 | 8 | 1 |
| TEAM | 1 | −7 | | |

*TEAM is the sack. NFHS charges sack yardage to team rushing, not to the
quarterback — that is deliberate and is the single most common thing to
mistake for a bug.*

| Passing | Att | Comp | Yds | Long | Sacked |
|---|---|---|---|---|---|
| Sam Hartwell | 6 | 4 | 61 | 20 | 1 |

| Receiving | Tgt | Rec | Yds | Long |
|---|---|---|---|---|
| Wes Young | 5 | 3 | 41 | 16 |
| Tim Ellis | 1 | 1 | 20 | 20 |

| Defense | Tack | TFL | Sacks | Int | Fum Rec |
|---|---|---|---|---|---|
| Cal Sledge | 2 | 0 | 0 | 1 | 1 |
| Moe Frank | 1 | 1 | 1 | 0 | 0 |

**RUSTON**

| Rushing | Att | Yds | Long |
|---|---|---|---|
| Abe Carr | 6 | 25 | 7 |
| TEAM | 1 | −6 |  |

| Passing | Att | Comp | Yds | Long | Int | Sacked | TD |
|---|---|---|---|---|---|---|---|
| Jed Doyle | 4 | 3 | 91 | 67 | 1 | 1 | 1 |

| Receiving | Tgt | Rec | Yds | Long | Fum | TD |
|---|---|---|---|---|---|---|
| Lou Reed | 3 | 3 | 91 | 67 | 1 | 1 |

| Defense | Tack | TFL | Sacks |
|---|---|---|---|
| Gus Lane | 1 | 1 | 0 |
| Ed Boone | 1 | 1 | 1 |

**Penalties** — Neville 1 for 10, Ruston 1 for 5.

## One sequence to enter deliberately, off-script

Not in the play list above, because it needs a clean drive of its own —
but enter it once on Night 5, because it happens about once a season, it
is entered under pressure, and getting it wrong is silent.

**A pass intercepted, returned 10 yards, then fumbled back.** Two plays:

1. **The interception.** Passer, intercepted by, return yards 10, and the
   takeover spot set to **where the fumble happened** — NOT where the
   return ended. Put the post-fumble spot here and the ball moves twice.
2. **The fumble.** The standalone Fumble panel, with the INTERCEPTOR
   typed as the carrier (he is the ball carrier now; the picker resolves
   him from the defensive roster), recovered by the opponent, and the
   recovery spot.

Expect afterwards: possession back with the original offence, **two
turnovers** — one each, which is correct rather than double counting —
the interception credited to the defender, the fumble recovery to the
recoverer, and the quarterback charged with the pick.

If the intercepting team recovers their own fumble instead, it is the
same two plays with "Recovered by own team", and possession simply stays
with them.

## Two things to check rather than assume

**Cal Sledge has 2 tackles and 1 fumble recovery, not 3 tackles.**
Recovering the fumble on play 26 is not a tackle — picking the ball up is
a different act from bringing the carrier down, and it is already counted
in its own column. This chart originally said 3, which is what prompted
the decision; the engine was changed on 13 Aug 2026 and
`tests/tackles_check.js` now pins it.

**Passing yards must equal total receiving yards.** Since 14 Aug 2026 a
completion with no receiver named is credited to *Unknown* rather than
left out, so the two columns reconcile. The view page shows both totals
beside their table headers — if they disagree, stop and find out why.
Attempts should equal targets, and completions should equal receptions,
for the same reason.

**Team TFL will exceed per-player TFL.** That is by design: team TFL
counts every play that lost yardage, per-player counts only those where a
tackler was named. A ceiling and a floor, shown in separate tables. Do
not "fix" one to match the other.

## After entering it

- [ ] Box score matches the tables above, on the game page
- [ ] View page agrees, live, ideally on a second device
- [ ] Finalise the game; recap agrees
- [ ] Stat package agrees, on screen and as PDF and XLS
- [ ] Season report includes it and totals correctly
- [ ] Hard-reload every page and check the numbers again
