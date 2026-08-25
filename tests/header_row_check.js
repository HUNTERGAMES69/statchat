// Every page's header row behaves the same on a phone
// ===================================================
// Andy asked for this to be handled on every page as we go, and I twice
// said it was done when it was not:
//
//   * account.html was fixed specifically, then I "audited" the rest for
//     `flex-wrap` and `gap` and reported all pages fine.
//   * help.html passed that audit and was still `align-items:baseline`
//     with a 10px gap -- the exact fault I had just written up.
//
// The audit tested two of the three things that matter and I trusted it.
// So the rule is asserted here instead of re-checked by hand, and it
// checks alignment too.
//
// WHY EACH PART MATTERS ON A PHONE:
//   flex-wrap:wrap      without it the logo, title and controls compete
//                       for one line and collide
//   gap                 without it the pieces touch once they do wrap
//   align-items:center  baseline aligns a button to the text of a heading
//                       on a DIFFERENT line once wrapped, which looks like
//                       a bug
//
//   node tests/header_row_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');

// Pages whose header is a .scMark row with a back control.
const MARK_ROW = ['roster.html', 'customize.html', 'create_game.html',
                  'account.html', 'reports.html', 'help.html',
                  'broadcast_setup.html'];
// Pages whose header is .topbar. Their gaps differ for stated reasons --
// the dashboard's 26px row gap separates the tools from the tenant name --
// so only the BEHAVIOUR is asserted, not the number.
const TOPBAR = ['dashboard.html', 'platform.html'];

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

function assertRow(file, style, label) {
  const s = style.replace(/\s+/g, ' ');
  chk(/flex-wrap:\s*wrap/.test(s), file + ': ' + label + ' wraps');
  chk(/gap:/.test(s), file + ': ' + label + ' has a gap');
  chk(/align-items:\s*center/.test(s),
      file + ': ' + label + ' is align-items:center, not baseline — baseline aligns a ' +
      'button to a heading on another line once the row wraps');
}

console.log('=== Header rows behave the same on a phone ===\n');

for (const f of MARK_ROW) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { chk(false, f + ' is missing'); continue; }
  const doc = new JSDOM(fs.readFileSync(p, 'utf8')).window.document;
  const mark = doc.querySelector('.scMark');
  if (!mark) { chk(false, f + ': no .scMark header'); continue; }
  assertRow(f, mark.parentElement.getAttribute('style') || '', 'header row');
}

for (const f of TOPBAR) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const m = /\.topbar\s*\{([^}]*)\}/.exec(src);
  if (!m) { chk(false, f + ': no .topbar rule'); continue; }
  assertRow(f, m[1], '.topbar');
}

// AND THE SEVEN MARK ROWS ARE IDENTICAL TO EACH OTHER. The drift that
// started this was help.html at gap:10px while account.html was 12px --
// each correct on its own, inconsistent together.
const styles = {};
MARK_ROW.forEach(f => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return;
  const doc = new JSDOM(fs.readFileSync(p, 'utf8')).window.document;
  const mark = doc.querySelector('.scMark');
  if (mark) styles[f] = (mark.parentElement.getAttribute('style') || '').replace(/\s+/g, ' ').trim();
});
const distinct = [...new Set(Object.values(styles))];
chk(distinct.length === 1,
    'all ' + Object.keys(styles).length + ' mark rows are identical' +
    (distinct.length > 1 ? ' — ' + Object.entries(styles)
      .map(([f, v]) => f + ':' + (distinct.indexOf(v) + 1)).join(', ') : ''));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
