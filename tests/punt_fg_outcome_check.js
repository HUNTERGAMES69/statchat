// Punt / field goal outcome-toggle checks
// -----------------------------------------
// Three items reported together, 19 Aug 2026:
//
//   1. On a muffed punt, Touchdown must not be selectable once "recovered
//      by the kicking team" is chosen -- that outcome has no flip and no
//      return in this app's own model, so there is nothing to return for
//      a score. updatePuntTdVisibility already did exactly this for a
//      BLOCKED punt recovered by the kicking team; the identical case for
//      a MUFFED one was simply never checked.
//   2. Muffed and Blocked, on both the punt and field goal panels, must be
//      mutually exclusive. First verified by checking only .checked --
//      which passed, on both panels, both directions -- and reported as
//      already correct. It was NOT: Andy reported it still broken after
//      that, and checking the button's own VISUAL state (its checkmark,
//      its gold "picked" styling) found why. clearOther correctly cleared
//      the checkbox and fired 'change', which correctly ran the other
//      toggle's own show/hide bookkeeping -- but the button's visual
//      state is set by a separate, global click handler that only fires
//      on an actual click, never on a programmatic checkbox change. Both
//      buttons could LOOK selected at once even though only one ever
//      really was. Fixed in clearOther itself, once, rather than in each
//      of the five places that called it or duplicated its logic inline.
//   3. A field goal's muffed hold, no touchdown, must show the same
//      starting-spot field that Blocked already shows. Twice fixed,
//      twice wrong. First pass fixed a real bug (the submit code's
//      early return skipped past the code that reads the spot into
//      the save) and added a test in tests/takeover_spot_check.js that
//      passed -- but that test never checked visibility, only whether
//      a value typed into the field made it into the save, so it could
//      not have caught the actual problem: the field's own inner
//      wrapper was still being hidden by leftover code from before the
//      return/recovery feature existed, so a coach saw an empty box
//      with nothing in it. Second pass (below) removed that leftover
//      code and added the test that checks the inner wrapper's own
//      visibility directly, against the known-working Blocked branch
//      as a control.

const { bootGamePage } = require('./harness');
const { click, setDrive, typeInto } = require('./ui_driver');

