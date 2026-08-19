// Season aggregation fuzzer
// -------------------------
// season_report.html loads N independent games -- each with its OWN
// roster, own plays, own computeBoxScore -- and merges them into one
// season line per player, by name, via mergeInto(). Nothing before
// this fuzzer ever generated more than one game and fed them through
// that merge together; season_filter_check.js proves the STATUS FILTER
// works, using one hand-built game, not that the MERGE across several
// generated games is correct.
//
// THE CENTRAL METHOD: for each fuzzed game, compute its own box score
// independently -- the same computeBoxScore every other fuzzer tonight
// already trusts -- and sum those, by player name, exactly the way
// mergeInto does (sum everything except "long", which is a max). Then
// ask season_report.html for its own aggregate and require an exact
// match. A season total is either the sum of its games or it is wrong;
// there is no third option.
//
// Required extending the harness (tests/harness.js) to support
// opts.games -- an array of independent { game, roster, plays }, each
// with its own game.id -- since the mock previously always returned
// exactly one game/roster/play-set regardless of the game_id filter a
// real multi-game query applies. That extension is purely additive:
// every test before this one omits opts.games and is unaffected.
//
//   node tests/fuzz_season_check.js           # 40 seasons
//   node tests/fuzz_season_check.js 100        # longer soak
//   node tests/fuzz_season_check.js 40 12345   # reproduce a seed

const { bootGamePage, bootPage, defaultRoster } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');
const { rng, int, bool, randomDrivePlay, randomFourthDown } = require('./fuzz_attribution_check.js');

// Simple rushes and passes only, deliberately -- this fuzzer's point is
// the cross-game MERGE, not scrimmage-play variety (fuzz_check.js and
// fuzz_attribution_check.js already own that), and not the special-
// teams/turnover attribution chain (already covered by name there too).
// Keeping every play a plain rush or completed pass also means every
// play has an unambiguous single offensive credit, so the ground truth
// this fuzzer builds by hand cannot itself be ambiguous about who did
// what.
function randomSimplePlay(rand, state) {
  const maxGain = Math.max(1, Math.min(12, 100 - state.fieldPos - 1));
  if (bool(rand, 0.5)) {
    return { type: 'rush', carrier: '22', yards: String(int(rand, 0, maxGain)) };
  }
  return { type: 'pass', passer: '7', receiver: '80', yards: String(int(rand, 0, maxGain)) };
}

async function playOneGame(rand, gameId) {
  const h = await bootGamePage();
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });
  const totalPlays = int(rand, 6, 16);
  for (let i = 0; i < totalPlays; i++) {
    const before = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (before.fieldPos === null || before.down === null) {
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });
      continue;
    }
    const spec = randomSimplePlay(rand, before);
    try { enterPlay(h, spec); } catch (e) { /* a UI refusal is not itself a finding */ }
  }
  // The game must be FINAL for season_report.html's own status filter
  // to include it at all -- an in-progress game is correctly excluded
  // (see season_filter_check.js), so a fuzzed game that stayed
  // in-progress would silently test nothing.
  const rows = h.db.plays.map((r, i) => Object.assign({}, r, {
    sequence_number: r.sequence_number || i + 1, game_id: gameId
  }));
  h.close();
  return rows;
}

function sumBoxInto(target, box) {
  ['rushing', 'passing', 'receiving'].forEach(cat => {
    if (!target[cat]) target[cat] = {};
    Object.keys(box[cat] || {}).forEach(name => {
      if (!target[cat][name]) target[cat][name] = {};
      const delta = box[cat][name];
      Object.keys(delta).forEach(k => {
        if (k === 'long') {
          target[cat][name][k] = Math.max(target[cat][name][k] || 0, delta[k] || 0);
        } else {
          target[cat][name][k] = (target[cat][name][k] || 0) + (delta[k] || 0);
        }
      });
    });
  });
}

async function fuzzOneSeason(seed, gamesPerSeason) {
  const rand = rng(seed);
  const findings = [];
  const games = [];
  const truth = {};

  const numGames = gamesPerSeason || int(rand, 2, 5);
  for (let g = 0; g < numGames; g++) {
    const gameId = 'g' + g;
    const rows = await playOneGame(rand, gameId);
    // Independently computed, using the SAME function season_report.html
    // itself calls -- this fuzzer checks the MERGE across games, not
    // whether computeBoxScore is correct within one, which is already
    // covered elsewhere.
    const v = await bootPage('view.html', { existingPlays: rows });
    const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays).teamA)'));
    v.close();
    sumBoxInto(truth, box);
    games.push({
      game: { id: gameId, status: 'final', season_year: 2026, game_date: '2026-08-0' + (g + 1), designator: 'Week ' + (g + 1) },
      roster: defaultRoster(),
      plays: rows
    });
  }

  const v = await bootPage('season_report.html', {
    query: '?season=2026',
    games,
    readyWhen: w => w.document.body.textContent.length > 400
  });
  await new Promise(res => setTimeout(res, 300));

  for (const cat of ['rushing', 'passing', 'receiving']) {
    const actual = JSON.parse(v.evalIn('JSON.stringify(seasonAgg.' + cat + ')'));
    for (const name of Object.keys(truth[cat] || {})) {
      const expected = truth[cat][name];
      const got = actual[name];
      if (!got) {
        findings.push({ kind: 'MISSING LINE', detail: cat + '/' + name + ': expected ' + JSON.stringify(expected) + ', season report has no line at all' });
        continue;
      }
      for (const stat of Object.keys(expected)) {
        if (got[stat] !== expected[stat]) {
          findings.push({ kind: 'MISMATCH', detail: cat + '/' + name + '.' + stat + ': expected ' + expected[stat] + ' (summed across ' + numGames + ' games), season report has ' + got[stat] });
        }
      }
    }
  }
  v.close();

  return { seed, findings, gamesPlayed: numGames };
}

async function run(seasons, baseSeed, gamesPerSeason) {
  const results = [];
  for (let s = 0; s < seasons; s++) {
    results.push(await fuzzOneSeason((baseSeed || 1) + s * 7919, gamesPerSeason));
  }
  return results;
}

if (require.main === module) {
  const seasons = parseInt(process.argv[2], 10) || 40;
  const baseSeed = parseInt(process.argv[3], 10) || 1;
  run(seasons, baseSeed).then(results => {
    console.log('=== Season aggregation fuzzer ===\n');
    const bad = results.filter(r => r.findings.length);
    const totalGames = results.reduce((t, r) => t + r.gamesPlayed, 0);
    console.log('Seasons: ' + results.length + '   total games across all seasons: ' + totalGames);
    console.log('Seasons with findings: ' + bad.length + '\n');
    for (const r of bad.slice(0, 8)) {
      console.log('  seed ' + r.seed + '  (reproduce: node tests/fuzz_season_check.js 1 ' + r.seed + ')');
      for (const f of r.findings.slice(0, 6)) {
        console.log('     [' + f.kind + '] ' + f.detail);
      }
    }
    if (!bad.length) {
      console.log('  every player\'s season line was exactly the sum of their own games, across every generated season.');
    }
    process.exitCode = bad.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, fuzzOneSeason };
