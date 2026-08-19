// Roster / picker fuzzer -- shared jersey numbers
// -------------------------------------------------
// shared_number_check.js proved the mechanism works for ONE fixed
// scenario: two named players on #5, three specific rushes, in that
// exact order. This fuzzer asks the same question across many random
// rosters and many random games: does the play always follow the
// PLAYER, never merge into the number, regardless of how many players
// share a number, which numbers those are, how many times each one
// touches the ball, or what else is happening in the game around them.
//
// THE CENTRAL METHOD, not just "did it crash": build an independent
// ground-truth tally alongside the game as it is generated -- for
// every rush credited to a specific named player sharing a number,
// record it in a plain object, not derived from the app at all. At the
// end, ask the app's own computeBoxScore for the same numbers and
// require an EXACT match, by name. A merged or misattributed line is a
// wrong number, not just a missing one, so this checks the actual
// figures rather than only their presence.
//
// ui_driver.js's pickPlayer/enterPlay gained opts.name / spec.carrierName
// specifically to make this fuzzer possible without a second, unproven
// way of interacting with the picker -- disambiguating a shared number
// by name is itself something a coach does, so it goes through the same
// entryway as everything else in this app's tests.
//
//   node tests/fuzz_roster_check.js           # 150 games
//   node tests/fuzz_roster_check.js 400        # longer soak
//   node tests/fuzz_roster_check.js 150 12345  # reproduce a seed

const { bootGamePage, bootPage, defaultRoster } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');
const { rng, int, bool } = require('./fuzz_attribution_check.js');

const OFFENSE_NUMS = ['22', '28', '7', '80', '84'];
const FIRST_NAMES = ['Reddick', 'Powell', 'Torres', 'Nakamura', 'Okafor', 'Bianchi', 'Sokolov', 'Delacroix'];

// Builds a roster with 0-2 shared-number pairs on teamA's offense --
// scoped to offense/rushing specifically, matching shared_number_check.js's
// own scope, rather than trying to cover every unit and every stat
// category in one fuzzer. teamB is left at the plain default roster so
// every ambiguity in a given game is known to be on teamA, which keeps
// the ground-truth tally simple to build correctly.
function randomRoster(rand) {
  const roster = defaultRoster();
  const shared = {}; // num -> [name1, name2]
  const pairs = int(rand, 0, 2);
  const usedNums = new Set();
  const usedNames = new Set();
  for (let i = 0; i < pairs; i++) {
    let num;
    do { num = OFFENSE_NUMS[int(rand, 0, OFFENSE_NUMS.length - 1)]; } while (usedNums.has(num));
    usedNums.add(num);
    let name;
    do { name = FIRST_NAMES[int(rand, 0, FIRST_NAMES.length - 1)]; } while (usedNames.has(name));
    usedNames.add(name);
    roster.push({ team_side: 'teamA', unit: 'offense', jersey_number: num, player_name: name, position: 'RB' });
    shared[num] = [roster.find(r => r.team_side === 'teamA' && r.jersey_number === num && r.player_name !== name).player_name, name];
  }
  return { roster, shared };
}

