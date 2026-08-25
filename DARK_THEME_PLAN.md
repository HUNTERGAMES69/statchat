# Taking the app dark — a plan

Written 25 August 2026, after `view.html` was converted. That page is the
worked example: everything below is what it taught, generalised.

---

## The decision to make before any of it

**Dark is right for a control room. It is not obviously right for a coach
on a laptop in a bright office at 4pm.**

`view.html` is watched in a dark room by a broadcast crew, which is why it
went first and why it was easy to justify. The dashboard, the roster page
and Customize are used in daylight, often on a cheap laptop with a matte
screen. Dark there is a preference, not an improvement, and it is the sort
of preference that a customer notices and cannot change.

Three honest options:

| | |
|---|---|
| **A. Everything dark** | One look, maximum continuity with the brochure. Risks the daylight case on pages nobody asked to change. |
| **B. Dark where it earns it** | `view.html` (done), the broadcast pages, `platform.html`. The tenant-facing app stays light. Least risk, least continuity. |
| **C. Dark everywhere, with a light toggle** | Honest answer to a question that genuinely has two answers. Most work, and a preference has to live somewhere per user. |

**Recommendation: A, but staged so B is a stopping point.** The order below
does the low-risk pages first, and if a coach reacts badly to a dark
dashboard, everything after that step can simply not happen. Nothing in the
plan is wasted if it stops early.

**Do not start until this is decided.** Half a dark app is worse than
either whole.

---

## What makes this bigger than it looks

`view.html` was 21 changed lines. It was also the page whose colours were
most concentrated. The survey across every page:

```
page                     links statchat.css   light-bg rules   dark inline colours
game.html                      yes                 57                 23
game_legacy.html               NO                  51                 21
stat_package.html              yes                  9                  2
dashboard.html                 yes                  8                  6
roster / recap / season_report yes                  7                each 1-3
player_report.html             yes                  7                  1
create_game / account          yes                  5                3-6
platform / view / customize    yes                2-4                1-4
broadcast_setup / login        yes                1-2                2-5
help.html                      yes                  3                  6
broadcast*.html (3)            NO                 0-1                0-5
```

Two numbers matter:

**Light background rules** are the easy half. They are in stylesheets and a
token flip reaches them.

**Dark inline colours are the hard half**, and they are the reason
`view.html` took two passes. `color:#111` written inline cannot be reached
by any stylesheet rule, at any specificity. Eleven of them were found on
`view.html`; **`game.html` has 23 and `game_legacy.html` 21.**

---

## The architecture question, and why it decides the effort

`statchat.css` already defines surface tokens:

```
--sc-page  --sc-card  --sc-ink  --sc-ink-soft  --sc-ink-muted
--sc-rule  --sc-rule-strong
```

and 18 of 20 pages link it. **If pages used those tokens, going dark would
be one file changed.** They do not — they hardcode `#fff`, `#f5f7fa`,
`#eef1f5` and so on, so the tokens exist and mean nothing.

So there are two shapes this can take:

**The fast one:** append a dark override block to each page, as `view.html`
got. Twenty blocks, each duplicating the last, each needing maintenance.
This is the same fault as the branding columns copied onto `tenants` in
migration 006 — *a duplicated definition is a bug with a delay on it.*

**The durable one:** convert each page's hardcoded colours to the existing
tokens, then flip the tokens once in `statchat.css`. Same total work,
spread across the same pages, but it ends with one place to change and a
light/dark toggle becomes possible almost for free.

**Do the durable one.** The fast one is only faster on page one.

---

## Order of work

Each step is independently shippable and independently revertable.

### Step 0 — the token layer and the audit tool (half a day)

