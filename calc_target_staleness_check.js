// State parked on #playPanel must not outlive the panel that wrote it
// =============================================================================
// Reported from a live test game on 3 September 2026, after roughly 75 clean
// plays. 3rd & 7 at own 37, completed pass, calculator given "own 48". The
// readout said, in green:
//
//     from own 37 to own 48  =  +11
//
// and Review logged "pass to Wydell Clark Jr for no gain — 4th & 7". Undo and
// re-enter did the same. Typing 11 into the yards box by hand worked. Every
// play type behaved the same way from then on. RELOADING THE PAGE FIXED IT,
// and that is the symptom that names the fault: the bad state was in the
// document, not in the data.
//
// #playPanel is a PERSISTENT element -- closing a panel sets innerHTML = ''
// and leaves the div. The fake punt / fake field goal toggle writes
// `calcTarget` to its dataset so the shared calculator follows the fake's own
// yards box, and un-toggling was the only thing that ever put it back. Tick
// Fake, then press Clear or pick another play type, and calcTarget stayed
// 'pp_puntfake_yards' for the rest of the browser session.
//
// On every later rush or pass, yardsEl() then resolved an id that panel does
// not contain and got null. Every write in recompute() is guarded against a
// null yards box -- correctly, because the kickoff panel genuinely has none --
// so the gain was computed, the readout was painted, and the number went
// NOWHERE. pp_yards stayed empty and the parser read it as no gain.
//
// WHY THIS IS THE WORST SHAPE A BUG CAN TAKE HERE, and why it gets its own
// file: nothing on screen was wrong. The readout is the last line in
// recompute() and the only one not guarded, so it reported the right number
// while the play recorded the wrong one. A scorer checking their work saw
// +11. On a Friday night that is a wrong stat nobody catches.
//
// A SECOND FAULT OF THE SAME SHAPE, found while auditing for the first and
// not separately reported. panel.__spotCalc is set at the foot of
// wireSpotCalc -- but only on a panel that HAS a calculator, because of the
// early return above it. So a field goal, kickoff, PAT, 2PT, safety or fumble
// panel inherited the PREVIOUS panel's closure, holding elements that were
// detached when innerHTML was cleared.
//
// refreshSpotCalcContext() opens with a truthiness check on that property, and
// the interception touchdown auto-fill relies on it to keep the GENERIC
// auto-fill -- which writes the distance to the goal line into pp_yards --
// away from panels it does not suit. A stale closure is truthy, so the guard
// did not fire. On a field goal panel pp_yards is the KICK, so a 37-yard
// attempt from the opponent 20, blocked and returned for a touchdown, stored
// roles.kicker.yards = 20. The play text does not carry a blocked kick's
// distance, so nothing on screen said so.
//
// Both faults are the same mistake: #playPanel outlives its contents, so
// anything written to it has to be cleared where the panel is BUILT.
//
//   node tests/calc_target_staleness_check.js

const { bootGamePage } = require('./harness');
const { setDrive, click, typeInto } = require('./ui_driver');

let pass = 0, fail = 0;
const chk = (ok, m, detail) => {
  if (ok) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (detail ? '\n         ' + detail : '')); }
};

