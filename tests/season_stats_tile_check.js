// Season Stats tile: bottom-left "Team Stats" tile shows this season's
// cumulative stats for our own team while a game has not started yet
// -----------------------------------------------------------------------
// Requested directly, analyzed and mocked up before any code changed.
// While game.status === 'not_started', view.html's bottom-left tile
// (normally this game's own box score, always empty until the game is
// underway) shows the sum of every prior FINISHED, non-preseason game
// this season instead -- the same tiles (Rushing/Passing/Receiving/
// Defense), computed the same way season_report.html already computes
// its own season totals: there is no stored, precomputed season-stats
// table anywhere in this app, so this derives it fresh, in the
// browser, exactly like that page does. The opponent's own tile
// (teamB) is deliberately untouched -- the request was specifically
// about our own team's tile, and a season total for a different
// opponent every week would not mean anything.
//
// The one thing that had to be gotten right structurally:
// buildTeams() overwrites the SAME global TEAMS object the whole page
// (banner, logos, colours) depends on for the CURRENT game. Computing
// the season aggregate means calling buildTeams() once per PRIOR game
// too, so it has to run and finish entirely before the current game's
// own buildTeams() call -- otherwise the rest of the page would show a
// stale prior opponent's name and colours instead of the real,
// current one. Tested explicitly below, not just assumed correct.

const { bootGamePage, bootPage, defaultRoster } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