async function fuzzOneGame(seed) {
  const rand = rng(seed);
  const findings = [];
  const { roster, shared } = randomRoster(rand);
  const sharedNums = Object.keys(shared);

  const h = await bootGamePage({ roster });
  const uncaughtErrors = [];
  h.window.addEventListener('error', (e) => uncaughtErrors.push((e.error && e.error.message) || e.message));

  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });

  // Ground truth, built independently of anything the app computes.
  const truth = {}; // name -> { att, yds }
  const record = (name, yds) => {
    if (!truth[name]) truth[name] = { att: 0, yds: 0 };
    truth[name].att++;
    truth[name].yds += yds;
  };

  let playsRun = 0;
  const totalPlays = int(rand, 15, 30);
  for (let i = 0; i < totalPlays; i++) {
    const before = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    // FORCED BACK TO teamA WHENEVER POSSESSION FLIPS AWAY. Found by
    // running this fuzzer, not by reasoning about it in advance: a
    // failed 4th-down conversion (a real, frequent outcome across
    // 15-30 random plays) hands the ball to teamB, and this loop kept
    // generating teamA-roster carrier specs regardless -- which the
    // app correctly, from its own perspective, either matched to
    // teamB's OWN roster at that number or failed to resolve at all,
    // producing a string of false "missing" findings that were really
    // this fuzzer entering plays for a team that did not have the
    // ball. setDrive only adjusts whoever is ALREADY on offense (its
    // own doc comment says so) -- it cannot flip possession itself, so
    // this uses the same forcePossession marker game.html's own manual
    // flip writes, directly, the same way the period-transition
    // fuzzer injects halftime/overtime markers rather than driving
    // every admin action through a UI button. This fuzzer's whole
    // point is teamA's shared-number mechanism, not realistic
    // back-and-forth possession, so forcing it back is the right fix.
    if (before.possession !== 'teamA') {
      h.evalIn("pushAndPersist({ id: nextId++, text: 'Manual flip — possession to Neville', effect: { forcePossession: 'teamA' } })");
    }
    if (before.possession !== 'teamA' || before.fieldPos === null || before.down === null) {
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });
      continue;
    }
    // Simple rushes only, deliberately -- this fuzzer's whole point is
    // the roster/picker mechanism, not scrimmage-play variety, which
    // fuzz_check.js and fuzz_attribution_check.js already own.
    const maxGain = Math.max(1, Math.min(15, 100 - before.fieldPos - 1));
    const yds = int(rand, 0, maxGain);
    let num, name;
    if (sharedNums.length && bool(rand, 0.5)) {
      num = sharedNums[int(rand, 0, sharedNums.length - 1)];
      name = shared[num][int(rand, 0, 1)];
    } else {
      // GENUINELY UNAMBIGUOUS ONLY. Found by running this fuzzer, not
      // by reasoning about it in advance: picking from the full pool
      // here could land on a number that IS shared, entering an
      // undisambiguated rush that the app correctly (from its own
      // perspective, given no name was offered) sent to whichever
      // player's button is first in the DOM -- while this fuzzer's own
      // ground-truth tally never recorded it at all, since name was
      // null. That produced a false finding blaming the app for a
      // count this test itself failed to track.
      const unambiguous = OFFENSE_NUMS.filter(n => !sharedNums.includes(n));
      num = unambiguous[int(rand, 0, unambiguous.length - 1)];
      name = null;
    }
    const spec = { type: 'rush', carrier: num, carrierName: name || undefined, yards: String(yds) };
    try {
      enterPlay(h, spec);
    } catch (e) {
      findings.push({ kind: 'threw', detail: 'rush #' + num + (name ? ' (' + name + ')' : '') + ': ' + e.message.split('\n')[0].slice(0, 100) });
      continue;
    }
    if (name) record(name, yds);
    playsRun++;
  }

  const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();

  const v = await bootPage('view.html', { existingPlays: rows, roster });
  const rushing = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays).teamA.rushing)'));
  v.close();

  for (const name of Object.keys(truth)) {
    const t = truth[name];
    const line = rushing[name];
    if (!line) {
      findings.push({ kind: 'MISSING LINE', detail: name + ' should have ' + t.att + ' att for ' + t.yds + ' yds -- no line at all in the box score' });
      continue;
    }
    if (line.att !== t.att) {
      findings.push({ kind: 'ATTEMPTS', detail: name + ': expected ' + t.att + ' attempts, box score has ' + line.att });
    }
    if (line.yds !== t.yds) {
      findings.push({ kind: 'YARDS', detail: name + ': expected ' + t.yds + ' yds, box score has ' + line.yds });
    }
  }
  // Every OTHER key in the box score must be accounted for -- a name
  // appearing that was never in `truth` at all would mean a shared
  // number's carry got attributed to the WRONG one of the two players,
  // which under-counts one and invents carries for the other. Checking
  // only the expected names would miss exactly that failure mode.
  for (const name of Object.keys(rushing)) {
    if (sharedNums.some(n => shared[n].includes(name)) && !truth[name] && rushing[name].att > 0) {
      findings.push({ kind: 'PHANTOM LINE', detail: name + ' has ' + rushing[name].att + ' attempts in the box score but was never actually given the ball -- ' +
        'a shared-number carry was likely attributed to the wrong player.' });
    }
  }

  uncaughtErrors.forEach(msg => findings.push({ kind: 'UNCAUGHT', detail: msg }));

  return { seed, findings, playsGenerated: playsRun, sharedPairs: sharedNums.length };
}

async function run(games, baseSeed) {
  const results = [];
  for (let g = 0; g < games; g++) {
    results.push(await fuzzOneGame((baseSeed || 1) + g * 7919));
  }
  return results;
}

if (require.main === module) {
  const games = parseInt(process.argv[2], 10) || 150;
  const baseSeed = parseInt(process.argv[3], 10) || 1;
  run(games, baseSeed).then(results => {
    console.log('=== Roster / picker fuzzer (shared jersey numbers) ===\n');
    const bad = results.filter(r => r.findings.length);
    const plays = results.reduce((t, r) => t + r.playsGenerated, 0);
    const sharedGames = results.filter(r => r.sharedPairs > 0).length;
    console.log('Games: ' + results.length + '   plays generated: ' + plays +
      '   games with at least one shared number: ' + sharedGames);
    console.log('Games with findings: ' + bad.length + '\n');
    for (const r of bad.slice(0, 10)) {
      console.log('  seed ' + r.seed + '  (reproduce: node tests/fuzz_roster_check.js 1 ' + r.seed + ')');
      for (const f of r.findings.slice(0, 5)) {
        console.log('     [' + f.kind + '] ' + f.detail);
      }
    }
    if (!bad.length) {
      console.log('  every shared-number carry followed the right player, exactly, across every generated roster.');
    }
    process.exitCode = bad.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, fuzzOneGame };
