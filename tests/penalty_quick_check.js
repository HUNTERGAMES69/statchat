// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// A row of the most-called fouls, under the team choice
// ====================================================
// Asked for after a live game, 27 August 2026. The dropdown holds 41
// options a side; four of them are most of what is actually called on a
// Friday, and reaching them meant opening a select and scanning it.
//
// SIDE-SPECIFIC, because the four are not the same on both sides. False
// start is an offensive foul only -- before the snap the defensive
// equivalents are offside and encroachment. And pass interference is two
// separate entries in the catalogue, offensive_pi and defensive_pi, so the
// right one has to be chosen rather than one shown to both.
//
//   node tests/penalty_quick_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Penalty quick picks ===\n');

// ---- the lists resolve against the real catalogue ------------------------
const pen = /const PENALTIES = \{[\s\S]*?\n\};/.exec(src);
const quick = /const QUICK_PENALTIES = \{[\s\S]*?\n\};/.exec(src);
const fn = /function quickPenaltiesFor\(side\)\{[\s\S]*?\n\}/.exec(src);
chk(!!pen && !!quick && !!fn, 'the catalogue, the quick lists and the builder are all present');

const quickFor = new Function(pen[0] + '\n' + quick[0] + '\n' + fn[0] +
                              '; return quickPenaltiesFor;')();
const PENALTIES = new Function(pen[0] + '; return PENALTIES;')();

['off', 'def'].forEach(side => {
  const list = quickFor(side);
  chk(list.length === 4, side + ': four buttons (got ' + list.length + ')');
  chk(list.every(q => PENALTIES[q.slug]),
      side + ': every slug exists in PENALTIES');
  chk(list.every(q => {
        const p = PENALTIES[q.slug];
        return p.side === 'both' || p.side === side;
      }),
      side + ': and every one is a foul that side can actually commit');
});

// THE FILTER ITSELF, not just its result. Every slug resolves today, so
// removing `.filter(slug => PENALTIES[slug])` changes nothing a list check
// can see -- it only matters the day someone renames an entry, which is
// exactly when nobody is looking at this test. Caught by mutation.
chk(/\.filter\(slug => PENALTIES\[slug\]\)/.test(src),
    'the builder filters against the catalogue, so a renamed penalty drops ' +
    'out of the row rather than rendering a button that sets nothing');
chk(/name: PENALTIES\[slug\]\.name, yards: PENALTIES\[slug\]\.yards/.test(src),
    'and takes the label and yardage from the catalogue rather than ' +
    'repeating them here, where they could drift');

// THE SIDE SPLIT IS THE POINT.
chk(quickFor('off').some(q => q.slug === 'false_start'),
    'the offense gets False start');
chk(!quickFor('def').some(q => q.slug === 'false_start'),
    'and the defense does NOT — it is an offensive foul, and the pre-snap ' +
    'equivalents are offside and encroachment');
chk(quickFor('def').some(q => q.slug === 'encroachment'),
    'which the defense gets instead');
// THE TWO ROWS ARE NOT MIRRORS. Revised 27 Aug after the first cut: offside
// and pass interference came off the offensive row, holding came off the
// defensive one. An offense can technically be offside on a free kick and
// offensive pass interference exists, but neither is what anyone reaches
// for in a hurry.
chk(quickFor('def').some(q => q.slug === 'defensive_pi'),
    'pass interference is on the DEFENSIVE row, as defensive_pi — the ' +
    'catalogue has two separate entries and the wrong one would log the ' +
    'wrong foul');
chk(!quickFor('off').some(q => q.slug === 'offensive_pi'),
    'and not on the offensive row');
chk(!quickFor('off').some(q => q.slug === 'offside'),
    'offside is not on the offensive row either');
chk(!quickFor('def').some(q => q.slug === 'holding'),
    'and holding is not on the defensive row — called, but far less often ' +
    'than the four above it');

{
  const off = quickFor('off').map(q => q.slug).join();
  const def = quickFor('def').map(q => q.slug).join();
  chk(off === 'false_start,illegal_motion,delay_of_game,holding',
      'the offensive row reads false start, illegal motion, delay of game, ' +
      'holding (got ' + off + ')');
  chk(def === 'offside,encroachment,defensive_pi,roughing_passer',
      'and the defensive row offside, encroachment, pass interference, ' +
      'roughing the passer (got ' + def + ')');
}

// ---- the row drives the select, rather than going round it ---------------
// Everything downstream -- the yardage, automatic first down, the
// spot-of-foul toggle -- hangs off the select's change event.
chk(/sel\.value = qb\.dataset\.slug;/.test(src),
    'a quick button sets the select value');
chk(/sel\.dispatchEvent\(new Event\('change'\)\);/.test(src),
    'and fires its change event, so there is one path through the panel ' +
    'rather than a second that has to be kept in step');
{
  const handler = /quickWrap\.querySelectorAll\('\.penQuickBtn'\)\.forEach\(qb => \{[\s\S]*?\n        \}\);/.exec(src);
  chk(!!handler && !/penaltyYards|autoFirst|spotOfFoul/.test(handler[0]),
      'and it computes nothing itself — no second copy of the yardage or ' +
      'first-down rules to drift out of step');
}

// ---- the highlight is driven from one place ------------------------------
chk(/x\.classList\.toggle\('picked', !!slug && x\.dataset\.slug === slug\)/.test(src),
    'the select\'s change handler sets which quick button looks chosen, so ' +
    'picking from the dropdown clears the row and picking a button lights ' +
    'the right one');

// ---- rebuilt per team ----------------------------------------------------
{
  const teamHandler = /penTeam = b\.dataset\.team;[\s\S]*?quickWrap\.style\.display = 'block';/.exec(src);
  chk(!!teamHandler,
      'the row is rebuilt when a team is chosen — switching side mid-entry ' +
      'must not leave a button for a foul the other side cannot commit');
}

// ---- it renders --------------------------------------------------------
{
  const dom = new JSDOM('<div id="pen_quick"></div>');
  const doc = dom.window.document;
  const html = quickFor('def').map(q =>
    '<button type="button" class="penQuickBtn" data-slug="' + q.slug + '">' +
    q.name + '</button>').join('');
  doc.getElementById('pen_quick').innerHTML = html;
  const btns = [...doc.querySelectorAll('.penQuickBtn')];
  chk(btns.length === 4 && btns.every(b => b.dataset.slug),
      'four buttons render, each carrying its slug');
  chk(new Set(btns.map(b => b.dataset.slug)).size === 4,
      'with no duplicates');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
