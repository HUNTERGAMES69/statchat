// Fake punt / fake field goal checks
// ----------------------------------
// Added Aug 10, 2026, after Andy asked why 48 games of NFL testing and a
// full-game UI walkthrough had never surfaced that fakes were unmodelled.
//
// The answer is worth keeping, because it bounds what all the other
// suites can tell you. nflverse labels a fake by its ACTUAL play type --
// a fake punt arrives as play_type "run" -- so the NFL harness entered
// them as ordinary rushes, StatChat handled them perfectly, and every
// tier passed. The harness never asks "was this from punt formation?"
// because that only exists in the description text. And the full-game
// walkthrough contains exactly what was written down, which did not
// include a fake.
//
// So: EVERY TEST HERE VERIFIES THAT WHAT EXISTS WORKS. None can report
// what is missing. `coverage_probe` sounds like it should -- it reports
// 47/47 paths -- but that list was enumerated from the app's own panels,
// so it is a mirror of the implementation, not a specification. Closing
// that gap needs a checklist from outside the code: the NFHS rulebook,
// a real stat sheet, or someone who knows football looking at the app.
//
// What a fake must do:
//   - log as a FAKE, so the play does not read later as an ordinary run
//     on 4th down with no explanation
//   - credit the rusher or passer normally
//   - credit the KICKER with nothing, because no kick was attempted
//   - keep the ball when it converts, turn it over on downs when it does
//     not

const { bootGamePage, bootPage } = require('./harness');
const { setDrive, click, typeInto } = require('./ui_driver');

