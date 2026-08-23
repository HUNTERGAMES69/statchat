// Cross-surface verification
// --------------------------
// The question this answers: "is what I typed into the UI what actually
// shows up everywhere else?"
//
// A play entered in game.html has to survive four separate hops:
//   typed in the UI -> parsed into a play -> persisted to the DB ->
//   recomputed and re-rendered by four other pages, each of which owns
//   its OWN copy of the engine.
//
// This compares all of those representations against each other and
// against the coach's original intent.

const { bootPage } = require('./harness');
const { runScript } = require('./run_scripted');

const REPORT_PAGES = [
  { file: 'view.html', query: '?id=test-game-1' },
  { file: 'recap.html', query: '?id=test-game-1' },
  { file: 'stat_package.html', query: '?id=test-game-1' },
  { file: 'season_report.html', query: '?season=2026' }
];

// Intent -- what the coach entered, written out independently of the
// app. Keys are team -> category -> jersey -> stat.
const EXPECTED_STATS = {
  teamA: {
    rushing: { '22': { att: 2, yds: 13, td: 0 } },
    passing: { '7': { att: 3, comp: 1, yds: 22, td: 0, intThrown: 1, sacked: 1 } },
    receiving: { '80': { rec: 1, yds: 22, td: 0 } },
    defense: { '99': { fumRec: 1 } },
    specialTeams: { '15': { punts: 1, puntYds: 40 }, '3': { fgAtt: 1, fgMade: 1 } }
  },
  teamB: {
    rushing: { '22': { att: 1, yds: 55, td: 1 } },
    defense: { '55': { sacks: 1 }, '21': { int: 1 } },
    specialTeams: { '3': { patAtt: 1, patMade: 1, kickoffs: 1 } }
  }
};

// Players who touched the ball only as kick/punt returners. They are
// tagged with roles.defense for name resolution, but must NOT appear in
// the defensive stat bucket -- that overload is the exact cause of the
// phantom "Defense" tile fixed on Aug 4-5.
const RETURNERS_WITHOUT_DEFENSIVE_STATS = { teamA: ['25'], teamB: ['25'] };

