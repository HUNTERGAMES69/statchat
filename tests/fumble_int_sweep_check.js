// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Every fumble and interception shape, both counts, side by side
// ==============================================================
// Written after a bad snap logged no fumble at all (27 Aug 2026). The bad
// snap was one genuine bug; sweeping the rest found no more in the engine,
// but five in the AUDITOR -- every one of them a place where no fixture had
// ever exercised the path, so the two implementations had never had to
// disagree:
//
//   1. A fumble recovery was counted as a tackle. TACKLE_TYPES is
//      rush/pass/sack only.
//   2. fumRec was never credited to a named recoverer at all.
//   3. A sack fumble's charge to the quarterback was excluded.
//   4. The TEAM defensive row -- the fallback that records an unnamed sack
//      or interception -- was missing, then added as a plain `if` when the
//      engine writes it as `} else if`, which double-counted every named
//      play.
//   5. The separate TEAM sack a sack-fumble also earns was missing.
//
// The point of a second implementation is that a disagreement is a question
// worth asking. Five times it was the auditor that was wrong, and finding
// that out is what makes the sixth answer trustworthy.
//
//   node tests/fumble_int_sweep_check.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Fumbles and interceptions: every shape ===\n');

const TEAM = { posOffense:{}, posDefense:{}, rosterOffense:{},
               rosterDefense:{}, rosterSpecialTeams:{} };
const ctx = vm.createContext({
  TEAMS: { teamA: Object.assign({}, TEAM, {name:'Home'}),
           teamB: Object.assign({}, TEAM, {name:'Away'}) },
  startingPossession: 'teamA', PENALTIES: {},
  otherTeam: t => (t === 'teamA' ? 'teamB' : 'teamA'),
  TIMEOUTS_PER_HALF: 3, isAdminMarker: p => !!(p && p.isDivider),
  clockToAbsSeconds: () => null,
  console, Math, JSON, Object, Array, String, Number, Set
});
// globalThis must be the context itself: engine.js defaults RECEIVE_POS onto
// it, and stubbing it as {} makes every fumble throw.
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'), ctx);

const A = 'teamA', B = 'teamB';
const D = (n, name) => ({ team: B, num: n, name });
const SHAPES = [
  ['rush fumble, lost',            {playType:'fumble',attempt:'rush',carrier:{team:A,num:'22',name:'RB',yards:4},lost:true,defense:D('55','LB')}, 1, 1],
  ['rush fumble, own recovery',    {playType:'fumble',attempt:'rush',carrier:{team:A,num:'22',name:'RB',yards:4}}, 1, 0],
  ['rush fumble, touchback',       {playType:'fumble',attempt:'rush',carrier:{team:A,num:'22',name:'RB',yards:4},lost:true}, 1, 1],
  ['pass fumble, lost',            {playType:'fumble',attempt:'pass',passer:{team:A,num:'7',name:'QB',yards:11},receiver:{team:A,num:'80',name:'WR',yards:11},carrier:{team:A,num:'80',name:'WR',yards:11},lost:true,defense:D('55','LB')}, 1, 1],
  ['pass fumble, own recovery',    {playType:'fumble',attempt:'pass',passer:{team:A,num:'7',name:'QB',yards:11},receiver:{team:A,num:'80',name:'WR',yards:11},carrier:{team:A,num:'80',name:'WR',yards:11}}, 1, 0],
  ['sack fumble, lost',            {playType:'fumble',attempt:'sack',passer:{team:A,num:'7',name:'QB',yards:6},carrier:{team:A,num:'7',name:'QB'},lost:true,defense:D('99','DE')}, 1, 1],
  ['sack fumble, own recovery',    {playType:'fumble',attempt:'sack',passer:{team:A,num:'7',name:'QB',yards:6},carrier:{team:A,num:'7',name:'QB'}}, 1, 0],
  ['standalone, own recovery',     {playType:'fumble',carrier:{team:A,num:'22',name:'RB'}}, 1, 0],
  ['standalone, opponent',         {playType:'fumble',carrier:{team:A,num:'22',name:'RB'},lost:true,defense:D('55','LB')}, 1, 1],
  ['standalone, touchback',        {playType:'fumble',carrier:{team:A,num:'22',name:'RB'},lost:true}, 1, 1],
  ['bad snap, defense recovers',   {playType:'fumble',attempt:'rush',carrier:{team:A,num:'TEAM',yards:-9},lost:true,defense:D('55','LB')}, 1, 1],
  ['bad snap, offense recovers',   {playType:'fumble',attempt:'rush',carrier:{team:A,num:'TEAM',yards:-9}}, 1, 0],
  ['interception',                 {playType:'int',passer:{team:A,num:'7',name:'QB',yards:0},receiver:{team:A,num:'80',name:'WR',yards:0},defense:D('21','CB')}, 0, 1],
  ['interception, no interceptor', {playType:'int',passer:{team:A,num:'7',name:'QB',yards:0},receiver:{team:A,num:'80',name:'WR',yards:0}}, 0, 1],
  ['interception, no target',      {playType:'int',passer:{team:A,num:'7',name:'QB',yards:0},defense:D('21','CB')}, 0, 1]
];

const play = r => [{ id:1, text:'x', quarter:1, roles:r, effect:{isStat:true, statYds:0} }];

SHAPES.forEach(([label, roles, wantFum, wantTurnover]) => {
  const p = play(roles);
  const box = ctx.computeBoxScore(p);
  const d = ctx.compareBoxScores(p, box);
  chk(d.length === 0,
      'the two independent counts agree on: ' + label + (d.length ? ' — ' + d[0] : ''));

  const off = box.teamA;
  const fum = ['rushing','receiving','passing'].reduce((n, c) =>
    n + Object.values(off[c] || {}).reduce((m, v) => m + (v.fum || 0), 0), 0);
  chk(fum === wantFum,
      '  and charges ' + wantFum + ' fumble' + (wantFum === 1 ? '' : 's') +
      ' (got ' + fum + ')');

  const tv = ctx.countTurnovers(p);
  chk((tv.teamA || 0) === wantTurnover,
      '  and ' + (wantTurnover ? 'counts' : 'does NOT count') + ' a turnover');
});

// ---- the shapes the entry page can actually produce -----------------------
// The bad snap was the only handler that built roles outside the central
// `roles.playType = roles.playType || type` fallback and got it wrong. The
// QB kneel is the other one, and a kneel is a team rush with no fumble.
{
  const game = fs.readFileSync(path.join(root, 'game.html'), 'utf8');
  chk(/if \(roles\) roles\.playType = roles\.playType \|\| type;/.test(game),
      'the main entry path fills in playType from the panel type, so a branch ' +
      'that omits it is still covered');
  const direct = (game.match(/pending\.roles\s*=\s*\{/g) || []).length;
  chk(direct === 1,
      'and exactly one handler still builds roles outside that path — the QB ' +
      'kneel, which is a team rush with no fumble (found ' + direct + ')');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
