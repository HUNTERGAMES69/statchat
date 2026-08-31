// A statistic must land on the right game, the right team, the right player
// =========================================================================
//   node tests/stat_assignment_check.js
//
// The identity fuzzer proves a stat sheet is internally consistent. It
// cannot see a whole game's numbers landing on the wrong school -- which
// produces a perfectly consistent, perfectly WRONG report, and is the
// failure that matters most once several schools are signed up.
const { bootPage, defaultRoster } = require('./harness');

let pass = 0, fail = 0;
const chk = (l, c, d) => {
  if (c) { pass++; console.log('ok   ' + l); }
  else { fail++; console.log('FAIL ' + l + (d ? '\n       ' + d : '')); }
};

// Two games' worth of plays, deliberately sharing jersey numbers so a
// leak between them shows up as a doubled total rather than as a name
// nobody recognises.
function play(seq, gameId, team, num, name, yards, quarter){
  return {
    id: gameId + '-' + seq, game_id: gameId, sequence_number: seq,
    quarter: quarter || 1, team, text: name + ' rush for ' + yards,
    effect: { yards },
    roles: { playType: 'rush', attempt: 'rush',
             carrier: { team, num, name, yards } },
  };
}

(async () => {
  // ---- ONE GAME'S BOX SCORE CONTAINS ONLY THAT GAME ------------------
  // view.html is handed the rows for ONE game. If computeBoxScore ever
  // reached past what it was given, this is where it would show.
  const gameOne = [
    play(1, 'g1', 'teamA', '22', 'A Runner', 10),
    play(2, 'g1', 'teamA', '22', 'A Runner', 5),
    play(3, 'g1', 'teamB', '22', 'B Runner', 7),
  ];
  const gameTwo = [
    play(1, 'g2', 'teamA', '22', 'A Runner', 99),
    play(2, 'g2', 'teamB', '22', 'B Runner', 44),
  ];

  const v1 = await bootPage('view.html', { existingPlays: gameOne });
  const box1 = JSON.parse(v1.evalIn('JSON.stringify(computeBoxScore(plays))'));
  v1.close();

  const total = (box, team, cat, f) =>
    Object.values((box[team] || {})[cat] || {}).reduce((t, r) => t + Number(r[f] || 0), 0);

  chk('one game totals only its own plays',
      total(box1, 'teamA', 'rushing', 'yds') === 15,
      'teamA rushing = ' + total(box1, 'teamA', 'rushing', 'yds') + ', expected 15');
  chk('and the other team only theirs',
      total(box1, 'teamB', 'rushing', 'yds') === 7,
      'teamB rushing = ' + total(box1, 'teamB', 'rushing', 'yds'));
  chk('a 99-yard run from a DIFFERENT game is nowhere in it',
      total(box1, 'teamA', 'rushing', 'yds') !== 114 &&
      JSON.stringify(box1).indexOf('99') === -1,
      JSON.stringify(box1.teamA.rushing));

  // ---- THE SAME PAGE, HANDED BOTH GAMES' ROWS ------------------------
  // This is what a query missing its game_id filter would produce. The
  // check is not that the engine refuses it -- it cannot know -- but
  // that the totals are exactly the sum, with nothing lost or doubled.
  // A silent DROP here would be as bad as a leak.
  const both = gameOne.concat(gameTwo.map((p, i) =>
    Object.assign({}, p, { sequence_number: 100 + i })));
  const v2 = await bootPage('view.html', { existingPlays: both });
  const boxBoth = JSON.parse(v2.evalIn('JSON.stringify(computeBoxScore(plays))'));
  v2.close();
  chk('handed two games, every play is still counted exactly once',
      total(boxBoth, 'teamA', 'rushing', 'yds') === 114 &&
      total(boxBoth, 'teamB', 'rushing', 'yds') === 51,
      'A=' + total(boxBoth, 'teamA', 'rushing', 'yds') +
      ' B=' + total(boxBoth, 'teamB', 'rushing', 'yds') + ' (expected 114 / 51)');

  // ---- A SHARED NAME MUST NOT MERGE ACROSS TEAMS ---------------------
  // Two schools really can both have a "J Smith" wearing 22. If the
  // bucket key ignores the team, their numbers add together.
  const shared = [
    play(1, 'g1', 'teamA', '22', 'J Smith', 10),
    play(2, 'g1', 'teamB', '22', 'J Smith', 60),
  ];
  const v3 = await bootPage('view.html', { existingPlays: shared });
  const box3 = JSON.parse(v3.evalIn('JSON.stringify(computeBoxScore(plays))'));
  v3.close();
  chk('the same name on both teams stays two separate players',
      total(box3, 'teamA', 'rushing', 'yds') === 10 &&
      total(box3, 'teamB', 'rushing', 'yds') === 60,
      'A=' + total(box3, 'teamA', 'rushing', 'yds') +
      ' B=' + total(box3, 'teamB', 'rushing', 'yds'));
  chk('and neither box score contains the other team\'s total',
      JSON.stringify(box3.teamA.rushing).indexOf('70') === -1 &&
      JSON.stringify(box3.teamB.rushing).indexOf('70') === -1);

  // ---- A PLAY WITH NO TEAM MUST NOT BE GUESSED AT --------------------
  // A row that lost its team is a data fault. Crediting it to somebody
  // is worse than dropping it, because a wrong number is indistinguishable
  // from a right one on a report.
  const orphan = [
    play(1, 'g1', 'teamA', '22', 'A Runner', 10),
    { id: 'x', game_id: 'g1', sequence_number: 2, quarter: 1, team: null,
      text: 'orphan', effect: { yards: 500 },
      roles: { playType: 'rush', attempt: 'rush',
               carrier: { team: null, num: '22', name: 'A Runner', yards: 500 } } },
  ];
  const v4 = await bootPage('view.html', { existingPlays: orphan });
  const box4 = JSON.parse(v4.evalIn('JSON.stringify(computeBoxScore(plays))'));
  v4.close();
  const leaked = total(box4, 'teamA', 'rushing', 'yds') + total(box4, 'teamB', 'rushing', 'yds');
  chk('a play with no team is not silently credited to either side',
      leaked === 10, 'total rushing across both teams = ' + leaked + ', expected 10');

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  process.exit(fail ? 1 : 0);
})();
