// Whitelist the expected controls, everywhere else
// ------------------------------------------------
// The fake punt / fake field goal panels produced FOUR round trips in a
// row, each report naming one stray control that should have been
// hidden. Every fix hid exactly the one named, which is a BLACKLIST: it
// cannot converge, because nothing in the code knows the complete set.
//
// Inverting it — assert what may REMAIN, fail on anything else — found a
// fifth stray immediately. This applies that pattern to the other four
// places the app hides controls by enumeration, listed in TODO section 7.
//
// THE KNOWN BLIND SPOT, learned the hard way: a whitelist catches
// controls nobody thought about; it CANNOT catch one that was thought
// about and filed under the wrong heading. The fake-punt whitelist
// passed while "Returned by (optional)" sat at the foot of every fake,
// because its controls are `pp_credit_*` and those had been annotated
// "who made the tackle" — true on a rush panel, wrong on a punt panel.
//
// So the ALLOWED lists below were built by reading what each control
// actually is on that specific panel, not by inferring from its id.

const { bootGamePage } = require('./harness');
const { setDrive, click } = require('./ui_driver');

// Everything live inside an element, ignoring anything hidden by an
// ancestor. Buttons and inputs only — labels and text do no harm.
function liveControls(page, rootId) {
  const root = page.document.getElementById(rootId) || page.document.body;
  const visible = el => {
    let e = el;
    while (e && e !== root) {
      if (e.style && e.style.display === 'none') return false;
      e = e.parentElement;
    }
    return true;
  };
  return [...new Set([...root.querySelectorAll('input,button,select')]
    .filter(e => e.type !== 'hidden' && visible(e) && !e.disabled)
    .map(e => e.id || ('.' + String(e.className || '?').split(' ')[0])))];
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // === 1. PHASE GATING AFTER A SCORE ===================================
  // Only a kickoff may be offered after the try. This is currently
  // enforced by enumerating which play types to disable, so a play type
  // added later would be live by default — the exact drift a whitelist
  // prevents.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 6 });
    const { enterPlay } = require('./ui_driver');
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6', td: true });
    enterPlay(h, { type: 'pat', kicker: '3', result: 'g' });

    const live = [...doc.querySelectorAll('.ptypeBtn')]
      .filter(b => !b.disabled).map(b => b.dataset.type);
    const ALLOWED = ['kickoff'];
    const unexpected = live.filter(t => !ALLOWED.includes(t));
    if (unexpected.length) {
      fail('phase gating', 'after the try these play types are still ' +
           'offerable: ' + unexpected.join(', ') + '. Only a kickoff can ' +
           'legally follow — anything else lets a scorer enter a play that ' +
           'never happened');
    }
    if (!live.includes('kickoff')) {
      fail('phase gating', 'the kickoff is NOT offerable after a try, so ' +
           'the game cannot continue');
    }
    h.close();
  }

  // === 2. THE GUIDED KICKOFF FLOW ======================================
  // Touchback, muffed and onside each hide a different set of fields.
  // Ticking one must clear the others, or two mutually exclusive
  // outcomes can be submitted together.
  {
    const h = await bootGamePage({ game: { game_phase: 'notStarted' } });
    const { window: win, document: doc } = h;
    const { typeInto } = require('./ui_driver');
    click(win, doc.getElementById('startGameBtn'));
    click(win, doc.getElementById('pickA'));
    typeInto(win, doc.getElementById('gk_kicker_manual'), '3');
    click(win, doc.getElementById('guidedKickoffSave'));

    // Exclusivity: these three outcomes cannot coexist.
    const EXCLUSIVE = ['gr_touchback_toggle', 'gr_muffed_toggle', 'gr_onside_toggle', 'gr_oob_toggle'];
    const present = EXCLUSIVE.filter(id => doc.getElementById(id));
    for (const id of present) {
      // Reset, then tick this one.
      present.forEach(other => {
        const cb = doc.getElementById(other.replace('_toggle', ''));
        if (cb && cb.checked) click(win, doc.getElementById(other));
      });
      click(win, doc.getElementById(id));
      const alsoOn = present.filter(other => other !== id &&
        (doc.getElementById(other.replace('_toggle', '')) || {}).checked);
      if (alsoOn.length) {
        fail('guided kickoff', 'ticking ' + id + ' left ' + alsoOn.join(', ') +
             ' also ticked. A kickoff cannot be a touchback AND a muff AND ' +
             'an onside kick — whichever the engine reads first wins, ' +
             'silently');
      }
    }
    h.close();
  }

  // === 3. CORRECTION MODE ==============================================
  // Delete controls must not exist outside it. They delete plays from a
  // finished game, which is the least reversible action in the app.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    const { enterPlay } = require('./ui_driver');
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '5' });

    const deleteControls = [...doc.querySelectorAll('button')]
      .filter(b => /delete/i.test(b.textContent) && b.offsetParent !== null);
    if (deleteControls.length) {
      fail('correction mode', deleteControls.length + ' Delete control(s) ' +
           'are visible OUTSIDE correction mode: "' +
           deleteControls.map(b => b.textContent.trim()).join('", "') +
           '". Deleting a play mid-game should require deliberately ' +
           'entering correction mode');
    }
    h.close();
  }

  // === 4. THE PUNT AND KICKOFF OUTCOME TOGGLES =========================
  // Each outcome hides a different set of fields, by enumeration. The
  // failure is not a crash: it is a spot field left on screen for an
  // outcome that has no spot, so a scorer fills it in and it is ignored.
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector('.pp_punter_pick[data-num="15"]'));

    // A TOUCHBACK must PRE-FILL the spot, not hide it.
    //
    // My first version of this asserted the spot field should be hidden,
    // on the reasoning that a touchback's spot is fixed at the 20. Wrong:
    // the field is shown, pre-filled with own 20, and left editable --
    // the same pattern as a missed field goal, so a scorer can correct it
    // when the ball is downed short. The app was right and the test was
    // asserting a football assumption I had not checked.
    const tb = doc.getElementById('pp_punt_touchback_toggle');
    if (tb) {
      click(win, tb);
      const yl = doc.getElementById('pp_spot_yardline');
      const side = [...panel.querySelectorAll('.pp_spot_side')]
        .find(b => b.classList.contains('picked'));
      if (!yl || yl.value !== '20') {
        fail('punt outcomes', 'a TOUCHBACK does not pre-fill the spot with 20 ' +
             '(got "' + (yl ? yl.value : 'no field') + '"). The scorer would ' +
             'have to type a value that is fixed by rule');
      }
      if (!side || side.dataset.side !== 'own') {
        fail('punt outcomes', 'a TOUCHBACK does not pre-select the receiving ' +
             'team\'s own side of the field');
      }
      // ...and it must still be editable, for a ball downed short.
      if (yl && yl.disabled) {
        fail('punt outcomes', 'the touchback spot is locked. It is a default, ' +
             'not a rule — a punt downed at the 8 must be correctable');
      }
      click(win, tb);
    }

    // BLOCKED and MUFFED each open their own section, and must not both
    // be open at once -- two different sets of spot fields would be
    // asking for the same yard line.
    const blk = doc.getElementById('pp_blocked_toggle');
    const muf = doc.getElementById('pp_muffed_toggle');
    // BOTH ORDERS. Clicking blocked-then-muffed only exercises MUFFED's
    // handler; the clearing could be missing from the other one and the
    // test would pass. Removing the clear from `pp_blocked` survived a
    // one-order version of this check.
    if (blk && muf) {
      for (const [first, second, label] of
           [[blk, muf, 'blocked then muffed'], [muf, blk, 'muffed then blocked']]) {
        // Reset both.
        ['pp_blocked', 'pp_muffed'].forEach(id => {
          const cb = doc.getElementById(id);
          if (cb && cb.checked) click(win, doc.getElementById(id + '_toggle'));
        });
        click(win, first);
        click(win, second);
        const bothOpen =
          doc.getElementById('pp_punt_blocked').style.display !== 'none' &&
          doc.getElementById('pp_punt_muffed').style.display !== 'none';
        if (bothOpen) {
          fail('punt outcomes', label + ': both sections are open at once. ' +
               'Each carries its own spot field, so the scorer is asked for ' +
               'the same yard line twice and only one is read');
        }
      }
    }

    h.close();
  }

  // --- KICKOFF OUTCOMES ON THE PLAY PANEL -------------------------------
  // Four now, since Out of bounds landed on 13 Aug 2026. Two separate
  // things are checked, and the second is the one that had a live bug.
  //
  // 1. EXCLUSIVITY of the underlying checkboxes.
  // 2. THE BUTTON MUST AGREE WITH THE CHECKBOX. Clearing another outcome
  //    set its hidden checkbox to false but never repainted the button,
  //    because the paint lives in the click handler. So picking Onside
  //    after Touchback left "✓ Touchback" lit in gold beside "✓ Onside
  //    kick" — two outcomes apparently selected, one of them a lie, and
  //    the saved play silently followed the checkbox rather than the tick
  //    the scorer could see.
  //
  // Tested in BOTH orders. One order only exercises one handler, which is
  // the lesson already recorded for the punt toggles below.
  {
    const { typeInto } = require('./ui_driver');
    const OUTCOMES = ['pp_ko_touchback', 'pp_ko_muffed', 'pp_ko_onside', 'pp_ko_oob'];
    const pairs = [];
    OUTCOMES.forEach(a => OUTCOMES.forEach(b => { if (a !== b) pairs.push([a, b]); }));

    for (const [first, second] of pairs){
      const h = await bootGamePage();
      const { window: win, document: doc } = h;
      setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
      click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
      if (!doc.getElementById(first + '_toggle') || !doc.getElementById(second + '_toggle')){
        h.close();
        fail('kickoff outcomes', 'expected all four outcome toggles on the kickoff panel; ' +
             first + ' or ' + second + ' is missing');
        break;
      }
      click(win, doc.getElementById(first + '_toggle'));
      click(win, doc.getElementById(second + '_toggle'));

      const checked = OUTCOMES.filter(o => (doc.getElementById(o) || {}).checked);
      if (checked.length !== 1 || checked[0] !== second){
        fail('kickoff outcomes', first + ' then ' + second + ': checkboxes on = ' +
             (checked.join(', ') || 'none') + ', expected only ' + second);
      }
      // The visible state has to match. A tick left behind on a cleared
      // outcome is worse than a wrong value, because it looks deliberate.
      OUTCOMES.forEach(o => {
        const btn = doc.getElementById(o + '_toggle');
        const cb = doc.getElementById(o);
        if (!btn || !cb) return;
        const ticked = /\u2713/.test(btn.textContent);
        if (ticked !== !!cb.checked){
          fail('kickoff outcomes', first + ' then ' + second + ': ' + o + ' button reads ' +
               JSON.stringify(btn.textContent.trim()) + ' but its checkbox is ' +
               (cb.checked ? 'ON' : 'OFF') + ' — the button and the value disagree, and ' +
               'the saved play follows the value');
        }
      });
      h.close();
    }
  }

  // --- OUT OF BOUNDS ----------------------------------------------------
  // NFHS gives the receiving team the ball at their own 35. Nobody
  // touched it, so there is no returner and no return yardage, and the
  // spot is fixed by rule rather than asked for.
  {
    const { typeInto, finish } = require('./ui_driver');
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    typeInto(win, doc.getElementById('pp_kicker_manual'), '3');
    // Touchback first, so switching to Out of bounds has to MOVE the
    // prefilled 20 to a 35. Leaving the 20 would save a spot the scorer
    // never chose and could not see was wrong.
    click(win, doc.getElementById('pp_ko_touchback_toggle'));
    click(win, doc.getElementById('pp_ko_oob_toggle'));

    const yl = doc.getElementById('pp_spot_yardline');
    if (!yl || yl.value !== '35'){
      fail('kickoff out of bounds', 'the takeover spot should be pre-filled to the ' +
           'receiving team\'s own 35, got ' + JSON.stringify(yl ? yl.value : null) +
           ' — switching from Touchback must move the 20, not keep it');
    }
    const side = doc.querySelector('.pp_spot_side.picked');
    if (!side || side.dataset.side !== 'own'){
      fail('kickoff out of bounds', 'the spot side should be the receiving team\'s own half');
    }
    const shown = (id) => { const e = doc.getElementById(id); return e && e.style.display !== 'none'; };
    if (shown('pp_ko_ret_wrap') || shown('pp_ret_yds_wrap')){
      fail('kickoff out of bounds', 'returner or return-yards fields are still on screen — ' +
           'nobody touched the ball, so there is no return to record');
    }

    click(win, doc.getElementById('pp_review'));
    finish(h, {});
    const text = JSON.parse(h.evalIn('JSON.stringify(plays.map(p => p.text))')).join(' | ');
    if (!/OUT OF BOUNDS/.test(text)){
      fail('kickoff out of bounds', 'the log does not say OUT OF BOUNDS: ' + text.slice(-120));
    }
    const st = JSON.parse(h.evalIn('JSON.stringify(computeState())'));
    if (st.possession !== 'teamB' || st.fieldPos !== 35 || st.down !== 1){
      fail('kickoff out of bounds', 'expected the receiving team 1st & 10 at their own 35, ' +
           'got possession=' + st.possession + ' fieldPos=' + st.fieldPos + ' down=' + st.down);
    }
    h.close();
  }

  // --- AFTER A TOUCHDOWN, ONLY THE TRY -----------------------------------
  // Added 14 Aug 2026. A touchdown does NOT set endsDrive -- the drive is
  // not over until the try is taken -- so the existing awaitingKickoff
  // gate deliberately did not fire, and every play button stayed live in
  // a gap where a rush or a punt cannot happen.
  //
  // The gate keys on SIX POINTS, not on effect.td, and that distinction
  // is the point of the second half of this test: effect.td is set on
  // scrimmage touchdowns only, so an interception, fumble or kick
  // returned all the way carries score.points 6 with no td flag. Keying
  // on td let a pick-six through with every button enabled.
  {
    const { enterPlay, setDrive, typeInto } = require('./ui_driver');
    const btnState = (h) => {
      const out = {};
      h.document.querySelectorAll('.ptypeBtn').forEach(b => { out[b.dataset.type] = !b.disabled; });
      return out;
    };
    const check = (label, st) => {
      const allowed = ['pat', 'twopt'];
      Object.keys(st).forEach(t => {
        const should = allowed.includes(t);
        if (st[t] !== should){
          fail('after a touchdown', label + ': ' + t + ' is ' + (st[t] ? 'enabled' : 'disabled') +
               ', expected ' + (should ? 'enabled' : 'disabled') +
               ' — only the try can follow a touchdown');
        }
      });
    };

    // 1. a scrimmage touchdown, which DOES set effect.td
    {
      const h = await bootGamePage();
      setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 6 });
      enterPlay(h, { type: 'rush', carrier: '22', yards: '6', td: true });
      check('rushing TD', btnState(h));
      h.close();
    }

    // 2. a DEFENSIVE touchdown, which does not. This is the one that was
    //    getting through.
    {
      const h = await bootGamePage();
      const { window: win, document: doc } = h;
      setDrive(h, { down: 2, distance: 8, side: 'own', yardline: 30 });
      // The interception panel is reached from the PASS panel's outcome
      // switch, not a top-level button -- there is no .ptypeBtn for it.
      click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
      click(win, [...doc.querySelectorAll('.pp-outcome-switch')]
        .find(b => /Intercepted/.test(b.textContent)));
      typeInto(win, doc.getElementById('pp_passer_manual'), '7');
      typeInto(win, doc.getElementById('pp_credit_manual'), '55');
      typeInto(win, doc.getElementById('pp_yards'), '30');
      click(win, doc.getElementById('pp_td_toggle'));
      click(win, doc.getElementById('pp_review'));
      click(win, doc.getElementById('saveBtn'));
      const last = h.db.plays[h.db.plays.length - 1];
      if (last && last.effect && last.effect.td){
        fail('after a touchdown', 'this fixture assumes a returned touchdown carries NO ' +
             'effect.td — it now does, so the test no longer covers the case it was ' +
             'written for and the gate should be re-checked');
      }
      check('interception returned for a TD', btnState(h));
      h.close();
    }

    // 3. and a THREE-point score must NOT gate to the try -- a field goal
    //    is followed by a kickoff, not a PAT.
    {
      const h = await bootGamePage();
      setDrive(h, { down: 4, distance: 5, side: 'opp', yardline: 20 });
      enterPlay(h, { type: 'fg', kicker: '3', yards: '37', result: 'g' });
      const st = btnState(h);
      if (st.pat || st.twopt){
        fail('after a touchdown', 'a made field goal enabled the try buttons — three points ' +
             'are followed by a kickoff, and only six compel a try');
      }
      if (!st.kickoff){
        fail('after a touchdown', 'a made field goal should leave the kickoff available');
      }
      h.close();
    }
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Control whitelists ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) {
      console.log('  no stray controls on any gated panel.');
    }
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
