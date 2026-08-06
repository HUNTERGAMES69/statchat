// Returner picker checks
// ----------------------
// Kickoff and punt "Returned by" now use a dedicated picker
// (returnerEligible) instead of defenseEligible, because a dedicated
// KR/PR is rostered on special teams and so never appeared in a list
// built from "players already credited with a defensive play". That
// left the grid empty on the opening kickoff of every game and forced
// the coach onto manual entry.
//
// These checks pin down all three things that change: the returner grid
// is populated and correctly ordered, the OTHER credit pickers are
// untouched, and the shared pickerHtml change did not break the label
// on the offensive pickers.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive } = require('./ui_driver');

function gridButtons(h, gridId) {
  const g = h.document.getElementById(gridId);
  if (!g) return null;
  return [...g.querySelectorAll('button')].map(b => ({
    num: b.dataset.num,
    unit: b.dataset.unit || null,
    label: b.textContent.trim()
  }));
}

function panelGrid(h, type, gridId) {
  h.evalIn('renderPlayPanel("' + type + '")');
  return gridButtons(h, gridId);
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });
  const h = await bootGamePage();
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });

  for (const type of ['kickoff', 'punt']) {
    const btns = panelGrid(h, type, 'pp_credit_grid');
    if (!btns || btns.length === 0) {
      fail(type, 'returner picker is empty on the opening ' + type +
                 ' -- this is the bug the dedicated picker exists to fix');
      continue;
    }
    // The designated returner must be offered, and must come first.
    if (!btns.some(b => b.num === '25')) {
      fail(type, 'returner #25 (rostered KR on special teams) is not offered');
    } else if (btns[0].num !== '25') {
      fail(type, 'returner #25 should sort first by position rank, but the list is: ' +
                 btns.map(b => '#' + b.num).join(' '));
    }
    // Specialists stay available but must not outrank an actual returner.
    const kickerIdx = btns.findIndex(b => b.num === '3');
    const returnerIdx = btns.findIndex(b => b.num === '25');
    if (kickerIdx !== -1 && kickerIdx < returnerIdx) {
      fail(type, 'the kicker is ranked above the returner');
    }
    // The source roster must be recorded so a resolved ambiguous name is
    // written back to the right place.
    if (btns.some(b => !b.unit)) {
      fail(type, 'some returner buttons carry no data-unit');
    }
    // The position is what makes this grid quickly scannable mid-game.
    if (!btns[0].label.includes('KR')) {
      fail(type, 'returner button does not show its position: ' + btns[0].label);
    }
  }

  // Every other credit picker must be exactly as it was: defense-only,
  // and empty until someone is discovered. Widening those was the thing
  // this change was specifically designed to avoid.
  for (const type of ['sack', 'int', 'fumble']) {
    const btns = panelGrid(h, type, 'pp_credit_grid');
    if (btns && btns.length) {
      fail(type, 'credit picker should still be empty before anyone is discovered, got: ' +
                 btns.map(b => '#' + b.num).join(' '));
    }
  }

  // pickerHtml now passes (num, entry) to statLabelFn. The offensive
  // pickers pass a function taking a jersey number and must be unaffected.
  const carriers = panelGrid(h, 'rush', 'pp_carrier_grid');
  if (!carriers || !carriers.length) {
    fail('rush', 'carrier picker unexpectedly empty');
  } else if (!carriers.every(b => /\(\d+ yds\)/.test(b.label))) {
    fail('rush', 'carrier picker lost its yardage label: ' + carriers[0].label);
  }

  // Picking from the grid (not typing) must produce a correctly named play.
  setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 40 });
  const res = enterPlay(h, { type: 'kickoff', kicker: '3', yards: '55',
                             credit: '25', retyds: '18', preferPicker: true });
  if (!res.saved) fail('kickoff', 'picking the returner from the grid did not save');
  if (res.parsedText && !res.parsedText.includes('O Returner')) {
    fail('kickoff', 'grid-picked returner did not resolve to a name: ' + res.parsedText);
  }

  // Once used, a returner becomes "discovered" and must not be listed twice.
  const after = panelGrid(h, 'punt', 'pp_credit_grid');
  const dupes = after.filter(b => b.num === '25');
  if (dupes.length > 1) {
    fail('punt', '#25 is listed ' + dupes.length + ' times after being used once');
  }

  h.close();
  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Returner picker checks ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) console.log('  returner picker populated, ordered and isolated from the other pickers.');
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
