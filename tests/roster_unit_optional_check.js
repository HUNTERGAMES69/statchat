// Position/unit is optional for a player to be "on the roster"
// -----------------------------------------------------------------
// Reported directly, with a screenshot: a 94-player roster with no
// position data at all makes resolving every player to a unit
// (Offense/Defense/Special) genuinely impractical -- Andy has no way
// of knowing an opponent's positions for most of a roster, and seeds
// only the six starter slots he actually knows. Everyone else was
// left unresolved on purpose. During the game, manually crediting one
// of those unresolved players (typing his number, since he never
// appears as a picker button) showed "#22 is not on Test Opp's
// roster" -- even though #22 genuinely was uploaded, just never
// filed under a unit.
//
// Root cause, in two stacked pieces:
// 1. create_game.html's buildGameRosterRows never wrote a game_rosters
//    row at all for an unresolved (needsAssignment) player -- not "no
//    unit", nothing, invisible to the game entirely.
// 2. Every buildTeams copy (game.html, view.html, recap.html,
//    stat_package.html, season_report.html, broadcast.html) silently
//    dropped any game_rosters row whose unit wasn't one of the three
//    known values, so even a saved-but-unassigned row would still
//    vanish.
//
// Fixed by giving "no unit yet" a real, permanent home: unresolved
// players are now saved with unit: null, and every buildTeams copy
// files them into a new rosterUnassigned bucket instead of dropping
// them. engine.js's rosterName/playerName check that bucket as a
// last resort. The three unit-specific PICKER lists are deliberately
// unchanged -- there is nothing to file an unassigned player under
// for a role-specific button list, and Andy's own report treats that
// as expected, not the bug.

const { bootPage, bootGamePage, defaultRoster } = require('./harness');
const { click, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // === 1. create_game.html: buildGameRosterRows saves unresolved
  // players with unit: null, and does not duplicate one that WAS
  // resolved this same session. ===
  {
    const w = await bootPage('create_game.html', { query: '?nothing=1', branding: { current_season_year: 2026 } });
    await new Promise(r => setTimeout(r, 100));
    w.window.XLSX = {
      read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
      utils: { sheet_to_json: () => [['#', 'Name', 'Position'], [7, 'Alpha Player', ''], [22, 'Bravo Player', ''], [30, 'Charlie Player', '']] }
    };
    const file = new w.window.File([new Uint8Array([1, 2, 3])], 'opp.xlsx');
    const input = w.document.getElementById('opponentFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 200));

    // Resolve ONLY #7, leaving #22 and #30 unassigned -- Andy's real
    // workflow: seed the starters you know, skip the rest.
    const radio = w.document.querySelector('#opponentAssignments .assignRadio[data-num="7"][data-unit="offense"]');
    radio.checked = true;
    radio.dispatchEvent(new w.window.Event('change'));
    await new Promise(r => setTimeout(r, 50));

    const rows = JSON.parse(w.evalIn('JSON.stringify(buildGameRosterRows(oppResolved, "teamB", oppNeedsAssignment))'));
    if (rows.length !== 3) {
      fail('row-count', 'expected exactly 3 rows (one per player, none lost, none duplicated), got ' + rows.length + ': ' + JSON.stringify(rows));
    }
    const alpha = rows.find(r => r.jersey_number === '7');
    const bravo = rows.find(r => r.jersey_number === '22');
    const charlie = rows.find(r => r.jersey_number === '30');
    if (!alpha || alpha.unit !== 'offense') fail('resolved-row', 'expected #7 saved with unit=offense, got: ' + JSON.stringify(alpha));
    if (!bravo || bravo.unit !== null) fail('unassigned-row-1', 'expected #22 saved with unit=null, got: ' + JSON.stringify(bravo));
    if (!charlie || charlie.unit !== null) fail('unassigned-row-2', 'expected #30 saved with unit=null, got: ' + JSON.stringify(charlie));
    w.close();
  }

  // === 2. game.html: manually typing an unassigned-but-rostered
  // number resolves to the real name, not "not on the roster". ===
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '50', player_name: 'Alpha Unassigned', position: null }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    typeInto(win, doc.getElementById('pp_carrier_manual'), '50');
    await new Promise(r => setTimeout(r, 50));
    const box = doc.getElementById('pp_carrier_manual').nextSibling;
    const html = box ? box.innerHTML : '';
    if (/not on .*roster/i.test(html)) {
      fail('manual-entry-false-positive', 'an unassigned but genuinely-rostered player must not read as "not on the roster", got: ' + html);
    }
    if (!/Alpha Unassigned/.test(html)) {
      fail('manual-entry-name', 'expected the resolved name "Alpha Unassigned" to appear, got: ' + html);
    }
    h.close();
  }

  // === 3. The picker button list is UNCHANGED -- an unassigned player
  // still never appears as a tap button, only resolves when typed. ===
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '50', player_name: 'Alpha Unassigned', position: null }
    ]);
    const h = await bootGamePage({ roster });
    const { window: win, document: doc } = h;
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    await new Promise(r => setTimeout(r, 50));
    if (doc.body.innerHTML.includes('Alpha Unassigned')) {
      fail('picker-unchanged', 'an unassigned player must not appear anywhere in the picker button list -- there is no unit to file him under');
    }
    h.close();
  }

  // === 4. Report pages resolve an unassigned player's name too, once
  // credited -- playerName() needed the identical fallback rosterName()
  // did. Checked against recap.html as a representative sample; all six
  // buildTeams copies received the same fix. ===
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: null, jersey_number: '50', player_name: 'Alpha Unassigned', position: null }
    ]);
    const rows = [{
      id: 'p1', text: '#50 rush for 8', effect: { isStat: true, statYds: 8 },
      roles: { carrier: { team: 'teamA', num: '50', yards: 8 }, playType: 'rush' },
      quarter: 1, sequence_number: 1, team_side: 'teamA'
    }];
    const w = await bootPage('recap.html', { roster, existingPlays: rows, readyWhen: win => win.document.body.textContent.length > 200 });
    await new Promise(r => setTimeout(r, 200));
    if (!w.document.body.textContent.includes('Alpha Unassigned')) {
      fail('report-resolves-name', 'expected recap.html to display "Alpha Unassigned" for a credited, unit-less player, not a bare number');
    }
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Position/unit optional for roster recognition ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  an unresolved player is saved and recognized as genuinely on the roster everywhere that matters, while the unit-specific picker lists stay exactly as they were.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
