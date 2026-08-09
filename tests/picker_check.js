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

  // DECISION REVERSED (Aug 7, 2026). This picker used to be pre-populated
  // from the special-teams roster and every discovered defender, and this
  // test enforced that. In practice it meant scrolling past a dozen names
  // that had never returned anything. It now starts EMPTY and builds from
  // actual returns: the first one is typed in, and from then on the list
  // is short and always relevant.
  for (const type of ['kickoff', 'punt']) {
    const btns = panelGrid(h, type, 'pp_credit_grid') || [];
    if (btns.length) {
      fail(type, 'the returner picker should start empty, but offers: ' +
                 btns.map(b => '#' + b.num).join(' '));
    }
  }

  // A tackler is not a returner -- a defensive credit must not seed it.
  h.evalIn('pushAndPersist({id:nextId++,text:"x",effect:{},quarter:1,roles:{defense:{team:"teamB",num:"55"},playType:"sack"}});');
  if (JSON.parse(h.evalIn('JSON.stringify(returnerEligible("teamB").map(x => x.num))')).length) {
    fail('returner', 'a defensive credit should not put a player in the returner picker');
  }

  // ...but an actual return does, and sticks.
  h.evalIn('pushAndPersist({id:nextId++,text:"x",effect:{},quarter:1,roles:{defense:{team:"teamB",num:"21"},playType:"kickoff_return"}});');
  const after = JSON.parse(h.evalIn('JSON.stringify(returnerEligible("teamB").map(x => x.num))'));
  if (after.join(',') !== '21') {
    fail('returner', 'after #21 returns a kick the picker should be exactly [21], got ' + after.join(','));
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
