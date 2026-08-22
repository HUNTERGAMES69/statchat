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

const { bootGamePage, defaultRoster } = require('./harness');
const { setDrive, click, enterPlay } = require('./ui_driver');

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

  // --- AN INCOMPLETE PASS HIDES THE YARDAGE CALCULATOR -------------------
  // Reported from a real game, 14 Aug 2026. Marking a pass incomplete
  // hid the yards field and the extra pass options but left the
  // calculator on screen, still offering "Or enter tackled on" for a ball
  // nobody caught.
  //
  // The second assertion is the one that matters. The calculator WRITES
  // INTO the yards box, so a value computed before the toggle sat behind
  // a hidden control and was read back at save time -- an incomplete pass
  // carrying yardage. Hiding without clearing would have looked fixed.
  {
    const { typeInto } = require('./ui_driver');
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    typeInto(win, doc.getElementById('pp_receiver_manual'), '80');

    // Use the calculator first, so there is something to leak.
    click(win, doc.querySelector('.calcSide[data-side="opp"]'));
    typeInto(win, doc.getElementById('pp_calc_yardline'), '45');
    if (!doc.getElementById('pp_yards').value){
      fail('incomplete pass', 'the calculator did not fill the yards box, so this test is ' +
           'no longer exercising the leak it was written for');
    }

    click(win, doc.getElementById('pp_incomplete_toggle'));
    const calc = doc.getElementById('pp_calc_wrap');
    if (!calc || calc.style.display !== 'none'){
      fail('incomplete pass', 'the yardage calculator is still on screen — an incomplete ' +
           'pass has no yardage to work out');
    }
    if (doc.getElementById('pp_yards').value){
      fail('incomplete pass', 'the yards box still holds ' +
           JSON.stringify(doc.getElementById('pp_yards').value) +
           ' behind a hidden control, and it is read back at save time');
    }
    if (doc.getElementById('pp_calc_yardline').value){
      fail('incomplete pass', 'the calculator still holds a yard line behind a hidden ' +
           'control — untoggling would silently recompute a yardage');
    }

    click(win, doc.getElementById('pp_review'));
    click(win, doc.getElementById('saveBtn'));
    const saved = h.db.plays[h.db.plays.length - 1];
    if (/for \d/.test(saved.text)){
      fail('incomplete pass', 'the saved play carries yardage: ' + saved.text);
    }

    // Untoggling must bring both back, or the coach cannot correct a
    // mis-tap without closing the panel.
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    typeInto(win, doc.getElementById('pp_passer_manual'), '7');
    click(win, doc.getElementById('pp_incomplete_toggle'));
    click(win, doc.getElementById('pp_incomplete_toggle'));
    if (doc.getElementById('pp_calc_wrap').style.display === 'none' ||
        doc.getElementById('pp_yards_wrap').style.display === 'none'){
      fail('incomplete pass', 'untoggling Incomplete did not restore the yards field and ' +
           'the calculator');
    }
    h.close();
  }

  // LAYOUT: labels inline, and one right-hand edge for every manual box.
  // The "type #" box was a fixed 100px but positioned by whatever the
  // grid beside it measured, so passer, receiver and returner each landed
  // at a different x -- three ragged edges down one tree. The column is
  // now the constant and the grid takes the remainder.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    for (const type of ['pass', 'punt', 'kickoff']) {
      click(win, doc.querySelector('.ptypeBtn[data-type="' + type + '"]'));
      const inputs = [...doc.querySelectorAll('#playPanel .pick-row > input')];
      if (!inputs.length) { fail('layout:' + type, 'no manual boxes found'); continue; }
      // FLEX-BASIS, not the rendered width. jsdom gives every input the
      // same default width whether or not the column is fixed, so a
      // width comparison passed even with the rule removed -- it could
      // not see the thing it was checking.
      // Kicker and punter boxes now live INSIDE their grid, flowing after
      // the last name, so they are not part of the aligned column and
      // are excluded from the width comparison below.
      const columnInputs = inputs.filter(i => !i.closest('.grid-inline-manual') && !i.closest('.opt-block'));
      const bases = new Set(columnInputs.map(i => win.getComputedStyle(i).flexBasis));
      // continue, not return: this sits inside the per-tree loop, and a
      // return here abandons run() itself -- the suite reported a
      // TypeError on undefined failures rather than skipping one tree.
      if (!columnInputs.length) continue;
      if (bases.size !== 1 || [...bases][0] === 'auto') {
        fail('layout:' + type + ':column', 'the manual boxes need one fixed column, got ' + [...bases].join(', '));
      }
      // THE GRID MUST CLAIM NO INTRINSIC WIDTH. The row wraps -- the
      // name-confirm box needs a full-width line -- and a wrapping flex
      // container wraps its items rather than shrinking them. With basis
      // auto the grid demanded the full width of its buttons, so on any
      // picker with more than two or three names the label and the
      // "type #" box were pushed onto their own lines. The pass tree hid
      // this: its passer list is one or two buttons and fitted anyway.
      [...doc.querySelectorAll('#playPanel .pick-row > div')].forEach(g => {
        if (g.classList.contains('name-confirm')) return;
        // An EXPANDED OPTIONAL BLOCK is deliberately different: its grid
        // takes the full width so the manual box drops to its own line
        // directly under the button that opened it, rather than floating
        // against a far right edge with an often-empty grid beside it.
        if (g.closest('.opt-block')) return;
        if (win.getComputedStyle(g).flexBasis !== '0px') {
          fail('layout:' + type + ':grid-basis',
            'the picker grid must not claim its content width, got ' + win.getComputedStyle(g).flexBasis);
        }
      });
      // No PICKER label owns a line any more. Headings that ask a real
      // question over their own row of controls -- "Which way is Neville
      // kicking?" -- are not picker labels and correctly keep theirs; the
      // check is that no <p> is left sitting directly above a pick-row.
      [...doc.querySelectorAll('#playPanel > p')].forEach(pEl => {
        const next = pEl.nextElementSibling;
        if (next && next.classList && next.classList.contains('pick-row')) {
          fail('layout:' + type + ':label',
            'a picker label still owns its own line: ' + JSON.stringify(pEl.textContent.trim()));
        }
      });
    }
    // Air between consecutive pickers -- inlining the labels removed their
    // margins too, which left passer and receiver touching.
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    const rows = [...doc.querySelectorAll('#playPanel .pick-row')];
    const second = rows[1];
    if (second && win.getComputedStyle(second).marginTop === '0px') {
      fail('layout:gap', 'consecutive pickers need vertical air between them');
    }
    // Punt: toggles paired, spot on one line.
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const grid = doc.querySelector('#playPanel .toggle-grid');
    if (!grid || grid.querySelectorAll('button').length !== 4) {
      fail('layout:toggles', 'the four punt outcome toggles should sit in one two-up grid');
    }
    const spot = doc.querySelector('#playPanel .spot-row');
    if (!spot) fail('layout:spot', 'the spot block should be a single row');
    else {
      if (!spot.querySelector('input')) fail('layout:spot-input', 'the spot row lost its yard box');
      if (spot.querySelectorAll('button').length !== 2) fail('layout:spot-sides', 'the spot row should keep both side buttons');
      // Shortened, but the full wording survives in the tooltip -- it is a
      // REQUIRED field and "Spot" alone leans on already knowing that.
      const lab = spot.querySelector('.spot-label');
      if (!lab || !/required/i.test(lab.getAttribute('title') || '')) {
        fail('layout:spot-title', 'the shortened spot label must keep its full wording in the tooltip');
      }
    }
    h.close();
  }

  // KICKER AND PUNTER COLLAPSE TO ONE ROW: the likeliest man, a "+N more"
  // expander, and the manual box on a single line. A team has one of each
  // and they do not change between attempts, so the full grid is a row of
  // names read once a season.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: 'special', jersey_number: '39', player_name: 'Rivers Sorrell', position: 'P' },
      { team_side: 'teamA', unit: 'special', jersey_number: '1',  player_name: 'Brooks Yerger', position: 'K' },
      { team_side: 'teamA', unit: 'special', jersey_number: '7',  player_name: 'Cole Sandifer', position: 'K' },
      { team_side: 'teamA', unit: 'special', jersey_number: '8',  player_name: 'Bryant Alvernia', position: 'P' }
    ]);
    const h = await bootGamePage({ roster });
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    for (const type of ['punt', 'fg', 'pat', 'kickoff']) {
      click(win, doc.querySelector('.ptypeBtn[data-type="' + type + '"]'));
      const grid = doc.querySelector('#playPanel .grid-lead');
      if (!grid) { fail('lead:' + type, 'the kicker list should collapse to one row'); continue; }
      const picks = [...grid.querySelectorAll('button[class*="_pick"]')];
      const shown = picks.filter(b => win.getComputedStyle(b).display !== 'none');
      if (shown.length !== 1) {
        fail('lead:' + type + ':visible', 'exactly one name should show, got ' + shown.length);
      }
      if (!grid.querySelector('.grid-more')) fail('lead:' + type + ':more', 'no expander offered');
      // All three controls on the SAME row -- that is the saving.
      if (!grid.querySelector('input')) fail('lead:' + type + ':manual', 'the manual box should sit on the row too');
      // Hidden, not removed: expanding is a class flip, and anything that
      // reads the grid still sees every name.
      if (picks.length < 2) fail('lead:' + type + ':dom', 'the other names should stay in the DOM');
    }
    // Expanding reveals the rest and retires the button.
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    const g = doc.querySelector('#playPanel .grid-lead');
    click(win, g.querySelector('.grid-more'));
    const after = [...g.querySelectorAll('button[class*="_pick"]')]
      .filter(b => win.getComputedStyle(b).display !== 'none').length;
    if (after < 2) fail('lead:expand', 'expanding should reveal the rest, visible ' + after);
    if (g.querySelector('.grid-more')) fail('lead:expand-btn', 'the expander should go once used');
    h.close();
  }

  // KICKOFF ORDER: which way they are kicking sits ABOVE the returner.
  // It is a fact about the kick itself and belongs beside the kicker; the
  // return is about what happened after the ball came down, and having it
  // in between split the two halves of one question apart.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
    click(win, doc.querySelector('.ptypeBtn[data-type="kickoff"]'));
    const html = doc.getElementById('playPanel').innerHTML;
    const dir = html.indexOf('koDirBtn'), ret = html.indexOf('pp_ko_ret_wrap');
    if (dir === -1 || ret === -1) fail('kickoff:order', 'direction or returner block missing');
    else if (dir > ret) fail('kickoff:order', 'the direction buttons should come before the returner block');

    // The muff toggle is short enough not to clip. The long wording only
    // ever fitted on the widest panel.
    for (const type of ['kickoff', 'punt']) {
      click(win, doc.querySelector('.ptypeBtn[data-type="' + type + '"]'));
      const muff = [...doc.querySelectorAll('#playPanel button')]
        .filter(b => /muff/i.test(b.textContent));
      if (!muff.length) { fail('muff:' + type, 'no muff toggle found'); continue; }
      muff.forEach(b => {
        const t = b.textContent.replace(/^\u2713\s*/, '').trim();
        if (t.length > 16) fail('muff:' + type + ':length', 'the muff label is long enough to clip: ' + JSON.stringify(t));
      });
    }
    h.close();
  }

  // THE RECEIVER LIST TAKES THE FULL WIDTH, box at the end of it.
  // Reserving a column beside it pushed the names into three rows where
  // they fit in two -- a row of height spent on an alignment, on the
  // longest list on the busiest tree.
  {
    const roster = defaultRoster().concat([
      { team_side: 'teamA', unit: 'offense', jersey_number: '13', player_name: "Ze'Land Young", position: 'WR' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '3',  player_name: 'JaMarion Roberson', position: 'WR' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '47', player_name: 'Mason Hart', position: 'WR' },
      { team_side: 'teamA', unit: 'offense', jersey_number: '19', player_name: 'Desi Byrd', position: 'WR' }
    ]);
    const h = await bootGamePage({ roster });
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    // BOTH long lists: the receiver on the pass tree and the carrier on
    // the rush tree. The carrier was left out when the receiver was done
    // and had exactly the same problem.
    for (const [type, gridId, boxId] of [['pass', 'pp_receiver_grid', 'pp_receiver_manual'],
                                          ['rush', 'pp_carrier_grid', 'pp_carrier_manual']]) {
      click(win, doc.querySelector('.ptypeBtn[data-type="' + type + '"]'));
      const rg = doc.getElementById(gridId);
      if (!rg) { fail(type + ':grid', 'no ' + gridId); continue; }
      if (!rg.classList.contains('grid-inline-manual')) {
        fail(type + ':inline', 'the box should sit at the end of the list, not in a column');
      }
      const inp = rg.querySelector('input');
      if (!inp || inp.id !== boxId) { fail(type + ':box', 'the manual box should be inside the grid'); continue; }
      // LAST, after the names -- not first, where it would read as a
      // control rather than the overflow it is.
      const kids = [...rg.children];
      if (kids.indexOf(inp) < kids.filter(k => k.tagName === 'BUTTON').length) {
        fail(type + ':order', 'the box should follow the names');
      }
      // NOT collapsed. Who carried or caught it is the question being
      // asked; hiding the list behind "+N more" would put a tap in front
      // of the most-used control on the page.
      if (rg.classList.contains('grid-lead') || rg.querySelector('.grid-more')) {
        fail(type + ':collapse', 'this list must stay open');
      }
    }
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    // The passer keeps its column -- its list is one or two names, so
    // there is no row to win and a box that moves is worse than one that
    // sits still.
    const pg = doc.getElementById('pp_passer_grid');
    if (pg && pg.classList.contains('grid-inline-manual')) {
      fail('receiver:passer', 'the passer was not meant to change');
    }
    h.close();
  }

  // THE EMPTY STAGE. With nothing open the area beside the ladder reads
  // "Make a selection to begin" over the mark; it was simply blank, which
  // looks like something failing to load rather than waiting for you.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    const shown = async () => {
      await new Promise(r => setTimeout(r, 120));
      return win.getComputedStyle(doc.getElementById('stageEmpty')).display !== 'none';
    };
    const el = doc.getElementById('stageEmpty');
    if (!el) { fail('stage:missing', 'no empty-stage element'); h.close(); return failures; }
    if (!/Make a selection to begin/.test(el.textContent)) {
      fail('stage:text', 'wrong wording: ' + JSON.stringify(el.textContent.trim()));
    }
    // Text above the mark, both centred on one axis.
    if (el.firstElementChild.tagName === 'IMG') fail('stage:order', 'the text should sit above the logo');
    if (win.getComputedStyle(el).flexDirection !== 'column') fail('stage:stack', 'it should stack');
    if (win.getComputedStyle(el).alignItems !== 'center') fail('stage:centre', 'it should be centred');
    if (!await shown()) fail('stage:initial', 'it should show when nothing is open');

    // EVERY opener hides it -- including the utility trees, which build
    // their markup straight into #playPanel without going through
    // renderPlayPanel. Hooking openers one at a time is what left the
    // placeholder behind an open tree; a MutationObserver on the panel is
    // what makes this list exhaustive rather than a list somebody has to
    // remember to extend.
    for (const id of ['penUtilBtn', 'timeoutUtilBtn', 'badSnapUtilBtn', 'driveUtilBtn',
                      'setClockUtilBtn', 'manualBtn']) {
      click(win, doc.getElementById(id));
      if (await shown()) fail('stage:open:' + id, 'the placeholder is still showing behind an open panel');
      click(win, doc.getElementById('phaseClearBtn'));
      if (!await shown()) fail('stage:clear:' + id, 'it should return after Clear');
    }
    // And a play tree.
    click(win, doc.querySelector('.ptypeBtn[data-type="pass"]'));
    if (await shown()) fail('stage:tree', 'the placeholder is still showing behind the pass tree');
    h.close();
  }

  // THE FIELD STRIP'S CHROME SITS BELOW THE FIELD, on the line that
  // already carries the direction arrow and the team with the ball. That
  // line was there anyway with dead space at both ends, so the label and
  // Hide cost nothing there -- and the row they used to occupy above the
  // field is gone.
  {
    const h = await bootGamePage();
    const doc = h.window.document, win = h.window;
    setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 35 });
    enterPlay(h, { type: 'rush', carrier: '22', yards: '6' });
    const fs = doc.getElementById('fieldStrip');
    if (win.getComputedStyle(fs).display === 'none') { fail('strip:hidden', 'the strip should be showing'); h.close(); return failures; }
    // Field FIRST, chrome after it.
    const order = [...fs.children].map(c => c.id);
    if (order[0] !== 'fieldStripBody') {
      fail('strip:order', 'the field should come first, got ' + order.join(' > '));
    }
    if (!doc.getElementById('fieldStripFooter')) fail('strip:footer', 'no footer row');
    // Pulled up onto the direction line rather than stacked under it --
    // otherwise this move costs a row instead of saving one.
    if (parseInt(win.getComputedStyle(doc.getElementById('fieldStripFooter')).marginTop, 10) >= 0) {
      fail('strip:overlay', 'the footer should sit on the direction line, not below it');
    }
    // Hide and Show still work, and the warning slot survived the move.
    if (!doc.getElementById('fieldStripWarn')) fail('strip:warn', 'the warning slot was lost');
    click(win, doc.getElementById('fieldStripToggle'));
    await new Promise(r => setTimeout(r, 80));
    if (win.getComputedStyle(fs).display !== 'none') fail('strip:hide', 'Hide did not hide the strip');
    click(win, doc.getElementById('fieldStripShow'));
    await new Promise(r => setTimeout(r, 80));
    if (win.getComputedStyle(fs).display === 'none') fail('strip:show', 'Show did not bring it back');
    h.close();
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