async function enterFake(kind, opts) {
  const h = await bootGamePage();
  const { window: win, document: doc } = h;
  setDrive(h, { down: 4, distance: opts.distance || 3, side: 'own', yardline: 40 });
  click(win, doc.querySelector('.ptypeBtn[data-type="' + kind + '"]'));
  const panel = doc.getElementById('playPanel');
  click(win, panel.querySelector(kind === 'punt'
    ? '.pp_punter_pick[data-num="15"]' : '.pp_kicker_pick[data-num="3"]'));

  const toggleId = (kind === 'punt' ? 'pp_punt_fake' : 'pp_fg_fake') + '_toggle';
  const toggle = doc.getElementById(toggleId);
  if (!toggle) { h.close(); return { error: 'no Fake control on the ' + kind + ' panel' }; }
  click(win, toggle);

  const pre = kind === 'punt' ? 'pp_puntfake' : 'pp_fgfake';
  if (opts.sub === 'pass') {
    click(win, doc.getElementById(pre + '_pass_btn'));
    typeInto(win, doc.getElementById('pp_passer_manual'), opts.passer);
    if (opts.receiver) typeInto(win, doc.getElementById('pp_receiver_manual'), opts.receiver);
    if (opts.incomplete) {
      const cb = doc.getElementById(pre + '_incomplete');
      cb.checked = true;
      cb.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
  } else {
    typeInto(win, doc.getElementById('pp_carrier_manual'), opts.carrier);
  }
  if (opts.yards !== undefined) typeInto(win, doc.getElementById(pre + '_yards'), opts.yards);
  if (opts.td) {
    const cb = doc.getElementById(pre + '_td');
    cb.checked = true;
    cb.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  click(win, doc.getElementById('pp_review'));
  const parsed = doc.getElementById('parsedText').textContent;
  const clockRow = doc.getElementById('confirmClockRow');
  if (clockRow && clockRow.style.display !== 'none') {
    typeInto(win, doc.getElementById('confirmClockInput'), '6:00');
  }
  const flip = doc.getElementById('flipCheck');
  if (flip && !flip.checked) click(win, flip);
  click(win, doc.getElementById('saveBtn'));

  const banner = doc.getElementById('downText').textContent;
  const rows = h.db.plays.map((x, i) =>
    Object.assign({}, x, { sequence_number: x.sequence_number || i + 1 }));
  h.close();
  return { parsed, banner, rows };
}

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- it must READ as a fake ------------------------------------------
  for (const [kind, label] of [['punt', 'FAKE PUNT'], ['fg', 'FAKE FIELD GOAL']]) {
    const r = await enterFake(kind, { sub: 'rush', carrier: '22', yards: '9' });
    if (r.error) { fail(kind, r.error); continue; }
    if (r.parsed.indexOf(label) === -1) {
      fail(kind, 'should log as "' + label + '", got: "' + r.parsed + '"');
    }
  }

  // --- converting keeps the ball; failing turns it over ----------------
  {
    const good = await enterFake('punt', { sub: 'rush', carrier: '22', yards: '9', distance: 3 });
    if (!good.error) {
      if (good.banner.indexOf('Neville ball') === -1) {
        fail('converted fake', 'the offense should keep the ball, banner: "' + good.banner + '"');
      }
      if (!/1st & 10/.test(good.banner)) {
        fail('converted fake', 'expected a fresh set of downs, banner: "' + good.banner + '"');
      }
    }
    const short = await enterFake('punt', { sub: 'rush', carrier: '22', yards: '1', distance: 3 });
    if (!short.error) {
      if (short.parsed.indexOf('turnover on downs') === -1) {
        fail('failed fake', 'should say turnover on downs, got: "' + short.parsed + '"');
      }
      if (short.banner.indexOf('TEST OPP ball') === -1) {
        fail('failed fake', 'the other team should have the ball, banner: "' + short.banner + '"');
      }
    }
  }

  // --- the pass variant, including an incompletion ---------------------
  {
    const p = await enterFake('fg', { sub: 'pass', passer: '7', receiver: '80', yards: '15' });
    if (!p.error && p.parsed.indexOf('pass to') === -1) {
      fail('fake pass', 'expected a completed pass, got: "' + p.parsed + '"');
    }
    const inc = await enterFake('punt', { sub: 'pass', passer: '7', receiver: '80', incomplete: true });
    if (!inc.error && inc.parsed.indexOf('INCOMPLETE') === -1) {
      fail('fake pass', 'expected an incompletion, got: "' + inc.parsed + '"');
    }
  }

  // --- a fake that scores ----------------------------------------------
  {
    const td = await enterFake('punt', { sub: 'rush', carrier: '22', yards: '60', td: true });
    if (!td.error && td.parsed.indexOf('TOUCHDOWN') === -1) {
      fail('fake touchdown', 'expected a touchdown, got: "' + td.parsed + '"');
    }
  }

  // --- the stats have to land on the RIGHT player ----------------------
  // This is the part that makes a fake worth modelling at all: the
  // yardage belongs to the runner, and the punter or kicker gets nothing,
  // because no kick was attempted.
  {
    const r = await enterFake('punt', { sub: 'rush', carrier: '22', yards: '9' });
    if (!r.error) {
      const v = await bootPage('view.html', { existingPlays: r.rows });
      const box = JSON.parse(v.evalIn('JSON.stringify(computeBoxScore(plays))'));
      const rushing = box.teamA.rushing || {};
      const st = box.teamA.specialTeams || {};
      const runner = Object.keys(rushing)[0];
      if (!runner || (rushing[runner].yds || 0) !== 9) {
        fail('attribution', 'the 9 yards should be on the runner, rushing is ' +
             JSON.stringify(rushing));
      }
      if (Object.keys(st).length) {
        fail('attribution', 'no kick was attempted, so special teams must be empty, got ' +
             JSON.stringify(st));
      }
      v.close();
    }
  }

  // --- a fake is not a kick: the kick controls must clear ---------------
  {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 4, distance: 3, side: 'own', yardline: 40 });
    click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
    click(win, doc.getElementById('pp_punt_touchback_toggle'));
    click(win, doc.getElementById('pp_punt_fake_toggle'));
    if (doc.getElementById('pp_punt_touchback').checked) {
      fail('exclusivity', 'ticking Fake should clear Touchback — a fake is not a kick');
    }
    if (doc.getElementById('pp_puntfake_box').style.display === 'none') {
      fail('exclusivity', 'the fake sub-panel did not open');
    }
    h.close();
  }

  // --- WHITELIST: nothing kick-related may survive a fake --------------
  //
  // This assertion exists because the same bug was reported four times in
  // a row. Each fix hid the control that had just been spotted -- the
  // calculator, then the takeover spot, then a duplicate Touchdown, then
  // Good/Missed -- which is a BLACKLIST: anything not on the list stays
  // visible, and the list only grows when someone notices.
  //
  // Inverted here. The test enumerates every live control on the panel
  // and compares against what is ALLOWED. Anything else fails, including
  // a control added months from now that nobody thought to hide. The
  // failure message names it, so the fix is to classify it rather than
  // to go hunting.
  const ALLOWED = {
    punt: [
      '.pp_punter_pick', 'pp_punter_manual',        // who is on the field
      // The kicker/punter list collapses to one name plus a "+N more"
      // expander. The picker itself is allowed above, so its expander is
      // too -- hiding only the expander would leave a live picker whose
      // other names could not be reached.
      '.grid-more',
      'pp_punt_touchback_toggle', 'pp_blocked_toggle', 'pp_muffed_toggle',
      'pp_punt_fake_toggle',                        // the outcome row itself
      'pp_puntfake_rush_btn', 'pp_puntfake_pass_btn',
      '.pp_carrier_pick', 'pp_carrier_manual',
      '.pp_passer_pick', 'pp_passer_manual',
      '.pp_receiver_pick', 'pp_receiver_manual',
      'pp_puntfake_yards', '.lossToggle',
      // The 0-9 pad, live on a fake since 23 Aug for the same reason as
      // the calculator below: a fake is a rush or a pass, and it was the
      // one yardage entry in the app where a scorer had to reach for a
      // keyboard. It targets the FAKE's own yards box, not pp_yards.
      '.quickYardsBtn',
      // The yardage calculator, live on a fake since 14 Aug 2026. It used
      // to be hidden with the rest of the kick fields, on the reasoning
      // that it measures where a KICK came down -- but a fake is a rush
      // or a pass, and working out "tackled on the 41" is exactly as
      // useful here as on any scrimmage play. It is retargeted to the
      // fake's own yards box rather than duplicated, which is what the
      // assertions in yardage_calculator_check.js pin.
      'pp_calc_yardline', '.calcSide', '.ptoggle',
      'pp_puntfake_incomplete_toggle', 'pp_puntfake_td_toggle',
      // NOT pp_credit_* -- on the punt panel those are the RETURNER
      // fields ("Returned by"), not a tackler. Allowing them here is how
      // this test passed while "Returned by (optional)" sat at the foot
      // of every fake punt. A whitelist catches controls nobody thought
      // about; it cannot catch one that was thought about and filed under
      // the wrong heading.
      'pp_review', 'pp_clear'
    ],
    fg: [
      '.pp_kicker_pick', 'pp_kicker_manual', '.grid-more',
      'pp_fg_blocked_cb_toggle', 'pp_fg_muffhold_toggle', 'pp_fg_fake_toggle',
      'pp_fgfake_rush_btn', 'pp_fgfake_pass_btn',
      '.pp_carrier_pick', 'pp_carrier_manual',
      '.pp_passer_pick', 'pp_passer_manual',
      '.pp_receiver_pick', 'pp_receiver_manual',
      'pp_fgfake_yards', '.lossToggle',
      'pp_fgfake_incomplete_toggle', 'pp_fgfake_td_toggle',
      // The 0-9 pad, live on a fake since 23 Aug. NOT the calculator: the
      // field goal panel has no pp_calc_wrap to borrow, and adding a
      // hidden one silently broke the kick distance -- see the note in
      // game.html beside the fake block.
      '.quickYardsBtn',
      'pp_review', 'pp_clear'
    ]
  };

  for (const kind of ['punt', 'fg']) {
    const h = await bootGamePage();
    const { window: win, document: doc } = h;
    setDrive(h, { down: 4, distance: 3, side: 'own', yardline: 40 });
    click(win, doc.querySelector('.ptypeBtn[data-type="' + kind + '"]'));
    const panel = doc.getElementById('playPanel');
    click(win, panel.querySelector(kind === 'punt'
      ? '.pp_punter_pick[data-num="15"]' : '.pp_kicker_pick[data-num="3"]'));
    click(win, doc.getElementById((kind === 'punt' ? 'pp_punt_fake' : 'pp_fg_fake') + '_toggle'));

    const visible = el => {
      let e = el;
      while (e && e !== panel) {
        if (e.style && e.style.display === 'none') return false;
        e = e.parentElement;
      }
      return true;
    };
    const live = [...new Set([...panel.querySelectorAll('input,button,select')]
      .filter(e => e.type !== 'hidden' && visible(e))
      .map(e => e.id || ('.' + String(e.className || '?').split(' ')[0])))];

    const unexpected = live.filter(id => ALLOWED[kind].indexOf(id) === -1);
    if (unexpected.length) {
      fail(kind + ' fake whitelist',
        'these are still live on a fake and should not be (or belong in ALLOWED): ' +
        unexpected.join(', '));
    }
    // Both sub-panels must be reachable, or the whitelist is passing
    // because half the panel failed to render.
    if (live.indexOf(kind === 'punt' ? 'pp_puntfake_yards' : 'pp_fgfake_yards') === -1) {
      fail(kind + ' fake whitelist', 'the fake yardage field is missing entirely');
    }
    h.close();
  }

  return failures;
}

if (require.main === module) {
  run().then(f => {
    console.log('=== Fake punt / fake field goal checks ===\n');
    console.log('Failures: ' + f.length);
    f.forEach(x => console.log('  [' + x.area + '] ' + x.detail));
    if (!f.length) console.log('  fakes log as fakes, credit the runner, and settle possession correctly.');
    process.exitCode = f.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
