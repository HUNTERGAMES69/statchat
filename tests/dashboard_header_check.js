// The dashboard header lays out predictably
// =========================================
// Reported 25 Aug with a screenshot: the buttons jumbled, the avatar sat
// on a line of its own, and the tenant's name wrapped to two lines while
// the StatChat mark sat in front of it.
//
// THREE CAUSES, all in the same header:
//
//   1. The avatar lived INSIDE .navlinks with margin-left:auto — a flex
//      item among the buttons. When the row ran short of width it wrapped
//      onto its own line, right-aligned underneath them.
//   2. `.navlinks a { flex:1 1 auto }` sized every button by its LABEL, so
//      "How to use" and "Customize team" came out different widths and the
//      row's proportions changed with the wording rather than staying put.
//   3. The StatChat mark was the first thing in .brandline — in front of
//      the customer's own name, on the customer's own home screen.
//
// The header is now three groups: tenant, tools, app chrome. The tenant
// carries flex:1 1 auto and pushes the other two right, so its name starts
// hard left at every width.
//
//   node tests/dashboard_header_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const FILE = path.join(__dirname, '..', 'dashboard.html');
const raw = fs.readFileSync(FILE, 'utf8');
// Comments stripped before asserting on CSS: a rule inside an HTML comment
// is inert, and reading it out of the file cannot tell the difference.
const live = raw.replace(/<!--[\s\S]*?-->/g, '');
const doc = new JSDOM(raw).window.document;

function run() {
  const fails = [];
  const bad = why => fails.push(why);

  // ---- structure ------------------------------------------------------
  const bar = doc.querySelector('.topbar');
  if (!bar) return ['no .topbar'];
  // TWO LINES: tools and account on top, tenant on its own row beneath.
  // The tenant shared the top row with four buttons and the account, which
  // squeezed a long name into three stacked words. Reported 25 Aug.
  const kids = [...bar.children].map(c => c.className.trim());
  if (kids.join(' | ') !== 'navlinks | headerRight | brandline') {
    bad('the header is not tools | chrome | tenant, in that order (' + kids.join(' | ') + ')');
  }

  if (doc.querySelector('.navlinks #accountBtn')) {
    bad('the account button is inside .navlinks — as a flex item with margin-left:auto it ' +
        'wraps to a line of its own, which is the reported layout');
  }
  if (!doc.querySelector('.headerRight #accountBtn')) bad('the account button is not in .headerRight');
  if (!doc.querySelector('.headerRight .scMark-dash')) bad('the StatChat mark is not in .headerRight');
  if (doc.querySelector('.brandline .scMark-dash') || doc.querySelector('.brandline .scMark')) {
    bad('the StatChat mark is back in front of the tenant name');
  }

  // ---- the tenant runs hard left --------------------------------------
  // flex-basis:100% is what FORCES the wrap. Without it the tenant rejoins
  // the button row whenever there happens to be room -- so the layout would
  // differ between two people purely because one of them sees Broadcast
  // setup and the other does not.
  if (!/\.brandline\s*\{[^}]*flex:\s*1 1 100%/.test(live)) {
    bad('.brandline is not forced to a full-width row, so the tenant can rejoin the button ' +
        'line whenever there is space');
  }
  if (!/\.brandline\s*\{[^}]*order:\s*2/.test(live)) {
    bad('.brandline is not ordered after the tools');
  }

  // AND THE SIGNED-IN LINE IS GONE. The avatar menu shows the same address.
  if (doc.getElementById('signedInAs')) {
    bad('the "Signed in as ..." line is back — the account menu already says who you are');
  }

  // ---- buttons do not resize themselves by their labels ---------------
  const navRule = /\.navlinks a, \.navlinks button \{([^}]*)\}/.exec(live);
  if (!navRule) bad('no .navlinks button rule found');
  else if (/flex:\s*1 1 auto/.test(navRule[1])) {
    bad('.navlinks buttons carry flex:1 1 auto — each is then sized by however long its ' +
        'label happens to be, so the row changes shape with the wording');
  }
  if (!/\.navlinks \{[^}]*display:grid/.test(live)) {
    bad('the narrow layout is not a grid — equal cells are what keep four buttons tidy when ' +
        'the count changes with the role');
  }

  // ---- labels ---------------------------------------------------------
  const labels = [...doc.querySelectorAll('.navlinks a')].map(a => a.textContent.trim());
  if (!labels.includes('Broadcast setup')) {
    bad('the broadcast link does not read "Broadcast setup" — "Broadcast" alone reads as a ' +
        'verb, something you press to go live (' + labels.join(', ') + ')');
  }
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (dupes.length) bad('duplicate nav labels: ' + dupes.join(', '));

  return fails;
}

if (require.main === module) {
  const f = run();
  console.log('=== Dashboard header layout ===\n');
  console.log('Failures: ' + f.length);
  f.forEach(x => console.log('  ' + x));
  if (!f.length) console.log('  tools and account on top, tenant on its own row beneath, and nothing resizes itself by its label.');
  process.exitCode = f.length ? 1 : 0;
}

module.exports = { run };
