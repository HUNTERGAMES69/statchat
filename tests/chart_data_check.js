// Season report chart DATA
// ------------------------
// Fifteen charts, and until 12 August 2026 none of them was checked at
// all: Chart.js is stubbed in the harness, and the old stub discarded
// the config entirely.
//
// WHAT THIS DOES AND DOES NOT COVER. Andy confirmed by eye that all
// fifteen draw and have data. That rules out the crude failures — a
// blank canvas, a thrown error. It cannot rule out a chart drawing the
// WRONG numbers, because a wrong chart looks completely convincing.
//
// This test covers the half eyes are worst at: NaN and undefined in the
// series, labels that say "undefined", series lengths that disagree with
// the number of games, and a chart quietly plotting nothing. A human is
// better at "that bar looks too tall"; a test is better at "dataset 2
// has four points and dataset 1 has three".
//
// Neither replaces the other, which is why both exist.

const { bootPage } = require('./harness');

// Every canvas on the page. If a chart is added and never registered
// here the count check below fails, which is the intent — a new chart
// should not slip in untested.
const EXPECTED = [
  'chartPointsByQuarter', 'chartHalfYards', 'chartRunPassAtt',
  'chartRunPassYds', 'chartYardsByGame', 'chartPassRushByGame',
  'chartPassByHalf', 'chartRushByHalf', 'chartTurnoversByGame',
  'chartSacksByGame', 'chartPenaltiesByGame', 'chart3rdDownByGame',
  'chart4thDownByGame', 'chartExplosiveByGame', 'chartPossPlaysByGame'
];

// NaN and undefined are never intentional. NULL IS: in a Chart.js line
// chart it means "no data point here" and leaves a deliberate gap.
//
// That distinction was this test's first finding, and the test was
// wrong. `chart3rdDownByGame` passes null for a game with ZERO third-down
// attempts, because 0/0 is not 0% — plotting a zero would state
// something false. The code even has a formatter that renders null as an
// empty string. Flagging it would have pushed a correct chart towards
// being wrong.
function looksBad(v, chartType) {
  if (v === undefined) return true;
  if (typeof v === 'number' && !isFinite(v)) return true;   // NaN, Infinity
  // null is a legitimate gap in a line chart, and nowhere else.
  if (v === null && chartType !== 'line') return true;
  return false;
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const p = await bootPage('season_report.html', {
    query: '?season=2026',
    game: { status: 'final', season_year: 2026, game_date: '2026-08-24' },
    readyWhen: w => w.document.querySelectorAll('canvas').length
  });
  await new Promise(r => setTimeout(r, 600));

  const charts = p.db.charts || [];

  // --- every chart was actually constructed ---------------------------
  if (charts.length !== EXPECTED.length) {
    fail('coverage', 'expected ' + EXPECTED.length + ' charts, ' +
         charts.length + ' were built. Either one failed to construct, or ' +
         'a new chart was added without being listed here');
  }
  for (const id of EXPECTED) {
    if (!charts.some(c => c.id === id)) {
      fail('coverage', id + ' was never built');
    }
  }

  for (const c of charts) {
    const where = c.id;

    // --- it points at a real canvas -----------------------------------
    if (c.id === '(no canvas)') {
      fail('canvas', 'a chart was built with no canvas element — ' +
           'getElementById returned null, so it draws nowhere');
      continue;
    }

    // --- labels --------------------------------------------------------
    const labels = c.data.labels || [];
    if (!labels.length) {
      fail('labels', where + ' has no labels — the axis would be blank');
    }
    labels.forEach((l, i) => {
      if (looksBad(l, c.type) || String(l) === 'undefined' || String(l) === 'NaN') {
        fail('labels', where + ' label ' + i + ' is "' + l + '"');
      }
    });

    // --- datasets ------------------------------------------------------
    const sets = c.data.datasets || [];
    if (!sets.length) {
      fail('data', where + ' has no datasets at all — it would draw an ' +
           'empty frame, which reads as "no data" rather than as a fault');
      continue;
    }

    sets.forEach((ds, di) => {
      const arr = ds.data || [];
      if (!arr.length) {
        fail('data', where + ' dataset ' + di + ' (' + (ds.label || 'unlabelled') +
             ') is empty');
      }
      arr.forEach((v, i) => {
        if (looksBad(v, c.type)) {
          fail('data', where + ' dataset ' + di + ' point ' + i + ' is ' +
               String(v) + ' on a ' + c.type + ' chart. Chart.js silently ' +
               'skips these, so the bar is simply absent and the chart ' +
               'still looks fine' +
               (v === null ? '. On a line chart null is a legitimate gap; ' +
                'here it is not' : ''));
        }
      });

      // --- a series must match its labels ------------------------------
      // The classic aggregation bug: one series built from a list of
      // games and another from a list that dropped one. The chart draws,
      // and the last bar is silently attributed to the wrong game.
      if (arr.length && labels.length && arr.length !== labels.length &&
          c.type !== 'doughnut' && c.type !== 'pie') {
        fail('alignment', where + ' dataset ' + di + ' has ' + arr.length +
             ' points but there are ' + labels.length + ' labels. The chart ' +
             'still draws — and attributes values to the wrong column');
      }
    });

    // --- multi-series charts must agree with each other ---------------
    if (sets.length > 1) {
      const lengths = [...new Set(sets.map(d => (d.data || []).length))];
      if (lengths.length > 1) {
        fail('alignment', where + ' has series of differing lengths (' +
             lengths.join(' vs ') + '). Scored and Allowed, or Rush and ' +
             'Pass, must line up or the comparison is meaningless');
      }
    }
  }

  // --- the per-game charts must have one point per game ---------------
  // Distinct from the label check: this catches a season aggregation that
  // silently drops a game.
  {
    const gameCount = Number(p.evalIn(
      'typeof seasonGames !== "undefined" ? seasonGames.length : -1'));
    if (gameCount > 0) {
      for (const c of charts.filter(x => /ByGame$/.test(x.id))) {
        const n = ((c.data.datasets || [])[0] || {}).data;
        if (Array.isArray(n) && n.length !== gameCount) {
          fail('per-game', c.id + ' plots ' + n.length + ' points for ' +
               gameCount + ' games — a game has been dropped or duplicated ' +
               'in the aggregation');
        }
      }
    }
  }

  p.close();
  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Season report chart data ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  15 charts, every series finite, labelled and aligned.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
