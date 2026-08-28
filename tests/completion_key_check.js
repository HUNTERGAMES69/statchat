// A completion that ends in a fumble is still a completion
// ========================================================
// computeBoxScore wrote `cmp` on the fumble-after-a-completion path and
// `comp` on the ordinary one -- the same passing bucket, two different keys.
//
// Every report reads `.comp`. Nothing anywhere reads `.cmp`. So a quarterback
// whose completion was fumbled by the receiver had the throw counted as an
// attempt and the completion filed under a name no page looks at: the pass
// line read 0-for-1 on a play that was caught.
//
// Found while mapping the crediting rules to build an independent audit of
// the box score -- which is the point of writing a second implementation,
// even before the second implementation exists.
//
//   node tests/completion_key_check.js

const fs = require('fs');
const path = require('path');
const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Completions use one key ===\n');

const engineCode = engineSrc.split('\n')
  .filter(l => !l.trim().startsWith('//')).join('\n');
chk(!/\.cmp\b/.test(engineCode),
    'engine.js writes no `.cmp` anywhere — one spelling of one statistic');
chk(/ps\.comp = \(ps\.comp\|\|0\) \+ 1/.test(engineSrc),
    'the fumble-after-a-completion path writes `.comp`');

// AND NO PAGE READS THE OTHER ONE. If a report ever switched to .cmp this
// would be the same bug facing the other way.
{
  const pages = ['view.html', 'recap.html', 'stat_package.html',
                 'season_report.html', 'broadcast_stats.html'];
  pages.forEach(f => {
    const p = path.join(__dirname, '..', f);
    if (!fs.existsSync(p)) return;
    const s = fs.readFileSync(p, 'utf8');
    chk(!/\.cmp\b/.test(s), f + ' reads .comp, not .cmp');
  });
}

// ---- run it ---------------------------------------------------------------
// The static checks above would pass on an engine that credited nothing at
// all, so the play itself has to go through.
{
  global.startingPossession = 'teamA';
  global.TEAMS = { teamA: { name: 'Home' }, teamB: { name: 'Away' } };
  global.PENALTIES = {};
  eval(engineSrc);

  const plays = [{
    id: 1, text: 'pass complete, fumbled', quarter: 1,
    roles: {
      playType: 'fumble', attempt: 'pass',
      passer:   { team: 'teamA', num: '7',  name: 'QB One', yards: 14 },
      receiver: { team: 'teamA', num: '80', name: 'WR Two', yards: 14 }
    },
    effect: { isStat: true, statYds: 14, fieldDelta: 14 }
  }];

  const box = computeBoxScore(plays);
  const qb = (box.teamA.passing || {})['QB One'] || {};
  const wr = (box.teamA.receiving || {})['WR Two'] || {};

  chk(qb.att === 1, 'the throw counts as an attempt');
  chk(qb.comp === 1,
      'AND as a completion — this was the bug: 1 attempt, 0 completions on a ' +
      'ball that was caught');
  chk(qb.cmp === undefined, 'with nothing left under the old key');
  chk(qb.yds === 14, 'the passing yards are credited');
  chk(wr.rec === 1 && wr.yds === 14,
      'and the receiver keeps the catch — the reception was never the ' +
      'broken half');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
