// Per-player tackles
// ------------------
// Added 12 August 2026 (production plan, Phase 4b). The app had ALWAYS
// captured "tackled by" — stored in `roles.defense`, used to rank the
// tackler picker — and then thrown it away. Only interceptions, sacks
// and fumble recoveries were counted, so an ordinary tackle produced no
// stat anywhere.
//
// TWO DESIGN DECISIONS, both deliberate and both easy to "fix" wrongly:
//
// 1. A SINGLE NUMBER, no solo/assisted split. The entry panel takes one
//    tackler, so every tackle is implicitly solo today. Splitting would
//    need a second field on the fastest-moving screen in the app, which
//    is a real cost during a live game for a distinction nobody has
//    asked for yet.
//
// 2. PER-PLAYER TFL DOES NOT MATCH TEAM TFL, and must not be made to.
//    Team TFL counts every scrimmage play that lost yardage, whether or
//    not anyone was credited — a CEILING. Per-player TFL needs a named
//    tackler, and naming is optional — a FLOOR. Both are correct. They
//    answer different questions, and the reports show them in separate
//    tables with a note, rather than one number that is wrong for
//    somebody.
//
// The under-count is REAL and worth restating: at speed the tackler
// often goes unnamed, so these numbers are a lower bound on what
// happened. That is exactly why team TFL was built to count from the
// play log instead.

const { bootGamePage, bootPage } = require('./harness');