(async () => {
  console.log('=== State on #playPanel does not outlive its panel ===\n');

  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  const panel = () => doc.getElementById('playPanel');
  const clear = () => {
    const b = [...doc.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Clear');
    if (b) click(win, b);
  };

  // The exact play from the report: 3rd & 7 at own 37, pass, tackled on own 48.
  function passViaCalculator(){
    setDrive(h, { down: 3, distance: 7, side: 'own', yardline: 37 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    typeInto(win, doc.getElementById('pp_passer_manual'), '1');
    typeInto(win, doc.getElementById('pp_receiver_manual'), '4');
    const side = panel().querySelector('.calcSide[data-side="own"]');
    if (side && !side.classList.contains('picked')) click(win, side);
    typeInto(win, doc.getElementById('pp_calc_yardline'), '48');
    const yards = doc.getElementById('pp_yards');
    const readout = doc.getElementById('pp_calc_readout');
    const review = [...panel().querySelectorAll('button')]
      .find(b => /review play/i.test((b.textContent || '').trim()));
    click(win, review);
    const parsed = doc.getElementById('parsedText');
    return {
      yards:   yards ? yards.value : null,
      readout: (readout && readout.textContent || '').trim(),
      logged:  (parsed && parsed.textContent || '').trim()
    };
  }

  // ---- 1. the control, on a page nothing has poisoned ----------------------
  {
    const r = passViaCalculator();
    chk(r.readout.indexOf('+11') >= 0, 'the calculator works out +11 from own 37 to own 48', r.readout);
    chk(r.yards === '11', 'and writes it into the yards box', 'pp_yards = ' + JSON.stringify(r.yards));
    chk(/for 11\b/.test(r.logged), 'and the play logs as a gain of 11', r.logged);
    clear();
  }

  // ---- 2. poison it exactly as a scorer would ------------------------------
  // Not a contrived sequence: fourth down, reach for the punt panel, tick
  // Fake, change your mind. Nothing here is unusual and nothing warns.
  {
    setDrive(h, { down: 4, distance: 7, side: 'own', yardline: 37 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    click(win, panel().querySelector('.pp_punter_pick[data-num="15"]'));
    const toggle = doc.getElementById('pp_punt_fake_toggle');
    chk(!!toggle, 'the punt panel offers a Fake control');
    click(win, toggle);
    chk(panel().dataset.calcTarget === 'pp_puntfake_yards',
        'ticking Fake retargets the calculator at the fake’s own yards box',
        JSON.stringify(panel().dataset.calcTarget));
    // AND THE CALCULATOR REALLY DOES FILL THAT BOX. The whole retarget exists
    // for this; a fix that cleared the dataset too eagerly would pass every
    // check below and silently break the feature.
    typeInto(win, doc.getElementById('pp_carrier_manual'), '3');
    const side = panel().querySelector('.calcSide[data-side="own"]');
    if (side && !side.classList.contains('picked')) click(win, side);
    typeInto(win, doc.getElementById('pp_calc_yardline'), '48');
    const fakeBox = doc.getElementById('pp_puntfake_yards');
    chk(fakeBox && fakeBox.value === '11',
        'and the calculator fills the FAKE’s box, not the kick’s',
        'pp_puntfake_yards = ' + JSON.stringify(fakeBox && fakeBox.value) +
        ', pp_yards = ' + JSON.stringify((doc.getElementById('pp_yards') || {}).value));
    clear();   // abandoned WITHOUT un-ticking, which is the whole bug
  }

  // ---- 3. the same play again ----------------------------------------------
  {
    const r = passViaCalculator();
    // THE ASSERTION THAT MATTERS IS THE LOGGED PLAY, not the yards box.
    // The box is the mechanism; "no gain" is what the scorer reported and
    // what a coach would have to live with.
    chk(/for 11\b/.test(r.logged),
        'after an abandoned fake punt, the same play STILL logs as a gain of 11',
        'logged: ' + r.logged);
    chk(r.yards === '11', 'and the yards box still receives the number',
        'pp_yards = ' + JSON.stringify(r.yards));
    chk(!/no gain/i.test(r.logged), 'and is not recorded as no gain', r.logged);
    // THE READOUT AND THE PLAY AGREE. This is the property the whole file is
    // about: it is not enough that both are right, they must not be able to
    // disagree -- a readout that reports a number the play did not receive is
    // the failure, whatever the number.
    const shown = /=\s*\+?(-?\d+)/.exec(r.readout);
    chk(shown && r.yards === String(Math.abs(+shown[1])),
        'the number on screen and the number recorded are the same number',
        'readout ' + JSON.stringify(r.readout) + ' vs pp_yards ' + JSON.stringify(r.yards));
    clear();
  }

  // ---- 4. a stale target from ANY source is survivable ---------------------
  // The delete at wire time is the fix; this is the second half of it. Set
  // the dataset by hand to an id that is not in the panel -- standing in for
  // whatever future path leaves one behind -- and the calculator must still
  // find the real box rather than writing into nothing.
  {
    panel().dataset.calcTarget = 'pp_some_box_that_does_not_exist';
    const r = passViaCalculator();
    chk(r.yards === '11',
        'a calcTarget naming a box this panel does not have falls back to pp_yards',
        'pp_yards = ' + JSON.stringify(r.yards));
    chk(/for 11\b/.test(r.logged), 'so the play still logs the gain', r.logged);
    clear();
  }

  // ---- 5. and the fix is shown to be doing the work -------------------------
  // Every check above passes on a page where calcTarget was never stale, so
  // none of them proves the fix is present. This re-poisons the dataset the
  // way the bug did AND defeats the fallback -- by pointing at a box that
  // really does exist somewhere on the page but is not this panel's -- then
  // asserts the wire-time delete cleans it up. Without that delete the value
  // survives the panel rebuild and this fails.
  {
    // pp_code is a real, always-present element that is not a yards box.
    panel().dataset.calcTarget = 'code';
    chk(!!doc.getElementById('code'),
        'the stand-in target really is on the page, so the fallback cannot rescue this');
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 20 });
    click(win, doc.querySelector('.ptypeBtn[data-type="rush"]'));
    chk(panel().dataset.calcTarget === undefined || panel().dataset.calcTarget === '',
        'building a panel clears any retarget the previous one left behind',
        'calcTarget = ' + JSON.stringify(panel().dataset.calcTarget));
    clear();
  }

  // ---- 6. the closure on the same element, same fault ---------------------
  // A field goal panel has no calculator of its own, so wireSpotCalc returns
  // early and never sets __spotCalc. On a persistent #playPanel that used to
  // mean it kept the LAST panel's -- and a truthy one defeats the guard that
  // keeps the generic touchdown auto-fill off this panel.
  {
    // Poison it the way an ordinary game does: any rush, pass or punt.
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 41 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    chk(!!panel().__spotCalc, 'a pass panel installs a spot calculator');
    clear();

    // A 37-yard attempt from the opponent 20.
    setDrive(h, { down: 4, distance: 6, side: 'opp', yardline: 20 });
    click(win, doc.querySelector('.ptypeBtn[data-type="fg"]'));
    chk(!doc.getElementById('pp_calc_wrap'),
        'a field goal panel has no shared calculator of its own');
    chk(!panel().__spotCalc,
        'so it must not be carrying the previous panel\u2019s closure');

    click(win, panel().querySelector('.pp_kicker_pick[data-num="3"]'));
    typeInto(win, doc.getElementById('pp_yards'), '37');
    // Blocked is what reveals this panel's Touchdown toggle -- the only route
    // to it, and the one that made the fault reachable.
    const blk = doc.getElementById('pp_fg_blocked_cb_toggle') ||
                doc.getElementById('pp_fg_blocked_cb');
    click(win, blk);
    chk((doc.getElementById('pp_fg_td_wrap') || {}).style.display === 'block',
        'ticking Blocked reveals the touchdown toggle, which is how this is reached');
    click(win, doc.getElementById('pp_td_toggle'));

    const review = [...panel().querySelectorAll('button')]
      .find(b => /review play/i.test((b.textContent || '').trim()));
    click(win, review);
    const stored = h.evalIn('(typeof pending!=="undefined" && pending && pending.roles && ' +
      'pending.roles.kicker) ? pending.roles.kicker.yards : "none"');
    // THE STORED VALUE, not the box. The play text does not carry a blocked
    // kick's distance, so the box is the only place this was ever visible and
    // the record is the only place it matters.
    chk(stored === 37,
        'the blocked kick stores the distance that was entered, not the distance to the goal line',
        'roles.kicker.yards = ' + JSON.stringify(stored) + ' (37 entered, 20 is the fault)');
    clear();
  }

  h.close();
  console.log('\n' + pass + '/' + (pass + fail) + ' checks pass');
  if (fail) process.exit(1);
})().catch(e => { console.error('THREW ' + (e && e.stack || e)); process.exit(2); });
