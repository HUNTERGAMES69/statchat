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

## Pricing

    Program license        $399 / season       one school
    Producer license       $999                up to 8 schools
    Producer unlimited     $2,500
    Stats-only             $149                <- OPEN DECISION

**The $149 stats-only tier is not settled.** It competes on SnapStat's
ground at a lower price, against a product built for that market, and it
requires engineering StatChat would not otherwise do. The argument for
it is a foot in the door at schools that later add a crew. The argument
against is that it splits focus and invites comparison on the one axis
where StatChat is weaker. Decide before building toward it.

The producer tiers are the interesting ones: a single production company
covering eight schools is eight times the value at two and a half times
the price, and it is one sales conversation instead of eight.

## What has to be true before selling

  * **Multi-tenancy.** Cannot serve a second school without it. See
    `MULTI_TENANT_PLAN.md`; step 0 is versioning the schema.
  * **iPad support.** Done for portrait as of 23 Aug. Landscape rails
    deferred — see TODO.
  * **The season report has to be presentable.** It is the artefact a
    coach hands to someone else, and its formatting does not currently
    scale from game 1 to game 15. See TODO.
