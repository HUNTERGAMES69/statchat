// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// "Tackled by" is open before the scorer touches it
// =================================================
// Every optional credit block rendered collapsed, so crediting a tackle
// meant a click to open the section before the picker was even visible. On
// a play that already needs a carrier and a yardage, that click is the
// difference between keeping up with the game and falling behind it.
//
// Only this one opens. A recovery or a block is the exception rather than
// the rule, and opening every section would push Review play off a laptop
// screen -- which costs a scroll on every play instead of a click on some.
//
//   node tests/tackled_by_open_check.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Tackled by opens on render ===\n');

// ---- run defBlock over every label the panel actually uses ---------------
{
  const i = src.indexOf('    function defBlock(label, suffix){');
  chk(i > -1, 'defBlock is present');
  const fn = src.slice(i, src.indexOf('\n    }', src.indexOf("'</div>';", i)) + 6);
  const f = new Function('defenseEligible', 'pickerHtml', 'def', fn + '; return defBlock;')(
    () => [], () => '<button class="x_pick"></button>', null);

  const open = l => /class="opt-block open"/.test(f(l));
  const sign = l => (/opt-toggle">(.)/.exec(f(l)) || [])[1];

  chk(open('Tackled by (optional)'),
      'Tackled by renders already open');
  chk(sign('Tackled by (optional)') === '\u2212',
      'and its toggle shows a minus, not a plus — a plus on an open section ' +
      'invites a click that closes it');

  // THE OTHERS STAY SHUT, on purpose.
  ['Recovered by (optional)', 'Blocked by (optional)', 'Credited to (optional)']
    .forEach(l => {
      chk(!open(l), l.replace(' (optional)', '') + ' stays collapsed');
      chk(sign(l) === '+', 'with a plus');
    });

  // Labels without "(optional)" were never collapsible at all.
  chk(!/opt-block/.test(f('Sacked by')),
      'a required credit is not a collapsible block in the first place');
}

// ---- the sign tracks the state at setup ----------------------------------
// The setup pass adds `open` to any block that arrives with a pick already
// made, and used to leave the button reading "+". Now one line syncs the
// sign to the state, covering both that case and anything opened on render.
{
  const m = /panel\.querySelectorAll\('\.opt-block'\)\.forEach\(block => \{[\s\S]*?\n      \}\);/.exec(src);
  chk(!!m, 'the setup loop is present');
  if (m) {
    const dom = new JSDOM('<div id="panel">' +
      '<div class="opt-block open"><button class="opt-toggle">\u2212 Tackled by</button>' +
        '<div class="opt-body"><button class="a_pick"></button></div></div>' +
      '<div class="opt-block"><button class="opt-toggle">+ Recovered by</button>' +
        '<div class="opt-body"><button class="b_pick picked"></button></div></div>' +
      '<div class="opt-block"><button class="opt-toggle">+ Blocked by</button>' +
        '<div class="opt-body"><button class="c_pick"></button></div></div></div>');
    const doc = dom.window.document;
    new Function('panel', m[0])(doc.getElementById('panel'));

    const rows = [...doc.querySelectorAll('.opt-block')].map(b => ({
      open: b.classList.contains('open'),
      text: b.querySelector('.opt-toggle').textContent
    }));
    chk(rows.every(r => r.open === r.text.startsWith('\u2212')),
        'after setup, every sign matches its section\'s state');
    chk(rows[1].open,
        'a block arriving with a pick already made is opened');
    chk(rows[1].text === '\u2212 Recovered by',
        'and its sign is corrected by the existing seeded branch');
    chk((src.match(/btn\.textContent = '\u2212 ' \+ label;/g) || []).length === 1,
        'which appears exactly once — a second copy would be dead code that ' +
        'hides whether either is doing anything');
    chk(!rows[0].text.startsWith('\u2212 \u2212'),
        'with no doubled sign: the label strips either character, not just ' +
        'the plus, or an already-open block accumulates them');
    chk(!rows[2].open && rows[2].text === '+ Blocked by',
        'and an untouched optional block is left alone');
  }
}

chk(/replace\(\/\^\[\+\\u2212\]\\s\*\/, ''\)/.test(src),
    'the label strips a leading plus OR minus');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