1. Add the brochure's dark values to `statchat.css` as a second token set,
   not yet applied:
   ```css
   :root        { --sc-page:#f4f3ef; --sc-card:#fff;    ... }   /* today */
   :root[data-theme="dark"]
                { --sc-page:#10141a; --sc-card:#191f27; ... }   /* new */
   ```
   Values come from `index.html` — `--ink`, `--panel`, `--raise`, `--edge`,
   `--mute`, `--paper`, `--brand`, `--data`. **Do not invent a second dark
   system**; the brochure already has one and continuity is the point.

2. Write `tests/contrast_check.js`. This is the tool that makes the rest
   safe. For every page it should:
   - compute the WCAG ratio of each text colour against the surface behind
     it, and fail below 3:1 for large text, 4.5:1 for body;
   - list every **inline** colour, because those are invisible to a token
     flip and are the ones that bite;
   - be runnable per page, so a conversion can be checked as it is done.

   On `view.html` this found nine problems the eye missed. Do not convert a
   page without it.

### Step 1 — the pages that earn it (1 day)

`platform.html`, `login.html`, `broadcast_setup.html`.

Low traffic, no printing, no tenant colour to negotiate. `platform.html` in
particular is a console the customer never sees, so it is a free rehearsal.

**Stop here and look at it before going further.**

### Step 2 — the tenant-facing app (2–3 days)

`dashboard.html`, `roster.html`, `customize.html`, `create_game.html`,
`account.html`, `reports.html`, `help.html`.

This is the step a customer notices. It is also where the daylight question
gets answered for real, so ship it to one tenant first if that is possible.

`help.html` prints — see the print section below.

### Step 3 — NOT DOING: the printed reports stay light

**Decided 25 August after seeing the mocks.** `recap.html`,
`stat_package.html`, `season_report.html` and `player_report.html` keep
their original colours.

They are documents, not screens. They are printed, emailed to local media
and read on paper, and a dark screen version of a thing whose real form is
white is two designs to maintain for one artifact. `reports.html` — the
landing page that chooses a season — does go dark, because it is a screen.

This also removes the biggest risk in the original plan: no print reset to
get wrong, and no wasted ream.

### Step 3 (was) — the reports, superseded above

`recap.html`, `stat_package.html`, `season_report.html`,
`player_report.html`.

**These print, and paper is white.** Every one already has an
`@media print` block; each will need that block to reassert light values,
because a dark screen theme will otherwise send charcoal to a printer. This
is the step most likely to produce a wasted ream, so test by printing to
PDF, not by looking at the screen.

Chart.js colours in `season_report.html` and `player_report.html` are set
in JavaScript, not CSS. They are the same problem as inline colours and
need the same treatment.

### Step 4 — the game page (2–3 days on its own)

`game.html`. **57 light rules and 23 inline colours, and it is the page a
scorer uses live.**

It also has the header machinery documented in `PROJECT_NOTES.md` — a rule
at `#headerLeft > *` with `!important` that overrules class rules, plus
`layoutHeader()` rewriting inline styles at runtime. Adding a 32px logo
there took seven attempts. **Budget accordingly, and verify in a browser
rather than by reading the file.**

Do this last, when the pattern is settled and boring.

### Not in scope

**`broadcast.html`, `broadcast_stats.html`, `broadcast_leaders.html`** —
these are transparent overlays keyed over live video. They have no
background by design and must not acquire one. Leave them alone.

**`game_legacy.html`** — 51 light rules, 21 inline colours, and it does not
even link `statchat.css`. Decide whether it is still reachable before
spending a day on it; if it is dead, delete it instead.

**`index.html`** — already the dark source of truth.

---

## THE RECIPE — settled on login.html, 25 August 2026

Apply this to every page. It is not a style guide; every line is here
because getting it wrong produced a visible bug on a page that had
already been "converted".

### The token block

Paste this into the page's own `<style>`, at the top. When every page is
converted these values move into `statchat.css` and the per-page blocks
come out.

