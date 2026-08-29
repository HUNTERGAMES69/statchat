// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// A bad snap is recorded as a fumble
// ==================================
// Reported from a live game, 27 August 2026: a fumble logged on a bad snap
// appeared nowhere in the stats.
//
// The bad snap tree wrote playType 'rush'. Nothing downstream ever saw a
// fumble -- none charged to the team, no recovery credited to the defense,
// and countTurnovers, which reads playType 'fumble', did not count a lost
// one. A bad snap the other team fell on showed as a rush for a loss plus a
// possession change, with the turnover missing from the tile and the report.
//
// 'fumble' with attempt:'rush' keeps the yardage where NFHS puts it -- the
// rushing branch credits TEAM either way -- and adds the fumble.
//
//   node tests/bad_snap_fumble_check.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Bad snap records a fumble ===\n');

// ---- THE PARSER IS THE SOURCE, not the click handler --------------------
// The first fix changed only the click handler, which builds roles as
// `pending.roles = pending.roles || {...}`. By then showConfirm() has run
// parseInput, which RETURNS roles for a bad snap -- so the handler's object
// was never used and the fix changed nothing. Reported from a live test
// after it was deployed.
//
// Checking the handler alone is what let it through: the assertion was true
// and the code it described was dead.
{
  const parserRoles = game.match(
    /roles: \{ carrier: \{ team: off, num: 'TEAM', yards: netYards \}[\s\S]{0,220}?\} \};/g) || [];
  chk(parserRoles.length >= 3,
      'the parser builds roles for the bad snap outcomes (found ' +
      parserRoles.length + ')');
  chk(parserRoles.every(r => /playType: 'fumble'/.test(r)),
      "and every one of them says playType 'fumble' — not the bare 'rush' " +
      'they all used to');
  chk(parserRoles.every(r => /attempt: 'rush'/.test(r)),
      "with attempt 'rush', which keeps the yardage on TEAM rushing where " +
      'NFHS puts a bad snap');
  chk(parserRoles.filter(r => /lost: true/.test(r)).length === 3,
      'and the three where the other team ends up with it are marked lost');
  chk(parserRoles.filter(r => /defense: bsRec && bsRec !== '\?'/.test(r)).length === 2,
      'the recoverer is credited when named, and left to the TEAM row when ' +
      'the scorer wrote "?"');
}

chk(/playType: 'fumble',\s*\n\s*attempt: 'rush'/.test(game),
    "the click handler agrees, for the branch the parser leaves to it — " +
    "the bad snap the offence recovers itself");
chk(/pending\.roles\.lost = true;/.test(game),
    'and sets `lost` when the other team recovers, which is what ' +
    'countTurnovers reads');
{
  // `lost` MUST BE INSIDE the byDef branch. A snap the offense falls on is a
  // fumble but not a turnover.
  const m = /if \(byDef\)\{[\s\S]*?\n        \}/.exec(game);
  chk(!!m && /pending\.roles\.lost = true;/.test(m[0]),
      'only inside the defensive-recovery branch — a snap the offense falls ' +
      'on is a fumble but not a turnover');
}

// ---- run the engine ------------------------------------------------------
const TEAM = { posOffense:{}, posDefense:{}, rosterOffense:{},
               rosterDefense:{}, rosterSpecialTeams:{} };
const ctx = vm.createContext({
  TEAMS: { teamA: Object.assign({}, TEAM, {name:'Home'}),
           teamB: Object.assign({}, TEAM, {name:'Away'}) },
  startingPossession: 'teamA', PENALTIES: {},
  otherTeam: t => (t === 'teamA' ? 'teamB' : 'teamA'),
  TIMEOUTS_PER_HALF: 3, isAdminMarker: p => !!(p && p.isDivider),
  clockToAbsSeconds: () => null, globalThis: {},
  console, Math, JSON, Object, Array, String, Number, Set
});
vm.runInContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'), ctx);

const play = (roles) => [{ id: 1, text: 'bad snap', quarter: 1, roles,
                           effect: { isStat: true, statYds: -9 } }];
const CARRIER = { team: 'teamA', num: 'TEAM', yards: -9 };

{
  const p = play({ playType:'fumble', attempt:'rush', carrier: CARRIER, lost: true,
                   defense: { team:'teamB', num:'55', name:'LB' } });
  const bx = ctx.computeBoxScore(p), tv = ctx.countTurnovers(p);
  const rush = (bx.teamA.rushing || {}).TEAM || {};
  const def = (bx.teamB.defense || {}).LB || {};

  chk(rush.att === 1 && rush.yds === -9,
      'defense recovers: the team rush is unchanged — 1 attempt for -9, ' +
      'which is where NFHS puts a bad snap');
  chk(rush.fum === 1, 'and a fumble is charged to the team');
  chk(tv.teamA === 1, 'and it counts as a turnover');
  chk(def.fumRec === 1, 'with the recovery credited to the defender');
  chk(!def.tackles, 'and NOT a tackle — recovering a fumble is not one');
}

{
  const p = play({ playType:'fumble', attempt:'rush', carrier: CARRIER });
  const bx = ctx.computeBoxScore(p), tv = ctx.countTurnovers(p);
  const rush = (bx.teamA.rushing || {}).TEAM || {};
  chk(rush.att === 1 && rush.fum === 1,
      'offense recovers: still a team rush and still a fumble');
  chk(tv.teamA === 0, 'but NOT a turnover — the offense kept the ball');
}

// ---- the independent audit agrees ----------------------------------------
// This is the check that caught two faults in the AUDITOR while verifying
// the fix: it credited a tackle for a fumble recovery (the engine's
// TACKLE_TYPES is rush/pass/sack only) and never credited fumRec at all.
// No fixture had put a defender on a fumble before, so the two
// implementations had never had to disagree.
[
  ['bad snap, defense recovers', { playType:'fumble', attempt:'rush', carrier:CARRIER,
     lost:true, defense:{team:'teamB',num:'55',name:'LB'} }],
  ['bad snap, offense recovers', { playType:'fumble', attempt:'rush', carrier:CARRIER }],
  ['rush fumble, defense recovers', { playType:'fumble', attempt:'rush',
     carrier:{team:'teamA',num:'22',name:'RB',yards:3}, lost:true,
     defense:{team:'teamB',num:'55',name:'LB'} }],
  ['sack fumble', { playType:'fumble', attempt:'sack',
     passer:{team:'teamA',num:'7',name:'QB',yards:6},
     defense:{team:'teamB',num:'99',name:'DE'} }]
].forEach(([label, roles]) => {
  const p = play(roles);
  const d = ctx.compareBoxScores(p, ctx.computeBoxScore(p));
  chk(d.length === 0, 'the two independent counts agree on: ' + label +
      (d.length ? ' — ' + d[0] : ''));
});

chk(/\['rush','pass','sack'\]\.indexOf\(t\)/.test(
      fs.readFileSync(path.join(root, 'engine.js'), 'utf8')),
    "the auditor's tackle list matches the engine's TACKLE_TYPES");

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
