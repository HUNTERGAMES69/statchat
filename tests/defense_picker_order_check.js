// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The defensive picker is in jersey order
// =======================================
// Reported after a live game, 27 August 2026. The list was sorted by who
// had been credited most recently, then by how often.
//
// That is the right rule for the offensive pickers, where a scorer chooses
// among a handful of players he is watching and the last carrier is a good
// guess. Defense is a different job: the list grows as tacklers are
// discovered, so by the third quarter it is twenty-odd numbers deep, and
// the scorer is not guessing -- he has a number from the spotter and needs
// to FIND it. A recency order puts the same number somewhere new every
// play, so finding it means scanning the whole list every time.
//
// Discovery is unchanged. A player still appears only once credited; only
// where he appears has changed.
//
//   node tests/defense_picker_order_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Defensive picker order ===\n');

const grab = n => (new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}').exec(src) || [''])[0];

// ---- the comparator ------------------------------------------------------
{
  const fn = grab('byJersey');
  chk(!!fn, 'byJersey exists');
  const byJersey = new Function(fn + '; return byJersey;')();

  chk(['10','2','55','7'].sort(byJersey).join() === '2,7,10,55',
      'numbers sort as numbers — a plain string sort puts 10 before 2');
  chk(['00','0','5'].sort(byJersey).join() === '0,00,5',
      '"0" and "00" are two different players and both legal, so they keep a ' +
      'stable order rather than swapping between renders');
  chk([{num:'10'},{num:'2'}].sort(byJersey).map(x=>x.num).join() === '2,10',
      'and it takes an object with a num as well as a bare string');
}

// ---- the defensive list --------------------------------------------------
chk(/\.sort\(byJersey\)\s*\n\s*\.filter\(num => !ambiguous\[num\]\)/.test(src),
    'the discovered defenders are sorted by jersey');
chk(!/const defRecency/.test(src),
    'and the recency sort is gone, with nothing left computing it');

// THE OFFENSIVE PICKERS KEEP RECENCY. Changing those was not asked for and
// would be wrong: a short list of players you are watching is a guess, not
// a search.
chk((src.match(/byRecency\(/g) || []).length >= 3,
    'the other pickers still use recency — that rule is right for a short ' +
    'list you are guessing from, and only wrong for a long one you search');

// ---- shared numbers merge in, rather than sitting on top -----------------
chk(/return ambiguousList\.concat\(discoveredList\)\.sort\(byJersey\);/.test(src),
    'shared-number entries are sorted in with the rest — prepending them ' +
    'made sense against a recency list with no order to break, but against ' +
    'a numeric one a #55 above a #2 is the exact problem being fixed');

// ---- run it --------------------------------------------------------------
{
  const fn = new Function('TEAMS', 'computePlayerStats', 'rosterName',
    [grab('byJersey'), grab('defenseEligible')].join('\n') + '; return defenseEligible;')(
    { teamA: { rosterDefense: {'2':'Adams','7':'Baker','23':'Cole','55':'Davis'},
               ambiguousDefense: { '7': ['Baker','Bell'] } } },
    () => ({ stats: { teamA: { credits: {'55':5,'2':1,'23':3,'7':2} } },
             discovered: { teamA: ['55','2','23','7'] } }),
    (t, n) => '#' + n);

  const list = fn('teamA');
  const nums = list.map(p => p.num);
  chk(nums.join() === '2,7,7,23,55',
      'the picker comes out in jersey order (got ' + nums.join(',') + ')');
  chk(nums[1] === '7' && nums[2] === '7',
      'with the two entries for a shared number together at that number, ' +
      'where the scorer is already looking');

  // DISCOVERY IS UNCHANGED. #99 is on nobody's list until he makes a play.
  chk(!nums.includes('99'),
      'and a player who has not been credited still does not appear');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
