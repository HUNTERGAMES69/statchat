// Sack-fumble display totals -- across surfaces
// -------------------------------------------------
// Reported directly, 20 Aug 2026: a game with 3 distinct sack plays,
// one of them also a fumble recovered by the defense, showed only 2 in
// the total. engine.js's own defense-side sack credit (fixed the same
// day, in an earlier report) was not the whole story -- it fixed
// computeBoxScore, but SEVEN separate places across FIVE files had
// each re-implemented their own "count sacks from the play log"
// logic independently, reading roles.playType straight off the plays
// array rather than going through computeBoxScore at all. None of
// them carried the fumble-carries-an-attempt exception, so all seven
// undercounted a sack-turned-fumble the identical way.
//
// This file covers the three LIVE, user-visible ones directly:
//   - view.html's own "Defense" tile, team row, Sacks column
//   - stat_package.html's "Sacks and Bad Snaps" export row (single game,
//     via a minimal injected XLSX stub -- see the test itself)
//   - season_report.html's identical export row (season-wide, which
//     builds its own plain-array xlsStatsRows during page load, before
//     any XLSX-specific step, so no stub is needed there)
//
// broadcast.html carries the exact same fix, character for character,
// to the same defTotals.sacks accumulator view.html has -- not
// re-tested here since the harness cannot currently boot that page,
// but the two are structurally identical and view.html's own case
// stands in for it. Three more instances (a sackYardsLost calculation
// in recap.html, stat_package.html, and view.html) were dead code --
// computed but never referenced downstream -- and were fixed for
// consistency but have no observable output to test here.

const { bootGamePage, bootPage, defaultRoster } = require('./harness');
const { click, setDrive, typeInto } = require('./ui_driver');

async function threeSacksOneFumbled(h) {
  setDrive(h, { down: 2, distance: 8, side: 'own', yardline: 30 });
  h.evalIn("renderPlayPanel('sack')");
  typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
  typeInto(h.window, h.document.getElementById('pp_yards'), '5');
  typeInto(h.window, h.document.getElementById('pp_credit_manual'), '55');
  click(h.window, h.document.getElementById('pp_review'));
  click(h.window, h.document.getElementById('saveBtn'));

  setDrive(h, { down: 3, distance: 9, side: 'own', yardline: 40 });
  h.evalIn("renderPlayPanel('sack')");
  typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
  typeInto(h.window, h.document.getElementById('pp_yards'), '6');
  typeInto(h.window, h.document.getElementById('pp_credit_manual'), '99');
  click(h.window, h.document.getElementById('pp_review'));
  click(h.window, h.document.getElementById('saveBtn'));

  // The third: no gain, fumbled, recovered by the defense, unnamed --
  // matching the exact play text reported.
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
  h.evalIn("renderPlayPanel('sack')");
  typeInto(h.window, h.document.getElementById('pp_passer_manual'), '7');
  typeInto(h.window, h.document.getElementById('pp_yards'), '0');
  click(h.window, h.document.getElementById('pp_sack_fumbled_toggle'));
  click(h.window, h.document.querySelector('input[name=pp_sack_fumrec][value=opp]'));
  click(h.window, h.document.getElementById('pp_review'));
  click(h.window, h.document.getElementById('saveBtn'));
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. view.html's Defense tile.
  {
    const h = await bootGamePage();
    await threeSacksOneFumbled(h);
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const v = await bootPage('view.html', { existingPlays: rows });
    const html = v.document.getElementById('boxScoreTeamB').innerHTML;
    v.close();

    const m = html.match(/Sacks<\/th>[\s\S]*?<tr>[\s\S]*?<td>Team<\/td>[\s\S]*?<\/tr>/);
    const sacksMatch = m && m[0].match(/<td>(\d+)<\/td>\s*<\/tr>$/);
    // Values in order are Int, Fum Rec, Sacks, TFL -- Sacks is the third <td>.
    const cells = m ? [...m[0].matchAll(/<td>(\d+)<\/td>/g)].map(x => x[1]) : [];
    if (cells[2] !== '3') {
      fail('view-defense-tile', 'expected Sacks=3 on view.html\'s Defense tile, got ' + JSON.stringify(cells));
    }
  }

  // --- 2. stat_package.html's "Sacks and Bad Snaps" export row. Needs a
  // minimal XLSX stub -- the real library is loaded from a CDN in the
  // browser and is not present in this test's jsdom environment, but
  // buildWorkbook() itself calls XLSX.utils on its very first line, so
  // it cannot run at all without one. The stub only has to satisfy the
  // handful of calls this function makes and hand back the raw rows
  // array aoa_to_sheet was given -- everything downstream of that (the
  // fix itself) is the real, unmodified code.
  {
    const h = await bootGamePage();
    await threeSacksOneFumbled(h);
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const sp = await bootPage('stat_package.html', { existingPlays: rows });
    sp.evalIn("window.XLSX = { utils: { book_new: () => ({ SheetNames: [], Sheets: {} }), " +
      "aoa_to_sheet: (a) => ({ __aoa: a }), " +
      "book_append_sheet: (wb, sheet, name) => { wb.SheetNames.push(name); wb.Sheets[name] = sheet; } }, writeFile: () => {} };");
    const row = sp.evalIn("(function(){ const wb = buildWorkbook(); const sheet = wb.Sheets[wb.SheetNames[0]]; " +
      "return JSON.stringify(sheet.__aoa.find(r => r[2] === 'Sacks and Bad Snaps') || null); })()");
    sp.close();
    const parsed = JSON.parse(row);
    if (!parsed || parsed[3] !== 3) {
      fail('stat-package-row', 'expected Rush Attempts=3 in the Sacks and Bad Snaps row, got ' + row);
    }
    if (!parsed || parsed[4] !== -11) {
      fail('stat-package-yards', 'expected Rush Yards=-11 (5+6+0) in the Sacks and Bad Snaps row, got ' + row);
    }
  }

  // --- 3. season_report.html's identical export row, season-wide.
  {
    const h = await bootGamePage();
    await threeSacksOneFumbled(h);
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const sr = await bootPage('season_report.html', {
      query: '?season=2026',
      games: [{
        game: { id: 'g1', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Week 1' },
        roster: defaultRoster(),
        plays: rows
      }],
      readyWhen: w => w.document.body.textContent.length > 400
    });
    await new Promise(res => setTimeout(res, 300));
    const row = sr.evalIn("JSON.stringify(xlsStatsRows.find(r => r[2] === 'Sacks and Bad Snaps') || null)");
    sr.close();
    const parsed = JSON.parse(row);
    if (!parsed || parsed[3] !== 3) {
      fail('season-report-row', 'expected Rush Attempts=3 in the season-report Sacks and Bad Snaps row, got ' + row);
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Sack-fumble display totals (across surfaces) ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a sack-turned-fumble counts correctly on the Defense tile and both stat exports, not just in computeBoxScore itself.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
