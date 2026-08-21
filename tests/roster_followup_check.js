// Two follow-up reports from real use, same evening
// ----------------------------------------------------
// 1. "Our" team's roster: resolving a needs-assignment unit never
//    stuck between games. Every time create_game.html loaded -- a new
//    game, or even reopening the same one -- the same two players
//    with an unrecognized position were asked about again, because the
//    choice was only ever applied to THIS game's own game_rosters
//    snapshot, never written back to the master players row itself.
//
//    Fixed with a new players.unit_override column: read here, checked
//    before falling back to guessing a unit from position, and written
//    the moment the coach resolves the assignment radio -- so the
//    NEXT load of "our" roster already knows. Deliberately only applies
//    to 'our' side; there is no master table for an opponent roster to
//    persist anything to at all (see PROJECT_NOTES.md).
//
// 2. Seeding a starter whose number sits unresolved in needs-assignment
//    read exactly like a number nobody wears -- "not on the roster
//    loaded here" -- which is what made the first fix (the seed
//    message updating live once a unit is resolved, tests/
//    needs_assignment_seed_check.js) easy to miss: nothing on screen
//    said the two were connected. Now distinguished: "on the roster,
//    but needs a unit picked below" for a number genuinely present but
//    unresolved, vs. the original message only for a number that truly
//    is not on the roster at all.

const { bootPage } = require('./harness');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // === 1. "Our" team's unit choice persists across a fresh load ===
  {
    const players = [
      { id: 'p1', team_id: 'test-team-1', name: 'N Quarterback', primary_position: '', default_jersey_number: '7', season_year: 2026 }
    ];
    const w1 = await bootPage('create_game.html', { query: '?nothing=1', players, branding: { current_season_year: 2026 } });
    await new Promise(r => setTimeout(r, 100));

    const before = w1.document.getElementById('ourAssignments').innerHTML.includes('N Quarterback');
    if (!before) fail('initial-ask', 'expected the unrecognized-position player to appear in needs-assignment initially');

    const radio = w1.document.querySelector('#ourAssignments .assignRadio[data-num="7"][data-unit="offense"]');
    radio.checked = true;
    radio.dispatchEvent(new w1.window.Event('change'));
    await new Promise(r => setTimeout(r, 100));

    const updated = w1.db.players.find(p => p.id === 'p1');
    if (!updated || updated.unit_override !== 'offense') {
      fail('persisted', 'expected unit_override=offense to be written to the players row, got: ' + JSON.stringify(updated));
    }
    w1.close();

    // A fresh page load -- a new game, or reopening this one -- with
    // the now-persisted value already on the row.
    const players2 = [
      { id: 'p1', team_id: 'test-team-1', name: 'N Quarterback', primary_position: '', default_jersey_number: '7', season_year: 2026, unit_override: 'offense' }
    ];
    const w2 = await bootPage('create_game.html', { query: '?nothing=1', players: players2, branding: { current_season_year: 2026 } });
    await new Promise(r => setTimeout(r, 100));
    const askedAgain = w2.document.getElementById('ourAssignments').innerHTML.includes('N Quarterback');
    if (askedAgain) fail('not-asked-again', 'expected a fresh load with a persisted unit_override to skip needs-assignment entirely, but it asked again');
    const resolved = JSON.parse(w2.evalIn('JSON.stringify(ourResolved)'));
    const offenseNames = (resolved['7'] && resolved['7'].offense || []).map(o => o.name);
    if (!offenseNames.includes('N Quarterback')) {
      fail('resolved-correctly', 'expected the persisted choice to resolve #7 directly into the offense bucket, got: ' + JSON.stringify(offenseNames));
    }
    w2.close();
  }

  // === 2. The distinguishing message ===

  // A number genuinely present but not yet unit-assigned.
  {
    const w = await bootPage('create_game.html', { query: '?nothing=1', branding: { current_season_year: 2026 } });
    await new Promise(r => setTimeout(r, 100));
    w.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => [['#', 'Name', 'Position'], [7, "J'Rob Breen", '']] }
    };
    const file = new w.window.File([new Uint8Array([1, 2, 3])], 'opp.xlsx');
    const input = w.document.getElementById('opponentFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 200));

    const qbField = w.document.getElementById('oppStarterQB');
    qbField.value = '7';
    qbField.dispatchEvent(new w.window.Event('input'));
    await new Promise(r => setTimeout(r, 50));
    const msg = w.document.getElementById('oppStarterResolve').innerHTML;
    if (!/needs a unit picked below/.test(msg)) {
      fail('awaiting-assignment-message', 'expected the distinguishing message for a number awaiting unit assignment, got: ' + msg);
    }
    if (/not on the roster loaded here/.test(msg)) {
      fail('awaiting-assignment-not-generic', 'a number awaiting assignment must not show the generic "not on the roster" text, got: ' + msg);
    }
    w.close();
  }

  // A number genuinely nobody wears must still show the original message.
  {
    const w = await bootPage('create_game.html', { query: '?nothing=1', branding: { current_season_year: 2026 } });
    await new Promise(r => setTimeout(r, 100));
    w.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => [['#', 'Name', 'Position'], [22, 'Some Other', 'RB']] }
    };
    const file = new w.window.File([new Uint8Array([1, 2, 3])], 'opp.xlsx');
    const input = w.document.getElementById('opponentFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 200));

    const qbField = w.document.getElementById('oppStarterQB');
    qbField.value = '99';
    qbField.dispatchEvent(new w.window.Event('input'));
    await new Promise(r => setTimeout(r, 50));
    const msg = w.document.getElementById('oppStarterResolve').innerHTML;
    if (!/not on the roster loaded here/.test(msg)) {
      fail('genuinely-absent-message', 'a number nobody wears at all must still show the original message, got: ' + msg);
    }
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Roster follow-up: persistence and message clarity ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  our own team\'s unit choice sticks across a fresh load, and a number awaiting assignment reads differently from one genuinely absent.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