async function run() {
  const failures = [];
  const fail = (area, detail) => failures.push({ area, detail });

  // --- 1a. Punt, muffed, kicking team recovers (the default radio
  // selection) -- Touchdown must be hidden.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    if (h.document.getElementById('pp_punt_td_wrap').style.display !== 'none') {
      fail('punt-muff-kicking-td', 'Touchdown is still selectable on a muffed punt with the kicking ' +
        'team recovering -- the same outcome the blocked branch already hides it for');
    }
    h.close();
  }

  // --- 1b. Same punt, switched to receiving team recovers -- Touchdown
  // must reappear, since a real return is now possible.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_muffrec][value="r"]'));
    if (h.document.getElementById('pp_punt_td_wrap').style.display === 'none') {
      fail('punt-muff-receiving-td', 'Touchdown stayed hidden once the receiving team was selected to recover');
    }
    h.close();
  }

  // --- 1c. Touchdown checked while receiving team recovers, then
  // switched to kicking team recovers -- must reset, not leak into a
  // submission where it would be meaningless.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_muffrec][value="r"]'));
    click(h.window, h.document.getElementById('pp_td_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_muffrec][value="k"]'));
    if (h.document.getElementById('pp_td').checked) {
      fail('punt-muff-td-reset', 'Touchdown stayed checked (hidden) after switching to a kicking-team ' +
        'recovery -- a stale value that could reach a submission it was never meant for');
    }
    h.close();
  }

  // --- 2a. Punt: Blocked and Muffed are mutually exclusive, both
  // directions -- checked BOTH ways: the underlying data (.checked)
  // AND the button's own visual state (its text, its "picked" class).
  // The second half is not redundant. Reported directly, 19 Aug 2026:
  // clearOther already correctly cleared the CHECKBOX and fired
  // 'change' -- which is all an earlier version of this exact test
  // checked, and it passed throughout. But the button's own checkmark
  // and gold "picked" styling are set by a SEPARATE, global click
  // handler that only ever fires on an actual click on the button
  // itself, never on a programmatic checkbox change -- so the button a
  // coach had just switched away from kept LOOKING selected even after
  // the data underneath it was already correct. Both looked selected
  // at once, which is exactly what was reported, and exactly what
  // checking only .checked could never have caught.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_blocked_toggle'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    if (h.document.getElementById('pp_blocked').checked) fail('punt-mutex', 'checking Muffed left Blocked also checked');
    const blockedBtn = h.document.getElementById('pp_blocked_toggle');
    if (blockedBtn.classList.contains('picked') || /^✓/.test(blockedBtn.textContent)) {
      fail('punt-mutex-visual', 'Blocked\'s own button still LOOKS selected (checkmark/gold styling) ' +
        'after Muffed was chosen instead, even though its checkbox is correctly unchecked underneath: ' +
        JSON.stringify(blockedBtn.textContent));
    }
    h.close();
  }

  // --- 2b. Field goal: Blocked and Muffed hold are mutually exclusive,
  // both directions, same visual check as above.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_blocked_cb_toggle'));
    click(h.window, h.document.getElementById('pp_fg_muffhold_toggle'));
    if (h.document.getElementById('pp_fg_blocked_cb').checked) fail('fg-mutex', 'checking Muffed hold left Blocked also checked');
    const fgBlockedBtn = h.document.getElementById('pp_fg_blocked_cb_toggle');
    if (fgBlockedBtn.classList.contains('picked') || /^✓/.test(fgBlockedBtn.textContent)) {
      fail('fg-mutex-visual', 'Blocked\'s own button still LOOKS selected after Muffed hold was chosen ' +
        'instead: ' + JSON.stringify(fgBlockedBtn.textContent));
    }
    h.close();
  }

  // --- 2c. The same visual reset must hold for the Touchback toggle
  // clearing BOTH Blocked and Muffed at once on the punt panel -- the
  // one place a single action clears two others simultaneously.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_blocked_toggle'));
    click(h.window, h.document.getElementById('pp_punt_touchback_toggle'));
    const blockedBtn2 = h.document.getElementById('pp_blocked_toggle');
    if (blockedBtn2.classList.contains('picked') || /^✓/.test(blockedBtn2.textContent)) {
      fail('punt-touchback-visual', 'Blocked still LOOKS selected after Touchback cleared it: ' +
        JSON.stringify(blockedBtn2.textContent));
    }
    h.close();
  }

  // --- 2d. Fake must also visually clear whichever kick-outcome toggle
  // (Touchback/Blocked/Muffed) it replaces -- the shared fakeBlockHtml
  // wiring, used by both punt and field goal.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_muffed_toggle'));
    click(h.window, h.document.getElementById('pp_punt_fake_toggle'));
    const muffedBtn = h.document.getElementById('pp_muffed_toggle');
    if (muffedBtn.classList.contains('picked') || /^✓/.test(muffedBtn.textContent)) {
      fail('punt-fake-visual', 'Muffed still LOOKS selected after Fake cleared it: ' +
        JSON.stringify(muffedBtn.textContent));
    }
    h.close();
  }

  // --- Sanity: the pre-existing Blocked+own-team-recovers case for punt
  // must still hide Touchdown after the fix above.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('punt')");
    click(h.window, h.document.querySelector('.pp_punter_pick'));
    click(h.window, h.document.getElementById('pp_blocked_toggle'));
    click(h.window, h.document.querySelector('input[name=pp_punt_blockrec][value="own"]'));
    if (h.document.getElementById('pp_punt_td_wrap').style.display !== 'none') {
      fail('punt-block-own-td', 'the pre-existing blocked+own-team case no longer hides Touchdown');
    }
    h.close();
  }

  // --- 3. Field goal, muffed hold, no touchdown: the starting-spot
  // field's INNER wrapper must actually be visible, not just its outer
  // shell. startingSpotFieldsHtml wraps its own label/buttons/input in
  // a "pp_spot_wrap" div, specifically so a muffed-punt-style flow with
  // its OWN dedicated spot field can hide this generic one rather than
  // asking for the same yard line twice. Field goal's muffed hold has
  // no such dedicated field of its own -- it was always meant to use
  // this shared one, same as Blocked already does -- but leftover code
  // from before the return/recovery feature existed still hid this
  // inner wrapper unconditionally, while the OUTER wrapper
  // (pp_fg_spot_wrap, which syncFgSpotVisibility correctly shows) sat
  // there empty. Checking only the outer box, as an earlier version of
  // this exact test did, passed throughout and never caught it: an
  // empty visible box and a truly working field look identical from
  // outside, and typing into a hidden input works fine in a script even
  // though a coach could never see or reach it on a real screen.
  // Reported directly, comparing the muffed-hold case against the
  // already-working blocked one by name.
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_muffhold_toggle'));
    const innerWrap = h.document.getElementById('pp_spot_wrap');
    if (innerWrap.style.display === 'none') {
      fail('fg-muff-spot-inner-hidden', 'the starting-spot field\'s own inner wrapper is hidden, even ' +
        'though the outer box around it is visible -- a coach would see an empty box with nothing in it');
    }
    // The same check on the already-working Blocked branch, so a future
    // change to this shared field is judged against a control that is
    // known to work, not just against itself.
    h.close();
  }
  {
    const h = await bootGamePage();
    h.evalIn("renderPlayPanel('fg')");
    click(h.window, h.document.querySelector('.pp_kicker_pick'));
    click(h.window, h.document.getElementById('pp_fg_blocked_cb_toggle'));
    const innerWrapBlocked = h.document.getElementById('pp_spot_wrap');
    if (innerWrapBlocked.style.display === 'none') {
      fail('fg-blocked-spot-inner-hidden', 'sanity check failed: even the known-working Blocked branch ' +
        'now hides the inner spot wrapper -- something upstream of this change broke it');
    }
    h.close();
  }

  // ONE OUTCOME AT A TIME, on every kicking tree.
  // ---------------------------------------------------------------------
  // A kick is touchbacked OR blocked OR muffed OR faked, never two at
  // once. Kickoff enforced this from the start. Punt had a partial web --
  // Touchback cleared Blocked and Muffed, and those two cleared each
  // other, but NOTHING cleared Touchback -- so Touchback + Blocked could
  // both be held and the play was built from whichever branch the builder
  // tested first. Field goal had Blocked and Muffed hold clearing each
  // other with Fake in neither pair. Both reported from real use.
  {
    const groups = {
      punt:    ['pp_punt_touchback', 'pp_blocked', 'pp_muffed', 'pp_punt_fake'],
      fg:      ['pp_fg_blocked_cb', 'pp_fg_muffhold', 'pp_fg_fake'],
      kickoff: ['pp_ko_touchback', 'pp_ko_muffed', 'pp_ko_onside', 'pp_ko_oob']
    };
    for (const tree of Object.keys(groups)) {
      const ids = groups[tree];
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
      click(win, doc.querySelector('.ptypeBtn[data-type="' + tree + '"]'));
      await new Promise(r => setTimeout(r, 80));
      const checked = () => ids.filter(i => {
        const e = doc.getElementById(i); return e && e.checked;
      });
      let missing = false;
      for (const id of ids) {
        const btn = doc.getElementById(id + '_toggle');
        if (!btn) { fail('exclusive:' + tree + ':' + id, 'no toggle for ' + id); missing = true; continue; }
        click(win, btn);
        await new Promise(r => setTimeout(r, 70));
        const on = checked();
        if (on.length !== 1 || on[0] !== id) {
          fail('exclusive:' + tree,
            'after clicking ' + id + ' exactly one should be set, got [' + on.join(', ') + ']');
        }
      }
      if (!missing) {
        // Turning the last one OFF should leave none set -- exclusivity
        // must not make a toggle impossible to release.
        click(win, doc.getElementById(ids[ids.length - 1] + '_toggle'));
        await new Promise(r => setTimeout(r, 70));
        if (checked().length) {
          fail('exclusive:' + tree + ':release', 'unchecking should leave none set, got [' + checked().join(', ') + ']');
        }
      }
      h.close();
    }
  }

  // A TERMINAL OUTCOME LEAVES ONLY WHAT STILL APPLIES.
  // ---------------------------------------------------------------------
  // Two reports. On a kickoff touchback or out of bounds the return
  // fields should go and only the ball spot remain -- the plain tree did
  // this, the GUIDED one left "Fumbled during the return" on screen,
  // offering to record a fumble during a return that never happened. And
  // a blocked punt has no distance: the kick never got away, so the
  // yardage box is a question with no answer, left open and empty as
  // though the scorer had forgotten it.
  {
    const onScreen = (win, doc, id) => {
      let e = doc.getElementById(id);
      if (!e) return false;
      while (e && e !== doc.body) {
        if (win.getComputedStyle(e).display === 'none') return false;
        e = e.parentElement;
      }
      return true;
    };

    // GUIDED kickoff: touchback and out of bounds.
    for (const tog of ['gr_touchback_toggle', 'gr_oob_toggle']) {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      click(win, doc.getElementById('startGameBtn'));
      await new Promise(r => setTimeout(r, 80));
      click(win, doc.getElementById('pickA'));
      await new Promise(r => setTimeout(r, 80));
      click(win, doc.querySelector('.gk_kicker_pick'));
      const dir = doc.querySelector('.gk_dir_btn');
      if (dir) click(win, dir);
      click(win, doc.getElementById('guidedKickoffSave'));
      await new Promise(r => setTimeout(r, 250));
      const t = doc.getElementById(tog);
      if (!t) { fail('terminal:' + tog, 'toggle missing'); h.close(); continue; }
      click(win, t);
      await new Promise(r => setTimeout(r, 100));
      // EVERY id is checked to EXIST first. The first version of this
      // listed 'gr_retto_wrap' -- the punt tree's name -- which is not in
      // the guided panel at all, so onScreen returned false for a missing
      // element and the assertion passed while both calculators sat there
      // in plain sight. A test that cannot fail is worse than no test.
      ['gr_returner_grid', 'gr_returner_manual', 'gr_kofielded_wrap',
       'gr_koretto_wrap', 'gr_ko_ret_fumbled_wrap', 'gr_ko_ret_fum_wrap'].forEach(id => {
        if (!doc.getElementById(id)) {
          fail('terminal:' + tog + ':' + id, id + ' does not exist -- wrong id, so this check proves nothing');
          return;
        }
        if (onScreen(win, doc, id)) {
          fail('terminal:' + tog + ':' + id, id + ' should not survive a terminal outcome');
        }
      });
      // But the spot must REMAIN -- it is the one thing still being asked.
      if (!onScreen(win, doc, 'gr_spot_recv')) {
        fail('terminal:' + tog + ':spot', 'the ball spot should still be asked for');
      }
      h.close();
    }

    // PUNT blocked: the distance question is greyed out, and restored when
    // the toggle comes back off.
    {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 4, distance: 8, side: 'own', yardline: 30 });
      click(win, doc.querySelector('.ptypeBtn[data-type="punt"]'));
      typeInto(win, doc.getElementById('pp_yards'), '42');
      await new Promise(r => setTimeout(r, 60));
      click(win, doc.getElementById('pp_blocked_toggle'));
      await new Promise(r => setTimeout(r, 90));
      const y = doc.getElementById('pp_yards');
      if (!y.disabled) fail('terminal:blocked', 'a blocked punt has no distance to enter');
      if (y.value) fail('terminal:blocked-value', 'the stale distance should be cleared, found ' + JSON.stringify(y.value));
      if ([...doc.querySelectorAll('.quickYardsBtn[data-for="pp_yards"]')].some(b => !b.disabled)) {
        fail('terminal:blocked-pad', 'the 0-9 pad should be disabled too');
      }
      // Reversible: turning Blocked off has to give the field back.
      click(win, doc.getElementById('pp_blocked_toggle'));
      await new Promise(r => setTimeout(r, 90));
      if (doc.getElementById('pp_yards').disabled) {
        fail('terminal:blocked-restore', 'clearing Blocked should re-enable the distance');
      }
      h.close();
    }
  }

  // A LOOSE BALL RECOVERED IN YOUR OWN END ZONE IS A SAFETY.
  // ---------------------------------------------------------------------
  // Items 5 and 6, reported 23 Aug. Three trees asked who recovered and
  // then stopped. A snap over the punter's head that he falls on behind
  // his own goal line, and a field goal blocked from close range that
  // never travels, are both two points the other way -- and both are
  // among the commonest ways a safety actually happens. Touchdown was
  // askable on the kicking trees from the start; the mirror case was not,
  // so the play could only be entered as an ordinary block with the score
  // left to a manual adjustment.
  {
    const fgSafety = async (tog, safeBtn, label) => {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 4, distance: 3, side: 'own', yardline: 6 });
      click(win, doc.querySelector('.ptypeBtn[data-type="fg"]'));
      click(win, doc.querySelector('.pp_kicker_pick'));
      const t = doc.getElementById(tog);
      if (!t) { fail('safety:' + label, 'no ' + tog); h.close(); return; }
      click(win, t);
      await new Promise(r => setTimeout(r, 90));
      const b = doc.getElementById(safeBtn);
      if (!b) { fail('safety:' + label, 'no safety option on the ' + label + ' panel'); h.close(); return; }
      click(win, b);
      await new Promise(r => setTimeout(r, 80));
      click(win, doc.getElementById('pp_review'));
      await new Promise(r => setTimeout(r, 200));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 240));
      const text = h.evalIn('plays[plays.length-1].text');
      const scores = JSON.parse(h.evalIn('JSON.stringify(computeState().scores)'));
      if (!/SAFETY/.test(text)) fail('safety:' + label + ':text', 'the log should say SAFETY: ' + text);
      // Two points, and to the OTHER team -- the direction is the part
      // that is easy to get backwards.
      if (scores.teamB !== 2 || scores.teamA !== 0) {
        fail('safety:' + label + ':score', 'expected 0-2, got ' + JSON.stringify(scores));
      }
      h.close();
    };
    await fgSafety('pp_fg_blocked_cb_toggle', 'pp_fgb_safety_toggle', 'blocked');
    await fgSafety('pp_fg_muffhold_toggle', 'pp_fgmuff_safety_toggle', 'muffed hold');

    // BAD SNAP, both directions: own recovery in the end zone is a
    // safety, defensive recovery run in is their touchdown.
    const badSnap = async (mode, wantScore, wantText) => {
      const h = await bootGamePage();
      const doc = h.window.document, win = h.window;
      setDrive(h, { down: 2, distance: 9, side: 'own', yardline: 6 });
      click(win, doc.getElementById('badSnapUtilBtn'));
      await new Promise(r => setTimeout(r, 90));
      typeInto(win, doc.getElementById('badsnap_yds'), '8');
      if (mode === 'deftd') {
        const d = doc.querySelector('input[name=bs_rec][value=d]');
        d.checked = true;
        d.dispatchEvent(new win.Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 70));
      }
      const btn = doc.getElementById(mode === 'deftd' ? 'bs_def_td_toggle' : 'bs_safety_toggle');
      if (!btn) { fail('badsnap:' + mode, 'no option for ' + mode); h.close(); return; }
      click(win, btn);
      await new Promise(r => setTimeout(r, 70));
      click(win, doc.getElementById('badsnap_review'));
      await new Promise(r => setTimeout(r, 180));
      click(win, doc.getElementById('saveBtn'));
      await new Promise(r => setTimeout(r, 220));
      const text = h.evalIn('plays[plays.length-1].text');
      const scores = JSON.parse(h.evalIn('JSON.stringify(computeState().scores)'));
      if (!wantText.test(text)) fail('badsnap:' + mode + ':text', 'unexpected log: ' + text);
      if (scores.teamB !== wantScore) {
        fail('badsnap:' + mode + ':score', 'expected teamB ' + wantScore + ', got ' + JSON.stringify(scores));
      }
      // The yardage stays a TEAM rushing loss either way -- the snap
      // still went backwards, whoever ended up with it.
      const rush = JSON.parse(h.evalIn('JSON.stringify(computeBoxScore(plays).teamA.rushing)'));
      if (!rush.TEAM || rush.TEAM.yds !== -8) {
        fail('badsnap:' + mode + ':rush', 'the loss should stay a TEAM rush of -8, got ' + JSON.stringify(rush.TEAM));
      }
      h.close();
    };
    await badSnap('safety', 2, /SAFETY/);
    await badSnap('deftd', 6, /TOUCHDOWN/);
  }

  return failures;
}

if (require.main === module) {
  run().then(failures => {
    console.log('=== Punt / field goal outcome-toggle checks ===\n');
    console.log('Failures: ' + failures.length);
    failures.forEach(f => console.log('  [' + f.area + '] ' + f.detail));
    if (!failures.length) {
      console.log('  Touchdown is hidden exactly when there is nothing to return for one, and Blocked/Muffed stay mutually exclusive on both panels.');
    }
    process.exitCode = failures.length ? 1 : 0;
  }).catch(e => { console.error(e.stack); process.exit(1); });
}

module.exports = { run };
