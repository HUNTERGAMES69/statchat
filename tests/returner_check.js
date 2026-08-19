// Returner checks
// ---------------
// Written on 17 Aug 2026 after a full mutation run left FIVE survivors, four
// of them in returner handling. `picker_check.js` reports "returner picker
// populated, ordered and isolated" and passes — but it passed with the
// picker falling back to a defence-only list, so its summary claims more
// than it tests. These are the assertions that were missing.
//
// Each one is aimed at a specific mutant that survived the whole suite.
// Verify by re-running that mutant and watching it flip !! -> OK. A test
// that has not been watched to fail is not evidence.
//
//   mutant #6  returner-overload : credit any roles.defense as a defensive stat
//   mutant #8  returner-name     : drop the cross-roster fallback (the Aug 5 bug)
//   mutant #9  returner-picker   : fall back to the defence-only eligible list
//
// NOT covered, deliberately: mutant #10 (returner-rank). It mutates
// RETURNER_POS_RANK, which is read only by returnerRank(), which NOTHING
// CALLS. That mutant survives because the code is unreachable, not because
// the suite is weak, and a test asserting kickers are demoted would be
// asserting behaviour the app does not have. See TODO — the table should be
// deleted or wired up, and a test written only once it is reachable.

const { bootPage, defaultRoster } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

// #7 is listed on OFFENSE ONLY and still returns a kick. That is the Aug 5
// bug: the name lookup used to read the defensive roster alone, so a
// two-way player who returned a punt showed up as "#7" with no name.
const OPP = [
  { team_side: 'teamB', unit: 'defense', jersey_number: '55', player_name: 'Tackler Only',  position: 'LB' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '44', player_name: 'Real Returner', position: 'DB' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '7',  player_name: 'Two Way Man',   position: 'WR' },
];

const fails = [];
const check = (rule, cond, detail) => {
  if (!cond) fails.push({ rule, detail });
  console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + rule + (cond ? '' : '\n          ' + detail));
};

const roster = () => defaultRoster().filter(r => r.team_side === 'teamA').concat(OPP);

const pickerNums = (h, cls) => JSON.parse(h.evalIn(
  `JSON.stringify([...document.querySelectorAll('${cls}')].map(b => b.dataset.num))`));

(async () => {
  console.log('=== Returner checks ===\n');

  // -------------------------------------------------------------------
  // 1. The returner picker is RETURNERS, not the defence.
  // -------------------------------------------------------------------
  {
    const h = await bootPage('game.html', { roster: roster() });
    // ORDER MATTERS, and getting it wrong makes this test pass for nothing.
    // The tackle has to happen while teamA still has the ball, because the
    // tackler is credited to the DEFENDING side. Do the punt first and
    // possession has already flipped, so `credit: '55'` records a teamA
    // defender and #55 never enters teamB's discovered list at all --
    // leaving both eligible lists identical and the mutant invisible.
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '3', credit: '55' });
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    enterPlay(h, { type: 'punt', punter: '3', credit: '44', retyds: '12', spot: { side: 'own', yardline: 32 } });

    // POSSESSION HAS TO BE BACK WITH THE KICKING TEAM.
    // The panel builds its returner list from returnerEligible(def), and
    // after the punt `def` is teamA — so #44, a teamB player, correctly
    // would not appear. Give the ball back before asking the question,
    // or the test passes for a reason that has nothing to do with the bug.
    h.evalIn('pushAndPersist({id:nextId++,text:"flip",effect:{forcePossession:"teamA"},quarter:1}); renderAll();');
    h.evalIn('renderPlayPanel("punt")');
    await new Promise(r => setTimeout(r, 120));
    // '.pp_credit_pick', not '.pp_returner_pick'. The punt panel renders the
    // returner list through the shared credit picker -- and that is exactly
    // the line mutant #9 swaps to defenseEligible, so this is the selector
    // that matters.
    const list = pickerNums(h, '.pp_credit_pick');

    check('the returner picker offers a player who has returned',
      list.includes('44'), 'returner list = ' + JSON.stringify(list));
    // THE ASSERTION THAT MATTERS. Swap returnerEligible for defenseEligible
    // and #55 — a tackler who has never fielded a kick — appears here.
    check('the returner picker does NOT offer a tackler who never returned',
      !list.includes('55'), '#55 only made a tackle, yet the list = ' + JSON.stringify(list));
    h.close();
  }

  // -------------------------------------------------------------------
  // 2. A returner's name resolves ACROSS rosters.
  // -------------------------------------------------------------------
  {
    const h = await bootPage('game.html', { roster: roster() });
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    const r = enterPlay(h, { type: 'punt', punter: '3', credit: '7', retyds: '9', spot: { side: 'own', yardline: 29 } });
    const text = r.parsedText || '';
    check('a returner listed only on OFFENSE still resolves to his name',
      /Two Way Man/.test(text), 'play text was: ' + JSON.stringify(text));
    check('and is not reduced to a bare jersey number',
      !/#7 \(/.test(text), 'play text was: ' + JSON.stringify(text));
    h.close();
  }

  // -------------------------------------------------------------------
  // 3. Returning a kick is not a defensive stat.
  // -------------------------------------------------------------------
  {
    const h = await bootPage('game.html', { roster: roster() });
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    enterPlay(h, { type: 'punt', punter: '3', credit: '44', retyds: '12', spot: { side: 'own', yardline: 32 } });
    const box = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays))'));
    const defRows = Object.keys(box.teamB.defense || {});
    // Loosen the guard to `if (r.defense)` and the returner gets a defense
    // bucket of his own — a phantom defender with no stats in him.
    check('a punt returner does not appear in the defensive stats',
      !defRows.some(k => k.includes('Real Returner')),
      'defensive rows = ' + JSON.stringify(defRows));
    h.close();
  }

  console.log('\nFailures: ' + fails.length);
  if (!fails.length) console.log('  returner lists hold returners, names cross rosters, returns are not tackles.');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('returner_check could not run:', e && e.stack || e); process.exit(1); });
