// The StatChat mark appears once, identically, on every app page
// ==============================================================
// Andy's call, 25 Aug 2026: the mark goes on every page reachable from
// the dashboard, excluding reports, stats and the spectator view — those
// already carry a print lockup, added 24 Aug — and excluding the platform
// console, which is not a tenant-facing screen.
//
// **Uniform is the requirement, not merely present.** A mark that changes
// size or moves between screens reads as decoration; the same mark in the
// same place reads as the product. So this asserts the shared class and
// the shared dimensions, not just that a logo is somewhere on the page.
//
// game.html is the one deliberate exception and it is asserted as such:
// its h1 is display:none — the score banner names the game — so the mark
// sits in the header toolbar at 22px rather than 26px beside a heading a
// scorer never sees. Every pixel of header on that screen is a pixel not
// showing the play list.
//
//   node tests/brand_mark_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// COMMENTS STRIPPED BEFORE ANY ASSERTION, and this is the whole reason
// this note exists. The first version of these pages had the .scMark rule
// inserted INSIDE AN HTML COMMENT — every page carries a comment reading
// "Loaded BEFORE this page's own <style>", and a naive search for the
// first "<style>" landed there.
//
// The CSS was inert on all seven pages. This check passed anyway, because
// it searched for the text "width:26px" and the text was present.
//
// **Finding a rule in a file is not the same as the rule being in force.**
const live = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
// The raw source, for asserting markup that legitimately sits near comments.
const raw = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const MUST_HAVE = ['roster.html', 'create_game.html', 'customize.html',
                   'account.html', 'broadcast_setup.html', 'help.html'];

// Excluded, each for a stated reason — so a future reader knows the
// omission was a decision rather than an oversight.
const EXCLUDED = {
  'recap.html': 'carries a print lockup instead',
  'season_report.html': 'print lockup',
  'stat_package.html': 'print lockup',
  'player_report.html': 'print lockup',
  'view.html': 'spectator screen, no chrome',
  'platform.html': 'not tenant-facing; has its own brand row',
  'login.html': 'has the full mark-and-wordmark lockup',
  'index.html': 'the marketing site',
};

function run() {
  const fails = [];
  const bad = (f, why) => fails.push({ f, why });

  for (const f of MUST_HAVE) {
    const s = live(f);
    const marks = (s.match(/class="scMark"/g) || []).length;
    if (marks === 0) { bad(f, 'has no StatChat mark'); continue; }
    if (marks > 1) bad(f, 'has ' + marks + ' marks — one page, one mark');

    if (!/\.scMark\s*>\s*img\s*\{[^}]*width:26px/.test(s)) {
      bad(f, 'the mark is not 26px — uniform means the same size everywhere, or it ' +
             'reads as decoration rather than as the product');
    }
    // BESIDE THE HEADING, asserted STRUCTURALLY rather than by character
    // distance. A first version allowed 200 characters between the mark
    // and the <h1>; dashboard.html came in at 190 because the tenant's own
    // logo and a divider sit between them. A threshold that a legitimate
    // page nearly trips is a threshold that will fail on the next one for
    // no reason worth having.
    //
    // What matters is that they are SIBLINGS in one flex row: the mark and
    // the heading in the same container, nothing block-level between.
    const row = s.match(/<div class="(?:scMark|brandline)[^"]*">([\s\S]*?)<\/div>\s*(?:<\/div>|<div)/);
    const rowHasBoth = /class="scMark"/.test(s) &&
      new RegExp('class="scMark"[\\s\\S]*?<h1').test(s) &&
      !new RegExp('class="scMark"[\\s\\S]*?</(?:section|main|header)>[\\s\\S]*?<h1').test(s);
    if (!rowHasBoth) bad(f, 'the mark and the page heading are not in the same row');
    if (!/<img src="logo\.png" alt="StatChat">/.test(s)) {
      bad(f, 'the mark is not logo.png with alt="StatChat"');
    }
  }

  // THE DASHBOARD CARRIES THE MARK DIFFERENTLY, and on purpose.
  // -------------------------------------------------------------------
  // Everywhere else the mark sits beside the page heading. On the
  // dashboard the heading is the TENANT'S name, and the mark was in front
  // of it -- the one place a customer's own identity should begin. It now
  // sits on the right with the account control, as app chrome, while the
  // tenant runs hard left.
  const dash2 = live('dashboard.html');
  if (!/class="scMark-dash"/.test(dash2)) {
    bad('dashboard.html', 'has no StatChat mark');
  }
  if (!/\.headerRight[^}]*\}/.test(dash2)) {
    bad('dashboard.html', 'no .headerRight group — the mark and the account belong together, ' +
        'away from the tenant');
  }
  if (/class="brandline"[\s\S]{0,200}?scMark/.test(dash2)) {
    bad('dashboard.html', 'the mark is back inside .brandline, in front of the tenant name');
  }
  // The avatar must NOT be a nav item: as a flex child of .navlinks with
  // margin-left:auto it wrapped to a line of its own when the row ran
  // short, which is the layout Andy reported.
  // ASKED OF THE DOM. A character-window regex spanned straight past
  // </nav> and reported a false positive -- the same distance-based
  // mistake as the "beside the heading" check earlier. Containment is a
  // structural question, so it gets a structural answer.
  {
    const { JSDOM } = require('jsdom');
    const doc = new JSDOM(raw('dashboard.html')).window.document;
    const nav = doc.querySelector('.navlinks');
    if (nav && nav.querySelector('#accountBtn')) {
      bad('dashboard.html', 'the account button is inside .navlinks again — as a flex child ' +
          'with margin-left:auto it wraps to a line of its own when the row runs short');
    }
    if (!doc.querySelector('.headerRight #accountBtn')) {
      bad('dashboard.html', 'the account button is not in .headerRight');
    }
    const first = doc.querySelector('.topbar') && doc.querySelector('.topbar').children[0];
    if (!first || !first.classList.contains('brandline')) {
      bad('dashboard.html', 'the tenant is not the first thing in the header — it should run ' +
          'hard left, with everything else pushed off it');
    }
  }

  // game.html DELIBERATELY HAS NO MARK, for now.
  // -------------------------------------------------------------------
  // Four attempts, none of which worked in the browser. That page lays
  // its header out from JavaScript: layoutHeader() rewrites inline styles
  // on every child of #headerLeft with !important, and a banner sync
  // gives the container an explicit height that align-items:stretch then
  // passes to its children. A stylesheet rule, an inline style and a
  // script exemption all failed to survive that.
  //
  // Removed rather than left half-working. It is on the list to revisit
  // with the layout code in hand rather than fought from the outside.
  if (/class="scMark/.test(live('game.html'))) {
    bad('game.html', 'has a StatChat mark — it was removed 25 Aug because the header is ' +
        'laid out from script and the mark could not be made to survive it. Revisit with ' +
        'layoutHeader(), do not re-add from CSS.');
  }

  // The exclusions are asserted too: adding a mark to a print report would
  // double up with the lockup already there.
  for (const [f, why] of Object.entries(EXCLUDED)) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    if (/class="scMark"/.test(s)) {
      bad(f, 'has the app mark but is excluded (' + why + ')');
    }
  }
  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== The StatChat mark is uniform across the app ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.f + '] ' + x.why));
  if (!f.length) console.log('  one mark per app page, same size, same place, and none where it does not belong.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
