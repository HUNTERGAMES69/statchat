// The guided kickoff needs both answers
// =====================================
// Two faults in one handler.
//
// The kicker was already required, but refused with a bare `return` -- the
// button did nothing and the scorer was left to guess why.
//
// Direction was not required at all: the save skipped the setDirection play
// whenever none had been picked. That is not decoration. engine.js derives
// state.driveDir from setDirection and from nothing else, and alternates it
// by quarter off the one recorded answer -- so a kickoff saved without it
// leaves every later play with no direction to reason from.
//
//   node tests/guided_kickoff_required_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Guided kickoff: kicker and direction both required ===\n');

const handler = /document\.getElementById\('guidedKickoffSave'\)\.addEventListener\('click', \(\) => \{[\s\S]*?\n      \}\);/.exec(src);
chk(!!handler, 'the save handler is present');

if (handler) {
  const h = handler[0];

  chk(!/if \(!kickerNum\) return;\s*\n/.test(h),
      'the silent refusal is gone — a button that does nothing and says ' +
      'nothing is indistinguishable from a broken one');
  chk(/showReviewMsg\(/.test(h),
      'and a refusal states what is missing, the same way a missing rusher does');

  // RUN THE GUARD. Checking that both names appear is not checking that
  // either is enforced.
  const guard = /const missing = \[\];[\s\S]*?\n        \}/.exec(h);
  chk(!!guard, 'the guard is a real block, not a phrase in a comment');
  if (guard) {
    const run = (kickerNum, kickDir) => {
      let msg = null;
      const refused = new Function('kickerNum', 'kickDir', 'TEAMS', 'guided', 'showReviewMsg',
        guard[0].replace('return;', 'return true;') + '; return false;')(
        kickerNum, kickDir, { teamA: { name: 'Red Stick' } }, { kickingTeam: 'teamA' },
        (m) => { msg = m; });
      return { refused, msg };
    };

    chk(run(null, null).refused, 'neither picked is refused');
    chk(run('18', null).refused,
        'a kicker with NO DIRECTION is refused — this is the case that was ' +
        'silently allowed, and it costs driveDir for the rest of the game');
    chk(run(null, 'left').refused, 'a direction with no kicker is refused');
    chk(!run('18', 'left').refused, 'and both together saves');

    chk(/which way/i.test(run('18', null).msg || ''),
        'the message names the direction when that is what is missing');
    chk(/kicker/i.test(run(null, 'left').msg || ''),
        'and the kicker when that is');
    chk(/ and /.test(run(null, null).msg || ''),
        'and both when both are');
  }

  // The setDirection play must no longer be conditional -- with the guard
  // above, kickDir cannot be null, and leaving the `if` would suggest it can.
  chk(!/if \(kickDir\)\{/.test(h),
      'the setDirection play is emitted unconditionally, because the guard ' +
      'has already made a null direction impossible');
  chk(/effect: \{ setDirection: \{ team: guided\.kickingTeam, dir: kickDir \} \}/.test(h),
      'and it still records the direction it was given');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
