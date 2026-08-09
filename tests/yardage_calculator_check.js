// Yardage calculator checks
// -------------------------
// The rush and pass panels let a gain be entered either as a number of
// yards or as the spot the runner was tackled on. The second form exists
// because a coach reads the field, not arithmetic -- and because the
// arithmetic is the part that goes wrong on the plays that matter most.
//
// fieldPos is possession-relative (0 = own goal, 100 = opponent's goal),
// so a gain is simply newFieldPos - currentFieldPos. That is why a play
// crossing midfield needs no special case: own 20 to opp 20 is
// 80 - 20 = 60. What it DOES need is the side, because "the 20" names two
// different places on the field, and guessing which one is meant fails on
// exactly the long plays this feature is for.
//
// The interaction rules matter as much as the sum:
//   - the current side is pre-selected, so a short gain is one number
//   - a negative result drives LOSS automatically; both being settable
//     would double-negate, the same trap as typing "-5" and tapping LOSS
//   - typing yards directly clears the calculator, so the two inputs can
//     never describe the same play differently
//   - a touchdown hides it: the spot is the goal line by definition
//   - a fumble relabels it, because the spot is where the ball came
//     loose, not where anyone was tackled

const { bootGamePage } = require('./harness');
const { setDrive, click, typeInto } = require('./ui_driver');

async function openRush(startSide, startYardline) {
  const h = await bootGamePage();
  setDrive(h, { down: 1, distance: 10, side: startSide, yardline: startYardline });
  click(h.window, h.document.querySelector('.ptypeBtn[data-type="rush"]'));
  typeInto(h.window, h.document.getElementById('pp_carrier_manual'), '22');
  return h;
}

function tackledOn(h, side, yardline) {
  const panel = h.document.getElementById('playPanel');
  click(h.window, panel.querySelector('.calcSide[data-side="' + side + '"]'));
  typeInto(h.window, h.document.getElementById('pp_calc_yardline'), yardline);
}

// start side/yardline, tackled side/yardline, expected gain, expected LOSS
const SUMS = [
  ['own', 20, 'opp', '20',  60, false],   // the crossing case
  ['own', 25, 'own', '33',   8, false],
  ['own', 30, 'own', '26',  -4, true],    // a loss, sign derived
  ['opp', 40, 'opp', '12',  28, false],   // both spots past midfield
  ['own', 45, 'opp', '38',  17, false],   // crossing by a short gain
  ['opp', 30, 'own', '48', -22, true]     // crossing backwards
];

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- the arithmetic ------------------------------------------------
  for (const [sSide, sYl, tSide, tYl, expected, expectLoss] of SUMS) {
    const label = sSide + ' ' + sYl + ' -> ' + tSide + ' ' + tYl;
    const h = await openRush(sSide, sYl);
    tackledOn(h, tSide, tYl);
    const yards = h.document.getElementById('pp_yards').value;
    const lossOn = h.document.getElementById('playPanel')
      .querySelector('.lossToggle').classList.contains('picked');
    if (yards !== String(Math.abs(expected))) {
      fail(label, 'expected ' + Math.abs(expected) + ' yards, got "' + yards + '"');
    }
    if (lossOn !== expectLoss) {
      fail(label, 'LOSS should be ' + (expectLoss ? 'on' : 'off') + ' for a gain of ' + expected);
    }
    h.close();
  }

  // --- the sum survives into the saved play --------------------------
  {
    const h = await openRush('own', 20);
    tackledOn(h, 'opp', '20');
    click(h.window, h.document.getElementById('pp_review'));
    const text = h.document.getElementById('parsedText').textContent;
    click(h.window, h.document.getElementById('saveBtn'));
    const banner = h.document.getElementById('downText').textContent;
    if (text.indexOf('rush for 60') === -1) {
      fail('save', 'expected a 60-yard rush, parsed as "' + text + '"');
    }
    if (banner.indexOf('opp 20') === -1) {
      fail('save', 'ball should finish on the opponent 20, banner reads "' + banner + '"');
    }
    h.close();
  }

  // --- typing yards directly clears the calculator -------------------
  {
    const h = await openRush('own', 25);
    tackledOn(h, 'own', '40');
    const yardsEl = h.document.getElementById('pp_yards');
    // The calculator disables the yards box while it owns the value;
    // clearing the yard line has to hand control back.
    typeInto(h.window, h.document.getElementById('pp_calc_yardline'), '');
    if (yardsEl.disabled) {
      fail('handback', 'clearing the yard line left the yards box locked');
    }
    h.close();
  }

  // --- touchdown hides it, fumble relabels it ------------------------
  {
    const h = await openRush('own', 25);
    const wrap = h.document.getElementById('pp_calc_wrap');
    const labelOf = () => wrap.querySelector('p').textContent;

    if (labelOf() !== 'or tackled on') fail('label', 'default label is "' + labelOf() + '"');

    click(h.window, h.document.getElementById('pp_rush_fumbled_toggle'));
    if (labelOf() !== 'or ball came loose on') {
      fail('label', 'a fumble should relabel the calculator, got "' + labelOf() + '"');
    }
    click(h.window, h.document.getElementById('pp_rush_fumbled_toggle'));

    click(h.window, h.document.getElementById('pp_td_toggle'));
    if (wrap.style.display !== 'none') {
      fail('touchdown', 'the calculator should be hidden on a touchdown — the spot is the goal line');
    }
    click(h.window, h.document.getElementById('pp_td_toggle'));
    if (wrap.style.display === 'none') {
      fail('touchdown', 'clearing the touchdown should bring the calculator back');
    }
    h.close();
  }

  // --- no known spot means nothing to subtract from ------------------
  {
    const h = await bootGamePage();
    click(h.window, h.document.querySelector('.ptypeBtn[data-type="rush"]'));
    const readout = h.document.getElementById('pp_calc_readout');
    if (readout.textContent.indexOf('Spot not set') === -1) {
      fail('no spot', 'with no field position the calculator should say so, shows "' +
           readout.textContent + '"');
    }
    if (!h.document.getElementById('pp_calc_yardline').disabled) {
      fail('no spot', 'the yard line input should be disabled with no field position');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Yardage calculator checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  spots convert to yardage correctly, including across midfield.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
