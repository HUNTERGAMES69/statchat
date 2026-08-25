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

const MUST_HAVE = ['roster.html', 'create_game.html', 'customize.html',
                   'account.html', 'broadcast_setup.html', 'help.html'];
const TOOLBAR = 'game.html';

// Excluded, each for a stated reason — so a future reader knows the
// omission was a decision rather than an oversight.
const EXCLUDED = {
  'recap.html': 'carries a print lockup instead',
  'season_report.html': 'print lockup',
  'stat_package.html': 'print lockup',
  'player_report.html': 'print lockup',
  'view.html': 'spectator screen, no chrome',
  'platform.html': 'not tenant-facing; has its own brand row',
  'dashboard.html': "the tenant's own home — shows THEIR logo and name",
  'login.html': 'has the full mark-and-wordmark lockup',
  'index.html': 'the marketing site',
};

function run() {
  const fails = [];
  const bad = (f, why) => fails.push({ f, why });

  for (const f of MUST_HAVE) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const marks = (s.match(/class="scMark"/g) || []).length;
    if (marks === 0) { bad(f, 'has no StatChat mark'); continue; }
    if (marks > 1) bad(f, 'has ' + marks + ' marks — one page, one mark');

    if (!/\.scMark\s*>\s*img\s*\{[^}]*width:26px/.test(s)) {
      bad(f, 'the mark is not 26px — uniform means the same size everywhere, or it ' +
             'reads as decoration rather than as the product');
    }
    // The wrapper must actually contain the heading, or the mark is
    // floating somewhere near it rather than beside it.
    if (!/class="scMark">[\s\S]{0,200}?<h1/.test(s)) {
      bad(f, 'the mark is not beside the page heading');
    }
    if (!/<img src="logo\.png" alt="StatChat">/.test(s)) {
      bad(f, 'the mark is not logo.png with alt="StatChat"');
    }
  }

  const g = fs.readFileSync(path.join(ROOT, TOOLBAR), 'utf8');
  if (!/class="scMark-inline"/.test(g)) bad(TOOLBAR, 'has no StatChat mark in the header');
  if (!/\.scMark-inline\s*\{[^}]*width:22px/.test(g)) {
    bad(TOOLBAR, 'the toolbar mark is not 22px');
  }

  // The exclusions are asserted too: adding a mark to a print report would
  // double up with the lockup already there.
  for (const [f, why] of Object.entries(EXCLUDED)) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8');
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
