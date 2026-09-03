// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// Sack yardage belongs to the passer, not to a TEAM row
// =====================================================
// Written 3 September 2026, when the engine was corrected. Until then it
// charged a sack to a TEAM rushing row and three documents said that was
// "the NFHS treatment". It is not. NFHS Statisticians' Manual, section 2:
//
//   "Any loss by a player apparently intending to pass, but downed behind
//    the LOS, is recorded as 'Loss by Rushing.' The player is not a passer
//    until the player has thrown the ball, since a player retains at all
//    times the option of running."
//
//   "Whenever a player attempting to pass is tackled behind the LOS, that
//    player is charged with a 'time carried' and minus rushing yards."
//
// THAT PLAYER. NCAA is the same. The NFL is the outlier and takes it out of
// TEAM PASSING -- which is what the old comments attributed to NCAA, so both
// halves of the claim were wrong.
//
// The claim reached three documents because it was read out of two code
// comments that named a rule book without citing one. A comment asserting an
// external rule is a claim to verify, never a citation.
//
// WHAT THIS FILE PINS, in order of what would hurt most if it broke:
//
//   1. THE TEAM TOTAL DOES NOT MOVE. The same attempt and the same loss sit
//      on a different row inside the same team. Every tile, feed and report
//      reads what it always did. If this breaks, every surface is wrong at
//      once and nobody will suspect the sack.
//   2. The passer carries it, so his line matches an official worksheet.
//   3. The sign. The panel stores a sack loss as a POSITIVE magnitude, so
//      the engine subtracts. A flipped sign reads as a gain and is silent.
//   4. The TEAM row is still right for a BAD SNAP -- the manual says so --
//      and for a kneel until that is corrected too.
//
//   node tests/sack_attribution_check.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Sack yardage is charged to the passer (NFHS) ===\n');

const TEAM = { posOffense:{}, posDefense:{}, rosterOffense:{},
               rosterDefense:{}, rosterSpecialTeams:{} };
