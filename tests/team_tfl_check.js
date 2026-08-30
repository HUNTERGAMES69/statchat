// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// An unattributed tackle for loss counts for the team
// ===================================================
// Found 27 August 2026, from a scorer noticing that team TFL appeared on
// the crew view for plays where he had named nobody.
//
// TFL was credited only inside the named-defender branch of
// computeBoxScore, so a loss with nobody written down vanished from the box
// score. The crew view and the broadcast overlay each reduced the plays
// themselves and counted it -- so the number on air was right and the one
// in the stat package was low. Two named losses and one unnamed: 3 against
// 1.
//
// Interceptions, sacks and fumble recoveries were fine, because the engine
// already had a TEAM-row fallback for those three. TFL had none. That is
// why only one of the four disagreed.
//
// Naming the tackler is optional by design. A team TFL is a fact about the
// play, not about whether anyone wrote down who made it.
//
//   node tests/team_tfl_check.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Team tackles for loss ===\n');

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
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'), ctx);

const P = (roles, y) => ({ id: Math.random(), text: 'x', quarter: 1,
                           roles, effect: { isStat: true, statYds: y } });
const totalTfl = plays => Object.values(
  (ctx.computeBoxScore(plays).teamB || {}).defense || {}
).reduce((n, v) => n + (v.tfl || 0), 0);

// ---- the rule -----------------------------------------------------------
chk(totalTfl([P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-4} }, -4)]) === 1,
    'a loss with NO tackler named counts one team TFL — this was zero');
chk(totalTfl([P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-4},
                  defense:{team:'teamB',num:'55',name:'LB'} }, -4)]) === 1,
    'a loss WITH a tackler named still counts one, not two');
chk(totalTfl([P({ playType:'sack', passer:{team:'teamA',num:'7',name:'QB',yards:6} }, -6)]) === 1,
    'an unattributed sack counts');
chk(totalTfl([P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:5} }, 5)]) === 0,
    'and a gain does not');

// UNATTRIBUTED GOES TO THE TEAM ROW, named to the player — mirroring int,
// sacks and fumble recoveries, so the column sums to the team total rather
// than double-counting the named ones.
{
  const box = ctx.computeBoxScore([
    P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-2} }, -2),
    P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-3},
        defense:{team:'teamB',num:'55',name:'LB'} }, -3)
  ]);
  const d = box.teamB.defense;
  chk((d.TEAM || {}).tfl === 1, 'the unattributed one sits on the TEAM row');
  chk((d.LB || {}).tfl === 1, 'and the named one on the player');
  chk(totalTfl([
        P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-2} }, -2),
        P({ playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-3},
            defense:{team:'teamB',num:'55',name:'LB'} }, -3)
      ]) === 2,
      'so the column sums to two, which is how many losses there were');
}

// ---- the pages read it rather than recomputing --------------------------
// Three of the four agreed with the engine by coincidence. Keeping a second
// copy is how they drift; only one of them had drifted so far.
['view.html', 'broadcast_stats.html'].forEach(f => {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  chk(!/TFL_TYPES/.test(src),
      f + ': no longer reduces the plays itself');
  chk(/const defRows = \(\(computeBoxScore\(/.test(src),
      f + ': reads the box score instead, so there is one rule');
  chk(/acc\.tfl\s*\+= v\.tfl\s*\|\| 0;/.test(src),
      f + ': and sums the rows, team plus named, for the total it displays');
});

// ---- the auditor agrees ------------------------------------------------
// The second implementation has to know the same rule, or every game with
// an unattributed loss reports a disagreement at finalize.
[
  ['unattributed loss', { playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-4} }, -4],
  ['named loss', { playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:-4},
                   defense:{team:'teamB',num:'55',name:'LB'} }, -4],
  ['unattributed sack', { playType:'sack', passer:{team:'teamA',num:'7',name:'QB',yards:6} }, -6],
  ['a gain', { playType:'rush', carrier:{team:'teamA',num:'22',name:'RB',yards:5} }, 5]
].forEach(([label, roles, y]) => {
  const plays = [P(roles, y)];
  const d = ctx.compareBoxScores(plays, ctx.computeBoxScore(plays));
  chk(d.length === 0,
      'the two independent counts agree on: ' + label + (d.length ? ' — ' + d[0] : ''));
});

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
