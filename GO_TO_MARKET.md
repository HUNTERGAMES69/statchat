# Go to market

RECONSTRUCTED 23 Aug 2026 from session notes, after the original was
found to be missing from the repo. Andy's memory wins over anything
here — flag a contradiction rather than acting on it.

---

## Who this is for

**Crewed streaming broadcast crews.** Not the broad high-school stats
market. A crew running a live stream with vMix, a camera operator and a
commentator — people for whom the broadcast overlay is the product and
the stat sheet is a by-product.

That focus is what makes StatChat defensible. It is also what limits
the addressable market, and the two facts have to be held together.

## The competition

**TurboStats** — roughly $450/year. Windows desktop, requires a capture
card. The incumbent for crews that already do this seriously. StatChat's
case against it: browser-based, no capture hardware, overlays that
composite directly in vMix.

**SnapStat** — $179/year. Offline, mobile-first, no broadcast output.
Cheaper and easier for a school that just wants stats. StatChat has no
answer on price and does not need one — SnapStat has no answer on
broadcast.

**The exception that matters:** SnapStat being mobile-first is a real
objection outside the crewed-broadcast core. "You need a laptop at the
table" is something they can beat StatChat on. That is the commercial
argument for the iPad work, and why it was done before multi-tenancy.

## Pixellot — removed from the market, and useful anyway

Roughly **8,900 schools** run Pixellot installations via NFHS Network /
PlayOn. Automated cameras, no crew.

Those schools are **permanently out of the addressable market** — there
is no crew to sell to. But knowing which schools they are is valuable in
the other direction: a school that has NOT taken the Pixellot deal and
still streams is, by definition, running a deliberate, funded, crewed
operation. That pre-qualifies the remaining leads better than any other
signal available.

## Pricing — SETTLED 24 August 2026

    $250 / year        one school, football, everything included

**One product. One price. No tiers.** Decided by Andy on 24 Aug and now
live on statchat.co and on the flyer.

Everything is in it: unlimited games, unlimited users, Crew View, the
JSON and XML feeds, the ready-made transparent overlay, PDF and Excel
reports, public recap links, season reporting. There is no upgrade and
nothing held back.

### What this replaced, and why the change is worth understanding

The earlier scheme was four tiers — $399 program, $999 producer for up to
eight schools, $2,500 producer unlimited, and an unsettled $149
stats-only. It is gone, and two arguments died with it:

  * **The stats-only tier was an open decision.** Resolved by deletion.
    It competed on SnapStat's ground at a lower price, against a product
    built for that market, and required engineering StatChat would not
    otherwise do.
  * **The producer tiers were called "the interesting ones"** — eight
    schools for two and a half times the price, one sales conversation
    instead of eight. That argument was sound and is now unavailable at
    this price. A production company covering eight schools pays $2,000
    rather than $999, which is better revenue but a harder conversation
    and eight separate accounts to administer.

**The case FOR one price:** every tier is a decision the buyer has to
make before they have used anything, and a coach comparing four rows is
a coach not booking a demo. $250 also sits below the psychological line
where a high-school athletics budget needs a second signature, which is
a different and easier sale from the one the producer tiers imagined.

**The case AGAINST, worth revisiting once there are customers:** it
leaves money on the table with multi-school producers, who are the
segment the whole GTM document identifies as the best-qualified leads.
If producers turn out to be where the volume is, a producer arrangement
can be added later as a discount off eight seats rather than as a
separate product — which keeps one price and one thing to explain.

**Football only, for now.** More sports are advertised as coming; none
is built. Nothing should be sold on a sport that does not exist yet.

## What has to be true before selling

  * **Multi-tenancy.** Cannot serve a second school without it. See
    `MULTI_TENANT_PLAN.md`; step 0 is versioning the schema.
  * **iPad support.** Done for portrait as of 23 Aug. Landscape rails
    deferred — see TODO.
  * **The season report has to be presentable.** It is the artefact a
    coach hands to someone else, and its formatting does not currently
    scale from game 1 to game 15. See TODO.
