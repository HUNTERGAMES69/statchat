// Property-based fuzzer
// ---------------------
// Generates thousands of random but LEGAL play sequences and checks that
// certain things are true no matter what happened.
//
// Every other suite -- including the NFL harness -- replays sequences
// someone chose. This one explores the state space nobody enumerated.
// The bugs found on 2026-08-07 and 08-10 were nearly all invariant
// violations: a phase that said halftime with no half divider, possession
// that drifted and stayed drifted, a stale `converts` flag, a rushing
// bucket holding only a fumble. A fuzzer hits that class in seconds
// because it does not need anyone to think of the case first.
//
// WHAT AN INVARIANT IS HERE: something that must hold after EVERY play,
// regardless of what the play was. Not "this sequence produces 14 yards"
// but "individual rushing yards always sum to the team total". Getting
// these right matters more than the number of iterations -- a weak
// invariant passes forever and proves nothing.
//
// MUTATION RESULTS (Aug 10, 2026), so the strength of this is auditable:
//   caught  - fieldPos clamp removed         -> "fieldPos is -4 (after sack)"
//   caught  - completions double-counted     -> "16 completions from 11 attempts"
//   SURVIVED - distance clamp `Math.max(..., 1)` removed. Investigated:
//     this is an EQUIVALENT mutant, not a gap. A gain that meets the
//     distance CONVERTS and takes a different branch, so by the time
//     `distance - statYds` runs the result is provably positive. The
//     clamp is unreachable belt-and-braces.
//
// Note also the first finding this fuzzer ever produced was its own bug:
// it flagged "long 8 exceeds total 6", which is perfectly legal (an
// 8-yard gain plus a 2-yard loss). A false positive is worse than no
// check -- it teaches you to ignore the output. Invariants must be
// things that are ALWAYS true, not usually true.
//
//   node tests/fuzz_check.js           # 60 games
//   node tests/fuzz_check.js 300       # longer soak
//   node tests/fuzz_check.js 60 12345  # reproduce a specific seed