```css
:root{ color-scheme:dark; }
:root{
  --sc-page:#10141a;   --sc-card:#191f27;   --sc-raise:#20272f;
  --sc-ink:#eef1f4;    --sc-ink-soft:#c7d0da;  --sc-ink-muted:#8d99a6;
  --sc-rule:#2b333d;   --sc-rule-strong:#6b7d8f;
  --sc-navy:#2f3a47;   /* A BUTTON FILL. Never text. See below. */
  --sc-green:#a3d93f;  --sc-green-tint:rgba(124,181,24,.14);
  --sc-red:#ff8fa3;    --sc-red-tint:rgba(176,0,32,.16);
  --sc-amber:#ffc72c;  --sc-amber-tint:rgba(255,199,44,.13);
  --sc-link:#7cb518;
}
```

### The rules, and the bug each one prevents

**`--sc-navy` IS A BUTTON FILL, NOT AN INK.** It reads like an ink name and
it is not. Pointing it at a dark value and letting text inherit it has now
caused two bugs: `game.html`'s play ladder vanished at 1.00:1 against the
page, and `login.html`'s STATCHAT wordmark at 1.43:1 against the card.
**Before re-pointing any token, grep for what reads it.**

**Buttons need a border, not a lighter fill.** No fill reaches the 3:1 WCAG
floor for a non-text boundary against `#191f27` without going light grey —
`#2f3a47` is 1.43:1. So: fill `var(--sc-navy)` for the affordance, `1px
solid var(--sc-rule-strong)` for the edge, which is 3.91:1. `border:none`
works on white and nowhere else.

**Disabled is a colour, not an opacity.** `opacity:0.6` on dark dims toward
the background rather than toward grey, so a disabled button becomes hard to
find. Use `background:#1b2129; color:#5f6b78; border-color:#333f4b;
opacity:1`. That is 3.05:1 — deliberately below body AA, because it must
read as unavailable while staying findable.

**Inputs are recessed.** `background:var(--sc-raise)` (darker than the
card) with `border:1px solid var(--sc-rule-strong)`. A card-coloured input
with a hairline looks painted on.

**`color-scheme:dark` is mandatory.** Without it the browser paints its own
chrome light — scrollbars, caret, spinners, and the yellow-white fill
Safari and Chrome put behind **autofilled** fields. On any page with a
login form that is the normal path, not an edge case.

**WebKit autofill needs telling twice**, because it paints with an inset
shadow no background rule reaches:
```css
input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus{
  -webkit-text-fill-color:var(--sc-ink);
  -webkit-box-shadow:0 0 0 1000px var(--sc-raise) inset;
  caret-color:var(--sc-ink);
  transition:background-color 9999s ease-out 0s;
}
```

**A visible focus ring.** The default is a thin dark outline that
disappears on a dark card. `outline:2px solid var(--sc-link);
outline-offset:2px` on `:focus-visible`.

**The logo needs a plate.** `logo.png` is dark-on-light artwork and sinks
into the card. `background:#fff; padding:2px; box-sizing:border-box` on the
img. The mark is not being redrawn for a theme.

**The wordmark is the brightest thing on the card** — `#fff`, 16.58:1. It
is the brand; it should not be dimmer than the body text.

**Tenant colour is an accent, never a fill.** It comes from the database
and a school may pick something pale. Filled, it is a bright hole in a dark
screen and any `safeTextColor()` logic then flips the label, so two teams
end up with different contrast. A 5px spine on a `#171d25` bar works for
every colour.

### Spacing: the header must read as a header

Reported on the dashboard 25 Aug and it applies everywhere. Two shapes:

**Pages where the tools sit ABOVE the title** (dashboard): the row gap was
12px, which made the buttons and the tenant's name read as one crowded
block. **26px**, so the name is the title and the buttons are chrome above
it. The column gap stays 16px — that one is between buttons and was fine.

**Pages where the title and the Dashboard button share a row** (everything
else): the row ran straight into the content beneath it.
**`margin-bottom:18px`** on the header row.

