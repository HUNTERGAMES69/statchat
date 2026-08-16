# StatChat — the broadcast crew vertical

Written 16 August 2026. Companion to `GO_TO_MARKET.md`, and it **supersedes
sections 4, 5 and 6 of that document** — the positioning, buyer and pricing
change once the target is the streaming crew rather than the program.

Infrastructure and scalability are assumed solved. This is market size and
penetration only.

---

## 1. First, the correction: TurboStats is the incumbent here

I listed TurboStats in the general market table as an old desktop product
for scorers. That was wrong for this vertical. **TurboStats is the only
competitor that already sells to broadcast**, and it has been doing so for
years.

What it actually ships:

- An HDMI green-screen scorebar ticker for streaming the score and clock
  into video, explicitly noting a video mixer is required
- Box-score broadcast "on your local network — great for radio or TV"
- A webcasting API (in beta), with a premium tier for custom backgrounds
  and helmet graphics
- Live scoring with clock and possession-time handling
- MaxPreps roster import, one-click Hudl play-by-play upload

Pricing is roughly $200–250/year for the software subscription, sold
bundled with a tablet at $229–250. **First-year cost lands near $450.**

This matters three ways.

**It validates the vertical.** Somebody has been serving broadcast crews
long enough to build green-screen output and a webcast API. The demand is
real and proven, not hypothetical.

**It sets the price anchor, and the anchor is high.** ~$450 first year for
a Windows desktop app plus a Chinese tablet. A $399 web product is not an
aggressive ask against that. This is the opposite of the stats market,
where PressBox at $59 caps everything.

**Its architecture is a decade behind, and that is the whole opening.**
HDMI green-screen out of a Windows machine means: a second computer, a
capture card, a chroma key set up correctly, and a Windows-only
dependency. StatChat's answer is a URL pasted into a vMix Web Browser
input, with real alpha, no capture hardware, no second machine. Every
modern overlay product in the broader market — OBScoreboard, ScoreboardMax,
KeepTheScore — has already converged on browser-source-with-transparency
as the correct shape. TurboStats has not.

**Do not underestimate the switching friction, though.** TurboStats users
are frequently older, long-tenured scorers with years of team files.
"Reasonable price, already renewed" is the recurring review. The people
who leave will be the ones whose *broadcast* is the priority, not the ones
whose stat archive is.

---

## 2. The wall you have to name before you size anything

**Pixellot.**

PlayOn/NFHS Network has installed over 14,000 automated Pixellot units
across 8,896 schools, and the whole point of the system is that no camera
operator is required and on-screen score graphics can sync directly from
the venue scoreboard. NFHS Network subscribers can watch broadcasts from
over 8,000 schools. Before the Pixellot partnership the Network averaged
about 30 streams per member school per year; afterwards, roughly 130.

**Every one of those schools is outside your market**, and permanently so.
There is no vMix, no crew, no browser source, nobody in a booth. The score
graphic comes off the scoreboard controller. Nothing you build reaches
them, and PlayOn — which also owns MaxPreps and Digital Scout — has no
reason to open that door.

This is the single most important number in the analysis and it cuts your
addressable market by more than half before you start.

**But it also defines your customer precisely.** A program running a
crewed, switched, multi-camera broadcast in 2026 has *chosen* that over a
free automated camera. That is a deliberate, funded, prideful decision by
a program that wants its stream to look like a real broadcast. Those are
exactly the people who will pay $399, and they have already self-selected
for you.

The Pixellot fleet is not a lost market. It is a filter that pre-qualifies
your leads at no cost.

---

## 3. The funnel

```
11-player football schools (NFHS 2024 survey)         14,269
                                                       (~7,135 games/Friday)

  x  ~80% stream in some form                         11,415

  x  15-25% crewed rather than automated          1,700 - 2,850

  x  ~75% on vMix/OBS rather than hardware
     switchers, TriCaster or YoloBox              1,280 - 2,140
```

**SAM ≈ 1,300–2,100 programs. Work with 1,700.**

At $399/season that is a **theoretical ceiling of roughly $680,000/year**
if you took the entire vertical, which nobody ever does.

Every assumption above is arguable and two of them are load-bearing:

- **The 15–25% crewed rate is the weakest number in this document.**
  Nobody publishes it. It is inferred from the Pixellot install base
  against total streaming schools. If it is really 10%, the SAM halves; if
  the crewed segment is growing (and the PTZOptics/vMix student-production
  trend suggests it might be), it grows.
- **The 75% browser-capable rate** is more solid — vMix and OBS dominate
  the prosumer sports tier, and both take web browser inputs natively.

