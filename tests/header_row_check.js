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

function assertRow(file, style, label, needsRule) {
  const s = style.replace(/\s+/g, ' ');
  // A VISIBLE SEPARATION, not just a wrapping one. The wrap/gap/align
  // rules above are phone-only -- they change nothing on a desktop, which
  // is why a "fixed" header still looked identical to Andy on a PC. The
  // header/title look he asked for needs the hairline and the padding.
  if (needsRule) {
    // THE HAIRLINE MUST BE VISIBLE, not merely present. It first shipped
    // as var(--sc-rule) -- #2b333d, 1.30:1 against the card -- which is a
    // line you cannot see. The check passed, the page looked unchanged,
    // and I explained why three times before measuring it.
    //
    // 3:1 is the WCAG floor for a non-text boundary. --sc-rule is for
    // subtle internal dividers; a header separator needs --sc-rule-strong.
    const border = /border-bottom:\s*1px solid\s*var\(\s*(--[a-z-]+)/.exec(s);
    chk(!!border, file + ': ' + label + ' has a hairline under it');
    chk(border && border[1] === '--sc-rule-strong',
        file + ': ' + label + ' uses --sc-rule-strong (3.91:1), not ' +
        (border ? border[1] : '?') + ' — --sc-rule is 1.30:1 and invisible');
    chk(/padding-bottom:\s*14px/.test(s) && /margin-bottom:\s*20px/.test(s),
        file + ': ' + label + ' has 14px above the hairline and 20px below');
  }
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
  assertRow(f, mark.parentElement.getAttribute('style') || '', 'header row', true);
}

for (const f of TOPBAR) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const m = /\.topbar\s*\{([^}]*)\}/.exec(src);
  if (!m) { chk(false, f + ': no .topbar rule'); continue; }
  // dashboard.html's topbar IS its whole card, so a hairline would sit a
  // few pixels above the card's own border. The card edge separates it.
  assertRow(f, m[1], '.topbar', f !== 'dashboard.html');
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
