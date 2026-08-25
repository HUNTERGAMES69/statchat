// One way back, and it looks the same everywhere
// ==============================================
// Five pages have a link to the dashboard and, until 25 Aug 2026, three
// different treatments between them:
//
//   customize.html        `a.backlink`  — a bordered button
//   roster.html           inline styles — the same values, spelled out
//   help.html             `.back`       — a plain green text link
//   broadcast_setup.html  `.back`       — a plain green text link
//   create_game.html      nothing at the top at all; only a "Cancel" beside
//                         Create game at the very bottom, which is a form
//                         action rather than a way out, and a long scroll
//                         away on a page that tall.
//
// **The way out of a page should not depend on which page it is.** All
// five now use the same class with the same declarations and the same
// label.
//
// The rules are compared NORMALISED — order and whitespace ignored — so
// this fails on a real difference rather than on someone reformatting one
// copy.
//
//   node tests/back_button_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

const PAGES = ['customize.html', 'roster.html', 'help.html',
               'broadcast_setup.html', 'create_game.html', 'reports.html'];

// The canonical header row, taken from roster.html. Every page puts the
// button in the SAME PLACE -- top of the card, right-justified, level with
// the heading. help.html and broadcast_setup.html had it floating above
// the card as a loose child of .wrap instead, so the one control a reader
// looks for when they are lost was the one that moved between pages.
const norm2 = css => (css || '').replace(/\s+/g, ' ').split(';')
  .map(x => x.trim()).filter(Boolean).sort().join('; ');

const norm = css => css.replace(/\s+/g, ' ').split(';')
  .map(x => x.trim()).filter(Boolean).sort().join('; ');

function run() {
  const fails = [];
  const bad = (f, why) => fails.push({ f, why });
  const rules = {}, rowStyles = {};

  for (const f of PAGES) {
    const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // Comments stripped: a rule inside an HTML comment is inert, and three
    // separate bugs earlier today were exactly that.
    const live = raw.replace(/<!--[\s\S]*?-->/g, '');
    const doc = new JSDOM(raw).window.document;

    const a = doc.querySelector('a.backlink[href="dashboard.html"]');
    if (!a) { bad(f, 'no .backlink to the dashboard'); continue; }
    if (a.textContent.trim() !== '\u2190 Dashboard') {
      bad(f, 'the label is "' + a.textContent.trim() + '", not "\u2190 Dashboard"');
    }

    // SAME PLACE, not merely present: a flex row with the heading, and the
    // button as its LAST child so it lands on the right.
    const row = a.parentElement;
    const rowStyle = norm2(row.getAttribute('style'));
    if (!/justify-content:\s*space-between/.test(rowStyle)) {
      bad(f, 'the button is not in a space-between row with the heading — it is at ' +
             '<' + row.tagName.toLowerCase() + ' ' + (row.className || rowStyle).slice(0, 40) + '>');
    }
    if (row.lastElementChild !== a) {
      bad(f, 'the button is not the last thing in its row, so it will not sit right-justified');
    }
    if (!row.querySelector('h1')) {
      bad(f, 'the button is not level with a heading');
    }
    rowStyles[f] = rowStyle;

    const m = /\.backlink\s*\{([^}]*)\}/.exec(live);
    if (!m) { bad(f, '.backlink is used but never defined (or the rule is commented out)'); continue; }
    rules[f] = norm(m[1]);

    // A bordered button, not a text link — that was the visible difference.
    if (!/border:/.test(rules[f]) || !/padding:/.test(rules[f])) {
      bad(f, '.backlink is not a bordered button');
    }
  }

  const seen = [...new Set(Object.values(rules))];
  if (seen.length > 1) {
    bad('all', 'the .backlink rule differs between pages — ' +
        Object.entries(rules).map(([f, r]) =>
          f + ': ' + (seen.indexOf(r) + 1)).join(', ') +
        ' (numbers are distinct variants; they should all be 1)');
  }

  const rowSeen = [...new Set(Object.values(rowStyles))];
  if (rowSeen.length > 1) {
    bad('all', 'the header row differs between pages: ' +
        Object.entries(rowStyles).map(([f, r]) => f + ':' + (rowSeen.indexOf(r) + 1)).join(', '));
  }

  // ---- coming back from a report lands on the season you left ---------
  // reports.html defaulted to the CURRENT season however you got there, so
  // reading three 2023 reports meant picking 2023 three times.
  const reports = fs.readFileSync(path.join(ROOT, 'reports.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (!/get\('season'\)/.test(reports) || !/years\.includes\(askedFor\)/.test(reports)) {
    bad('reports.html', 'does not honour an incoming ?season= — or does not check that the ' +
        'season actually exists before selecting it');
  }
  for (const f of ['season_report.html', 'player_report.html', 'stat_package.html']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const doc2 = new JSDOM(fs.readFileSync(path.join(ROOT, f), 'utf8')).window.document;
    if (!doc2.getElementById('backToReports')) {
      bad(f, 'the "Back to reports" link has no id, so nothing can set its season');
    }
    if (!/backToReports[\s\S]{0,240}reports\.html\?season=/.test(src)) {
      bad(f, 'the back link never gains a ?season= — it will drop the reader on the ' +
             'current season whatever they were reading');
    }
  }

  // help.html prints. The button must stay off the printed page, and that
  // rule has to name the class the anchor actually carries.
  const help = fs.readFileSync(path.join(ROOT, 'help.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  // The @media block contains more than one rule, so the class need only
  // appear SOMEWHERE inside it. A first version required .backlink to be
  // the first rule in the block and failed on correct code — .card comes
  // first.
  const printBlock = /@media print \{([\s\S]*?)\}\s*\}/.exec(help.replace(/\s+/g, ' '));
  if (!printBlock || !/\.backlink \{ display:none/.test(printBlock[1] + '}')) {
    bad('help.html', 'the print rule does not hide .backlink — it named .back, which the ' +
        'anchor no longer uses, so the button would print');
  }
  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== The dashboard button is the same on every page ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  [' + x.f + '] ' + x.why));
  if (!f.length) console.log('  six pages, one button, one label, one rule, one place — and the season comes back with you.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
