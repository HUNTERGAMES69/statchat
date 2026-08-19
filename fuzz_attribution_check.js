// Attribution fuzzer -- special teams and turnover returns
// ---------------------------------------------------------
// Built 19 Aug 2026, the same night a real game exposed a systemic bug:
// a blocked field goal returned for a touchdown by the defense scored
// the right team but filed the PLAY ITSELF under the kicking team's own
// attribution, because fourteen separate branches in parseInput
// hardcoded `team: off` regardless of who actually returned the score.
//
// The existing fuzzer (fuzz_check.js) generates thousands of plays but
// never a kickoff, a blocked kick, a muffed catch, a PAT, a 2-point try,
// or a safety -- so it could not have found this even given a hundred
// times as many games. This fuzzer exists specifically to hammer the
// area the other one does not reach: every play type where a team OTHER
// than the one who had the ball can end up scoring.
//
// THE CENTRAL INVARIANT, the one this file exists to check: for any
// saved play with effect.score, if that play is not an ordinary
// rush/pass/sack (which can end in a safety charged to the defense
// while the play still correctly belongs to the offense -- their own
// player was tackled, nobody returned anything), then the play's own
// `team` must equal effect.score.team. That is the exact fact that was
// false for a live game and true for zero of the 50 fixed scenarios in
// accuracy_check.js, because none of them ever generate the situation.
//
// SCOPE, and why it stops where it does: PAT and 2-point tries have NO
// return control in the UI at all -- confirmed by reading game.html
// directly before writing this -- because NFHS ends a try the instant
// the defense gains possession, with no return and no defensive score.
// Fixing that dead code earlier tonight was harmless but pointless;
// fuzzing it would be pointless in the same way, since ui_driver.js
// cannot reach a code path no coach can reach. This fuzzer only builds
// scenarios a real coach can actually enter.
//
//   node tests/fuzz_attribution_check.js           # 200 games
//   node tests/fuzz_attribution_check.js 1000      # longer soak
//   node tests/fuzz_attribution_check.js 200 12345 # reproduce a seed

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive, click } = require('./ui_driver');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const OFFENSE = ['22', '28', '7', '80', '84'];
const DEFENSE = ['55', '21', '99'];
function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
function int(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function bool(rand, p) { return rand() < p; }

// A random ordinary drive play. Deliberately simpler than fuzz_check.js's
// version -- this fuzzer's whole point is the special-teams side, not
// re-covering ordinary scrimmage variety fuzz_check.js already owns.
// Biased AWAY from scoring on its own (rare gains, no auto-TD) so that
// almost every score in THIS fuzzer comes from the special-teams and
// turnover paths it exists to exercise.
function randomDrivePlay(rand, state) {
  const r = rand();
  const maxGain = state.fieldPos !== null ? Math.max(1, 100 - state.fieldPos - 1) : 20;
  if (r < 0.35) {
    return { type: 'rush', carrier: pick(rand, OFFENSE), yards: String(int(rand, 0, Math.min(maxGain, 8))) };
  }
  if (r < 0.55) {
    return { type: 'pass', passer: '7', receiver: pick(rand, ['80', '84']), incomplete: true };
  }
  if (r < 0.75) {
    return { type: 'pass', passer: '7', receiver: pick(rand, ['80', '84']), yards: String(int(rand, 0, Math.min(maxGain, 12))) };
  }
  // Fumble on the play, recovered by the defense, sometimes returned for
  // a score -- one of the reachable attribution-bug branches.
  if (r < 0.85) {
    const td = bool(rand, 0.35);
    return { type: 'rush', carrier: pick(rand, OFFENSE), yards: String(int(rand, 0, 4)),
      fumbled: true, fumrec: 'opp', credit: pick(rand, DEFENSE),
      retyds: td ? undefined : String(int(rand, 0, 20)), fumTd: td, clock: td ? '9:00' : undefined,
      // fumSpot, not spot -- the rush-fumble panel's takeover-spot field
      // is pp_rushfum_spot, wired to spec.fumSpot specifically; spec.spot
      // is a different, unrelated field enterPlay never reads for this
      // play type. Confirmed by checking computeState() directly after
      // the play, not assumed from the field's plausible-looking name.
      fumSpot: td ? undefined : { side: 'opp', yardline: String(int(rand, 5, 45)) } };
  }
  // Interception, sometimes returned for a score -- another reachable
  // branch.
  if (r < 0.95) {
    const td = bool(rand, 0.4);
    return { type: 'int', passer: '7', credit: pick(rand, DEFENSE),
      yards: td ? undefined : String(int(rand, 0, 30)), td,
      spot: td ? undefined : { side: 'own', yardline: String(int(rand, 5, 45)) },
      clock: td ? '9:00' : '8:30' };
  }
  return { type: 'rush', carrier: pick(rand, OFFENSE), yards: String(int(rand, 0, 3)) };
}

// A 4th-down decision: punt, field goal, or (rarely) go for it. The punt
// and field goal paths are where most of the reachable attribution
// branches this fuzzer targets actually live.
function randomFourthDown(rand, state) {
  const closeEnoughForFg = state.fieldPos !== null && state.fieldPos > 55;
  const r = rand();
  if (closeEnoughForFg && r < 0.35) {
    if (bool(rand, 0.25)) {
      // Blocked field goal -- the exact play type that was reported.
      const td = bool(rand, 0.4);
      return { type: 'fg', kicker: '3', yards: String(35), blocked: true,
        credit: pick(rand, DEFENSE), retyds: td ? undefined : String(int(rand, 0, 40)),
        td, clock: td ? '7:00' : undefined };
    }
    return { type: 'fg', kicker: '3', yards: String(100 - state.fieldPos + 17), result: bool(rand, 0.6) ? 'g' : 'x' };
  }
  return randomPunt(rand, state);
}

function randomPunt(rand, state) {
  const r = rand();
  if (r < 0.15) {
    // Blocked punt: recovered by either team, sometimes a safety,
    // sometimes returned for a score.
    const kickingRecovers = bool(rand, 0.4);
    if (kickingRecovers) {
      const safety = state.fieldPos !== null && state.fieldPos < 8 && bool(rand, 0.5);
      return { type: 'punt', punter: '15', blocked: true, blockrec: 'own', safety };
    }
    const td = bool(rand, 0.4);
    return { type: 'punt', punter: '15', blocked: true, blockrec: 'opp',
      credit: pick(rand, DEFENSE), retyds: td ? undefined : String(int(rand, 0, 30)),
      td, clock: td ? '6:30' : undefined };
  }
  if (r < 0.30) {
    // Muffed catch: either team can recover. A kicking-team recovery
    // deep in their own territory can be a safety; either recovery can
    // be returned for a score.
    const kickingRecovers = bool(rand, 0.5);
    const yds = int(rand, 25, 45);
    if (kickingRecovers && state.fieldPos !== null) {
      const receivingGoalDistance = 100 - state.fieldPos - yds;
      const safety = receivingGoalDistance < 8 && bool(rand, 0.4);
      if (safety) {
        return { type: 'punt', punter: '15', yards: String(yds), muffed: true,
          muffrec: 'k', safety: true };
      }
    }
    const td = bool(rand, 0.35);
    return { type: 'punt', punter: '15', yards: String(yds), muffed: true,
      muffrec: kickingRecovers ? 'k' : 'r',
      muffrecoverer: pick(rand, kickingRecovers ? ['15', '3'] : DEFENSE),
      muffretyds: td ? undefined : String(int(rand, 0, 15)),
      td, clock: td ? '6:00' : undefined,
      spot: (kickingRecovers && !td) ? { side: 'own', yardline: String(int(rand, 15, 40)) } : undefined };
  }
  // Ordinary punt, occasionally returned for a touchdown.
  const td = bool(rand, 0.15);
  return { type: 'punt', punter: '15', yards: String(int(rand, 25, 48)),
    credit: td ? undefined : pick(rand, DEFENSE),
    retyds: td ? undefined : String(int(rand, 0, 20)),
    td, clock: td ? '5:30' : undefined,
    spot: td ? undefined : { side: 'own', yardline: String(int(rand, 10, 40)) } };
}

// A kickoff, following any score. Weighted toward the outcomes this
// fuzzer exists to exercise -- muffed and onside are OVER-represented
// relative to a real game on purpose.
function randomKickoff(rand) {
  const r = rand();
  if (r < 0.25) {
    return { type: 'kickoff', kicker: '3', touchback: true };
  }
  if (r < 0.55) {
    const kickingRecovers = bool(rand, 0.35);
    const td = bool(rand, 0.3);
    if (kickingRecovers) {
      return { type: 'kickoff', kicker: '3', muffed: true, muffrec: 'k',
        muffrecoverer: pick(rand, ['3', '15']),
        muffretyds: td ? undefined : String(int(rand, 0, 15)), td,
        clock: td ? '11:30' : undefined,
        muffSpot: td ? undefined : { side: 'own', yardline: String(int(rand, 20, 45)) } };
    }
    return { type: 'kickoff', kicker: '3', muffed: true, muffrec: 'r',
      muffrecoverer: pick(rand, DEFENSE),
      muffretyds: td ? undefined : String(int(rand, 0, 20)), td,
      clock: td ? '11:30' : undefined };
  }
  if (r < 0.70) {
    const kickingRecovers = bool(rand, 0.3);
    const td = bool(rand, 0.35);
    return { type: 'kickoff', kicker: '3', onside: true,
      onsiderec: kickingRecovers ? 'k' : 'r',
      onsiderecoverer: pick(rand, kickingRecovers ? ['3', '15'] : DEFENSE),
      td, clock: td ? '11:00' : undefined,
      onsideSpot: (kickingRecovers && !td) ? { side: 'own', yardline: String(int(rand, 35, 45)) } : undefined };
  }
  if (r < 0.80) {
    // Ordinary return with a fumble during the return.
    const kickingRecovers = bool(rand, 0.3);
    const td = bool(rand, 0.3);
    return { type: 'kickoff', kicker: '3', retFumbled: true,
      retFumrec: kickingRecovers ? 'k' : 'r',
      retFumrecoverer: pick(rand, kickingRecovers ? ['3', '15'] : DEFENSE),
      td, clock: td ? '10:30' : undefined,
      retFumSpot: (kickingRecovers && !td) ? { side: 'own', yardline: String(int(rand, 20, 45)) } : undefined };
  }
  // Ordinary return, occasionally to the house.
  const td = bool(rand, 0.2);
  return { type: 'kickoff', kicker: '3', credit: td ? undefined : pick(rand, DEFENSE),
    retyds: td ? undefined : String(int(rand, 5, 30)), td, clock: td ? '10:00' : undefined,
    spot: td ? undefined : { side: 'own', yardline: String(int(rand, 20, 40)) } };
}

function randomTry(rand) {
  if (bool(rand, 0.15)) {
    // Blocked -- no return control exists in the UI for either PAT or
    // 2PT (NFHS: the try ends the instant the defense has it), so this
    // only ever exercises the "blocked, no score" path, on purpose.
    return bool(rand, 0.5)
      ? { type: 'pat', kicker: '3', blocked: true, credit: pick(rand, DEFENSE) }
      : { type: 'twopt', sub: bool(rand, 0.5) ? 'rush' : 'pass',
          carrier: OFFENSE[0], passer: '7', receiver: '80', result: 'b',
          credit: pick(rand, DEFENSE) };
  }
  if (bool(rand, 0.5)) {
    return { type: 'pat', kicker: '3', result: bool(rand, 0.9) ? 'g' : 'x' };
  }
  return bool(rand, 0.5)
    ? { type: 'twopt', sub: 'rush', carrier: OFFENSE[0], result: bool(rand, 0.5) ? 'g' : 'x' }
    : { type: 'twopt', sub: 'pass', passer: '7', receiver: '80', result: bool(rand, 0.5) ? 'g' : 'x' };
}

// THE CENTRAL CHECK. Kept separate from the generic invariants below so
// it reads as what it is: the one property this whole file exists to
// verify, checked against every play saved so far, every iteration.
const NON_RETURN_TYPES = new Set(['rush', 'pass', 'sack']);
function attributionFindings(rows) {
  const findings = [];
  rows.forEach((p, i) => {
    if (!p.effect || !p.effect.score) return;
    const playType = p.roles && p.roles.playType;
    const team = p.team !== undefined ? p.team : p.team_side;
    // A rush/pass/sack safety is the offense's OWN player tackled behind
    // his own line -- no block, no return, nobody else's play. team:
    // off is correct there and must NOT be flagged.
    if (NON_RETURN_TYPES.has(playType)) return;
    if (team !== p.effect.score.team) {
      findings.push('play[' + i + '] "' + p.text + '" scores for ' +
        p.effect.score.team + ' but is filed under team=' + team);
    }
  });
  return findings;
}

const GENERAL_INVARIANTS = [
  ['fieldPos in range', st => (st.fieldPos !== null && (st.fieldPos < 0 || st.fieldPos > 100)) ? 'fieldPos is ' + st.fieldPos : null],
  ['down in range', st => (st.down !== null && (st.down < 1 || st.down > 4)) ? 'down is ' + st.down : null],
  ['distance positive', st => (st.distance !== null && st.distance < 1) ? 'distance is ' + st.distance : null],
  ['scores non-negative', st => (st.scores.teamA < 0 || st.scores.teamB < 0) ? JSON.stringify(st.scores) : null],
  ['possession is a real team', st => (st.possession !== 'teamA' && st.possession !== 'teamB') ? String(st.possession) : null]
];

async function fuzzOneGame(seed, playsPerGame) {
  const rand = rng(seed);
  const findings = [];
  const h = await bootGamePage();
  const uncaughtErrors = [];
  h.window.addEventListener('error', (e) => {
    uncaughtErrors.push({ playIndex: plays, msg: (e.error && e.error.message) || e.message });
  });
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });

  let plays = 0;
  while (plays < playsPerGame && findings.length <= 6) {
    const before = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (before.fieldPos === null || before.down === null) {
      // A score (or a kickoff that hasn't resolved a spot yet) leaves
      // no live down -- push the sequence forward with a kickoff rather
      // than resetting, so the special-teams path actually gets tested
      // rather than skipped.
      let spec;
      try { spec = randomKickoff(rand); enterPlay(h, spec); }
      catch (e) {
        if (!/UnreachableByUI|no .* button|missing element/i.test(e.message)) {
          findings.push({ kind: 'threw', detail: 'kickoff: ' + e.message.split('\n')[0].slice(0, 100) });
        }
        setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });
      }
      plays++;
      continue;
    }

    let spec;
    if (before.down === 4) spec = randomFourthDown(rand, before);
    else spec = randomDrivePlay(rand, before);

    try {
      enterPlay(h, spec);
    } catch (e) {
      if (!/UnreachableByUI|no .* button|missing element/i.test(e.message)) {
        findings.push({ kind: 'threw', detail: spec.type + ': ' + e.message.split('\n')[0].slice(0, 100) });
      }
      plays++;
      continue;
    }

    // A touchdown needs a try before the next kickoff -- drive it
    // immediately, in sequence, the way a real game actually proceeds.
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    const lastReal = JSON.parse(h.evalIn(
      'JSON.stringify((function(){ for (let i = plays.length - 1; i >= 0; i--){ if (!isAdminMarker(plays[i])) return plays[i]; } return null; })())'
    ));
    if (lastReal && lastReal.effect && lastReal.effect.score && lastReal.effect.score.points === 6) {
      try { enterPlay(h, randomTry(rand)); } catch (e) { /* a refusal here is not itself a finding */ }
    }

    for (const [name, check] of GENERAL_INVARIANTS) {
      const bad = check(st);
      if (bad) findings.push({ kind: name, detail: bad + ' (after ' + spec.type + ')' });
    }
    plays++;
  }

  const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();

  attributionFindings(rows).forEach(d => findings.push({ kind: 'ATTRIBUTION', detail: d }));

  uncaughtErrors.forEach(e => findings.push({ kind: 'UNCAUGHT', detail: 'play index ' + e.playIndex + ': ' + e.msg }));
  return { seed, findings, playsGenerated: plays };
}

async function run(games, baseSeed, playsPerGame) {
  const results = [];
  for (let g = 0; g < games; g++) {
    results.push(await fuzzOneGame((baseSeed || 1) + g * 7919, playsPerGame || 30));
  }
  return results;
}

if (require.main === module) {
  const games = parseInt(process.argv[2], 10) || 200;
  const baseSeed = parseInt(process.argv[3], 10) || 1;
  run(games, baseSeed).then(results => {
    console.log('=== Attribution fuzzer (special teams / turnover returns) ===\n');
    const bad = results.filter(r => r.findings.length);
    const plays = results.reduce((t, r) => t + r.playsGenerated, 0);
    console.log('Games: ' + results.length + '   plays generated: ' + plays);
    console.log('Games with findings: ' + bad.length + '\n');
    for (const r of bad.slice(0, 10)) {
      console.log('  seed ' + r.seed + '  (reproduce: node tests/fuzz_attribution_check.js 1 ' + r.seed + ')');
      for (const f of r.findings.slice(0, 5)) {
        console.log('     [' + f.kind + '] ' + f.detail);
      }
    }
    if (!bad.length) {
      console.log('  every attribution and general invariant held across every generated sequence.');
    }
    process.exitCode = bad.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, fuzzOneGame };
