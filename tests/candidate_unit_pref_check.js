// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// A shared number offers the picker's own unit first
// ==================================================
// Reported after a live game, 27 August 2026. Typing a jersey number that
// belongs to two players offers a choice; those choices were listed
// offence, defence, special in that fixed order regardless of which picker
// was asking. So in the tackled-by box, a number shared between an
// offensive and a defensive player put the offensive one first.
//
// The headline name was already right -- `resolved` respects the picker's
// own unit order. It was only the ALTERNATIVES that ignored it, and the
// caller already had the order in hand without passing it on.
//
// Two-way players are not a rare shape in high school football. On a small
// roster they are most of it.
//
//   node tests/candidate_unit_pref_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Shared numbers prefer the picker\'s unit ===\n');

chk(/function playerCandidates\(teamKey, num, preferredUnit\)\{/.test(src),
    'playerCandidates takes a preferred unit');
chk(/playerCandidates\(teamKey, num, order && order\[0\]\)/.test(src),
    'and the caller passes it — order[0] is the unit that picker is for, ' +
    'which it already had');

const fn = /function playerCandidates\(teamKey, num, preferredUnit\)\{[\s\S]*?\n\}/.exec(src);
chk(!!fn, 'the function is intact');

const build = (TEAMS) => new Function('TEAMS', fn[0] + '; return playerCandidates;')(TEAMS);
const names = (list) => list.map(c => c.name + ':' + c.unit).join(',');

// ---- a number on both rosters -------------------------------------------
{
  const f = build({ teamA: {
    rosterOffense: {'7':'Jimenez'}, rosterDefense: {'7':'Watson'}, rosterSpecialTeams: {},
    ambiguousOffense: {}, ambiguousDefense: {}, ambiguousSpecialTeams: {} } });

  chk(names(f('teamA','7','defense')) === 'Watson:defense,Jimenez:offense',
      'the tackled-by picker offers the DEFENDER first');
  chk(names(f('teamA','7','offense')) === 'Jimenez:offense,Watson:defense',
      'and a ball-carrier picker still offers the offensive player first — ' +
      'the preference follows the picker, it is not a blanket reordering');
  chk(names(f('teamA','7')) === 'Jimenez:offense,Watson:defense',
      'with no preference given, the old fixed order stands');
}

// ---- a number discovered mid-game, in the ambiguous maps ----------------
// The preference has to hold for players this app discovers as well as for
// ones already on a roster, or it holds for half the cases.
{
  const f = build({ teamA: {
    rosterOffense: {}, rosterDefense: {}, rosterSpecialTeams: {},
    ambiguousOffense: {'7':[{name:'Jimenez'},{name:'Watson'}]},
    ambiguousDefense: {'7':[{name:'Bell'}]},
    ambiguousSpecialTeams: {} } });

  const d = f('teamA','7','defense');
  chk(d[0].name === 'Bell' && d[0].unit === 'defense',
      'a discovered defender comes first in the tackled-by picker');
  chk(d.length === 3,
      'and the offensive alternatives are still offered, just after him — ' +
      'preference is an ordering, not a filter');

  chk(f('teamA','7','offense')[0].unit === 'offense',
      'and the offensive picker still leads with offense');
}

// ---- no duplicates -------------------------------------------------------
{
  const f = build({ teamA: {
    rosterOffense: {'7':'Watson'}, rosterDefense: {'7':'Watson'}, rosterSpecialTeams: {},
    ambiguousOffense: {}, ambiguousDefense: {}, ambiguousSpecialTeams: {} } });
  chk(f('teamA','7','defense').length === 1,
      'one player on both rosters is offered once, not twice');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
