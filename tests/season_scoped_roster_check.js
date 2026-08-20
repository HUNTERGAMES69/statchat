// Season-scoped rosters
// -----------------------
// Requested directly: retain past seasons' rosters instead of deleting
// them on "Clear roster", while keeping the current season fully
// editable and past ones frozen. Confirmed decisions: past seasons are
// READ-ONLY (no add/edit/remove at all, not just disabled controls);
// no retroactive additions to a past season; no "copy forward" between
// seasons. Players can and will overlap between seasons, and their
// numbers may change year to year -- each season's roster is its own,
// independent set of rows, so a number meaning two different people in
// two different years is expected and must never be confused.
//
// The highest-stakes single line in this whole feature is the delete
// inside "Clear roster" -- get the season filter wrong there and it
// goes back to wiping every season a team has ever had, silently. That
// case gets tested explicitly, not just implied by the others.
//
// create_game.html's own fix matters as much as roster.html's: editing
// an OLD game must resolve "our" roster against THAT game's own season,
// never against whichever season is current today. The test for this
// deliberately uses the SAME jersey number for two DIFFERENT players in
// two different seasons, since that is exactly the scenario a wrong
// resolution would get wrong.

const { bootPage } = require('./harness');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  function twoSeasonRoster() {
    return [
      { id: 'p1', team_id: 'test-team-1', name: 'Old Player One', primary_position: 'QB', default_jersey_number: '7', season_year: 2025 },
      { id: 'p2', team_id: 'test-team-1', name: 'Old Player Two', primary_position: 'RB', default_jersey_number: '22', season_year: 2025 },
      { id: 'p3', team_id: 'test-team-1', name: 'New Player One', primary_position: 'WR', default_jersey_number: '80', season_year: 2026 },
      { id: 'p4', team_id: 'test-team-1', name: 'New Player Two', primary_position: 'K', default_jersey_number: '5', season_year: 2026 }
    ];
  }

  // === roster.html ===

  // --- 1. Default view is the current season, and it's editable.
  {
    const w = await bootPage('roster.html', {
      players: twoSeasonRoster(),
      branding: { current_season_year: 2026 },
      readyWhen: win => (win.document.getElementById('rosterBody') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 150));
    if (w.document.getElementById('rosterSeasonPicker').value !== '2026') {
      fail('default-season', 'the picker should default to the current season');
    }
    const body = w.document.getElementById('rosterBody').textContent;
    if (!body.includes('New Player One') || !body.includes('New Player Two') || body.includes('Old Player')) {
      fail('default-roster-contents', 'expected only the 2026 players, got: ' + body);
    }
    if (!w.document.getElementById('rosterReadOnlyBanner').classList.contains('hidden')) {
      fail('default-not-readonly', 'the current season must not show the read-only banner');
    }
    if (w.document.getElementById('rosterEditingControls').classList.contains('hidden')) {
      fail('default-editing-visible', 'the current season must show upload/clear controls');
    }
    w.close();
  }

  // --- 2. Switching to a past season: read-only, correct contents, no
  // edit/remove buttons, no add row.
  {
    const w = await bootPage('roster.html', {
      players: twoSeasonRoster(),
      branding: { current_season_year: 2026 },
      readyWhen: win => (win.document.getElementById('rosterBody') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 150));
    const picker = w.document.getElementById('rosterSeasonPicker');
    picker.value = '2025';
    picker.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 150));

    const html = w.document.getElementById('rosterBody').innerHTML;
    if (html.includes('editBtn') || html.includes('removeBtn')) {
      fail('past-season-controls', 'a past season must render no Edit or Remove buttons at all');
    }
    if (!html.includes('Old Player One') || !html.includes('Old Player Two')) {
      fail('past-season-contents', 'expected both 2025 players, got: ' + html);
    }
    if (w.document.getElementById('rosterReadOnlyBanner').classList.contains('hidden')) {
      fail('past-season-banner', 'the read-only banner must show for a past season');
    }
    if (!w.document.getElementById('rosterEditingControls').classList.contains('hidden')) {
      fail('past-season-editing-hidden', 'upload/clear controls must be hidden for a past season');
    }
    if (!w.document.getElementById('rosterAddRow').classList.contains('hidden')) {
      fail('past-season-addrow-hidden', 'the add-player row must be hidden for a past season');
    }
    w.close();
  }

  // --- 3. Defensive guard: even called directly, removePlayer refuses
  // while viewing a past season.
  {
    const w = await bootPage('roster.html', {
      players: [{ id: 'p1', team_id: 'test-team-1', name: 'Old Player', primary_position: 'QB', default_jersey_number: '7', season_year: 2025 }],
      branding: { current_season_year: 2026 },
      readyWhen: win => (win.document.getElementById('rosterBody') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 150));
    const picker = w.document.getElementById('rosterSeasonPicker');
    picker.value = '2025';
    picker.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 150));
    w.evalIn('removePlayer("p1")');
    await new Promise(r => setTimeout(r, 50));
    if (w.db.players.length !== 1) {
      fail('defensive-guard', 'removePlayer must refuse outright while viewing a past season, even called directly');
    }
    w.close();
  }

  // --- 4. Upload: tags new rows with the CURRENT season, and the
  // duplicate-name check is scoped to the current season only -- a
  // name that exists in a PAST season must not block re-adding that
  // same, returning player this season.
  {
    const w = await bootPage('roster.html', {
      players: [{ id: 'p1', team_id: 'test-team-1', name: 'Returning Player', primary_position: 'QB', default_jersey_number: '7', season_year: 2025 }],
      branding: { current_season_year: 2026 },
      readyWhen: win => (win.document.getElementById('rosterBody') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 150));

    // Minimal stub: returns known rows directly, bypassing real binary
    // parsing (third-party, unmodified code) to test the application
    // logic that actually changed -- season-scoped dedupe and tagging.
    w.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: {
        sheet_to_json: () => [
          ['#', 'Name', 'Position'],
          [7, 'Returning Player', 'QB'],   // same name, past season -- must NOT be skipped
          [99, 'Brand New Player', 'WR']
        ]
      }
    };
    const file = new w.window.File([new Uint8Array([1, 2, 3])], 'upload.xlsx');
    const input = w.document.getElementById('rosterFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 200));

    const preview = w.document.getElementById('uploadPreview').textContent;
    if (!/2 new player/.test(preview)) {
      fail('upload-dedupe-cross-season', 'expected both rows to count as new (a past-season name match must not suppress this season), got: ' + preview);
    }
    const confirmBtn = w.document.getElementById('confirmUploadBtn');
    if (confirmBtn) confirmBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const added2026 = w.db.players.filter(p => p.season_year === 2026);
    if (added2026.length !== 2) {
      fail('upload-season-tag', 'expected exactly 2 players tagged season_year=2026, got ' + added2026.length);
    }
    w.close();
  }

  // --- 5. The highest-stakes test: Clear Roster only removes the
  // CURRENT season's players. Past seasons must come out completely
  // untouched, and the confirmation count shown before the click must
  // only reflect the current season too.
  {
    const w = await bootPage('roster.html', {
      players: twoSeasonRoster(),
      branding: { current_season_year: 2026 },
      readyWhen: win => (win.document.getElementById('rosterBody') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 150));

    w.document.getElementById('clearRosterBtn').click();
    await new Promise(r => setTimeout(r, 100));
    if (!/all 2 player/.test(w.document.getElementById('clearRosterCount').textContent)) {
      fail('clear-preview-count', 'the confirmation count must reflect only the 2 CURRENT-season players, not all 4');
    }

    w.document.getElementById('clearRosterInput').value = 'CLEAR';
    w.document.getElementById('clearRosterConfirmBtn').click();
    await new Promise(r => setTimeout(r, 200));

    const remaining = w.db.players;
    if (remaining.length !== 2 || remaining.some(p => p.season_year !== 2025)) {
      fail('clear-scoped-delete', 'expected exactly the 2 players from 2025 to remain untouched, got: ' + JSON.stringify(remaining.map(p => ({ name: p.name, season_year: p.season_year }))));
    }
    w.close();
  }

  // === create_game.html ===

  // --- 6. Editing an OLD game resolves "our" roster against THAT
  // game's own season -- even when the current season has a
  // DIFFERENT person wearing the exact same number.
  {
    const players = [
      { id: 'p1', team_id: 'test-team-1', name: '2025 Quarterback', primary_position: 'QB', default_jersey_number: '7', season_year: 2025 },
      { id: 'p2', team_id: 'test-team-1', name: '2026 Quarterback', primary_position: 'QB', default_jersey_number: '7', season_year: 2026 }
    ];
    const w = await bootPage('create_game.html', {
      query: '?edit=test-game-1',
      players,
      branding: { current_season_year: 2026 },
      game: { season_year: 2025, game_date: '2025-08-15' }
    });
    const resolved = JSON.parse(w.evalIn('JSON.stringify(ourResolved)'));
    const offenseList = (resolved['7'] && resolved['7'].offense) || [];
    // Checked independently of array order, not just the first entry's
    // name -- without the season filter, BOTH players land under the
    // same number as a same-side conflict, and which one sorts to
    // index 0 is incidental. The real signal that the filter is
    // missing is that there are two people here at all, not just which
    // one this particular test array happened to list first.
    if (offenseList.length !== 1) {
      fail('edit-old-game-season', 'expected exactly one player under #7 (season-scoped), got ' + offenseList.length + ': ' + JSON.stringify(offenseList.map(o => o.name)));
    } else if (offenseList[0].name !== '2025 Quarterback') {
      fail('edit-old-game-season', 'editing a 2025 game must resolve #7 to the 2025 player, got: ' + offenseList[0].name);
    }
    w.close();
  }

  // --- 7. A brand-new game resolves against the CURRENT season.
  {
    const players = [
      { id: 'p1', team_id: 'test-team-1', name: '2025 Quarterback', primary_position: 'QB', default_jersey_number: '7', season_year: 2025 },
      { id: 'p2', team_id: 'test-team-1', name: '2026 Quarterback', primary_position: 'QB', default_jersey_number: '7', season_year: 2026 }
    ];
    const w = await bootPage('create_game.html', {
      query: '?nothing=1',
      players,
      branding: { current_season_year: 2026 }
    });
    const resolved = JSON.parse(w.evalIn('JSON.stringify(ourResolved)'));
    const offenseList = (resolved['7'] && resolved['7'].offense) || [];
    if (offenseList.length !== 1) {
      fail('new-game-season', 'expected exactly one player under #7 (season-scoped), got ' + offenseList.length + ': ' + JSON.stringify(offenseList.map(o => o.name)));
    } else if (offenseList[0].name !== '2026 Quarterback') {
      fail('new-game-season', 'a new game must resolve #7 to the CURRENT (2026) player, got: ' + offenseList[0].name);
    }
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Season-scoped rosters ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  past seasons are read-only and fully preserved, the current season is fully editable, Clear Roster never touches another season, and every game resolves against its own season\'s roster -- not whatever season happens to be current today.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
