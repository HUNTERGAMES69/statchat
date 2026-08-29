// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// A view-only user is not shown actions they cannot take
// ======================================================
// Reported 27 August 2026: a view user could still see "New game" on the
// dashboard. It went nowhere -- the page bounces them -- but offering a
// button that reads as a permission you do not have is its own problem.
//
// Two separate causes, which is why it survived an earlier fix:
//
//   1. The Getting started card rendered for everyone. `state.isAdmin` was
//      used only to decide whether to append the two-factor step, so a view
//      user saw all four setup actions including New game.
//
//   2. A narrow-screen rule set `#newGameLink { display:block !important }`
//      so the button goes full width on a phone. `.hidden` is only
//      display:none, with no !important -- so below 767px the layout rule
//      won and the button reappeared for a user it had been hidden from.
//
//   node tests/view_role_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Dashboard: view-only users ===\n');

// ---- the Getting started card --------------------------------------------
chk(/if \(!state\.isAdmin\)\{ card\.style\.display = 'none'; return; \}/.test(src),
    'the Getting started card is admin-only — every step on it is an action ' +
    'a view user cannot take');

{
  const fn = /function renderGettingStarted\(state\)\{[\s\S]*?\n  \}/.exec(src);
  chk(!!fn, 'renderGettingStarted is present');
  if (fn) {
    const dom = new JSDOM('<div id="gettingStarted"><p id="gsSub"></p><div id="gsSteps"></div></div>');
    const doc = dom.window.document;
    const f = new Function('document', fn[0] + '; return renderGettingStarted;')(doc);
    const card = doc.getElementById('gettingStarted');
    const steps = doc.getElementById('gsSteps');
    const state = (isAdmin) => ({ customized: false, hasRoster: false, playerCount: 0,
                                  hasGames: false, isAdmin, hasMfa: false });

    f(state(false));
    chk(card.style.display === 'none', 'run as a view user, the card is hidden');
    chk(!/New game/.test(steps.innerHTML),
        'and nothing offers New game');

    card.style.display = ''; steps.innerHTML = '';
    f(state(true));
    chk(card.style.display !== 'none', 'run as an admin, the card shows');
    chk(/New game/.test(steps.innerHTML),
        'and New game is still there — the point is to gate it, not remove it');
  }
}

// ---- the standalone button -----------------------------------------------
chk(/document\.getElementById\('newGameLink'\)\.classList\.toggle\('hidden', !currentIsAdmin\);/.test(src),
    'the New game button is hidden from non-admins');

// A LAYOUT RULE MUST NOT RESURRECT A PERMISSION GATE. This is the third time
// tonight an !important or inline style has beaten a stylesheet rule; here
// the consequence was a permission leak rather than a cosmetic one.
chk(/#newGameLink:not\(\.hidden\) \{ display:block !important;/.test(src),
    'the narrow-screen rule that makes it full width excludes .hidden');

// THE INLINE STYLE WAS THE REAL CULPRIT. The button carried
// style="display:inline-block" on the element, and an inline style beats any
// stylesheet rule without !important -- so .hidden never applied at ANY
// width. The class was being added correctly and doing nothing. The media
// query above was a genuine second bug, but not the one being reported.
chk(!/id="newGameLink"[^>]*style=/.test(src),
    'the button carries NO inline style — an inline display beats .hidden ' +
    'from a stylesheet, so the class was being added and doing nothing');
chk(/#newGameLink:not\(\.hidden\) \{ display:inline-block; margin-bottom:12px; \}/.test(src),
    'its display lives in the stylesheet instead');

// AND SCOPED, because an id beats two classes. #newGameLink is (1,0,0);
// a.button-link.hidden is (0,2,1). An unqualified id rule would win over
// .hidden exactly as the inline style did.
chk(!/#newGameLink \{ display:inline-block/.test(src),
    'scoped with :not(.hidden), since an unqualified id rule would outrank ' +
    '.hidden and reintroduce the same fault');

// ---- the per-game edit link ----------------------------------------------
chk(/currentIsAdmin \? '<a href="create_game\.html\?edit=/.test(src),
    'and the per-game Edit link is admin-only too');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
