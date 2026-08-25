// Season-wide fetches must not stop at the first 1000 rows
// ========================================================
// A real regression, shipped and reported: collapsing the per-game
// fetch loop into one `.in('game_id', ids)` query made the reports fast
// and SILENTLY TRUNCATED THEM.
//
// PostgREST caps a response at 1000 rows by default and says nothing when
// it does -- no error, no flag, just a short array. One game is ~150
// plays so the old per-game queries never came close; a 10-game season is
// ~1500 rows. And because the query is ordered by sequence_number
// ASCENDING, the rows dropped are the HIGHEST: the end of every game.
// Q3, Q4 and the second half disappeared from the charts, and any player
// who only appeared late disappeared with them.
//
// The lesson is narrow and worth keeping: **a query that was safe per-item
// is not automatically safe when batched.** The row cap is a property of
// the response, not of the filter.
//
// This drives the real helper against a fake client that enforces the cap,
// because reading the code is what let it through the first time.
//
//   node tests/report_paging_check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

// A client that behaves like PostgREST: never returns more than `cap` rows.
function fakeClient(rowsByTable, cap) {
  return {
    from(table) {
      const q = {
        _rows: rowsByTable[table] || [], _from: 0, _to: cap - 1,
        select() { return q; },
        in(col, ids) { q._rows = q._rows.filter(r => ids.includes(r[col])); return q; },
        order(col) { q._rows = [...q._rows].sort((a, b) => a[col] - b[col]); return q; },
        range(f, t) { q._from = f; q._to = t; return q; },
        then(res) {
          const span = Math.min(q._to - q._from + 1, cap);
          res({ data: q._rows.slice(q._from, q._from + span), error: null });
        }
      };
      return q;
    }
  };
}

for (const file of ['season_report.html', 'player_report.html', 'view.html']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');

  chk(/async function fetchAllByGame/.test(src),
      file + ': has a paging fetch rather than a single capped query');
  // The helper itself contains a .in() -- that is the paged one and is
  // correct. What must not exist is a .in() OUTSIDE it, awaited directly,
  // because that is the shape that silently stops at 1000 rows.
  const outside = src.replace(/async function fetchAllByGame[\s\S]*?\n  \}/, '');
  chk(!/\.select\('\*'\)\.in\('game_id'/.test(outside),
      file + ': no unpaged .in() fetch outside the helper — that is the shape that truncated');

  // lift the real helper and run it
  const m = /async function fetchAllByGame\(client, table, ids, orderCol\)\{[\s\S]*?\n  \}/.exec(src);
  if (!m) { chk(false, file + ': could not extract the helper to test it'); continue; }
  const fn = new Function('return (' + m[0].replace('async function fetchAllByGame',
                          'async function fetchAllByGame') + ')')();

  // 14 games x 150 plays = 2100 rows, well past the cap
  const plays = [];
  const ids = [];
  for (let g = 1; g <= 14; g++) {
    ids.push('g' + g);
    for (let s = 1; s <= 150; s++) plays.push({ game_id: 'g' + g, sequence_number: s });
  }

  (async () => {
    const got = await fn(fakeClient({ plays }, 1000), 'plays', ids, 'sequence_number');
    chk(got.length === 2100,
        file + ': fetches all 2100 rows across 14 games, not the first 1000 (got ' +
        got.length + ')');

    // and every game keeps its full run of plays
    const per = {};
    got.forEach(r => { per[r.game_id] = (per[r.game_id] || 0) + 1; });
    const short = Object.entries(per).filter(([, n]) => n !== 150);
    chk(short.length === 0,
        file + ': every game keeps all 150 of its plays — a truncated fetch loses the ' +
        'END of each game, which is why Q3 and Q4 went missing' +
        (short.length ? ' (short: ' + short.map(([g, n]) => g + '=' + n).join(', ') + ')' : ''));

    // the small case must still work in one page
    const small = await fn(fakeClient({ plays: plays.slice(0, 300) }, 1000), 'plays', ids, 'sequence_number');
    chk(small.length === 300, file + ': a two-game season still returns exactly its rows');
  })();
}

process.on('exit', () => {
  console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
  process.exitCode = fails ? 1 : 0;
});