const ROSTER = [
  { team_side: 'teamA', unit: 'offense', jersey_number: '22', player_name: 'Roberson', position: 'RB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Robinson', position: 'QB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '80', player_name: 'Young',    position: 'WR' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '99', player_name: 'Frank',    position: 'DL' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '55', player_name: 'Carter',   position: 'LB' }
];

let n = 0;
const P = (o) => Object.assign({
  id: ++n, sequence_number: n, game_id: 'test-game-1', quarter: 1,
  team_side: 'teamA', is_divider: false
}, o);

function scenario() {
  n = 0;
  return [
    P({ text: 'start', effect: { isReset: true, down: 1, distance: 10, fieldPos: 25 } }),
    // a gain, tackled by Frank
    P({ text: 'rush 6', effect: { isStat: true, statYds: 6, fieldDelta: 6 },
        roles: { carrier: { team: 'teamA', num: '22', yards: 6 },
                 defense: { team: 'teamB', num: '99' }, playType: 'rush' } }),
    // a LOSS, tackled by Carter -> a tackle for loss
    P({ text: 'rush -3', effect: { isStat: true, statYds: -3, fieldDelta: -3 },
        roles: { carrier: { team: 'teamA', num: '22', yards: -3 },
                 defense: { team: 'teamB', num: '55' }, playType: 'rush' } }),
    // a sack by Frank -> a tackle AND a sack AND a TFL
    P({ text: 'sack', effect: { isStat: true, statYds: -7, fieldDelta: -7 },
        roles: { passer: { team: 'teamA', num: '7', yards: -7 },
                 defense: { team: 'teamB', num: '99' }, playType: 'sack' } }),
    // a completed pass, tackled by Carter
    P({ text: 'pass 12', effect: { isStat: true, statYds: 12, fieldDelta: 12 },
        roles: { passer: { team: 'teamA', num: '7', yards: 12 },
                 receiver: { team: 'teamA', num: '80', yards: 12 },
                 defense: { team: 'teamB', num: '55' }, playType: 'pass' } }),
    // NOBODY named -- must credit nobody, and must not throw
    P({ text: 'rush 4', effect: { isStat: true, statYds: 4, fieldDelta: 4 },
        roles: { carrier: { team: 'teamA', num: '22', yards: 4 }, playType: 'rush' } }),
    // a LOSS with nobody named -- team TFL counts it, per-player does not
    P({ text: 'rush -2', effect: { isStat: true, statYds: -2, fieldDelta: -2 },
        roles: { carrier: { team: 'teamA', num: '22', yards: -2 }, playType: 'rush' } })
  ];
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const plays = scenario();
  const v = await bootPage('view.html', { existingPlays: plays, roster: ROSTER });
  const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
  const def = (box.teamB || {}).defense || {};

  // --- the counts ------------------------------------------------------
  const frank = def.Frank || {};
  const carter = def.Carter || {};

  if ((frank.tackles || 0) !== 2) {
    fail('tackles', 'Frank should have 2 tackles (a rush stop and a sack), got ' +
         (frank.tackles || 0) + '. Full row: ' + JSON.stringify(frank));
  }
  if ((carter.tackles || 0) !== 2) {
    fail('tackles', 'Carter should have 2 tackles (a rush for loss and a pass), ' +
         'got ' + (carter.tackles || 0));
  }

  // --- a sack is a tackle too ------------------------------------------
  // How stat sheets treat it, and easy to get wrong by excluding sacks
  // from the tackle count.
  if ((frank.sacks || 0) !== 1) {
    fail('tackles', 'Frank lost his sack: ' + JSON.stringify(frank));
  }
  if ((frank.tackles || 0) <= (frank.sacks || 0)) {
    fail('tackles', 'a sack must count as a tackle as well as a sack');
  }

  // --- TFL ---------------------------------------------------------------
  if ((carter.tfl || 0) !== 1) {
    fail('tfl', 'Carter should have 1 TFL (the 3-yard loss), got ' + (carter.tfl || 0));
  }
  if ((frank.tfl || 0) !== 1) {
    fail('tfl', 'Frank should have 1 TFL (the sack), got ' + (frank.tfl || 0));
  }

  // --- a gain is never a TFL --------------------------------------------
  const totalTfl = Object.keys(def).reduce((t, k) => t + (def[k].tfl || 0), 0);
  if (totalTfl !== 2) {
    fail('tfl', 'expected 2 per-player TFL, got ' + totalTfl +
         ' — a positive gain must never count');
  }

  // --- an unnamed tackler credits NOBODY --------------------------------
  const totalTackles = Object.keys(def)
    .filter(k => k !== 'TEAM')
    .reduce((t, k) => t + (def[k].tackles || 0), 0);
  if (totalTackles !== 4) {
    fail('unnamed', 'expected 4 credited tackles across 6 scrimmage plays — ' +
         'two had no tackler named and must credit nobody. Got ' + totalTackles);
  }
  if ((def.TEAM || {}).tackles) {
    fail('unnamed', 'an unnamed tackle was credited to a TEAM bucket. Unlike ' +
         'sacks, an uncredited tackle should count for nobody — a team ' +
         '"tackle" total is meaningless, every play ends in one');
  }

  // --- the deliberate disagreement with team TFL ------------------------
  // The whole reason these live in separate tables.
  {
    // view.html computes team TFL inline rather than through a named
    // helper, so derive it here the same way: every scrimmage play that
    // lost yardage, tackler or not.
    const TFL_TYPES = ['rush', 'pass', 'sack', 'fumble'];
    const teamTfl = plays.filter(p =>
      p.roles && TFL_TYPES.includes(p.roles.playType) &&
      p.effect && typeof p.effect.statYds === 'number' &&
      p.effect.statYds < 0).length;
    {
      if (teamTfl <= totalTfl) {
        fail('ceiling vs floor', 'team TFL (' + teamTfl + ') should EXCEED ' +
             'per-player TFL (' + totalTfl + ') in this scenario — there is a ' +
             'loss with no tackler named. If they are equal the team count ' +
             'has probably been changed to require a tackler, which loses ' +
             'the ceiling');
      }
    }
  }

  // --- it reaches the screen --------------------------------------------
  {
    const text = v.document.body.textContent.replace(/\s+/g, ' ');
    if (!/Tackles/i.test(text)) {
      fail('display', 'view.html shows no tackles table — the numbers exist ' +
           'but nobody can see them');
    }
    if (!/Frank/.test(text)) {
      fail('display', 'the leading tackler is not named on the view page');
    }
    // The caveat must be visible, or an under-count reads as a complete
    // figure.
    if (!/tackler was named/i.test(text)) {
      fail('display', 'no note explaining that only named tackles are counted. ' +
           'Without it the number reads as complete when it is a floor');
    }
  }
  v.close();

  // --- and the recap ------------------------------------------------------
  {
    const r = await bootPage('recap.html', {
      existingPlays: plays, roster: ROSTER,
      game: { status: 'final', season_year: 2026, game_date: '2026-08-24' }
    });
    const text = r.document.body.textContent.replace(/\s+/g, ' ');
    if (!/Tackles/i.test(text) || !/Frank/.test(text)) {
      fail('display', 'recap.html does not show per-player tackles');
    }
    r.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Per-player tackles ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  tackles counted, TFL derived, unnamed plays credit nobody.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
