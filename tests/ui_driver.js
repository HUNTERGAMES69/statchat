// StatChat UI driver
// ------------------
// Performs genuine coach actions against real DOM elements: clicks the
// real play-type button, clicks real player-picker buttons or types into
// the real "or type #" inputs, types into real yardage <input>s, clicks
// the real toggle buttons, then clicks the real Review and Save buttons.
//
// NOTHING here calls parseInput(), buildAndReview(), or pushAndPersist()
// directly. If a code path can't be reached by clicking and typing, it
// can't be reached by a coach either, and the driver must NOT fake it --
// it throws instead. (An earlier version of this harness faked a bare
// safety by writing to the hidden #code field, which tested nothing.)

class UnreachableByUI extends Error {}

function q(doc, id) {
  const el = doc.getElementById(id);
  if (!el) throw new UnreachableByUI('no element #' + id + ' in the current panel');
  return el;
}

function click(win, el) {
  if (!el) throw new UnreachableByUI('tried to click a missing element');
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function typeInto(win, el, value) {
  if (!el) throw new UnreachableByUI('tried to type into a missing element');
  el.value = String(value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

// Pick a jersey number the way a coach does: click the player's picker
// button if the app is showing one, otherwise type the number into the
// "or type #" field next to it. Both are real UI paths.
function pickPlayer(win, doc, role, num, opts = {}) {
  const panel = doc.getElementById('playPanel');
  const suffix = opts.suffix || '';
  const groupClass = role === 'credit' ? 'pp_credit_pick' + suffix : 'pp_' + role + '_pick';
  const manualId = role === 'credit' ? 'pp_credit_manual' + suffix : 'pp_' + role + '_manual';

  if (opts.preferPicker !== false) {
    const btn = panel.querySelector('.' + groupClass + '[data-num="' + num + '"]');
    if (btn) { click(win, btn); return 'picker'; }
  }
  typeInto(win, q(doc, manualId), num);
  return 'manual';
}

function toggle(win, doc, toggleId) {
  click(win, q(doc, toggleId));
}

function radio(win, doc, name, value) {
  const panel = doc.getElementById('playPanel');
  const el = panel.querySelector('input[name=' + name + '][value="' + value + '"]');
  if (!el) throw new UnreachableByUI('no radio ' + name + '=' + value);
  el.checked = true;
  click(win, el);
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function setStartingSpot(win, doc, prefix, side, yardline) {
  const panel = doc.getElementById('playPanel');
  const btn = panel.querySelector('.' + prefix + '_side[data-side="' + side + '"]');
  if (!btn) throw new UnreachableByUI('no starting-spot side button ' + side);
  click(win, btn);
  typeInto(win, q(doc, prefix + '_yardline'), yardline);
}

/**
 * Open a play panel by clicking the real top-level button.
 * Sack and Interception are deliberately NOT top-level any more -- they
 * are reached via the Pass panel's "Sacked"/"Intercepted" switches, so
 * the driver goes through Pass first, exactly as a coach must.
 */
function openPanel(win, doc, type) {
  if (type === 'sack' || type === 'int') {
    openPanel(win, doc, 'pass');
    const panel = doc.getElementById('playPanel');
    const label = type === 'sack' ? 'Sacked' : 'Intercepted';
    const sw = [...panel.querySelectorAll('.pp-outcome-switch')]
      .find(b => b.textContent.trim() === label);
    if (!sw) throw new UnreachableByUI('Pass panel has no "' + label + '" switch');
    click(win, sw);
    return;
  }
  if (type === 'penalty') {
    click(win, q(doc, 'penUtilBtn'));
    return;
  }
  const btn = doc.querySelector('.ptypeBtn[data-type="' + type + '"]');
  if (!btn) throw new UnreachableByUI('no top-level play button for type "' + type + '"');
  click(win, btn);
}

/**
 * Drive one complete play through the real UI, end to end.
 *
 * spec: {
 *   type, carrier, passer, receiver, kicker, punter, credit,
 *   yards, retyds, td, incomplete, fumbled, fumrec, safety,
 *   blocked, result, spot:{side,yardline}, clock, sub,
 *   preferPicker
 * }
 * @returns {{code:string, parsedText:string, saved:boolean}}
 */
function enterPlay(h, spec) {
  const { window: win, document: doc } = h;
  const t = spec.type;
  openPanel(win, doc, t);

  const P = (role, num, opts) => { if (num !== undefined && num !== null) pickPlayer(win, doc, role, num, Object.assign({ preferPicker: spec.preferPicker }, opts || {})); };

  if (t === 'penalty') {
    const panel = doc.getElementById('playPanel');
    const side = spec.on === 'defense' ? 'def' : 'off';
    const b = panel.querySelector('.penTeamBtn[data-team="' + side + '"]');
    if (!b) throw new UnreachableByUI('no penalty team button');
    click(win, b);
    typeInto(win, q(doc, 'pen_yds'), spec.yards);
    click(win, q(doc, 'pen_review'));
    return finish(h, spec);
  }

  if (t === 'rush') {
    P('carrier', spec.carrier);
    if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
    if (spec.fumbled) {
      toggle(win, doc, 'pp_rush_fumbled_toggle');
      radio(win, doc, 'pp_rush_fumrec', spec.fumrec || 'opp');
      if ((spec.fumrec || 'opp') === 'opp') {
        P('credit', spec.credit, { suffix: '_rushfum' });
        if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_rushfum_retyds'), spec.retyds);
        if (spec.fumTd) toggle(win, doc, 'pp_rushfum_td_toggle');
      } else if (spec.safety) toggle(win, doc, 'pp_rushfum_safety_toggle');
    } else {
      if (spec.safety) toggle(win, doc, 'pp_rush_safety_toggle');
      if (spec.td) toggle(win, doc, 'pp_td_toggle');
    }
  } else if (t === 'pass') {
    P('passer', spec.passer);
    if (spec.incomplete) {
      toggle(win, doc, 'pp_incomplete_toggle');
      P('receiver', spec.receiver);
    } else {
      P('receiver', spec.receiver);
      if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
      if (spec.fumbled) {
        toggle(win, doc, 'pp_pass_fumbled_toggle');
        radio(win, doc, 'pp_pass_fumrec', spec.fumrec || 'opp');
        if ((spec.fumrec || 'opp') === 'opp') {
          P('credit', spec.credit, { suffix: '_passfum' });
          if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_passfum_retyds'), spec.retyds);
          if (spec.fumTd) toggle(win, doc, 'pp_passfum_td_toggle');
        } else if (spec.safety) toggle(win, doc, 'pp_passfum_safety_toggle');
      } else {
        if (spec.safety) toggle(win, doc, 'pp_pass_safety_toggle');
        if (spec.td) toggle(win, doc, 'pp_td_toggle');
      }
    }
  } else if (t === 'sack') {
    P('passer', spec.passer);
    if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
    if (spec.fumbled) {
      toggle(win, doc, 'pp_sack_fumbled_toggle');
      radio(win, doc, 'pp_sack_fumrec', spec.fumrec || 'opp');
      if ((spec.fumrec || 'opp') === 'opp') {
        P('credit', spec.credit, { suffix: '_sackfum' });
        if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_sackfum_retyds'), spec.retyds);
        if (spec.fumTd) toggle(win, doc, 'pp_sackfum_td_toggle');
      } else if (spec.safety) toggle(win, doc, 'pp_sackfum_safety_toggle');
    } else {
      if (spec.safety) toggle(win, doc, 'pp_sack_safety_toggle');
      P('credit', spec.credit);
    }
  } else if (t === 'int') {
    P('passer', spec.passer);
    P('credit', spec.credit);
    if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
    if (spec.td) toggle(win, doc, 'pp_td_toggle');
    if (spec.spot) setStartingSpot(win, doc, 'pp_spot', spec.spot.side, spec.spot.yardline);
  } else if (t === 'fumble') {
    P('carrier', spec.carrier);
    radio(win, doc, 'pp_fumrec', spec.fumrec || 'opp');
    if ((spec.fumrec || 'opp') === 'opp') {
      P('credit', spec.credit);
      if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
      if (spec.td) toggle(win, doc, 'pp_td_toggle');
    } else if (spec.safety) toggle(win, doc, 'pp_fum_safety_toggle');
    if (spec.spot) setStartingSpot(win, doc, 'pp_spot', spec.spot.side, spec.spot.yardline);
  } else if (t === 'kickoff') {
    P('kicker', spec.kicker);
    // Kickoffs have no distance field -- nothing reports kick distance,
    // so it was removed from the panel. spec.yards is accepted and
    // ignored so existing scenarios keep working unchanged.
    void spec.yards;
    if (spec.touchback) {
      toggle(win, doc, 'pp_ko_touchback_toggle');
    } else {
      P('credit', spec.credit);
      if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_retyds'), spec.retyds);
      if (spec.td) toggle(win, doc, 'pp_td_toggle');
    }
    if (spec.spot) setStartingSpot(win, doc, 'pp_spot', spec.spot.side, spec.spot.yardline);
  } else if (t === 'punt') {
    P('punter', spec.punter);
    if (spec.blocked) {
      toggle(win, doc, 'pp_blocked_toggle');
      radio(win, doc, 'pp_punt_blockrec', spec.blockrec || 'opp');
      if ((spec.blockrec || 'opp') === 'opp') {
        P('credit', spec.credit, { suffix: '_pb' });
        if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_blockretyds'), spec.retyds);
        if (spec.td) toggle(win, doc, 'pp_td_toggle');
      } else if (spec.safety) toggle(win, doc, 'pp_punt_safety_toggle');
    } else {
      if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
      P('credit', spec.credit);
      if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_retyds'), spec.retyds);
      if (spec.td) toggle(win, doc, 'pp_td_toggle');
    }
    if (spec.spot) setStartingSpot(win, doc, 'pp_spot', spec.spot.side, spec.spot.yardline);
  } else if (t === 'fg') {
    P('kicker', spec.kicker);
    if (spec.yards !== undefined) typeInto(win, q(doc, 'pp_yards'), spec.yards);
    if (spec.blocked) {
      toggle(win, doc, 'pp_fg_blocked_cb_toggle');
      P('credit', spec.credit, { suffix: '_fgb' });
      if (spec.retyds !== undefined) typeInto(win, q(doc, 'pp_blockretyds'), spec.retyds);
      if (spec.td) toggle(win, doc, 'pp_td_toggle');
    } else {
      radio(win, doc, 'pp_fgres', spec.result || 'g');
    }
  } else if (t === 'pat') {
    P('kicker', spec.kicker);
    if (spec.blocked) {
      toggle(win, doc, 'pp_pat_blocked_cb_toggle');
      // Blocker only. NFHS allows no return on a try, so there is no
      // return-yards field to fill.
      P('credit', spec.credit);
    } else {
      radio(win, doc, 'pp_patres', spec.result || 'g');
    }
  } else if (t === 'twopt') {
    const sub = spec.sub || 'rush';
    click(win, q(doc, sub === 'rush' ? 'pp_2pt_rush_btn' : 'pp_2pt_pass_btn'));
    // Unlike every other touchdown control in the app, the 2pt
    // "returned all the way" box is a plain visible checkbox rather
    // than the hidden-checkbox-plus-styled-button pattern, so it is
    // clicked directly.
    // Clicking a checkbox TOGGLES it, so setting .checked first and then
    // clicking would silently turn it back off. Click alone, then verify.
    // checkDefTd removed: NFHS gives the defense no score on a try, so
  // the controls it drove no longer exist.
    if (sub === 'rush') {
      P('carrier', spec.carrier);
      radio(win, doc, 'pp_2pt_rush_res', spec.result || 'g');
      if ((spec.result || 'g') === 'b') {
        P('credit', spec.credit, { suffix: '_2ptRush' });
      }
    } else {
      P('passer', spec.passer);
      P('receiver', spec.receiver);
      radio(win, doc, 'pp_2pt_pass_res', spec.result || 'g');
      if ((spec.result || 'g') === 'b') {
        P('credit', spec.credit, { suffix: '_2ptPass' });
      }
    }
  } else if (t === 'safety') {
    P('credit', spec.credit);
  } else {
    throw new UnreachableByUI('driver has no support for play type "' + t + '"');
  }

  click(win, q(doc, 'pp_review'));
  return finish(h, spec);
}

// Complete the confirm step: fill the clock if the app is asking for it,
// honour the possession-flip checkbox, then click the real Save button.
function finish(h, spec) {
  const { window: win, document: doc } = h;
  const confirmCard = doc.getElementById('confirmCard');
  if (!confirmCard || confirmCard.style.display === 'none') {
    return { code: doc.getElementById('code').value, parsedText: null, saved: false,
             reason: 'Review did not open the confirm card (a required field was probably missing)' };
  }
  const parsedText = doc.getElementById('parsedText').textContent;
  const warnEl = doc.getElementById('fieldPosWarning');
  const warning = warnEl && warnEl.style.display !== 'none' ? warnEl.textContent : null;

  if (parsedText === 'Unrecognized entry.') {
    return { code: doc.getElementById('code').value, parsedText, saved: false, reason: 'Unrecognized entry' };
  }

  const flipRow = doc.getElementById('flipRow');
  if (flipRow && flipRow.style.display !== 'none' && spec.flip === false) {
    doc.getElementById('flipCheck').checked = false;
  }

  const clockRow = doc.getElementById('confirmClockRow');
  if (clockRow && clockRow.style.display !== 'none' && spec.clock) {
    typeInto(win, doc.getElementById('confirmClockInput'), spec.clock);
  }

  const before = h.evalIn('plays.length');
  click(win, doc.getElementById('saveBtn'));
  const after = h.evalIn('plays.length');

  return {
    code: doc.getElementById('code').value,
    parsedText,
    warning,
    saved: after > before,
    playsAdded: after - before
  };
}

/**
 * Establish down/distance/field position using the real "New drive /
 * correct down" utility -- the same widget a coach uses.
 * side: 'own' picks the button labelled "<current offense>'s side".
 */
function setDrive(h, { down = 1, distance = 10, side = 'own', yardline = 25 }) {
  const { window: win, document: doc } = h;
  click(win, q(doc, 'driveUtilBtn'));
  const panel = doc.getElementById('playPanel');
  const downLabel = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[down];
  const dBtn = [...panel.querySelectorAll('.driveDownBtn')].find(b => b.textContent.trim() === downLabel);
  if (!dBtn) throw new UnreachableByUI('no down button ' + downLabel);
  click(win, dBtn);

  const sideBtns = [...panel.querySelectorAll('.driveSideBtn')];
  const idx = side === 'own' ? 0 : 1;
  click(win, sideBtns[idx]);

  typeInto(win, q(doc, 'drive_dist'), distance);
  typeInto(win, q(doc, 'drive_yardline'), yardline);
  click(win, q(doc, 'drive_review'));
  return finish(h, {});
}

module.exports = { enterPlay, openPanel, pickPlayer, typeInto, click, toggle, radio, setStartingSpot, setDrive, finish, UnreachableByUI };
