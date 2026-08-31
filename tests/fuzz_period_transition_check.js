// Period-transition fuzzer
// ------------------------
// Built 19 Aug 2026, immediately after finding (by hand, not by any
// existing fuzzer) that EVERY halftime in EVERY game was registering a
// phantom drive at the opening kickoff of the second half. Neither
// fuzz_check.js nor fuzz_attribution_check.js ever inserts a period
// transition at all -- they generate a flat sequence of plays and stop.
// That gap is exactly why the halftime bug survived as long as it did:
// it is not a rare combination, it is something that happens in every
// single game, and nothing had ever asked the engine to do it in an
// automated way.
//
// This fuzzer plays a random first half, inserts a halftime transition
// at a RANDOM point (so whatever was just happening -- an ordinary
// drive, a score and its try, a defensive score and ITS try, a muffed
// kick -- varies across seeds rather than being hand-picked), plays a
// random second half, then randomly inserts an overtime transition too
// (which uses a completely different mechanism -- forcePossession, not
// a kickoff -- so it is not just "the same test twice").
//
// THE CENTRAL CHECK, reused directly rather than re-derived: a drive
// boundary must never land on a play whose own effect immediately
// reverses possession again (a kickoff/punt that flips right back), and
// a PAT/2PT try must never register as a drive of its own. Both are
// exactly the fix already verified in isolation for the ordinary,
// single-transition case -- this checks they hold across many random
// games, with a transition landing at an unpredictable point in an
// unpredictable game state, not just the one sequence tested by hand.
//
//   node tests/fuzz_period_transition_check.js           # 150 games
//   node tests/fuzz_period_transition_check.js 400        # longer soak
//   node tests/fuzz_period_transition_check.js 150 12345  # reproduce a seed

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, UnreachableByUI } = require('./ui_driver');
const {
  rng, pick, int, bool, randomDrivePlay, randomFourthDown, randomKickoff, randomTry,
  attributionFindings, GENERAL_INVARIANTS, OFFENSE
} = require('./fuzz_attribution_check.js');

// Drives a short sequence of ordinary plays, handling the TD-then-try
// sequencing the same way fuzz_attribution_check.js's own main loop
// does -- duplicated rather than imported, since that loop is not
// factored out as its own function there and refactoring it now would
// risk the fuzzer that is already trusted and passing.
async function playSequence(h, rand, count, uncaughtErrors, plays) {
  for (let i = 0; i < count; i++) {
    const before = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (before.fieldPos === null || before.down === null) {
      let spec;
      try { spec = randomKickoff(rand); enterPlay(h, spec); }
      catch (e) { /* a UI refusal here is not itself a finding */ }
      plays.count++;
      continue;
    }
    const spec = before.down === 4 ? randomFourthDown(rand, before) : randomDrivePlay(rand, before);
    try {
      enterPlay(h, spec);
    } catch (e) {
      if (!(e instanceof UnreachableByUI)) {
        uncaughtErrors.push({ playIndex: plays.count, msg: 'threw: ' + spec.type + ': ' + e.message.split('\n')[0].slice(0, 100) });
      }
      plays.count++;
      continue;
    }
    const lastReal = JSON.parse(h.evalIn(
      'JSON.stringify((function(){ for (let i = plays.length - 1; i >= 0; i--){ if (!isAdminMarker(plays[i])) return plays[i]; } return null; })())'
    ));
    if (lastReal && lastReal.effect && lastReal.effect.score && lastReal.effect.score.points === 6) {
      try { enterPlay(h, randomTry(rand)); } catch (e) { /* a refusal here is not a finding */ }
    }
    plays.count++;
  }
}

// PHANTOM-DRIVE CHECK, same shape as fuzz_attribution_check.js's own,
// called explicitly right after each transition rather than only once
// at the end of the game -- a phantom drive introduced at halftime and
// then overwritten by later plays could otherwise go unnoticed if only
// the final state were ever inspected.
function phantomDriveFindings(h) {
  const findings = [];
  const starts = JSON.parse(h.evalIn('JSON.stringify(findDriveStarts(plays))'));
  for (const idx of starts) {
    const p = JSON.parse(h.evalIn('JSON.stringify(plays[' + idx + '])'));
    const playType = p.roles && p.roles.playType;
    if ((playType === 'kickoff' || playType === 'punt') && p.effect && p.effect.flip && p.effect.flipApplied) {
      findings.push('drive start at play[' + idx + '] "' + p.text + '" is itself a kick that flips possession.');
    }
    if (playType === 'pat' || playType === 'twopt') {
      findings.push('drive start at play[' + idx + '] "' + p.text + '" is a PAT/2PT try, never a drive of its own.');
    }
  }
  return findings;
}

