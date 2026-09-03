// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The Review card opens, and Save works, on every kind of play
// ============================================================
// Written 3 September 2026, BEFORE the change it protects.
//
// WHAT THIS IS ACTUALLY GUARDING. `showConfirm()` is the last thing between
// a scorer and a saved play. Everything in `tests/` that presses Review
// today assumes it worked and goes on to check what was logged; nothing
// checks that the card OPENED and that Save is pressable. So the one
// failure that would matter most on a Friday night -- an exception inside
// showConfirm leaving a tenant unable to record any play at all -- is the
// one failure the suite cannot currently see.
//
// That gap became worth closing because the card is about to grow a
// "Result" line: down, distance and spot after the play, computed by
// running `computeState(plays.concat([pending]))`. That call reads
// possession, field position and TEAMS, and it will run on the first play
// of a game, on kickoffs and on penalties -- exactly the states where half
// of that is null. The arithmetic is proven; the risk is that a throw takes
// the card with it.
//
// A missing Result line is a cosmetic disappointment. A dead Review button
// is a tenant that cannot score their game.
//
// PART A RUNS TODAY AND MUST KEEP PASSING FOREVER. It does not know or care
// whether the Result line exists.
//
// PART B checks the Result line and is SKIPPED, LOUDLY, until the element
// is there. A conditional check that stays silent when it does not run is
// how a test quietly stops testing -- so the skip is printed and counted.
//
//   node tests/review_card_check.js

const { bootGamePage } = require('./harness');
const D = require('./ui_driver');

let fails = 0, skips = 0;
const chk = (ok, m, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + m + (!ok && detail ? '\n         ' + detail : ''));
  if (!ok) fails++;
};
const skip = (m) => { console.log('  SKIP  ' + m); skips++; };

console.log('=== The Review card survives every play type ===\n');

