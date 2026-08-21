// Preseason game exclusion
// ---------------------------
// Requested directly: a way to mark a game (a scrimmage, say) so it
// never counts toward season-wide totals, without deleting it or
// leaving it off the schedule. Adds an is_preseason checkbox at game
// setup, a warning while it's checked, and an exclusion filter on both
// season-wide aggregation surfaces (season_report.html, player_report.
// html). Also adds a small badge to the dashboard's game list, so a
// coach can see at a glance which games are quietly excluded --
// otherwise easy to forget months later.
//
// The one thing to get right everywhere: is_preseason is NULL, not
// false, on every game saved before this column existed. NULL = false
// is itself NULL in SQL, not true, so a plain equality filter would
// have silently dropped every pre-existing game out of every season
// report the moment this shipped. Every check below that matters --
// the load-time checkbox state, the exclusion filter itself, the
// dashboard badge -- is tested against null specifically, not just
// true and false, for exactly that reason.

const { bootPage, defaultRoster } = require('./harness');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // === create_game.html: checkbox load, warning, save payload ===

  for (const [label, value, expectedChecked] of [
    ['true', true, true], ['false', false, false], ['null', null, false], ['undefined', undefined, false]
  ]) {
    const w = await bootPage('create_game.html', { query: '?edit=test-game-1', game: { is_preseason: value } });
    const checked = w.document.getElementById('isPreseason').checked;
    if (checked !== expectedChecked) {
      fail('checkbox-load-' + label, 'is_preseason=' + label + ' should load checkbox as ' + expectedChecked + ', got ' + checked);
    }
    const warningHidden = w.document.getElementById('preseasonWarning').classList.contains('hidden');
    if (warningHidden === expectedChecked) {
      fail('warning-load-' + label, 'warning visibility should match the checkbox on load for is_preseason=' + label);
    }
    w.close();
  }

  // Live toggle reacts without a reload.
  {
    const w = await bootPage('create_game.html', { query: '?edit=test-game-1', game: { is_preseason: false } });
    const cb = w.document.getElementById('isPreseason');
    cb.checked = true;
    cb.dispatchEvent(new w.window.Event('change'));
    if (w.document.getElementById('preseasonWarning').classList.contains('hidden')) {
      fail('warning-live-toggle', 'warning should appear immediately after checking the box, no reload needed');
    }
    w.close();
  }

  // The actual save payload, checked and unchecked -- not just the
  // checkbox's own DOM state, since a field can be visually right and
  // still never reach the object that gets written.
  for (const [label, shouldCheck, expected] of [['checked', true, true], ['unchecked', false, false]]) {
    const w = await bootPage('create_game.html', {
      query: '?edit=test-game-1',
      game: { season_year: 2026, game_date: '2026-08-15' }
    });
    w.document.getElementById('isPreseason').checked = shouldCheck;
    w.window.confirm = () => true;
    w.document.getElementById('skipOpponentBtn').click();
    await w.evalIn('createOrSaveGame()');
    await new Promise(r => setTimeout(r, 50));
    const saved = w.db.updated[0] && w.db.updated[0].fields.is_preseason;
    if (saved !== expected) {
      fail('save-payload-' + label, 'expected is_preseason=' + expected + ' in the saved payload, got ' + JSON.stringify(saved));
    }
    w.close();
  }

  // === season_report.html: the actual exclusion, end to end ===
  {
    const rushPlay = [{
      id: 'p1', text: 'N Runningback (Neville) rush for 10',
      effect: { isStat: true, statYds: 10 },
      roles: { carrier: { team: 'teamA', num: '22', yards: 10 }, playType: 'rush' },
      quarter: 1, sequence_number: 1, team_side: 'teamA'
    }];
    const games = [
      { game: { id: 'g1', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Regular Game', is_preseason: false }, roster: defaultRoster(), plays: rushPlay },
      { game: { id: 'g2', status: 'final', season_year: 2026, game_date: '2026-08-02', designator: 'Scrimmage', is_preseason: true }, roster: defaultRoster(), plays: rushPlay }
    ];
    const w = await bootPage('season_report.html', { query: '?season=2026', games, readyWhen: win => win.document.body.textContent.length > 400 });
    await new Promise(r => setTimeout(r, 300));
    const line = JSON.parse(w.evalIn('JSON.stringify(seasonAgg.rushing["N Runningback"] || null)'));
    if (!line || line.yds !== 10) {
      fail('season-report-exclusion', 'expected 10 rushing yards from the ONE non-preseason game, got ' + JSON.stringify(line));
    }
    w.close();
  }

  // === player_report.html: both queries ===
  {
    const rushPlay = [{
      id: 'p1', text: 'N Runningback (Neville) rush for 10',
      effect: { isStat: true, statYds: 10 },
      roles: { carrier: { team: 'teamA', num: '22', yards: 10 }, playType: 'rush' },
      quarter: 1, sequence_number: 1, team_side: 'teamA'
    }];
    const games = [
      { game: { id: 'g1', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Regular Game', is_preseason: false }, roster: defaultRoster(), plays: rushPlay },
      { game: { id: 'g2', status: 'final', season_year: 2026, game_date: '2026-08-02', designator: 'Scrimmage', is_preseason: true }, roster: defaultRoster(), plays: rushPlay }
    ];
    const w = await bootPage('player_report.html', { query: '?season=2026', games, readyWhen: win => win.document.body.textContent.length > 200 });
    await new Promise(r => setTimeout(r, 300));
    const count = w.evalIn('seasonGames.length');
    if (count !== 1) fail('player-report-loadSeason', 'expected exactly 1 game in seasonGames (the non-preseason one), got ' + count);
    w.close();
  }
  {
    // A season made ENTIRELY of preseason games must not appear as a
    // pickable option at all.
    const games = [
      { game: { id: 'g1', status: 'final', season_year: 2025, game_date: '2025-08-01', designator: 'Old Regular Game', is_preseason: false }, roster: defaultRoster(), plays: [] },
      { game: { id: 'g2', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Only Scrimmage', is_preseason: true }, roster: defaultRoster(), plays: [] }
    ];
    const w = await bootPage('player_report.html', { games, readyWhen: win => win.document.body.textContent.length > 200 });
    await new Promise(r => setTimeout(r, 300));
    const options = [...w.document.getElementById('seasonPicker').options].map(o => o.value);
    if (options.includes('2026')) fail('player-report-season-list', '2026 has only a preseason game and must not appear in the season picker, got options: ' + options.join(','));
    if (!options.includes('2025')) fail('player-report-season-list', 'expected 2025 to still be pickable, got options: ' + options.join(','));
    w.close();
  }

  // === dashboard.html: the badge ===
  for (const [label, value, expectBadge] of [
    ['true', true, true], ['false', false, false], ['undefined', undefined, false]
  ]) {
    const gameFields = { id: 'g1', designator: 'G1', season_year: 2026, game_date: '2026-08-15',
      home_team_name: 'Neville', away_team_name: 'Some Opponent', our_team_is_home: true, status: 'setup' };
    if (value !== undefined) gameFields.is_preseason = value;
    const w = await bootPage('dashboard.html', {
      game: gameFields,
      readyWhen: win => (win.document.getElementById('gamesBody') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 100));
    const html = w.document.getElementById('gamesBody').innerHTML;
    const hasBadge = html.includes('preseason-badge');
    if (hasBadge !== expectBadge) {
      fail('dashboard-badge-' + label, 'is_preseason=' + label + ' should show badge=' + expectBadge + ', got ' + hasBadge);
    }
    w.close();
  }

  // === dashboard.html: the team record box (the black-highlighted
  // "season-record" band) also wholly ignores a preseason game --
  // requested directly as a follow-up, since the original feature only
  // covered Season Report and Player Report. Not a counted win, not a
  // counted loss, not counted toward games played, home, or away. ===
  {
    const games = [
      { game: { id: 'g1', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Regular Win', our_team_is_home: true, final_score_us: 21, final_score_opp: 14, is_preseason: false }, roster: [], plays: [] },
      { game: { id: 'g2', status: 'final', season_year: 2026, game_date: '2026-08-02', designator: 'Regular Loss', our_team_is_home: false, final_score_us: 7, final_score_opp: 28, is_preseason: false }, roster: [], plays: [] },
      { game: { id: 'g3', status: 'final', season_year: 2026, game_date: '2026-08-03', designator: 'Preseason Win', our_team_is_home: true, final_score_us: 40, final_score_opp: 0, is_preseason: true }, roster: [], plays: [] },
      { game: { id: 'g4', status: 'final', season_year: 2026, game_date: '2026-08-04', designator: 'Preseason Loss', our_team_is_home: false, final_score_us: 0, final_score_opp: 40, is_preseason: true }, roster: [], plays: [] }
    ];
    const w = await bootPage('dashboard.html', { games, readyWhen: win => (win.document.getElementById('seasonRecord') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = w.document.getElementById('seasonRecord').innerHTML;
    if (!/1.?\u2013.?1/.test(html) || !/2 played/.test(html)) {
      fail('dashboard-record-excludes-preseason', 'expected 1-1, 2 played (the two preseason games wholly ignored), got: ' + html);
    }
    w.close();
  }
  {
    // A game with no is_preseason field at all -- every game saved
    // before the column existed -- must still count normally.
    const games = [
      { game: { id: 'g1', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Old Game', our_team_is_home: true, final_score_us: 21, final_score_opp: 14 }, roster: [], plays: [] }
    ];
    const w = await bootPage('dashboard.html', { games, readyWhen: win => (win.document.getElementById('seasonRecord') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 150));
    const html = w.document.getElementById('seasonRecord').innerHTML;
    if (!/1 played/.test(html)) {
      fail('dashboard-record-undefined-still-counts', 'a game with no is_preseason field at all must still count, got: ' + html);
    }
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Preseason game exclusion ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a preseason game is excluded from both season-wide aggregation surfaces, flagged on the dashboard, and every check holds for null just as it does for true and false.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