**Get the real number cheaply.** Louisiana has ~250 football-playing
schools. Spend a weekend on LHSAA schedules and school YouTube channels
and classify fifty of them: automated, crewed-vMix, crewed-other, or no
stream. That sample tells you whether the SAM is 800 or 2,500, and it is
the highest-value research you can do before spending anything.

---

## 4. What the crew is actually buying — and it is not a score bug

This is where I think the vertical is more attractive than it first looks.

If the pitch is "we do your score bug," you lose. OBScoreboard,
ScoreboardMax and KeepTheScore give that away for $10–30/month, setup in
60 seconds, twelve sports. You cannot win a score-bug fight and should not
enter one.

**The unmet need is that high school broadcasts have no statistics.**

A play-by-play announcer at a Friday night game is working off a roster
sheet and his own memory. He cannot tell you that the tailback has 14
carries for 112, because nobody in the stadium knows. Every college and
pro broadcast has a stat person feeding the booth. High school has nothing
— not because the value is unclear, but because the data has never existed
in a form a graphics system could read.

StatChat is the only product where the data already exists, live, in a
form a browser source can render.

So the pitch is:

> **Your broadcast gets stats.**
>
> Lower thirds with real numbers. A drive summary that is correct. A live
> stat sheet in the booth so your announcers stop guessing. The score bug
> is free — the reason to buy is everything the score bug cannot know.

Secondary, and still real: **one operator instead of two.** Every other
path has a stat keeper entering plays and a graphics operator retyping the
score ten feet away. That is a volunteer you have to find, train and keep
for eleven Friday nights, and it is the most expensive part of a small
broadcast.

The competitive position is genuinely uncontested. PressBox has the data
and has stated in its own help documentation that third-party consumption
via API or XML is not supported and is a post-launch priority. The overlay
vendors have the graphics and no data. TurboStats has both and delivers
them through a capture card.

### Handling TurboStats' strongest objection

TurboStats leads with **"internet is not required,"** aimed at the visiting
team at a small school with no usable connection. It is a well-chosen
pitch because it names a real fear.

**In this vertical it is close to a non-sequitur, and you should say so.**
A streaming crew cannot stream without internet. If they are pushing 1080p
out of that press box they have bandwidth, and video is orders of magnitude
more demanding than the feed's JSON. That claim is aimed at the sideline
stat keeper, not at the booth — for this buyer it answers a question
nobody in the room has.

The sentence to have ready:

> **"If you can stream the game, you can run StatChat. The question isn't
> whether you have internet — you can't broadcast without it. The question
> is what happens when it hiccups, and the answer is nothing: entry keeps
> going and catches up on its own."**

That reframes a binary you lose into a reliability question you win — and
it is true today, not aspirational. The offline sync queue has been live
since August 2026: entry, reload recovery, drain, undo-while-queued and
duplicate handling, with game-row writes merging and retrying on reconnect.

The objection *is* real for the stats-only tier, where the buyer may
genuinely be at a venue with no signal. See `TODO.md` §20 for the gap (no
service worker) and what closing it costs.

---

## 5. The change that actually moves penetration: sell to producers, not schools

**The crew is frequently not employed by the school.**

Local radio stations simulcasting the game. Regional streaming outfits
that cover three to five schools a week for a fee. Independent producers.
Broadcast-class teachers who also do the neighbouring school's games. In
smaller markets — Louisiana very much included — one operation may carry
half a parish.

Selling to that operator instead of to each school changes everything:

| | Sell to schools | Sell to producers |
|---|---|---|
| Deal size | 1 program | 4–10 programs |
| Buyer | Volunteer, AD approval, PO cycle | Owner, decides today |
| Training | New volunteer every year or two | One professional, trained once |
| Support contacts at 400 schools | 400 | ~65 |
| Price sensitivity | High — school budget | Lower — it is a business cost against a rate card |
| Renewal | Depends on a volunteer staying | Depends on a business continuing |

Producers already pay for tools. A vMix license runs $350–$1,200. They
buy PTZ cameras, encoders and bonded cellular. A $399–$999 season license
that makes their product visibly better than the competition down the road
is a normal purchase, not an ask.

**And it dissolves the Friday-night support constraint from
`GO_TO_MARKET.md` §9.** Seventy producers covering 420 schools is seventy
trained professionals who can read a log, not 420 volunteers ringing you
at 8:15pm. The support ceiling was never about schools. It was about
untrained operators.

**Recommended pricing revision:**

| | Price | Who |
|---|---|---|
| Program license | $399 / season | One school, self-produced |
| Producer license | $999 / season, up to 8 schools | Radio, regional streamer, independent |
| Producer unlimited | $2,500 / season | Multi-market operations |

