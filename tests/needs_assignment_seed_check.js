// Needs-assignment resolution updates the starter seed display live
// -------------------------------------------------------------------
// Reported directly, 20 Aug 2026, from real use with the Sterlington
// roster: seed a likely starter by jersey number for a player whose
// position wasn't recognized on import, and the seed area reports
// "not on the roster loaded here" -- correctly, since that number
// genuinely has not been filed under any unit yet. Assign that same
// player to Offense or Defense through the "needs assignment" prompt,
// and the underlying data becomes correct immediately -- but the
// message already on screen stayed stale until something ELSE
// happened to re-trigger renderStarterResolve, since nothing in the
// assignment radio's own handler ever called it.
//
// Fixed by calling renderStarterResolve(teamKey) at the end of that
// same handler. Covers both sides, since renderAssignmentUI is the one
// shared function serving 'our' and 'opp' alike.

const { bootPage } = require('./harness');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  async function seedThenResolve(side, players, uploadOpponent) {
    const opts = { query: '?nothing=1', branding: { current_season_year: 2026 } };
    if (players) opts.players = players;
    const w = await bootPage('create_game.html', opts);
    await new Promise(r => setTimeout(r, 100));

    if (uploadOpponent) {
      w.window.XLSX = {
        read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
        utils: { sheet_to_json: () => [['#', 'Name', 'Position'], [7, 'O Quarterback', '']] }
      };
      const file = new w.window.File([new Uint8Array([1, 2, 3])], 'opp.xlsx');
      const input = w.document.getElementById('opponentFile');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new w.window.Event('change'));
      await new Promise(r => setTimeout(r, 200));
    }

    const qbField = w.document.getElementById(side + 'StarterQB');
    qbField.value = '7';
    qbField.dispatchEvent(new w.window.Event('input'));
    await new Promise(r => setTimeout(r, 50));
    const before = w.document.getElementById(side + 'StarterResolve').innerHTML;

    const radio = w.document.querySelector('#' + (side === 'opp' ? 'opponentAssignments' : 'ourAssignments') + ' .assignRadio[data-num="7"][data-unit="offense"]');
    if (!radio) { w.close(); return { before, after: null, radioFound: false }; }
    radio.checked = true;
    radio.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const after = w.document.getElementById(side + 'StarterResolve').innerHTML;
    w.close();
    return { before, after, radioFound: true };
  }

  // --- 1. Opponent side: the exact reported scenario.
  {
    const { before, after, radioFound } = await seedThenResolve('opp', null, true);
    if (!radioFound) fail('opp-radio-missing', 'expected the needs-assignment radio to render for the uploaded opponent roster');
    if (!/not on the roster/.test(before)) {
      fail('opp-before', 'expected the seed to read "not on the roster" before resolving the unit, got: ' + before);
    }
    if (!/✓ QB #7 — O Quarterback/.test(after || '')) {
      fail('opp-after', 'expected the seed to update to "✓ QB #7 — O Quarterback" immediately after resolving the unit, with no other interaction, got: ' + after);
    }
  }

  // --- 2. Our own team's side, same shape.
  {
    const players = [
      { id: 'p1', team_id: 'test-team-1', name: 'N Quarterback', primary_position: '', default_jersey_number: '7', season_year: 2026 }
    ];
    const { before, after, radioFound } = await seedThenResolve('our', players, false);
    if (!radioFound) fail('our-radio-missing', 'expected the needs-assignment radio to render for the loaded roster');
    if (!/not on the roster/.test(before)) {
      fail('our-before', 'expected the seed to read "not on the roster" before resolving the unit, got: ' + before);
    }
    if (!/✓ QB #7 — N Quarterback/.test(after || '')) {
      fail('our-after', 'expected the seed to update to "✓ QB #7 — N Quarterback" immediately after resolving the unit, got: ' + after);
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Needs-assignment resolution updates the starter seed live ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  resolving a needs-assignment unit updates the seed message immediately, on both sides, with no other interaction required.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