A header that touches its content is not a header.

### Sign-off, per page

Not "it looks fine":

1. `node tests/contrast_check.js <page>` passes — it resolves the tokens
   and reports every colour against the card.
2. No hardcoded light background survives. **Find them by luminance, not
   by listing names** — an enumerated list missed 7 on `game.html` and 23
   across the other mocks.
3. Tab through it on a desktop: the focus ring must be visible.
4. On a phone: **an autofilled field**, which is the one that looks broken.
5. If the page prints, print it to PDF.
6. If it shows tenant colour, view it with a pale primary — gold or
   silver, not Neville's.

### What is NOT converted

The four printed reports — `recap`, `stat_package`, `season_report`,
`player_report` — stay light by decision. They are documents whose real
form is paper. `reports.html`, the landing page, does go dark.

The three broadcast overlays are transparent by design.

## The five traps, all found the hard way on view.html

**1. Inline colours cannot be reached from a stylesheet.** Not at any
specificity, not with `!important`. `color:#111` in a template string has
to be edited in the template. Grep each page for
`color:#[0-4]` before starting and fix those first.

**2. Tenant colour must become an accent, never a fill.** Team colours come
from the database and a school may pick something pale. On `view.html` the
team bar was filled with it inline, and `safeTextColor` then flipped the
label to near-black — so the two teams' headers had different contrast. A
5px spine on a dark bar solves it everywhere and is the pattern to reuse.

**3. Greys chosen against white are invisible on charcoal.** `#5b6068` is a
comfortable label colour on white and 2.6:1 on `#191f27`. There were four
distinct such greys on `view.html`. The audit tool catches these; the eye
does not.

**4. Print blocks must reassert light.** Five pages print. A dark theme
without a print reset sends charcoal panels to a printer.

**5. Find light panels by LUMINANCE, not by listing them.** Converting the
mocks, an enumerated list of light colours missed seven on `game.html` and
twenty-three across the rest — `#e9edf3`, `#eaf5ea`, `#fffaf0`, and so on.
Colours that mean "a pale notice panel" are not a set anybody can recall.
Compute the luminance of every background and convert anything above 0.5,
with an explicit keep-list for the deliberate highlights (`#ffc72c`).

**6. Never point a token at a value without checking what USES it.**
`--sc-navy` looks like an ink colour. In `game.html` it is
`button { background:var(--sc-navy) }` — the fill for the entire play-entry
ladder. Pointed at `#0f141a` it landed 1.00:1 against the page and every
button vanished.

**7. Buttons on dark need a BORDER, not a lighter fill.** No fill reaches
the 3:1 WCAG floor for a non-text boundary against a dark card without
going light grey: `#2f3a47` on `#191f27` is 1.43:1. The fill carries the
affordance; a 1px `#6b7d8f` border carries the edge at 3.91:1. And
`opacity:0.5` for disabled is close to invisible on dark — give it a floor
colour instead, or a greyed-out "Redo last" cannot be found.

**8. Append, do not replace.** On `view.html` the theme was appended after
the existing CSS so every size, position and scaling rule survived
untouched. That page is a fixed 1920×1080 surface with a transform scale
and its geometry is load-bearing. The same caution applies to `game.html`.

---

## How each page is signed off

Not "it looks fine". Four checks, all cheap:

1. `tests/contrast_check.js` passes for that page.
2. No `color:#[0-4]…` remains outside comments.
3. For a printing page: printed to PDF and read on paper.
4. For a page with tenant colour: viewed with a **pale** primary — gold or
   silver — not just Neville's.

---

## Rough total

Six to nine working days, spread across four shippable steps, plus half a
day of setup. `game.html` is a third of it on its own.

The plan front-loads the safe pages deliberately: after Step 1 there is
something real to look at, and after Step 2 the question of whether a coach
wants a dark dashboard has an actual answer rather than a guess.
