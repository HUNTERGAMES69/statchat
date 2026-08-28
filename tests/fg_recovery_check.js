// Field goal recovery checks -- muffed hold and the credit/retyds order
// -----------------------------------------------------------------------
// Reported directly, 19 Aug 2026, with a screenshot: the "Blocked"
// outcome on the field goal panel already let a coach name who
// recovered, give return yards, and mark a touchdown -- "Muffed hold"
// (a botched snap or hold, no kick ever taken) had none of it, even
// though a muffed hold is exactly the same shape of live ball on the
// ground. Also requested: Blocked / Muffed hold / Fake moved onto one
// row, which used to sit inside the same flex row as Distance and the
// tee calculator and wrapped unpredictably once that row filled up.
//
// A second, genuine bug in the ALREADY-SHIPPED Blocked branch was found
// while building the muffed-hold version alongside it: the submit code
// omitted the recovery-credit token entirely when nobody was named,
// which shifts return yards into the credit token's own position the
// moment a coach enters yardage without a name -- a completely normal
// thing to do. Fixed for both branches together, the same way the
// kickoff-muffed branch ('km') had already solved it: always send a
// token, '?' meaning unnamed, so positions never move.

const { bootGamePage } = require('./harness');
const { enterPlay, setDrive, click, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1. Muffed hold, named recovery, returned for a touchdown ------
  {
    const h = await bootGamePage();
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_muffhold_toggle'));
    const creditBtn = h.document.querySelector('.pp_credit_pick_fgmuff');
    if (creditBtn) click(h.window, creditBtn);
    else typeInto(h.window, h.document.getElementById('pp_credit_manual_fgmuff'), '21');
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.getElementById('pp_review'));
    const pending = JSON.parse(h.evalIn('JSON.stringify(pending)'));
    if (!pending || !pending.effect || !pending.effect.score || pending.effect.score.points !== 6) {
      fail('muffhold-td', 'a muffed hold returned for a touchdown did not score 6: ' + JSON.stringify(pending && pending.effect));
    }
    if (!pending || pending.team !== 'teamB') {
      fail('muffhold-td', 'the recovering/scoring team (teamB) was not credited with the play: team=' + (pending && pending.team));
    }
    if (!/TOUCHDOWN/.test((pending || {}).text || '')) {
      fail('muffhold-td', 'the play text never said TOUCHDOWN: ' + JSON.stringify(pending && pending.text));
    }
    h.close();
  }

  // --- 2. Muffed hold, no name, WITH return yards -- the exact
  // positional bug this session found and fixed
  {
    // DRIVEN THROUGH THE PARSER, NOT THE PANEL -- deliberately, and this is
    // the only kind of test that should be.
    //
    // The return-yards input was removed from this panel on 25 August 2026:
    // it is not a credited stat and had no calculator. So there is no longer
    // a UI path that produces this code, and a UI-driven test cannot exist.
    //
    // The PARSER guarantee still has to hold. Codes written before today are
    // in the database and must keep reading correctly -- and the positional
    // misparse this test was written for is exactly the kind of thing that
    // rots unnoticed once nothing in the UI exercises it any more.
    const h = await bootGamePage();
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    // THE '?' IS NOT DECORATION. The emit is
    //   kicker + 'fg m' + (creditTok ? ' '+creditTok : '') + (ret ? ' '+ret : '')
    // with creditTok = sel.credit || (retyds ? '?' : ''), so a return with no
    // named recoverer emits '?' to HOLD THE POSITION. Writing this code
    // without it -- which I did first -- reproduces the exact misparse the
    // test was written for: the return is read as the recoverer.
    const code = '7fg m ? 8';
    const pending = JSON.parse(h.evalIn(
      'JSON.stringify(parseInput(' + JSON.stringify(code) + ', computeState()))'));
    if (!/returned 8/.test((pending || {}).text || '')) {
      fail('muffhold-positional', 'return yards with no name should still say "returned 8" -- got ' +
        JSON.stringify(pending && pending.text) + ' (code was "' + code + '")');
    }
    if (/recovered by/.test((pending || {}).text || '')) {
      fail('muffhold-positional', 'no name was given, but the text claims a specific recoverer anyway -- ' +
        'the exact misparse this session found: ' + JSON.stringify(pending && pending.text));
    }
    h.close();
  }

  // --- 3. Blocked, no name, WITH return yards -- the SAME positional
  // bug, but in the branch that had already shipped
  {
    // PARSER-DRIVEN for the same reason as the case above: the input this
    // used to type into was removed 25 August 2026, so no UI path produces
    // this code any more -- but saved plays still contain it.
    const h = await bootGamePage();
    setDrive(h, { down: 3, distance: 2, side: 'opp', yardline: 40 });
    const pending = JSON.parse(h.evalIn(
      'JSON.stringify(parseInput("7fg b ? 15", computeState()))'));
    if (!/returned 15/.test((pending || {}).text || '')) {
      fail('blocked-positional', 'return yards with no name should still say "returned 15" -- got ' +
        JSON.stringify(pending && pending.text));
    }
    if (/recovered by/.test((pending || {}).text || '')) {
      fail('blocked-positional', 'no name was given, but the text claims a specific recoverer anyway: ' +
        JSON.stringify(pending && pending.text));
    }
    h.close();
  }

  // --- 4. The shared Touchdown toggle resets when NEITHER outcome is
  // active, so it cannot carry a stale "touchdown" into an ordinary
  // good/missed submission that never asked the question at all.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 4, distance: 8, side: 'opp', yardline: 20 });
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_blocked_cb_toggle'));
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.getElementById('pp_fg_blocked_cb_toggle')); // untoggle Blocked
    if (h.document.getElementById('pp_td').checked) {
      fail('shared-td-reset', 'Touchdown stayed checked after both Blocked and Muffed hold were ' +
        'untoggled -- a stale TD could leak into an ordinary good/missed submission');
    }
    if (h.document.getElementById('pp_fg_td_wrap').style.display !== 'none') {
      fail('shared-td-reset', 'the shared Touchdown wrapper stayed visible with neither outcome active');
    }
    h.close();
  }

  // --- 5. The shared Touchdown toggle is PRESERVED when switching
  // between Blocked and Muffed hold themselves -- the same underlying
  // question, asked once.
  {
    const h = await bootGamePage();
    setDrive(h, { down: 4, distance: 8, side: 'opp', yardline: 20 });
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_blocked_cb_toggle'));
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.getElementById('pp_fg_muffhold_toggle')); // switch, not untoggle
    if (!h.document.getElementById('pp_td').checked) {
      fail('shared-td-preserve', 'switching from Blocked to Muffed hold cleared Touchdown, forcing the ' +
        'coach to re-answer a question they already answered');
    }
    h.close();
  }

  // --- 6. Blocked / Muffed hold / Fake render as three equal-width
  // siblings in one row, not split across the Distance/tee row and a
  // second, separate one.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('fg')");
    const blockedBtn = h.document.getElementById('pp_fg_blocked_cb_toggle');
    const muffBtn = h.document.getElementById('pp_fg_muffhold_toggle');
    const fakeBtn = h.document.getElementById('pp_fg_fake_toggle');
    const row = blockedBtn.parentElement.parentElement;
    if (muffBtn.parentElement.parentElement !== row || fakeBtn.parentElement.parentElement !== row) {
      fail('row-layout', 'Blocked, Muffed hold and Fake are not all siblings in the same row container');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Field goal recovery checks (muffed hold, credit/retyds order) ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  muffed hold matches blocked\'s own recovery/return/TD capability, in one shared row.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