function get(obj, ...keys) {
  return keys.reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

async function run() {
  const failures = [];
  const notes = [];

  // 1. Drive the scripted game through game.html's real UI.
  const { h: game, failures: scriptFailures } = await runScript();
  scriptFailures.forEach(f => failures.push({ area: 'live entry', detail: '[' + f.kind + '] ' + f.step + ' -- ' + f.detail }));

  const dbRows = game.db.plays.map((r, i) => Object.assign({}, r, {
    sequence_number: r.sequence_number || i + 1
  }));
  const gameLog = JSON.parse(game.evalIn('JSON.stringify(plays.map(p => p.text))'));
  const gameState = JSON.parse(game.evalIn('JSON.stringify(computeState())'));
  const gameLogDom = game.document.getElementById('log')
    ? game.document.getElementById('log').textContent : '';

  // 2. Every play held in memory must have reached the database, with
  //    identical text. A play that renders on screen but never persists
  //    is invisible to every other surface.
  if (dbRows.length !== gameLog.length) {
    failures.push({ area: 'persistence',
      detail: 'game.html holds ' + gameLog.length + ' plays but persisted ' + dbRows.length });
  }
  gameLog.forEach((text, i) => {
    if (dbRows[i] && dbRows[i].text !== text) {
      failures.push({ area: 'persistence',
        detail: 'play ' + i + ' text differs.\n        screen: ' + text + '\n        saved : ' + dbRows[i].text });
    }
    if (gameLogDom && !gameLogDom.includes(text)) {
      failures.push({ area: 'game.html log', detail: 'play text not rendered in the on-screen log: ' + text });
    }
  });
  game.close();

  // 3. Re-open every other surface against those exact saved rows.
  const boxScores = {};
  const rendered = {};
  // Buckets are keyed by DISPLAY NAME, not jersey number (Aug 7, 2026 --
  // numbers are not identity, two players can share one). The fixture
  // below is written by number, because that is what was entered, so the
  // mapping is captured here while a page is still open to resolve it.
  const nameFor = {};
  for (const page of REPORT_PAGES) {
    let h;
    try {
      h = await bootPage(page.file, {
        query: page.query,
        existingPlays: dbRows,
        game: { status: 'final', season_year: 2026, game_date: '2026-08-01',
                final_score_us: gameState.scores.teamA, final_score_opp: gameState.scores.teamB }
      });
    } catch (e) {
      failures.push({ area: page.file, detail: 'page failed to load: ' + e.message });
      continue;
    }
    try {
      boxScores[page.file] = JSON.parse(h.evalIn(
        'JSON.stringify(computeBoxScore(' + (page.file === 'season_report.html' ? 'plays || []' : 'plays') + '))'
      ));
    } catch (e) {
      notes.push(page.file + ': could not read computeBoxScore directly (' + e.message.split('\n')[0] + ')');
    }
    if (!Object.keys(nameFor).length){
      for (const team of Object.keys(EXPECTED_STATS)){
        for (const cat of Object.keys(EXPECTED_STATS[team])){
          const unit = cat === 'defense' ? 'defense' : cat === 'specialTeams' ? 'special' : null;
          for (const num of Object.keys(EXPECTED_STATS[team][cat])){
            nameFor[team + '|' + cat + '|' + num] = h.evalIn(
              'playerName(' + JSON.stringify(team) + ', ' + JSON.stringify(num) +
              (unit ? ', ' + JSON.stringify(unit) : '') + ')');
          }
        }
      }
    }
    rendered[page.file] = h.document.body.textContent.replace(/\s+/g, ' ');
    h.close();
  }

  // 4. All four engine copies must agree, exactly.
  const files = Object.keys(boxScores);
  if (files.length > 1) {
    const ref = files[0];
    for (const f of files.slice(1)) {
      const a = JSON.stringify(boxScores[ref]), b = JSON.stringify(boxScores[f]);
      if (a !== b) {
        failures.push({ area: 'engine agreement',
          detail: f + ' produced a different box score than ' + ref });
      }
    }
  }

  // 5. The box score must match what the coach actually entered.
  const box = boxScores[files[0]];
  if (box) {
    for (const team of Object.keys(EXPECTED_STATS)) {
      for (const cat of Object.keys(EXPECTED_STATS[team])) {
        for (const num of Object.keys(EXPECTED_STATS[team][cat])) {
          const want = EXPECTED_STATS[team][cat][num];
          const key = nameFor[team + '|' + cat + '|' + num] || num;
          for (const stat of Object.keys(want)) {
            const actual = get(box, team, cat, key, stat) || 0;
            if (actual !== want[stat]) {
              failures.push({ area: 'stat accuracy',
                detail: team + '.' + cat + '.#' + num + '.' + stat +
                        ' -- entered ' + want[stat] + ', reported ' + actual });
            }
          }
        }
      }
    }
    // Returners must not have acquired defensive stats.
    for (const team of Object.keys(RETURNERS_WITHOUT_DEFENSIVE_STATS)) {
      for (const num of RETURNERS_WITHOUT_DEFENSIVE_STATS[team]) {
        if (get(box, team, 'defense', num) !== undefined) {
          failures.push({ area: 'returner/defense overload',
            detail: team + ' #' + num + ' was a returner only, but has a defensive stat bucket' });
        }
      }
    }
  }

  // 6. Key numbers must actually be VISIBLE, not merely computed
  //    correctly in memory.
  const finalScore = [gameState.scores.teamA, gameState.scores.teamB];
  for (const f of Object.keys(rendered)) {
    if (f === 'season_report.html') continue; // season page aggregates, not a single score line
    const text = rendered[f];
    if (!text.includes(String(finalScore[0])) || !text.includes(String(finalScore[1]))) {
      failures.push({ area: 'render', detail: f + ' does not display the final score ' + finalScore.join('-') });
    }
  }

  // THE SPECTATOR PAGE PICKS UP A NEW LOGO WITHOUT A RELOAD.
  // ---------------------------------------------------------------------
  // view.html read the teams row ONCE, in init(). Everything else on it
  // updates live -- plays, score, drives, clock -- so it reads as a live
  // page, and a logo uploaded on the customize screen quietly never
  // arrived while every other page showed it. Reported directly:
  // "updated everywhere but the view screen."
  {
    const w = await bootPage('view.html', {
      branding: { logo_url: 'https://x.co/logo.png?v=OLD' },
      readyWhen: win => (win.document.getElementById('driveLogScroll') || {}).innerHTML !== undefined });
    await new Promise(r => setTimeout(r, 300));
    if (w.evalIn('TEAMS.teamA.logo') !== 'https://x.co/logo.png?v=OLD') {
      failures.push({ area: 'branding:load', detail: 'the page did not take the logo at load' });
    }
    // The customize screen replaces it -- the stored URL carries a fresh
    // version stamp, which is what makes the change visible at all.
    w.db.branding.logo_url = 'https://x.co/logo.png?v=NEW';
    if (typeof w.window.__refreshBranding !== 'function') {
      failures.push({ area: 'branding:hook', detail: 'view.html should re-read branding while open' });
    } else {
      await w.evalIn('window.__refreshBranding(true)');
      await new Promise(r => setTimeout(r, 300));
      if (w.evalIn('TEAMS.teamA.logo') !== 'https://x.co/logo.png?v=NEW') {
        failures.push({ area: 'branding:refresh',
          detail: 'the new logo did not reach the page: ' + w.evalIn('TEAMS.teamA.logo') });
      }
    }
    w.close();
  }

  return { failures, notes, boxScores, gameState, dbRows, rendered };
}

if (require.main === module) {
  run().then(({ failures, notes, boxScores, gameState, dbRows }) => {
    console.log('=== Cross-surface verification ===\n');
    console.log('Plays persisted: ' + dbRows.length +
                '   Final score: Neville ' + gameState.scores.teamA + ' — TEST OPP ' + gameState.scores.teamB + '\n');
    console.log('Surfaces compared: ' + Object.keys(boxScores).join(', ') + '\n');
    notes.forEach(n => console.log('  note: ' + n));
    if (notes.length) console.log('');
    console.log('=== Failures: ' + failures.length + ' ===');
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run, EXPECTED_STATS };
