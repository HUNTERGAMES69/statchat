# StatChat — START HERE

Read this first, then `TODO.md`, then `PROJECT_NOTES.md`.

Last updated **23 August 2026**. This file replaces a 22 Aug handoff
that had gone stale; the detail it carried is in PROJECT_NOTES.

---

## What StatChat is

A web-based high-school football statistics and live-broadcast platform,
built for the Neville program. Andy is the developer, owner and sole
operator. He enters every play himself, from a laptop, during the game.

  Repo        github.com/HUNTERGAMES69/statchat  (public)
  Deploy      GitHub -> Vercel, nevillestatchat.vercel.app
  Backend     Supabase, project id pboushzlcyfkssojpuut
  Stack       vanilla JS/HTML, serverless API endpoints, no framework

**Not mid-season.** This is the time to make the design right rather
than patch around it.

## The documents, and what each is for

  HANDOFF.md            this file — orientation
  TODO.md               open work, ordered. Start at the top.
  PROJECT_NOTES.md      WHY past decisions were made. Read before
                        changing anything they cover.
  MULTI_TENANT_PLAN.md  the plan for selling to a second school
  GO_TO_MARKET.md       market, competitors, pricing

MULTI_TENANT_PLAN and GO_TO_MARKET were reconstructed on 23 Aug after
being found missing from the repo. Andy's memory outranks both.

## Where things stand

Desktop is **done** — the entry app on a laptop is the product as
intended. iPad portrait is usable and is the bar for showing new users.

Order of work, decided 23 Aug:

    1. iPad portrait      DONE
    2. Multi-tenant       NEXT, starting with Step 0 (schema versioning)
    3. Everything else

Immediately outstanding, both in TODO with specifics:

  * **Season report formatting** does not scale from game 1 to game 15.
    Nine per-game charts grow all season; six aggregates do not. TODO
    lists exactly which. Do not start without seeing PDFs at 1, ~6 and
    ~15 games.
  * **Landscape iPad rails** — deferred after four failed attempts. The
    failure notes matter more than the design; read them.

## How to work on this

**Pull current files** from
`raw.githubusercontent.com/HUNTERGAMES69/statchat/main/` at session
start, and check against what Andy last uploaded — GitHub can lag and an
upload can fail silently. It did so three times on 23 Aug. Confirm the
destination path with every file delivered.

**Read the code path before proposing a cause.** Guessing and testing is
a known inefficiency here.

**THE TEST HARNESS CANNOT SEE ANYTHING VISUAL.** jsdom has no layout
engine, ignores `@media` entirely, and cannot resolve `!important`
conflicts. It reports styling changes as correct almost regardless. Most
of an afternoon on 23 Aug went into iPad fixes that tested green and did
nothing in the browser. For visual work: say so plainly, batch the
changes, ask Andy to look ONCE. Anything scoped to a media query must be
asserted from the SOURCE TEXT, not getComputedStyle, or the check cannot
fail.

**Revert every fix and confirm the test fails.** A test that cannot fail
is worse than no test — that has caught false greens repeatedly.

**Do not create or edit files in `tests/` mid-session.** Verify ad hoc,
then write all test changes as one batch at wrap-up.

**`engine.js` changes require `tests/accuracy_check.js`.** Review every
golden-snapshot difference before re-blessing, and deliver
`accuracy.golden.json` alongside.

**NFHS, not NFL.** Sack yardage is charged to team rushing; kneels and
bad snaps are team rushes; the defence cannot score or take possession
on a try; a missed FG reaching the end zone is a touchback at the 20.
Verify rule applicability before implementing.

## Andy

Direct and decisive; makes design calls quickly and commits to them.
Provides screenshots and live descriptions as evidence, and expects
reasoning from actual code rather than assumptions. Flags UI regressions
immediately from real use. Wants each architectural decision explained
in plain terms BEFORE implementation, and the reasoning recorded in
PROJECT_NOTES rather than left in chat.

He is not a programmer. Do not ask him to read computed styles out of a
browser inspector or run commands — that was tried on 23 Aug and was
not a reasonable ask.

He catches tests that are kinder than reality. On 23 Aug his first live
test of return stats entered **-39 yards**, which found a display bug the
fixtures (24 and 11) would never have surfaced.
