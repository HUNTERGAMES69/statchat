// Game backup export
// ------------------
// A "Download backup" item on each dashboard row writes the whole game to
// a JSON file: the game row, its rosters, and every play exactly as
// stored.
//
// WHY IT EXISTS: the rollback tag protects the CODE. Nothing protected
// the DATA. Plays live only in Supabase, and a code rollback does not
// restore them — so if something went wrong mid-season the one
// irreplaceable thing had no copy at all. This is the cheapest possible
// insurance against that.
//
// ADMIN AND SCORERS ONLY. Andy's rule, 12 Aug: a `view` account views.
// Exporting is technically a read, but a backup is the entire game in
// one file, and "view" should not mean "can walk off with everything".
// Scorers keep it because they are the ones at the stadium when
// something looks wrong and the admin is unreachable.
//
// The test captures the Blob instead of letting the browser download it,
// then parses it back and checks the contents. Asserting the button
// exists would prove nothing about whether the file is any good.

const { bootPage } = require('./harness');
const { click } = require('./ui_driver');

// home_team_name / away_team_name — there is NO `opponent` column. The
// first version of this fixture invented one, so the filename assertion
// below passed against a field the real database does not have, and the
// live app was quietly naming every backup "statchat-game-<date>.json".
// A fixture that is kinder than reality tests nothing.
const GAME = { id: 'g1', home_team_name: 'Neville', away_team_name: 'Ruston',
               status: 'final', game_date: '2026-08-24', season_year: 2026 };

const PLAYS = [
  { id: 1, game_id: 'g1', sequence_number: 1, text: 'rush for 6',
    team_side: 'teamA', quarter: 1, effect: { isStat: true, statYds: 6 },
    roles: { carrier: { team: 'teamA', num: '22', yards: 6 }, playType: 'rush' } },
  { id: 2, game_id: 'g1', sequence_number: 2, text: 'pass for 12',
    team_side: 'teamA', quarter: 1, effect: { isStat: true, statYds: 12 },
    roles: { passer: { team: 'teamA', num: '7', yards: 12 }, playType: 'pass' } },
  { id: 3, game_id: 'g1', sequence_number: 3, text: 'Quarter marker',
    team_side: 'teamA', quarter: 2, effect: { setQuarter: 2 }, roles: null }
];

// Boot the dashboard with the download intercepted rather than performed.
async function bootWithCapture(opts) {
  const p = await bootPage('dashboard.html', Object.assign({
    game: GAME,
    readyWhen: w => (w.document.getElementById('gamesBody') || {}).innerHTML
  }, opts || {}));

  const cap = { blob: null, filename: null };
  p.window.URL.createObjectURL = (blob) => { cap.blob = blob; return 'blob:test'; };
  p.window.URL.revokeObjectURL = () => {};
  const realCreate = p.document.createElement.bind(p.document);
  p.document.createElement = (tag) => {
    const el = realCreate(tag);
    if (tag === 'a') el.click = () => { cap.filename = el.download; };
    return el;
  };
  return { p, cap };
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- the file contains everything that matters ----------------------
  {
    const { p, cap } = await bootWithCapture({ existingPlays: PLAYS });
    const btn = p.document.querySelector('.exportGameBtn');
    if (!btn) {
      fail('button', 'no Download backup item on the game row');
      p.close();
      return failures;
    }
    click(p.window, btn);
    await new Promise(r => setTimeout(r, 400));

    if (!cap.blob) {
      fail('export', 'clicking produced no file at all');
      p.close();
      return failures;
    }

    let data;
    try {
      data = JSON.parse(await cap.blob.text());
    } catch (e) {
      fail('export', 'the file is not valid JSON: ' + e.message);
      p.close();
      return failures;
    }

    if (data.schema !== 'statchat-game-backup-v1') {
      fail('export', 'missing or wrong schema marker: ' + data.schema);
    }
    if (!data.exportedAt) {
      fail('export', 'no exportedAt — a backup with no date is hard to trust later');
    }
    if (!data.game || data.game.away_team_name !== 'Ruston') {
      fail('export', 'the game row is missing or wrong');
    }

    // The plays are the irreplaceable part. Everything else can be
    // rebuilt; these cannot.
    if ((data.plays || []).length !== PLAYS.length) {
      fail('export', 'expected ' + PLAYS.length + ' plays, got ' + (data.plays || []).length);
    }
    const first = (data.plays || [])[0] || {};
    for (const field of ['id', 'sequence_number', 'text', 'effect', 'roles']) {
      if (first[field] === undefined) {
        fail('export', 'play row lost its "' + field + '" field — a partial ' +
             'backup is worse than none, because it looks complete');
      }
    }
    // Administrative rows matter too: a quarter marker with roles:null
    // must survive, or the exported game cannot be replayed.
    const marker = (data.plays || []).find(x => x.sequence_number === 3);
    if (!marker) {
      fail('export', 'the quarter marker was dropped — admin rows must be kept');
    }

    if (!Array.isArray(data.rosters) || !data.rosters.length) {
      fail('export', 'rosters missing — names could not be restored');
    }

    // A filename someone can identify in six months.
    if (!/Neville/.test(cap.filename || '') || !/Ruston/.test(cap.filename || '') ||
        !/2026-08-24/.test(cap.filename || '')) {
      fail('filename', 'expected both team names and the date, got "' +
           cap.filename + '". A backup you cannot identify in six months ' +
           'is barely a backup');
    }
    p.close();
  }

  // --- a game with no plays must still export -------------------------
  // The moment you most want a backup is when something looks wrong, and
  // "wrong" sometimes means empty.
  {
    const { p, cap } = await bootWithCapture({ existingPlays: [] });
    click(p.window, p.document.querySelector('.exportGameBtn'));
    await new Promise(r => setTimeout(r, 400));
    if (!cap.blob) {
      fail('empty game', 'a game with no plays produced no file');
    } else {
      const data = JSON.parse(await cap.blob.text());
      if (!Array.isArray(data.plays) || data.plays.length !== 0) {
        fail('empty game', 'expected an empty plays array, got ' +
             JSON.stringify(data.plays));
      }
      if (!data.game) fail('empty game', 'the game row should still be there');
    }
    p.close();
  }

  // --- gated to admin and scorers, NOT view ---------------------------
  // Asserted from the source because the harness always boots as an
  // admin, so rendering alone cannot show who is excluded.
  {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'dashboard.html'), 'utf8');
    const i = src.indexOf('exportGameBtn');
    const preceding = src.slice(Math.max(0, i - 120), i);
    if (!/currentCanEnterGames \? '<button class="$/.test(preceding)) {
      fail('permissions', 'the backup button must be gated on ' +
           'currentCanEnterGames (admin + game_entry). A `view` account ' +
           'should not be able to download a whole game.');
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Game backup export ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  a whole game downloads as JSON, plays intact.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
