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

const { bootGamePage, DEFAULT_GAME } = require('./harness');
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

    if (labelOf() !== 'Or enter tackled on') fail('label', 'default label is "' + labelOf() + '"');

    click(h.window, h.document.getElementById('pp_rush_fumbled_toggle'));
    if (labelOf() !== 'Or enter ball came loose on') {
      fail('label', 'a fumble should relabel the calculator, got "' + labelOf() + '"');
    }
    click(h.window, h.document.getElementById('pp_rush_fumbled_toggle'));

    click(h.window, h.document.getElementById('pp_td_toggle'));
    if (wrap.style.display !== 'none') {
      fail('touchdown', 'the calculator should be hidden on a touchdown — the spot is the goal line');
    }
    // ...and the one possible gain should be filled in, not left to be
    // worked out from the far end of the field.
    const tdYards = h.document.getElementById('pp_yards');
    if (tdYards.value !== '75') {   // from own 25
      fail('touchdown', 'a touchdown from own 25 is 75 yards, box reads "' + tdYards.value + '"');
    }
    if (!tdYards.disabled) {
      fail('touchdown', 'the yards box should be locked while the touchdown is ticked');
    }
    click(h.window, h.document.getElementById('pp_td_toggle'));
    if (wrap.style.display === 'none') {
      fail('touchdown', 'clearing the touchdown should bring the calculator back');
    }
    if (h.document.getElementById('pp_yards').disabled) {
      fail('touchdown', 'clearing the touchdown should release the yards box');
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

  // --- the punt panel ------------------------------------------------
  // Punt distance is the same subtraction, read from where the ball came
  // down. Two outcomes make that meaningless and must say so rather than
  // leaving a stale sum on screen beside a hidden calculator.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 4, distance: 9, side: 'own', yardline: 30 });
    click(h.window, h.document.querySelector('.ptypeBtn[data-type="punt"]'));
    const panel = h.document.getElementById('playPanel');
    click(h.window, panel.querySelector('.pp_punter_pick[data-num="15"]'));

    click(h.window, panel.querySelector('.calcSide[data-side="opp"]'));
    typeInto(h.window, h.document.getElementById('pp_calc_yardline'), '28');
    if (h.document.getElementById('pp_yards').value !== '42') {
      fail('punt', 'own 30 to opp 28 is a 42-yard punt, got "' +
           h.document.getElementById('pp_yards').value + '"');
    }

    const readout = h.document.getElementById('pp_calc_readout');
    click(h.window, h.document.getElementById('pp_punt_touchback_toggle'));
    if (readout.textContent.indexOf('Touchback') === -1) {
      fail('punt', 'a touchback should explain why there is nothing to compute, shows "' +
           readout.textContent + '"');
    }
    click(h.window, h.document.getElementById('pp_punt_touchback_toggle'));

    click(h.window, h.document.getElementById('pp_blocked_toggle'));
    if (readout.textContent.indexOf('Blocked') === -1) {
      fail('punt', 'a block should explain why there is nothing to compute, shows "' +
           readout.textContent + '"');
    }
    h.close();
  }

  // --- THE CALCULATOR FOLLOWS A FAKE ------------------------------------
  // Added 14 Aug 2026. A fake punt or fake field goal is a rush or a pass
  // with its own yardage, and it was the one scrimmage-shaped play in the
  // app with no calculator: the kick's own was hidden when the fake
  // opened, on the reasoning that it measures where a kick came down.
  //
  // Retargeted rather than duplicated -- a second calculator on the panel
  // would need its own ids and wiring, and two of them could disagree.
  // The assertions below are mostly about that: the RIGHT box gets the
  // answer and the other stays empty, in both directions.
  {
    const { typeInto } = require('./ui_driver');
    const openFake = async () => {
      const h = await bootGamePage();
      const { window: win, document: doc } = h;
      setDrive(h, { down: 4, distance: 6, side: 'own', yardline: 30 });
      click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
      typeInto(win, doc.getElementById('pp_punter_manual'), '15');
      click(win, doc.getElementById('pp_punt_fake_toggle'));
      return h;
    };

    // A gain: own 30 to own 41 is +11, into the FAKE's yards box.
    {
      const h = await openFake();
      const { window: win, document: doc } = h;
      const calc = doc.getElementById('pp_calc_wrap');
      if (!calc || calc.style.display === 'none'){
        fail('fake calculator', 'the yardage calculator is not available on a fake — it is a ' +
             'rush or a pass like any other, and working out "tackled on the 41" is exactly ' +
             'as useful here');
      }
      // ...and it has to be WHERE the fake is. Retargeting alone left it
      // sitting in the kick panel's own layout, three sections above the
      // box it was filling -- correct arithmetic attached to the wrong
      // part of the screen. It belongs beside the fake's yards box, the
      // same as on a rush or a pass.
      const fakeBox = doc.getElementById('pp_puntfake_box');
      if (calc && fakeBox && !fakeBox.contains(calc)){
        fail('fake calculator', 'the calculator is not inside the fake block — it fills the ' +
             'fake\'s yards box while sitting somewhere else on the panel');
      }
      typeInto(win, doc.getElementById('pp_carrier_manual'), '22');
      click(win, doc.querySelector('.calcSide[data-side="own"]'));
      typeInto(win, doc.getElementById('pp_calc_yardline'), '41');
      const fakeYds = doc.getElementById('pp_puntfake_yards').value;
      const kickYds = doc.getElementById('pp_yards').value;
      if (fakeYds !== '11'){
        fail('fake calculator', 'tackled on own 41 from own 30 should be 11 in the fake\'s ' +
             'yards box, got ' + JSON.stringify(fakeYds));
      }
      if (kickYds){
        fail('fake calculator', 'the KICK distance box was filled instead of, or as well as, ' +
             'the fake\'s: ' + JSON.stringify(kickYds) + '. One calculator, one target');
      }
      click(win, doc.getElementById('pp_review'));
      click(win, doc.getElementById('saveBtn'));
      const saved = h.db.plays[h.db.plays.length - 1];
      if (!/FAKE PUNT/.test(saved.text) || !/for 11/.test(saved.text)){
        fail('fake calculator', 'the saved play does not carry the worked-out yardage: ' + saved.text);
      }
      h.close();
    }

    // A loss: own 30 back to own 26. The sign comes out of the
    // arithmetic, so LOSS must be set for us -- a coach setting it as
    // well would double-negate.
    {
      const h = await openFake();
      const { window: win, document: doc } = h;
      typeInto(win, doc.getElementById('pp_carrier_manual'), '22');
      click(win, doc.querySelector('.calcSide[data-side="own"]'));
      typeInto(win, doc.getElementById('pp_calc_yardline'), '26');
      const loss = doc.querySelector('.lossToggle[data-for="pp_puntfake_yards"]');
      if (doc.getElementById('pp_puntfake_yards').value !== '4'){
        fail('fake calculator', 'a 4-yard loss should read 4 with LOSS set, got ' +
             JSON.stringify(doc.getElementById('pp_puntfake_yards').value));
      }
      if (!loss || !loss.classList.contains('picked')){
        fail('fake calculator', 'LOSS was not set by the calculator on a losing fake — the ' +
             'sign comes out of the arithmetic, and leaving it to the coach double-negates');
      }
      h.close();
    }

    // Toggling the fake back OFF returns the calculator to the kick.
    {
      const h = await openFake();
      const { window: win, document: doc } = h;
      click(win, doc.getElementById('pp_punt_fake_toggle'));
      click(win, doc.querySelector('.calcSide[data-side="opp"]'));
      typeInto(win, doc.getElementById('pp_calc_yardline'), '28');
      if (!doc.getElementById('pp_yards').value){
        fail('fake calculator', 'after un-toggling the fake the calculator no longer fills the ' +
             'punt distance — it stayed pointed at a box that is now hidden');
      }
      if (doc.getElementById('pp_puntfake_yards').value){
        fail('fake calculator', 'the fake\'s yards box was still being filled after the fake ' +
             'was turned off');
      }
      // And it must go HOME, not merely leave the fake box: appending it
      // to the end of the panel would satisfy "not inside the fake" while
      // leaving the punt panel visibly rearranged.
      const box = doc.getElementById('pp_puntfake_box');
      const calcBack = doc.getElementById('pp_calc_wrap');
      if (box && calcBack && box.contains(calcBack)){
        fail('fake calculator', 'the calculator stayed in the fake block after the fake was ' +
             'turned off');
      }
      const yardsRow = doc.getElementById('pp_yards');
      if (calcBack && yardsRow && calcBack.parentNode !== yardsRow.closest('div').parentNode){
        fail('fake calculator', 'the calculator did not return to its place beside the punt ' +
             'distance box');
      }
      h.close();
    }
  }

  // TEAM-NAME BUTTONS MUST NOT WRAP. The calculator's two side buttons
  // carry a school name, and a two-word one broke across two lines --
  // that button became taller than the one beside it and knocked the row
  // out of alignment. Reported with "West Monroe".
  {
    const game = Object.assign({}, DEFAULT_GAME, {
      our_team_is_home: true, home_team_name: 'Neville', away_team_name: 'West Monroe' });
    const h = await bootGamePage({ game });
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    for (const type of ['rush', 'pass']) {
      click(win, doc.querySelector('.ptypeBtn[data-type="' + type + '"]'));
      const sides = [...doc.querySelectorAll('#playPanel .calcSide')];
      if (sides.length !== 2) { fail('calc:' + type, 'expected two side buttons, got ' + sides.length); continue; }
      sides.forEach(b => {
        const c = win.getComputedStyle(b);
        if (c.whiteSpace !== 'nowrap') {
          fail('calc:' + type + ':wrap', JSON.stringify(b.textContent.trim()) + ' can wrap onto two lines');
        }
      });
      // Both buttons the same size as each other -- the wrap showed up as
      // one being taller, so equal styling is the thing to hold.
      const a = win.getComputedStyle(sides[0]), b2 = win.getComputedStyle(sides[1]);
      if (a.fontSize !== b2.fontSize || a.padding !== b2.padding) {
        fail('calc:' + type + ':uneven', 'the two side buttons should be styled alike');
      }
      // Sizing must come from the stylesheet: it was inline, which beats a
      // rule, so the nowrap fix applied and the smaller text that makes
      // room for it did not.
      if (/font-size/.test(sides[0].getAttribute('style') || '')) {
        fail('calc:' + type + ':inline', 'font-size should not be inline on the side buttons');
      }
    }
    h.close();
  }

  // THE FAKE FIELD GOAL HAS ITS OWN CALCULATOR, and it must not touch the
  // kick distance.
  // ---------------------------------------------------------------------
  // A fake is a rush or a pass, so working out "tackled on the 18" is as
  // useful here as anywhere -- but the field goal panel had no calculator
  // at all, because a kick that is not faked has nothing to calculate.
  //
  // Sharing the panel's pp_calc_wrap was tried first and reverted the same
  // day: its resting target is pp_yards, which on THIS panel is the kick
  // distance, and merely wiring it there turned a blocked kick's 44 yards
  // into the 60-yard return. The golden snapshot caught it. This asserts
  // both halves -- the calculator works, and the kick distance does not
  // move.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 4, distance: 3, side: 'opp', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="fg"]'));
    click(win, doc.querySelector('.pp_kicker_pick'));
    typeInto(win, doc.getElementById('pp_yards'), '44');
    click(win, doc.getElementById('pp_fg_fake_toggle'));
    await new Promise(r => setTimeout(r, 150));

    const calc = doc.getElementById('pp_fgcalc_wrap');
    if (!calc) { fail('fgfakecalc', 'the fake field goal has no calculator'); h.close(); return failures; }
    // ITS OWN, not the shared one. If pp_calc_wrap appears on this panel
    // the old collision is back.
    if (doc.getElementById('pp_calc_wrap')) {
      fail('fgfakecalc:shared', 'the fake must not use the shared calculator on a field goal panel');
    }
    click(win, doc.querySelector('#pp_fgcalc_wrap .calcSide[data-side="opp"]'));
    typeInto(win, doc.getElementById('pp_fgcalc_yardline'), '18');
    await new Promise(r => setTimeout(r, 150));
    const got = (doc.getElementById('pp_fgfake_yards') || {}).value;
    if (got !== '7') fail('fgfakecalc:value', 'opp 25 to opp 18 is +7, got ' + JSON.stringify(got));
    // THE ONE THAT MATTERS.
    const kick = (doc.getElementById('pp_yards') || {}).value;
    if (kick !== '44') {
      fail('fgfakecalc:kick', 'the kick distance must not move, got ' + JSON.stringify(kick));
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
