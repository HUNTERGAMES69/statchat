// Before kickoff, only Start game is available
// ============================================
// Two separate faults produced the same symptom -- a control that looks
// available before the game exists.
//
// 1. PENALTY and TIMEOUT carried INLINE background colours. An inline style
//    beats a stylesheet rule, including button:disabled with !important on
//    it. Both were correctly disabled and both stayed fully lit: the click
//    did nothing and the button looked ready.
//
// 2. MANUAL ENTRY was never disabled at all. Not an override -- nothing had
//    ever switched it off. It writes a free-text play that carries no
//    statistics and is flagged unresolved, and it sat available before
//    kickoff, at halftime and after a game was finalized.
//
//   node tests/pregame_controls_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');
const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const doc = new JSDOM(src).window.document;

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Pre-game controls ===\n');

// ---- the phase flag reaches every utility control ------------------------
const UTILS = ['penUtilBtn', 'timeoutUtilBtn', 'badSnapUtilBtn', 'kneelUtilBtn',
               'driveUtilBtn', 'setClockUtilBtn', 'manualBtn'];
for (const id of UTILS) {
  // MATCHED ON ONE LINE. A window spanning several lines matched the const
  // declaration and a later assignment together, so deleting the assignment
  // still passed -- the id was mentioned and nothing checked it was used.
  const direct = new RegExp("getElementById\\('" + id + "'\\)\\.disabled = disable")
    .test(src);
  const viaVar = new RegExp("\\b" + id + "El\\.disabled = disable\\b").test(src);
  chk(direct || viaVar, id + ' is switched off by the phase flag');
}

chk(/const disable = [^;]*gamePhase === 'notStarted'/.test(src),
    "and that flag includes notStarted, so nothing is reachable before kickoff");

// ---- NOTHING may carry an inline fill ------------------------------------
// This is the fault that hid itself: the buttons WERE disabled, and looked
// exactly as available as before.
for (const b of doc.querySelectorAll('button')) {
  if (!/UtilBtn$|manualBtn/.test(b.id)) continue;
  const style = b.getAttribute('style') || '';
  chk(!/background/.test(style),
      b.id + ' has no inline background — an inline fill beats button:disabled ' +
      'and leaves a dead control looking lit');
}

// ---- and no class may outrank the disabled rule --------------------------
{
  const disAt = css.indexOf('button:disabled, button[disabled]');
  chk(disAt > -1, 'the disabled rule exists');
  for (const b of doc.querySelectorAll('button')) {
    if (!/UtilBtn$|manualBtn/.test(b.id)) continue;
    for (const c of (b.className || '').split(' ').filter(Boolean)) {
      // button.x matches :disabled at 0,1,1 -- so ORDER decides, and the
      // disabled rule has to come last. A bare .x is lower and always loses.
      // TWO SHAPES MATTER. `button.x` ties :disabled at 0,1,1 and is decided
      // by order. A bare `.x` is 0,1,0 and always loses -- but only while it
      // STAYS bare, so adding the element selector is itself the regression.
      const qualified = new RegExp('button\\.' + c + '\\s*\\{[^}]*background').exec(css);
      const bare = new RegExp('(?:^|[},\\n])\\s*\\.' + c + '\\s*\\{[^}]*background').exec(css);
      if (qualified) {
        chk(css.indexOf(qualified[0]) < disAt,
            'button.' + c + ' is declared BEFORE the disabled rule — it ties ' +
            'on specificity, so order decides and the disabled rule must be last');
      }
      if (bare && !qualified) {
        chk(true, '.' + c + ' is a bare class — lower specificity than ' +
            'button:disabled, so it always yields');
      }
      if (bare && qualified) {
        chk(false, '.' + c + ' is declared both bare and qualified — one of ' +
            'them outranks the disabled rule depending on order');
      }
    }
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
