// Week runner
// -----------
// Drives entire NFL weeks through the QA harness and reports one line per
// game plus a week total.
//
//   node tests/nfl/run_week.js 2          # week 2 of 2023
//   node tests/nfl/run_week.js 1 2 3      # weeks 1, 2 and 3
//
// Roughly 12 minutes per week. Meant for a nightly or pre-release run,
// not for the normal suite.
//
// Why whole weeks rather than "the first N games": running the same
// leading games repeatedly proves less each time. Distinct weeks bring
// distinct teams, play-callers and game scripts -- blowouts, overtime,
// weather games -- which is where an engine assumption is most likely to
// be caught out.

const { runGame } = require('./run_qa');
const fetchNfl = require('./fetch');

async function runWeek(year, week) {
  const pbpPath = fetchNfl.playByPlay(year);
  const ids = fetchNfl.listWeekGameIds(pbpPath, week);
  const results = [];
  for (const gid of ids) {
    const rows = fetchNfl.readGame(pbpPath, gid);
    results.push(await runGame(rows, gid));
  }
  return results;
}

function summarise(week, results) {
  let plays = 0, pairs = 0, t0 = 0, t1 = 0, t3 = 0, failed = 0;
  console.log('\n--- ' + (results.length ? 'week ' + week : 'week ' + week + ' (no games)') + ' ---');
  for (const r of results) {
    const tier1 = r.issues.filter(i => i.area.indexOf('tier1') === 0).length;
    const tier2 = r.issues.filter(i => i.area.indexOf('tier2') === 0).length;
    plays += r.entered; pairs += r.comparable;
    t0 += r.stateMismatches; t1 += tier1; t3 += r.validationCount; failed += r.failed;
    const bad = r.stateMismatches + tier1 + tier2 + r.validationCount + r.failed;
    console.log('  ' + r.gameId.padEnd(20) + String(r.entered).padStart(4) + ' plays  ' +
      'state ' + String(r.stateMismatches) + '/' + String(r.comparable).padEnd(5) +
      ' yds ' + String(tier1).padEnd(3) + ' surf ' + String(tier2).padEnd(3) +
      ' valid ' + String(r.validationCount).padEnd(3) + (bad ? '  <-- ISSUES' : ''));
    for (const i of r.issues.slice(0, 4)) {
      console.log('        [' + i.area + '] ' + i.detail);
    }
  }
  const total = t0 + t1 + t3 + failed;
  console.log('  ' + '-'.repeat(76));
  console.log('  week ' + week + ': ' + results.length + ' games, ' + plays + ' plays, ' +
    pairs + ' state pairs  ->  ' + (total === 0 ? 'CLEAN' : total + ' ISSUES'));
  return { week, games: results.length, plays, pairs, total };
}

async function run(weeks, year) {
  const summaries = [];
  for (const w of weeks) {
    summaries.push(summarise(w, await runWeek(year || 2023, w)));
  }
  return summaries;
}

if (require.main === module) {
  const args = process.argv.slice(2).map(n => parseInt(n, 10)).filter(n => n > 0);
  const weeks = args.length ? args : [1];
  run(weeks).then(sums => {
    console.log('\n=== summary ===');
    let clean = 0, plays = 0, pairs = 0;
    for (const s of sums) {
      console.log('  week ' + String(s.week).padEnd(3) + s.games + ' games, ' +
        String(s.plays).padStart(5) + ' plays, ' + String(s.pairs).padStart(5) +
        ' pairs  ' + (s.total === 0 ? 'CLEAN' : s.total + ' issues'));
      if (s.total === 0) clean++;
      plays += s.plays; pairs += s.pairs;
    }
    console.log('\n  ' + clean + ' of ' + sums.length + ' weeks clean, ' +
      plays + ' plays, ' + pairs + ' state pairs total');
    process.exitCode = clean === sums.length ? 0 : 1;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, runWeek };