const ctx = vm.createContext({
  TEAMS: { teamA: Object.assign({}, TEAM, { name:'Home',
             rosterOffense: { '7':'Reed', '22':'Boone' } }),
           teamB: Object.assign({}, TEAM, { name:'Away' }) },
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
const rushOf = (box, team) => ((box[team] || {}).rushing) || {};
const sum = (rows, f) => Object.values(rows).reduce((n, v) => n + (v[f] || 0), 0);

const SACK = [P({ playType:'sack', passer:{ team:'teamA', num:'7', name:'Reed', yards:7 } }, -7)];

// ---- 1. the team total is the thing that must not move ------------------
{
  const r = rushOf(ctx.computeBoxScore(SACK), 'teamA');
  chk(sum(r, 'yds') === -7, 'team rushing yards total is -7, wherever the row sits');
  chk(sum(r, 'att') === 1,  'team rushing attempts total is 1, wherever the row sits');
}

// ---- 2. and it sits on the passer ---------------------------------------
{
  const r = rushOf(ctx.computeBoxScore(SACK), 'teamA');
  chk(!!r.Reed && r.Reed.att === 1, 'the passer is charged one rushing attempt');
  chk(!!r.Reed && r.Reed.yds === -7, 'the passer is charged minus seven rushing yards');
  chk(!r.TEAM, 'no TEAM rushing row is created by a sack');
  chk(!r.Reed.long, 'a sack never becomes his longest rush');
}

// ---- 3. the sign, which fails silently if it flips ----------------------
{
  const r = rushOf(ctx.computeBoxScore(SACK), 'teamA');
  chk(r.Reed.yds < 0, 'the stored POSITIVE magnitude is subtracted, not added');
}

// ---- 4. a quarterback who also runs keeps ONE line -----------------------
{
  const r = rushOf(ctx.computeBoxScore([
    P({ playType:'rush', carrier:{ team:'teamA', num:'7', name:'Reed', yards:12 } }, 12),
    P({ playType:'sack', passer:{ team:'teamA', num:'7', name:'Reed', yards:5 } }, -5)
  ]), 'teamA');
  chk(Object.keys(r).length === 1, 'one rushing row for him, not two');
  chk(r.Reed.att === 2 && r.Reed.yds === 7, 'carries and sacks accumulate: 2 for 7');
  chk(r.Reed.long === 12, 'longest rush is the real carry, untouched by the sack');
}

// ---- 5. a strip-sack is still a sack -------------------------------------
{
  const r = rushOf(ctx.computeBoxScore([
    P({ playType:'fumble', attempt:'sack',
        passer:{ team:'teamA', num:'7', name:'Reed', yards:9 },
        carrier:{ team:'teamA', num:'7', name:'Reed' }, lost:true }, -9)
  ]), 'teamA');
  chk(!!r.Reed && r.Reed.att === 1 && r.Reed.yds === -9, 'a strip-sack charges the passer');
  chk(r.Reed.fum === 1, 'and the fumble lands on the same row');
  chk(!r.TEAM, 'still no TEAM row');
}

// ---- 6. WHAT MUST NOT HAVE CHANGED --------------------------------------
// The TEAM row is a real NFHS construct. It was over-applied, not invented.
{
  const kneel = rushOf(ctx.computeBoxScore(
    [P({ playType:'rush', carrier:{ team:'teamA', num:'TEAM', yards:-2 } }, -2)]), 'teamA');
  chk(!!kneel.TEAM && kneel.TEAM.att === 1 && kneel.TEAM.yds === -2,
      'a KNEEL still charges TEAM (NFHS charges the player; not yet corrected)');

  const snap = rushOf(ctx.computeBoxScore(
    [P({ playType:'fumble', attempt:'rush',
         carrier:{ team:'teamA', num:'TEAM', yards:-11 }, lost:true }, -11)]), 'teamA');
  chk(!!snap.TEAM && snap.TEAM.yds === -11,
      'a BAD SNAP still charges TEAM, which IS the NFHS treatment');
}

// ---- 7. the passing line is untouched ------------------------------------
{
  const pass = (ctx.computeBoxScore(SACK).teamA || {}).passing || {};
  chk(!!pass.Reed && pass.Reed.sacked === 1, 'he is still credited with being sacked once');
  chk(!pass.Reed.att, 'a sack is still not a pass attempt');
  chk(!pass.Reed.yds, 'and takes nothing off his passing yards');
}

// ---- 8. the engine's own oracle agrees ----------------------------------
// auditBoxScore is an independent re-implementation of the same rules. It is
// the check that catches one of the two being changed without the other.
{
  const plays = [
    P({ playType:'rush', carrier:{ team:'teamA', num:'7',  name:'Reed',  yards:12 } }, 12),
    P({ playType:'sack', passer: { team:'teamA', num:'7',  name:'Reed',  yards:5  } }, -5),
    P({ playType:'sack', passer: { team:'teamA', num:'7',  name:'Reed',  yards:3  } }, -3),
    P({ playType:'rush', carrier:{ team:'teamA', num:'22', name:'Boone', yards:4  } }, 4)
  ];
  const audit = ((ctx.auditBoxScore(plays).teamA || {}).rushing) || {};
  const box   = rushOf(ctx.computeBoxScore(plays), 'teamA');
  chk(audit.Reed && box.Reed &&
      audit.Reed.att === box.Reed.att && audit.Reed.yds === box.Reed.yds,
      'auditBoxScore and computeBoxScore agree on the passer: att ' +
      (audit.Reed || {}).att + ', yds ' + (audit.Reed || {}).yds);
  chk(!audit.TEAM && !box.TEAM, 'neither implementation invents a TEAM rushing row');
}

console.log('\nFailures: ' + fails);
if (!fails) console.log('  sack yardage sits on the passer, team totals unmoved, ' +
                        'bad snaps still TEAM.');
process.exit(fails ? 1 : 0);
