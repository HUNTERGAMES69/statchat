// The batched fetch must produce IDENTICAL statistics to the per-game loop
// ========================================================================
// The season and player reports used to fetch each game's plays in its own
// query. That was collapsed into one batched query for speed. **A speed
// change that alters a single number makes the whole application
// worthless**, so this does not reason about equivalence -- it runs both
// data paths over the same rows and compares the computed output.
//
//   OLD: for each game -> .eq('game_id', id).order('sequence_number')
//   NEW: .in('game_id', ids).order('sequence_number'), then grouped
//
// The risk is ordering. The old query sorted WITHIN one game. The new one
// sorts across all games at once and relies on the fact that a globally
// ascending list stays ascending within any subset. That is true, but
// "true" is not the same as "tested", and the engine is order-sensitive:
// down-and-distance, drives and possession all depend on play sequence.
//
// Fixtures deliberately include the cases most likely to break it:
//   * interleaved sequence numbers across games
//   * FRACTIONAL sequence numbers (plays.sequence_number is numeric so a
//     missed play can be inserted between two others)
//   * identical sequence numbers in different games
//   * a game with no plays at all
//   * rows arriving from the server in a shuffled order
//
//   node tests/report_fetch_equivalence_check.js

const path = require('path');
const engine = require(path.join(__dirname, '..', 'engine.js'));

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// ---- fixtures ------------------------------------------------------------
// A compact but real play stream: rushes, passes, a score, a turnover.
function playsFor(gameId, startSeq, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const seq = startSeq + i;
    const q = i < n / 4 ? 1 : i < n / 2 ? 2 : i < (3 * n) / 4 ? 3 : 4;
    const isPass = i % 3 === 0;
    rows.push({
      game_id: gameId,
      sequence_number: seq,
      quarter: q,
      team_side: i % 2 === 0 ? 'teamA' : 'teamB',
      text: (isPass ? 'Pass complete for ' : 'Rush for ') + (i % 11) + ' yards',
      effect: { yards: i % 11, gain: i % 11 },
      roles: isPass
        ? { passer: 'Robinson', receiver: 'Brooks' }
        : { rusher: 'Goode' },
      unresolved: false, is_divider: false, is_override: false
    });
  }
  return rows;
}

// ---- the two paths -------------------------------------------------------
// OLD: each game fetched and ordered on its own.
function oldPath(allRows, gameIds) {
  const out = {};
  for (const id of gameIds) {
    out[id] = allRows.filter(r => r.game_id === id)
                     .sort((a, b) => a.sequence_number - b.sequence_number);
  }
  return out;
}

// NEW: one ordered result, grouped by appending in returned order --
// exactly what the pages do.
function newPath(allRows, gameIds) {
  const ordered = [...allRows].sort((a, b) => a.sequence_number - b.sequence_number);
  const by = new Map();
  for (const r of ordered) {
    if (!by.has(r.game_id)) by.set(r.game_id, []);
    by.get(r.game_id).push(r);
  }
  const out = {};
  for (const id of gameIds) out[id] = by.get(id) || [];
  return out;
}

const toEngine = rows => rows.map(p => ({
  text: p.text, effect: p.effect || {}, team: p.team_side, quarter: p.quarter,
  roles: p.roles, unresolved: p.unresolved, isDivider: p.is_divider, isOverride: p.is_override
}));

// ---- the scenarios -------------------------------------------------------
const SCENARIOS = {
  'sequential games': (() => {
    const a = playsFor('g1', 1, 40), b = playsFor('g2', 1, 40), c = playsFor('g3', 1, 40);
    return { rows: [...a, ...b, ...c], ids: ['g1', 'g2', 'g3'] };
  })(),

  'identical sequence numbers across games': (() => {
    // every game starts at 1, so the global sort interleaves them completely
    const a = playsFor('g1', 1, 30), b = playsFor('g2', 1, 30);
    return { rows: [...a, ...b], ids: ['g1', 'g2'] };
  })(),

  'fractional sequence numbers': (() => {
    const a = playsFor('g1', 1, 20);
    // a missed play inserted between 5 and 6, which is what numeric is for
    a.push({ ...a[4], sequence_number: 5.5, text: 'Rush for 3 yards (inserted)' });
    const b = playsFor('g2', 1, 20);
    b.push({ ...b[9], sequence_number: 10.25, text: 'Pass complete for 7 yards (inserted)' });
    return { rows: [...a, ...b], ids: ['g1', 'g2'] };
  })(),

  'rows arrive shuffled': (() => {
    const a = playsFor('g1', 1, 30), b = playsFor('g2', 1, 30);
    const rows = [...a, ...b];
    // deterministic shuffle
    for (let i = rows.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    return { rows, ids: ['g1', 'g2'] };
  })(),

  'a game with no plays': (() => {
    const a = playsFor('g1', 1, 25);
    return { rows: a, ids: ['g1', 'gEmpty'] };
  })(),

  'many games, past the old row cap': (() => {
    const rows = [], ids = [];
    for (let g = 1; g <= 14; g++) { ids.push('g' + g); rows.push(...playsFor('g' + g, 1, 150)); }
    return { rows, ids };
  })(),
};

console.log('=== Batched fetch vs per-game fetch: identical statistics? ===\n');

for (const [name, { rows, ids }] of Object.entries(SCENARIOS)) {
  const oldG = oldPath(rows, ids);
  const newG = newPath(rows, ids);

  // 1. the same plays, in the same order, for every game
  let orderSame = true, countSame = true;
  for (const id of ids) {
    if (oldG[id].length !== newG[id].length) countSame = false;
    const a = oldG[id].map(r => r.sequence_number + '|' + r.text).join('~');
    const b = newG[id].map(r => r.sequence_number + '|' + r.text).join('~');
    if (a !== b) orderSame = false;
  }
  chk(countSame, name + ': every game gets the same NUMBER of plays');
  chk(orderSame, name + ': and in the same ORDER — the engine derives down, ' +
      'distance and drives from sequence, so a reordering changes the stats');

  // 2. the engine produces byte-identical box scores
  let boxSame = true, detail = '';
  for (const id of ids) {
    const A = JSON.stringify(engine.computeBoxScore(toEngine(oldG[id])));
    const B = JSON.stringify(engine.computeBoxScore(toEngine(newG[id])));
    if (A !== B) { boxSame = false; detail = ' (' + id + ')'; break; }
  }
  chk(boxSame, name + ': computeBoxScore returns identical numbers' + detail);
  console.log('');
}

console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