// A roster wide enough to drive every tree: a passer, a back, a receiver,
// a kicker and a defender on each side.
const ROSTER = [
  { team_side: 'teamA', unit: 'offense', jersey_number: '7',  player_name: 'Quarterback', position: 'QB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '22', player_name: 'Runningback', position: 'RB' },
  { team_side: 'teamA', unit: 'offense', jersey_number: '80', player_name: 'Receiver',    position: 'WR' },
  { team_side: 'teamA', unit: 'special', jersey_number: '11', player_name: 'Kicker',      position: 'K'  },
  { team_side: 'teamA', unit: 'defense', jersey_number: '55', player_name: 'Linebacker',  position: 'LB' },
  { team_side: 'teamB', unit: 'offense', jersey_number: '9',  player_name: 'Opp QB',      position: 'QB' },
  { team_side: 'teamB', unit: 'defense', jersey_number: '99', player_name: 'Opp End',     position: 'DE' },
  { team_side: 'teamB', unit: 'special', jersey_number: '12', player_name: 'Opp Kicker',  position: 'K'  }
];

// ---------------------------------------------------------------------
// The scenarios. Each is a state to put the game in, then a play. The
// state matters as much as the play: the states below are the ones where
// a naive "read the situation after this play" would find a null.
// ---------------------------------------------------------------------
const CASES = [
  { label: 'a rush that does not convert',
    drive: { down: 1, distance: 10, side: 'own', yardline: 25 },
    spec: { type: 'rush', carrier: '22', yards: 4 } },

  { label: 'a rush that DOES convert',
    drive: { down: 1, distance: 10, side: 'own', yardline: 25 },
    spec: { type: 'rush', carrier: '22', yards: 14 } },

  { label: 'fourth down, stopped short',
    drive: { down: 4, distance: 2, side: 'own', yardline: 40 },
    spec: { type: 'rush', carrier: '22', yards: 1 } },

  { label: 'a completion',
    drive: { down: 2, distance: 8, side: 'own', yardline: 30 },
    spec: { type: 'pass', passer: '7', receiver: '80', yards: 12 } },

  { label: 'an incompletion',
    drive: { down: 2, distance: 8, side: 'own', yardline: 30 },
    spec: { type: 'pass', passer: '7', receiver: '80', incomplete: true } },

  { label: 'a sack',
    drive: { down: 2, distance: 8, side: 'own', yardline: 30 },
    spec: { type: 'sack', passer: '7', yards: 6 } },

  // Goal to go: togoLabel returns the STRING 'Goal' rather than a number,
  // which is the shape most likely to be mishandled by anything building a
  // situation line.
  { label: 'goal to go — distance is a word, not a number',
    drive: { down: 1, distance: 10, side: 'opp', yardline: 8 },
    spec: { type: 'rush', carrier: '22', yards: 2 } },

  // A touchdown ends the drive: there IS no next down and distance. The
  // Result line must not invent one.
  { label: 'a touchdown',
    drive: { down: 1, distance: 10, side: 'opp', yardline: 6 },
    spec: { type: 'rush', carrier: '22', yards: 6, td: true } },

  // A penalty is the OTHER place a situation is appended to the play text
  // (game.html:2958, not 3290). Anything that strips that tail for display
  // has to know about both sites.
  { label: 'a penalty on the offense',
    drive: { down: 2, distance: 5, side: 'own', yardline: 40 },
    spec: { type: 'penalty', on: 'offense', yards: '10' } },

  { label: 'a penalty on the defense',
    drive: { down: 2, distance: 5, side: 'own', yardline: 40 },
    spec: { type: 'penalty', on: 'defense', yards: '5' } },

  // Change of possession. The team with the ball afterwards is not the team
  // that had it before, which is the case a situation line gets wrong by
  // naming the wrong side.
  // The punt panel asks where the ball ended up -- a punt does not compute
  // its own spot -- so the spec carries one, the same as every other punt
  // in tests/. Without it Review correctly refuses, which is what the first
  // draft of this file mistook for a fault.
  { label: 'a punt',
    drive: { down: 4, distance: 12, side: 'own', yardline: 30 },
    spec: { type: 'punt', punter: '11', yards: 40, credit: '99', retyds: 6,
            spot: { side: 'opp', yardline: 36 } } },

  // A kickoff ESTABLISHES a spot rather than advancing from one, so field
  // position going in may be null by design.
  { label: 'a kickoff',
    drive: null, spec: { type: 'kickoff', kicker: '11', yards: 60, touchback: true } },

  { label: 'a field goal',
    drive: { down: 4, distance: 6, side: 'opp', yardline: 20 },
    spec: { type: 'fg', kicker: '11', yards: 37, result: 'g' } }
];

// ---------------------------------------------------------------------
// PART A0 — the refusal that must SURVIVE the change.
//
// A scrimmage play with no spot is refused on purpose: showConfirm() checks
// `effect.isStat && state.fieldPos === null` and stops, because the ball
// cannot move from an unknown spot and the impossible-gain check silently
// stops verifying yardage for the rest of the game if it tries.
//
// This is here because the first draft of this file listed "the first play
// of a game, no drive set" as a case that should SAVE, and read the refusal
// as a bug. It is the opposite: it is a guard, and a Result line that made
// the card open where it used to refuse would be a real regression.
// ---------------------------------------------------------------------
async function partZero() {
  console.log('--- A0. A play with no spot is still refused ---\n');
  const h = await bootGamePage({ roster: ROSTER });
  let r = null, threw = null;
  try {
    r = D.enterPlay(h, { type: 'rush', carrier: '22', yards: 4 });
  } catch (e) { threw = e; }

  chk(!threw, 'refusing does not throw', threw && String(threw.message || threw));
  chk(!!r && r.saved === false, 'a rush with no spot set is not saved');

  const warn = h.document.getElementById('fieldPosWarning');
  chk(!!warn && warn.style.display !== 'none',
      'and the card says why, inside the panel',
      'the warning element was not shown — a silent refusal reads as a dead button');
  chk(!!warn && /spot/i.test(warn.textContent || ''),
      'the message names the spot as the missing thing',
      'got: "' + (warn ? warn.textContent : '') + '"');
  h.close();
  console.log('');
}

// ---------------------------------------------------------------------
// PART A — the card opens and Save works.
// ---------------------------------------------------------------------
async function partA() {
  console.log('--- A. Review opens and the play saves ---\n');

  for (const c of CASES) {
    let h;
    try {
      h = await bootGamePage({ roster: ROSTER });
      if (c.drive) D.setDrive(h, c.drive);

      let r;
      try {
        r = D.enterPlay(h, c.spec);
      } catch (e) {
        if (e instanceof D.UnreachableByUI) {
          // The driver cannot reach this tree. That is a gap in the driver,
          // not a fault in the card, and saying which is the point.
          skip(c.label + ' — the driver cannot reach it: ' + e.message);
          h.close();
          continue;
        }
        // ANY OTHER THROW IS THE FAILURE THIS FILE EXISTS FOR.
        chk(false, c.label + ' — pressing Review threw',
            (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join('\n         ') : String(e)));
        h.close();
        continue;
      }

      chk(!!r.parsedText && r.parsedText !== 'Unrecognized entry.',
          c.label + ' — the card opened and parsed the play',
          'reason: ' + (r.reason || 'card did not open') + ', code: ' + r.code);

      chk(r.saved === true, c.label + ' — and Save recorded it',
          'reason: ' + (r.reason || 'saveBtn did not add a play'));

      h.close();
    } catch (e) {
      chk(false, c.label + ' — the page itself failed to boot or run',
          String(e && e.message || e));
      try { if (h) h.close(); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------
// PART B — the Result line, once it exists.
//
// Read BEFORE Save, because the card is torn down after it. That means
// driving the panel with the driver's own primitives and stopping at
// Review, rather than enterPlay(), which saves as its last act.
// ---------------------------------------------------------------------
function resultOf(h) {
  const el = h.document.getElementById('resultText');
  if (!el) return null;
  const wrap = h.document.getElementById('resultRow');
  // NOT offsetParent: jsdom does no layout, so it is null for everything
  // and every element would read as hidden. The row's own display is what
  // the code sets and what the browser honours.
  const shown = !!wrap && wrap.style && wrap.style.display !== 'none' && wrap.style.display !== '';
  return {
    el,
    text: (el.textContent || '').trim(),
    shown: shown,
    className: (wrap ? wrap.className : '') || ''
  };
}

async function partB() {
  console.log('\n--- B. The Result line ---\n');

  const probe = await bootGamePage({ roster: ROSTER });
  D.setDrive(probe, { down: 1, distance: 10, side: 'own', yardline: 25 });
  D.openPanel(probe.window, probe.document, 'rush');
  D.pickPlayer(probe.window, probe.document, 'carrier', '22');
  D.typeInto(probe.window, probe.document.getElementById('pp_yards'), 4);
  D.click(probe.window, probe.document.getElementById('pp_review'));

  const found = resultOf(probe);
  if (!found) {
    probe.close();
    skip('#resultText is not in game.html yet — the Result line has not shipped.');
    console.log('         Everything in Part A is what protects the card meanwhile.');
    return;
  }

  // 1. A scrimmage play states the situation, with a spot.
  chk(/\b(1st|2nd|3rd|4th)\b/.test(found.text) && / at /.test(found.text),
      'a rush shows a down, a distance and a spot', 'got: "' + found.text + '"');
  chk(found.shown, 'and the row is visible');
  probe.close();

  // 2. A conversion is green, a non-conversion amber. The colour is read
  //    off effect.converts, so this is checking the wiring, not the CSS.
  const cases = [
    { label: 'no first down → amber', yards: 4,  want: 'resultShort' },
    { label: 'first down → green',    yards: 14, want: 'resultConverts' }
  ];
  for (const c of cases) {
    const h = await bootGamePage({ roster: ROSTER });
    D.setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    D.openPanel(h.window, h.document, 'rush');
    D.pickPlayer(h.window, h.document, 'carrier', '22');
    D.typeInto(h.window, h.document.getElementById('pp_yards'), c.yards);
    D.click(h.window, h.document.getElementById('pp_review'));
    const r = resultOf(h);
    chk(!!r && new RegExp(c.want).test(r.className), c.label,
        'class was "' + (r ? r.className : 'no element') + '", text "' + (r ? r.text : '') + '"');
    h.close();
  }

  // 3. A touchdown has no next down and distance. The line must be absent
  //    or empty rather than showing a guess.
  {
    const h = await bootGamePage({ roster: ROSTER });
    D.setDrive(h, { down: 1, distance: 10, side: 'opp', yardline: 6 });
    D.openPanel(h.window, h.document, 'rush');
    D.pickPlayer(h.window, h.document, 'carrier', '22');
    D.typeInto(h.window, h.document.getElementById('pp_yards'), 6);
    const tdBtn = h.document.getElementById('pp_td_toggle') || h.document.getElementById('pp_td');
    if (tdBtn) D.click(h.window, tdBtn);
    D.click(h.window, h.document.getElementById('pp_review'));
    const r = resultOf(h);
    const parsed = (h.document.getElementById('parsedText').textContent || '');
    if (/TOUCHDOWN/i.test(parsed)) {
      chk(!r || !r.shown || r.text === '',
          'a touchdown shows no Result line', 'got: "' + (r ? r.text : '') + '"');
    } else {
      skip('could not drive a touchdown through the panel — the TD toggle moved');
    }
    h.close();
  }

  // 4. THE PLAY TEXT AND THE RESULT MUST NOT BOTH CARRY THE SITUATION.
  //    The whole point of the change is that it is stated once.
  {
    const h = await bootGamePage({ roster: ROSTER });
    D.setDrive(h, { down: 1, distance: 10, side: 'own', yardline: 25 });
    D.openPanel(h.window, h.document, 'rush');
    D.pickPlayer(h.window, h.document, 'carrier', '22');
    D.typeInto(h.window, h.document.getElementById('pp_yards'), 4);
    D.click(h.window, h.document.getElementById('pp_review'));
    const parsed = h.document.getElementById('parsedText').textContent || '';
    chk(!/\b(1st|2nd|3rd|4th) & /.test(parsed),
        'the displayed play text no longer repeats the down and distance',
        'got: "' + parsed + '"');

    // ...but the STORED text still does, because the log, the recap and the
    // feeds all read it. This is the display-only guarantee, asserted.
    D.click(h.window, h.document.getElementById('saveBtn'));
    const storedText = h.evalIn('plays[plays.length - 1] && plays[plays.length - 1].text');
    chk(typeof storedText === 'string' && /\b(1st|2nd|3rd|4th) & /.test(storedText),
        'and the STORED text still carries it — this change is display-only',
        'stored: "' + storedText + '"');
    h.close();
  }
}

(async () => {
  await partZero();
  await partA();
  await partB();
  console.log('\nFailures: ' + fails + (skips ? '   Skipped: ' + skips : ''));
  if (!fails && !skips) console.log('  Review opens and saves on every play type, and the Result line behaves.');
  if (!fails && skips) console.log('  Review opens and saves on every play type it could reach.');
  process.exit(fails ? 1 : 0);
})();
