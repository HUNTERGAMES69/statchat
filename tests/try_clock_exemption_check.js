// Try clock exemption -- missed/blocked/turned-over cases
// -----------------------------------------------------------
// Reported directly, 20 Aug 2026: a missed PAT still prompted for a
// clock entry. It should not -- a try's own clock relevance is already
// covered on the touchdown before it (when the clock stopped) and the
// kickoff after it (when play resumes); the try itself is an
// administrative down between those two moments regardless of whether
// the kick was good.
//
// The gap: isTry, the flag that suppresses the clock prompt for a try,
// only ever matched a SUCCESSFUL one (effect.score present, worth 1 or
// 2 points). A missed, blocked, or turned-over try has no score at all,
// so it fell through to needsClock's general case and prompted anyway.
// Fixed by widening isTry to the shape every try outcome actually
// shares -- effect.endsDrive, with no flip and no newPossession --
// rather than the score, which only some of them have.

const { bootGamePage } = require('./harness');
const { click, setDrive, typeInto } = require('./ui_driver');

async function scoreATouchdown(h) {
  setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 5 });
  h.evalIn("renderPlayPanel('rush')");
  typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
  typeInto(h.window, h.document.getElementById('pp_yards'), '5');
  click(h.window, h.document.getElementById('pp_td_toggle'));
  click(h.window, h.document.getElementById('pp_review'));
  click(h.window, h.document.getElementById('saveBtn'));
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  const cases = [
    ['PAT good', async h => {
      h.evalIn("renderPlayPanel('pat')");
      click(h.window, h.document.querySelector('.pp_kicker_pick'));
    }, 'none'],
    ['PAT missed', async h => {
      h.evalIn("renderPlayPanel('pat')");
      click(h.window, h.document.querySelector('.pp_kicker_pick'));
      click(h.window, h.document.querySelector('input[name=pp_patres][value=x]'));
    }, 'none'],
    ['PAT blocked', async h => {
      h.evalIn("renderPlayPanel('pat')");
      click(h.window, h.document.querySelector('.pp_kicker_pick'));
      click(h.window, h.document.getElementById('pp_pat_blocked_cb_toggle'));
    }, 'none'],
    ['2PT no good', async h => {
      h.evalIn("renderPlayPanel('twopt')");
      typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
      click(h.window, h.document.querySelector('input[name=pp_2pt_rush_res][value=x]'));
    }, 'none'],
    ['2PT fumbled, turned over', async h => {
      h.evalIn("renderPlayPanel('twopt')");
      typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
      click(h.window, h.document.querySelector('input[name=pp_2pt_rush_res][value=b]'));
    }, 'none'],
  ];

  for (const [label, setup, expected] of cases) {
    const h = await bootGamePage();
    await scoreATouchdown(h);
    await setup(h);
    click(h.window, h.document.getElementById('pp_review'));
    const row = h.document.getElementById('confirmClockRow');
    const actual = row ? row.style.display : 'MISSING';
    if (actual !== expected) {
      fail(label, 'expected confirmClockRow to be "' + expected + '", got "' + actual + '"');
    }
    h.close();
  }

  // --- Control: a safety does NOT follow a touchdown, and must keep
  // its clock prompt -- the exact distinction the original isTry
  // comment warned about, still holding after the widening above.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 3, distance: 8, side: 'own', yardline: 3 });
    h.evalIn("renderPlayPanel('rush')");
    typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
    typeInto(h.window, h.document.getElementById('pp_yards'), '-6');
    const safetyBtn = [...h.document.querySelectorAll('button')].find(b => /safety/i.test(b.textContent));
    if (safetyBtn) click(h.window, safetyBtn);
    click(h.window, h.document.getElementById('pp_review'));
    const row = h.document.getElementById('confirmClockRow');
    if (!row || row.style.display !== 'block') {
      fail('safety-control', 'a safety must still prompt for a clock -- got ' + (row ? row.style.display : 'MISSING'));
    }
    h.close();
  }

  // --- Control: the touchdown itself, immediately before the try,
  // must still prompt for a clock -- that is exactly the moment the
  // clock stops and the one entry a try is allowed to rely on.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 5 });
    h.evalIn("renderPlayPanel('rush')");
    typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
    typeInto(h.window, h.document.getElementById('pp_yards'), '5');
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.getElementById('pp_review'));
    const row = h.document.getElementById('confirmClockRow');
    if (!row || row.style.display !== 'block') {
      fail('touchdown-control', 'the touchdown itself must still prompt for a clock -- got ' + (row ? row.style.display : 'MISSING'));
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Try clock exemption (missed/blocked/turned-over) ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  every try outcome skips the clock prompt; safeties and touchdowns still require one.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