async function buildFinishedGame(rushYards, passYards, receiver, withInterception) {
  const h = await bootGamePage();
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
  enterPlay(h, { type: 'rush', carrier: '22', yards: String(rushYards) });
  enterPlay(h, { type: 'pass', passer: '7', receiver, yards: String(passYards) });
  if (withInterception) {
    // renderTeamBoxScore's own Defense tile has never read its numbers
    // from computeBoxScore's `box` at all -- it reduces straight over
    // whichever plays array it is handed (overrideDefensePlays for the
    // season aggregate, the module-level `plays` otherwise). Injected
    // directly with the exact shape that reduction checks, since the
    // UI driver has no dedicated interception helper.
    h.evalIn("pushAndPersist({ id: nextId++, text: 'N Cornerback (Neville) intercepts', effect: { isStat: true }, roles: { playType: 'int', passer: { team: 'teamB' }, defense: { team: 'teamA', num: '21' } }, quarter: 1, sequence_number: 99, team_side: 'teamA' })");
  }
  const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
  h.close();
  return rows;
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. A not-started game with two prior finished games this
  // season: stats correctly merged across both, heading shows the
  // count, and -- critically -- the CURRENT game's own opponent name
  // is what the rest of the page shows, not a prior game's.
  {
    const game1Plays = await buildFinishedGame(20, 15, '80');
    const game2Plays = await buildFinishedGame(10, 9, '84');
    const games = [
      { game: { id: 'current-game', status: 'not_started', season_year: 2026, game_date: '2026-08-22', designator: 'Week 3', home_team_name: 'Neville', away_team_name: 'Some New Opp', our_team_is_home: true, is_preseason: false }, roster: [], plays: [] },
      { game: { id: 'g1', status: 'final', season_year: 2026, game_date: '2026-08-01', designator: 'Week 1', home_team_name: 'Neville', away_team_name: 'Opp One', our_team_is_home: true, is_preseason: false }, roster: defaultRoster(), plays: game1Plays },
      { game: { id: 'g2', status: 'final', season_year: 2026, game_date: '2026-08-08', designator: 'Week 2', home_team_name: 'Neville', away_team_name: 'Opp Two', our_team_is_home: true, is_preseason: false }, roster: defaultRoster(), plays: game2Plays }
    ];
    const w = await bootPage('view.html', { query: '?id=current-game', games, readyWhen: win => (win.document.getElementById('boxScoreTeamA') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 250));

    const heading = w.document.getElementById('teamAHeading').textContent;
    if (!/Season Stats.*2 games/.test(heading)) fail('heading-count', 'expected "Season Stats" with a count of 2 games, got: ' + heading);

    const html = w.document.getElementById('boxScoreTeamA').innerHTML;
    if (!/N Runningback[\s\S]*?30/.test(html)) fail('rushing-merged', 'expected rushing yards merged across both games (20+10=30), got: ' + html);
    if (!/24/.test(html)) fail('passing-merged', 'expected passing yards merged across both games (15+9=24), got: ' + html);
    if (!html.includes('N Receiver') || !html.includes('N Receiver Two')) {
      fail('receivers-kept-separate', 'expected two DIFFERENT receivers from the two games to appear separately, not merged into one, got: ' + html);
    }

    const oppName = w.evalIn('TEAMS.teamB.name');
    if (oppName !== 'Some New Opp') {
      fail('current-opponent-correct', 'expected the CURRENT game\'s own opponent name after computing the season aggregate, got: ' + oppName + ' -- buildTeams() for a prior game may have been the last one to run');
    }
    w.close();
  }

  // --- 2. No prior finished games this season at all -- game 1.
  {
    const games = [
      { game: { id: 'current-game', status: 'not_started', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Some Opp', our_team_is_home: true, is_preseason: false }, roster: [], plays: [] }
    ];
    const w = await bootPage('view.html', { query: '?id=current-game', games, readyWhen: win => (win.document.getElementById('boxScoreTeamA') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 200));
    const heading = w.document.getElementById('teamAHeading').textContent;
    if (!/Season Stats/.test(heading) || /games/.test(heading)) {
      fail('empty-heading', 'expected "Season Stats" with no game count (not "0 games"), got: ' + heading);
    }
    const html = w.document.getElementById('boxScoreTeamA').innerHTML;
    if (!/no season stats yet/.test(html)) fail('empty-message', 'expected "no season stats yet", got: ' + html);
    w.close();
  }

  // --- 3. A preseason prior game is correctly excluded -- the same
  // NULL-vs-false exclusion used everywhere else tonight.
  {
    const game1Plays = await buildFinishedGame(20, 15, '80');
    const games = [
      { game: { id: 'current-game', status: 'not_started', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Some Opp', our_team_is_home: true, is_preseason: false }, roster: [], plays: [] },
      { game: { id: 'g1', status: 'final', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Scrimmage Opp', our_team_is_home: true, is_preseason: true }, roster: defaultRoster(), plays: game1Plays }
    ];
    const w = await bootPage('view.html', { query: '?id=current-game', games, readyWhen: win => (win.document.getElementById('boxScoreTeamA') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 200));
    const html = w.document.getElementById('boxScoreTeamA').innerHTML;
    if (!/no season stats yet/.test(html)) {
      fail('preseason-excluded', 'a preseason-only prior game must not count -- expected "no season stats yet", got: ' + html);
    }
    w.close();
  }

  // --- 4. The opponent's own tile (teamB) is completely unaffected --
  // still the normal, empty-game message, never a season aggregate.
  {
    const game1Plays = await buildFinishedGame(20, 15, '80');
    const games = [
      { game: { id: 'current-game', status: 'not_started', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Some Opp', our_team_is_home: true, is_preseason: false }, roster: [], plays: [] },
      { game: { id: 'g1', status: 'final', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Opp One', our_team_is_home: true, is_preseason: false }, roster: defaultRoster(), plays: game1Plays }
    ];
    const w = await bootPage('view.html', { query: '?id=current-game', games, readyWhen: win => (win.document.getElementById('boxScoreTeamB') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 200));
    const heading = w.document.getElementById('teamBHeading').textContent;
    if (!/^Some Opp Stats$/.test(heading)) fail('opponent-heading-unaffected', 'expected the opponent\'s heading completely unchanged, got: ' + heading);
    const html = w.document.getElementById('boxScoreTeamB').innerHTML;
    if (!/No stats yet for Some Opp/.test(html)) fail('opponent-tile-unaffected', 'expected the opponent\'s normal, unchanged empty-game message, got: ' + html);
    w.close();
  }

  // --- 5. A normal in-progress game is completely unaffected -- shows
  // this game's own stats, normal heading, no season-aggregate logic
  // triggered at all.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '20' });
    const rows = h.db.plays.map((r, i) => Object.assign({}, r, { sequence_number: r.sequence_number || i + 1 }));
    h.close();

    const w = await bootPage('view.html', {
      game: { id: 'current-game', status: 'in_progress', season_year: 2026 },
      roster: defaultRoster(), existingPlays: rows, query: '?id=current-game',
      readyWhen: win => (win.document.getElementById('boxScoreTeamA') || {}).innerHTML
    });
    await new Promise(r => setTimeout(r, 200));
    const heading = w.document.getElementById('teamAHeading').textContent;
    if (heading !== 'Neville Stats') fail('in-progress-heading-normal', 'expected the ordinary, unchanged heading for an in-progress game, got: ' + heading);
    const html = w.document.getElementById('boxScoreTeamA').innerHTML;
    if (!html.includes('N Runningback') || !html.includes('20')) {
      fail('in-progress-shows-own-game', 'expected THIS game\'s own stats (a 20-yard rush), not a season aggregate, got: ' + html);
    }
    w.close();
  }

  // --- 6. Defense stats aggregate correctly too -- this tile has
  // never read from computeBoxScore's own box at all (it reduces
  // straight over a plays array), so it needed the separate
  // overrideDefensePlays parameter, not just the aggregatedBox.
  {
    const game1Plays = await buildFinishedGame(8, 0, '80', true);
    const games = [
      { game: { id: 'current-game', status: 'not_started', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Some Opp', our_team_is_home: true, is_preseason: false }, roster: [], plays: [] },
      { game: { id: 'g1', status: 'final', season_year: 2026, home_team_name: 'Neville', away_team_name: 'Opp One', our_team_is_home: true, is_preseason: false }, roster: defaultRoster(), plays: game1Plays }
    ];
    const w = await bootPage('view.html', { query: '?id=current-game', games, readyWhen: win => (win.document.getElementById('boxScoreTeamA') || {}).innerHTML });
    await new Promise(r => setTimeout(r, 250));
    const html = w.document.getElementById('boxScoreTeamA').innerHTML;
    if (!/Defense/.test(html)) fail('defense-tile-present', 'expected a Defense tile in the season aggregate, got: ' + html);
    if (!html.includes('>1<')) fail('defense-int-count', 'expected the interception to actually be counted (1), got: ' + html);
    w.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Season Stats tile for a not-started game ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  a not-started game shows this season\'s cumulative stats correctly merged across prior games, the opponent\'s own tile and every other game state are unaffected, and the current game\'s own identity survives computing the aggregate.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