const { bootGamePage, bootPage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

// Deterministic RNG so any failure can be replayed from its seed. A
// fuzzer that cannot reproduce its own findings is close to useless.
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

// Build one random legal play. Weighted roughly like real football so the
// common paths get the most coverage, with the rare ones still appearing.
function randomPlay(rand, state) {
  const r = rand();
  const goalToGo = state.fieldPos !== null && state.fieldPos + state.distance >= 100;
  const maxGain = state.fieldPos !== null ? 100 - state.fieldPos : 40;

  if (r < 0.38) {
    const yds = int(rand, 0, Math.min(maxGain, 25));
    const loss = rand() < 0.12 && yds > 0;
    return { type: 'rush', carrier: pick(rand, OFFENSE), yards: String(yds), loss,
             credit: rand() < 0.5 ? pick(rand, DEFENSE) : undefined,
             td: !loss && !goalToGo && yds >= maxGain && maxGain > 0 };
  }
  if (r < 0.70) {
    if (rand() < 0.3) {
      return { type: 'pass', passer: '7', receiver: pick(rand, ['80', '84']), incomplete: true };
    }
    const yds = int(rand, 0, Math.min(maxGain, 40));
    return { type: 'pass', passer: '7', receiver: pick(rand, ['80', '84']),
             yards: String(yds), credit: rand() < 0.4 ? pick(rand, DEFENSE) : undefined,
             td: yds >= maxGain && maxGain > 0 };
  }
  if (r < 0.78) return { type: 'sack', passer: '7', yards: String(int(rand, 1, 12)) };
  if (r < 0.84 && state.down === 4) {
    return { type: 'punt', punter: '15', yards: String(int(rand, 25, 50)),
             spot: { side: 'own', yardline: String(int(rand, 5, 45)) }, clock: '9:00' };
  }
  if (r < 0.88) {
    return { type: 'int', passer: '7', credit: pick(rand, DEFENSE),
             spot: { side: 'own', yardline: String(int(rand, 5, 45)) }, clock: '8:00' };
  }
  if (r < 0.92 && state.fieldPos !== null && state.fieldPos > 55) {
    return { type: 'fg', kicker: '3', yards: String(100 - state.fieldPos + 17),
             result: rand() < 0.6 ? 'g' : 'x' };
  }
  if (r < 0.96) {
    return { type: 'penalty', on: rand() < 0.5 ? 'defense' : 'offense',
             yards: String(pick(rand, ['5', '10', '15'])),
             firstDown: rand() < 0.3 };
  }
  return { type: 'rush', carrier: pick(rand, OFFENSE), yards: String(int(rand, 0, 6)) };
}

// The invariants. Each returns a string when violated, null when fine.
const INVARIANTS = [
  ['fieldPos in range', st =>
    (st.fieldPos !== null && (st.fieldPos < 0 || st.fieldPos > 100))
      ? 'fieldPos is ' + st.fieldPos : null],

  ['down in range', st =>
    (st.down !== null && (st.down < 1 || st.down > 4))
      ? 'down is ' + st.down : null],

  ['distance positive', st =>
    (st.distance !== null && st.distance < 1)
      ? 'distance is ' + st.distance : null],

  ['scores non-negative', st =>
    (st.scores.teamA < 0 || st.scores.teamB < 0)
      ? JSON.stringify(st.scores) : null],

  // A football score cannot be 1, and cannot come from nowhere. This
  // catches a scoring path that awards the wrong value.
  ['scores are reachable', st => {
    for (const t of ['teamA', 'teamB']) {
      if (st.scores[t] === 1) return t + ' has 1 point, which is impossible';
    }
    return null;
  }],

  ['timeouts in range', st => {
    for (const t of ['teamA', 'teamB']) {
      if (st.timeouts[t] < 0 || st.timeouts[t] > 3) {
        return t + ' has ' + st.timeouts[t] + ' timeouts';
      }
    }
    return null;
  }],

  ['possession is a real team', st =>
    (st.possession !== 'teamA' && st.possession !== 'teamB')
      ? String(st.possession) : null],

  ['quarter in range', st =>
    (st.quarter < 1 || st.quarter > 10) ? 'quarter is ' + st.quarter : null],

  ['time of possession non-negative', st => {
    for (const t of ['teamA', 'teamB']) {
      if (st.possessionTime[t] < 0) return t + ' TOP is ' + st.possessionTime[t];
    }
    return null;
  }]
];

// Invariants that need the box score as well as the state.
function boxInvariants(box) {
  const problems = [];
  for (const team of ['teamA', 'teamB']) {
    const b = box[team];
    if (!b) continue;

    for (const [cat, key] of [['rushing', 'att'], ['passing', 'att'], ['receiving', 'rec']]) {
      for (const who of Object.keys(b[cat] || {})) {
        const line = b[cat][who];
        if ((line[key] || 0) < 0) {
          problems.push(team + '.' + cat + '.' + who + ' has ' + key + ' = ' + line[key]);
        }
        // "long exceeds total" is NOT a violation in general: an 8-yard
        // gain plus a 2-yard loss is a long of 8 and a total of 6. That
        // was this fuzzer's first finding and it was wrong -- a false
        // positive is worse than no check, because it trains you to
        // ignore the output.
        //
        // The version that IS always true: with exactly one attempt, the
        // long must equal the yardage.
        if ((line[key] || 0) === 1 && (line.long || 0) !== Math.max(0, line.yds || 0)) {
          problems.push(team + '.' + cat + '.' + who + ' has one ' + key +
                        ' for ' + line.yds + ' but a long of ' + line.long);
        }
      }
    }
    // Completions can never exceed attempts.
    for (const who of Object.keys(b.passing || {})) {
      const p = b.passing[who];
      if ((p.comp || 0) > (p.att || 0)) {
        problems.push(team + '.passing.' + who + ' has ' + p.comp +
                      ' completions from ' + p.att + ' attempts');
      }
    }
    // Catches can never exceed targets.
    for (const who of Object.keys(b.receiving || {})) {
      const r = b.receiving[who];
      if ((r.rec || 0) > (r.tgt || 0)) {
        problems.push(team + '.receiving.' + who + ' has ' + r.rec +
                      ' catches from ' + r.tgt + ' targets');
      }
    }
  }
  return problems;
}

async function fuzzOneGame(seed, playsPerGame) {
  const rand = rng(seed);
  const findings = [];
  const h = await bootGamePage();

  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });

  let lastScoreA = 0, lastScoreB = 0;
  const history = [];

  for (let i = 0; i < playsPerGame; i++) {
    const before = JSON.parse(h.evalIn('JSON.stringify(computeState())'));

    // The app refuses scrimmage plays with no spot, which is correct --
    // give it one rather than counting the refusal as a finding.
    if (before.fieldPos === null || before.down === null) {
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: int(rand, 20, 40) });
      continue;
    }

    const spec = randomPlay(rand, before);
    history.push(spec.type);
    try {
      enterPlay(h, spec);
    } catch (e) {
      // A refusal is legitimate -- not every random play is enterable in
      // every situation. A THROW from inside the app is not.
      if (!/UnreachableByUI|no .* button|missing element/i.test(e.message)) {
        findings.push({ kind: 'threw', detail: spec.type + ': ' + e.message.split('\n')[0].slice(0, 90) });
      }
      continue;
    }

    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));

    for (const [name, check] of INVARIANTS) {
      const bad = check(st);
      if (bad) findings.push({ kind: name, detail: bad + '  (after ' + spec.type + ')' });
    }
    // Score may rise but never fall.
    if (st.scores.teamA < lastScoreA || st.scores.teamB < lastScoreB) {
      findings.push({ kind: 'score decreased',
        detail: JSON.stringify({ was: [lastScoreA, lastScoreB], now: st.scores }) +
                ' after ' + spec.type });
    }
    lastScoreA = st.scores.teamA; lastScoreB = st.scores.teamB;

    if (findings.length > 6) break;
  }

  // Box-score invariants once, at the end, plus the reload round trip:
  // state rebuilt from the SAVED rows must match the live page. Anything
  // that differs lives only in memory and would be lost on refresh.
  const liveState = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
  const rows = h.db.plays.map((r, i) =>
    Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();

  const v = await bootPage('view.html', { existingPlays: rows });
  const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
  const reloaded = JSON.parse(v.evalIn('JSON.stringify(computeState(plays))'));
  v.close();

  boxInvariants(box).forEach(d => findings.push({ kind: 'box score', detail: d }));

  for (const k of ['possession', 'down', 'distance', 'fieldPos']) {
    if (JSON.stringify(liveState[k]) !== JSON.stringify(reloaded[k])) {
      findings.push({ kind: 'reload mismatch',
        detail: k + ': live ' + JSON.stringify(liveState[k]) +
                ', rebuilt from the database ' + JSON.stringify(reloaded[k]) });
    }
  }
  if (JSON.stringify(liveState.scores) !== JSON.stringify(reloaded.scores)) {
    findings.push({ kind: 'reload mismatch',
      detail: 'scores: live ' + JSON.stringify(liveState.scores) +
              ', rebuilt ' + JSON.stringify(reloaded.scores) });
  }

  return { seed, findings, playTypes: history.length };
}

async function run(games, baseSeed, playsPerGame) {
  const results = [];
  for (let g = 0; g < games; g++) {
    results.push(await fuzzOneGame((baseSeed || 1) + g * 7919, playsPerGame || 40));
  }
  return results;
}

if (require.main === module) {
  const games = parseInt(process.argv[2], 10) || 60;
  const baseSeed = parseInt(process.argv[3], 10) || 1;
  run(games, baseSeed).then(results => {
    console.log('=== Property-based fuzzer ===\n');
    const bad = results.filter(r => r.findings.length);
    const plays = results.reduce((t, r) => t + r.playTypes, 0);
    console.log('Games: ' + results.length + '   plays generated: ' + plays);
    console.log('Games with findings: ' + bad.length + '\n');
    for (const r of bad.slice(0, 8)) {
      console.log('  seed ' + r.seed + '  (reproduce: node tests/fuzz_check.js 1 ' + r.seed + ')');
      for (const f of r.findings.slice(0, 4)) {
        console.log('     [' + f.kind + '] ' + f.detail);
      }
    }
    if (!bad.length) {
      console.log('  every invariant held across every generated sequence.');
    }
    process.exitCode = bad.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, fuzzOneGame };
