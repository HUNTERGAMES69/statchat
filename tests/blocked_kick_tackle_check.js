// Recovering a blocked kick is not a tackle
// =========================================
//   node tests/blocked_kick_tackle_check.js
//
// REGRESSION GUARD. The punt panel writes roles.defense from its
// "Tackled by" box on an ordinary return AND from its "Recovered by" box
// on a block -- one field, two meanings. That was harmless while 'punt'
// was not a tackle type; adding cover tackles on 31 Aug 2026 made every
// blocked punt hand its recoverer a tackle he never made.
//
// Found by the golden snapshot in accuracy_check.js, which recorded the
// box gaining "O Linebacker tackles=1" on two blocked-punt fixtures.
const { bootPage } = require('./harness');

let pass = 0, fail = 0;
const chk = (l, c, d) => {
  if (c) { pass++; console.log('ok   ' + l); }
  else { fail++; console.log('FAIL ' + l + (d ? '\n       ' + d : '')); }
};

const row = (seq, text, roles, effect) => ({
  id: 'p' + seq, game_id: 'g1', sequence_number: seq, quarter: 1,
  team: 'teamA', text, effect: effect || {}, roles,
});

(async () => {
  const plays = [
    // A blocked punt recovered by the other team's linebacker.
    row(1, 'N Punter punt BLOCKED, recovered by O Linebacker',
        { playType: 'punt', punter: { team: 'teamA', num: '15', blocked: true, yards: 0 },
          defense: { team: 'teamB', num: '55' } },
        { flip: true, flipTo: 'teamB' }),
    // An ordinary tackle, for comparison -- this one IS a tackle.
    row(2, 'N Runningback rush for 3, tackled by O Linebacker',
        { playType: 'rush', attempt: 'rush',
          carrier: { team: 'teamA', num: '22', yards: 3 },
          defense: { team: 'teamB', num: '55' } },
        { yards: 3 }),
  ];
  const v = await bootPage('view.html', { existingPlays: plays });
  const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
  v.close();

  const def = box.teamB.defense || {};
  const who = Object.keys(def)[0];
  const tackles = who ? Number(def[who].tackles || 0) : 0;
  console.log('\n   teamB defense: ' + JSON.stringify(def) + '\n');

  // Two plays carry roles.defense; only ONE of them is a tackle.
  chk('the ordinary tackle is counted', tackles >= 1, JSON.stringify(def));
  chk('recovering a blocked punt is NOT also counted as a tackle',
      tackles === 1,
      tackles + ' tackles credited from one real tackle and one blocked-kick ' +
      'recovery — the recovery is being counted as a tackle');

  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  process.exit(fail ? 1 : 0);
})();