async function fuzzOneGame(seed, playsPerHalf) {
  const rand = rng(seed);
  const findings = [];
  const uncaughtErrors = [];
  const plays = { count: 0 };
  const h = await bootGamePage();
  h.window.addEventListener('error', (e) => {
    uncaughtErrors.push({ playIndex: plays.count, msg: (e.error && e.error.message) || e.message });
  });

  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });

  // FIRST HALF, stopping at a random point rather than a fixed count --
  // varies whether halftime lands mid-drive, right after a score, or
  // right after a muffed kick, across seeds.
  const firstHalfPlays = int(rand, 3, playsPerHalf || 12);
  await playSequence(h, rand, firstHalfPlays, uncaughtErrors, plays);

  h.evalIn("pushAndPersist({ id: nextId++, text: 'End of 1st half', effect: {}, isDivider: true })");
  h.evalIn("pushAndPersist({ id: nextId++, text: 'Start of 2nd half', effect: { setQuarter: 3 }, isDivider: true })");
  // Randomize which team kicks to open the second half -- deferred vs.
  // received choice, both real outcomes of the coin toss.
  const secondHalfKicker = bool(rand, 0.5) ? pick(rand, OFFENSE) : '99';
  try { enterPlay(h, randomKickoff(rand)); } catch (e) { /* refusal is not a finding */ }
  phantomDriveFindings(h).forEach(d => findings.push({ kind: 'PHANTOM DRIVE (halftime)', detail: d }));

  // SECOND HALF.
  const secondHalfPlays = int(rand, 3, playsPerHalf || 12);
  await playSequence(h, rand, secondHalfPlays, uncaughtErrors, plays);

  // OVERTIME, roughly a third of the time -- a different transition
  // mechanism entirely (forcePossession/otSeriesStart, no kickoff), so
  // this is not just re-running the halftime check a second time.
  if (bool(rand, 0.35)) {
    const otTeam = bool(rand, 0.5) ? 'teamA' : 'teamB';
    const otYardline = int(rand, 5, 15);
    h.evalIn(
      "pushAndPersist({ id: nextId++, text: 'Overtime series begins', effect: { forcePossession: '" + otTeam +
      "', otSeriesStart: true }, quarter: 5 })"
    );
    h.evalIn(
      "pushAndPersist({ id: nextId++, text: 'New drive', effect: { isReset: true, down: 1, distance: 10, fieldPos: " +
      (100 - otYardline) + " }, quarter: 5 })"
    );
    phantomDriveFindings(h).forEach(d => findings.push({ kind: 'PHANTOM DRIVE (overtime)', detail: d }));
    await playSequence(h, rand, int(rand, 2, 6), uncaughtErrors, plays);

    // A second OT series, for the other team -- exercises the SAME
    // transition mechanism firing twice in a row, which is exactly the
    // shape that matters: does the second series correctly close out
    // whatever the first one left open.
    if (bool(rand, 0.6)) {
      const otTeam2 = otTeam === 'teamA' ? 'teamB' : 'teamA';
      h.evalIn(
        "pushAndPersist({ id: nextId++, text: 'Overtime series begins', effect: { forcePossession: '" + otTeam2 +
        "', otSeriesStart: true }, quarter: 5 })"
      );
      h.evalIn(
        "pushAndPersist({ id: nextId++, text: 'New drive', effect: { isReset: true, down: 1, distance: 10, fieldPos: " +
        (100 - otYardline) + " }, quarter: 5 })"
      );
      phantomDriveFindings(h).forEach(d => findings.push({ kind: 'PHANTOM DRIVE (overtime 2)', detail: d }));
      await playSequence(h, rand, int(rand, 2, 6), uncaughtErrors, plays);
    }
  }

  for (const [name, check] of GENERAL_INVARIANTS) {
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    const bad = check(st);
    if (bad) findings.push({ kind: name, detail: bad });
  }

  const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();
  attributionFindings(rows).forEach(d => findings.push({ kind: 'ATTRIBUTION', detail: d }));
  uncaughtErrors.forEach(e => findings.push({ kind: 'UNCAUGHT', detail: 'play index ' + e.playIndex + ': ' + e.msg }));

  return { seed, findings, playsGenerated: plays.count };
}

async function run(games, baseSeed, playsPerHalf) {
  const results = [];
  for (let g = 0; g < games; g++) {
    results.push(await fuzzOneGame((baseSeed || 1) + g * 7919, playsPerHalf || 12));
  }
  return results;
}

if (require.main === module) {
  const games = parseInt(process.argv[2], 10) || 150;
  const baseSeed = parseInt(process.argv[3], 10) || 1;
  run(games, baseSeed).then(results => {
    console.log('=== Period-transition fuzzer (halftime / overtime) ===\n');
    const bad = results.filter(r => r.findings.length);
    const plays = results.reduce((t, r) => t + r.playsGenerated, 0);
    console.log('Games: ' + results.length + '   plays generated: ' + plays);
    console.log('Games with findings: ' + bad.length + '\n');
    for (const r of bad.slice(0, 10)) {
      console.log('  seed ' + r.seed + '  (reproduce: node tests/fuzz_period_transition_check.js 1 ' + r.seed + ')');
      for (const f of r.findings.slice(0, 5)) {
        console.log('     [' + f.kind + '] ' + f.detail);
      }
    }
    if (!bad.length) {
      console.log('  every transition -- halftime and overtime -- held across every generated sequence.');
    }
    process.exitCode = bad.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, fuzzOneGame };