The producer tier should not be a discount. It should be priced so that
per-school cost falls meaningfully while total revenue per relationship
rises — $999 across 8 schools is $125 each, but it is 2.5x a single
program licence for one support relationship.

---

## 6. Penetration

At SAM = 1,700 programs, selling direct to schools:

| Year | Customers | Penetration | Revenue |
|---|---|---|---|
| 2027 | 10 | 0.6% | $4,000 |
| 2028 | 40 | 2.4% | $16,000 |
| 2029 | 120 | 7.1% | $48,000 |
| 2030 | 260 | 15.3% | $104,000 |
| 2031 | 420 | 24.7% | $168,000 |

Same school count reached through producers instead:

| Year | Producers | Schools | Penetration | Support contacts |
|---|---|---|---|---|
| 2027 | 4 | 24 | 1.4% | 4 |
| 2028 | 14 | 84 | 4.9% | 14 |
| 2029 | 35 | 210 | 12.4% | 35 |
| 2030 | 70 | 420 | 24.7% | 70 |

**Is 25% realistic?** For a niche product with a real, defensible
differentiator, no direct modern competitor, and a self-qualifying
customer, 20–30% of a tightly-defined SAM is the normal ceiling for a
small operator. It is not conservative and it is not fantasy. It assumes
you do not stumble on reliability and that TurboStats does not modernise.

**The honest read on the number: this vertical alone is a $150–250K
business, not a $5M one.** That is a good outcome for one person and a bad
one for anything with employees. Which of those you are building is the
decision that everything else hangs off.

Three ways the ceiling lifts, in order of plausibility:

1. **Other sports.** Basketball is the same crew, the same vMix, the same
   winter Friday, and the engine problem is far easier than football's.
   It roughly doubles the SAM without acquiring a single new customer.
2. **The stats tier as a land-and-expand.** The crew is your beachhead
   into the school; the program licence follows. Reverse of the usual
   direction, and better, because the crew is a professional and the
   volunteer statistician is not.
3. **Association or conference deals**, per `GO_TO_MARKET.md` §7.

---

## 7. Distribution — and this is the part that differs most from the general plan

**The general GTM says Louisiana first, clinics, regional. For this
vertical that is wrong.**

Streaming crews do not cluster geographically. They cluster *online*, and
they are unusually easy to reach:

- The vMix user forums and vMix Facebook groups
- Sports-streaming Discords, r/VIDEOENGINEERING, r/livestreaming
- The PTZOptics / BirdDog / NewBlueFX orbit — vendors that actively
  publish high school production case studies
- YouTube: "high school football livestream setup" is a real content niche
  with real audiences of exactly your buyer
- Sports Video Group and the small-market broadcast trade press

**You can go national on day one in this vertical.** There is no clinic
circuit to work and no geography to respect. A single well-made video —
"we put live stats on a high school football broadcast, here is the vMix
setup" — reaches more qualified buyers than a season of LHSCA booths.

Two channel moves worth more than anything else:

**Get listed by vMix.** vMix publishes solution and case-study pages for
production setups. A documented StatChat integration is free distribution
to precisely the right list, and vMix has an incentive to show off what
their Web Browser input can do.

**Make Neville the reference tape, not the reference customer.** For this
audience the case study is not a testimonial, it is footage. Fifteen
seconds of a lower third reading real rushing numbers, on a real Friday
night, with a coach's voice over it, does more than any deck. Capture that
this season deliberately — it is the single most valuable asset you can
produce in 2026 and it costs nothing but remembering to record.

---

## 8. Revised summary

- **TurboStats is the incumbent, not PressBox.** ~$450 first year, HDMI
  green screen, Windows only. That is the anchor and it is beatable on
  architecture.
- **Pixellot's 8,896 schools are not a market you lost.** They are a free
  filter that pre-qualifies every remaining lead.
- **SAM is roughly 1,700 programs.** Verify the crewed-rate assumption
  with a fifty-school hand survey of Louisiana before spending anything.
- **Sell stats, not a score bug.** The score bug is free everywhere. No
  high school broadcast in America has live statistics, and you are the
  only one who can supply them.
- **Sell to producers, not schools.** It multiplies deal size, collapses
  the support problem, and reaches a buyer who already spends money on
  tools.
- **Go national immediately.** This audience lives in vMix forums, not at
  coaching clinics.
- **The ceiling is $150–250K/year at ~25% penetration.** Basketball
  doubles the SAM. Decide whether that ceiling is the business you want
  before you build for it.
