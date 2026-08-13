// Season stats come from ENDED games only
// ---------------------------------------
// Raised by Andy on 12 August 2026. The behaviour was ALREADY correct —
// `season_report.html` filters `.eq('status', 'final')` and so does
// `reports.html` when listing seasons — so this test does not fix
// anything. It pins something that is easy to lose and expensive to
// notice.
//
// WHY IT EARNS A TEST DESPITE ALREADY PASSING. If that filter ever goes,
// an in-progress game folds its partial numbers into season averages,
// per-game charts and every player's season line. Nothing looks broken.
// Yards per game is simply wrong, the error GROWS as the game goes on,
// and then it vanishes when the game is finalised — so it would be
// close to impossible to reproduce afterwards.
//
// That is the shape of bug worth a cheap permanent guard: silent,
// self-healing, and untraceable after the fact.

const fs = require('fs');
const path = require('path');
const { bootPage } = require('./harness');

const ROSTER = [
  { team_side: 'teamA', unit: 'offense', jersey_number: '22', player_name: 'Roberson', position: 'RB' }
];

let n = 0;
const P = (yds) => ({
  id: ++n, sequence_number: n, game_id: 'g', quarter: 1, team_side: 'teamA',
  is_divider: false, text: 'rush ' + yds,
  effect: { isStat: true, statYds: yds, fieldDelta: yds },
  roles: { carrier: { team: 'teamA', num: '22', yards: yds }, playType: 'rush' }
});

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- the query filters on status --------------------------------------
  // Asserted from the source, because the harness returns whatever game it
  // is given regardless of status — it cannot demonstrate a server-side
  // filter. Crude, but it is the filter itself that must not disappear.
  for (const [file, what] of [
    ['season_report.html', 'season stats'],
    ['reports.html', 'the season list']
  ]) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    if (!/\.eq\(\s*['"]status['"]\s*,\s*['"]final['"]\s*\)/.test(src)) {
      fail('filter', file + ' no longer filters games to status = final. ' +
           'An in-progress game would fold its PARTIAL numbers into ' +
           what + ' — averages quietly wrong, the error growing as the ' +
           'game goes on, then vanishing when it is finalised');
    }
  }

  // --- a finalised game does produce a report ---------------------------
  // The filter must not be so tight that nothing shows.
  {
    n = 0;
    const r = await bootPage('season_report.html', {
      query: '?season=2026',
      roster: ROSTER,
      existingPlays: [P(8), P(12), P(5)],
      game: { status: 'final', season_year: 2026, game_date: '2026-08-24' },
      readyWhen: w => w.document.body.textContent.length > 400
    });
    await new Promise(res => setTimeout(res, 400));
    const text = r.document.body.textContent.replace(/\s+/g, ' ');
    if (!/Roberson/.test(text)) {
      fail('final game', 'a FINALISED game produced no player stats — the ' +
           'filter is excluding games it should include');
    }
    r.close();
  }

  // --- the reports hub only offers seasons with finished games ----------
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'reports.html'), 'utf8');
    // The season list is built from the same filtered query. If it ever
    // stops being, a season containing only in-progress games would offer
    // a report that is either empty or half a game.
    const i = src.indexOf("from('games')");
    const region = i === -1 ? '' : src.slice(i, i + 400);
    if (!/status/.test(region)) {
      fail('season list', 'reports.html builds its season list without ' +
           'reference to status, so a season with only in-progress games ' +
           'would offer a report built from partial data');
    }
  }

  // --- the documented edge case -----------------------------------------
  // Unlocking a finalised game for correction reverts it to in-progress,
  // so its stats DISAPPEAR from the season report until it is finalised
  // again. That is correct — partial data should not count — but it looks
  // like data loss to anyone who does not know why, so it must be
  // explained somewhere the user will find it.
  {
    const help = fs.readFileSync(path.join(__dirname, '..', 'help.html'), 'utf8');
    // Look for the two ideas TOGETHER, in one passage. The first version
    // of this check tested for "unlock" and "season" anywhere in the
    // file, which passed on a technicality: both words appeared, in
    // unrelated sections, and the consequence was documented nowhere.
    const passage = /unlock[^]{0,400}?season|season[^]{0,400}?unlock/i.test(help);
    if (!passage) {
      fail('documentation', 'help.html does not explain that unlocking a ' +
           'game removes it from season stats until it is finalised again. ' +
           'Without that, a coach sees a game vanish from the season ' +
           'report and reasonably concludes the data is gone');
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Season stats from ended games only ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  only finalised games count towards the season.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
